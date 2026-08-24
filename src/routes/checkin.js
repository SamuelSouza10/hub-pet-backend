const express = require('express');
const router  = express.Router();
const controller = require('../controllers/checkinController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

// ✅ Avançar status é recurso Pro
router.post('/avancar',              auth, exigirPro, controller.avancarStatus);
// ✅ Fila de espera do dia (clínica) — mesma trava Pro
router.get('/fila-hoje',             auth, exigirPro, controller.listarFilaHoje);

// ✅ Ver o status é público — o tutor precisa ver sem precisar ser Pro
router.get('/consulta/:consulta_id', controller.buscarStatus);

module.exports = router;