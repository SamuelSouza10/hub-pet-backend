const { Pool } = require('pg');

// ✅ CORRIGIDO: antes tinha uma connectionString fixa no código,
// apontando pra um banco antigo/errado (zephyr.proxy.rlwy.net) — bem
// provavelmente um resquício de antes da separação entre HUB Humano e
// HUB Pet. Isso fazia TODA migração rodada no banco certo do Railway
// nunca chegar no banco que o backend realmente usava. Agora usa a
// variável de ambiente DATABASE_URL, que o Railway preenche sozinho
// quando o Postgres está conectado como referência no mesmo projeto.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log('PostgreSQL conectado!'))
  .catch(err => console.error('Erro PostgreSQL:', err.message));

module.exports = pool;