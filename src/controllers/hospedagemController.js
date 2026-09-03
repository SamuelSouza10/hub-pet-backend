const pool = require('../database');

// ── Salva (cria ou atualiza) o perfil de hospedagem de um pet ────
// Upsert — mesmo padrão de ficha_comportamento: 1 registro por
// prestador+pet, atualizado ao longo do tempo, não histórico.
exports.salvarPerfil = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, nome_perfil, rotina_alimentacao, rotina_passeio, medicacao, observacoes_gerais, compatibilidade } = req.body;

    if (!perfil_id || !nome_perfil)
      return res.status(400).json({ erro: 'Dados do pet obrigatórios' });

    const result = await pool.query(
      `INSERT INTO perfil_hospedagem (usuario_id, perfil_id, nome_perfil, rotina_alimentacao, rotina_passeio, medicacao, observacoes_gerais, compatibilidade, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (usuario_id, perfil_id)
       DO UPDATE SET
         nome_perfil         = $3,
         rotina_alimentacao  = $4,
         rotina_passeio      = $5,
         medicacao           = $6,
         observacoes_gerais  = $7,
         compatibilidade     = $8,
         atualizado_em       = NOW()
       RETURNING *`,
      [usuario_id, perfil_id, nome_perfil, rotina_alimentacao || '', rotina_passeio || '', medicacao || '', observacoes_gerais || '', compatibilidade || []]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Busca o perfil de 1 pet específico ────────────────────────────
exports.buscarPerfil = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM perfil_hospedagem WHERE usuario_id = $1 AND perfil_id = $2`,
      [usuario_id, perfil_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Erro buscarPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Liga/desliga "hospedado agora" ────────────────────────────────
exports.toggleHospedadoAgora = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;
    const { hospedado_agora } = req.body;

    const result = await pool.query(
      `UPDATE perfil_hospedagem SET hospedado_agora = $1, atualizado_em = NOW()
       WHERE usuario_id = $2 AND perfil_id = $3 RETURNING *`,
      [!!hospedado_agora, usuario_id, perfil_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Perfil não encontrado — salve a rotina primeiro' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro toggleHospedadoAgora:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Todos os pets hospedados agora (pra checar compatibilidade) ──
exports.listarHospedadosAgora = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      `SELECT perfil_id, nome_perfil, compatibilidade FROM perfil_hospedagem
       WHERE usuario_id = $1 AND hospedado_agora = true
       ORDER BY nome_perfil ASC`,
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarHospedadosAgora:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};