const express = require('express');
const router  = express.Router();
const controller = require('../controllers/treinamentoController');
const auth = require('../middleware/auth');
const exigirPro = require('../middleware/exigirPro');

// ✅ Ferramenta Pro, exclusiva de quem oferece Adestramento
router.post('/sessao',                auth, exigirPro, controller.criarSessao);
router.get('/sessoes/:perfil_id',     auth, controller.listarSessoes);
router.get('/comandos/:perfil_id',    auth, controller.listarComandos);
router.put('/comando',                auth, exigirPro, controller.atualizarComando);

module.exports = router;