import { getSessao } from './storage';

const API_URL = 'https://hub-pet-backend-production.up.railway.app';

// Substitui o antigo fetch(GEMINI_URL, ...). A chave do Gemini agora fica só no
// backend. Devolve a mesma Response, então o resto do código não muda.
export async function fetchIA(opts: { body: string }): Promise<Response> {
  const { token } = await getSessao();
  return fetch(`${API_URL}/ia/gerar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: opts.body,
  });
}