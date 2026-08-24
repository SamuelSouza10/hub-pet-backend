const express = require('express');
const router  = express.Router();
const controller = require('../controllers/prontuarioClinicaController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

router.post('/',                 auth, exigirPro, controller.salvarEntrada);
router.get('/perfil/:perfil_id', auth, exigirPro, controller.listarPorPerfil);

module.exports = router;