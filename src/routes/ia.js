const express   = require('express');
const rateLimit = require('express-rate-limit');
const auth      = require('../middleware/auth');
const controller = require('../controllers/iaController');

const router = express.Router();

// Limite por USUÁRIO (não por IP): protege a cota do Gemini.
const limitarIA = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_LIMITE_POR_HORA) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ia-${req.usuario?.id || 'anon'}`,
  validate: { keyGeneratorIpFallback: false },
  message: { erro: 'Você usou muito o assistente agora há pouco. Tente de novo em alguns minutos.' },
});

router.post('/gerar', auth, limitarIA, controller.gerar);

module.exports = router;