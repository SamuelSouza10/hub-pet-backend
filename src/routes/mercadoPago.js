const express = require('express');
const router = express.Router();
const mercadoPagoController = require('../controllers/mercadoPagoController');
const auth = require('../middleware/auth');

router.post('/conectar', auth, mercadoPagoController.iniciarConexao);
router.get('/callback', mercadoPagoController.callbackConexao); // sem auth: chamado pelo Mercado Pago
router.get('/status', auth, mercadoPagoController.statusConexao);
router.delete('/desconectar', auth, mercadoPagoController.desconectar);

module.exports = router;