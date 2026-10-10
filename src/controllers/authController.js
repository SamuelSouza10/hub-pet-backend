const pool      = require('../database');

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { enviarCodigoRecuperacao } = require('../utils/resendEmail');
// ✅ NOVO: CPF e RG são dados de identificação sensíveis — mesmo
// tratamento que já demos ao token de pagamento. Nunca ficam em
// texto puro no banco.
const { cifrar, decifrar } = require('../utils/cryptoUtil');

// ✅ CORRIGIDO: tinha um valor padrão escondido no código
// ('hub_super_secret_2025') usado quando a variável de ambiente não
// estava configurada. Isso é gravíssimo — como esse valor fica
// visível pra qualquer um com acesso ao código-fonte, permitiria
// forjar um token válido pra QUALQUER conta, inclusive admin. Agora
// o servidor recusa iniciar sem a variável real configurada, em vez
// de cair silenciosamente num segredo previsível.
const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error(
    'JWT_SECRET não configurado. Gere um valor forte com `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"` ' +
    'e configure como variável de ambiente antes de iniciar o servidor.'
  );
}

// ✅ Compara duas strings em tempo constante — usada no login do
// admin, que não tem hash (é comparação direta com variável de
// ambiente). timingSafeEqual exige buffers do mesmo tamanho, por
// isso o padEnd: sem isso, comparar strings de tamanhos diferentes
// já lançaria erro antes de proteger nada.
function compararSeguro(a, b) {
  const bufA = Buffer.from(String(a || '').padEnd(256, '\0'));
  const bufB = Buffer.from(String(b || '').padEnd(256, '\0'));
  return crypto.timingSafeEqual(bufA, bufB);
}

// ✅ NOVO: registra quem aceitou os Termos de Uso / Política de
// Privacidade, quando, e qual versão — usado em todo cadastro
// (tutor e as 4 variantes de profissional). A LGPD exige que o
// consentimento seja demonstrável, não só "ter mostrado a tela".
const VERSAO_TERMOS_ATUAL = '1.0';
// ✅ Aceita um `client` opcional — quando o cadastro roda dentro de
// uma transação (ver registerMedico/Petshop/Clinica/Farmacia), o
// aceite precisa ser escrito pela MESMA conexão/transação, senão um
// ROLLBACK no restante do cadastro não desfaria o aceite já gravado
// (ficaria um registro de consentimento "órfão", sem o usuário
// correspondente).
async function registrarAceiteTermos(usuario_id, req, client = pool) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  await client.query(
    'INSERT INTO aceites_termos (usuario_id, versao, ip) VALUES ($1, $2, $3)',
    [usuario_id, VERSAO_TERMOS_ATUAL, ip]
  );
}

