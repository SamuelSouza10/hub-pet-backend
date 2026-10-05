const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Lembretes (Categoria 2: dado real, menos crítico que
// o prontuário, mas ainda merece persistir de verdade).
// ═══════════════════════════════════════════════════════════════

// ── Lembretes pessoais do profissional (lista de tarefas simples) ─
exports.listarLembretesProfissional = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT * FROM lembretes_profissional WHERE usuario_id = $1 ORDER BY criado_em ASC',
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarLembretesProfissional:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.criarLembreteProfissional = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { texto } = req.body;
    if (!texto || !texto.trim()) return res.status(400).json({ erro: 'Digite o lembrete' });
    const result = await pool.query(
      'INSERT INTO lembretes_profissional (usuario_id, texto) VALUES ($1, $2) RETURNING *',
      [usuario_id, texto.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarLembreteProfissional:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.atualizarLembreteProfissional = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { feito, texto } = req.body;
    const result = await pool.query(
      `UPDATE lembretes_profissional SET
        feito = COALESCE($1, feito), texto = COALESCE($2, texto)
       WHERE id = $3 AND usuario_id = $4 RETURNING *`,
      [feito, texto, id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Lembrete não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarLembreteProfissional:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.excluirLembreteProfissional = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    await pool.query('DELETE FROM lembretes_profissional WHERE id = $1 AND usuario_id = $2', [id, usuario_id]);
    res.json({ mensagem: 'Removido' });
  } catch (err) {
    console.error('Erro excluirLembreteProfissional:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lembretes de medicação/rotina do pet ──────────────────────────
async function petPertenceAoTutor(perfil_id, tutor_id) {
  const r = await pool.query('SELECT id FROM perfis_pet WHERE id = $1 AND tutor_id = $2', [perfil_id, tutor_id]);
  return r.rows.length > 0;
}

exports.listarLembretesPet = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.params;
    if (!(await petPertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const result = await pool.query('SELECT * FROM lembretes_pet WHERE perfil_id = $1 ORDER BY criado_em ASC', [perfil_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarLembretesPet:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.criarLembretePet = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.params;
    if (!(await petPertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { nome, dose, horas, dias, ativo } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Digite o nome do lembrete' });

    const result = await pool.query(
      `INSERT INTO lembretes_pet (perfil_id, nome, dose, horas, dias, ativo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [perfil_id, nome.trim(), dose || '', JSON.stringify(horas || []), JSON.stringify(dias || []), ativo !== false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarLembretePet:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.atualizarLembretePet = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id, id } = req.params;
    if (!(await petPertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { nome, dose, horas, dias, ativo } = req.body;
    const result = await pool.query(
      `UPDATE lembretes_pet SET
        nome = COALESCE($1, nome), dose = COALESCE($2, dose),
        horas = COALESCE($3, horas), dias = COALESCE($4, dias),
        ativo = COALESCE($5, ativo)
       WHERE id = $6 AND perfil_id = $7 RETURNING *`,
      [nome, dose, horas ? JSON.stringify(horas) : null, dias ? JSON.stringify(dias) : null, ativo, id, perfil_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Lembrete não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarLembretePet:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.excluirLembretePet = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id, id } = req.params;
    if (!(await petPertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    await pool.query('DELETE FROM lembretes_pet WHERE id = $1 AND perfil_id = $2', [id, perfil_id]);
    res.json({ mensagem: 'Removido' });
  } catch (err) {
    console.error('Erro excluirLembretePet:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};