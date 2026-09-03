const express = require('express');
const router  = express.Router();
const controller = require('../controllers/tagEmergenciaController');
const auth = require('../middleware/auth');

// ✅ Pública, SEM auth — é a página que quem acha o pet perdido vê,
// sem precisar ter o app nem estar logado.
router.get('/publica/:codigo', controller.buscarTagPublica);

router.post('/',              auth, controller.criarTag);
router.get('/minhas',         auth, controller.listarMinhasTags);
router.put('/:id',            auth, controller.atualizarTag);
router.put('/:id/desativar',  auth, controller.desativarTag);

module.exports = router;