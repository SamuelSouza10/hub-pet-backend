const pool = require('../database');

// ═══════════════════════════════════════════════════════════════
// H.U.B. Pet — Cruzamento: "deu match" entre pets pra reprodução.
// Reaproveita perfis_pet (raça/espécie/foto já existem lá) e
// prontuario_pet (pra checar vacina em dia).
// ═══════════════════════════════════════════════════════════════

const IDADE_MINIMA_MESES = 12;

// ── Criar/ativar perfil de cruzamento pro meu pet ────────────────
exports.criarPerfilCruzamento = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_pet_id, sexo, idade_meses, descricao, cidade } = req.body;

    if (!['macho', 'femea'].includes(sexo))
      return res.status(400).json({ erro: 'Sexo inválido' });
    if (!idade_meses || idade_meses < IDADE_MINIMA_MESES)
      return res.status(400).json({ erro: `O pet precisa ter pelo menos ${IDADE_MINIMA_MESES} meses pra entrar na área de cruzamento.` });

    // ✅ Confere que o pet é do tutor logado
    const pet = await pool.query('SELECT id FROM perfis_pet WHERE id = $1 AND tutor_id = $2', [perfil_pet_id, tutor_id]);
    if (pet.rows.length === 0) return res.status(403).json({ erro: 'Esse pet não pertence a você' });

    // ✅ Checagem de responsabilidade: pelo menos 1 vacina registrada
    // como tomada no prontuário — não garante saúde perfeita, mas
    // evita que pets sem nenhum cuidado básico apareçam nos matches.
    const prontuario = await pool.query('SELECT vacinas FROM prontuario_pet WHERE perfil_id = $1', [perfil_pet_id]);
    const vacinas = prontuario.rows[0]?.vacinas || {};
    const temVacina = Object.values(vacinas).some((v) => v && v.tomou === true);
    if (!temVacina)
      return res.status(400).json({ erro: 'Registre pelo menos uma vacina no prontuário do pet antes de ativar o cruzamento.' });

    const result = await pool.query(
      `INSERT INTO perfis_cruzamento (perfil_pet_id, tutor_id, sexo, idade_meses, descricao, cidade)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (perfil_pet_id) DO UPDATE SET
         sexo = $3, idade_meses = $4, descricao = $5, cidade = $6, ativo = true
       RETURNING *`,
      [perfil_pet_id, tutor_id, sexo, idade_meses, descricao || '', cidade || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro criarPerfilCruzamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Descobrir candidatos (fila de swipe) ──────────────────────────
exports.descobrir = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { meu_perfil_cruzamento_id, mesma_raca } = req.query;
    if (!meu_perfil_cruzamento_id) return res.status(400).json({ erro: 'Informe seu perfil de cruzamento' });

    const meuPerfil = await pool.query(
      'SELECT pc.*, p.especie, p.raca FROM perfis_cruzamento pc JOIN perfis_pet p ON p.id = pc.perfil_pet_id WHERE pc.id = $1 AND pc.tutor_id = $2',
      [meu_perfil_cruzamento_id, tutor_id]
    );
    if (meuPerfil.rows.length === 0) return res.status(403).json({ erro: 'Perfil de cruzamento não encontrado' });
    const meu = meuPerfil.rows[0];
    const sexoOposto = meu.sexo === 'macho' ? 'femea' : 'macho';

    // ✅ NOVO: filtro opcional "só da mesma raça". Vale pra qualquer espécie
    // (não é exclusivo de cachorro) — só compara dentro do grupo que já é
    // da mesma espécie. SRD conta como uma raça igual às outras (SRD só
    // aparece pra quem também está como SRD), comparando sem diferenciar
    // maiúsculas/minúsculas nem espaços nas pontas. Se o MEU pet não tem
    // raça preenchida, não dá pra filtrar por algo que não existe — nesse
    // caso o filtro é ignorado e a busca volta a ser só por espécie/sexo.
    const filtrarPorRaca = mesma_raca === 'true' && !!(meu.raca && meu.raca.trim());
    const params = [meu.id, sexoOposto, meu.especie];
    let clausulaRaca = '';
    if (filtrarPorRaca) {
      params.push(meu.raca.trim());
      clausulaRaca = `AND lower(trim(p.raca)) = lower(trim($${params.length}))`;
    }

    // Mesma espécie, sexo oposto, ativo, e que eu ainda não curti/passei
    const result = await pool.query(
      `SELECT pc.id, pc.sexo, pc.idade_meses, pc.descricao, pc.cidade,
              p.nome, p.especie, p.raca, p.avatar
       FROM perfis_cruzamento pc
       JOIN perfis_pet p ON p.id = pc.perfil_pet_id
       WHERE pc.ativo = true
         AND pc.id != $1
         AND pc.sexo = $2
         AND p.especie = $3
         ${clausulaRaca}
         AND pc.id NOT IN (
           SELECT perfil_destino_id FROM curtidas_cruzamento WHERE perfil_origem_id = $1
         )
       ORDER BY pc.criado_em DESC
       LIMIT 20`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro descobrir:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Curtir um candidato (verifica match) ──────────────────────────
exports.curtir = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { perfil_origem_id, perfil_destino_id } = req.body;

    const origem = await pool.query('SELECT id FROM perfis_cruzamento WHERE id = $1 AND tutor_id = $2', [perfil_origem_id, tutor_id]);
    if (origem.rows.length === 0) return res.status(403).json({ erro: 'Esse perfil não pertence a você' });

    await pool.query(
      'INSERT INTO curtidas_cruzamento (perfil_origem_id, perfil_destino_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [perfil_origem_id, perfil_destino_id]
    );

    // Verifica se o outro lado já tinha curtido de volta = match
    const reciproca = await pool.query(
      'SELECT id FROM curtidas_cruzamento WHERE perfil_origem_id = $1 AND perfil_destino_id = $2',
      [perfil_destino_id, perfil_origem_id]
    );
    const deuMatch = reciproca.rows.length > 0;

    res.json({ match: deuMatch });
  } catch (err) {
    console.error('Erro curtir:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Listar meus matches (com contato do outro tutor) ──────────────
exports.listarMatches = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const result = await pool.query(
      `SELECT DISTINCT
        pc2.id AS perfil_cruzamento_id,
        p2.nome, p2.especie, p2.raca, p2.avatar,
        pc2.sexo, pc2.idade_meses, pc2.cidade,
        u2.nome AS tutor_nome, u2.telefone AS tutor_telefone
       FROM curtidas_cruzamento c1
       JOIN curtidas_cruzamento c2 ON c2.perfil_origem_id = c1.perfil_destino_id AND c2.perfil_destino_id = c1.perfil_origem_id
       JOIN perfis_cruzamento pc1 ON pc1.id = c1.perfil_origem_id
       JOIN perfis_cruzamento pc2 ON pc2.id = c1.perfil_destino_id
       JOIN perfis_pet p2 ON p2.id = pc2.perfil_pet_id
       JOIN usuarios u2 ON u2.id = pc2.tutor_id
       WHERE pc1.tutor_id = $1`,
      [tutor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro listarMatches:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

// ── Meus perfis de cruzamento (pra tela de gerenciar) ─────────────
exports.meusPerfisCruzamento = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const result = await pool.query(
      `SELECT pc.*, p.nome, p.especie, p.raca, p.avatar
       FROM perfis_cruzamento pc JOIN perfis_pet p ON p.id = pc.perfil_pet_id
       WHERE pc.tutor_id = $1 ORDER BY pc.criado_em DESC`,
      [tutor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro meusPerfisCruzamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};

exports.desativarPerfilCruzamento = async (req, res) => {
  try {
    const tutor_id = req.usuario.id;
    const { id } = req.params;
    await pool.query('UPDATE perfis_cruzamento SET ativo = false WHERE id = $1 AND tutor_id = $2', [id, tutor_id]);
    res.json({ mensagem: 'Desativado' });
  } catch (err) {
    console.error('Erro desativarPerfilCruzamento:', err.message);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
};