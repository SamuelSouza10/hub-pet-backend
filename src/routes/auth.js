const express    = require('express');
const router     = express.Router();
const authController = require('../controllers/authController');
const auth       = require('../middleware/auth');

router.post('/register/paciente', authController.registerPaciente);
router.post('/register/medico',   authController.registerMedico);
router.post('/register/veterinario', authController.registerMedico); // mesmo controller, tipo_conta=veterinario
router.post('/login',             authController.login);
router.put('/foto-medico', auth,  authController.atualizarFotoMedico);
router.post('/remover-fundo', auth, authController.removerFundoCarimbo);
router.post('/carimbo', auth, authController.salvarCarimbo);
router.post('/push-token', auth, authController.salvarPushToken);
router.post('/geocodificar', auth, authController.geocodificarMedico);
router.get('/carimbo',  auth, authController.buscarCarimbo);
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

module.exports = router;