const pool = require('../database');

// ── Lista os templates do usuário logado ─────────────────────────
exports.listarTemplates = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT * FROM templates_formula WHERE usuario_id = $1 ORDER BY nome_template ASC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarTemplates:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Cria um template novo ─────────────────────────────────────────
exports.criarTemplate = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nome_template, composicao, modo_preparo, validade_dias } = req.body;
    if (!nome_template?.trim()) return res.status(400).json({ erro: 'Dê um nome pro template' });

    const result = await pool.query(
      `INSERT INTO templates_formula (usuario_id, nome_template, composicao, modo_preparo, validade_dias)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [usuario_id, nome_template.trim(), composicao || '', modo_preparo || '', validade_dias || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarTemplate:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualiza um template existente ────────────────────────────────
exports.atualizarTemplate = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { nome_template, composicao, modo_preparo, validade_dias } = req.body;

    const result = await pool.query(
      `UPDATE templates_formula
       SET nome_template = $1, composicao = $2, modo_preparo = $3, validade_dias = $4, atualizado_em = NOW()
       WHERE id = $5 AND usuario_id = $6 RETURNING *`,
      [nome_template, composicao || '', modo_preparo || '', validade_dias || null, id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Template não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarTemplate:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Remove um template ────────────────────────────────────────────
exports.removerTemplate = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM templates_formula WHERE id = $1 AND usuario_id = $2 RETURNING id',
      [id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Template não encontrado' });
    res.json({ mensagem: 'Template removido' });
  } catch (err) {
    console.error('Erro removerTemplate:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};