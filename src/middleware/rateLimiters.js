const rateLimit = require('express-rate-limit');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Limite de tentativas por IP, em cima do bloqueio por
// conta (authController.js). Os dois se complementam: o bloqueio por
// conta impede força bruta contra UMA conta específica vinda de
// vários IPs; o limite por IP impede alguém testando MUITAS contas
// diferentes rápido do mesmo lugar (credential stuffing).
// ═══════════════════════════════════════════════════════════════

// Login de usuário comum — um pouco mais permissivo, já que redes
// compartilhadas (wifi de petshop, clínica) podem ter várias pessoas
// logando do mesmo IP.
const limitarLoginUsuario = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente de novo em alguns minutos.' },
});

// Login de admin — só existe UMA conta admin no sistema inteiro, não
// tem motivo pra vir de muitos IPs diferentes nem com tanta
// frequência. Limite bem mais restrito.
const limitarLoginAdmin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente de novo em alguns minutos.' },
});

// Mesma lógica do login comum, aplicada à solicitação de código de
// recuperação de senha — evita que alguém martele esse endpoint pra
// gastar a cota de e-mails do Resend ou tentar enumerar contas por
// tempo de resposta.
const limitarRecuperacaoSenha = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente de novo em alguns minutos.' },
});

// ✅ NOVO: achado na revisão final — os 5 endpoints de cadastro não
// tinham limite nenhum, abrindo brecha pra criação de contas em
// massa (spam, fraude). Um pouco mais permissivo que login, já que
// cadastro é uma ação legítima menos frequente por pessoa.
const limitarCadastro = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de cadastro. Tente de novo mais tarde.' },
});

module.exports = { limitarLoginUsuario, limitarLoginAdmin, limitarRecuperacaoSenha, limitarCadastro };