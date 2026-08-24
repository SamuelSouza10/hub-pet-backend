const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// ✅ CAMADA DE ABSTRAÇÃO DE PAGAMENTO
//
// Tudo que MUDA se um dia trocarmos pra Split de Pagamentos fica AQUI
// dentro. As telas e o resto do backend não sabem (nem precisam saber)
// como o dinheiro se move por trás — só chamam essas funções.
//
// Hoje (modelo atual): assinatura mensal simples (profissional paga o
// H.U.B.) + taxa fixa por solicitação, calculada do preço declarado,
// cobrada em lote no fim do mês. Nunca tocamos no pagamento entre tutor
// e profissional.
//
// Se um dia migrar pro Split: só essas funções mudam de implementação
// (passam a usar OAuth por profissional, marketplace_fee, etc.) — o
// resto do app (telas, tabela de preços, cálculo de taxa) continua
// igual, porque fala só com essa camada, nunca direto com o Mercado Pago.
// ═══════════════════════════════════════════════════════════════

// ✅ Taxa única — a mesma pros dois planos (Grátis e Pro). O Pro NÃO
// desconta na taxa, só desbloqueia ferramenta. Isso evita que o
// profissional de alto volume renda MENOS pra gente por pagar taxa
// menor no Pro — quanto mais ele usa o app, mais a gente recebe, sem
// exceção.
const PERCENTUAL_TAXA = 0.10; // 10%

// ── Calcula a taxa fixa a partir do preço declarado ──────────────
function calcularTaxa(preco) {
  const preco_num = parseFloat(preco);
  return Math.round(preco_num * PERCENTUAL_TAXA * 100) / 100;
}

// ── Profissional declara/atualiza o preço de um serviço ─────────
async function salvarPrecoServico(usuario_id, servico_id, servico_nome, preco) {
  const taxa = calcularTaxa(preco);
  const result = await pool.query(
    `INSERT INTO precos_servicos (usuario_id, servico_id, servico_nome, preco, taxa)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (usuario_id, servico_id)
     DO UPDATE SET servico_nome = $3, preco = $4, taxa = $5, atualizado_em = NOW()
     RETURNING *`,
    [usuario_id, servico_id, servico_nome, preco, taxa]
  );
  return result.rows[0];
}

// ── Lista os preços/taxas declarados por um profissional ────────
async function listarPrecosServicos(usuario_id) {
  const result = await pool.query(
    'SELECT * FROM precos_servicos WHERE usuario_id = $1 ORDER BY servico_nome ASC',
    [usuario_id]
  );
  return result.rows;
}

// ── Registra a taxa acumulada de UM evento (consulta aceita, etc) ─
// ✅ Não cobra nada em tempo real — só registra que aquilo aconteceu,
// pra somar no fechamento do mês. É isso que mantém a cobrança "em
// lote", fora do escopo do Split Payment Fiscal. Taxa é a mesma
// independente do plano (Grátis ou Pro).
async function registrarTaxaEvento(usuario_id, referencia_tipo, referencia_id, servico_id) {
  const preco = await pool.query(
    'SELECT taxa FROM precos_servicos WHERE usuario_id = $1 AND servico_id = $2',
    [usuario_id, servico_id]
  );
  if (preco.rows.length === 0) return null; // sem preço declarado, sem taxa

  const valor_taxa = preco.rows[0].taxa;
  const mes_referencia = new Date().toISOString().slice(0, 7); // 'AAAA-MM'

  const result = await pool.query(
    `INSERT INTO cobrancas_taxa (usuario_id, referencia_tipo, referencia_id, valor_taxa, mes_referencia)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [usuario_id, referencia_tipo, referencia_id, valor_taxa, mes_referencia]
  );
  return result.rows[0];
}

// ── Busca a assinatura atual do profissional ─────────────────────
async function buscarAssinatura(usuario_id) {
  const result = await pool.query('SELECT * FROM assinaturas WHERE usuario_id = $1', [usuario_id]);
  return result.rows[0] || null;
}

// ── Cria a assinatura Grátis automaticamente (chamado na aprovação
//    da conta pelo admin — NUNCA no cadastro, conforme decidido) ────
async function criarAssinaturaGratis(usuario_id) {
  const result = await pool.query(
    `INSERT INTO assinaturas (usuario_id, plano, status)
     VALUES ($1, 'gratis', 'ativa')
     ON CONFLICT (usuario_id) DO NOTHING
     RETURNING *`,
    [usuario_id]
  );
  return result.rows[0] || null;
}

// ── Soma quanto o profissional deve no mês atual (mensalidade + taxas) ─
async function calcularFechamentoMes(usuario_id) {
  const mes_referencia = new Date().toISOString().slice(0, 7);
  const assinatura = await buscarAssinatura(usuario_id);
  const taxas = await pool.query(
    `SELECT COALESCE(SUM(valor_taxa), 0) AS total, COUNT(*) AS quantidade
     FROM cobrancas_taxa WHERE usuario_id = $1 AND mes_referencia = $2 AND cobrado = false`,
    [usuario_id, mes_referencia]
  );
  return {
    plano: assinatura?.plano || 'gratis',
    total_taxas: parseFloat(taxas.rows[0].total),
    quantidade_solicitacoes: parseInt(taxas.rows[0].quantidade, 10),
    mes_referencia,
  };
}

module.exports = {
  calcularTaxa,
  salvarPrecoServico,
  listarPrecosServicos,
  registrarTaxaEvento,
  buscarAssinatura,
  criarAssinaturaGratis,
  calcularFechamentoMes,
};