const pool = require('../database');
const crypto = require('crypto');

// ✅ Código aleatório de 10 caracteres (base36) — não sequencial, não
// adivinhável, diferente do id numérico (que nunca aparece na URL
// pública, pra evitar alguém varrer /tags/1, /tags/2... por aí).
function gerarCodigo() {
  return crypto.randomBytes(8).toString('hex').slice(0, 10);
}

// ── Cria uma nova tag pra um pet ──────────────────────────────────
exports.criarTag = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, nome_perfil, foto_url, telefone_contato, alerta } = req.body;

    if (!perfil_id || !nome_perfil || !telefone_contato)
      return res.status(400).json({ erro: 'Nome do pet e telefone de contato são obrigatórios' });

    // Tenta gerar um código único — colisão é extremamente rara com
    // 10 caracteres aleatórios, mas confere mesmo assim antes de usar.
    let codigo;
    let tentativas = 0;
    while (tentativas < 5) {
      codigo = gerarCodigo();
      const existe = await pool.query('SELECT id FROM tags_emergencia WHERE codigo = $1', [codigo]);
      if (existe.rows.length === 0) break;
      tentativas++;
    }

    const result = await pool.query(
      `INSERT INTO tags_emergencia (usuario_id, perfil_id, nome_perfil, foto_url, telefone_contato, alerta, codigo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [usuario_id, perfil_id, nome_perfil, foto_url || '', telefone_contato, alerta || '', codigo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarTag:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Minhas tags (tutor logado) ────────────────────────────────────
exports.listarMinhasTags = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      `SELECT * FROM tags_emergencia WHERE usuario_id = $1 ORDER BY criado_em DESC`,
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMinhasTags:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Página pública — quem escaneia o QR, SEM login ────────────────
exports.buscarTagPublica = async (req, res) => {
  try {
    const { codigo } = req.params;
    const result = await pool.query(
      `SELECT nome_perfil, foto_url, telefone_contato, alerta, ativo FROM tags_emergencia WHERE codigo = $1`,
      [codigo]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Tag não encontrada' });
    if (!result.rows[0].ativo) return res.status(410).json({ erro: 'Essa tag foi desativada pelo tutor' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarTagPublica:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Edita telefone/alerta/foto ────────────────────────────────────
exports.atualizarTag = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { telefone_contato, alerta, foto_url } = req.body;

    const result = await pool.query(
      `UPDATE tags_emergencia SET
        telefone_contato = COALESCE($1, telefone_contato),
        alerta            = COALESCE($2, alerta),
        foto_url          = COALESCE($3, foto_url)
       WHERE id = $4 AND usuario_id = $5 RETURNING *`,
      [telefone_contato, alerta, foto_url, id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Tag não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarTag:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Desativa a tag (perdeu a etiqueta, por exemplo) ───────────────
exports.desativarTag = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE tags_emergencia SET ativo = false WHERE id = $1 AND usuario_id = $2 RETURNING *`,
      [id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Tag não encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro desativarTag:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};