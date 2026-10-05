const express = require('express');
const router = express.Router();
const petsPerdidosController = require('../controllers/petsPerdidosController');
const auth = require('../middleware/auth');

router.post('/', auth, petsPerdidosController.reportarPerdido);
router.get('/', auth, petsPerdidosController.listarPerdidos);
router.get('/meus', auth, petsPerdidosController.meusReportesPerdidos);
router.put('/:id/encontrado', auth, petsPerdidosController.marcarEncontrado);
router.get('/verificar/:perfil_id', petsPerdidosController.verificarPerdidoPorPerfil);

module.exports = router;