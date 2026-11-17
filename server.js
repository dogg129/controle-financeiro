'use strict';

const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8000);

// Configuração somente por variáveis de ambiente (nenhuma senha no código).
for (const nome of ['DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[nome]) {
    console.error(`Variável de ambiente ${nome} não definida.`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST || 'db', // "db" = nome do serviço no compose (DNS interno do Docker)
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => console.error('Erro no pool de conexões:', err.message));

const TIPOS = ['receita', 'despesa'];
const COLUNAS_TRANSACAO = `id, descricao, valor::float8 AS valor, tipo, categoria,
                           TO_CHAR(data, 'YYYY-MM-DD') AS data, conta_id`;
const COLUNAS_CONTA = `id, descricao, valor::float8 AS valor,
                       TO_CHAR(vencimento, 'YYYY-MM-DD') AS vencimento, pago,
                       TO_CHAR(pago_em, 'YYYY-MM-DD') AS pago_em`;
// Filtro de um mês inteiro; $n recebe 'AAAA-MM-01'.
const NO_MES = (n) => `data >= $${n}::date AND data < ($${n}::date + INTERVAL '1 month')`;

const arredondar = (n) => Math.round(n * 100) / 100;

class ErroRequisicao extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Cabeçalhos de segurança simples.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// Interface (HTML, CSS e JavaScript) servida como arquivos estáticos.
app.use(express.static(path.join(__dirname, 'public')));

const rota = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (err instanceof ErroRequisicao) return res.status(err.status).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor.' });
  });

async function emTransacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

// ---------- Validações ----------
function dataValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function lerDescricao(v) {
  const texto = String(v ?? '').trim();
  if (!texto || texto.length > 120) {
    throw new ErroRequisicao('Descrição obrigatória (máximo de 120 caracteres).');
  }
  return texto;
}

function lerValor(v) {
  if (typeof v !== 'number' && typeof v !== 'string') throw new ErroRequisicao('Valor inválido.');
  const valor = arredondar(Number(v));
  if (!Number.isFinite(valor) || valor <= 0 || valor >= 1e10) {
    throw new ErroRequisicao('O valor deve ser maior que zero.');
  }
  return valor;
}

function lerData(v, nome, obrigatoria) {
  if (v === undefined || v === null || v === '') {
    if (obrigatoria) throw new ErroRequisicao(`Campo obrigatório: ${nome}.`);
    return null;
  }
  const texto = String(v);
  if (!dataValida(texto)) throw new ErroRequisicao(`Campo inválido: ${nome} (use AAAA-MM-DD).`);
  return texto;
}

function lerMes(v, obrigatorio) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw new ErroRequisicao('Informe o mês (AAAA-MM).');
    return null;
  }
  const texto = String(v);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) throw new ErroRequisicao('Mês inválido (use AAAA-MM).');
  return texto;
}

function lerId(v) {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new ErroRequisicao('Identificador inválido.');
  return id;
}

// ---------- Saúde ----------
app.get('/health', rota(async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db_host: process.env.DB_HOST || 'db' });
  } catch (err) {
    res.status(503).json({ status: 'erro' });
  }
}));

