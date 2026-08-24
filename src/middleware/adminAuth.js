const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'hub_super_secret_2025';

// ✅ NOVO: protege as rotas de admin (listar pendentes, aprovar,
// reprovar) — só deixa passar quem tem um token de admin válido, gerado
// pelo adminLogin. Segue o mesmo padrão do middleware de auth normal,
// mas exige tipo === 'admin' especificamente.
module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido' });

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = jwt.verify(token, SECRET);
    if (payload.tipo !== 'admin')
      return res.status(403).json({ erro: 'Acesso restrito ao administrador' });

    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};