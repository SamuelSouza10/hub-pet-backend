const pool = require('../database');
const crypto = require('crypto');
// ✅ NOVO: o access_token do profissional é salvo cifrado — precisa
// decifrar antes de usar em qualquer chamada à API da Mercado Pago.
const { decifrar } = require('../utils/cryptoUtil');
// ✅ Reaproveita a MESMA constante de taxa (10%) da camada de
// abstração já existente (services/servicoPagamento.js) — ela já foi
// pensada pra essa migração ("se um dia migrar pro Split, só essas
// funções mudam"). Não duplicamos o número em dois lugares.
const { PERCENTUAL_TAXA } = require('../services/servicoPagamento');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Cobrança com split em tempo real (Mercado Pago).
// O tutor paga, e o Mercado Pago já separa a taxa da plataforma e
// manda o resto direto pro profissional, numa cobrança só.
//
// ⚠️ Isso SUBSTITUI o modelo de taxa acumulada mensal que já existia
// (services/servicoPagamento.js, tabela cobrancas_taxa) — decisão
// tomada conscientemente, sabendo que isso entra no escopo do Split
// Payment Fiscal (retenção automática de imposto) que motivou o
// modelo antigo. `registrarTaxaEvento`/`calcularFechamentoMes`
// continuam existindo mas não são mais chamados por este fluxo — a
// seção financeira do relatório mensal (Pro) vai continuar sempre
// zerada, como já estava (nunca foi conectada de verdade).
// ═══════════════════════════════════════════════════════════════

const BACKEND_URL = process.env.BACKEND_URL || 'https://hub-pet-backend-production.up.railway.app';

