const express = require('express');
const router = express.Router();
const favoritosController = require('../controllers/favoritosController');
const auth = require('../middleware/auth');

router.get('/', auth, favoritosController.listarFavoritos);
router.post('/', auth, favoritosController.adicionarFavorito);
router.delete('/:medico_id', auth, favoritosController.removerFavorito);

module.exports = router;