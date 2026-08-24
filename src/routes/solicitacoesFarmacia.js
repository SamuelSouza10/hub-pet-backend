const express = require('express');
const router  = express.Router();
const solicitacoesController = require('../controllers/solicitacoesFarmaciaController');
const auth    = require('../middleware/auth');

// ✅ Vet gera a receita (sem escolher destino — proibido pelo CFMV Art. XIII)
router.post('/receita',         auth, solicitacoesController.criarReceita);
router.get('/minhas',           auth, solicitacoesController.listarMinhasSolicitacoes); // veterinário

// ✅ Tutor escolhe farmácia/petshop
router.get('/pendentes',        auth, solicitacoesController.listarReceitasPendentes);  // tutor
router.put('/:id/escolher',     auth, solicitacoesController.escolherDestino);          // tutor
router.get('/disponiveis',      auth, solicitacoesController.listarFarmaciasDisponiveis);

// Farmácia/petshop
router.get('/recebidas',        auth, solicitacoesController.listarSolicitacoes);
router.put('/:id/status',       auth, solicitacoesController.atualizarStatus);
// ✅ NOVO: orçamento antes da retirada (Pro — checado dentro do controller)
router.put('/:id/orcamento',    auth, solicitacoesController.salvarOrcamento);

module.exports = router;