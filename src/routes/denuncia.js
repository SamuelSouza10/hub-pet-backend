const express = require('express');
const router = express.Router();
const denunciaController = require('../controllers/denunciaController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// Usuário comum (tutor ou profissional)
router.post('/', auth, denunciaController.criarDenuncia);
router.get('/minhas', auth, denunciaController.minhasDenuncias);

// Admin
router.get('/admin', adminAuth, denunciaController.listarDenunciasAdmin);
router.put('/admin/:id/status', adminAuth, denunciaController.atualizarStatusDenuncia);
router.put('/admin/:id/suspender', adminAuth, denunciaController.suspenderProfissionalDenunciado);

module.exports = router;