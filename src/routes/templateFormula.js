const express = require('express');
const router  = express.Router();
const controller = require('../controllers/templateFormulaController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

router.get('/',       auth, exigirPro, controller.listarTemplates);
router.post('/',      auth, exigirPro, controller.criarTemplate);
router.put('/:id',    auth, exigirPro, controller.atualizarTemplate);
router.delete('/:id', auth, exigirPro, controller.removerTemplate);

module.exports = router;