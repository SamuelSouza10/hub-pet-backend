const express        = require('express');
const router         = express.Router();
const controller     = require('../controllers/consultasController');
const authMiddleware = require('../middleware/auth');

// ✅ Rotas públicas
router.get('/horarios-ocupados/:medico_id', controller.horariosOcupados);
router.get('/agenda-config/:medico_id',     controller.getConfigAgenda);
router.get('/avaliacoes/:medico_id',        controller.avaliacoesMedico);

// Rotas autenticadas
router.use(authMiddleware);
router.get('/avaliacoes-me', controller.avaliacoesMedicoMe);

router.post('/',                              controller.criarConsulta);
router.get('/medico',                         controller.consultasMedico);
router.get('/paciente',                       controller.consultasPaciente);
router.get('/verificar-bloqueio',             controller.verificarBloqueio);
router.get('/verificar-avaliacao/:consulta_id', controller.verificarAvaliacao);
router.patch('/:id/responder',                controller.responderConsulta);
router.patch('/:id/status',                   controller.marcarStatus);
router.patch('/:id/remarcar',                 controller.remarcarConsulta);
router.patch('/:id/responder-remarcacao',     controller.responderRemarcacao);
router.delete('/:id/cancelar',                controller.cancelarComPrazo);
router.post('/agenda-config',                 controller.salvarConfigAgenda);
router.post('/avaliar',                       controller.avaliarMedico);

// ✅ NOVO: observação de ida e volta (tutor edita a própria observação;
// profissional escreve a resposta) — construídas numa rodada anterior,
// mas essa integração no arquivo de rotas real só dava pra fazer agora
// que você mandou o arquivo.
router.put('/:id/observacao-tutor',        controller.salvarObservacaoTutor);
router.put('/:id/observacao-profissional', controller.salvarObservacaoProfissional);

// ✅ NOVO: rota do dia — visitas confirmadas de hoje do prestador de
// serviço, em ordem de horário.
router.get('/rota-hoje', controller.listarRotaHoje);

module.exports = router;