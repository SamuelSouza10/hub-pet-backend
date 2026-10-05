const express = require('express');
const router = express.Router();
const pagamentoMpController = require('../controllers/pagamentoMpController');
const auth = require('../middleware/auth');

router.post('/criar', auth, pagamentoMpController.criarPreferencia);
router.post('/criar-farmacia', auth, pagamentoMpController.criarPreferenciaFarmacia);
router.get('/retorno', pagamentoMpController.retorno); // sem auth: o navegador do tutor cai aqui
router.post('/webhook', pagamentoMpController.webhook); // sem auth: chamado pelo Mercado Pago
router.get('/status/:consulta_id', auth, pagamentoMpController.statusPagamento);
router.get('/status-farmacia/:solicitacao_id', auth, pagamentoMpController.statusPagamentoFarmacia);

module.exports = router;