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
    if (!nome || !email || !senha || !especialidade || !crm)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRMV' });

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

    // ✅ NOVO: não emite token nenhum aqui — a conta nasce com
    // status_verificacao = 'pendente' (padrão da coluna) e só recebe
    // token de verdade quando faz login DEPOIS de aprovada por um admin.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    console.error('Erro registerMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Cadastro de petshop ou prestador de serviços ────────────────
// ✅ NOVO: reaproveita a MESMA tabela `medicos` que já serve pra
// veterinário — assim já nasce aparecendo na busca, na agenda e no
// sistema de avaliação existentes, sem precisar de tabela nova. Os
// serviços oferecidos (banho, tosa, hospedagem etc.) são guardados como
// texto separado por vírgula no campo `especialidade`.
// ⚠️ tipo_conta pode ser 'petshop' OU 'servico' — validado aqui, nunca
// confiando cegamente no que o app manda. A distinção existe pra, no
// futuro, só petshop poder vender produto (ração etc.) — hoje as duas
// contas fazem exatamente a mesma coisa (oferecer serviços agendáveis).
exports.registerPetshop = async (req, res) => {
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, cnpj, cpf, servicos, tipo_conta, tem_entrega } = req.body;

    // ✅ Trava de segurança: só aceita esses dois valores, senão cai
    // sempre em 'petshop' — não deixa o app mandar qualquer string solta
    // pro banco.
    const tipoContaVal = tipo_conta === 'servico' ? 'servico' : 'petshop';

    // ✅ Petshop (loja de verdade) exige CNPJ. Serviços (prestador
    // autônomo) exige CPF — nem todo prestador individual tem empresa
    // formalizada, e exigir CNPJ de quem só passeia com cachorro nas
    // horas vagas era uma barreira sem necessidade real.
    if (!nome || !email || !senha || !Array.isArray(servicos) || servicos.length === 0)
      return res.status(400).json({ erro: 'Preencha todos os campos e selecione ao menos um serviço' });

    let cnpjLimpo = '';
    let cpfLimpo  = '';
    if (tipoContaVal === 'petshop') {
      cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
      if (cnpjLimpo.length !== 14)
        return res.status(400).json({ erro: 'CNPJ inválido — deve ter 14 dígitos' });
    } else {
      cpfLimpo = String(cpf || '').replace(/\D/g, '');
      if (cpfLimpo.length !== 11)
        return res.status(400).json({ erro: 'CPF inválido — deve ter 11 dígitos' });
    }

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];

    // Traduz os ids de serviço pra rótulos legíveis (igual mostrado no app)
    const ROTULOS_SERVICO = {
      banho: 'Banho', tosa: 'Tosa', unhas: 'Corte de unhas',
      dental: 'Escovação dental', ouvidos: 'Limpeza de ouvidos',
      fisioterapia: 'Fisioterapia', acupuntura: 'Acupuntura',
      natacao: 'Natação / Hidroterapia',
      hospedagem: 'Hospedagem domiciliar', petsitter: 'Pet sitter',
      creche: 'Creche / Day care', dogwalker: 'Dog walker / Passeador',
      taxidog: 'Táxi dog', adestramento: 'Adestramento',
      fotografia: 'Fotografia pet',
    };
    const servicosTexto = servicos.map(s => ROTULOS_SERVICO[s] || s).join(', ');

    await pool.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, cnpj, cpf, tem_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [usuario.id, servicosTexto, '', telefone || '', endereco || '', cidade || '', cep || '', '', '', '', tipoContaVal, cnpjLimpo, cpfLimpo, !!tem_entrega]
    );

    // ✅ NOVO: não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    console.error('Erro registerPetshop:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Cadastro de clínica veterinária ─────────────────────────────
