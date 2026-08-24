const express = require('express');
const router  = express.Router();
const controller = require('../controllers/fichaComportamentoController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

router.post('/',                 auth, exigirPro, controller.salvarFicha);
router.get('/minhas',            auth, exigirPro, controller.listarMinhasFichas);
router.get('/perfil/:perfil_id', auth, exigirPro, controller.buscarFichaPorPerfil);

module.exports = router;