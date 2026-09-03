const express = require('express');
const router  = express.Router();
const controller = require('../controllers/adocaoController');
const auth = require('../middleware/auth');

// ✅ Públicas — qualquer um pode navegar pelos animais sem login,
// mas precisa estar logado pra postar/manifestar interesse.
// ⚠️ Ordem importa: rotas fixas (/usuario/meus) precisam vir ANTES
// de rotas com :id, senão o Express tentaria usar "usuario" como id.
router.get('/',                     controller.listarAnimais);
router.get('/usuario/meus',         auth, controller.meusAnimais);
router.get('/:id',                  controller.buscarAnimalPorId);

router.post('/',                    auth, controller.criarAnimal);
router.put('/:id/status',           auth, controller.atualizarStatusAnimal);
router.post('/:id/interesse',       auth, controller.manifestarInteresse);
router.get('/:id/interessados',     auth, controller.listarInteressados);

module.exports = router;