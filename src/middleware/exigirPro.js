const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: middleware que trava rotas de ferramenta atrás do plano Pro.
//
// Uso: `router.get('/relatorio', auth, exigirPro, controller.relatorio)`
// — precisa vir DEPOIS do middleware `auth` normal (que já preenche
// req.usuario.id), porque usa esse id pra buscar a assinatura.
//
// Devolve 403 com um corpo padronizado que o app usa pra mostrar a tela
// de upsell ("Isso é recurso Pro") em vez de um erro genérico.
// ═══════════════════════════════════════════════════════════════
module.exports = async function exigirPro(req, res, next) {
  try {
    const usuario_id = req.usuario?.id;
    if (!usuario_id) return res.status(401).json({ erro: 'Não autenticado' });

    const result = await pool.query('SELECT plano, status FROM assinaturas WHERE usuario_id = $1', [usuario_id]);
    const assinatura = result.rows[0];

    // Sem registro de assinatura ainda (ex: conta muito antiga, antes
    // dessa migração existir) — trata como grátis, não quebra o app.
    const plano  = assinatura?.plano  || 'gratis';
    const status = assinatura?.status || 'ativa';

    if (plano === 'pro' && status === 'ativa') {
      return next();
    }

    return res.status(403).json({
      erro: 'Esse recurso é exclusivo do plano Pro.',
      requer_pro: true,
      plano_atual: plano,
    });
  } catch (err) {
    console.error('Erro exigirPro:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};