const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Perfil do Pet + Prontuário (persistência real)
// Substitui o que até agora vivia só no AsyncStorage do celular.
// Toda operação confere que o pet pertence ao tutor logado antes
// de ler/escrever — nunca confia só no ID vindo do app.
// ═══════════════════════════════════════════════════════════════

async function pertenceAoTutor(perfil_id, tutor_id) {
  const r = await pool.query('SELECT id FROM perfis_pet WHERE id = $1 AND tutor_id = $2', [perfil_id, tutor_id]);
  return r.rows.length > 0;
}

// ── Criar novo pet ────────────────────────────────────────────
exports.criarPerfil = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { nome, especie, raca, peso, idade, avatar } = req.body;
    if (!nome || !nome.trim())
      return res.status(400).json({ erro: 'Digite o nome do pet' });

    const result = await pool.query(
      `INSERT INTO perfis_pet (tutor_id, nome, especie, raca, peso, idade, avatar)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tutor_id, nome.trim(), especie || 'cao', raca || '', peso || '', idade || '', avatar || '']
    );
    const perfil = result.rows[0];

    // Já cria a linha de prontuário vazia junto — evita ter que
    // checar "existe prontuário?" toda vez que for ler depois.
    await pool.query('INSERT INTO prontuario_pet (perfil_id) VALUES ($1)', [perfil.id]);

    // Se é o primeiro pet do tutor, já define como ativo automaticamente.
    const tutorAtual = await pool.query('SELECT perfil_ativo_id FROM usuarios WHERE id = $1', [tutor_id]);
    if (!tutorAtual.rows[0]?.perfil_ativo_id) {
      await pool.query('UPDATE usuarios SET perfil_ativo_id = $1 WHERE id = $2', [perfil.id, tutor_id]);
    }

    res.status(201).json(perfil);
  } catch (err) {
    console.error('Erro criarPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Listar todos os pets do tutor logado ─────────────────────
exports.listarMeusPerfis = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const result = await pool.query(
      'SELECT * FROM perfis_pet WHERE tutor_id = $1 ORDER BY criado_em ASC',
      [tutor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMeusPerfis:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Buscar 1 perfil específico ────────────────────────────────
exports.buscarPerfil = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM perfis_pet WHERE id = $1 AND tutor_id = $2',
      [id, tutor_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Pet não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Editar dados do pet ───────────────────────────────────────
exports.atualizarPerfil = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    if (!(await pertenceAoTutor(id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { nome, especie, raca, peso, idade, avatar } = req.body;
    const result = await pool.query(
      `UPDATE perfis_pet SET
        nome = COALESCE($1, nome), especie = COALESCE($2, especie),
        raca = COALESCE($3, raca), peso = COALESCE($4, peso),
        idade = COALESCE($5, idade), avatar = COALESCE($6, avatar)
       WHERE id = $7 RETURNING *`,
      [nome, especie, raca, peso, idade, avatar, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Excluir pet ────────────────────────────────────────────────
exports.excluirPerfil = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    if (!(await pertenceAoTutor(id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    await pool.query('DELETE FROM perfis_pet WHERE id = $1', [id]);

    // Se esse era o perfil ativo, limpa a referência (senão fica
    // apontando pra um pet que não existe mais).
    await pool.query(
      'UPDATE usuarios SET perfil_ativo_id = NULL WHERE id = $1 AND perfil_ativo_id = $2',
      [tutor_id, id]
    );
    res.json({ mensagem: 'Pet removido' });
  } catch (err) {
    console.error('Erro excluirPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Definir qual pet está ativo agora ─────────────────────────
exports.definirPerfilAtivo = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.body;
    if (!(await pertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    await pool.query('UPDATE usuarios SET perfil_ativo_id = $1 WHERE id = $2', [perfil_id, tutor_id]);
    res.json({ mensagem: 'Perfil ativo atualizado' });
  } catch (err) {
    console.error('Erro definirPerfilAtivo:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Buscar o perfil ativo completo ────────────────────────────
// ✅ Rede de segurança: se por algum motivo não tiver nenhum ativo
// definido (conta antiga, ou acabou de excluir o que era ativo),
// cai automaticamente no primeiro pet cadastrado do tutor — nunca
// retorna "vazio" se existir pelo menos 1 pet de verdade.
exports.buscarPerfilAtivo = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const tutorResult = await pool.query('SELECT perfil_ativo_id FROM usuarios WHERE id = $1', [tutor_id]);
    let perfilId = tutorResult.rows[0]?.perfil_ativo_id;

    let perfil;
    if (perfilId) {
      const r = await pool.query('SELECT * FROM perfis_pet WHERE id = $1 AND tutor_id = $2', [perfilId, tutor_id]);
      perfil = r.rows[0];
    }
    if (!perfil) {
      const r = await pool.query('SELECT * FROM perfis_pet WHERE tutor_id = $1 ORDER BY criado_em ASC LIMIT 1', [tutor_id]);
      perfil = r.rows[0];
      if (perfil) await pool.query('UPDATE usuarios SET perfil_ativo_id = $1 WHERE id = $2', [perfil.id, tutor_id]);
    }
    if (!perfil) return res.status(404).json({ erro: 'Nenhum pet cadastrado ainda' });
    res.json(perfil);
  } catch (err) {
    console.error('Erro buscarPerfilAtivo:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════ PRONTUÁRIO ═══════════════════════════════

// ── Buscar prontuário de um pet ───────────────────────────────
exports.buscarProntuario = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.params;
    if (!(await pertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const result = await pool.query('SELECT * FROM prontuario_pet WHERE perfil_id = $1', [perfil_id]);
    if (result.rows.length === 0) {
      // Rede de segurança: cria na hora se por algum motivo não existir
      // (pet cadastrado antes dessa tabela existir, por exemplo).
      const criado = await pool.query('INSERT INTO prontuario_pet (perfil_id) VALUES ($1) RETURNING *', [perfil_id]);
      return res.json(criado.rows[0]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarProntuario:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualizar campos do prontuário (parcial) ──────────────────
exports.atualizarProntuario = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.params;
    if (!(await pertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { alergias, condicoes, cirurgias, exames, medicamentos, observacoes } = req.body;
    const result = await pool.query(
      `UPDATE prontuario_pet SET
        alergias     = COALESCE($1, alergias),
        condicoes    = COALESCE($2, condicoes),
        cirurgias    = COALESCE($3, cirurgias),
        exames       = COALESCE($4, exames),
        medicamentos = COALESCE($5, medicamentos),
        observacoes  = COALESCE($6, observacoes),
        atualizado_em = NOW()
       WHERE perfil_id = $7 RETURNING *`,
      [
        alergias ? JSON.stringify(alergias) : null,
        condicoes ? JSON.stringify(condicoes) : null,
        cirurgias ? JSON.stringify(cirurgias) : null,
        exames ? JSON.stringify(exames) : null,
        medicamentos ? JSON.stringify(medicamentos) : null,
        observacoes,
        perfil_id,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarProntuario:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualizar vacinas (substitui o objeto inteiro) ────────────
exports.atualizarVacinas = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_id } = req.params;
    if (!(await pertenceAoTutor(perfil_id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { vacinas } = req.body;
    if (!vacinas || typeof vacinas !== 'object')
      return res.status(400).json({ erro: 'Dados de vacina inválidos' });

    const result = await pool.query(
      `UPDATE prontuario_pet SET vacinas = $1, atualizado_em = NOW() WHERE perfil_id = $2 RETURNING vacinas`,
      [JSON.stringify(vacinas), perfil_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarVacinas:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Foto de verdade do pet (upload real, mesmo padrão de fotos de
// profissional) ─────────────────────────────────────────────────
// ✅ NOVO: antes, uma foto escolhida da galeria salvava só o caminho
// local do celular (file://...) — não existia em lugar nenhum
// acessível por outro dispositivo. Agora recebe a imagem em base64 e
// guarda de verdade no servidor, no mesmo campo "avatar" (que já
// aceitava emoji como texto — base64 é só mais um tipo de texto).
exports.atualizarFotoPet = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    if (!(await pertenceAoTutor(id, tutor_id)))
      return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    const { foto_base64 } = req.body;
    if (!foto_base64) return res.status(400).json({ erro: 'Imagem não fornecida' });

    const result = await pool.query(
      'UPDATE perfis_pet SET avatar = $1 WHERE id = $2 RETURNING avatar',
      [foto_base64, id]
    );
    res.json({ mensagem: 'Foto atualizada com sucesso', avatar: result.rows[0].avatar });
  } catch (err) {
    console.error('Erro atualizarFotoPet:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};