// ── Cadastro paciente ─────────────────────────────────────────
exports.registerPaciente = async (req, res) => {
  try {
    const { nome, email, senha, aceitouTermos } = req.body;
    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'Preencha todos os campos' });
    if (!aceitouTermos)
      return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.' });

    const existe = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0)
      return res.status(400).json({ erro: 'E-mail já cadastrado' });

    const hash   = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'paciente']
    );

    const usuario = result.rows[0];
    await registrarAceiteTermos(usuario.id, req);
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
  // ✅ CORRIGIDO: criava o usuário numa query e o perfil profissional
  // em outra, sem transação — se a segunda falhasse por qualquer
  // motivo (erro de rede, de validação, etc.), sobrava um usuário
  // "fantasma": consegue existir e até logar, mas sem nenhum perfil
  // de médico associado, quebrando qualquer tela que dependa disso.
  // Encontrado testando o mesmo padrão no cadastro de petshop.
  let client;
  try {
    const {
      nome, email, senha, especialidade, crm, telefone, endereco, cidade, cep,
      bio, valor_consulta, foto_base64, aceitouTermos,
    } = req.body;
    if (!nome || !email || !senha || !especialidade || !crm)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRMV' });
    if (!aceitouTermos)
      return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.' });

    client = await pool.connect();
    await client.query('BEGIN');

    const existe = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'E-mail já cadastrado' });
    }

    const hash   = await bcrypt.hash(senha, 10);
    const result = await client.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];
    await registrarAceiteTermos(usuario.id, req, client);

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

    await client.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [usuario.id, especialidade, crm || '', telefone || '', enderecoCompleto, cidadeVal, cepVal, fotoVal, bioVal, valorConsultaVal, tipoContaVal]
    );

    await client.query('COMMIT');

    // ✅ NOVO: não emite token nenhum aqui — a conta nasce com
    // status_verificacao = 'pendente' (padrão da coluna) e só recebe
    // token de verdade quando faz login DEPOIS de aprovada por um admin.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    console.error('Erro registerMedico:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
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
  // ✅ CORRIGIDO: mesma falha de integridade achada no cadastro de
  // médico — sem transação, um erro entre criar o usuário e criar o
  // perfil (ex: falha ao cifrar o CPF) deixava um usuário "fantasma":
  // login existe, perfil profissional não.
  let client;
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, cnpj, cpf, servicos, tipo_conta, tem_entrega, aceitouTermos } = req.body;

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
    if (!aceitouTermos)
      return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.' });

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

    client = await pool.connect();
    await client.query('BEGIN');

    const existe = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'E-mail já cadastrado' });
    }

    const hash   = await bcrypt.hash(senha, 10);
    const result = await client.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];
    await registrarAceiteTermos(usuario.id, req, client);

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

    // ✅ A cifragem do CPF roda ANTES do INSERT, ainda dentro do try —
    // se falhar (chave ausente, etc.), cai no catch e dá ROLLBACK,
    // sem deixar o usuário já criado pela metade.
    const cpfCifrado = cifrar(cpfLimpo) || '';

    await client.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, cnpj, cpf, tem_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [usuario.id, servicosTexto, '', telefone || '', endereco || '', cidade || '', cep || '', '', '', '', tipoContaVal, cnpjLimpo, cpfCifrado, !!tem_entrega]
    );

    await client.query('COMMIT');

    // ✅ NOVO: não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    console.error('Erro registerPetshop:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
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
  // ✅ CORRIGIDO: mesma falha de integridade dos outros cadastros —
  // sem transação, um erro entre os dois INSERTs deixava um usuário
  // sem perfil profissional associado.
  let client;
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, crm, especialidades, exames, aceitouTermos } = req.body;
    if (!nome || !email || !senha || !crm || !Array.isArray(especialidades) || especialidades.length === 0)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRMV, e selecione ao menos uma especialidade' });
    if (!aceitouTermos)
      return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.' });

    client = await pool.connect();
    await client.query('BEGIN');

    const existe = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'E-mail já cadastrado' });
    }

    const hash   = await bcrypt.hash(senha, 10);
    const result = await client.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];
    await registrarAceiteTermos(usuario.id, req, client);

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

    await client.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, exames_procedimentos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [usuario.id, especialidadeTexto, crm, telefone || '', endereco || '', cidade || '', cep || '', '', '', '', 'clinica', examesTextoSeparado]
    );

    await client.query('COMMIT');

    // ✅ NOVO: não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    console.error('Erro registerClinica:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
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

    // ✅ NOVO: bloqueio temporário depois de tentativas erradas
    // seguidas — sem isso, bcrypt sozinho só atrasa cada tentativa
    // individual, não impede um ataque automatizado de testar
    // milhares de senhas.
    if (usuario.bloqueado_login_ate && new Date(usuario.bloqueado_login_ate) > new Date()) {
      const minutosRestantes = Math.ceil((new Date(usuario.bloqueado_login_ate) - new Date()) / 60000);
      return res.status(429).json({ erro: `Muitas tentativas erradas. Tente de novo em ${minutosRestantes} minuto(s).` });
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha);
    if (!senhaOk) {
      const novasTentativas = (usuario.tentativas_login_falhas || 0) + 1;
      // 5 tentativas erradas -> bloqueia por 15 minutos.
      const bloqueadoAte = novasTentativas >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await pool.query(
        'UPDATE usuarios SET tentativas_login_falhas = $1, bloqueado_login_ate = $2 WHERE id = $3',
        [novasTentativas, bloqueadoAte, usuario.id]
      );
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });
    }

    // Login certo — zera o contador de tentativas falhas.
    if (usuario.tentativas_login_falhas > 0 || usuario.bloqueado_login_ate) {
      await pool.query('UPDATE usuarios SET tentativas_login_falhas = 0, bloqueado_login_ate = NULL WHERE id = $1', [usuario.id]);
    }

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
// ✅ NOVO: bloqueia exclusão se existir taxa de mês já FECHADO (mês
// anterior ao atual) ainda não cobrada — evita que alguém suma da
// plataforma devendo. Taxas do mês corrente não contam como
// "pendência" ainda, porque o mês nem fechou.
async function temPendenciaPagamento(usuario_id) {
  const mesAtual = new Date().toISOString().slice(0, 7); // 'AAAA-MM'
  const result = await pool.query(
    `SELECT COALESCE(SUM(valor_taxa), 0) AS total, COUNT(*) AS quantidade
     FROM cobrancas_taxa
     WHERE usuario_id = $1 AND cobrado = false AND mes_referencia < $2`,
    [usuario_id, mesAtual]
  );
  const total = parseFloat(result.rows[0].total);
  return { pendente: total > 0, total, quantidade: parseInt(result.rows[0].quantidade, 10) };
}

