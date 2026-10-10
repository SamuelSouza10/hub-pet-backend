// ═══════════════════════════════════════════════════════════════
// Proxy do Gemini: a chave fica SÓ aqui (GEMINI_API_KEY no Railway).
// O app manda { contents, generationConfig } e recebe a resposta do
// Gemini no mesmo formato de antes — as telas quase não mudam.
// ═══════════════════════════════════════════════════════════════
const MODELO = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const MAX_MENSAGENS = 40;
const MAX_CARACTERES = 60000;
const MAX_TOKENS_SAIDA = 8192;
// Modelos "thinking" gastam parte do limite pensando; sem folga a resposta
// chega vazia/cortada e o JSON do app quebra. Multiplicamos o pedido do app.
const FOLGA_PENSAMENTO = 4;

// Aparece no log de deploy do Railway: confirma se a chave chegou.
console.log('[IA] GEMINI_API_KEY', process.env.GEMINI_API_KEY ? 'definida' : 'AUSENTE', '| modelo:', MODELO);

function limpar(body) {
  const { contents, generationConfig } = body || {};
  if (!Array.isArray(contents) || contents.length === 0 || contents.length > MAX_MENSAGENS) return null;

  let total = 0;
  const limpo = [];
  for (const c of contents) {
    const role = c?.role === 'model' ? 'model' : 'user';
    if (!Array.isArray(c?.parts)) return null;
    const parts = [];
    for (const p of c.parts) {
      if (typeof p?.text !== 'string') return null; // só texto: sem imagem/arquivo
      total += p.text.length;
      parts.push({ text: p.text });
    }
    if (!parts.length) return null;
    limpo.push({ role, parts });
  }
  if (total > MAX_CARACTERES) return null;

  const cfg = {};
  if (typeof generationConfig?.temperature === 'number') {
    cfg.temperature = Math.min(Math.max(generationConfig.temperature, 0), 2);
  }
  const max = Number(generationConfig?.maxOutputTokens);
  cfg.maxOutputTokens = Number.isFinite(max) && max > 0 ? Math.min(max * FOLGA_PENSAMENTO, MAX_TOKENS_SAIDA) : 4096;
  return { contents: limpo, generationConfig: cfg };
}

exports.gerar = async (req, res) => {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) return res.status(503).json({ erro: 'Assistente de IA não configurado.' });

  const corpo = limpar(req.body);
  if (!corpo) return res.status(400).json({ erro: 'Pedido inválido para o assistente.' });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(45000),
      }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Gemini erro', r.status, JSON.stringify(data).slice(0, 300));
      return res.status(502).json({ erro: 'O assistente não respondeu. Tente de novo.' });
    }
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('Gemini sem texto:', data?.candidates?.[0]?.finishReason, JSON.stringify(data?.promptFeedback || {}).slice(0, 200));
    }
    res.json(data);
  } catch (err) {
    console.error('Erro /ia/gerar:', err.message);
    res.status(502).json({ erro: 'O assistente não respondeu. Tente de novo.' });
  }
};