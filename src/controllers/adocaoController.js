const pool = require('../database');

// ✅ Mesmo padrão de push notification já usado em outras partes do
// app (solicitações de farmácia, etc).
async function enviarPush(pushToken, titulo, corpo) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: pushToken, title: titulo, body: corpo, sound: 'default', priority: 'high' }),
    });
  } catch (e) {
    console.error('Erro enviarPush (adocao):', e.message);
  }
}

// ── Postar animal pra adoção — qualquer usuário autenticado ─────
// (tutor repassando um pet, ou profissional que recebeu um animal
// abandonado — vet, clínica e petshop lidam com isso na prática).
exports.criarAnimal = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nome, especie, raca, idade_aproximada, porte, sexo, foto_url, descricao, vacinado, castrado, cidade } = req.body;

    if (!nome || !especie)
      return res.status(400).json({ erro: 'Informe ao menos o nome e a espécie do animal' });

    const result = await pool.query(
      `INSERT INTO animais_adocao
        (usuario_id, nome, especie, raca, idade_aproximada, porte, sexo, foto_url, descricao, vacinado, castrado, cidade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [usuario_id, nome, especie, raca || '', idade_aproximada || '', porte || '', sexo || '',
       foto_url || '', descricao || '', !!vacinado, !!castrado, cidade || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarAnimal:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Listar animais disponíveis — público, com filtros opcionais ──
exports.listarAnimais = async (req, res) => {
  try {
    const { especie, porte, cidade } = req.query;
    const condicoes = [`status = 'disponivel'`];
    const valores = [];

    if (especie) { valores.push(especie); condicoes.push(`especie = $${valores.length}`); }
    if (porte)   { valores.push(porte);   condicoes.push(`porte = $${valores.length}`); }
    if (cidade)  { valores.push(`%${cidade}%`); condicoes.push(`cidade ILIKE $${valores.length}`); }

    const result = await pool.query(
      `SELECT a.*, u.nome AS nome_anunciante
       FROM animais_adocao a
       JOIN usuarios u ON u.id = a.usuario_id
       WHERE ${condicoes.join(' AND ')}
       ORDER BY a.criado_em DESC`,
      valores
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarAnimais:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Detalhe de 1 animal — público ────────────────────────────────
exports.buscarAnimalPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT a.*, u.nome AS nome_anunciante, u.tipo AS tipo_anunciante
       FROM animais_adocao a
       JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Animal não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarAnimalPorId:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Meus animais postados (qualquer status) ──────────────────────
exports.meusAnimais = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      `SELECT * FROM animais_adocao WHERE usuario_id = $1 ORDER BY criado_em DESC`,
      [usuario_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro meusAnimais:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Atualizar status (em_processo / adotado) — só quem postou ────
exports.atualizarStatusAnimal = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!['disponivel', 'em_processo', 'adotado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    const result = await pool.query(
      `UPDATE animais_adocao SET status = $1 WHERE id = $2 AND usuario_id = $3 RETURNING *`,
      [status, id, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Animal não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarStatusAnimal:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Manifestar interesse — notifica quem postou por push ─────────
exports.manifestarInteresse = async (req, res) => {
  try {
    const interessado_id = req.usuario.id;
    const { id } = req.params;

    const animalResult = await pool.query('SELECT * FROM animais_adocao WHERE id = $1', [id]);
    if (animalResult.rows.length === 0) return res.status(404).json({ erro: 'Animal não encontrado' });
    const animal = animalResult.rows[0];

    if (animal.usuario_id === interessado_id)
      return res.status(400).json({ erro: 'Você não pode manifestar interesse no seu próprio anúncio' });

    try {
      await pool.query(
        'INSERT INTO interesses_adocao (animal_id, interessado_id) VALUES ($1, $2)',
        [id, interessado_id]
      );
    } catch (e) {
      if (e.code === '23505') // unique_violation — já manifestou antes
        return res.status(400).json({ erro: 'Você já manifestou interesse nesse animal' });
      throw e;
    }

    const interessadoResult = await pool.query('SELECT nome, telefone FROM usuarios u LEFT JOIN medicos m ON m.usuario_id = u.id WHERE u.id = $1', [interessado_id]);
    const nomeInteressado = interessadoResult.rows[0]?.nome || 'Alguém';
    const telefoneInteressado = interessadoResult.rows[0]?.telefone || '';

    const donoResult = await pool.query('SELECT push_token FROM usuarios WHERE id = $1', [animal.usuario_id]);
    await enviarPush(
      donoResult.rows[0]?.push_token,
      '🐾 Alguém se interessou!',
      `${nomeInteressado} quer adotar ${animal.nome}${telefoneInteressado ? ` — telefone: ${telefoneInteressado}` : ''}`
    );

    res.json({ mensagem: 'Interesse registrado! Quem postou foi notificado.' });
  } catch (err) {
    console.error('Erro manifestarInteresse:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Ver quem se interessou — só quem postou o animal ─────────────
exports.listarInteressados = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const animalResult = await pool.query('SELECT usuario_id FROM animais_adocao WHERE id = $1', [id]);
    if (animalResult.rows.length === 0) return res.status(404).json({ erro: 'Animal não encontrado' });
    if (animalResult.rows[0].usuario_id !== usuario_id)
      return res.status(403).json({ erro: 'Só quem postou o animal pode ver os interessados' });

    const result = await pool.query(
      `SELECT i.criado_em, u.nome, u.email, m.telefone
       FROM interesses_adocao i
       JOIN usuarios u ON u.id = i.interessado_id
       LEFT JOIN medicos m ON m.usuario_id = u.id
       WHERE i.animal_id = $1
       ORDER BY i.criado_em ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarInteressados:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};