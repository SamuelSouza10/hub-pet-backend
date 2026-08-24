const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: rastreamento ao vivo do passeio/serviço — versão simples,
// sem tracking em background. O app do prestador manda a posição a
// cada ~20-30s enquanto está aberto durante o atendimento; o app do
// tutor busca a posição mais recente no mesmo intervalo. Só aceita
// pontos novos se o check-in do atendimento estiver "em_atendimento"
// — evita rastrear fora da janela do serviço de verdade.
// ═══════════════════════════════════════════════════════════════

// ── Confere se quem está chamando tem relação com essa consulta ──
async function autorizado(consulta_id, usuario_id) {
  const r = await pool.query(
    'SELECT paciente_id, medico_id FROM consultas WHERE id = $1',
    [consulta_id]
  );
  if (r.rows.length === 0) return false;
  const c = r.rows[0];
  return c.paciente_id === usuario_id || c.medico_id === usuario_id;
}

// ── Prestador salva um ponto de localização durante o serviço ────
exports.salvarPonto = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const { consulta_id } = req.params;
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined)
      return res.status(400).json({ erro: 'Localização inválida' });

    const consulta = await pool.query('SELECT medico_id FROM consultas WHERE id = $1', [consulta_id]);
    if (consulta.rows.length === 0 || consulta.rows[0].medico_id !== medico_id)
      return res.status(403).json({ erro: 'Sem permissão' });

    const checkin = await pool.query(
      "SELECT status_dia FROM checkin_atendimento WHERE consulta_id = $1",
      [consulta_id]
    );
    if (checkin.rows.length === 0 || checkin.rows[0].status_dia !== 'em_atendimento')
      return res.status(400).json({ erro: 'Atendimento não está em andamento' });

    const result = await pool.query(
      `INSERT INTO rastreamento_pontos (consulta_id, latitude, longitude)
       VALUES ($1, $2, $3) RETURNING *`,
      [consulta_id, latitude, longitude]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarPonto:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista os pontos do trajeto (pro tutor ver o caminho no mapa) ─
exports.listarPontos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { consulta_id } = req.params;

    if (!(await autorizado(consulta_id, usuario_id)))
      return res.status(403).json({ erro: 'Sem permissão' });

    const result = await pool.query(
      'SELECT latitude, longitude, criado_em FROM rastreamento_pontos WHERE consulta_id = $1 ORDER BY criado_em ASC',
      [consulta_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPontos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Prestador registra uma foto durante o serviço ─────────────────
exports.salvarFotoPasseio = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const { consulta_id } = req.params;
    const { foto_url, legenda } = req.body;

    if (!foto_url) return res.status(400).json({ erro: 'Foto obrigatória' });

    const consulta = await pool.query('SELECT medico_id FROM consultas WHERE id = $1', [consulta_id]);
    if (consulta.rows.length === 0 || consulta.rows[0].medico_id !== medico_id)
      return res.status(403).json({ erro: 'Sem permissão' });

    const result = await pool.query(
      `INSERT INTO fotos_passeio (consulta_id, foto_url, legenda)
       VALUES ($1, $2, $3) RETURNING *`,
      [consulta_id, foto_url, legenda || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarFotoPasseio:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista as fotos do passeio ──────────────────────────────────────
exports.listarFotosPasseio = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { consulta_id } = req.params;

    if (!(await autorizado(consulta_id, usuario_id)))
      return res.status(403).json({ erro: 'Sem permissão' });

    const result = await pool.query(
      'SELECT * FROM fotos_passeio WHERE consulta_id = $1 ORDER BY criado_em ASC',
      [consulta_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFotosPasseio:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};