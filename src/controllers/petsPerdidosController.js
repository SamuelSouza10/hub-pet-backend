const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Mural de Pets Perdidos.
// ═══════════════════════════════════════════════════════════════

exports.reportarPerdido = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id, descricao, local_perdido, data_perdido, latitude, longitude } = req.body;

    const pet = await pool.query('SELECT id FROM perfis_pet WHERE id = $1 AND tutor_id = $2', [perfil_id, tutor_id]);
    if (pet.rows.length === 0) return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const result = await pool.query(
      `INSERT INTO pets_perdidos (perfil_id, tutor_id, descricao, local_perdido, data_perdido, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [perfil_id, tutor_id, descricao || '', local_perdido || '', data_perdido || '', latitude || null, longitude || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro reportarPerdido:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Mural — todos os pets perdidos ativos ─────────────────────────
exports.listarPerdidos = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pp.id, pp.descricao, pp.local_perdido, pp.data_perdido,
              pp.latitude, pp.longitude, pp.criado_em,
              p.nome, p.especie, p.raca, p.avatar,
              u.nome AS tutor_nome, u.telefone AS tutor_telefone
       FROM pets_perdidos pp
       JOIN perfis_pet p ON p.id = pp.perfil_id
       JOIN usuarios u ON u.id = pp.tutor_id
       WHERE pp.status = 'perdido'
       ORDER BY pp.criado_em DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPerdidos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.meusReportesPerdidos = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const result = await pool.query(
      `SELECT pp.*, p.nome, p.especie, p.raca, p.avatar
       FROM pets_perdidos pp JOIN perfis_pet p ON p.id = pp.perfil_id
       WHERE pp.tutor_id = $1 ORDER BY pp.criado_em DESC`,
      [tutor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro meusReportesPerdidos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.marcarEncontrado = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE pets_perdidos SET status = 'encontrado' WHERE id = $1 AND tutor_id = $2 RETURNING id",
      [id, tutor_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Reporte não encontrado' });
    res.json({ mensagem: 'Que ótima notícia! Marcado como encontrado.' });
  } catch (err) {
    console.error('Erro marcarEncontrado:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ✅ NOVO: usado pela página pública da Tag de Emergência — se o pet
// tiver um reporte de "perdido" ativo, a tag mostra um aviso extra.
exports.verificarPerdidoPorPerfil = async (req, res) => {
  try {
    const { perfil_id } = req.params;
    const result = await pool.query(
      "SELECT id, descricao, local_perdido, data_perdido FROM pets_perdidos WHERE perfil_id = $1 AND status = 'perdido' LIMIT 1",
      [perfil_id]
    );
    res.json({ perdido: result.rows.length > 0, detalhes: result.rows[0] || null });
  } catch (err) {
    console.error('Erro verificarPerdidoPorPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};