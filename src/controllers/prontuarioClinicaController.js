const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: prontuário compartilhado — diferente da ficha de
// atendimento do petshop (que é sobre UM serviço específico), aqui
// é histórico clínico contínuo do pet dentro da clínica, visível
// pra QUALQUER veterinário da equipe que atender esse pet depois.
// Recurso Pro.
// ═══════════════════════════════════════════════════════════════

// ── Adiciona uma entrada no prontuário ────────────────────────────
exports.salvarEntrada = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const { consulta_id, veterinario_id, perfil_id, nome_perfil, diagnostico, observacoes } = req.body;

    if (!veterinario_id || !perfil_id || !nome_perfil)
      return res.status(400).json({ erro: 'Veterinário e paciente são obrigatórios' });

    // Confirma que o veterinário informado é mesmo da equipe dessa clínica
    const vetCheck = await pool.query(
      'SELECT id FROM equipe_medica WHERE id = $1 AND clinica_id = $2',
      [veterinario_id, clinica_id]
    );
    if (vetCheck.rows.length === 0)
      return res.status(403).json({ erro: 'Esse veterinário não pertence à sua equipe' });

    const result = await pool.query(
      `INSERT INTO prontuario_clinica (consulta_id, clinica_id, veterinario_id, perfil_id, nome_perfil, diagnostico, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [consulta_id || null, clinica_id, veterinario_id, perfil_id, nome_perfil, diagnostico || '', observacoes || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro salvarEntrada:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Lista o histórico completo de um pet na clínica ──────────────
// ✅ Mostra entradas de TODOS os veterinários da equipe, não só de
// quem está logado — é isso que resolve a continuidade de cuidado.
exports.listarPorPerfil = async (req, res) => {
  try {
    const clinica_id = req.usuario.id;
    const { perfil_id } = req.params;

    const result = await pool.query(`
      SELECT p.*, e.nome AS veterinario_nome, e.crm AS veterinario_crm
      FROM prontuario_clinica p
      JOIN equipe_medica e ON e.id = p.veterinario_id
      WHERE p.clinica_id = $1 AND p.perfil_id = $2
      ORDER BY p.criado_em DESC
    `, [clinica_id, perfil_id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPorPerfil:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};