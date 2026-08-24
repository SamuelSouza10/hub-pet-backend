const express = require('express');
const router  = express.Router();
const controller = require('../controllers/servicoPagamentoController');
const auth    = require('../middleware/auth');

router.get('/meu-plano',  auth, controller.meuPlano);
router.get('/precos',     auth, controller.listarPrecos);
router.post('/precos',    auth, controller.salvarPreco);
router.get('/fechamento', auth, controller.fechamentoMes);

module.exports = router;