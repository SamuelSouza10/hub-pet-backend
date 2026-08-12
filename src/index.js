const express    = require('express');
const cors       = require('cors');

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

app.use('/auth',      authRoutes);
app.use('/medicos',   medicosRoutes);
app.use('/consultas', consultasRoutes);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor rodando na porta ' + PORT);
});

process.on('uncaughtException', (err) => {
  console.error('Erro não capturado:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rejeitada:', err.message);
});