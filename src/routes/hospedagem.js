const express = require('express');
const router  = express.Router();
const controller = require('../controllers/hospedagemController');
const auth = require('../middleware/auth');
const exigirPro = require('../middleware/exigirPro');

// ✅ Rota fixa antes da rota com :perfil_id, pra não conflitar
router.get('/hospedados-agora',         auth, controller.listarHospedadosAgora);
router.get('/perfil/:perfil_id',        auth, controller.buscarPerfil);
router.post('/perfil',                  auth, exigirPro, controller.salvarPerfil);
router.put('/perfil/:perfil_id/toggle', auth, exigirPro, controller.toggleHospedadoAgora);

module.exports = router;