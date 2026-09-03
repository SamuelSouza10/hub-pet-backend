const pool = require('../database');

// ✅ NOVO: registro de sessão de treino — cada sessão é um registro
// novo (histórico acumulado, como fichas_atendimento).
exports.criarSessao = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, nome_perfil, trabalhado, reacao, tarefa_casa } = req.body;

    if (!perfil_id || !nome_perfil)
      return res.status(400).json({ erro: 'Dados do pet obrigatórios' });

    const result = await pool.query(
      `INSERT INTO treinamento_sessoes (usuario_id, perfil_id, nome_perfil, trabalhado, reacao, tarefa_casa)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [usuario_id, perfil_id, nome_perfil, trabalhado || '', reacao || '', tarefa_casa || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarSessao:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Histórico de sessões de um pet específico ────────────────────
exports.listarSessoes = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM treinamento_sessoes WHERE usuario_id = $1 AND perfil_id = $2 ORDER BY criado_em DESC`,
      [usuario_id, perfil_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarSessoes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Checklist de comandos de um pet específico ────────────────────
// Só retorna o que já foi tocado alguma vez — a lista fixa de
// comandos possíveis (Sentar, Ficar...) fica no frontend, mesclada
// com isso aqui pra exibição.
exports.listarComandos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id } = req.params;

    const result = await pool.query(
      `SELECT comando, status, atualizado_em FROM treinamento_comandos WHERE usuario_id = $1 AND perfil_id = $2`,
      [usuario_id, perfil_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarComandos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualiza o status de 1 comando — upsert ───────────────────────
exports.atualizarComando = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { perfil_id, comando, status } = req.body;

    if (!['nao_iniciado', 'em_progresso', 'dominado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido' });
    if (!perfil_id || !comando)
      return res.status(400).json({ erro: 'Dados obrigatórios faltando' });

    const result = await pool.query(
      `INSERT INTO treinamento_comandos (usuario_id, perfil_id, comando, status, atualizado_em)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (usuario_id, perfil_id, comando)
       DO UPDATE SET status = $4, atualizado_em = NOW()
       RETURNING *`,
      [usuario_id, perfil_id, comando, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarComando:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};