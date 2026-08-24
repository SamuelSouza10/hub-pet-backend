const express = require('express');
const router  = express.Router();
const controller = require('../controllers/relatorioController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

router.get('/mensal', auth, exigirPro, controller.relatorioMensal);
router.get('/clinica', auth, exigirPro, controller.dashboardClinica);

module.exports = router;