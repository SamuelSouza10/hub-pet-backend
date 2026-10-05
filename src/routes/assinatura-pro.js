const express = require('express');
const router = express.Router();
const assinaturaProController = require('../controllers/assinaturaProController');
const auth = require('../middleware/auth');

router.post('/iniciar', auth, assinaturaProController.iniciarAssinatura);
router.post('/webhook', assinaturaProController.webhook); // sem auth: chamado pelo Mercado Pago
router.get('/status', auth, assinaturaProController.statusAssinatura);
router.put('/cancelar', auth, assinaturaProController.cancelarAssinatura);

module.exports = router;