// ✅ Nem todo tipo de conta declara preço pelo mesmo "servico_id":
// veterinário usa o tipo de atendimento (presencial/teleconsulta/
// domiciliar); clínica e petshop/serviço usam um slug do nome da
// especialidade/serviço escolhido — EXATAMENTE a mesma regra que
// financeiro.tsx usa pra salvar o preço, senão a busca aqui nunca
// bateria com o que o profissional cadastrou.
const EXAMES_CLINICA = {
  raiox: 'Raio-X', ultrassom: 'Ultrassonografia', ecg: 'Eletrocardiograma',
  laboratorial: 'Exames laboratoriais', cirurgia: 'Cirurgia', internacao: 'Internação',
  vacinacao: 'Vacinação', castracao: 'Castração', emergencia24h: 'Emergência 24h',
  domiciliar: 'Atendimento domiciliar',
};
function slugify(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function derivarServicoId(tipoConta, consulta) {
  if (tipoConta === 'veterinario') return consulta.tipo_atendimento || 'presencial';
  if (tipoConta === 'clinica') {
    const idConhecido = Object.entries(EXAMES_CLINICA).find(([, label]) => label === consulta.especialidade)?.[0];
    return idConhecido || slugify(consulta.especialidade || '');
  }
  if (tipoConta === 'petshop' || tipoConta === 'servico') return slugify(consulta.especialidade || '');
  return null; // farmácia usa orçamento por solicitação, não preço fixo — fora do escopo desta cobrança
}

// ── Cria a cobrança (Checkout Pro) pra uma consulta específica ────
exports.criarPreferencia = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const { consulta_id } = req.body;
    if (!consulta_id) return res.status(400).json({ erro: 'Informe a consulta' });

    // Confirma posse — só o próprio tutor paga a própria consulta.
    const consultaResult = await pool.query(
      'SELECT id, medico_id, tipo_atendimento, especialidade, nome_perfil, status FROM consultas WHERE id = $1 AND paciente_id = $2',
      [consulta_id, paciente_id]
    );
    if (consultaResult.rows.length === 0) return res.status(404).json({ erro: 'Consulta não encontrada' });
    const consulta = consultaResult.rows[0];

    const medicoResult = await pool.query(
      'SELECT mp_access_token, mp_conectado, tipo_conta FROM medicos WHERE usuario_id = $1',
      [consulta.medico_id]
    );
    const medico = medicoResult.rows[0];
    if (!medico?.mp_conectado || !medico?.mp_access_token) {
      return res.status(400).json({ erro: 'Esse profissional ainda não ativou o recebimento de pagamentos.' });
    }
    try {
      medico.mp_access_token = decifrar(medico.mp_access_token);
    } catch (e) {
      console.error('Falha ao decifrar token do profissional', consulta.medico_id, '— verifique MP_TOKEN_ENCRYPTION_KEY:', e.message);
      return res.status(500).json({ erro: 'Erro interno do servidor' });
    }

    const servicoId = derivarServicoId(medico.tipo_conta, consulta);
    if (!servicoId) {
      return res.status(400).json({ erro: 'Esse tipo de atendimento ainda não tem cobrança pelo app configurada.' });
    }

    // ✅ O preço vem SEMPRE do que o profissional declarou (nunca do
    // que o app mandar) — evita que alguém manipule o valor cobrado
    // interceptando a chamada do próprio celular.
    const precoResult = await pool.query(
      'SELECT preco FROM precos_servicos WHERE usuario_id = $1 AND servico_id = $2',
      [consulta.medico_id, servicoId]
    );
    if (precoResult.rows.length === 0) {
      return res.status(400).json({ erro: 'Esse profissional ainda não definiu o preço desse serviço.' });
    }
    const valorTotal = parseFloat(precoResult.rows[0].preco);
    const taxaPlataforma = Math.round(valorTotal * PERCENTUAL_TAXA * 100) / 100;

    // ✅ NOVO: a cobrança só "chega de verdade" pro profissional depois
    // que ele aceita a solicitação. A ÚNICA exceção é o Pix: como o
    // estorno de Pix é praticamente instantâneo (ao contrário de
    // cartão, que pode levar dias e ainda corre risco de contestação),
    // deixamos o tutor pagar por Pix ANTES da confirmação — e
    // devolvemos na hora se o profissional recusar depois
    // (ver estornarSeNecessario, chamada em consultasController.js).
    const jaAceita = consulta.status === 'aceito';
    const corpoPreferencia = {
      items: [{
        title: `Consulta ${consulta.especialidade || ''} — H.U.B. Pet`.trim(),
        quantity: 1,
        unit_price: valorTotal,
        currency_id: 'BRL',
      }],
      marketplace_fee: taxaPlataforma,
      external_reference: String(consulta.id),
      notification_url: `${BACKEND_URL}/pagamento-mp/webhook`,
      back_urls: {
        success: `${BACKEND_URL}/pagamento-mp/retorno?status=success`,
        pending: `${BACKEND_URL}/pagamento-mp/retorno?status=pending`,
        failure: `${BACKEND_URL}/pagamento-mp/retorno?status=failure`,
      },
      auto_return: 'approved',
    };
    if (!jaAceita) {
      // Só Pix disponível — cartão e boleto ficam de fora até aceitar,
      // já que os dois têm estorno lento/incerto se o pedido for recusado.
      corpoPreferencia.payment_methods = {
        excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'atm' }],
      };
    }

    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medico.mp_access_token}`,
      },
      body: JSON.stringify(corpoPreferencia),
    });
    const preferencia = await resp.json();

    if (!resp.ok || !preferencia.init_point) {
      console.error('Erro criando preferência no MP:', preferencia);
      return res.status(400).json({ erro: 'Não foi possível gerar a cobrança agora.' });
    }

    await pool.query(
      `INSERT INTO pagamentos_mp (consulta_id, medico_id, paciente_id, mp_preference_id, valor_total, taxa_plataforma, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente')`,
      [consulta.id, consulta.medico_id, paciente_id, preferencia.id, valorTotal, taxaPlataforma]
    );

    res.json({ url: preferencia.init_point, valor_total: valorTotal });
  } catch (err) {
    console.error('Erro criarPreferencia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Cria a cobrança de uma solicitação de farmácia (receita com
// orçamento já definido) ──────────────────────────────────────────
// ✅ Diferente de consulta, aqui não existe distinção "Pix antes,
// cartão depois": só chega a existir uma cobrança DEPOIS que a
// farmácia já definiu o orçamento (o equivalente ao "aceite" — sem
// isso nem hácomo saber o valor). A partir daí, qualquer método já é
// seguro. Se a farmácia cancelar depois de já paga, estorna
// automaticamente (ver estornarSeNecessarioFarmacia, chamado em
// solicitacoesFarmaciaController2.js).
exports.criarPreferenciaFarmacia = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const { solicitacao_id } = req.body;
    if (!solicitacao_id) return res.status(400).json({ erro: 'Informe a solicitação' });

    const solicitacaoResult = await pool.query(
      `SELECT id, farmacia_id, paciente_nome, orcamento_valor, status
       FROM solicitacoes_farmacia WHERE id = $1 AND paciente_id = $2`,
      [solicitacao_id, paciente_id]
    );
    if (solicitacaoResult.rows.length === 0) return res.status(404).json({ erro: 'Solicitação não encontrada' });
    const solicitacao = solicitacaoResult.rows[0];

    if (solicitacao.status === 'cancelada') {
      return res.status(400).json({ erro: 'Essa solicitação foi cancelada.' });
    }
    if (!solicitacao.farmacia_id) {
      return res.status(400).json({ erro: 'Escolha uma farmácia ou petshop antes de pagar.' });
    }
    if (solicitacao.orcamento_valor === null) {
      return res.status(400).json({ erro: 'Aguarde a farmácia definir o orçamento antes de pagar.' });
    }

    const medicoResult = await pool.query(
      'SELECT mp_access_token, mp_conectado FROM medicos WHERE usuario_id = $1',
      [solicitacao.farmacia_id]
    );
    const medico = medicoResult.rows[0];
    if (!medico?.mp_conectado || !medico?.mp_access_token) {
      return res.status(400).json({ erro: 'Essa farmácia ainda não ativou o recebimento de pagamentos.' });
    }
    try {
      medico.mp_access_token = decifrar(medico.mp_access_token);
    } catch (e) {
      console.error('Falha ao decifrar token da farmácia', solicitacao.farmacia_id, '— verifique MP_TOKEN_ENCRYPTION_KEY:', e.message);
      return res.status(500).json({ erro: 'Erro interno do servidor' });
    }

    const valorTotal = parseFloat(solicitacao.orcamento_valor);
    const taxaPlataforma = Math.round(valorTotal * PERCENTUAL_TAXA * 100) / 100;

    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${medico.mp_access_token}`,
      },
      body: JSON.stringify({
        items: [{
          title: `Manipulação — ${solicitacao.paciente_nome} — H.U.B. Pet`,
          quantity: 1,
          unit_price: valorTotal,
          currency_id: 'BRL',
        }],
        marketplace_fee: taxaPlataforma,
        external_reference: `farmacia-${solicitacao.id}`,
        notification_url: `${BACKEND_URL}/pagamento-mp/webhook`,
        back_urls: {
          success: `${BACKEND_URL}/pagamento-mp/retorno?status=success`,
          pending: `${BACKEND_URL}/pagamento-mp/retorno?status=pending`,
          failure: `${BACKEND_URL}/pagamento-mp/retorno?status=failure`,
        },
        auto_return: 'approved',
      }),
    });
    const preferencia = await resp.json();

    if (!resp.ok || !preferencia.init_point) {
      console.error('Erro criando preferência (farmácia) no MP:', preferencia);
      return res.status(400).json({ erro: 'Não foi possível gerar a cobrança agora.' });
    }

    await pool.query(
      `INSERT INTO pagamentos_mp (solicitacao_farmacia_id, medico_id, paciente_id, mp_preference_id, valor_total, taxa_plataforma, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente')`,
      [solicitacao.id, solicitacao.farmacia_id, paciente_id, preferencia.id, valorTotal, taxaPlataforma]
    );

    res.json({ url: preferencia.init_point, valor_total: valorTotal });
  } catch (err) {
    console.error('Erro criarPreferenciaFarmacia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Página simples de retorno (o tutor cai aqui depois de pagar) ──
exports.retorno = (req, res) => {
  const { status } = req.query;
  const mapa = {
    success: { emoji: '✅', titulo: 'Pagamento aprovado!', texto: 'Sua consulta já está confirmada.' },
    pending: { emoji: '⏳', titulo: 'Pagamento em análise', texto: 'Assim que for aprovado, você recebe a confirmação.' },
    failure: { emoji: '⚠️', titulo: 'Pagamento não concluído', texto: 'Tente novamente pelo app.' },
  };
  const m = mapa[status] || mapa.pending;
  res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>H.U.B. Pet</title>
<style>body{font-family:Arial,sans-serif;background:#0d2a3e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
.box{background:#fff;color:#0d2a3e;border-radius:20px;padding:30px;max-width:340px}</style></head>
<body><div class="box"><div style="font-size:44px">${m.emoji}</div>
<h2>${m.titulo}</h2><p>${m.texto}</p>
<p style="color:#7aaabb;font-size:13px">Pode fechar esta tela e voltar pro app.</p></div></body></html>`);
};

// ── Webhook: o Mercado Pago avisa aqui quando o status do pagamento muda ──
// ✅ Exportada pra ser reaproveitada em qualquer outro webhook da
// Mercado Pago (ex: assinaturaProController.js) — o mesmo algoritmo
// de assinatura vale pra qualquer tópico, não só pagamento avulso.
exports.validarAssinaturaWebhook = validarAssinaturaWebhook;
function validarAssinaturaWebhook(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const assinatura = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const dataId = req.query['data.id'] || req.query.id;
  if (!secret || !assinatura || !dataId) return false;

  const partes = Object.fromEntries(
    assinatura.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  // Manifesto exatamente no formato documentado pelo Mercado Pago —
  // omite o segmento "request-id:" inteiro se o header não vier.
  const manifesto = `id:${dataId};${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
  const esperado = crypto.createHmac('sha256', secret).update(manifesto).digest('hex');

  const bufA = Buffer.from(v1);
  const bufB = Buffer.from(esperado);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

exports.webhook = async (req, res) => {
  try {
    // Responde rápido — a Mercado Pago espera 200/201 em até 22s.
    res.sendStatus(200);

    if (!validarAssinaturaWebhook(req)) {
      console.error('Webhook do Mercado Pago com assinatura inválida — ignorado.');
      return;
    }

    const tipo = req.query.type || req.body?.type;
    if (tipo !== 'payment') return;

    const paymentId = req.query['data.id'] || req.body?.data?.id;
    if (!paymentId) return;

    // Busca a linha pendente correspondente — precisamos saber QUAL
    // profissional pra usar o access_token certo na consulta à API.
    const pendente = await pool.query(
      `SELECT pm.*, m.mp_access_token FROM pagamentos_mp pm
       JOIN medicos m ON m.usuario_id = pm.medico_id
       WHERE pm.mp_payment_id IS NULL AND pm.status = 'pendente'
       ORDER BY pm.criado_em DESC LIMIT 50`
    );

    // Consulta o pagamento de verdade na API (nunca confia só no
    // webhook) — tenta com o token de cada profissional com cobrança
    // pendente recente até achar o dono desse payment_id.
    let pagamentoMp = null, linhaCorrespondente = null;
    for (const linha of pendente.rows) {
      let tokenDecifrado;
      try {
        tokenDecifrado = decifrar(linha.mp_access_token);
      } catch (e) {
        console.error('Falha ao decifrar token do medico', linha.medico_id, '— pulando essa linha:', e.message);
        continue;
      }
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${tokenDecifrado}` },
      });
      if (r.ok) { pagamentoMp = await r.json(); linhaCorrespondente = linha; break; }
    }
    if (!pagamentoMp) {
      console.error('Webhook: payment_id não correspondeu a nenhuma cobrança pendente conhecida:', paymentId);
      return;
    }

    const statusMap = { approved: 'aprovado', rejected: 'recusado', refunded: 'estornado', cancelled: 'recusado' };
    const novoStatus = statusMap[pagamentoMp.status] || 'pendente';

    await pool.query(
      `UPDATE pagamentos_mp SET mp_payment_id = $1, status = $2, atualizado_em = NOW() WHERE id = $3`,
      [String(paymentId), novoStatus, linhaCorrespondente.id]
    );
  } catch (err) {
    console.error('Erro webhook Mercado Pago:', err.message);
  }
};

// ── Estorna automaticamente se o prestador recusar uma consulta já
// paga via Pix. Chamada por consultasController.js — "melhor
// esforço": se o estorno falhar, registra no log pra investigar
// manualmente, mas nunca impede o prestador de recusar a consulta.
// Função interna, reaproveitada tanto por consulta quanto por
// farmácia — a lógica de estorno em si é idêntica, só muda qual
// coluna identifica o pagamento.
async function _estornarPorColuna(coluna, id, chaveIdempotencia, descricao) {
  try {
    const pagamento = await pool.query(
      `SELECT pm.*, m.mp_access_token FROM pagamentos_mp pm
       JOIN medicos m ON m.usuario_id = pm.medico_id
       WHERE pm.${coluna} = $1 AND pm.status = 'aprovado' LIMIT 1`,
      [id]
    );
    if (pagamento.rows.length === 0) return; // nunca foi pago, nada a estornar

    const p = pagamento.rows[0];
    p.mp_access_token = decifrar(p.mp_access_token); // já está dentro do try/catch da função toda
    // ✅ Header específico pra Pix: sem ele, um reembolso que fica
    // temporariamente "em contingência" (comunicação com o Bacen)
    // volta como erro 400 genérico. Com ele, vem 201 + status
    // "in_process" — não é falha, é só ainda estar processando.
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${p.mp_payment_id}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.mp_access_token}`,
        'X-Render-In-Process-Refunds': 'true',
        'X-Idempotency-Key': chaveIdempotencia,
      },
    });
    if (!r.ok) {
      const erro = await r.text();
      console.error(`FALHA AO ESTORNAR pagamento ${p.mp_payment_id} (${descricao}) — requer ação manual:`, erro);
      return;
    }
    const resultado = await r.json();
    const novoStatus = resultado.status === 'in_process' ? 'estornando' : 'estornado';
    await pool.query(`UPDATE pagamentos_mp SET status = $1, atualizado_em = NOW() WHERE id = $2`, [novoStatus, p.id]);
  } catch (err) {
    console.error(`Erro ao tentar estornar ${descricao} — requer ação manual:`, err.message);
  }
}

exports.estornarSeNecessario = (consulta_id) =>
  _estornarPorColuna('consulta_id', consulta_id, `estorno-consulta-${consulta_id}`, `consulta ${consulta_id}`);

// ✅ NOVO: mesma lógica, pra quando a farmácia cancela uma solicitação
// que já tinha sido paga (chamado em solicitacoesFarmaciaController2.js).
exports.estornarSeNecessarioFarmacia = (solicitacao_id) =>
  _estornarPorColuna('solicitacao_farmacia_id', solicitacao_id, `estorno-farmacia-${solicitacao_id}`, `solicitação de farmácia ${solicitacao_id}`);

// ── O app consulta isso pra saber se a consulta já foi paga ───────
exports.statusPagamento = async (req, res) => {
  try {
    const { consulta_id } = req.params;
    const result = await pool.query(
      'SELECT status, valor_total FROM pagamentos_mp WHERE consulta_id = $1 ORDER BY criado_em DESC LIMIT 1',
      [consulta_id]
    );
    if (result.rows.length === 0) return res.json({ status: 'sem_cobranca' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro statusPagamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.statusPagamentoFarmacia = async (req, res) => {
  try {
    const { solicitacao_id } = req.params;
    const result = await pool.query(
      'SELECT status, valor_total FROM pagamentos_mp WHERE solicitacao_farmacia_id = $1 ORDER BY criado_em DESC LIMIT 1',
      [solicitacao_id]
    );
    if (result.rows.length === 0) return res.json({ status: 'sem_cobranca' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro statusPagamentoFarmacia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};