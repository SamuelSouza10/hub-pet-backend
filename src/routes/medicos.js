const express = require('express');
const router  = express.Router();
const controller = require('../controllers/medicosController');

router.get('/',        controller.listarMedicos);
router.get('/buscar',  controller.buscarMedicos);

module.exports = router;