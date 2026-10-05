const pool = require('../database');
// ✅ CORRIGIDO: esse webhook não validava a assinatura do Mercado
// Pago — qualquer um podia mandar um POST fingindo ser a MP. O
// impacto era limitado (a reconsulta na API real não pode ser
// forjada), mas ainda assim deixava a porta aberta pra alguém forçar
// reconsultas de assinaturas alheias fora de hora. Reaproveita a
// mesma validação já usada no webhook de pagamento avulso.
const { validarAssinaturaWebhook } = require('./pagamentoMpController');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Assinatura Pro recorrente (R$ 29,90/mês).
//
// Diferente da cobrança de consulta/farmácia (que usa a conta do
// PROFISSIONAL, com split), aqui o dinheiro vai pra conta da própria
// PLATAFORMA — o profissional está pagando o H.U.B. Pet, não tem
// nenhum "repasse" envolvido. Por isso usamos o token da própria
// plataforma (MP_PLATFORM_ACCESS_TOKEN), nunca o do profissional.
//
// Usa o produto "Assinaturas" (Preapproval) da Mercado Pago — cobra
// automaticamente todo mês, sem o profissional precisar voltar no
// app pra pagar de novo.
// ═══════════════════════════════════════════════════════════════

const MP_PLATFORM_TOKEN = process.env.MP_PLATFORM_ACCESS_TOKEN;
const MP_PREAPPROVAL_PLAN_ID = process.env.MP_PREAPPROVAL_PLAN_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://hub-pet-backend-production.up.railway.app';

// ── Profissional inicia a assinatura ──────────────────────────────
exports.iniciarAssinatura = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    if (!MP_PLATFORM_TOKEN || !MP_PREAPPROVAL_PLAN_ID) {
      return res.status(500).json({ erro: 'Assinatura Pro não configurada no servidor' });
    }

    const usuarioResult = await pool.query('SELECT email, nome FROM usuarios WHERE id = $1', [usuario_id]);
    const usuario = usuarioResult.rows[0];
    if (!usuario?.email) return res.status(400).json({ erro: 'Cadastre um e-mail antes de assinar' });

    // Já tem assinatura ativa? Não deixa duplicar.
    const existente = await pool.query("SELECT plano, status FROM assinaturas WHERE usuario_id = $1", [usuario_id]);
    if (existente.rows[0]?.plano === 'pro' && existente.rows[0]?.status === 'ativa') {
      return res.status(400).json({ erro: 'Você já é assinante Pro.' });
    }

    // ✅ CORRIGIDO: a documentação do Mercado Pago avisa que a
    // configuração central de webhooks (painel → Suas integrações)
    // não cobre Assinaturas de forma completa — recomenda mandar a
    // notification_url diretamente na criação do preapproval. Sem
    // isso, as notificações de autorização/cobrança da assinatura
    // podiam não chegar de jeito nenhum.
    const resp = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_PLATFORM_TOKEN}` },
      body: JSON.stringify({
        preapproval_plan_id: MP_PREAPPROVAL_PLAN_ID,
        payer_email: usuario.email,
        external_reference: String(usuario_id),
        back_url: `${BACKEND_URL}/pagamento-mp/retorno?status=success`,
        notification_url: `${BACKEND_URL}/assinatura-pro/webhook`,
      }),
    });
    const preapproval = await resp.json();

    if (!resp.ok || !preapproval.init_point) {
      console.error('Erro criando preapproval:', preapproval);
      return res.status(400).json({ erro: 'Não foi possível iniciar a assinatura agora.' });
    }

    // ✅ Salva o vínculo AGORA (status ainda 'ativa'/plano 'gratis' —
    // só vira 'pro' de verdade quando o webhook confirmar a
    // autorização; nunca confiamos no retorno do navegador sozinho).
    await pool.query(
      `INSERT INTO assinaturas (usuario_id, plano, status, metodo_pagamento, mp_subscription_id)
       VALUES ($1, 'gratis', 'ativa', 'cartao', $2)
       ON CONFLICT (usuario_id) DO UPDATE SET mp_subscription_id = $2, metodo_pagamento = 'cartao'`,
      [usuario_id, preapproval.id]
    );

    res.json({ url: preapproval.init_point });
  } catch (err) {
    console.error('Erro iniciarAssinatura:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Webhook: Mercado Pago avisa sobre autorização e cada cobrança ──
// ✅ IMPORTANTE: em produção, o Mercado Pago manda o "type" COM o
// prefixo "subscription_" (subscription_preapproval,
// subscription_authorized_payment), mesmo a documentação de
// configuração de tópicos listando os nomes sem prefixo. Um
// integrador real caiu nesse exato problema — o webhook nunca
// processava nada porque só reconhecia o nome sem prefixo. Aceitamos
// os dois formatos aqui de propósito.
exports.webhook = async (req, res) => {
  try {
    res.sendStatus(200); // responde rápido, processa depois

    if (!validarAssinaturaWebhook(req)) {
      console.error('Webhook de assinatura Pro com assinatura inválida — ignorado.');
      return;
    }

    const tipoBruto = req.query.type || req.body?.type || '';
    const tipo = tipoBruto.replace(/^subscription_/, '');
    const id = req.query['data.id'] || req.body?.data?.id;
    if (!id) return;

    if (tipo === 'preapproval') {
      await processarPreapproval(id);
    } else if (tipo === 'authorized_payment') {
      await processarPagamentoAutorizado(id);
    }
    // outros tópicos (payments avulsos, etc.) não dizem respeito à
    // assinatura Pro — ignorados aqui de propósito.
  } catch (err) {
    console.error('Erro webhook assinatura Pro:', err.message);
  }
};

async function processarPreapproval(preapproval_id) {
  const r = await fetch(`https://api.mercadopago.com/preapproval/${preapproval_id}`, {
    headers: { Authorization: `Bearer ${MP_PLATFORM_TOKEN}` },
  });
  if (!r.ok) { console.error('Erro consultando preapproval:', await r.text()); return; }
  const dados = await r.json();

  const usuario_id = Number(dados.external_reference);
  if (!usuario_id) return;

  const statusMap = { authorized: 'ativa', paused: 'suspensa', cancelled: 'cancelada', pending: 'ativa' };
  const novoStatus = statusMap[dados.status] || 'ativa';
  // Só vira Pro de verdade quando a MP confirma "authorized" — antes
  // disso (pending) continua no grátis, mesmo já tendo iniciado o
  // processo.
  const novoPlano = dados.status === 'authorized' ? 'pro' : (dados.status === 'cancelled' ? 'gratis' : undefined);

  await pool.query(
    `UPDATE assinaturas SET
       status = $1,
       plano = COALESCE($2, plano),
       mp_subscription_id = $3,
       atualizado_em = NOW()
     WHERE usuario_id = $4`,
    [novoStatus, novoPlano, preapproval_id, usuario_id]
  );
}

