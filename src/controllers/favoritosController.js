const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Favoritos. Antes vivia numa chave sem usuário
// ('favoritos_medicos') — sem persistir de verdade, e vazando entre
// contas diferentes no mesmo aparelho.
// ═══════════════════════════════════════════════════════════════

exports.listarFavoritos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query('SELECT medico_id FROM favoritos_medico WHERE usuario_id = $1', [usuario_id]);
    res.json(result.rows.map(r => r.medico_id));
  } catch (err) {
    console.error('Erro listarFavoritos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.adicionarFavorito = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { medico_id } = req.body;
    if (!medico_id) return res.status(400).json({ erro: 'medico_id é obrigatório' });
    await pool.query(
      'INSERT INTO favoritos_medico (usuario_id, medico_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [usuario_id, medico_id]
    );
    res.status(201).json({ mensagem: 'Adicionado aos favoritos' });
  } catch (err) {
    console.error('Erro adicionarFavorito:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.removerFavorito = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { medico_id } = req.params;
    await pool.query('DELETE FROM favoritos_medico WHERE usuario_id = $1 AND medico_id = $2', [usuario_id, medico_id]);
    res.json({ mensagem: 'Removido dos favoritos' });
  } catch (err) {
    console.error('Erro removerFavorito:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};