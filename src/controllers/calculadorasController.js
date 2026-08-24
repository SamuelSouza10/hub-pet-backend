// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: Calculadoras Clínicas — recurso Pro do veterinário.
// Sem tabela no banco: são cálculos puros, feitos no app, sem nada
// pra persistir. Esse endpoint serve só pra checar o plano antes de
// liberar a tela (mesmo padrão de todo outro recurso Pro do app).
// ═══════════════════════════════════════════════════════════════
exports.status = async (req, res) => {
  res.json({ ok: true });
};