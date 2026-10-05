const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Criptografia de dados sensíveis em repouso.
//
// Usado pra nunca guardar o access_token do profissional (Mercado
// Pago) em texto puro no banco — se o banco vazar, sem a chave
// separada (MP_TOKEN_ENCRYPTION_KEY, que vive só nas variáveis de
// ambiente, nunca no banco), o token cifrado não serve pra nada.
//
// AES-256-GCM: cifra autenticada — além de esconder o conteúdo,
// detecta se o dado foi alterado (qualquer byte trocado quebra a
// verificação, não decifra "errado" silenciosamente).
// ═══════════════════════════════════════════════════════════════

const ALGORITMO = 'aes-256-gcm';

function obterChave() {
  const chaveHex = process.env.MP_TOKEN_ENCRYPTION_KEY;
  if (!chaveHex) throw new Error('MP_TOKEN_ENCRYPTION_KEY não configurado no servidor');
  const chave = Buffer.from(chaveHex, 'hex');
  if (chave.length !== 32) throw new Error('MP_TOKEN_ENCRYPTION_KEY precisa ter 64 caracteres hex (32 bytes)');
  return chave;
}

// ── Cifra um texto. Formato salvo: "iv:tag:dados", tudo em base64. ──
function cifrar(texto) {
  if (texto === null || texto === undefined) return null;
  const chave = obterChave();
  const iv = crypto.randomBytes(12); // 12 bytes é o recomendado pro GCM
  const cipher = crypto.createCipheriv(ALGORITMO, chave, iv);
  const dados = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${dados.toString('base64')}`;
}

// ── Decifra. Lança erro se a chave estiver errada ou o dado tiver
// sido alterado — nunca retorna um resultado "decifrado errado" sem
// avisar (é a garantia que o GCM dá). ──────────────────────────────
function decifrar(textoCifrado) {
  if (!textoCifrado) return null;
  const chave = obterChave();
  const partes = textoCifrado.split(':');
  if (partes.length !== 3) throw new Error('Formato de dado cifrado inválido');
  const [ivB64, tagB64, dadosB64] = partes;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const dados = Buffer.from(dadosB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITMO, chave, iv);
  decipher.setAuthTag(tag);
  const resultado = Buffer.concat([decipher.update(dados), decipher.final()]);
  return resultado.toString('utf8');
}

module.exports = { cifrar, decifrar };