// ✅ NOVO: login único da recepção, gerenciando a agenda de toda a
// clínica (não é vínculo de vários veterinários com login próprio —
// decisão consciente pra manter simples, igual conversamos). Reaproveita
// a MESMA tabela `medicos` de novo. Especialidades + exames/procedimentos
// são guardados JUNTOS, separados por vírgula, no campo `especialidade`
// — assim a busca por texto que já existe encontra a clínica tanto
// procurando "Cardiologista" quanto "Raio-X", sem precisar de coluna nova.
exports.registerClinica = async (req, res) => {
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, crm, especialidades, exames } = req.body;
    if (!nome || !email || !senha || !crm || !Array.isArray(especialidades) || especialidades.length === 0)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRMV, e selecione ao menos uma especialidade' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];

    const ROTULOS_EXAME = {
      raiox: 'Raio-X', ultrassom: 'Ultrassonografia', ecg: 'Eletrocardiograma',
      laboratorial: 'Exames laboratoriais', cirurgia: 'Cirurgia',
      internacao: 'Internação', vacinacao: 'Vacinação', castracao: 'Castração',
      emergencia24h: 'Emergência 24h', domiciliar: 'Atendimento domiciliar',
    };
    const examesTexto = Array.isArray(exames) ? exames.map(e => ROTULOS_EXAME[e] || e) : [];
    // Especialidades primeiro (é o que bate com os chips de busca ao pé
    // da letra), depois os exames — tudo junto no mesmo campo de texto.
    const especialidadeTexto = [...especialidades, ...examesTexto].join(', ');
    // ✅ NOVO: além do campo combinado (mantido pra não quebrar a busca
    // por texto já existente), salva os exames separados também — é
    // isso que permite mostrar "Exames disponíveis" isolado no perfil
    // da clínica, sem depender de re-interpretar o texto combinado.
    const examesTextoSeparado = examesTexto.join(', ');

    await pool.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, exames_procedimentos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [usuario.id, especialidadeTexto, crm, telefone || '', endereco || '', cidade || '', cep || '', '', '', '', 'clinica', examesTextoSeparado]
    );

    // ✅ NOVO: não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    console.error('Erro registerClinica:', err.message);
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

    // ✅ NOVO: bloqueia login de conta profissional ainda não aprovada
    // por um admin. Consulta e emite o token só DEPOIS de confirmar que
    // está aprovada — assim uma conta pendente nunca recebe token válido.
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
        'SELECT especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, status_verificacao FROM medicos WHERE usuario_id = $1',
        [usuario.id]
      );
      if (medico.rows.length > 0) {
        const statusVerificacao = medico.rows[0].status_verificacao || 'aprovado';
        if (statusVerificacao === 'pendente') {
          return res.status(403).json({
            erro: 'Seu cadastro ainda está em análise. Você poderá fazer login assim que for aprovado.',
            status_verificacao: 'pendente',
          });
        }
        if (statusVerificacao === 'reprovado') {
          return res.status(403).json({
            erro: 'Seu cadastro não foi aprovado. Entre em contato com o suporte para mais informações.',
            status_verificacao: 'reprovado',
          });
        }

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

    const token = jwt.sign({ id: usuario.id, tipo: usuario.tipo }, SECRET, { expiresIn: '30d' });

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
// ✅ NOVO: busca a configuração atual do profissional (tem_entrega,
// atendimento_domiciliar, telemedicina) — usado pela tela de
// configurações pra carregar o estado atual antes de editar. Sem isso,
// a tela não teria como saber o valor de cada toggle ao abrir.
exports.buscarMeuPerfilProfissional = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT tipo_conta, tem_entrega, atendimento_domiciliar, telemedicina, intervalo_lembrete_dias, especialidade, exames_procedimentos FROM medicos WHERE usuario_id = $1',
      [usuario_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Perfil profissional não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro buscarMeuPerfilProfissional:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: edita especialidades/exames-procedimentos DEPOIS do
// cadastro — corrige o problema de ficar preso pra sempre no que foi
// escolhido no dia do cadastro. Um petshop pode começar a oferecer
// day care meses depois, um prestador pode passar a fazer adestramento
// — isso precisa ser configuração viva, não decisão única e travada.
// Serve tanto pra clínica (especialidades + exames) quanto pra
// petshop/serviço (que usa só a lista de "especialidades" como tipos
// de serviço oferecidos).
// ═══════════════════════════════════════════════════════════════
exports.atualizarServicosOferecidos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { especialidades, exames } = req.body;

    if (!Array.isArray(especialidades) || especialidades.length === 0)
      return res.status(400).json({ erro: 'Selecione ao menos um item' });

    const ROTULOS_EXAME = {
      raiox: 'Raio-X', ultrassom: 'Ultrassonografia', ecg: 'Eletrocardiograma',
      laboratorial: 'Exames laboratoriais', cirurgia: 'Cirurgia',
      internacao: 'Internação', vacinacao: 'Vacinação', castracao: 'Castração',
      emergencia24h: 'Emergência 24h', domiciliar: 'Atendimento domiciliar',
    };
    const examesTexto = Array.isArray(exames) ? exames.map(e => ROTULOS_EXAME[e] || e) : [];
    const especialidadeTexto = [...especialidades, ...examesTexto].join(', ');
    const examesTextoSeparado = examesTexto.join(', ');

    const result = await pool.query(
      `UPDATE medicos SET especialidade = $1, exames_procedimentos = $2
       WHERE usuario_id = $3 RETURNING especialidade, exames_procedimentos`,
      [especialidadeTexto, examesTextoSeparado, usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Perfil não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro atualizarServicosOferecidos:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.atualizarPerfilMedico = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { bio, telefone, endereco, cidade, cep, valor_consulta, tem_entrega, atendimento_domiciliar, telemedicina } = req.body;

    await pool.query(
      `UPDATE medicos SET
        bio                    = COALESCE($1, bio),
        telefone               = COALESCE($2, telefone),
        endereco               = COALESCE($3, endereco),
        cidade                 = COALESCE($4, cidade),
        cep                    = COALESCE($5, cep),
        valor_consulta         = COALESCE($6, valor_consulta),
        tem_entrega            = COALESCE($7, tem_entrega),
        atendimento_domiciliar = COALESCE($8, atendimento_domiciliar),
        telemedicina           = COALESCE($9, telemedicina)
      WHERE usuario_id = $10`,
      [bio, telefone, endereco, cidade, cep, valor_consulta, tem_entrega, atendimento_domiciliar, telemedicina, usuario_id]
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

// ── Cadastro de farmácia de manipulação veterinária ─────────────
// ✅ NOVO: mesma tabela `medicos` de novo. CRF obrigatório (validado
// aqui e depois conferido manualmente pelo admin no site do conselho).
// Escopo deliberadamente limitado — não trata substância de controle
// especial (foge do escopo de solicitação simples que esse app oferece).
exports.registerFarmacia = async (req, res) => {
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, crf, categorias, tem_entrega } = req.body;
    if (!nome || !email || !senha || !crf || !Array.isArray(categorias) || categorias.length === 0)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRF, e selecione ao menos uma categoria' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];

    const ROTULOS_CATEGORIA = {
      palatavel: 'Palatáveis (sabor)', dose: 'Dose customizada',
      combinacao: 'Combinação de fármacos', antibiotico: 'Antibióticos',
      antiinflamatorio: 'Anti-inflamatórios', dermatologico: 'Dermatológicos',
      topico: 'Formulações tópicas', suplemento: 'Suplementos/Nutracêuticos',
      hormonal: 'Hormonais (não controlados)',
    };
    const categoriasTexto = categorias.map(c => ROTULOS_CATEGORIA[c] || c).join(', ');

    await pool.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, tem_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [usuario.id, categoriasTexto, crf, telefone || '', endereco || '', cidade || '', cep || '', '', '', '', 'farmacia', !!tem_entrega]
    );

    // ✅ Não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    console.error('Erro registerFarmacia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: login simples ────────────────────────────────────────
// ✅ NOVO: "conta simples só de aprovação" — não é um usuário na tabela
// `usuarios`, é uma credencial fixa guardada em variável de ambiente
// (ADMIN_EMAIL / ADMIN_SENHA no Railway). Mais seguro que criar uma
// linha no banco pra isso: não aparece em nenhuma consulta SQL comum,
// não pode ser "achado" via busca de usuários.
// ⚠️ PENDENTE: você precisa configurar ADMIN_EMAIL e ADMIN_SENHA nas
// variáveis de ambiente do Railway (aba Variables do serviço backend) —
// sem isso, o login de admin nunca vai funcionar (cai sempre no erro).
exports.adminLogin = async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ erro: 'Preencha e-mail e senha' });

    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
    const ADMIN_SENHA  = process.env.ADMIN_SENHA;

    if (!ADMIN_EMAIL || !ADMIN_SENHA) {
      console.error('ADMIN_EMAIL / ADMIN_SENHA não configurados nas variáveis de ambiente!');
      return res.status(500).json({ erro: 'Login de admin não configurado no servidor.' });
    }

    if (email !== ADMIN_EMAIL || senha !== ADMIN_SENHA)
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    const token = jwt.sign({ tipo: 'admin' }, SECRET, { expiresIn: '12h' });
    res.json({ token, tipo: 'admin' });
  } catch (err) {
    console.error('Erro adminLogin:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: listar cadastros pendentes ───────────────────────────
exports.listarPendentes = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.nome, u.email, u.criado_em,
        m.especialidade, m.crm, m.cnpj, m.cpf, m.telefone, m.endereco, m.cidade, m.cep,
        m.tipo_conta, m.status_verificacao
      FROM usuarios u
      JOIN medicos m ON m.usuario_id = u.id
      WHERE m.status_verificacao = 'pendente'
      ORDER BY u.criado_em ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarPendentes:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: aprovar cadastro ──────────────────────────────────────
exports.aprovarConta = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE medicos SET status_verificacao = 'aprovado' WHERE usuario_id = $1 RETURNING usuario_id",
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Conta não encontrada' });
    res.json({ mensagem: 'Conta aprovada com sucesso' });
  } catch (err) {
    console.error('Erro aprovarConta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── ADMIN: reprovar cadastro ─────────────────────────────────────
exports.reprovarConta = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "UPDATE medicos SET status_verificacao = 'reprovado' WHERE usuario_id = $1 RETURNING usuario_id",
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ erro: 'Conta não encontrada' });
    res.json({ mensagem: 'Conta reprovada' });
  } catch (err) {
    console.error('Erro reprovarConta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};