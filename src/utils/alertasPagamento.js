const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// Alertas de pagamento que precisam de uma pessoa (aparecem no painel
// /admin, aba "Pagamentos"). Antes essas situações só ficavam no log do
// Railway, com a frase "requer ação manual", e ninguém era avisado.
// ═══════════════════════════════════════════════════════════════

// Abre o alerta. Se já existe um ABERTO pro mesmo caso (mesma "chave"),
// não duplica: só soma a tentativa e atualiza o detalhe.
// Nunca lança erro — registrar alerta não pode derrubar o fluxo de pagamento.
async function registrarAlerta({
  tipo, chave, consulta_id = null, solicitacao_farmacia_id = null, pagamento_mp_id = null,
  mp_payment_id = null, medico_id = null, valor = null, detalhe = '',
}) {
  try {
    await pool.query(
      `INSERT INTO alertas_pagamento
         (tipo, chave, consulta_id, solicitacao_farmacia_id, pagamento_mp_id, mp_payment_id, medico_id, valor, detalhe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (chave) WHERE resolvido = false
       DO UPDATE SET tentativas = alertas_pagamento.tentativas + 1,
                     detalhe = EXCLUDED.detalhe, atualizado_em = NOW()`,
      [tipo, chave, consulta_id, solicitacao_farmacia_id, pagamento_mp_id, mp_payment_id, medico_id, valor, String(detalhe).slice(0, 500)]
    );
  } catch (e) {
    console.error('Não foi possível registrar o alerta de pagamento:', e.message);
  }
}

// Fecha os alertas abertos dessas chaves (quando o problema se resolveu sozinho).
async function resolverAlertas(chaves) {
  try {
    await pool.query(
      `UPDATE alertas_pagamento SET resolvido = true, resolvido_em = NOW(), atualizado_em = NOW()
       WHERE resolvido = false AND chave = ANY($1::text[])`,
      [chaves]
    );
  } catch (e) {
    console.error('Não foi possível resolver o alerta de pagamento:', e.message);
  }
}

module.exports = { registrarAlerta, resolverAlertas };