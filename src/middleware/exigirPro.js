const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// Trava rotas de ferramenta atrás do plano Pro.
//
// INTERRUPTOR: variável de ambiente PRO_LIBERADO_PARA_TODOS
//   - ausente ou diferente de "false"  → TODAS as ferramentas liberadas
//     pra qualquer conta logada (modo lançamento).
//   - "false"                          → volta a exigir plano Pro ativo.
// Pra começar a cobrar: Railway → Variables → PRO_LIBERADO_PARA_TODOS=false
// (o Railway reinicia sozinho; não precisa mexer em código).
//
// Uso: `router.get('/x', auth, exigirPro, controller.x)` — vem DEPOIS do auth.
// ═══════════════════════════════════════════════════════════════
const proLiberadoParaTodos = () =>
  String(process.env.PRO_LIBERADO_PARA_TODOS || 'true').trim().toLowerCase() !== 'false';

module.exports = async function exigirPro(req, res, next) {
  try {
    const usuario_id = req.usuario?.id;
    if (!usuario_id) return res.status(401).json({ erro: 'Não autenticado' });

    if (proLiberadoParaTodos()) return next();

    const result = await pool.query('SELECT plano, status FROM assinaturas WHERE usuario_id = $1', [usuario_id]);
    const assinatura = result.rows[0];
    const plano  = assinatura?.plano  || 'gratis';
    const status = assinatura?.status || 'ativa';

    if (plano === 'pro' && status === 'ativa') return next();

    return res.status(403).json({
      erro: 'Esse recurso não está liberado para a sua conta.',
      requer_pro: true,
      plano_atual: plano,
    });
  } catch (err) {
    console.error('Erro exigirPro:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};
module.exports.proLiberadoParaTodos = proLiberadoParaTodos;