async function processarPagamentoAutorizado(payment_id) {
  const r = await fetch(`https://api.mercadopago.com/authorized_payments/${payment_id}`, {
    headers: { Authorization: `Bearer ${MP_PLATFORM_TOKEN}` },
  });
  if (!r.ok) { console.error('Erro consultando authorized_payment:', await r.text()); return; }
  const pagamento = await r.json();

  const assinatura = await pool.query(
    'SELECT usuario_id, tentativas_falha FROM assinaturas WHERE mp_subscription_id = $1',
    [pagamento.preapproval_id]
  );
  if (assinatura.rows.length === 0) return;
  const { usuario_id, tentativas_falha } = assinatura.rows[0];

  if (pagamento.status === 'approved' || pagamento.status === 'processed') {
    const proximaCobranca = new Date();
    proximaCobranca.setMonth(proximaCobranca.getMonth() + 1);
    await pool.query(
      `UPDATE assinaturas SET status = 'ativa', plano = 'pro', tentativas_falha = 0,
         proxima_cobranca = $1, atualizado_em = NOW() WHERE usuario_id = $2`,
      [proximaCobranca, usuario_id]
    );
  } else {
    // ✅ Cobrança falhou (cartão recusado, sem limite, etc.) — depois
    // de 3 tentativas seguidas, marca como inadimplente. A Mercado
    // Pago já tenta de novo automaticamente antes disso.
    const novasTentativas = (tentativas_falha || 0) + 1;
    const novoStatus = novasTentativas >= 3 ? 'inadimplente' : 'ativa';
    await pool.query(
      `UPDATE assinaturas SET tentativas_falha = $1, status = $2, atualizado_em = NOW() WHERE usuario_id = $3`,
      [novasTentativas, novoStatus, usuario_id]
    );
  }
}

// ── Tela do profissional consulta isso pra saber o status ─────────
exports.statusAssinatura = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT plano, status, proxima_cobranca, tentativas_falha FROM assinaturas WHERE usuario_id = $1',
      [usuario_id]
    );
    if (result.rows.length === 0) return res.json({ plano: 'gratis', status: 'ativa' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro statusAssinatura:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Profissional cancela a própria assinatura ─────────────────────
exports.cancelarAssinatura = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query('SELECT mp_subscription_id FROM assinaturas WHERE usuario_id = $1', [usuario_id]);
    const mpId = result.rows[0]?.mp_subscription_id;
    if (!mpId) return res.status(404).json({ erro: 'Nenhuma assinatura encontrada' });

    const r = await fetch(`https://api.mercadopago.com/preapproval/${mpId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MP_PLATFORM_TOKEN}` },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (!r.ok) {
      console.error('Erro cancelando preapproval:', await r.text());
      return res.status(400).json({ erro: 'Não foi possível cancelar agora. Tente de novo.' });
    }

    await pool.query(
      `UPDATE assinaturas SET status = 'cancelada', plano = 'gratis', atualizado_em = NOW() WHERE usuario_id = $1`,
      [usuario_id]
    );
    res.json({ mensagem: 'Assinatura cancelada.' });
  } catch (err) {
    console.error('Erro cancelarAssinatura:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};