// ---------- Receitas e despesas ----------
app.get('/api/transacoes', rota(async (req, res) => {
  const filtros = [];
  const params = [];
  if (req.query.tipo !== undefined) {
    if (!TIPOS.includes(req.query.tipo)) throw new ErroRequisicao("O tipo deve ser 'receita' ou 'despesa'.");
    params.push(req.query.tipo);
    filtros.push(`tipo = $${params.length}`);
  }
  const mes = lerMes(req.query.mes, false);
  if (mes) {
    params.push(`${mes}-01`);
    filtros.push(NO_MES(params.length));
  }
  const onde = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_TRANSACAO} FROM transacoes ${onde} ORDER BY transacoes.data DESC, id DESC`,
    params
  );
  res.json(rows);
}));

app.post('/api/transacoes', rota(async (req, res) => {
  const dados = req.body || {};
  const tipo = String(dados.tipo ?? '').trim().toLowerCase();
  if (!TIPOS.includes(tipo)) throw new ErroRequisicao("O tipo deve ser 'receita' ou 'despesa'.");
  const descricao = lerDescricao(dados.descricao);
  const valor = lerValor(dados.valor);
  const data = lerData(dados.data, 'Data', false);
  const categoria = String(dados.categoria ?? '').trim() || 'Outros';
  if (categoria.length > 40) throw new ErroRequisicao('Categoria muito longa (máximo de 40 caracteres).');

  const { rows } = await pool.query(
    `INSERT INTO transacoes (descricao, valor, tipo, categoria, data)
     VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
     RETURNING ${COLUNAS_TRANSACAO}`,
    [descricao, valor, tipo, categoria, data]
  );
  res.status(201).json(rows[0]);
}));

app.delete('/api/transacoes/:id', rota(async (req, res) => {
  const id = lerId(req.params.id);
  await emTransacao(async (c) => {
    const apagada = await c.query('DELETE FROM transacoes WHERE id = $1 RETURNING conta_id', [id]);
    if (apagada.rowCount === 0) throw new ErroRequisicao('Transação não encontrada.', 404);
    // Se a despesa veio do pagamento de uma conta, a conta volta a ficar pendente.
    if (apagada.rows[0].conta_id) {
      await c.query('UPDATE contas SET pago = FALSE, pago_em = NULL WHERE id = $1', [apagada.rows[0].conta_id]);
    }
  });
  res.status(204).end();
}));

// ---------- Painel ----------
app.get('/api/resumo', rota(async (req, res) => {
  const totais = await pool.query(
    `SELECT
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'receita'), 0)::float8 AS receitas,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'despesa'), 0)::float8 AS despesas
     FROM transacoes`
  );
  const pendentes = await pool.query(
    `SELECT COUNT(*)::int AS quantidade, COALESCE(SUM(valor), 0)::float8 AS total
     FROM contas WHERE NOT pago`
  );
  const { receitas, despesas } = totais.rows[0];
  res.json({
    receitas,
    despesas,
    saldo: arredondar(receitas - despesas),
    pendentes: pendentes.rows[0],
  });
}));

// ---------- Contas a pagar ----------
app.get('/api/contas', rota(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUNAS_CONTA} FROM contas ORDER BY pago ASC, contas.vencimento ASC, id ASC`
  );
  res.json(rows);
}));

app.post('/api/contas', rota(async (req, res) => {
  const dados = req.body || {};
  const descricao = lerDescricao(dados.descricao);
  const valor = lerValor(dados.valor);
  const vencimento = lerData(dados.vencimento, 'Vencimento', true);

  const { rows } = await pool.query(
    `INSERT INTO contas (descricao, valor, vencimento) VALUES ($1, $2, $3::date)
     RETURNING ${COLUNAS_CONTA}`,
    [descricao, valor, vencimento]
  );
  res.status(201).json(rows[0]);
}));

// Marca a conta como paga ou pendente.
// Ao pagar, o valor entra nas despesas; ao voltar para pendente, essa despesa é removida.
app.patch('/api/contas/:id', rota(async (req, res) => {
  const id = lerId(req.params.id);
  const pago = (req.body || {}).pago;
  if (typeof pago !== 'boolean') throw new ErroRequisicao("Informe 'pago' como verdadeiro ou falso.");
  const pagoEm = lerData((req.body || {}).pago_em, 'Data de pagamento', false);

  const conta = await emTransacao(async (c) => {
    const { rows } = await c.query('SELECT * FROM contas WHERE id = $1 FOR UPDATE', [id]);
    if (rows.length === 0) throw new ErroRequisicao('Conta não encontrada.', 404);
    const atual = rows[0];

    if (pago && !atual.pago) {
      await c.query(
        'UPDATE contas SET pago = TRUE, pago_em = COALESCE($2::date, CURRENT_DATE) WHERE id = $1',
        [id, pagoEm]
      );
      await c.query(
        `INSERT INTO transacoes (descricao, valor, tipo, categoria, data, conta_id)
         VALUES ($1, $2, 'despesa', 'Contas', COALESCE($3::date, CURRENT_DATE), $4)`,
        [atual.descricao, atual.valor, pagoEm, id]
      );
    } else if (!pago && atual.pago) {
      await c.query('UPDATE contas SET pago = FALSE, pago_em = NULL WHERE id = $1', [id]);
      await c.query('DELETE FROM transacoes WHERE conta_id = $1', [id]);
    }

    const nova = await c.query(`SELECT ${COLUNAS_CONTA} FROM contas WHERE id = $1`, [id]);
    return nova.rows[0];
  });
  res.json(conta);
}));

