// ═══════════════════════════════════════════════════════════════
// Pague-para-solicitar (estilo Uber)
//  1. tutor solicita  -> status 'aguardando_pagamento' (horário reservado, profissional NÃO vê)
//  2. pagamento aprovado (webhook) -> 'pendente' + push pro profissional
//  3. não pagou em JANELA_PAGAMENTO_MIN  -> 'expirada' (horário liberado)
//  4. profissional não respondeu em PRAZO_RESPOSTA_HORAS -> 'recusado' + estorno
//  5. qualquer cancelamento/recusa/expiração com pagamento -> estorno automático
// Pagamento é OBRIGATÓRIO: sem Mercado Pago conectado + preço do serviço, não dá para solicitar.
// ═══════════════════════════════════════════════════════════════
const pool = require('../database');

const JANELA_PAGAMENTO_MIN = 15;      // ⚠️ se mudar, mude também o INTERVAL '15 minutes' em consultasPaciente
const PRAZO_RESPOSTA_HORAS = Number(process.env.PRAZO_RESPOSTA_HORAS || 12);

async function push(token, titulo, corpo) {
  if (!token || !String(token).startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: token, title: titulo, body: corpo, sound: 'default' }),
    });
  } catch (e) { console.error('pps push:', e.message); }
}
const tokenDe = async (usuario_id) =>
  (await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [usuario_id])).rows[0]?.push_token;

// require preguiçoso: evita dependência circular com pagamentoMpController
const estornar = (consulta_id) =>
  require('../controllers/pagamentoMpController').estornarSeNecessario(consulta_id)
    .catch((e) => console.error('pps estorno consulta', consulta_id, e.message));

// Pagamento é OBRIGATÓRIO para solicitar. Devolve 'ok' | 'sem_mp' | 'sem_preco'.
// Erros de banco NÃO viram "ok": sobem (o chamador responde 500) — nunca deixa solicitar sem cobrança.
async function verificarCobranca(medico_id, tipoAtendimento, especialidade) {
  const m = (await pool.query(
    'SELECT mp_access_token, mp_conectado, tipo_conta FROM medicos WHERE usuario_id = $1', [medico_id]
  )).rows[0];
  if (!m?.mp_conectado || !m?.mp_access_token) return 'sem_mp';
  const { derivarServicoId } = require('../controllers/pagamentoMpController');
  const servicoId = derivarServicoId(m.tipo_conta, { tipo_atendimento: tipoAtendimento, especialidade });
  if (!servicoId) return 'sem_preco';
  const p = await pool.query(
    'SELECT 1 FROM precos_servicos WHERE usuario_id = $1 AND servico_id = $2 LIMIT 1', [medico_id, servicoId]
  );
  return p.rows.length > 0 ? 'ok' : 'sem_preco';
}

// Chamado pelo webhook quando um pagamento de consulta é APROVADO.
async function aoPagamentoAprovado(consulta_id) {
  const lib = await pool.query(
    `UPDATE consultas SET status = 'pendente', liberada_em = NOW()
     WHERE id = $1 AND status = 'aguardando_pagamento' RETURNING *`, [consulta_id]
  );
  if (lib.rows[0]) {
    const c = lib.rows[0];
    const nome = c.nome_perfil || 'Um paciente';
    await push(await tokenDe(c.medico_id), '📅 Nova consulta solicitada!',
      `${nome} solicitou (e já pagou) uma consulta para ${c.data} às ${c.horario}.`);
    await push(await tokenDe(c.paciente_id), '✅ Pagamento confirmado',
      'Sua solicitação foi enviada ao profissional. Se ele não puder atender, o valor é devolvido.');
    return 'liberada';
  }
  const st = (await pool.query('SELECT status FROM consultas WHERE id = $1', [consulta_id])).rows[0]?.status;
  // Pagou depois de a solicitação já ter caído (expirou/cancelou/recusou): devolve.
  if (st && ['expirada', 'cancelada', 'recusado'].includes(st)) {
    await estornar(consulta_id);
    await push(await tokenDe((await pool.query('SELECT paciente_id FROM consultas WHERE id=$1',[consulta_id])).rows[0]?.paciente_id),
      '↩️ Pagamento devolvido', 'A solicitação já não estava mais ativa, então o valor está sendo devolvido.');
    return 'estornada';
  }
  return 'nada'; // já pendente/aceita (ex.: Pix pago depois do aceite) — fluxo normal
}

