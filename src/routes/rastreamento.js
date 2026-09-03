const express = require('express');
const router  = express.Router();
const controller = require('../controllers/rastreamentoController');
const auth       = require('../middleware/auth');
const exigirPro  = require('../middleware/exigirPro');

// ✅ Escrita é feita pelo prestador — ele que tem (ou não) o plano Pro,
// por isso exigirPro aqui. Leitura é feita pelo TUTOR, que nunca tem
// assinatura própria — exigirPro bloquearia ele incorretamente, então
// a autorização de leitura é feita no controller (autorizado()),
// checando se o usuário é o paciente_id ou medico_id da consulta.
router.post('/:consulta_id/ponto', auth, exigirPro, controller.salvarPonto);
router.get('/:consulta_id/pontos', auth, controller.listarPontos);
router.post('/:consulta_id/foto',  auth, exigirPro, controller.salvarFotoPasseio);
router.get('/:consulta_id/fotos',  auth, controller.listarFotosPasseio);
// ✅ NOVO: relatório do passeio — leitura, mesma regra do :consulta_id/pontos
router.get('/:consulta_id/relatorio', auth, controller.relatorioPasseio);

module.exports = router;