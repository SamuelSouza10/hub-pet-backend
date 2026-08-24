const express = require('express');
const router  = express.Router();
const controller = require('../controllers/equipeMedicaController');
const auth       = require('../middleware/auth');

// ✅ Sem exigirPro — é fundação, precisa estar aberto pro plano Grátis
// também (sem isso, clínica não emite documento legal nenhum).
router.get('/',       auth, controller.listarEquipe);
router.post('/',      auth, controller.adicionarMembro);
router.put('/:id',    auth, controller.atualizarMembro);
router.delete('/:id', auth, controller.removerMembro);

module.exports = router;