const express = require('express');
const router = express.Router();
const pagamentoMpController = require('../controllers/pagamentoMpController');
const ganhosController = require('../controllers/ganhosController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

router.post('/criar', auth, pagamentoMpController.criarPreferencia);
router.post('/criar-farmacia', auth, pagamentoMpController.criarPreferenciaFarmacia);
router.get('/ganhos', auth, ganhosController.ganhos); // resumo financeiro do profissional
router.get('/retorno', pagamentoMpController.retorno); // sem auth: o navegador do tutor cai aqui
router.post('/webhook', pagamentoMpController.webhook); // sem auth: chamado pelo Mercado Pago
router.get('/status/:consulta_id', auth, pagamentoMpController.statusPagamento);
router.get('/status-farmacia/:solicitacao_id', auth, pagamentoMpController.statusPagamentoFarmacia);

// ✅ NOVO: aba "Pagamentos" do painel /admin (só administrador).
router.get('/admin/alertas', adminAuth, pagamentoMpController.listarAlertasAdmin);
router.post('/admin/alertas/:id/reestornar', adminAuth, pagamentoMpController.reestornarAlertaAdmin);
router.put('/admin/alertas/:id/resolver', adminAuth, pagamentoMpController.resolverAlertaAdmin);

module.exports = router;