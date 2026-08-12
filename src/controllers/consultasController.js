// ── Helper: enviar notificação push via Expo ──────────────────
async function enviarPush(pushToken, titulo, corpo) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: pushToken,
        title: titulo,
        body: corpo,
        sound: 'default',
        priority: 'high',
      }),
    });
  } catch (e) {
    console.error('Erro enviarPush:', e.message);
  }
}

const pool = require('../database');

// ── Criar consulta (paciente solicita) ────────────────────────
exports.criarConsulta = async (req, res) => {
  try {
    const { medico_id, data, horario, dia, especialidade, endereco, plano, observacao, perfil_id, nome_perfil, foto_perfil } = req.body;
    const paciente_id = req.usuario.id;

    if (!medico_id || !data || !horario)
      return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });

    const result = await pool.query(`
      INSERT INTO consultas (paciente_id, medico_id, data, horario, dia, especialidade, endereco, plano, observacao, perfil_id, nome_perfil, foto_perfil)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [paciente_id, medico_id, data, horario, dia, especialidade, endereco, plano, observacao, perfil_id || null, nome_perfil || null, foto_perfil || null]);

    const novaConsulta = result.rows[0];

    const nomePaciente = (nome_perfil && String(nome_perfil).trim()) 
      ? String(nome_perfil).trim() 
      : await pool.query('SELECT nome FROM usuarios WHERE id = $1', [paciente_id])
          .then(r => r.rows[0]?.nome || 'Um paciente');
    console.log('DEBUG criarConsulta - paciente_id:', paciente_id, 'nome_perfil:', nome_perfil, 'nomePaciente:', nomePaciente);

    const medicoNotif = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [medico_id]);
    await enviarPush(
      medicoNotif.rows[0]?.push_token,
      '📅 Nova consulta solicitada!',
      `${nomePaciente} solicitou uma consulta para ${data} às ${horario}.`
    );

    res.status(201).json(novaConsulta);
  } catch (err) {
    console.error('Erro criarConsulta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.consultasMedico = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const result = await pool.query(`
      SELECT 
        c.*, u.nome AS paciente_nome, u.email AS paciente_email,
        '' AS paciente_foto, 'adulto' AS perfil_tipo
      FROM consultas c
      JOIN usuarios u ON u.id = c.paciente_id
      WHERE c.medico_id = $1
      ORDER BY c.criado_em DESC
    `, [medico_id]);
    const rows = result.rows.map(r => ({
      ...r,
      paciente_nome: r.nome_perfil || r.paciente_nome,
      paciente_foto: r.foto_perfil || '',
    }));
    res.json(rows);
  } catch (err) {
    console.error('Erro consultasMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.consultasPaciente = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const { perfil_id } = req.query;
    let result;
    if (perfil_id) {
      result = await pool.query(`
        SELECT c.*, u.nome AS medico_nome, u.email AS medico_email,
          m.especialidade, m.foto_url, m.telefone AS medico_telefone
        FROM consultas c
        JOIN usuarios u ON u.id = c.medico_id
        LEFT JOIN medicos m ON m.usuario_id = c.medico_id
        WHERE c.paciente_id = $1 AND c.perfil_id = $2
        ORDER BY c.criado_em DESC
      `, [paciente_id, perfil_id]);
    } else {
      result = await pool.query(`
        SELECT c.*, u.nome AS medico_nome, u.email AS medico_email,
          m.especialidade, m.foto_url, m.telefone AS medico_telefone
        FROM consultas c
        JOIN usuarios u ON u.id = c.medico_id
        LEFT JOIN medicos m ON m.usuario_id = c.medico_id
        WHERE c.paciente_id = $1
        ORDER BY c.criado_em DESC
      `, [paciente_id]);
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Erro consultasPaciente:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.responderConsulta = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const medico_id = req.usuario.id;
    if (!['aceito', 'recusado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido' });
    const result = await pool.query(`
      UPDATE consultas SET status = $1 WHERE id = $2 AND medico_id = $3 RETURNING *
    `, [status, id, medico_id]);
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    const consulta = result.rows[0];
    const medicoInfo = await pool.query('SELECT nome FROM usuarios WHERE id = $1', [medico_id]);
    const nomeMedico = medicoInfo.rows[0]?.nome || 'O médico';
    const pacienteInfo = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [consulta.paciente_id]);
    const pushToken = pacienteInfo.rows[0]?.push_token;
    if (status === 'aceito') {
      await enviarPush(pushToken, '✅ Consulta confirmada!', `${nomeMedico} confirmou sua consulta para ${consulta.data} às ${consulta.horario}.`);
    } else {
      await enviarPush(pushToken, '❌ Consulta recusada', `${nomeMedico} não pôde atender sua solicitação para ${consulta.data}.`);
    }
    res.json(consulta);
  } catch (err) {
    console.error('Erro responderConsulta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.cancelarConsulta = async (req, res) => {
  try {
    const { id } = req.params;
    const paciente_id = req.usuario.id;
    const result = await pool.query(`
      DELETE FROM consultas WHERE id = $1 AND paciente_id = $2 RETURNING *
    `, [id, paciente_id]);
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    res.json({ mensagem: 'Consulta cancelada com sucesso' });
  } catch (err) {
    console.error('Erro cancelarConsulta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.horariosOcupados = async (req, res) => {
  try {
    const { medico_id } = req.params;
    const result = await pool.query(`
      SELECT data, horario, dia FROM consultas
      WHERE medico_id = $1
        AND (status IN ('pendente', 'aceito', 'remarcar_pendente') OR remarcar_status = 'recusado')
      UNION
      SELECT remarcar_data AS data, remarcar_horario AS horario, dia FROM consultas
      WHERE medico_id = $1 AND status = 'remarcar_pendente' AND remarcar_data IS NOT NULL
    `, [medico_id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro horariosOcupados:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.salvarConfigAgenda = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const { diasAtivos, horariosAtivos, duracaoAtiva, valorConsulta, diasBloqueados } = req.body;
    await pool.query(`
      INSERT INTO agenda_config (medico_id, dias_ativos, horarios_ativos, duracao, valor_consulta, dias_bloqueados)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (medico_id) DO UPDATE SET
        dias_ativos = EXCLUDED.dias_ativos, horarios_ativos = EXCLUDED.horarios_ativos,
        duracao = EXCLUDED.duracao, valor_consulta = EXCLUDED.valor_consulta,
        dias_bloqueados = EXCLUDED.dias_bloqueados, atualizado_em = NOW()
    `, [
      medico_id, JSON.stringify(diasAtivos || {}), JSON.stringify(horariosAtivos || {}),
      duracaoAtiva || '30 min', valorConsulta || '150,00', JSON.stringify(diasBloqueados || []),
    ]);
    res.json({ mensagem: 'Configuração salva com sucesso' });
  } catch (err) {
    console.error('Erro salvarConfigAgenda:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.getConfigAgenda = async (req, res) => {
  try {
    const { medico_id } = req.params;
    const result = await pool.query('SELECT * FROM agenda_config WHERE medico_id = $1', [medico_id]);
    if (result.rows.length === 0)
      return res.json({ horarios_ativos: {}, dias_ativos: {}, duracao: '30 min', valor_consulta: '150,00', dias_bloqueados: [] });
    const r = result.rows[0];
    res.json({
      horarios_ativos: r.horarios_ativos, dias_ativos: r.dias_ativos,
      duracao: r.duracao, valor_consulta: r.valor_consulta, dias_bloqueados: r.dias_bloqueados,
    });
  } catch (err) {
    console.error('Erro getConfigAgenda:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.marcarStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const medico_id = req.usuario.id;
    if (!['concluida', 'falta'].includes(status))
      return res.status(400).json({ erro: 'Status inválido' });
    const result = await pool.query(
      'UPDATE consultas SET status = $1 WHERE id = $2 AND medico_id = $3 RETURNING *',
      [status, id, medico_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    const consultaStatus = result.rows[0];
    const pacienteStatus = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [consultaStatus.paciente_id]);
    const pushTokenStatus = pacienteStatus.rows[0]?.push_token;
    if (status === 'falta') {
      await enviarPush(pushTokenStatus, '⚠️ Falta registrada', 'O médico registrou sua ausência. Verifique as regras do H.U.B.');
    } else if (status === 'concluida') {
      await enviarPush(pushTokenStatus, '✅ Consulta concluída', 'Sua consulta foi marcada como concluída.');
    }
    if (status === 'falta') {
      const paciente = await pool.query('SELECT faltas FROM usuarios WHERE id = $1', [consultaStatus.paciente_id]);
      const faltas = (paciente.rows[0]?.faltas || 0) + 1;
      let bloqueadoAte = new Date();
      if (faltas === 1) bloqueadoAte.setDate(bloqueadoAte.getDate() + 15);
      else if (faltas === 2) bloqueadoAte.setDate(bloqueadoAte.getDate() + 30);
      else bloqueadoAte.setDate(bloqueadoAte.getDate() + 99999);
      await pool.query('UPDATE usuarios SET faltas = $1, bloqueado_ate = $2 WHERE id = $3', [faltas, bloqueadoAte, consultaStatus.paciente_id]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro marcarStatus:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.remarcarConsulta = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarcar_data, remarcar_horario } = req.body;
    const medico_id = req.usuario.id;
    const result = await pool.query(
      `UPDATE consultas SET remarcar_data = $1, remarcar_horario = $2, remarcar_status = 'pendente', status = 'remarcar_pendente'
       WHERE id = $3 AND medico_id = $4 RETURNING *`,
      [remarcar_data, remarcar_horario, id, medico_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    const consultaRemarcar = result.rows[0];
    const pacienteRemarcar = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [consultaRemarcar.paciente_id]);
    await enviarPush(
      pacienteRemarcar.rows[0]?.push_token,
      '🔄 Remarcação proposta',
      `O médico propôs remarcar sua consulta para ${remarcar_data} às ${remarcar_horario}. Aceite ou recuse no app.`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro remarcarConsulta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.responderRemarcacao = async (req, res) => {
  try {
    const { id } = req.params;
    const { aceitar } = req.body;
    const paciente_id = req.usuario.id;
    const consulta = await pool.query('SELECT * FROM consultas WHERE id = $1 AND paciente_id = $2', [id, paciente_id]);
    if (consulta.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    const c = consulta.rows[0];
    if (aceitar) {
      await pool.query(
        `UPDATE consultas SET data = $1, horario = $2, status = 'aceito', remarcar_status = 'aceito',
             remarcar_data = NULL, remarcar_horario = NULL WHERE id = $3`,
        [c.remarcar_data, c.remarcar_horario, id]
      );
    } else {
      await pool.query(
        `UPDATE consultas SET status = 'cancelada', remarcar_status = 'recusado',
             remarcar_data = NULL, remarcar_horario = NULL WHERE id = $1`,
        [id]
      );
    }
    const updatedConsulta = await pool.query(
      'SELECT c.*, u.push_token, u.nome FROM consultas c JOIN usuarios u ON u.id = c.medico_id WHERE c.id = $1',
      [id]
    );
    const medicoInfo = updatedConsulta.rows[0];
    const pacienteNomeInfo = await pool.query('SELECT nome FROM usuarios WHERE id = $1', [paciente_id]);
    const nomePaciente = c.nome_perfil || pacienteNomeInfo.rows[0]?.nome || 'Paciente';
    if (aceitar) {
      await enviarPush(medicoInfo?.push_token, '✅ Remarcação aceita!', `${nomePaciente} aceitou a nova data da consulta.`);
    } else {
      await enviarPush(medicoInfo?.push_token, '❌ Remarcação recusada', `${nomePaciente} recusou a remarcação. Consulta cancelada.`);
    }
    res.json(updatedConsulta.rows[0]);
  } catch (err) {
    console.error('Erro responderRemarcacao:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.cancelarComPrazo = async (req, res) => {
  try {
    const { id } = req.params;
    const paciente_id = req.usuario.id;
    const consulta = await pool.query('SELECT * FROM consultas WHERE id = $1 AND paciente_id = $2', [id, paciente_id]);
    if (consulta.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta não encontrada' });
    const c = consulta.rows[0];
    const [d, m, y] = c.data.split('/').map(Number);
    const [h, min] = c.horario.split(':').map(Number);
    const dataConsulta = new Date(y, m - 1, d, h, min);
    const agora = new Date();
    const diffHoras = (dataConsulta.getTime() - agora.getTime()) / (1000 * 60 * 60);
    if (diffHoras < 48) {
      return res.status(400).json({
        erro: 'Cancelamento não permitido',
        mensagem: 'Não é possível cancelar consultas com menos de 48 horas de antecedência.',
        horas_restantes: Math.round(diffHoras),
      });
    }
    await pool.query('DELETE FROM consultas WHERE id = $1 AND paciente_id = $2', [id, paciente_id]);
    res.json({ mensagem: 'Consulta cancelada com sucesso' });
  } catch (err) {
    console.error('Erro cancelarComPrazo:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.verificarBloqueio = async (req, res) => {
  try {
    const paciente_id = req.usuario.id;
    const result = await pool.query('SELECT faltas, bloqueado_ate FROM usuarios WHERE id = $1', [paciente_id]);
    const u = result.rows[0];
    const bloqueado = u?.bloqueado_ate && new Date(u.bloqueado_ate) > new Date();
    const permanente = u?.faltas >= 3;
    res.json({ bloqueado: !!bloqueado, permanente, faltas: u?.faltas || 0, bloqueado_ate: u?.bloqueado_ate || null });
  } catch (err) {
    console.error('Erro verificarBloqueio:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.avaliarMedico = async (req, res) => {
  try {
    const { consulta_id, nota, comentario } = req.body;
    const paciente_id = req.usuario.id;
    if (!consulta_id || !nota)
      return res.status(400).json({ erro: 'Consulta e nota sao obrigatorios.' });
    if (nota < 1 || nota > 5)
      return res.status(400).json({ erro: 'Nota deve ser entre 1 e 5.' });
    const consulta = await pool.query(
      'SELECT * FROM consultas WHERE id = $1 AND paciente_id = $2 AND status = $3',
      [consulta_id, paciente_id, 'concluida']
    );
    if (consulta.rows.length === 0)
      return res.status(404).json({ erro: 'Consulta nao encontrada ou nao concluida.' });
    const jaAvaliou = await pool.query('SELECT id FROM avaliacoes WHERE consulta_id = $1', [consulta_id]);
    if (jaAvaliou.rows.length > 0)
      return res.status(400).json({ erro: 'Voce ja avaliou esta consulta.' });
    const medico_id = consulta.rows[0].medico_id;
    await pool.query(
      'INSERT INTO avaliacoes (consulta_id, paciente_id, medico_id, nota, comentario) VALUES ($1, $2, $3, $4, $5)',
      [consulta_id, paciente_id, medico_id, nota, comentario || null]
    );
    res.status(201).json({ mensagem: 'Avaliacao registrada com sucesso!' });
  } catch (err) {
    console.error('Erro avaliarMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.avaliacoesMedico = async (req, res) => {
  try {
    const { medico_id } = req.params;
    const result = await pool.query(`
      SELECT a.*, u.nome AS paciente_nome, c.nome_perfil
      FROM avaliacoes a
      JOIN usuarios u ON u.id = a.paciente_id
      JOIN consultas c ON c.id = a.consulta_id
      WHERE a.medico_id = $1
      ORDER BY a.criado_em DESC
    `, [medico_id]);
    const total = result.rows.length;
    const media = total > 0 ? (result.rows.reduce((s, r) => s + r.nota, 0) / total).toFixed(1) : null;
    res.json({ avaliacoes: result.rows, media, total });
  } catch (err) {
    console.error('Erro avaliacoesMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.verificarAvaliacao = async (req, res) => {
  try {
    const { consulta_id } = req.params;
    const result = await pool.query('SELECT id FROM avaliacoes WHERE consulta_id = $1', [consulta_id]);
    res.json({ avaliado: result.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno.' });
  }
};

exports.avaliacoesMedicoMe = async (req, res) => {
  try {
    const medico_id = req.usuario.id;
    const result = await pool.query(`
      SELECT a.*, u.nome AS paciente_nome, c.nome_perfil
      FROM avaliacoes a
      JOIN usuarios u ON u.id = a.paciente_id
      JOIN consultas c ON c.id = a.consulta_id
      WHERE a.medico_id = $1
      ORDER BY a.criado_em DESC
    `, [medico_id]);
    const total = result.rows.length;
    const media = total > 0 ? (result.rows.reduce((s, r) => s + r.nota, 0) / total).toFixed(1) : null;
    res.json({ avaliacoes: result.rows, media, total });
  } catch (err) {
    console.error('Erro avaliacoesMedicoMe:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};