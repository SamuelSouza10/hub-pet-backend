const express    = require('express');
const router     = express.Router();
const authController = require('../controllers/authController');
const auth       = require('../middleware/auth');
const adminAuth  = require('../middleware/adminAuth');
// ✅ NOVO: limite de tentativas por IP, em cima do bloqueio por conta
// já aplicado dentro do authController.
const { limitarLoginUsuario, limitarLoginAdmin, limitarRecuperacaoSenha, limitarCadastro } = require('../middleware/rateLimiters');

// ✅ NOVO: limite de IP nos 5 cadastros — achado na revisão final,
// antes não tinha proteção nenhuma contra criação de contas em massa.
router.post('/register/paciente', limitarCadastro, authController.registerPaciente);
router.post('/register/medico',   limitarCadastro, authController.registerMedico);
router.post('/register/veterinario', limitarCadastro, authController.registerMedico); // mesmo controller, tipo_conta=veterinario
router.post('/register/petshop', limitarCadastro, authController.registerPetshop); // ✅ NOVA: cadastro de petshop ou prestador de serviços
router.post('/register/clinica', limitarCadastro, authController.registerClinica); // ✅ NOVA: cadastro de clínica (login único da recepção)
router.post('/register/farmacia', limitarCadastro, authController.registerFarmacia); // ✅ NOVA: cadastro de farmácia de manipulação
router.post('/login',             limitarLoginUsuario, authController.login);
router.put('/foto-medico', auth,  authController.atualizarFotoMedico);
router.post('/remover-fundo', auth, authController.removerFundoCarimbo);
router.post('/carimbo', auth, authController.salvarCarimbo);
router.post('/push-token', auth, authController.salvarPushToken);
router.post('/geocodificar', auth, authController.geocodificarMedico);
router.get('/carimbo',  auth, authController.buscarCarimbo);
// ✅ NOVO: checa pendência de pagamento antes de mostrar a confirmação
// de exclusão no frontend.
router.get('/posso-excluir-conta', auth, authController.podeExcluirConta);
router.get('/exportar-dados', auth, authController.exportarDados);
router.delete('/excluir',  auth,  authController.excluirConta);
router.put('/alterar-senha', auth, authController.alterarSenha);
// ✅ CORRIGIDO: as duas rotas antigas (recuperar-senha trocava a senha
// só com o e-mail, sem prova de posse; verificar-email vazava quais
// e-mails tinham conta) foram substituídas por um fluxo de código de
// 6 dígitos enviado por e-mail de verdade.
router.post('/recuperar-senha/solicitar', limitarRecuperacaoSenha, authController.solicitarCodigoRecuperacao);
// ✅ CORRIGIDO: achado na revisão final — faltava o mesmo limite por
// IP aqui. O limite de 5 tentativas por código (dentro do
// controller) já existia, mas sem isso alguém podia gerar vários
// códigos pra e-mails diferentes e tentar à vontade.
router.post('/recuperar-senha/confirmar', limitarRecuperacaoSenha, authController.confirmarCodigoRecuperacao);
// ✅ NOVA: salva de verdade no banco a bio/telefone/endereço/cidade/cep
// editados no perfil do médico/vet (antes só ficava salvo localmente
// no aparelho, nunca chegava no backend).
router.put('/atualizar-perfil-medico', auth, authController.atualizarPerfilMedico);
router.get('/meu-perfil-profissional', auth, authController.buscarMeuPerfilProfissional);
// ✅ NOVO: identidade basica (id), funciona pra tutor e profissional
router.get('/me', auth, authController.meuId);
// ✅ NOVO: edita especialidades/exames oferecidos a qualquer momento —
// não fica preso pra sempre no que foi escolhido no cadastro.
router.put('/servicos-oferecidos', auth, authController.atualizarServicosOferecidos);

// ✅ NOVAS: rotas de admin — aprovação manual de cadastros profissionais.
// Protegidas pelo adminAuth (não pelo auth normal de usuário).
router.post('/admin/login', limitarLoginAdmin, authController.adminLogin);
router.get('/admin/pendentes', adminAuth, authController.listarPendentes);
router.put('/admin/aprovar/:id', adminAuth, authController.aprovarConta);
router.put('/admin/reprovar/:id', adminAuth, authController.reprovarConta);
router.put('/admin/ativar-pro/:id', adminAuth, authController.ativarProTeste);
router.get('/dados-pessoais', auth, authController.buscarDadosPessoais);
router.put('/dados-pessoais', auth, authController.atualizarDadosPessoais);
router.get('/perfis-extras', auth, authController.verificarPerfisExtras);
router.put('/perfis-extras/desbloquear', auth, authController.desbloquearPerfisExtras);

module.exports = router;