const pool = require('../database');

// ── Listar todos os médicos ────────────────────────────────────
// ✅ SPLIT: backend só de pet — filtro extra `tipo_conta IN (...)` como
// segunda trava de segurança, além do que já garantimos na hora do
// cadastro (authController.js). Protege contra dado remanescente de
// antes da separação dos bancos, ou qualquer edição manual no banco.
// ✅ Inclui 'petshop' — sem isso, petshops cadastrados nunca apareceriam
// em nenhuma busca (o app só tem esse backend, então precisa achar os dois).
exports.listarMedicos = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.nome, u.email,
        m.especialidade, m.telefone, m.endereco,
        m.crm, m.bio, m.nota, m.foto_url,
        m.cidade, m.cep, m.latitude, m.longitude,
        m.tipo_conta, m.tem_entrega, m.atendimento_domiciliar, m.telemedicina, m.exames_procedimentos
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE u.tipo = 'medico'
        AND m.tipo_conta IN ('veterinario', 'petshop', 'servico', 'clinica', 'farmacia')
        AND m.status_verificacao = 'aprovado'
      ORDER BY u.nome ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMedicos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Listar SÓ quem aparece no mapa (recurso Pro) ────────────────
// ✅ NOVO: endpoint separado de propósito — a busca normal
// (listarMedicos/buscarMedicos) continua trazendo TODO MUNDO, grátis
// ou Pro, porque visibilidade básica na lista nunca pode ficar atrás
// de pagamento (mataria a liquidez do marketplace). O que é Pro é só
// aparecer como PIN no mapa interativo — uma camada de destaque, não
// a existência básica pro tutor.
exports.listarParaMapa = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.nome,
        m.especialidade, m.endereco, m.foto_url, m.nota,
        m.cidade, m.latitude, m.longitude, m.tipo_conta
      FROM usuarios u
      JOIN medicos m     ON m.usuario_id = u.id
      JOIN assinaturas a ON a.usuario_id = u.id
      WHERE u.tipo = 'medico'
        AND m.tipo_conta IN ('veterinario', 'petshop', 'servico', 'clinica', 'farmacia')
        AND m.status_verificacao = 'aprovado'
        AND a.plano = 'pro' AND a.status = 'ativa'
        AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
      ORDER BY u.nome ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarParaMapa:', err.message);
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
        m.tipo_conta, m.tem_entrega, m.atendimento_domiciliar, m.telemedicina, m.exames_procedimentos
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE u.tipo = 'medico'
        AND m.tipo_conta IN ('veterinario', 'petshop', 'servico', 'clinica', 'farmacia')
        AND m.status_verificacao = 'aprovado'
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

// ── Busca um profissional específico por ID ──────────────────────
// ✅ NOVO: usado por marcaconsultas.tsx pra saber quais exames/
// procedimentos ESSE profissional específico oferece (Camada 2 da
// solicitação de Raio-X — deixa o tutor escolher, não fixo por chip).
exports.buscarMedicoPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        u.id, u.nome,
        m.especialidade, m.endereco, m.foto_url, m.nota,
        m.cidade, m.crm, m.valor_consulta, m.tipo_conta,
        m.exames_procedimentos
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE u.id = $1 AND m.status_verificacao = 'aprovado'
    `, [id]);

    if (result.rows.length === 0) return res.status(404).json({ erro: 'Profissional não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarMedicoPorId:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};