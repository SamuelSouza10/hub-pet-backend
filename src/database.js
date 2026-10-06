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
  // ✅ NOVO: sem isso, se o banco ficar inalcançável, cada requisição esperava
  // PRA SEMPRE por uma conexão (o padrão do pg é não ter limite). Agora falha
  // em 10s com um erro claro, e o app segue respondendo o resto.
  connectionTimeoutMillis: 10000,
});

// ✅ NOVO: quando o banco reinicia ou a rede oscila, o pg avisa por um evento
// "error" nas conexões que estavam paradas no pool. Sem ninguém escutando, isso
// vira uma exceção não tratada. Aqui só registramos; o pool descarta a conexão
// ruim e abre outra sozinho na próxima consulta.
pool.on('error', (err) => {
  console.error('Erro PostgreSQL (conexão ociosa):', err.message);
});

// ✅ CORRIGIDO: antes era pool.connect().then(...) sem devolver o cliente, o que
// prendia uma das 10 conexões do pool pra sempre. pool.query pega e devolve sozinho.
pool.query('SELECT 1')
  .then(() => console.log('PostgreSQL conectado!'))
  .catch(err => console.error('Erro PostgreSQL:', err.message));

module.exports = pool;