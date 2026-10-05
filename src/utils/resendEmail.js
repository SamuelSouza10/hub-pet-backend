// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Envio de e-mail transacional via Resend.
// https://resend.com — 3.000 e-mails/mês grátis, sem precisar de
// domínio próprio verificado pra começar (usa onboarding@resend.dev
// enquanto isso; depois de verificar seu domínio, troca o FROM).
// ═══════════════════════════════════════════════════════════════

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// ✅ Troque pelo seu e-mail depois de verificar o domínio no Resend
// (painel → Domains). Até lá, esse endereço de teste já funciona.
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE || 'H.U.B. Pet <onboarding@resend.dev>';

async function enviarEmail(destinatario, assunto, html) {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY não configurado — e-mail não enviado.');
    return false;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: EMAIL_REMETENTE, to: destinatario, subject: assunto, html }),
    });
    if (!r.ok) {
      console.error('Erro enviando e-mail via Resend:', await r.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('Erro de rede enviando e-mail:', err.message);
    return false;
  }
}

async function enviarCodigoRecuperacao(destinatario, codigo) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0d2a3e;">H.U.B. Pet</h2>
      <p>Use o código abaixo pra criar uma nova senha. Ele vale por 15 minutos.</p>
      <div style="background: #f4f8fb; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0d2a3e;">${codigo}</span>
      </div>
      <p style="color: #7a8a94; font-size: 13px;">Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.</p>
    </div>`;
  return enviarEmail(destinatario, 'Seu código de recuperação — H.U.B. Pet', html);
}

module.exports = { enviarEmail, enviarCodigoRecuperacao };