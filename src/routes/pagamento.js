const express = require('express');
const router  = express.Router();
const controller = require('../controllers/servicoPagamentoController');
const auth    = require('../middleware/auth');

router.get('/meu-plano',  auth, controller.meuPlano);
router.get('/precos',     auth, controller.listarPrecos);
router.post('/precos',    auth, controller.salvarPreco);
router.get('/fechamento', auth, controller.fechamentoMes);
// ✅ NOVO: pública, sem auth — pro tutor ver o preço antes de agendar
router.get('/precos-publico/:medico_id', controller.listarPrecosPublico);

module.exports = router;