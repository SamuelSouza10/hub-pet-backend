// GET /pagamento-mp/ganhos  (auth) — resumo financeiro do profissional logado.
// Só conta pagamentos com status 'aprovado'. Líquido = valor_total - taxa_plataforma.
const pool = require('../database');

const num = (v) => Math.round(parseFloat(v || 0) * 100) / 100;

exports.ganhos = async (req, res) => {
  try {
    const medico_id = req.usuario.id;

    const med = await pool.query('SELECT mp_conectado FROM medicos WHERE usuario_id = $1', [medico_id]);
    const conectado = !!med.rows[0]?.mp_conectado;

    const tot = await pool.query(
      `SELECT COUNT(*)::int AS qtd,
              COALESCE(SUM(valor_total),0) AS bruto,
              COALESCE(SUM(taxa_plataforma),0) AS taxa,
              COALESCE(SUM(valor_total - taxa_plataforma),0) AS liquido
         FROM pagamentos_mp WHERE medico_id = $1 AND status = 'aprovado'`, [medico_id]);

    const meses = await pool.query(
      `SELECT to_char(date_trunc('month', criado_em), 'YYYY-MM') AS mes,
              COUNT(*)::int AS qtd,
              COALESCE(SUM(valor_total - taxa_plataforma),0) AS liquido
         FROM pagamentos_mp
        WHERE medico_id = $1 AND status = 'aprovado'
          AND criado_em >= date_trunc('month', NOW()) - INTERVAL '5 months'
        GROUP BY 1 ORDER BY 1`, [medico_id]);

    // Preenche meses sem movimento com zero (gráfico sempre com 6 barras).
    const mapa = {}; meses.rows.forEach(r => { mapa[r.mes] = r; });
    const serie = [];
    const hoje = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      serie.push({ mes: chave, liquido: num(mapa[chave]?.liquido), qtd: mapa[chave]?.qtd || 0 });
    }

    const servicos = await pool.query(
      `SELECT COALESCE(NULLIF(c.especialidade,''), CASE WHEN p.solicitacao_farmacia_id IS NOT NULL THEN 'Farmácia' ELSE 'Outros' END) AS nome,
              COUNT(*)::int AS qtd,
              COALESCE(SUM(p.valor_total - p.taxa_plataforma),0) AS liquido
         FROM pagamentos_mp p LEFT JOIN consultas c ON c.id = p.consulta_id
        WHERE p.medico_id = $1 AND p.status = 'aprovado'
        GROUP BY 1 ORDER BY liquido DESC LIMIT 6`, [medico_id]);

    const recentes = await pool.query(
      `SELECT p.id, p.criado_em, p.valor_total, p.taxa_plataforma,
              COALESCE(NULLIF(c.especialidade,''), CASE WHEN p.solicitacao_farmacia_id IS NOT NULL THEN 'Farmácia' ELSE 'Pagamento' END) AS descricao,
              c.nome_perfil AS pet
         FROM pagamentos_mp p LEFT JOIN consultas c ON c.id = p.consulta_id
        WHERE p.medico_id = $1 AND p.status = 'aprovado'
        ORDER BY p.criado_em DESC LIMIT 10`, [medico_id]);

    const pend = await pool.query(
      `SELECT COUNT(*)::int AS qtd, COALESCE(SUM(valor_total - taxa_plataforma),0) AS liquido
         FROM pagamentos_mp WHERE medico_id = $1 AND status = 'pendente'
          AND criado_em >= NOW() - INTERVAL '2 days'`, [medico_id]);

    const t = tot.rows[0];
    res.json({
      conectado,
      total: { qtd: t.qtd, bruto: num(t.bruto), taxa: num(t.taxa), liquido: num(t.liquido) },
      mes_atual: serie[5], mes_anterior: serie[4],
      meses: serie,
      por_servico: servicos.rows.map(r => ({ nome: r.nome, qtd: r.qtd, liquido: num(r.liquido) })),
      recentes: recentes.rows.map(r => ({
        id: r.id, data: r.criado_em, descricao: r.descricao, pet: r.pet || null,
        valor_total: num(r.valor_total), liquido: num(r.valor_total - r.taxa_plataforma),
      })),
      aguardando: { qtd: pend.rows[0].qtd, liquido: num(pend.rows[0].liquido) },
    });
  } catch (err) {
    console.error('Erro ganhos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};