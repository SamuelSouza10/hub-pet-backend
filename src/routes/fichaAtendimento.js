const express = require('express');
const router  = express.Router();
const controller = require('../controllers/fichaAtendimentoController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

// ✅ Preencher/editar a ficha é recurso Pro
router.post('/',                        auth, exigirPro, controller.salvarFicha);
router.get('/consulta/:consulta_id',    auth, exigirPro, controller.buscarFichaPorConsulta);

// ✅ Ver o histórico de fichas do pet é público — o tutor não precisa
// ser Pro (nem tem plano) pra ver o próprio histórico do pet.
router.get('/perfil/:perfil_id', controller.listarFichasPorPerfil);

module.exports = router;