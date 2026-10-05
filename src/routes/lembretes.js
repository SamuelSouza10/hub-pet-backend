const express = require('express');
const router = express.Router();
const lembretesController = require('../controllers/lembretesController');
const auth = require('../middleware/auth');

// Profissional
router.get('/profissional', auth, lembretesController.listarLembretesProfissional);
router.post('/profissional', auth, lembretesController.criarLembreteProfissional);
router.put('/profissional/:id', auth, lembretesController.atualizarLembreteProfissional);
router.delete('/profissional/:id', auth, lembretesController.excluirLembreteProfissional);

// Pet (aninhado por perfil)
router.get('/pet/:perfil_id', auth, lembretesController.listarLembretesPet);
router.post('/pet/:perfil_id', auth, lembretesController.criarLembretePet);
router.put('/pet/:perfil_id/:id', auth, lembretesController.atualizarLembretePet);
router.delete('/pet/:perfil_id/:id', auth, lembretesController.excluirLembretePet);

module.exports = router;