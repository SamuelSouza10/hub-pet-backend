const express = require('express');
const router = express.Router();
const perfilPetController = require('../controllers/perfilPetController');
const auth = require('../middleware/auth');

// Perfis
router.post('/', auth, perfilPetController.criarPerfil);
router.get('/meus', auth, perfilPetController.listarMeusPerfis);
router.get('/ativo', auth, perfilPetController.buscarPerfilAtivo);
router.put('/ativo', auth, perfilPetController.definirPerfilAtivo);
router.get('/:id', auth, perfilPetController.buscarPerfil);
router.put('/:id', auth, perfilPetController.atualizarPerfil);
router.delete('/:id', auth, perfilPetController.excluirPerfil);
router.put('/:id/foto', auth, perfilPetController.atualizarFotoPet);

// Prontuário (aninhado por perfil)
router.get('/:perfil_id/prontuario', auth, perfilPetController.buscarProntuario);
router.put('/:perfil_id/prontuario', auth, perfilPetController.atualizarProntuario);
router.put('/:perfil_id/vacinas', auth, perfilPetController.atualizarVacinas);

module.exports = router;