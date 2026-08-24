const express = require('express');
const router  = express.Router();
const controller = require('../controllers/medicosController');

router.get('/',        controller.listarMedicos);
router.get('/buscar',  controller.buscarMedicos);
// ✅ NOVO: só quem é Pro aparece no mapa (lista continua trazendo todo
// mundo, grátis ou Pro — gate é só pro pin do mapa interativo).
router.get('/mapa',    controller.listarParaMapa);
// ✅ NOVO: perfil de um profissional específico, com exames/procedimentos
router.get('/:id',     controller.buscarMedicoPorId);

module.exports = router;