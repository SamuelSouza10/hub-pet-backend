const pool = require('../database');

// ✅ Helper de push notification — mesmo padrão já usado em
// consultasController.js e solicitacoesFarmaciaController.js.
async function enviarPush(pushToken, titulo, corpo) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title: titulo, body: corpo, sound: 'default', priority: 'high' }),
    });
  } catch (e) {
    console.error('Erro enviarPush lembrete banho:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: verifica todos os pets com banho "vencido" (passou do
// intervalo que o petshop configurou) e manda lembrete pro tutor.
//
// Chamada por um cron job diário (node-cron, configurado no index.js)
// — não é uma rota que o app chama diretamente.
//
// Travas contra spam:
// - Só considera fichas de tipo_servico contendo "banho"
// - Só petshop/serviço no plano Pro (é ferramenta paga)
// - Nunca manda duas vezes pro mesmo atendimento (lembretes_banho_enviados)
// - Nunca manda se o pet já tem retorno mais recente marcado com esse
//   mesmo petshop (ele já vai voltar, não precisa empurrar)
// ═══════════════════════════════════════════════════════════════
exports.verificarEEnviarLembretes = async () => {
  try {
    const result = await pool.query(`
      SELECT f.id AS ficha_id, c.perfil_id, c.nome_perfil, u_tutor.push_token,
             u_petshop.nome AS petshop_nome
      FROM fichas_atendimento f
      JOIN consultas c        ON c.id = f.consulta_id
      JOIN medicos m          ON m.usuario_id = c.medico_id
      JOIN usuarios u_petshop ON u_petshop.id = c.medico_id
      JOIN usuarios u_tutor   ON u_tutor.id = c.paciente_id
      JOIN assinaturas a      ON a.usuario_id = c.medico_id
      WHERE f.tipo_servico ILIKE '%banho%'
        AND m.tipo_conta IN ('petshop', 'servico')
        AND a.plano = 'pro' AND a.status = 'ativa'
        AND TO_DATE(c.data, 'DD/MM/YYYY') + (m.intervalo_lembrete_dias || ' days')::INTERVAL <= NOW()
        AND NOT EXISTS (SELECT 1 FROM lembretes_banho_enviados l WHERE l.ficha_id = f.id)
        AND NOT EXISTS (
          SELECT 1 FROM consultas c2
          WHERE c2.perfil_id = c.perfil_id AND c2.medico_id = c.medico_id
            AND TO_DATE(c2.data, 'DD/MM/YYYY') > TO_DATE(c.data, 'DD/MM/YYYY')
        )
    `);

    let enviados = 0;
    for (const row of result.rows) {
      await enviarPush(
        row.push_token,
        '🛁 Hora do banho!',
        `${row.nome_perfil} já não vai no ${row.petshop_nome} há um tempo. Que tal agendar de novo?`
      );
      await pool.query('INSERT INTO lembretes_banho_enviados (ficha_id) VALUES ($1) ON CONFLICT DO NOTHING', [row.ficha_id]);
      enviados++;
    }
    console.log(`[lembrete-banho] ${enviados} lembrete(s) enviado(s)`);
    return enviados;
  } catch (err) {
    console.error('Erro verificarEEnviarLembretes:', err.message);
    return 0;
  }
};

// ── Rota de teste manual (chama a mesma função do cron, sob demanda) ─
// ✅ Protegida por uma chave simples — não é rota pública, é só pra
// testar sem esperar o cron rodar de madrugada.
exports.testarManualmente = async (req, res) => {
  const chave = req.headers['x-cron-secret'];
  if (chave !== (process.env.CRON_SECRET || 'hub_cron_secret_2025'))
    return res.status(401).json({ erro: 'Não autorizado' });

  const enviados = await exports.verificarEEnviarLembretes();
  res.json({ mensagem: `${enviados} lembrete(s) enviado(s)` });
};

// ── Petshop configura o intervalo de lembrete ────────────────────
exports.salvarIntervalo = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { intervalo_lembrete_dias } = req.body;
    const dias = parseInt(intervalo_lembrete_dias, 10);
    if (!dias || dias < 1 || dias > 365)
      return res.status(400).json({ erro: 'Informe um número de dias entre 1 e 365' });

    await pool.query('UPDATE medicos SET intervalo_lembrete_dias = $1 WHERE usuario_id = $2', [dias, usuario_id]);
    res.json({ mensagem: 'Intervalo atualizado', intervalo_lembrete_dias: dias });
  } catch (err) {
    console.error('Erro salvarIntervalo:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};