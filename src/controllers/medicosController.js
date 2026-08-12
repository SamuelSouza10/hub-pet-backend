const pool = require('../database');

// ── Listar todos os médicos ────────────────────────────────────
// ✅ SPLIT: backend só de pet — filtro extra `tipo_conta = 'veterinario'`
// como segunda trava de segurança, além do que já garantimos na hora do
// cadastro (authController.js). Protege contra dado remanescente de
// antes da separação dos bancos, ou qualquer edição manual no banco.
exports.listarMedicos = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.nome, u.email,
        m.especialidade, m.telefone, m.endereco,
        m.crm, m.bio, m.nota, m.foto_url,
        m.cidade, m.cep, m.latitude, m.longitude,
        m.tipo_conta
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE u.tipo = 'medico'
        AND m.tipo_conta = 'veterinario'
      ORDER BY u.nome ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMedicos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Buscar médicos por especialidade ou nome ───────────────────
exports.buscarMedicos = async (req, res) => {
  try {
    const { q } = req.query;
    const busca = `%${q || ''}%`;

    const result = await pool.query(`
      SELECT 
        u.id, u.nome, u.email,
        m.especialidade, m.telefone, m.endereco,
        m.crm, m.bio, m.nota, m.foto_url,
        m.cidade, m.cep, m.latitude, m.longitude,
        m.tipo_conta
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE u.tipo = 'medico'
        AND m.tipo_conta = 'veterinario'
        AND (
          u.nome ILIKE $1 OR
          m.especialidade ILIKE $1
        )
      ORDER BY u.nome ASC
    `, [busca]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro buscarMedicos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};