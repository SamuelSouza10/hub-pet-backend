// ✅ NOVO: carrega o arquivo .env (se existir) ANTES de qualquer outro
// require — essencial pra rodar localmente, já que authController.js
// lê process.env.JWT_SECRET assim que é importado. No Railway isso
// não faz diferença (lá as variáveis já vêm do painel), mas não
// atrapalha nada.
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
// ✅ NOVO: precisa rodar `npm install node-cron` no projeto antes de subir
// essa versão — sem isso o require abaixo quebra o servidor inteiro.
const cron       = require('node-cron');

const app  = express();
// Railway coloca 1 proxy na frente do servidor. Sem isso, req.ip vira o IP do
// proxy e os rate limits (login, cadastro, recuperacao de senha) passam a valer
// pro app inteiro em vez de por pessoa.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ NOVO: painel admin e página pública da Tag de Emergência, servidos
// direto por este mesmo servidor — sem precisar de Netlify nem de conta
// separada. As duas já chamam a API pelo domínio absoluto do Railway,
// então funcionam normalmente mesmo sendo servidas daqui.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});
app.get('/tag', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/tag-emergencia.html'));
});
// ✅ NOVO: Termos de Uso e Política de Privacidade — servidos como
// páginas públicas, com link fixo (o app aponta pra cá, e dá pra
// mandar o link pra qualquer um sem precisar estar logado).
app.get('/termos', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/termos-de-uso.html'));
});
app.get('/privacidade', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/politica-privacidade.html'));
});

// Health check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', versao: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// ✅ NOVO: "o BANCO está respondendo?" — pra um monitor externo (UptimeRobot,
// Better Stack etc.) avisar quando o banco cair, não só quando o servidor cair.
// Fica separado do /health de propósito: o /health é o que o Railway usa na hora do
// deploy, e uma oscilação momentânea do banco não deve impedir um deploy de subir.
// Responde só "ok"/"falhou", sem detalhes de erro, por ser público.
const poolSaude = require('./database');
const limitarSaude = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { status: 'limite', banco: 'desconhecido' },
});
app.get('/health/db', limitarSaude, async (req, res) => {
  let timer;
  try {
    await Promise.race([
      poolSaude.query('SELECT 1'),
      new Promise((_, rejeitar) => { timer = setTimeout(() => rejeitar(new Error('sem resposta em 3s')), 3000); }),
    ]);
    res.status(200).json({ status: 'ok', banco: 'ok' });
  } catch (e) {
    console.error('[health] banco não respondeu:', e.message);
    res.status(503).json({ status: 'erro', banco: 'falhou' });
  } finally {
    clearTimeout(timer);
  }
});
// fim /health/db

// Rotas
const authRoutes      = require('./routes/auth');
const medicosRoutes   = require('./routes/medicos');
const consultasRoutes = require('./routes/consultas');
// ✅ NOVA: solicitações de receita pra farmácia/petshop — controller e
// rotas já existiam, mas nunca tinham sido registradas aqui no app
// principal. Sem essa linha, /farmacia/* sempre caía em 404.
// ✅ CORRIGIDO: apontava pra 'solicitacoesFarmacia' (versão antiga,
// onde o VETERINÁRIO escolhia a farmácia/petshop na hora de prescrever
// — isso fere o Art. XIII do Código de Ética do CFMV, que veda
// direcionar cliente pra um estabelecimento específico). A versão
// corrigida (o TUTOR escolhe onde retirar) já existia pronta em
// solicitacoesFarmacia2, mas nunca tinha sido conectada aqui — o app
// já espera essa API nova (criarReceita, escolherDestino, etc.), então
// sem essa troca, prescrever receita já estaria quebrado (404) assim
// que o app fosse atualizado.
const farmaciaRoutes  = require('./routes/solicitacoesFarmacia');
// ✅ NOVA: sistema de assinatura + taxa por serviço.
const pagamentoRoutes = require('./routes/pagamento');
// ✅ NOVA: galeria de fotos (recurso Pro do petshop/farmácia)
const galeriaRoutes   = require('./routes/galeriaFotos');
// ✅ NOVA: ficha de atendimento (recurso Pro do petshop)
const fichaRoutes     = require('./routes/fichaAtendimento');
// ✅ NOVA: lembrete automático de banho
const lembreteRoutes  = require('./routes/lembreteBanho');
// ✅ NOVA: check-in/checkout de atendimento
const checkinRoutes    = require('./routes/checkin');
// ✅ NOVA: relatório mensal
const relatorioRoutes  = require('./routes/relatorio');
// ✅ NOVA: templates de fórmula frequente (recurso Pro da farmácia)
const templateRoutes   = require('./routes/templateFormula');
// ✅ NOVA: equipe médica da clínica (base pra receituário/atestado/IA)
const equipeRoutes      = require('./routes/equipeMedica');
// ✅ NOVA: ficha de comportamento (recurso Pro do prestador de serviço)
const comportamentoRoutes = require('./routes/fichaComportamento');
// ✅ CORREÇÃO: essa rota existia (controller + tela prontuarioclinica.tsx)
// mas nunca tinha sido registrada aqui — a tela chamava um endpoint
// que não existia de verdade no servidor.
const prontuarioClinicaRoutes = require('./routes/prontuarioClinica');
const rastreamentoRoutes = require('./routes/rastreamento');
const calculadorasRoutes = require('./routes/calculadoras');
// ✅ NOVO: area de adocao de animais
const adocaoRoutes = require('./routes/adocao');
// ✅ NOVO: ferramenta de adestramento (sessoes + checklist de comandos)
const treinamentoRoutes = require('./routes/treinamento');
// ✅ NOVO: checklist de medicacao (planos + doses administradas)
const medicacaoRoutes = require('./routes/medicacao');
// ✅ NOVO: tag de emergencia com QR code
const tagEmergenciaRoutes = require('./routes/tagEmergencia');
// ✅ NOVO: perfil de hospedagem (rotina + compatibilidade)
const hospedagemRoutes = require('./routes/hospedagem');
const denunciaRoutes = require('./routes/denuncia');
const perfilPetRoutes = require('./routes/perfilPet');
const lembretesRoutes = require('./routes/lembretes');
const favoritosRoutes = require('./routes/favoritos');
const cruzamentoRoutes = require('./routes/cruzamento');
const petsPerdidosRoutes = require('./routes/petsPerdidos');
const mercadoPagoRoutes = require('./routes/mercadoPago');
const pagamentoMpRoutes = require('./routes/pagamento-mp');
const assinaturaProRoutes = require('./routes/assinatura-pro');
// Assistente de IA (Gemini) via backend — a chave fica só no Railway.
const iaRoutes = require('./routes/ia');

