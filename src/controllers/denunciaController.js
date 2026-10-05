const pool = require('../database');

// ═══════════════════════════════════════════════════════════
// H.U.B. Pet — Denúncia de Maus-Tratos Animal
// Qualquer usuário logado (tutor ou profissional) pode denunciar,
// vinculando a um profissional cadastrado no app ou de forma livre.
// "manter_anonimo" esconde a identidade do denunciante DO ADMIN, mas
// o backend sempre sabe quem enviou (evita spam/denúncia falsa em massa).
// ═══════════════════════════════════════════════════════════

// ── Criar denúncia (qualquer usuário logado) ─────────────────────
exports.criarDenuncia = async (req, res) => {
  try {
    const denunciante_id = req.usuario.id;
    const { manter_anonimo, profissional_id, nome_livre, descricao, local, data_ocorrido, fotos } = req.body;

    if (!descricao || !descricao.trim())
      return res.status(400).json({ erro: 'Descreva o que aconteceu' });

    // ✅ Precisa de ALGUMA identificação de quem está sendo denunciado
    // — ou um profissional real do app, ou uma descrição livre (nome,
    // local, características). Denúncia sem nenhum dos dois fica vaga
    // demais pra qualquer ação futura.
    if (!profissional_id && !(nome_livre && nome_livre.trim()))
      return res.status(400).json({ erro: 'Informe quem está sendo denunciado — um profissional cadastrado ou uma descrição de quem/onde' });

    const result = await pool.query(
      `INSERT INTO denuncias_maus_tratos
        (denunciante_id, manter_anonimo, profissional_id, nome_livre, descricao, local, data_ocorrido, fotos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, criado_em`,
      [
        denunciante_id, !!manter_anonimo, profissional_id || null, nome_livre || '',
        descricao.trim(), local || '', data_ocorrido || '', Array.isArray(fotos) ? fotos : [],
      ]
    );

    res.status(201).json({
      id: result.rows[0].id,
      mensagem: 'Denúncia registrada. Nossa equipe vai analisar o quanto antes.',
    });
  } catch (err) {
    console.error('Erro criarDenuncia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Minhas denúncias (quem denunciou, acompanha o status) ────────
exports.minhasDenuncias = async (req, res) => {
  try {
    const denunciante_id = req.usuario.id;
    const result = await pool.query(
      `SELECT d.id, d.descricao, d.local, d.data_ocorrido, d.status, d.criado_em,
              d.nome_livre, u.nome AS profissional_nome
       FROM denuncias_maus_tratos d
       LEFT JOIN usuarios u ON u.id = d.profissional_id
       WHERE d.denunciante_id = $1
       ORDER BY d.criado_em DESC`,
      [denunciante_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro minhasDenuncias:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: listar todas as denúncias ──────────────────────────────
// ✅ A identidade do denunciante já sai filtrada aqui no SQL — quando
// manter_anonimo = true, o admin nunca recebe nome nem e-mail, não é
// só escondido na tela (mais seguro que filtrar só no frontend).
exports.listarDenunciasAdmin = async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'WHERE d.status = $1';
    }
    const result = await pool.query(
      `SELECT
        d.id, d.descricao, d.local, d.data_ocorrido, d.fotos, d.status,
        d.observacao_admin, d.criado_em, d.manter_anonimo,
        d.profissional_id, d.nome_livre,
        CASE WHEN d.manter_anonimo THEN NULL ELSE u.nome END AS denunciante_nome,
        CASE WHEN d.manter_anonimo THEN NULL ELSE u.email END AS denunciante_email,
        up.nome AS profissional_nome,
        mp.status_verificacao AS profissional_status
       FROM denuncias_maus_tratos d
       JOIN usuarios u ON u.id = d.denunciante_id
       LEFT JOIN usuarios up ON up.id = d.profissional_id
       LEFT JOIN medicos mp ON mp.usuario_id = d.profissional_id
       ${where}
       ORDER BY
         CASE d.status WHEN 'em_analise' THEN 0 WHEN 'procedente' THEN 1 ELSE 2 END,
         d.criado_em DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarDenunciasAdmin:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: atualizar status + observação ──────────────────────────
exports.atualizarStatusDenuncia = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, observacao_admin } = req.body;

    if (!['em_analise', 'procedente', 'improcedente'].includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    const result = await pool.query(
      `UPDATE denuncias_maus_tratos
       SET status = $1, observacao_admin = $2, atualizado_em = NOW()
       WHERE id = $3 RETURNING id`,
      [status, observacao_admin || '', id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Denúncia não encontrada' });

    res.json({ mensagem: 'Status atualizado' });
  } catch (err) {
    console.error('Erro atualizarStatusDenuncia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: suspender o profissional denunciado ────────────────────
// ✅ Reaproveita status_verificacao = 'reprovado', o mesmo campo que já
// bloqueia login de cadastro reprovado — não precisa de coluna nova,
// e o profissional já recebe a mensagem de bloqueio existente ao
// tentar entrar.
exports.suspenderProfissionalDenunciado = async (req, res) => {
  try {
    const { id } = req.params; // id da denúncia
    const denuncia = await pool.query('SELECT profissional_id FROM denuncias_maus_tratos WHERE id = $1', [id]);
    if (denuncia.rows.length === 0) return res.status(404).json({ erro: 'Denúncia não encontrada' });
    if (!denuncia.rows[0].profissional_id)
      return res.status(400).json({ erro: 'Essa denúncia não está vinculada a um profissional cadastrado no app' });

    await pool.query(
      "UPDATE medicos SET status_verificacao = 'reprovado' WHERE usuario_id = $1",
      [denuncia.rows[0].profissional_id]
    );
    await pool.query(
      "UPDATE denuncias_maus_tratos SET status = 'procedente', atualizado_em = NOW() WHERE id = $1",
      [id]
    );

    res.json({ mensagem: 'Profissional suspenso e denúncia marcada como procedente' });
  } catch (err) {
    console.error('Erro suspenderProfissionalDenunciado:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};