app.delete('/api/contas/:id', rota(async (req, res) => {
  const id = lerId(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM contas WHERE id = $1', [id]);
  if (rowCount === 0) throw new ErroRequisicao('Conta não encontrada.', 404);
  res.status(204).end();
}));

// ---------- Relatório mensal ----------
app.get('/api/relatorio', rota(async (req, res) => {
  const mes = lerMes(req.query.mes, true);
  const inicio = `${mes}-01`;

  const totais = await pool.query(
    `SELECT
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'receita'), 0)::float8 AS recebido,
       COALESCE(SUM(valor) FILTER (WHERE tipo = 'despesa'), 0)::float8 AS gasto
     FROM transacoes WHERE ${NO_MES(1)}`,
    [inicio]
  );
  const categorias = await pool.query(
    `SELECT categoria, SUM(valor)::float8 AS total
     FROM transacoes WHERE tipo = 'despesa' AND ${NO_MES(1)}
     GROUP BY categoria ORDER BY total DESC, categoria`,
    [inicio]
  );
  const { recebido, gasto } = totais.rows[0];
  res.json({
    mes,
    recebido,
    gasto,
    sobrou: arredondar(recebido - gasto),
    categorias: categorias.rows,
  });
}));

app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Erros de leitura do corpo (JSON malformado, corpo grande demais).
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ erro: 'Requisição inválida.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

async function iniciarBanco(tentativas = 15, esperaMs = 2000) {
  for (let n = 1; n <= tentativas; n++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contas (
          id         SERIAL PRIMARY KEY,
          descricao  VARCHAR(120) NOT NULL,
          valor      NUMERIC(12,2) NOT NULL CHECK (valor > 0),
          vencimento DATE NOT NULL,
          pago       BOOLEAN NOT NULL DEFAULT FALSE,
          pago_em    DATE,
          criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS transacoes (
          id         SERIAL PRIMARY KEY,
          descricao  VARCHAR(120) NOT NULL,
          valor      NUMERIC(12,2) NOT NULL CHECK (valor > 0),
          tipo       VARCHAR(7) NOT NULL CHECK (tipo IN ('receita', 'despesa')),
          categoria  VARCHAR(40) NOT NULL DEFAULT 'Outros',
          data       DATE NOT NULL DEFAULT CURRENT_DATE,
          criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
        );
        ALTER TABLE transacoes
          ADD COLUMN IF NOT EXISTS conta_id INTEGER REFERENCES contas(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_transacoes_data ON transacoes (data);
      `);
      console.log('Banco de dados pronto.');
      return;
    } catch (err) {
      console.log(`Aguardando o banco (${n}/${tentativas}): ${err.message}`);
      await new Promise((resolver) => setTimeout(resolver, esperaMs));
    }
  }
  throw new Error('Não foi possível conectar ao banco de dados.');
}

let servidor;

function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  setTimeout(() => process.exit(1), 10000).unref();
  const fecharBanco = () => pool.end().finally(() => process.exit(0));
  if (servidor) servidor.close(fecharBanco);
  else fecharBanco();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

iniciarBanco()
  .then(() => {
    servidor = app.listen(PORT, '0.0.0.0', () => console.log(`Servidor na porta ${PORT}.`));
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
