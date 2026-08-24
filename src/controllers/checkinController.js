const pool = require('../database');

// ✅ Helper de push notification — mesmo padrão já usado em outros controllers.
async function enviarPush(pushToken, titulo, corpo) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title: titulo, body: corpo, sound: 'default', priority: 'high' }),
    });
  } catch (e) {
    console.error('Erro enviarPush checkin:', e.message);
  }
}

const PROXIMO = {
  aguardando:      'chegou',
  chegou:          'em_atendimento',
  em_atendimento:  'concluido',
};

const COLUNA_HORA = {
  chegou:          'hora_chegou',
  em_atendimento:  'hora_iniciou',
  concluido:       'hora_concluido',
};

// ── Avança o status do dia (aguardando → chegou → em atendimento → concluído) ─
// ✅ Recurso Pro. Quando chega em "concluido", avisa o tutor por push.
exports.avancarStatus = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { consulta_id } = req.body;
    if (!consulta_id) return res.status(400).json({ erro: 'consulta_id é obrigatório' });

    // Confirma que esse agendamento é mesmo desse petshop
    const consultaCheck = await pool.query(
      'SELECT id, paciente_id, nome_perfil FROM consultas WHERE id = $1 AND medico_id = $2',
      [consulta_id, usuario_id]
    );
    if (consultaCheck.rows.length === 0)
      return res.status(403).json({ erro: 'Esse agendamento não pertence a você' });

    const consulta = consultaCheck.rows[0];

    // Busca (ou cria) o registro de checkin
    let atual = await pool.query('SELECT * FROM checkin_atendimento WHERE consulta_id = $1', [consulta_id]);
    if (atual.rows.length === 0) {
      await pool.query(
        'INSERT INTO checkin_atendimento (consulta_id, usuario_id) VALUES ($1, $2)',
        [consulta_id, usuario_id]
      );
      atual = await pool.query('SELECT * FROM checkin_atendimento WHERE consulta_id = $1', [consulta_id]);
    }

    const statusAtual = atual.rows[0].status_dia;
    const proximoStatus = PROXIMO[statusAtual];
    if (!proximoStatus)
      return res.status(400).json({ erro: 'Esse atendimento já foi concluído' });

    const colunaHora = COLUNA_HORA[proximoStatus];
    const result = await pool.query(
      `UPDATE checkin_atendimento SET status_dia = $1, ${colunaHora} = NOW(), atualizado_em = NOW()
       WHERE consulta_id = $2 RETURNING *`,
      [proximoStatus, consulta_id]
    );

    // Avisa o tutor quando concluir
    if (proximoStatus === 'concluido') {
      const tutorInfo = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [consulta.paciente_id]);
      await enviarPush(
        tutorInfo.rows[0]?.push_token,
        '✅ Atendimento concluído!',
        `${consulta.nome_perfil || 'Seu pet'} já está pronto. Pode vir buscar!`
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro avancarStatus:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Busca o status atual de um agendamento ────────────────────────
exports.buscarStatus = async (req, res) => {
  try {
    const { consulta_id } = req.params;
    const result = await pool.query('SELECT * FROM checkin_atendimento WHERE consulta_id = $1', [consulta_id]);
    res.json(result.rows[0] || { status_dia: 'aguardando' });
  } catch (err) {
    console.error('Erro buscarStatus:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: fila de espera do dia — visão em lista de todos os
// agendamentos confirmados de hoje, cada um já com seu status de
// checkin (aguardando/chegou/em_atendimento/concluido). Reaproveita
// a mesma tabela checkin_atendimento, só muda pra visão agregada em
// vez de item único (que é o que checkinatendimento.tsx já faz).
// Recurso Pro — pensado pra clínica com volume de pacientes no dia.
// ═══════════════════════════════════════════════════════════════
exports.listarFilaHoje = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const hoje = new Date();
    const dataHoje = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

    const result = await pool.query(`
      SELECT c.id AS consulta_id, c.nome_perfil, c.horario, c.especialidade,
             COALESCE(ch.status_dia, 'aguardando') AS status_dia
      FROM consultas c
      LEFT JOIN checkin_atendimento ch ON ch.consulta_id = c.id
      WHERE c.medico_id = $1 AND c.data = $2 AND c.status = 'aceito'
      ORDER BY c.horario ASC
    `, [usuario_id, dataHoje]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarFilaHoje:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};