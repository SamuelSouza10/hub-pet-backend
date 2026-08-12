const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:biwmRiXxLcDfpnzumtdsSSxljdhHieVk@zephyr.proxy.rlwy.net:24424/railway',
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log('PostgreSQL conectado!'))
  .catch(err => console.error('Erro PostgreSQL:', err.message));

module.exports = pool;