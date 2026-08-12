const pool      = require('../database');

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'hub_super_secret_2025';

// ── Cadastro paciente ─────────────────────────────────────────
exports.registerPaciente = async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'Preencha todos os campos' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'paciente']
    );

    const usuario = result.rows[0];
    const token   = jwt.sign({ id: usuario.id, tipo: 'paciente' }, SECRET, { expiresIn: '30d' });

    res.status(201).json({ token, nome: usuario.nome, email: usuario.email, tipo: 'paciente' });
  } catch (err) {
    console.error('Erro registerPaciente:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Cadastro médico ───────────────────────────────────────────
// ⚠️ Requer migração no banco (rodar uma vez):
//   ALTER TABLE medicos ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
//   ALTER TABLE medicos ADD COLUMN IF NOT EXISTS valor_consulta TEXT DEFAULT '';
//   ALTER TABLE medicos ADD COLUMN IF NOT EXISTS tipo_conta TEXT DEFAULT 'medico';
exports.registerMedico = async (req, res) => {
  try {
    const {
      nome, email, senha, especialidade, crm, telefone, endereco, cidade, cep,
      bio, valor_consulta, foto_base64,
    } = req.body;
    if (!nome || !email || !senha || !especialidade)
      return res.status(400).json({ erro: 'Preencha todos os campos' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];

    const enderecoCompleto = endereco || '';
    const cidadeVal        = cidade   || '';
    const cepVal           = cep      || '';
    const bioVal            = bio            || '';
    const valorConsultaVal  = valor_consulta || '';
    const fotoVal           = foto_base64    || '';
    // ✅ SPLIT: backend só de pet — tipo_conta sempre 'veterinario',
    // ignorando qualquer valor que venha do corpo da requisição. Isso
    // garante que esse backend nunca cria conta médica humana, mesmo
    // que o app que chamar aqui esteja com bug ou seja de outro
    // ambiente.
    const tipoContaVal      = 'veterinario';

    await pool.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [usuario.id, especialidade, crm || '', telefone || '', enderecoCompleto, cidadeVal, cepVal, fotoVal, bioVal, valorConsultaVal, tipoContaVal]
    );

    const token = jwt.sign({ id: usuario.id, tipo: 'medico' }, SECRET, { expiresIn: '30d' });

    res.status(201).json({
      token,
      nome:          usuario.nome,
      email:         usuario.email,
      tipo:          'medico',
      especialidade,
      crm:           crm      || '',
      telefone:      telefone || '',
      endereco:      enderecoCompleto,
      cidade:        cidadeVal,
      cep:           cepVal,
      foto_url:      fotoVal,
      bio:           bioVal,
      valor_consulta: valorConsultaVal,
      tipo_conta:    tipoContaVal,
    });
  } catch (err) {
    console.error('Erro registerMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Login ─────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ erro: 'Preencha e-mail e senha' });

    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    const usuario = result.rows[0];
    const senhaOk = await bcrypt.compare(senha, usuario.senha);
    if (!senhaOk)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    const token = jwt.sign({ id: usuario.id, tipo: usuario.tipo }, SECRET, { expiresIn: '30d' });

    let especialidade = '';
    let crm = '';
    let telefone = '';
    let endereco = '';
    let cidade = '';
    let cep = '';
    let foto_url = '';
    let bio = '';
    let valor_consulta = '';
    let tipo_conta = 'medico';
    if (usuario.tipo === 'medico') {
      const medico = await pool.query(
        'SELECT especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta FROM medicos WHERE usuario_id = $1',
        [usuario.id]
      );
      if (medico.rows.length > 0) {
        especialidade  = medico.rows[0].especialidade   || '';
        crm            = medico.rows[0].crm             || '';
        telefone       = medico.rows[0].telefone        || '';
        endereco       = medico.rows[0].endereco        || '';
        cidade         = medico.rows[0].cidade          || '';
        cep            = medico.rows[0].cep             || '';
        foto_url       = medico.rows[0].foto_url        || '';
        bio            = medico.rows[0].bio             || '';
        valor_consulta = medico.rows[0].valor_consulta  || '';
        tipo_conta     = medico.rows[0].tipo_conta      || 'medico';
      }
    }

    res.json({
      token,
      nome:          usuario.nome,
      email:         usuario.email,
      tipo:          usuario.tipo,
      especialidade,
      crm,
      telefone,
      endereco,
      cidade,
      cep,
      foto_url,
      bio,
      valor_consulta,
      tipo_conta,
    });
  } catch (err) {
    console.error('Erro login:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Excluir conta ─────────────────────────────────────────────
exports.excluirConta = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;

    await pool.query('DELETE FROM consultas WHERE paciente_id = $1 OR medico_id = $1', [usuario_id]);
    await pool.query('DELETE FROM agenda_config WHERE medico_id = $1', [usuario_id]);
    await pool.query('DELETE FROM medicos WHERE usuario_id = $1', [usuario_id]);
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuario_id]);

    res.json({ mensagem: 'Conta excluída com sucesso' });
  } catch (err) {
    console.error('Erro excluirConta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Geocodificar endereço do médico ───────────────────────────
exports.geocodificarMedico = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { cep } = req.body;
    if (!cep) return res.status(400).json({ erro: 'CEP não fornecido' });

    const cepLimpo = cep.replace(/[^0-9]/g, '');

    // Busca endereço pelo CEP
    const viaCep = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const endereco = await viaCep.json();

    if (endereco.erro) return res.status(400).json({ erro: 'CEP inválido' });

    // Geocodifica com Nominatim — tenta queries progressivamente mais simples
    const queries = [
      `${endereco.logradouro}, ${endereco.bairro}, ${endereco.localidade}, ${endereco.uf}, Brasil`,
      `${endereco.localidade}, ${endereco.uf}, Brasil`,
      `${endereco.localidade}, Brasil`,
    ];

    let coords = [];
    let queryUsada = queries[0];
    for (const q of queries) {
      const nominatim = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
        { headers: { 'User-Agent': 'HUB-HealthUrbanBridge/1.0' } }
      );
      coords = await nominatim.json();
      if (coords && coords.length > 0) { queryUsada = q; break; }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!coords || coords.length === 0) {
      return res.status(400).json({ erro: 'Não foi possível obter coordenadas para este CEP' });
    }

    const { lat, lon } = coords[0];

    await pool.query(
      'UPDATE medicos SET latitude = $1, longitude = $2 WHERE usuario_id = $3',
      [parseFloat(lat), parseFloat(lon), usuario_id]
    );

    res.json({ latitude: lat, longitude: lon, endereco: queryUsada });
  } catch (err) {
    console.error('Erro geocodificarMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ✅ Salva bio/telefone/endereço/cidade/cep editados no perfil do médico
exports.atualizarPerfilMedico = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { bio, telefone, endereco, cidade, cep, valor_consulta } = req.body;

    await pool.query(
      `UPDATE medicos SET
        bio            = COALESCE($1, bio),
        telefone       = COALESCE($2, telefone),
        endereco       = COALESCE($3, endereco),
        cidade         = COALESCE($4, cidade),
        cep            = COALESCE($5, cep),
        valor_consulta = COALESCE($6, valor_consulta)
      WHERE usuario_id = $7`,
      [bio, telefone, endereco, cidade, cep, valor_consulta, usuario_id]
    );

    res.json({ mensagem: 'Perfil atualizado com sucesso' });
  } catch (err) {
    console.error('Erro atualizarPerfilMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.atualizarFotoMedico = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { foto_base64 } = req.body;
    await pool.query(
      'UPDATE medicos SET foto_url = $1 WHERE usuario_id = $2',
      [foto_base64 || '', usuario_id]
    );
    res.json({ mensagem: 'Foto atualizada com sucesso', foto_url: foto_base64 });
  } catch (err) {
    console.error('Erro atualizarFotoMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Remover fundo do carimbo via remove.bg ───────────────────
exports.removerFundoCarimbo = async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ erro: 'Imagem não fornecida' });

    const REMOVE_BG_KEY = process.env.REMOVE_BG_KEY || 'nP4bEHkzi28czJ6J5xMK81ZM';

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': REMOVE_BG_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_file_b64: image_base64,
        size: 'auto',
        format: 'png',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('remove.bg error:', err);
      return res.status(response.status).json({ erro: 'Erro remove.bg: ' + response.status });
    }

    const buffer = await response.arrayBuffer();
    const base64Result = Buffer.from(buffer).toString('base64');
    res.json({ png_base64: `data:image/png;base64,${base64Result}` });
  } catch (err) {
    console.error('Erro removerFundoCarimbo:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Salvar carimbo do médico ──────────────────────────────────
exports.salvarCarimbo = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { carimbo_base64 } = req.body;
    await pool.query(
      'UPDATE medicos SET carimbo_url = $1 WHERE usuario_id = $2',
      [carimbo_base64, usuario_id]
    );
    res.json({ mensagem: 'Carimbo salvo com sucesso' });
  } catch (err) {
    console.error('Erro salvarCarimbo:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ── Buscar carimbo do médico ──────────────────────────────────
exports.buscarCarimbo = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT carimbo_url FROM medicos WHERE usuario_id = $1',
      [usuario_id]
    );
    res.json({ carimbo_url: result.rows[0]?.carimbo_url || null });
  } catch (err) {
    console.error('Erro buscarCarimbo:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ── Salvar push token ─────────────────────────────────────────
exports.salvarPushToken = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { push_token } = req.body;
    await pool.query(
      'UPDATE usuarios SET push_token = $1 WHERE id = $2',
      [push_token, usuario_id]
    );
    res.json({ mensagem: 'Token salvo' });
  } catch (err) {
    console.error('Erro salvarPushToken:', err.message);
    res.status(500).json({ erro: 'Erro interno' });
  }
};

// ── Alterar senha ─────────────────────────────────────────────
exports.alterarSenha = async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  const userId = req.usuario.id;

  if (!senhaAtual || !novaSenha)
    return res.status(400).json({ erro: 'Informe a senha atual e a nova senha.' });
  if (novaSenha.length < 6)
    return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres.' });

  try {
    const result = await pool.query('SELECT senha FROM usuarios WHERE id = $1', [userId]);
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Usuario nao encontrado.' });

    const senhaOk = await bcrypt.compare(senhaAtual, result.rows[0].senha);
    if (!senhaOk)
      return res.status(401).json({ erro: 'Senha atual incorreta.' });

    const hash = await bcrypt.hash(novaSenha, 10);
    await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [hash, userId]);

    res.json({ mensagem: 'Senha alterada com sucesso!' });
  } catch (e) {
    console.error('Erro alterarSenha:', e.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};

// ── Verificar se um e-mail já existe (sem efeito colateral) ───
exports.verificarEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ erro: 'Informe o e-mail.' });

    const result = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    res.json({ existe: result.rows.length > 0 });
  } catch (err) {
    console.error('Erro verificarEmail:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};

// ── Recuperar senha (sem email — verifica email e troca senha) ─
exports.recuperarSenha = async (req, res) => {
  const { email, novaSenha } = req.body;

  if (!email || !novaSenha)
    return res.status(400).json({ erro: 'Informe o e-mail e a nova senha.' });
  if (novaSenha.length < 6)
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });

  try {
    const result = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'E-mail nao encontrado. Verifique e tente novamente.' });

    const hash = await bcrypt.hash(novaSenha, 10);
    await pool.query('UPDATE usuarios SET senha = $1 WHERE email = $2', [hash, email]);

    res.json({ mensagem: 'Senha alterada com sucesso!' });
  } catch (e) {
    console.error('Erro recuperarSenha:', e.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};