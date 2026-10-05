const pool = require('../database');
const crypto = require('crypto');
// ✅ NOVO: o access_token do profissional nunca é salvo em texto
// puro — se o banco vazar, sem essa chave (que vive só nas
// variáveis de ambiente, nunca no banco) o token não serve pra nada.
const { cifrar } = require('../utils/cryptoUtil');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Conexão OAuth com Mercado Pago.
// Fluxo: profissional abre a URL de autorização -> loga na própria
// conta MP -> MP redireciona pro NOSSO backend com um "code" -> a
// gente troca esse code por um access_token (válido ~6 meses) e
// guarda, associado ao profissional certo.
// ═══════════════════════════════════════════════════════════════

const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
const MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET;
// URL pública do backend (sem barra no final) — usada como redirect_uri.
const BACKEND_URL = process.env.BACKEND_URL || 'https://hub-pet-backend-production.up.railway.app';
const REDIRECT_URI = `${BACKEND_URL}/mercadopago/callback`;

// ✅ O "state" precisa dizer pra gente QUEM (qual medico_id) iniciou a
// conexão quando o Mercado Pago redirecionar de volta — sem precisar
// de uma tabela extra só pra isso, assinamos o medico_id com HMAC.
// Se alguém tentar forjar um state pra sequestrar a conexão de outro
// profissional, a assinatura não bate e a gente rejeita.
function assinarState(medico_id) {
  const secret = process.env.MP_STATE_SECRET;
  if (!secret) throw new Error('MP_STATE_SECRET não configurado');
  const assinatura = crypto.createHmac('sha256', secret).update(String(medico_id)).digest('hex');
  return `${medico_id}.${assinatura}`;
}

function validarState(state) {
  const secret = process.env.MP_STATE_SECRET;
  if (!secret || !state || !state.includes('.')) return null;
  const [medico_id, assinatura] = state.split('.');
  const esperado = crypto.createHmac('sha256', secret).update(String(medico_id)).digest('hex');
  // comparação em tempo constante — evita vazar a assinatura certa por
  // diferença de tempo de resposta (timing attack)
  const bufA = Buffer.from(assinatura || '');
  const bufB = Buffer.from(esperado);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
  return Number(medico_id);
}

// ── 1) Gera o link de autorização pro profissional abrir ─────────
exports.iniciarConexao = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    if (!MP_CLIENT_ID) return res.status(500).json({ erro: 'Mercado Pago não configurado no servidor' });

    const state = assinarState(medico_id);
    const url = `https://auth.mercadopago.com/authorization`
      + `?client_id=${encodeURIComponent(MP_CLIENT_ID)}`
      + `&response_type=code`
      + `&platform_id=mp`
      + `&state=${encodeURIComponent(state)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    res.json({ url });
  } catch (err) {
    console.error('Erro iniciarConexao:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── 2) O Mercado Pago chama esta rota depois do profissional autorizar ──
// ✅ Sem middleware de auth — quem "autentica" essa chamada é o
// próprio Mercado Pago, e nós validamos com o state assinado.
exports.callbackConexao = async (req, res) => {
  const paginaResultado = (sucesso, mensagem) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>H.U.B. Pet</title>
<style>body{font-family:Arial,sans-serif;background:#0d2a3e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
.box{background:#fff;color:#0d2a3e;border-radius:20px;padding:30px;max-width:340px}</style></head>
<body><div class="box"><div style="font-size:44px">${sucesso ? '✅' : '⚠️'}</div>
<h2>${sucesso ? 'Conta conectada!' : 'Não foi possível conectar'}</h2>
<p>${mensagem}</p><p style="color:#7aaabb;font-size:13px">Pode fechar esta tela e voltar pro app.</p></div></body></html>`;

  try {
    const { code, state } = req.query;
    const medico_id = validarState(state);
    if (!medico_id) {
      return res.status(400).send(paginaResultado(false, 'Link de conexão inválido ou expirado.'));
    }
    if (!code) {
      return res.status(400).send(paginaResultado(false, 'A autorização foi cancelada.'));
    }

    const resp = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: MP_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });
    const dados = await resp.json();

    if (!resp.ok || !dados.access_token) {
      console.error('Erro trocando code por token no MP:', dados);
      return res.status(400).send(paginaResultado(false, 'O Mercado Pago recusou a autorização. Tente novamente.'));
    }

    const expiraEm = new Date(Date.now() + (dados.expires_in || 15552000) * 1000);
    await pool.query(
      `UPDATE medicos SET
        mp_user_id = $1, mp_access_token = $2, mp_refresh_token = $3,
        mp_token_expira_em = $4, mp_conectado = true
       WHERE usuario_id = $5`,
      [dados.user_id, cifrar(dados.access_token), cifrar(dados.refresh_token), expiraEm, medico_id]
    );

    res.send(paginaResultado(true, 'Agora você já pode receber pagamentos direto no app.'));
  } catch (err) {
    console.error('Erro callbackConexao:', err.message);
    res.status(500).send(paginaResultado(false, 'Erro interno. Tente novamente mais tarde.'));
  }
};

// ── 3) A tela do profissional consulta isso pra saber se já conectou ──
exports.statusConexao = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const result = await pool.query('SELECT mp_conectado FROM medicos WHERE usuario_id = $1', [medico_id]);
    res.json({ conectado: !!result.rows[0]?.mp_conectado });
  } catch (err) {
    console.error('Erro statusConexao:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.desconectar = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    await pool.query(
      `UPDATE medicos SET mp_conectado = false, mp_access_token = NULL, mp_refresh_token = NULL, mp_user_id = NULL
       WHERE usuario_id = $1`,
      [medico_id]
    );
    res.json({ mensagem: 'Desconectado' });
  } catch (err) {
    console.error('Erro desconectar:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};