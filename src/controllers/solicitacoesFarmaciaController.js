const pool = require('../database');

// ✅ Helper de push notification — mesmo padrão já usado em
// consultasController.js. Notifica o TUTOR (dispositivo diferente do
// veterinário) quando uma nova receita chega esperando escolha.
async function enviarPush(pushToken, titulo, corpo) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title: titulo, body: corpo, sound: 'default', priority: 'high' }),
    });
  } catch (e) {
    console.error('Erro enviarPush:', e.message);
  }
}

// ✅ NOVO: checa se o usuário é Pro — usado pra decidir se manda
// notificação automática (recurso Pro) sem bloquear o resto da rota,
// que continua funcionando pra quem é grátis.
async function ehPro(usuario_id) {
  const r = await pool.query('SELECT plano, status FROM assinaturas WHERE usuario_id = $1', [usuario_id]);
  const a = r.rows[0];
  return a?.plano === 'pro' && a?.status === 'ativa';
}

// ── Farmácia define o orçamento antes do tutor retirar (Pro) ─────
// ✅ NOVO: pendência antiga, nunca resolvida — a farmácia informa
// quanto vai custar a manipulação antes do tutor ir até lá. Recurso
// Pro (checado aqui dentro, não pelo middleware de rota — assim o
// endpoint de status continua livre pra quem é grátis).
exports.salvarOrcamento = async (req, res) => {
  try {
    const farmacia_id = req.usuario.id;
    if (!(await ehPro(farmacia_id)))
      return res.status(403).json({ erro: 'Recurso exclusivo do plano Pro.', requer_pro: true });

    const { id } = req.params;
    const { valor, observacao } = req.body;
    if (valor === undefined || isNaN(parseFloat(valor)))
      return res.status(400).json({ erro: 'Informe um valor válido' });

    const result = await pool.query(
      `UPDATE solicitacoes_farmacia SET orcamento_valor = $1, orcamento_obs = $2, atualizado_em = NOW()
       WHERE id = $3 AND farmacia_id = $4 RETURNING *`,
      [parseFloat(valor), observacao || '', id, farmacia_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Solicitação não encontrada' });

    // Notifica o tutor do orçamento
    const item = result.rows[0];
    if (item.paciente_id) {
      const tutorInfo = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [item.paciente_id]);
      await enviarPush(
        tutorInfo.rows[0]?.push_token,
        '💰 Orçamento disponível',
        `A farmácia informou o valor da manipulação de ${item.paciente_nome}: R$ ${parseFloat(valor).toFixed(2)}`
      );
    }

    res.json(item);
  } catch (err) {
    console.error('Erro salvarOrcamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Veterinário cria a receita (SEM escolher farmácia/petshop) ──
// ✅ MUDANÇA IMPORTANTE: por exigência do Código de Ética do CFMV
// (Art. XIII — veda receber/pagar comissão pra angariar clientes), o
// veterinário NÃO escolhe mais o destino. Ele só gera a receita e ela
// fica esperando o TUTOR escolher farmácia ou petshop — o profissional
// nunca direciona pra um estabelecimento específico.
// paciente_id/perfil_id vêm de uma consulta JÁ REALIZADA (não é nome
// digitado à mão) — evita mandar a receita pro tutor errado por
// coincidência de nome de pet.
exports.criarReceita = async (req, res) => {
  try {
    const veterinario_id = req.usuario.id;
    const { paciente_id, perfil_id, paciente_nome, especie, peso, medicamentos, observacoes } = req.body;

    if (!paciente_id || !paciente_nome || !Array.isArray(medicamentos) || medicamentos.length === 0)
      return res.status(400).json({ erro: 'Dados incompletos para a receita' });

    const result = await pool.query(
      `INSERT INTO solicitacoes_farmacia
        (veterinario_id, paciente_id, perfil_id, paciente_nome, especie, peso, medicamentos, observacoes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aguardando_escolha')
       RETURNING id`,
      [veterinario_id, paciente_id, perfil_id || '', paciente_nome, especie || '', peso || '', JSON.stringify(medicamentos), observacoes || '']
    );

    // Notifica o tutor
    const tutorInfo = await pool.query('SELECT push_token, nome FROM usuarios WHERE id = $1', [paciente_id]);
    const vetInfo    = await pool.query('SELECT nome FROM usuarios WHERE id = $1', [veterinario_id]);
    await enviarPush(
      tutorInfo.rows[0]?.push_token,
      '💊 Nova receita disponível!',
      `${vetInfo.rows[0]?.nome || 'O veterinário'} prescreveu remédios para ${paciente_nome}. Escolha onde retirar.`
    );

    res.status(201).json({ mensagem: 'Receita enviada! O tutor vai escolher onde retirar.', id: result.rows[0].id });
  } catch (err) {
    console.error('Erro criarReceita:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Tutor lista as receitas aguardando escolha ───────────────────
exports.listarReceitasPendentes = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const result = await pool.query(`
      SELECT s.*, u.nome AS veterinario_nome, m.crm AS veterinario_crm
      FROM solicitacoes_farmacia s
      JOIN usuarios u ON u.id = s.veterinario_id
      LEFT JOIN medicos m ON m.usuario_id = s.veterinario_id
      WHERE s.paciente_id = $1 AND s.status = 'aguardando_escolha'
      ORDER BY s.criado_em DESC
    `, [paciente_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarReceitasPendentes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Tutor escolhe pra qual farmácia/petshop mandar ───────────────
// ✅ Só aqui o destino é de fato escolhido — sempre pelo TUTOR, nunca
// pelo veterinário. É essa troca que resolve o problema ético.
exports.escolherDestino = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const { id } = req.params;
    const { farmacia_id } = req.body;

    if (!farmacia_id) return res.status(400).json({ erro: 'Escolha uma farmácia ou petshop' });

    // Confirma que o destino é aprovado
    const destinoCheck = await pool.query(
      "SELECT id, tipo_conta FROM medicos WHERE usuario_id = $1 AND tipo_conta IN ('farmacia', 'petshop') AND status_verificacao = 'aprovado'",
      [farmacia_id]
    );
    if (destinoCheck.rows.length === 0)
      return res.status(400).json({ erro: 'Farmácia/petshop não encontrado ou não aprovado' });

    // Só deixa escolher se a receita for realmente do tutor logado e
    // ainda estiver aguardando escolha (evita reenviar duas vezes)
    const result = await pool.query(
      `UPDATE solicitacoes_farmacia SET farmacia_id = $1, status = 'pendente', atualizado_em = NOW()
       WHERE id = $2 AND paciente_id = $3 AND status = 'aguardando_escolha' RETURNING *`,
      [farmacia_id, id, paciente_id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Receita não encontrada ou já processada' });

    // Notifica a farmácia/petshop escolhido
    const destinoInfo = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [farmacia_id]);
    await enviarPush(
      destinoInfo.rows[0]?.push_token,
      '💊 Nova solicitação recebida!',
      `Uma receita para ${result.rows[0].paciente_nome} foi enviada pra você.`
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro escolherDestino:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Farmácia/Petshop lista as próprias solicitações recebidas ───
exports.listarSolicitacoes = async (req, res) => {
  try {
    const destino_id = req.usuario.id;
    const result = await pool.query(`
      SELECT s.*, u.nome AS veterinario_nome, m.crm AS veterinario_crm, m.telefone AS veterinario_telefone
      FROM solicitacoes_farmacia s
      JOIN usuarios u ON u.id = s.veterinario_id
      LEFT JOIN medicos m ON m.usuario_id = s.veterinario_id
      WHERE s.farmacia_id = $1
      ORDER BY s.criado_em DESC
    `, [destino_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarSolicitacoes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Veterinário lista as receitas que ele mesmo gerou ────────────
exports.listarMinhasSolicitacoes = async (req, res) => {
  try {
    const veterinario_id = req.usuario.id;
    const result = await pool.query(`
      SELECT s.*, u2.nome AS farmacia_nome, m.tipo_conta AS destino_tipo_conta
      FROM solicitacoes_farmacia s
      LEFT JOIN usuarios u2 ON u2.id = s.farmacia_id
      LEFT JOIN medicos m ON m.usuario_id = s.farmacia_id
      WHERE s.veterinario_id = $1
      ORDER BY s.criado_em DESC
    `, [veterinario_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMinhasSolicitacoes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Farmácia/Petshop atualiza o status da solicitação ────────────
// ✅ NOVO: notifica o tutor automaticamente quando o status muda —
// recurso Pro. Quem é grátis continua avançando o status normalmente
// (isso não muda), só não dispara a notificação automática.
exports.atualizarStatus = async (req, res) => {
  try {
    const destino_id = req.usuario.id;
    const { id } = req.params;
    const { status } = req.body;

    const statusValidos = ['vista', 'em_preparo', 'pronta', 'entregue', 'cancelada'];
    if (!statusValidos.includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    const result = await pool.query(
      `UPDATE solicitacoes_farmacia SET status = $1, atualizado_em = NOW()
       WHERE id = $2 AND farmacia_id = $3 RETURNING *`,
      [status, id, destino_id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Solicitação não encontrada' });

    const item = result.rows[0];

    if (await ehPro(destino_id) && item.paciente_id) {
      const MENSAGENS = {
        vista:       'Sua solicitação já está sendo analisada.',
        em_preparo:  `A manipulação de ${item.paciente_nome} começou.`,
        pronta:      `${item.paciente_nome} está pronto pra retirada! 🎉`,
        entregue:    'Retirada confirmada. Obrigado!',
        cancelada:   'Sua solicitação foi cancelada — entre em contato pra mais detalhes.',
      };
      const tutorInfo = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [item.paciente_id]);
      await enviarPush(tutorInfo.rows[0]?.push_token, '💊 H.U.B. — Atualização da sua receita', MENSAGENS[status] || 'Status atualizado.');
    }

    res.json(item);
  } catch (err) {
    console.error('Erro atualizarStatus:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista farmácias OU petshops aprovados disponíveis ────────────
exports.listarFarmaciasDisponiveis = async (req, res) => {
  try {
    const tipo = req.query.tipo === 'petshop' ? 'petshop' : 'farmacia';
    const result = await pool.query(`
      SELECT u.id, u.nome, m.especialidade AS categorias, m.cidade, m.telefone, m.tem_entrega
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE m.tipo_conta = $1 AND m.status_verificacao = 'aprovado'
      ORDER BY u.nome ASC
    `, [tipo]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFarmaciasDisponiveis:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};