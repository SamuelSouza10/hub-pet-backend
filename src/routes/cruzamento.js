const express = require('express');
const router = express.Router();
const cruzamentoController = require('../controllers/cruzamentoController');
const auth = require('../middleware/auth');

router.post('/', auth, cruzamentoController.criarPerfilCruzamento);
router.get('/meus', auth, cruzamentoController.meusPerfisCruzamento);
router.get('/descobrir', auth, cruzamentoController.descobrir);
router.post('/curtir', auth, cruzamentoController.curtir);
router.get('/matches', auth, cruzamentoController.listarMatches);
router.put('/:id/desativar', auth, cruzamentoController.desativarPerfilCruzamento);

module.exports = router;