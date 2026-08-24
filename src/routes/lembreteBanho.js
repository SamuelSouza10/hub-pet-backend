const express = require('express');
const router  = express.Router();
const controller = require('../controllers/lembreteBanhoController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

// ✅ Configurar o intervalo é recurso Pro
router.put('/intervalo', auth, exigirPro, controller.salvarIntervalo);

// ✅ Disparo manual pra teste (protegido por chave, não por login)
router.post('/testar', controller.testarManualmente);

module.exports = router;