app.use('/auth',      authRoutes);
app.use('/medicos',   medicosRoutes);
app.use('/consultas', consultasRoutes);
app.use('/farmacia',  farmaciaRoutes);
app.use('/pagamento', pagamentoRoutes);
app.use('/galeria',   galeriaRoutes);
app.use('/ficha',     fichaRoutes);
app.use('/lembretes', lembreteRoutes);
app.use('/checkin',   checkinRoutes);
app.use('/relatorio', relatorioRoutes);
app.use('/templates', templateRoutes);
app.use('/equipe',    equipeRoutes);
app.use('/comportamento', comportamentoRoutes);
app.use('/prontuario-clinica', prontuarioClinicaRoutes);
app.use('/rastreamento', rastreamentoRoutes);
app.use('/adocao', adocaoRoutes);
app.use('/treinamento', treinamentoRoutes);
app.use('/medicacao', medicacaoRoutes);
app.use('/tags', tagEmergenciaRoutes);
app.use('/hospedagem', hospedagemRoutes);
app.use('/denuncias', denunciaRoutes);
app.use('/perfis-pet', perfilPetRoutes);
// ⚠️ IMPORTANTE: já existia '/lembretes' pro Lembrete de Banho
// (petshop) — usar '/lembretes-pessoais' aqui evita colisão entre os
// dois sistemas diferentes, que por engano ficaram no mesmo prefixo.
app.use('/lembretes-pessoais', lembretesRoutes);
app.use('/favoritos', favoritosRoutes);
app.use('/cruzamento', cruzamentoRoutes);
app.use('/pets-perdidos', petsPerdidosRoutes);
app.use('/mercadopago', mercadoPagoRoutes);
app.use('/pagamento-mp', pagamentoMpRoutes);
app.use('/assinatura-pro', assinaturaProRoutes);
app.use('/calculadoras', calculadorasRoutes);
app.use('/ia', iaRoutes);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta ' + PORT);
});

// ✅ NOVO: roda todo dia às 9h da manhã (horário do servidor) —
// verifica pets com banho "vencido" e manda lembrete pro tutor.
// Timezone padrão do Railway costuma ser UTC; ajuste o horário
// conforme necessário se quiser 9h no horário de Brasília.
const { verificarEEnviarLembretes } = require('./controllers/lembreteBanhoController');
cron.schedule('0 9 * * *', () => {
  console.log('[cron] Rodando verificação de lembretes de banho...');
  verificarEEnviarLembretes();
});

// ✅ NOVO: renova os tokens do Mercado Pago dos profissionais que vencem em
// até 30 dias (o token vale 180 dias; sem isso as cobranças parariam em
// ~6 meses). Roda todo dia às 3h30 (UTC) e também 1 minuto depois de cada
// reinício, caso o servidor estivesse fora do ar na hora marcada.
const { renovarTokensProximosDoVencimento } = require('./controllers/mercadoPagoController');
const rodarRenovacaoMp = () => renovarTokensProximosDoVencimento()
  .catch((e) => console.error('[mp-tokens] erro na renovação:', e.message));
cron.schedule('30 3 * * *', rodarRenovacaoMp);
setTimeout(rodarRenovacaoMp, 60 * 1000);

process.on('uncaughtException', (err) => {
  console.error('Erro não capturado:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejeitada:', err.message);
});