// Tutor cancela. Se há pagamento (ou Pix em aberto), NÃO apaga: marca 'cancelada' e estorna.
async function removerConsultaDoTutor(id, paciente_id) {
  const tem = await pool.query(
    `SELECT 1 FROM pagamentos_mp WHERE consulta_id = $1 AND status IN ('aprovado','pendente','estornando') LIMIT 1`, [id]
  );
  if (tem.rows.length > 0) {
    const r = await pool.query(
      `UPDATE consultas SET status = 'cancelada', motivo_cancelamento = 'tutor'
       WHERE id = $1 AND paciente_id = $2 RETURNING *`, [id, paciente_id]
    );
    if (r.rows[0]) {
      await pool.query(`UPDATE pagamentos_mp SET status = 'expirado', atualizado_em = NOW()
                        WHERE consulta_id = $1 AND status = 'pendente' AND mp_payment_id IS NULL`, [id]);
      estornar(id);
      const c = r.rows[0];
      push(await tokenDe(c.medico_id), 'Solicitação cancelada', `O tutor cancelou a solicitação de ${c.data} às ${c.horario}.`);
    }
    return r.rows[0] || null;
  }
  const d = await pool.query('DELETE FROM consultas WHERE id = $1 AND paciente_id = $2 RETURNING *', [id, paciente_id]);
  return d.rows[0] || null;
}

// Cron (a cada minuto)
async function expirarNaoPagos() {
  const r = await pool.query(
    `UPDATE consultas c SET status = 'expirada', motivo_cancelamento = 'nao_pago'
     WHERE c.status = 'aguardando_pagamento'
       AND c.criado_em < NOW() - make_interval(mins => $1::int)
       AND NOT EXISTS (SELECT 1 FROM pagamentos_mp pm
                       WHERE pm.consulta_id = c.id AND pm.status = 'pendente'
                         AND pm.criado_em > NOW() - make_interval(mins => $1::int))
     RETURNING c.id, c.paciente_id, c.data, c.horario`, [String(JANELA_PAGAMENTO_MIN)]
  );
  for (const c of r.rows) {
    await pool.query(`UPDATE pagamentos_mp SET status = 'expirado', atualizado_em = NOW()
                      WHERE consulta_id = $1 AND status = 'pendente' AND mp_payment_id IS NULL`, [c.id]);
    await push(await tokenDe(c.paciente_id), '⏰ Solicitação expirada',
      `O pagamento não foi concluído a tempo e o horário de ${c.data} às ${c.horario} foi liberado.`);
  }
  return r.rowCount;
}

async function expirarSemResposta() {
  const r = await pool.query(
    `UPDATE consultas SET status = 'recusado', motivo_cancelamento = 'sem_resposta'
     WHERE status = 'pendente'
       AND COALESCE(liberada_em, criado_em) < NOW() - make_interval(hours => $1::int)
     RETURNING id, paciente_id, medico_id, data, horario`, [String(PRAZO_RESPOSTA_HORAS)]
  );
  for (const c of r.rows) {
    await estornar(c.id);
    await push(await tokenDe(c.paciente_id), '❌ Profissional não respondeu',
      `Sua solicitação de ${c.data} às ${c.horario} foi cancelada por falta de resposta. Se você pagou, o valor será devolvido.`);
    await push(await tokenDe(c.medico_id), 'Solicitação encerrada',
      `A solicitação de ${c.data} às ${c.horario} foi cancelada por falta de resposta.`);
  }
  return r.rowCount;
}

async function rodarTarefas() {
  try {
    const a = await expirarNaoPagos();
    const b = await expirarSemResposta();
    if (a || b) console.log(`[pps] expiradas sem pagamento: ${a} · sem resposta do profissional: ${b}`);
  } catch (e) { console.error('[pps] erro nas tarefas:', e.message); }
}

module.exports = { JANELA_PAGAMENTO_MIN, verificarCobranca, aoPagamentoAprovado, removerConsultaDoTutor, rodarTarefas };