const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: ficha de comportamento — UM registro por pet (não por
// atendimento), porque temperamento é um traço que persiste. Se o
// prestador salvar de novo, atualiza o registro existente em vez de
// duplicar. Recurso Pro.
// ═══════════════════════════════════════════════════════════════

// ── Salva ou atualiza a ficha de um pet (upsert) ──────────────────
exports.salvarFicha = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, nome_perfil, temperamento, observacoes } = req.body;
    if (!perfil_id || !nome_perfil)
      return res.status(400).json({ erro: 'Pet não identificado' });

    const result = await pool.query(
      `INSERT INTO ficha_comportamento (usuario_id, perfil_id, nome_perfil, temperamento, observacoes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id, perfil_id)
       DO UPDATE SET temperamento = $4, observacoes = $5, nome_perfil = $3, atualizado_em = NOW()
       RETURNING *`,
      [usuario_id, perfil_id, nome_perfil, temperamento || [], observacoes || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarFicha comportamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Busca a ficha de um pet específico ────────────────────────────
exports.buscarFichaPorPerfil = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM ficha_comportamento WHERE usuario_id = $1 AND perfil_id = $2',
      [usuario_id, perfil_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Erro buscarFichaPorPerfil comportamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista todas as fichas do prestador ────────────────────────────
exports.listarMinhasFichas = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT * FROM ficha_comportamento WHERE usuario_id = $1 ORDER BY nome_perfil ASC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMinhasFichas comportamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};