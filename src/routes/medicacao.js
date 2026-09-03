const express = require('express');
const router  = express.Router();
const controller = require('../controllers/medicacaoController');
const auth = require('../middleware/auth');
const exigirPro = require('../middleware/exigirPro');

router.post('/plano',                auth, exigirPro, controller.criarPlano);
router.get('/planos/:perfil_id',     auth, controller.listarPlanos);
router.put('/plano/:id/desativar',   auth, exigirPro, controller.desativarPlano);
router.post('/plano/:plano_id/dose', auth, exigirPro, controller.registrarDose);
router.get('/plano/:plano_id/doses', auth, controller.listarDoses);

module.exports = router;