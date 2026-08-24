const pool = require('../database');
const { calcularFechamentoMes } = require('../services/servicoPagamento');

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: relatório mensal — junta dados de agendamento, atendimento
// concluído (checkin), serviços mais realizados (ficha) e financeiro
// (taxa acumulada). Recurso Pro.
// ═══════════════════════════════════════════════════════════════
exports.relatorioMensal = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    // Aceita ?mes=2026-08, senão usa o mês atual
    const mesReferencia = req.query.mes || new Date().toISOString().slice(0, 7);

    const agendamentos = await pool.query(`
      SELECT
        COUNT(*) AS total_agendamentos,
        COUNT(*) FILTER (WHERE c.status = 'aceito')   AS confirmados,
        COUNT(*) FILTER (WHERE c.status = 'pendente') AS pendentes,
        COUNT(*) FILTER (WHERE c.status = 'recusado') AS recusados,
        COUNT(*) FILTER (WHERE ch.status_dia = 'concluido') AS concluidos
      FROM consultas c
      LEFT JOIN checkin_atendimento ch ON ch.consulta_id = c.id
      WHERE c.medico_id = $1
        AND TO_CHAR(TO_DATE(c.data, 'DD/MM/YYYY'), 'YYYY-MM') = $2
    `, [usuario_id, mesReferencia]);

    const servicos = await pool.query(`
      SELECT f.tipo_servico, COUNT(*) AS quantidade
      FROM fichas_atendimento f
      JOIN consultas c ON c.id = f.consulta_id
      WHERE f.usuario_id = $1
        AND TO_CHAR(TO_DATE(c.data, 'DD/MM/YYYY'), 'YYYY-MM') = $2
        AND f.tipo_servico != ''
      GROUP BY f.tipo_servico
      ORDER BY quantidade DESC
      LIMIT 5
    `, [usuario_id, mesReferencia]);

    // Reaproveita a mesma função do sistema de pagamento — sem duplicar lógica
    const financeiro = await calcularFechamentoMes(usuario_id);

    const dados = agendamentos.rows[0];
    const totalAgendamentos = parseInt(dados.total_agendamentos, 10);
    const concluidos = parseInt(dados.concluidos, 10);
    const taxaConversao = totalAgendamentos > 0
      ? Math.round((concluidos / totalAgendamentos) * 100)
      : 0;

    res.json({
      mes_referencia: mesReferencia,
      total_agendamentos: totalAgendamentos,
      confirmados: parseInt(dados.confirmados, 10),
      pendentes: parseInt(dados.pendentes, 10),
      recusados: parseInt(dados.recusados, 10),
      concluidos,
      taxa_conversao: taxaConversao,
      servicos_mais_realizados: servicos.rows,
      financeiro,
    });
  } catch (err) {
    console.error('Erro relatorioMensal:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: relatório mensal da FARMÁCIA — mesmo espírito do relatório
// de petshop/clínica, mas em cima de solicitacoes_farmacia (não
// consultas), já que farmácia não usa agendamento. "Produtos mais
// manipulados" substitui "serviços mais realizados", extraído do
// JSONB de medicamentos de cada solicitação. Recurso Pro.
// ═══════════════════════════════════════════════════════════════
exports.relatorioFarmacia = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const mesReferencia = req.query.mes || new Date().toISOString().slice(0, 7);

    const solicitacoes = await pool.query(`
      SELECT
        COUNT(*) AS total_solicitacoes,
        COUNT(*) FILTER (WHERE status = 'pendente') AS pendentes,
        COUNT(*) FILTER (WHERE status IN ('vista','em_preparo','pronta')) AS em_andamento,
        COUNT(*) FILTER (WHERE status = 'entregue') AS entregues,
        COUNT(*) FILTER (WHERE status = 'cancelada') AS canceladas
      FROM solicitacoes_farmacia
      WHERE farmacia_id = $1
        AND TO_CHAR(criado_em, 'YYYY-MM') = $2
    `, [usuario_id, mesReferencia]);

    const produtos = await pool.query(`
      SELECT (elem->>'nome') AS nome_medicamento, COUNT(*) AS quantidade
      FROM solicitacoes_farmacia s, jsonb_array_elements(s.medicamentos) AS elem
      WHERE s.farmacia_id = $1
        AND TO_CHAR(s.criado_em, 'YYYY-MM') = $2
      GROUP BY nome_medicamento
      ORDER BY quantidade DESC
      LIMIT 5
    `, [usuario_id, mesReferencia]);

    const financeiro = await calcularFechamentoMes(usuario_id);

    const dados = solicitacoes.rows[0];
    const total = parseInt(dados.total_solicitacoes, 10);
    const entregues = parseInt(dados.entregues, 10);
    const taxaConclusao = total > 0 ? Math.round((entregues / total) * 100) : 0;

    res.json({
      mes_referencia: mesReferencia,
      total_solicitacoes: total,
      pendentes: parseInt(dados.pendentes, 10),
      em_andamento: parseInt(dados.em_andamento, 10),
      entregues,
      canceladas: parseInt(dados.canceladas, 10),
      taxa_conclusao: taxaConclusao,
      produtos_mais_manipulados: produtos.rows,
      financeiro,
    });
  } catch (err) {
    console.error('Erro relatorioFarmacia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: dashboard consolidado da clínica — mesma lógica geral do
// relatório mensal, mas agrupado por ESPECIALIDADE (não por
// tipo_servico, que é específico do petshop) — só faz sentido pra
// conta institucional, que reúne vários veterinários de áreas
// diferentes atendendo sob o mesmo teto. Recurso Pro.
// ═══════════════════════════════════════════════════════════════
exports.dashboardClinica = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const mesReferencia = req.query.mes || new Date().toISOString().slice(0, 7);

    const agendamentos = await pool.query(`
      SELECT
        COUNT(*) AS total_agendamentos,
        COUNT(*) FILTER (WHERE c.status = 'aceito')   AS confirmados,
        COUNT(*) FILTER (WHERE c.status = 'pendente') AS pendentes,
        COUNT(*) FILTER (WHERE c.status = 'recusado') AS recusados,
        COUNT(*) FILTER (WHERE ch.status_dia = 'concluido') AS concluidos
      FROM consultas c
      LEFT JOIN checkin_atendimento ch ON ch.consulta_id = c.id
      WHERE c.medico_id = $1
        AND TO_CHAR(TO_DATE(c.data, 'DD/MM/YYYY'), 'YYYY-MM') = $2
    `, [usuario_id, mesReferencia]);

    const especialidades = await pool.query(`
      SELECT c.especialidade, COUNT(*) AS quantidade
      FROM consultas c
      WHERE c.medico_id = $1
        AND TO_CHAR(TO_DATE(c.data, 'DD/MM/YYYY'), 'YYYY-MM') = $2
        AND c.especialidade != ''
      GROUP BY c.especialidade
      ORDER BY quantidade DESC
      LIMIT 8
    `, [usuario_id, mesReferencia]);

    const financeiro = await calcularFechamentoMes(usuario_id);

    const dados = agendamentos.rows[0];
    const totalAgendamentos = parseInt(dados.total_agendamentos, 10);
    const concluidos = parseInt(dados.concluidos, 10);
    const taxaConversao = totalAgendamentos > 0
      ? Math.round((concluidos / totalAgendamentos) * 100)
      : 0;

    res.json({
      mes_referencia: mesReferencia,
      total_agendamentos: totalAgendamentos,
      confirmados: parseInt(dados.confirmados, 10),
      pendentes: parseInt(dados.pendentes, 10),
      recusados: parseInt(dados.recusados, 10),
      concluidos,
      taxa_conversao: taxaConversao,
      por_especialidade: especialidades.rows,
      financeiro,
    });
  } catch (err) {
    console.error('Erro dashboardClinica:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};