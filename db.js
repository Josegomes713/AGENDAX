'use strict';
// Banco de dados real (SQLite embutido no Node 22). Todas as tabelas de negócio
// têm estabelecimento_id: cada estabelecimento só enxerga os próprios dados.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'agendax.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS estabelecimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  telefone TEXT DEFAULT '',
  endereco TEXT DEFAULT '',
  descricao TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  fuso TEXT NOT NULL DEFAULT 'America/Fortaleza',
  intervalo_slots INTEGER NOT NULL DEFAULT 30,
  plano TEXT NOT NULL DEFAULT 'profissional',
  assinatura_status TEXT NOT NULL DEFAULT 'trial',
  trial_ate TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profissionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT DEFAULT '',
  foto TEXT DEFAULT '',
  cor TEXT NOT NULL DEFAULT '#7c3aed',
  comissao_percent REAL NOT NULL DEFAULT 0,
  horarios TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  preco REAL NOT NULL DEFAULT 0,
  duracao_min INTEGER NOT NULL DEFAULT 30,
  foto TEXT DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS profissional_servicos (
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  PRIMARY KEY (profissional_id, servico_id)
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  observacoes TEXT DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  servico_id INTEGER NOT NULL REFERENCES servicos(id),
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado',
  preco REAL NOT NULL DEFAULT 0,
  comissao_percent REAL,
  comissao_valor REAL,
  origem TEXT NOT NULL DEFAULT 'interno',
  observacoes TEXT DEFAULT '',
  lembrete_enviado INTEGER NOT NULL DEFAULT 0,
  codigo TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ag_codigo ON agendamentos(codigo);
CREATE INDEX IF NOT EXISTS idx_ag_estab_inicio ON agendamentos(estabelecimento_id, inicio);
CREATE INDEX IF NOT EXISTS idx_ag_prof_inicio ON agendamentos(profissional_id, inicio);

CREATE TABLE IF NOT EXISTS lancamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita','despesa')),
  descricao TEXT NOT NULL,
  categoria TEXT DEFAULT '',
  valor REAL NOT NULL,
  data TEXT NOT NULL,
  agendamento_id INTEGER REFERENCES agendamentos(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lanc_estab_data ON lancamentos(estabelecimento_id, data);

CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'info',
  titulo TEXT NOT NULL,
  mensagem TEXT DEFAULT '',
  lida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT DEFAULT '',
  preco REAL NOT NULL DEFAULT 0,
  foto TEXT DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS agendamento_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
  produto_id INTEGER,
  nome TEXT NOT NULL,
  preco REAL NOT NULL DEFAULT 0,
  qtd INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_agprod_ag ON agendamento_produtos(agendamento_id);

CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_estab ON notificacoes(estabelecimento_id, lida, id);
`);

// Migrações leves (colunas novas em bancos já existentes)
function colunaExiste(tabela, col) { return db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === col); }
if (!colunaExiste('estabelecimentos', 'ip_hash')) db.exec('ALTER TABLE estabelecimentos ADD COLUMN ip_hash TEXT');
if (!colunaExiste('estabelecimentos', 'aparencia')) db.exec("ALTER TABLE estabelecimentos ADD COLUMN aparencia TEXT NOT NULL DEFAULT ''");
if (!colunaExiste('estabelecimentos', 'suspenso')) db.exec('ALTER TABLE estabelecimentos ADD COLUMN suspenso INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL DEFAULT (datetime('now')),
  admin_email TEXT NOT NULL,
  estabelecimento_id INTEGER,
  acao TEXT NOT NULL,
  detalhe TEXT DEFAULT ''
)`);
if (!colunaExiste('estabelecimentos', 'assinatura_ate')) db.exec('ALTER TABLE estabelecimentos ADD COLUMN assinatura_ate TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estabelecimento_id INTEGER NOT NULL REFERENCES estabelecimentos(id) ON DELETE CASCADE,
  plano TEXT NOT NULL,
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  provedor TEXT NOT NULL DEFAULT 'mercadopago',
  provedor_id TEXT UNIQUE,
  referencia TEXT NOT NULL UNIQUE,
  qr_code TEXT DEFAULT '',
  qr_base64 TEXT DEFAULT '',
  expira_em TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  pago_em TEXT,
  validade_ate TEXT,
  verificado_em INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pag_est ON pagamentos(estabelecimento_id, id);
CREATE TABLE IF NOT EXISTS webhook_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recebido_em TEXT NOT NULL DEFAULT (datetime('now')),
  chave TEXT UNIQUE,
  provedor_id TEXT,
  resultado TEXT
);`);
if (!colunaExiste('usuarios', 'recup_hash')) db.exec('ALTER TABLE usuarios ADD COLUMN recup_hash TEXT');

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx, DATA_DIR };
