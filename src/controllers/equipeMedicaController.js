const pool = require('../database');

// ✅ NOVO: cadastro de equipe médica — não é recurso Pro, é fundação.
// Sem isso a clínica não tem como emitir receituário/atestado de
// jeito nenhum (documento legal precisa de CRMV individual, não
// institucional), então mantém aberto pro plano Grátis também.

// ── Lista a equipe da clínica logada ──────────────────────────────
exports.listarEquipe = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const result = await pool.query(
      'SELECT * FROM equipe_medica WHERE clinica_id = $1 ORDER BY ativo DESC, nome ASC',
      [clinica_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarEquipe:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Adiciona um veterinário na equipe ─────────────────────────────
exports.adicionarMembro = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const { nome, crm, especialidade, carimbo_url } = req.body;
    if (!nome?.trim() || !crm?.trim())
      return res.status(400).json({ erro: 'Nome e CRMV são obrigatórios' });

    const result = await pool.query(
      `INSERT INTO equipe_medica (clinica_id, nome, crm, especialidade, carimbo_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [clinica_id, nome.trim(), crm.trim(), especialidade || '', carimbo_url || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro adicionarMembro:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualiza um membro da equipe ──────────────────────────────────
exports.atualizarMembro = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const { id } = req.params;
    const { nome, crm, especialidade, carimbo_url, ativo } = req.body;

    const result = await pool.query(
      `UPDATE equipe_medica
       SET nome = $1, crm = $2, especialidade = $3, carimbo_url = $4, ativo = $5
       WHERE id = $6 AND clinica_id = $7 RETURNING *`,
      [nome, crm, especialidade || '', carimbo_url || '', ativo ?? true, id, clinica_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Membro não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarMembro:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Remove um membro da equipe ────────────────────────────────────
// ✅ Remoção real, não só "inativar" — se a clínica quiser manter
// histórico de receitas já emitidas por esse veterinário, o ideal é
// usar "ativo = false" em vez de deletar. Aqui deixo o delete
// disponível pra correção de cadastro errado.
exports.removerMembro = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM equipe_medica WHERE id = $1 AND clinica_id = $2 RETURNING id',
      [id, clinica_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Membro não encontrado' });
    res.json({ mensagem: 'Membro removido' });
  } catch (err) {
    console.error('Erro removerMembro:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};