// ✅ NOVO: o front chama isso ANTES de mostrar a confirmação de
// exclusão, pra avisar com o valor exato — sem surpresa na hora H.
exports.podeExcluirConta = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const status = await temPendenciaPagamento(usuario_id);
    res.json({ pode_excluir: !status.pendente, valor_pendente: status.total, meses_pendentes: status.quantidade });
  } catch (err) {
    console.error('Erro podeExcluirConta:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ✅ NOVO: exportação dos próprios dados (LGPD Art. 18, V — direito
// de portabilidade). Reúne os dados principais da conta num JSON que
// a pessoa pode baixar ou levar pra outro lugar.
exports.exportarDados = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;

    const usuarioResult = await pool.query(
      'SELECT nome, email, telefone, cpf, rg, endereco, data_nascimento, tipo, criado_em FROM usuarios WHERE id = $1',
      [usuario_id]
    );
    if (usuarioResult.rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const dados = usuarioResult.rows[0];
    try {
      if (dados.cpf) dados.cpf = decifrar(dados.cpf);
      if (dados.rg) dados.rg = decifrar(dados.rg);
    } catch (e) {
      console.error('Falha ao decifrar CPF/RG na exportação, usuário', usuario_id, ':', e.message);
    }

    const exportacao = { dados_da_conta: dados };

    // Se for profissional, inclui os dados profissionais também.
    const medicoResult = await pool.query(
      'SELECT especialidade, crm, cnpj, cpf, telefone, endereco, cidade, cep, bio, tipo_conta FROM medicos WHERE usuario_id = $1',
      [usuario_id]
    );
    if (medicoResult.rows.length > 0) {
      const perfilProfissional = medicoResult.rows[0];
      try {
        if (perfilProfissional.cpf) perfilProfissional.cpf = decifrar(perfilProfissional.cpf);
      } catch (e) {
        console.error('Falha ao decifrar CPF profissional na exportação, usuário', usuario_id, ':', e.message);
      }
      exportacao.perfil_profissional = perfilProfissional;
    }

    // Pets cadastrados, se for tutor.
    const petsResult = await pool.query(
      'SELECT nome, especie, raca FROM perfis_pet WHERE tutor_id = $1',
      [usuario_id]
    );
    if (petsResult.rows.length > 0) exportacao.pets = petsResult.rows;

    // Histórico de consultas (resumo).
    const consultasResult = await pool.query(
      `SELECT data, horario, especialidade, status, criado_em FROM consultas
       WHERE paciente_id = $1 OR medico_id = $1 ORDER BY criado_em DESC LIMIT 200`,
      [usuario_id]
    );
    if (consultasResult.rows.length > 0) exportacao.consultas = consultasResult.rows;

    res.setHeader('Content-Disposition', 'attachment; filename="meus-dados-hubpet.json"');
    res.json(exportacao);
  } catch (err) {
    console.error('Erro exportarDados:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.excluirConta = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;

    // ✅ NOVO: checagem no backend também — nunca confiar só na
    // validação do frontend, alguém poderia chamar a API direto.
    const status = await temPendenciaPagamento(usuario_id);
    if (status.pendente) {
      return res.status(400).json({
        erro: `Você tem R$ ${status.total.toFixed(2).replace('.', ',')} em taxas pendentes de ${status.quantidade} mês(es) anterior(es). Regularize antes de excluir a conta.`,
      });
    }

    // ✅ Todas as tabelas relacionadas já têm ON DELETE CASCADE nas
    // foreign keys pra usuarios(id) — testado contra banco real,
    // apagar o usuário já limpa consultas, agenda_config, medicos,
    // galeria_fotos, checkin, fichas, equipe_medica, prontuário,
    // ficha_comportamento, templates, solicitações de farmácia,
    // preços, assinatura e cobranças, tudo em cascata. Não precisa
    // de DELETE manual pra cada tabela.
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
      // ✅ CORRIGIDO: faltava telefone/endereco/cidade/cep/foto_url —
      // a tela de configurações usa esses campos pra pré-preencher o
      // formulário de "Dados do Negócio", e sem eles no SELECT sempre
      // vinham undefined, mesmo já tendo valor salvo no banco.
      // ✅ NOVO: vagas_simultaneas — usado pra popular o campo
      // editável de capacidade paralela em configuracoesprofissional.tsx.
      // ✅ NOVO: bio também — visível pro tutor no perfil público.
      // ✅ CORRIGIDO: faltava o próprio id — sem ele, telas como
      // gestaodeagenda.pet.tsx não tinham como buscar a config de
      // agenda pelo backend (que precisa do ID do médico).
      'SELECT usuario_id AS id, tipo_conta, tem_entrega, atendimento_domiciliar, telemedicina, intervalo_lembrete_dias, especialidade, exames_procedimentos, telefone, endereco, cidade, cep, foto_url, vagas_simultaneas, bio FROM medicos WHERE usuario_id = $1',
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
    // ✅ NOVO: vagas_simultaneas — quantos atendimentos em paralelo
    // esse petshop/serviço consegue fazer no mesmo horário.
    const { bio, telefone, endereco, cidade, cep, valor_consulta, tem_entrega, atendimento_domiciliar, telemedicina, vagas_simultaneas } = req.body;

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
        telemedicina           = COALESCE($9, telemedicina),
        vagas_simultaneas      = COALESCE($10, vagas_simultaneas)
      WHERE usuario_id = $11`,
      [bio, telefone, endereco, cidade, cep, valor_consulta, tem_entrega, atendimento_domiciliar, telemedicina, vagas_simultaneas, usuario_id]
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

    // ✅ CORRIGIDO: tinha uma chave de API real do remove.bg escondida
    // no código como valor padrão. Diferente do JWT_SECRET (crítico
    // pra autenticação de todo mundo), essa é só uma funcionalidade
    // específica — não faz sentido o servidor inteiro recusar iniciar
    // por causa dela, mas a chave não pode continuar exposta no
    // código-fonte (vazamento = qualquer um gasta a cota paga dela).
    const REMOVE_BG_KEY = process.env.REMOVE_BG_KEY;
    if (!REMOVE_BG_KEY) {
      return res.status(500).json({ erro: 'Remoção de fundo não configurada no servidor.' });
    }

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
// ═══════════════════════════════════════════════════════════════
// ✅ CORRIGIDO: o fluxo antigo trocava a senha de QUALQUER conta só
// sabendo o e-mail dela — sem confirmar posse nenhuma. Qualquer
// pessoa que soubesse o e-mail de alguém conseguia tomar a conta,
// sem precisar de acesso à caixa de entrada. Agora exige um código
// de 6 dígitos enviado por e-mail de verdade, válido por 15 minutos,
// com limite de tentativas.
// ═══════════════════════════════════════════════════════════════

// ── 1) Tutor/profissional pede o código ───────────────────────
exports.solicitarCodigoRecuperacao = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'Informe o e-mail.' });

  // ✅ Resposta SEMPRE igual, exista o e-mail ou não — evita que
  // alguém descubra quais e-mails têm conta no app testando aqui
  // ("enumeração de usuário").
  const respostaGenerica = { mensagem: 'Se esse e-mail tiver uma conta, enviamos um código pra ele.' };

  try {
    const usuarioResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (usuarioResult.rows.length === 0) return res.json(respostaGenerica);
    const usuario_id = usuarioResult.rows[0].id;

    // ✅ Evita spam: não gera um código novo se já tem um válido de
    // menos de 60 segundos atrás (evita lotar a caixa de entrada e
    // gastar a cota do Resend numa rajada de cliques).
    const recente = await pool.query(
      `SELECT id FROM codigos_recuperacao WHERE usuario_id = $1 AND criado_em > NOW() - INTERVAL '60 seconds' LIMIT 1`,
      [usuario_id]
    );
    if (recente.rows.length > 0) return res.json(respostaGenerica);

    const codigo = String(crypto.randomInt(100000, 999999)); // 6 dígitos
    const codigoHash = await bcrypt.hash(codigo, 10);
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await pool.query(
      `INSERT INTO codigos_recuperacao (usuario_id, codigo_hash, expira_em) VALUES ($1, $2, $3)`,
      [usuario_id, codigoHash, expiraEm]
    );

    await enviarCodigoRecuperacao(email, codigo);
    res.json(respostaGenerica);
  } catch (err) {
    console.error('Erro solicitarCodigoRecuperacao:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};

// ── 2) Confirma o código e troca a senha ──────────────────────
exports.confirmarCodigoRecuperacao = async (req, res) => {
  const { email, codigo, novaSenha } = req.body;
  if (!email || !codigo || !novaSenha)
    return res.status(400).json({ erro: 'Informe o e-mail, o código e a nova senha.' });
  if (novaSenha.length < 6)
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });

  try {
    const usuarioResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (usuarioResult.rows.length === 0) return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    const usuario_id = usuarioResult.rows[0].id;

    const codigoResult = await pool.query(
      `SELECT id, codigo_hash, tentativas FROM codigos_recuperacao
       WHERE usuario_id = $1 AND usado = false AND expira_em > NOW()
       ORDER BY criado_em DESC LIMIT 1`,
      [usuario_id]
    );
    if (codigoResult.rows.length === 0) return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    const linha = codigoResult.rows[0];

    // ✅ Depois de 5 tentativas erradas, invalida o código — força
    // pedir um novo em vez de deixar tentar pra sempre (o código
    // tem só 6 dígitos, 1 milhão de combinações, então sem esse
    // limite daria pra tentar força bruta).
    if (linha.tentativas >= 5) {
      await pool.query('UPDATE codigos_recuperacao SET usado = true WHERE id = $1', [linha.id]);
      return res.status(400).json({ erro: 'Muitas tentativas. Peça um novo código.' });
    }

    const codigoOk = await bcrypt.compare(codigo, linha.codigo_hash);
    if (!codigoOk) {
      await pool.query('UPDATE codigos_recuperacao SET tentativas = tentativas + 1 WHERE id = $1', [linha.id]);
      return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    }

    const hash = await bcrypt.hash(novaSenha, 10);
    await pool.query('UPDATE usuarios SET senha = $1 WHERE id = $2', [hash, usuario_id]);
    await pool.query('UPDATE codigos_recuperacao SET usado = true WHERE id = $1', [linha.id]);

    res.json({ mensagem: 'Senha alterada com sucesso!' });
  } catch (err) {
    console.error('Erro confirmarCodigoRecuperacao:', err.message);
    res.status(500).json({ erro: 'Erro interno.' });
  }
};

// ── Cadastro de farmácia de manipulação veterinária ─────────────
// ✅ NOVO: mesma tabela `medicos` de novo. CRF obrigatório (validado
// aqui e depois conferido manualmente pelo admin no site do conselho).
// Escopo deliberadamente limitado — não trata substância de controle
// especial (foge do escopo de solicitação simples que esse app oferece).
exports.registerFarmacia = async (req, res) => {
  // ✅ CORRIGIDO: mesma falha de integridade dos outros cadastros —
  // sem transação, um erro entre os dois INSERTs deixava um usuário
  // sem perfil profissional associado.
  let client;
  try {
    const { nome, email, senha, telefone, endereco, cidade, cep, crf, categorias, tem_entrega, aceitouTermos } = req.body;
    if (!nome || !email || !senha || !crf || !Array.isArray(categorias) || categorias.length === 0)
      return res.status(400).json({ erro: 'Preencha todos os campos, incluindo o CRF, e selecione ao menos uma categoria' });
    if (!aceitouTermos)
      return res.status(400).json({ erro: 'É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.' });

    client = await pool.connect();
    await client.query('BEGIN');

    const existe = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    if (existe.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'E-mail já cadastrado' });
    }

    const hash   = await bcrypt.hash(senha, 10);
    const result = await client.query(
      'INSERT INTO usuarios (nome, email, senha, tipo) VALUES ($1, $2, $3, $4) RETURNING id, nome, email',
      [nome, email, hash, 'medico']
    );

    const usuario = result.rows[0];
    await registrarAceiteTermos(usuario.id, req, client);

    const ROTULOS_CATEGORIA = {
      palatavel: 'Palatáveis (sabor)', dose: 'Dose customizada',
      combinacao: 'Combinação de fármacos', antibiotico: 'Antibióticos',
      antiinflamatorio: 'Anti-inflamatórios', dermatologico: 'Dermatológicos',
      topico: 'Formulações tópicas', suplemento: 'Suplementos/Nutracêuticos',
      hormonal: 'Hormonais (não controlados)',
    };
    const categoriasTexto = categorias.map(c => ROTULOS_CATEGORIA[c] || c).join(', ');

    await client.query(
      `INSERT INTO medicos
        (usuario_id, especialidade, crm, telefone, endereco, cidade, cep, foto_url, bio, valor_consulta, tipo_conta, tem_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [usuario.id, categoriasTexto, crf, telefone || '', endereco || '', cidade || '', cep || '', '', '', '', 'farmacia', !!tem_entrega]
    );

    await client.query('COMMIT');

    // ✅ Não emite token — nasce pendente, precisa de aprovação.
    res.status(201).json({
      pendente: true,
      mensagem: 'Cadastro enviado! Sua conta será analisada e você poderá fazer login assim que for aprovada.',
    });
  } catch (err) {
    if (client) { try { await client.query('ROLLBACK'); } catch {} }
    console.error('Erro registerFarmacia:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  } finally {
    if (client) client.release();
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

    // ✅ CORRIGIDO: comparação direta com !== vaza informação pelo
    // tempo de resposta (string curta falha mais rápido que uma
    // quase certa) — timingSafeEqual sempre leva o mesmo tempo,
    // exigindo strings do mesmo tamanho (por isso o padStart).
    const emailOk = compararSeguro(email, ADMIN_EMAIL);
    const senhaOk = compararSeguro(senha, ADMIN_SENHA);
    if (!emailOk || !senhaOk)
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
    // ✅ O admin precisa ver o CPF de verdade pra conferir a
    // identidade do prestador antes de aprovar — decifra só aqui,
    // na hora de mostrar, nunca fica decifrado em lugar nenhum.
    const linhas = result.rows.map((m) => {
      try {
        return { ...m, cpf: m.cpf ? decifrar(m.cpf) : m.cpf };
      } catch (e) {
        console.error('Falha ao decifrar CPF do usuário', m.id, '— verifique MP_TOKEN_ENCRYPTION_KEY:', e.message);
        return { ...m, cpf: '(erro ao decifrar)' };
      }
    });
    res.json(linhas);
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

// ✅ NOVO: ativa o plano Pro numa conta, sem precisar de pagamento —
// só pra uso do admin durante testes/demonstração, enquanto a
// integração de pagamento real não está pronta. Funciona mesmo se a
// conta nunca abriu Financeiro (nesse caso ainda não existe linha em
// "assinaturas" — INSERT ... ON CONFLICT cobre os dois casos com uma
// query só, sem precisar checar antes).
exports.ativarProTeste = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `INSERT INTO assinaturas (usuario_id, plano, status)
       VALUES ($1, 'pro', 'ativa')
       ON CONFLICT (usuario_id) DO UPDATE SET plano = 'pro', status = 'ativa'`,
      [id]
    );
    res.json({ mensagem: 'Plano Pro liberado (sem cobrança).' });
  } catch (err) {
    console.error('Erro ativarProTeste:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ NOVO: dados pessoais do TUTOR (nome, telefone, cpf, rg,
// endereço, data de nascimento) — antes só existiam no AsyncStorage
// do celular, sem nenhuma tabela no servidor. Direto em "usuarios",
// já que é 1:1 com a conta.
// ═══════════════════════════════════════════════════════════════
exports.buscarDadosPessoais = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query(
      'SELECT nome, email, telefone, cpf, rg, endereco, data_nascimento FROM usuarios WHERE id = $1',
      [usuario_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const dados = result.rows[0];
    try {
      if (dados.cpf) dados.cpf = decifrar(dados.cpf);
      if (dados.rg) dados.rg = decifrar(dados.rg);
    } catch (e) {
      console.error('Falha ao decifrar CPF/RG do usuário', usuario_id, '— verifique MP_TOKEN_ENCRYPTION_KEY:', e.message);
      return res.status(500).json({ erro: 'Erro interno do servidor' });
    }
    res.json(dados);
  } catch (err) {
    console.error('Erro buscarDadosPessoais:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.atualizarDadosPessoais = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nome, telefone, cpf, rg, endereco, data_nascimento } = req.body;
    const result = await pool.query(
      `UPDATE usuarios SET
        nome            = COALESCE($1, nome),
        telefone        = COALESCE($2, telefone),
        cpf             = COALESCE($3, cpf),
        rg              = COALESCE($4, rg),
        endereco        = COALESCE($5, endereco),
        data_nascimento = COALESCE($6, data_nascimento)
       WHERE id = $7
       RETURNING nome, email, telefone, cpf, rg, endereco, data_nascimento`,
      [nome, telefone, cifrar(cpf), cifrar(rg), endereco, data_nascimento, usuario_id]
    );
    const dados = result.rows[0];
    try {
      if (dados.cpf) dados.cpf = decifrar(dados.cpf);
      if (dados.rg) dados.rg = decifrar(dados.rg);
    } catch (e) {
      console.error('Falha ao decifrar CPF/RG após salvar, usuário', usuario_id, ':', e.message);
    }
    res.json(dados);
  } catch (err) {
    console.error('Erro atualizarDadosPessoais:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ✅ NOVO: "compra" (simulada, sem gateway real ainda) do desbloqueio
// de mais slots de pet — antes vivia só no AsyncStorage.
exports.verificarPerfisExtras = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const result = await pool.query('SELECT perfis_extras_desbloqueado FROM usuarios WHERE id = $1', [usuario_id]);
    res.json({ desbloqueado: !!result.rows[0]?.perfis_extras_desbloqueado });
  } catch (err) {
    console.error('Erro verificarPerfisExtras:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.desbloquearPerfisExtras = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    await pool.query('UPDATE usuarios SET perfis_extras_desbloqueado = true WHERE id = $1', [usuario_id]);
    res.json({ mensagem: 'Desbloqueado com sucesso' });
  } catch (err) {
    console.error('Erro desbloquearPerfisExtras:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ✅ NOVO: identidade básica do usuário logado — funciona igual pra
// tutor e profissional (diferente de buscarMeuPerfilProfissional,
// que só existe pra quem tem linha em medicos). Usado, por exemplo,
// pra área de adoção saber se quem está vendo é o dono do anúncio.
exports.meuId = async (req, res) => {
  try {
    res.json({ id: req.usuario.id });
  } catch (err) {
    console.error('Erro meuId:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};