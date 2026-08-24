const pool = require('../database');

// ── Cria/atualiza a ficha de um agendamento específico ───────────
// ✅ Vinculada a um consulta_id real — não é formulário solto. Só o
// próprio petshop dono daquele agendamento pode preencher.
exports.salvarFicha = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { consulta_id, tipo_servico, produtos_usados, observacoes, foto_url } = req.body;
    if (!consulta_id) return res.status(400).json({ erro: 'consulta_id é obrigatório' });

    // Confirma que esse agendamento é mesmo desse petshop
    const consultaCheck = await pool.query(
      'SELECT id FROM consultas WHERE id = $1 AND medico_id = $2',
      [consulta_id, usuario_id]
    );
    if (consultaCheck.rows.length === 0)
      return res.status(403).json({ erro: 'Esse agendamento não pertence a você' });

    const result = await pool.query(
      `INSERT INTO fichas_atendimento (consulta_id, usuario_id, tipo_servico, produtos_usados, observacoes, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (consulta_id)
       DO UPDATE SET tipo_servico = $3, produtos_usados = $4, observacoes = $5, foto_url = $6
       RETURNING *`,
      [consulta_id, usuario_id, tipo_servico || '', produtos_usados || '', observacoes || '', foto_url || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarFicha:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Busca a ficha de um agendamento específico ────────────────────
exports.buscarFichaPorConsulta = async (req, res) => {
  try {
    const { consulta_id } = req.params;
    const result = await pool.query('SELECT * FROM fichas_atendimento WHERE consulta_id = $1', [consulta_id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Erro buscarFichaPorConsulta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista todas as fichas de um pet (histórico) ──────────────────
// ✅ Rota pública pro tutor ver — usa perfil_id (não precisa ser Pro
// pra VER o próprio histórico, só o petshop precisa ser Pro pra CRIAR).
exports.listarFichasPorPerfil = async (req, res) => {
  try {
    const { perfil_id } = req.params;
    const result = await pool.query(`
      SELECT f.*, u.nome AS petshop_nome, c.data, c.horario
      FROM fichas_atendimento f
      JOIN consultas c ON c.id = f.consulta_id
      JOIN usuarios u ON u.id = f.usuario_id
      WHERE c.perfil_id = $1
      ORDER BY c.data DESC, c.horario DESC
    `, [perfil_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFichasPorPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};