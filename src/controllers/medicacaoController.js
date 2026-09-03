const pool = require('../database');

// ── Cria um novo plano de medicação pra um pet ────────────────────
exports.criarPlano = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, nome_perfil, nome_remedio, dose, horarios, observacoes } = req.body;

    if (!perfil_id || !nome_perfil || !nome_remedio)
      return res.status(400).json({ erro: 'Nome do pet e do remédio são obrigatórios' });

    const result = await pool.query(
      `INSERT INTO planos_medicacao (usuario_id, perfil_id, nome_perfil, nome_remedio, dose, horarios, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [usuario_id, perfil_id, nome_perfil, nome_remedio, dose || '', horarios || '', observacoes || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarPlano:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Planos de um pet específico (só os ativos, por padrão) ────────
exports.listarPlanos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;
    const somenteAtivos = req.query.todos !== 'true';

    const result = await pool.query(
      `SELECT * FROM planos_medicacao WHERE usuario_id = $1 AND perfil_id = $2 ${somenteAtivos ? 'AND ativo = true' : ''} ORDER BY criado_em DESC`,
      [usuario_id, perfil_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPlanos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Desativa um plano (tratamento encerrado) ──────────────────────
exports.desativarPlano = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE planos_medicacao SET ativo = false WHERE id = $1 AND usuario_id = $2 RETURNING *`,
      [id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Plano não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro desativarPlano:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Registra uma dose administrada agora ──────────────────────────
exports.registrarDose = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { plano_id } = req.params;
    const { observacao } = req.body;

    const plano = await pool.query('SELECT usuario_id FROM planos_medicacao WHERE id = $1', [plano_id]);
    if (plano.rows.length === 0 || plano.rows[0].usuario_id !== usuario_id)
      return res.status(403).json({ erro: 'Sem permissão' });

    const result = await pool.query(
      `INSERT INTO doses_administradas (plano_id, observacao) VALUES ($1, $2) RETURNING *`,
      [plano_id, observacao || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro registrarDose:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Histórico de doses de 1 plano específico ──────────────────────
exports.listarDoses = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { plano_id } = req.params;

    const plano = await pool.query('SELECT usuario_id FROM planos_medicacao WHERE id = $1', [plano_id]);
    if (plano.rows.length === 0 || plano.rows[0].usuario_id !== usuario_id)
      return res.status(403).json({ erro: 'Sem permissão' });

    const result = await pool.query(
      `SELECT * FROM doses_administradas WHERE plano_id = $1 ORDER BY administrado_em DESC`,
      [plano_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarDoses:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};