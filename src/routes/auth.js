const express    = require('express');
const router     = express.Router();
const authController = require('../controllers/authController');
const auth       = require('../middleware/auth');
const adminAuth  = require('../middleware/adminAuth');

router.post('/register/paciente', authController.registerPaciente);
router.post('/register/medico',   authController.registerMedico);
router.post('/register/veterinario', authController.registerMedico); // mesmo controller, tipo_conta=veterinario
router.post('/register/petshop', authController.registerPetshop); // ✅ NOVA: cadastro de petshop ou prestador de serviços
router.post('/register/clinica', authController.registerClinica); // ✅ NOVA: cadastro de clínica (login único da recepção)
router.post('/register/farmacia', authController.registerFarmacia); // ✅ NOVA: cadastro de farmácia de manipulação
router.post('/login',             authController.login);
router.put('/foto-medico', auth,  authController.atualizarFotoMedico);
router.post('/remover-fundo', auth, authController.removerFundoCarimbo);
router.post('/carimbo', auth, authController.salvarCarimbo);
router.post('/push-token', auth, authController.salvarPushToken);
router.post('/geocodificar', auth, authController.geocodificarMedico);
router.get('/carimbo',  auth, authController.buscarCarimbo);
// ✅ NOVO: checa pendência de pagamento antes de mostrar a confirmação
// de exclusão no frontend.
router.get('/posso-excluir-conta', auth, authController.podeExcluirConta);
router.delete('/excluir',  auth,  authController.excluirConta);
router.put('/alterar-senha', auth, authController.alterarSenha);
router.post('/recuperar-senha', authController.recuperarSenha);
// ✅ NOVA: checa se o e-mail existe sem alterar senha nenhuma (correção
// da vulnerabilidade de segurança do "esqueci minha senha").
router.get('/verificar-email', authController.verificarEmail);
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
router.post('/admin/login', authController.adminLogin);
router.get('/admin/pendentes', adminAuth, authController.listarPendentes);
router.put('/admin/aprovar/:id', adminAuth, authController.aprovarConta);
router.put('/admin/reprovar/:id', adminAuth, authController.reprovarConta);

module.exports = router;