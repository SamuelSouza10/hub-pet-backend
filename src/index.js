const express    = require('express');
const cors       = require('cors');
// ✅ NOVO: precisa rodar `npm install node-cron` no projeto antes de subir
// essa versão — sem isso o require abaixo quebra o servidor inteiro.
const cron       = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', versao: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Rotas
const authRoutes      = require('./routes/auth');
const medicosRoutes   = require('./routes/medicos');
const consultasRoutes = require('./routes/consultas');
// ✅ NOVA: solicitações de receita pra farmácia/petshop — controller e
// rotas já existiam, mas nunca tinham sido registradas aqui no app
// principal. Sem essa linha, /farmacia/* sempre caía em 404.
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
app.use('/calculadoras', calculadorasRoutes);

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

process.on('uncaughtException', (err) => {
  console.error('Erro não capturado:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejeitada:', err.message);
});