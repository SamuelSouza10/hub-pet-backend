const servico = require('../services/servicoPagamento');

// ── Busca o plano/assinatura atual do profissional logado ───────
exports.meuPlano = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    let assinatura = await servico.buscarAssinatura(usuario_id);
    // Rede de segurança: se por algum motivo a conta foi aprovada sem
    // passar pela criação automática da assinatura grátis, cria agora.
    if (!assinatura) assinatura = await servico.criarAssinaturaGratis(usuario_id);
    res.json(assinatura);
  } catch (err) {
    console.error('Erro meuPlano:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista os preços de serviço declarados ────────────────────────
exports.listarPrecos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const lista = await servico.listarPrecosServicos(usuario_id);
    res.json(lista);
  } catch (err) {
    console.error('Erro listarPrecos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ✅ NOVO: versão pública (sem login) — pro tutor ver o preço de um
// profissional específico antes de agendar, na tela de detalhes.
// Reaproveita a mesma função de serviço, só que com o medico_id vindo
// da URL em vez do usuário autenticado.
exports.listarPrecosPublico = async (req, res) => {
  try {
    const { medico_id } = req.params;
    const lista = await servico.listarPrecosServicos(medico_id);
    res.json(lista);
  } catch (err) {
    console.error('Erro listarPrecosPublico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Declara/atualiza o preço de um serviço ───────────────────────
exports.salvarPreco = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { servico_id, servico_nome, preco } = req.body;
    if (!servico_id || !servico_nome || !preco || parseFloat(preco) <= 0)
      return res.status(400).json({ erro: 'Preencha o nome e um preço válido' });

    const resultado = await servico.salvarPrecoServico(usuario_id, servico_id, servico_nome, preco);
    res.json(resultado);
  } catch (err) {
    console.error('Erro salvarPreco:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Fechamento do mês atual (mensalidade + taxas acumuladas) ────
exports.fechamentoMes = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const fechamento = await servico.calcularFechamentoMes(usuario_id);
    res.json(fechamento);
  } catch (err) {
    console.error('Erro fechamentoMes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};