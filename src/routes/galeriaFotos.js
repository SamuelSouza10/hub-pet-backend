const express = require('express');
const router  = express.Router();
const controller = require('../controllers/galeriaFotosController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

// ✅ Gerenciar a própria galeria é recurso Pro
router.get('/minhas',        auth, exigirPro, controller.listarFotos);
router.post('/',             auth, exigirPro, controller.adicionarFoto);
router.delete('/:id',        auth, exigirPro, controller.removerFoto);

// ✅ Ver a galeria de outro profissional é público — o tutor não
// precisa ser Pro pra decidir se contrata baseado nas fotos.
router.get('/de/:usuario_id', controller.listarFotosPublico);

module.exports = router;