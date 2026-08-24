const express = require('express');
const router  = express.Router();
const controller = require('../controllers/calculadorasController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

router.get('/status', auth, exigirPro, controller.status);

module.exports = router;