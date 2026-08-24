const pool = require('../database');

// ── Lista as fotos da galeria do profissional logado ─────────────
exports.listarFotos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT id, foto_url, legenda, criado_em FROM galeria_fotos WHERE usuario_id = $1 ORDER BY criado_em DESC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFotos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista as fotos de um profissional específico (pro tutor ver) ─
// ✅ Rota pública (sem exigirPro) — quem vê a galeria é o TUTOR
// decidindo se contrata, não o próprio petshop.
exports.listarFotosPublico = async (req, res) => {
  try {
    const { usuario_id } = req.params;
    const result = await pool.query(
      'SELECT id, foto_url, legenda FROM galeria_fotos WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 20',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFotosPublico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Adiciona uma foto na galeria ──────────────────────────────────
exports.adicionarFoto = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { foto_base64, legenda } = req.body;
    if (!foto_base64) return res.status(400).json({ erro: 'Envie uma foto' });

    // Limite simples pra não deixar a galeria infinita — 20 fotos por conta
    const contagem = await pool.query('SELECT COUNT(*) FROM galeria_fotos WHERE usuario_id = $1', [usuario_id]);
    if (parseInt(contagem.rows[0].count, 10) >= 20)
      return res.status(400).json({ erro: 'Limite de 20 fotos atingido. Remova alguma antes de adicionar outra.' });

    const result = await pool.query(
      'INSERT INTO galeria_fotos (usuario_id, foto_url, legenda) VALUES ($1, $2, $3) RETURNING *',
      [usuario_id, foto_base64, legenda || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro adicionarFoto:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Remove uma foto da galeria ────────────────────────────────────
exports.removerFoto = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM galeria_fotos WHERE id = $1 AND usuario_id = $2 RETURNING id',
      [id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Foto não encontrada' });
    res.json({ mensagem: 'Foto removida' });
  } catch (err) {
    console.error('Erro removerFoto:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};