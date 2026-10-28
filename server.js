'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tx, DATA_DIR } = require('./db');
const L = require('./lib');
const PUSH = require('./push');
const { erro, texto, numero, PLANOS } = L;

const PORT = parseInt(process.env.PORT || '3000', 10);
const PROD = process.env.NODE_ENV === 'production';
const CONFIAR_PROXY = process.env.TRUST_PROXY === '1';
// E-mails de donos da plataforma (separados por vírgula): acesso total, Premium ativo, sem expirar.
const DONOS = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const adminSalvo = () => { const r = db.prepare("SELECT valor FROM config WHERE chave = 'admin_email'").get(); return r ? r.valor : ''; };
// Dono = e-mail em ADMIN_EMAILS ou o e-mail que reivindicou o acesso de administrador no primeiro uso (depois disso fica trancado).
const ehDono = (email) => { const e = String(email || '').toLowerCase(); return !!e && (DONOS.includes(e) || adminSalvo() === e); };
function iguais(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
if (PROD && !DONOS.length) console.warn('Sem ADMIN_EMAILS: o primeiro acesso pelo link Administrador define o dono. Faça isso logo após publicar.');
function garantirAcessoTotal(estId) {
  db.prepare("UPDATE estabelecimentos SET plano = 'premium', assinatura_status = 'ativa', assinatura_ate = NULL WHERE id = ?").run(estId);
}
// Pagamento Pix por provedor externo (ver pagamentos.js). Sem credenciais no servidor, a cobrança fica desligada: nunca há ativação simulada.
const PAG = require('./pagamentos');
const SESSAO_MS = 14 * 86400000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const R = new L.Roteador();
const get = (p, o, f) => R.add('GET', p, o, f);
const post = (p, o, f) => R.add('POST', p, o, f);
const put = (p, o, f) => R.add('PUT', p, o, f);
const del = (p, o, f) => R.add('DELETE', p, o, f);

// ======================= Utilidades de domínio =======================
const HORARIOS_PADRAO = () => {
  const h = {};
  for (let d = 0; d < 7; d++) h[d] = { ativo: d >= 1 && d <= 6, inicio: '09:00', fim: d === 6 ? '13:00' : '18:00' };
  return h;
};
function validarHorarios(h) {
  if (!h || typeof h !== 'object') throw erro(400, 'Horários de trabalho inválidos.');
  const out = {};
  for (let d = 0; d < 7; d++) {
    const x = h[d] || h[String(d)];
    if (!x) throw erro(400, 'Horários de trabalho incompletos.');
    const ativo = !!x.ativo;
    if (!L.horaValida(x.inicio) || !L.horaValida(x.fim)) throw erro(400, 'Horário inválido (use HH:MM).');
    if (ativo && L.toMin(x.inicio) >= L.toMin(x.fim)) throw erro(400, 'O horário de início deve ser antes do fim.');
    out[d] = { ativo, inicio: x.inicio, fim: x.fim };
  }
  return out;
}
// Limites de uso por plano (Grátis e Básico têm tetos; Profissional e Premium são ilimitados nesses itens).
const tem = (est, recurso) => L.planoEfetivo(est).recursos.includes(recurso);
function exigir(est, recurso, msg) {
  if (!tem(est, recurso)) throw erro(403, msg || 'Este recurso não está disponível no seu plano. Faça upgrade para usar.', { upgrade: true, recurso });
}
function checarLimite(est, tipo) {
  const pl = L.planoEfetivo(est);
  const regras = {
    servicos: ['max_servicos', 'SELECT COUNT(*) n FROM servicos WHERE estabelecimento_id = ? AND ativo = 1', 'serviço(s) ativo(s)'],
    clientes: ['max_clientes', 'SELECT COUNT(*) n FROM clientes WHERE estabelecimento_id = ?', 'cliente(s)'],
  }[tipo];
  const max = pl[regras[0]];
  if (max == null) return;
  if (db.prepare(regras[1]).get(est.id).n >= max) throw erro(403, `O plano ${pl.nome} permite até ${max} ${regras[2]}. Faça upgrade para adicionar mais.`, { upgrade: true });
}
function checarLimiteAgendamentos(est, data) {
  const pl = L.planoEfetivo(est), max = pl.max_agendamentos_mes;
  if (max == null) return;
  const n = db.prepare("SELECT COUNT(*) n FROM agendamentos WHERE estabelecimento_id = ? AND status != 'cancelado' AND substr(inicio,1,7) = ?").get(est.id, String(data).slice(0, 7)).n;
  if (n >= max) throw erro(403, `O plano ${pl.nome} permite até ${max} agendamentos por mês. Faça upgrade para continuar agendando.`, { upgrade: true });
}
const dono = (tabela, id, estabId) => {
  const n = parseInt(id, 10);
  const r = Number.isInteger(n) ? db.prepare(`SELECT * FROM ${tabela} WHERE id = ? AND estabelecimento_id = ?`).get(n, estabId) : null;
  if (!r) throw erro(404, 'Registro não encontrado.');
  return r;
};
const arred = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Tempo real: conexões abertas (SSE) por estabelecimento + push para celulares inscritos.
const VAPID = PUSH.carregarChaves(DATA_DIR);
const ouvintes = new Map();
const CONTATO_PUSH = process.env.VAPID_CONTACT || (DONOS[0] ? 'mailto:' + DONOS[0] : undefined);
function notificar(estabId, tipo, titulo, mensagem) {
  const r = db.prepare('INSERT INTO notificacoes (estabelecimento_id, tipo, titulo, mensagem) VALUES (?,?,?,?)').run(estabId, tipo, titulo, mensagem || '');
  const n = { id: Number(r.lastInsertRowid), tipo, titulo, mensagem: mensagem || '' };
  setImmediate(() => publicar(estabId, n));
}
async function publicar(estabId, n) {
  for (const res of ouvintes.get(estabId) || []) { try { res.write(`data: ${JSON.stringify(n)}\n\n`); } catch (_) { /* conexão caiu */ } }
  let subs = [];
  try { subs = db.prepare('SELECT * FROM push_subs WHERE estabelecimento_id = ?').all(estabId); } catch (_) { return; }
  await Promise.all(subs.map(async (s) => {
    const r = await PUSH.enviar(VAPID, s, { id: n.id, tipo: n.tipo, titulo: n.titulo, mensagem: n.mensagem, url: '/app#/agenda' }, CONTATO_PUSH);
    if (r.status === 404 || r.status === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
  }));
}
const fmtData = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
function limitesMes(hoje) {
  const [y, m] = hoje.split('-').map(Number);
  const ult = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ini: `${hoje.slice(0, 8)}01`, fim: `${hoje.slice(0, 8)}${String(ult).padStart(2, '0')}` };
}
function intervalo(q, est, diasPadrao) {
  const hoje = L.hojeLocal(est.fuso);
  let ate = q.ate || hoje;
  let de = q.de || L.addDias(ate, -(diasPadrao - 1));
  if (!L.dataValida(de) || !L.dataValida(ate)) throw erro(400, 'Período inválido.');
  if (de > ate) [de, ate] = [ate, de];
  if ((new Date(ate) - new Date(de)) / 86400000 > 366) throw erro(400, 'Período máximo de 1 ano.');
  return { de, ate };
}

function conflito(estabId, profId, inicio, fim, ignorarId) {
  return db.prepare(`SELECT a.id, a.inicio, a.fim, c.nome AS cliente FROM agendamentos a
    JOIN clientes c ON c.id = a.cliente_id
    WHERE a.estabelecimento_id = ? AND a.profissional_id = ? AND a.status IN ('agendado','concluido')
      AND a.inicio < ? AND a.fim > ? AND a.id != ? LIMIT 1`).get(estabId, profId, fim, inicio, ignorarId || 0);
}
function slotsLivres(est, prof, duracao, data, permitirPassado) {
  const h = JSON.parse(prof.horarios)[L.diaSemana(data)];
  if (!h || !h.ativo) return [];
  const ini = L.toMin(h.inicio), fim = L.toMin(h.fim), passo = est.intervalo_slots || 30;
  const agora = L.agoraLocal(est.fuso);
  const ocupados = db.prepare(`SELECT inicio, fim FROM agendamentos WHERE profissional_id = ? AND status IN ('agendado','concluido')
    AND inicio < ? AND fim > ?`).all(prof.id, L.addDias(data, 1) + ' 00:00', data + ' 00:00');
  const out = [];
  for (let t = ini; t + duracao <= fim; t += passo) {
    const si = `${data} ${L.hm(t)}`;
    const sf = L.addMin(data, L.hm(t), duracao);
    if (!permitirPassado && si <= agora) continue;
    if (ocupados.some((o) => o.inicio < sf && o.fim > si)) continue;
    out.push(L.hm(t));
  }
  return out;
}
const profServicos = (profId) => db.prepare('SELECT servico_id FROM profissional_servicos WHERE profissional_id = ?').all(profId).map((r) => r.servico_id);
function profissionaisDoServico(estabId, servicoId) {
  return db.prepare(`SELECT p.* FROM profissionais p JOIN profissional_servicos ps ON ps.profissional_id = p.id
    WHERE p.estabelecimento_id = ? AND p.ativo = 1 AND ps.servico_id = ? ORDER BY p.nome`).all(estabId, servicoId);
}
function serializarProf(p) {
  return { id: p.id, nome: p.nome, telefone: p.telefone, foto: p.foto, cor: p.cor, comissao_percent: p.comissao_percent,
    horarios: JSON.parse(p.horarios), ativo: !!p.ativo, servicos: profServicos(p.id) };
}
function serializarServico(s) {
  const profs = db.prepare('SELECT profissional_id FROM profissional_servicos WHERE servico_id = ?').all(s.id).map((r) => r.profissional_id);
  return { id: s.id, nome: s.nome, descricao: s.descricao, preco: s.preco, duracao_min: s.duracao_min, foto: s.foto, ativo: !!s.ativo, profissionais: profs };
}
const AG_SELECT = `SELECT a.id, a.inicio, a.fim, a.status, a.preco, a.origem, a.observacoes, a.comissao_valor,
    a.cliente_id, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
    a.profissional_id, p.nome AS profissional_nome, p.cor AS profissional_cor,
    a.servico_id, s.nome AS servico_nome, s.duracao_min
  FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
  JOIN profissionais p ON p.id = a.profissional_id JOIN servicos s ON s.id = a.servico_id`;

get('/api/planos', { publico: true }, () => ({ planos: Object.values(PLANOS), trial_dias: L.TRIAL_DIAS }));

// ======================= Autenticação =======================
function ipDe(req) {
  if (CONFIAR_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'ip';
}
function cookieSessao(token, maxAgeSeg) {
  return `ax_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${PROD ? '; Secure' : ''}`;
}
// manter = true: sessão de 14 dias (cookie persistente). manter = false: cookie de sessão (some ao fechar o navegador) e validade máxima de 1 dia no servidor.
function criarSessao(usuarioId, manter = true) {
  const token = L.novoToken();
  const dur = manter ? SESSAO_MS : 86400000;
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?,?,?)').run(L.sha256(token), usuarioId, Date.now() + dur);
  return manter ? cookieSessao(token, SESSAO_MS / 1000) : `ax_session=${token}; HttpOnly; SameSite=Lax; Path=/${PROD ? '; Secure' : ''}`;
}
const quer = (v) => v === undefined || v === null ? true : !(v === false || v === 'false' || v === 0 || v === '0');
function carregarSessao(req) {
  const token = L.parseCookies(req.headers.cookie).ax_session;
  if (!token) return null;
  const s = db.prepare(`SELECT u.id AS uid, u.nome AS unome, u.email, u.estabelecimento_id, s.expira_em
    FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?`).get(L.sha256(token));
  if (!s) return null;
  if (s.expira_em < Date.now()) { db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(L.sha256(token)); return null; }
  const est = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(s.estabelecimento_id);
  if (est && est.suspenso) return null;
  return { user: { id: s.uid, nome: s.unome, email: s.email }, est };
}
const SENHA_FALSA = L.hashSenha('senha-falsa-para-tempo-constante');

// Código de recuperação de senha (mostrado uma única vez; guardamos só o hash). Serve até haver envio de e-mail.
function novoCodigoRecuperacao(usuarioId) {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  const cod = Array.from(bytes, (b) => alfa[b % 32]).join('').replace(/(.{4})(?=.)/g, '$1-');
  db.prepare('UPDATE usuarios SET recup_hash = ? WHERE id = ?').run(L.sha256('rec|' + cod.replace(/-/g, '')), usuarioId);
  return cod;
}
post('/api/auth/recuperar', { publico: true }, (c) => {
  const email = String(c.body.email || '').trim().toLowerCase();
  const cod = String(c.body.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!L.limite('rec-ip:' + ipDe(c.req), 15, 900000) || !L.limite('rec-em:' + email, 5, 900000)) throw erro(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const nova = String(c.body.nova || '');
  if (nova.length < 8 || nova.length > 100) throw erro(400, 'A nova senha deve ter entre 8 e 100 caracteres.');
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  const ok = u && u.recup_hash && iguais(L.sha256('rec|' + cod), u.recup_hash);
  if (!ok) throw erro(400, 'E-mail ou código de recuperação incorretos.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(L.hashSenha(nova), u.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id);
  return { ok: true, codigo_recuperacao: novoCodigoRecuperacao(u.id) };
});
put('/api/me/recuperacao', { semBloqueio: true }, (c) => {
  if (!L.limite('rec-novo:' + c.user.id, 5, 900000)) throw erro(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.user.id);
  if (!L.verificarSenha(String(c.body.senha || ''), u.senha_hash)) throw erro(400, 'Senha incorreta.');
  return { codigo_recuperacao: novoCodigoRecuperacao(u.id) };
});
post('/api/auth/register', { publico: true }, (c) => {
  if (!L.limite('reg:' + ipDe(c.req), parseInt(process.env.MAX_CADASTROS_HORA || '10', 10), 3600000)) throw erro(429, 'Muitas tentativas. Tente novamente mais tarde.');
  const b = c.body;
  const nomeEst = texto(b.nome_estabelecimento, 80, true, 'Nome do estabelecimento');
  const nome = texto(b.nome, 80, true, 'Seu nome');
  const email = texto(b.email, 160, true, 'E-mail').toLowerCase();
  const senha = String(b.senha || '');
  if (!L.emailValido(email)) throw erro(400, 'E-mail inválido.');
  if (senha.length < 8 || senha.length > 100) throw erro(400, 'A senha deve ter entre 8 e 100 caracteres.');
  if (ehDono(email)) throw erro(403, 'Este e-mail é reservado ao administrador. Use o link "Administrador" na tela inicial.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw erro(409, 'Este e-mail já está cadastrado. Entre na sua conta ou use "Esqueci minha senha".', { existe: true });
  const ipH = L.sha256('agendax|' + ipDe(c.req));
  const maxTestes = parseInt(process.env.MAX_TESTES_POR_IP || '3', 10);
  if (!ehDono(email) && db.prepare("SELECT COUNT(*) n FROM estabelecimentos WHERE ip_hash = ? AND criado_em > datetime('now','-1 day')").get(ipH).n >= maxTestes) {
    throw erro(429, 'Muitas contas novas criadas neste local hoje. Tente novamente amanhã ou fale com o suporte.');
  }
  const plano = PLANOS[b.plano] ? b.plano : 'profissional';
  let cookie, codigoRec;
  try { tx(() => {
    let slug = L.slugify(nomeEst), n = 1;
    while (db.prepare('SELECT 1 FROM estabelecimentos WHERE slug = ?').get(slug)) slug = L.slugify(nomeEst).slice(0, 36) + '-' + (++n);
    const trial = L.addDias(L.hojeLocal('America/Fortaleza'), L.TRIAL_DIAS);
    const e = db.prepare('INSERT INTO estabelecimentos (nome, slug, plano, assinatura_status, trial_ate, ip_hash) VALUES (?,?,?,?,?,?)').run(nomeEst, slug, plano, 'trial', trial, ipH);
    const eid = e.lastInsertRowid;
    const u = db.prepare('INSERT INTO usuarios (estabelecimento_id, nome, email, senha_hash) VALUES (?,?,?,?)').run(eid, nome, email, L.hashSenha(senha));
    db.prepare('INSERT INTO profissionais (estabelecimento_id, nome, horarios) VALUES (?,?,?)').run(eid, nome, JSON.stringify(HORARIOS_PADRAO()));
    notificar(eid, 'info', 'Bem-vindo ao AGENDA X! 🎉', `Seu teste grátis de ${L.TRIAL_DIAS} dias começou. Cadastre seus serviços e compartilhe sua página de agendamento.`);
    codigoRec = novoCodigoRecuperacao(u.lastInsertRowid);
    cookie = criarSessao(u.lastInsertRowid, quer(b.manter));
  }); } catch (err) {
    if (/UNIQUE constraint failed: usuarios\.email/.test(String(err && err.message))) throw erro(409, 'Este e-mail já está cadastrado. Entre na sua conta ou use "Esqueci minha senha".', { existe: true });
    throw err;
  }
  c.headers['Set-Cookie'] = cookie; c.status = 201;
  return { ok: true, codigo_recuperacao: codigoRec, usuario: { nome, email } };
});

// Reconhecimento de conta: o cadastro avisa na hora se o e-mail já existe (limitado por IP para evitar varredura).
post('/api/auth/email', { publico: true }, (c) => {
  if (!L.limite('em-chk:' + ipDe(c.req), 20, 900000)) throw erro(429, 'Muitas verificações. Aguarde alguns minutos.');
  const email = String(c.body.email || '').trim().toLowerCase();
  if (!L.emailValido(email)) return { valido: false, existe: false };
  return { valido: true, existe: !!db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email) };
});

post('/api/auth/login', { publico: true }, (c) => {
  const email = String(c.body.email || '').trim().toLowerCase();
  const senha = String(c.body.senha || '');
  if (!L.limite('login-ip:' + ipDe(c.req), 30, 900000) || !L.limite('login-em:' + email, 8, 900000)) {
    throw erro(429, 'Muitas tentativas de login. Aguarde alguns minutos.');
  }
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  const ok = L.verificarSenha(senha, u ? u.senha_hash : SENHA_FALSA);
  if (!u || !ok) throw erro(401, 'E-mail ou senha incorretos.');
  if (db.prepare('SELECT suspenso FROM estabelecimentos WHERE id = ?').get(u.estabelecimento_id).suspenso) throw erro(403, 'Esta conta está suspensa. Fale com o suporte do AGENDA X.');
  if (ehDono(u.email)) garantirAcessoTotal(u.estabelecimento_id);
  c.headers['Set-Cookie'] = criarSessao(u.id, quer(c.body.manter));
  return { ok: true, usuario: { nome: u.nome, email: u.email } };
});

// Entrada do administrador: link discreto na tela inicial, só com e-mail e senha. Só vale para e-mails de ADMIN_EMAILS.
// Na primeira entrada a senha digitada cria a conta do dono; nas seguintes ela é conferida. Qualquer erro responde igual (não revela nada).
post('/api/auth/admin', { publico: true }, (c) => {
  const email = String(c.body.email || '').trim().toLowerCase();
  const senha = String(c.body.senha || '');
  if (!L.limite('adm-ip:' + ipDe(c.req), 8, 900000) || !L.limite('adm-em:' + email, 8, 900000)) throw erro(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const NEGADO = () => erro(401, 'E-mail ou senha incorretos.');
  const livre = !DONOS.length && !adminSalvo() && !db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email) && L.emailValido(email);
  if (!ehDono(email) && !livre) { L.verificarSenha(senha, SENHA_FALSA); throw NEGADO(); }
  let u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (u) {
    if (!L.verificarSenha(senha, u.senha_hash)) throw NEGADO();
  } else {
    if (!ehDono(email) && !livre) throw NEGADO();
    if (senha.length < 8 || senha.length > 100) throw erro(400, 'Primeiro acesso: escolha uma senha de 8 a 100 caracteres. Ela será a sua senha de administrador.');
    tx(() => {
      if (livre) db.prepare("INSERT OR IGNORE INTO config (chave, valor) VALUES ('admin_email', ?)").run(email);
      const ipH = L.sha256('agendax|' + ipDe(c.req));
      let slug = 'administracao', n = 1;
      while (db.prepare('SELECT 1 FROM estabelecimentos WHERE slug = ?').get(slug)) slug = 'administracao-' + (++n);
      const e = db.prepare('INSERT INTO estabelecimentos (nome, slug, plano, assinatura_status, trial_ate, ip_hash) VALUES (?,?,?,?,?,?)').run('Administração AGENDA X', slug, 'premium', 'ativa', L.addDias(L.hojeLocal('America/Fortaleza'), L.TRIAL_DIAS), ipH);
      const eid = e.lastInsertRowid;
      db.prepare('INSERT INTO usuarios (estabelecimento_id, nome, email, senha_hash) VALUES (?,?,?,?)').run(eid, 'Administrador', email, L.hashSenha(senha));
      db.prepare('INSERT INTO profissionais (estabelecimento_id, nome, horarios) VALUES (?,?,?)').run(eid, 'Administrador', JSON.stringify(HORARIOS_PADRAO()));
      garantirAcessoTotal(eid);
    });
    u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  }
  garantirAcessoTotal(u.estabelecimento_id);
  db.prepare('UPDATE estabelecimentos SET suspenso = 0 WHERE id = ?').run(u.estabelecimento_id);
  c.headers['Set-Cookie'] = criarSessao(u.id, quer(c.body.manter));
  return { ok: true, admin: true };
});

post('/api/auth/logout', { publico: true }, (c) => {
  const token = L.parseCookies(c.req.headers.cookie).ax_session;
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(L.sha256(token));
  c.headers['Set-Cookie'] = cookieSessao('', 0);
  return { ok: true };
});

function estPublico(est) {
  return { id: est.id, nome: est.nome, slug: est.slug, telefone: est.telefone, endereco: est.endereco, descricao: est.descricao,
    logo: est.logo, fuso: est.fuso, intervalo_slots: est.intervalo_slots, aparencia: L.aparenciaDe(est) };
}
get('/api/me', { semBloqueio: true }, (c) => {
  gerarAlertas(c.est);
  const naoLidas = db.prepare('SELECT COUNT(*) n FROM notificacoes WHERE estabelecimento_id = ? AND lida = 0').get(c.est.id).n;
  return {
    usuario: c.user, admin: ehDono(c.user.email), estabelecimento: estPublico(c.est), nao_lidas: naoLidas,
    assinatura: { ...c.assin, plano: L.planoEfetivo(c.est), plano_escolhido: PLANOS[c.est.plano], trial_ate: c.est.trial_ate },
  };
});
put('/api/me/senha', { semBloqueio: true }, (c) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.user.id);
  if (!L.verificarSenha(String(c.body.atual || ''), u.senha_hash)) throw erro(400, 'Senha atual incorreta.');
  const nova = String(c.body.nova || '');
  if (nova.length < 8 || nova.length > 100) throw erro(400, 'A nova senha deve ter entre 8 e 100 caracteres.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(L.hashSenha(nova), u.id);
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(u.id); // encerra o acesso em outros aparelhos
  c.headers['Set-Cookie'] = criarSessao(u.id);
  return { ok: true };
});

// ======================= Notificações (dentro do app) =======================
function gerarAlertas(est) {
  const agora = L.agoraLocal(est.fuso);
  const em1h = L.addMin(agora.slice(0, 10), agora.slice(11, 16), 60);
  const proximos = !L.planoEfetivo(est).recursos.includes('lembretes') ? [] : db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.status = 'agendado' AND a.lembrete_enviado = 0
    AND a.inicio >= ? AND a.inicio <= ?`).all(est.id, agora, em1h);
  for (const a of proximos) {
    notificar(est.id, 'lembrete', `Atendimento às ${a.inicio.slice(11)}`, `${a.cliente_nome} — ${a.servico_nome} com ${a.profissional_nome}.`);
    db.prepare('UPDATE agendamentos SET lembrete_enviado = 1 WHERE id = ?').run(a.id);
  }
  const ass = L.estadoAssinatura(est);
  const recente = (tipo, janela) => db.prepare(`SELECT 1 FROM notificacoes WHERE estabelecimento_id = ? AND tipo = ? AND criado_em > datetime('now', ?)`).get(est.id, tipo, janela);
  if (ass.status === 'trial' && ass.dias_restantes <= 3 && !recente('assinatura', '-20 hours')) {
    notificar(est.id, 'assinatura', ass.dias_restantes === 0 ? 'Seu teste grátis termina hoje' : `Seu teste grátis termina em ${ass.dias_restantes} dia(s)`,
      'Depois disso você continua no plano Grátis, com recursos limitados. Escolha um plano em Configurações → Assinatura para manter tudo liberado.');
  }
  if (ass.status === 'ativa' && ass.assinatura_ate && ass.dias_restantes <= 3 && !recente('assinatura', '-20 hours')) {
    notificar(est.id, 'assinatura', ass.dias_restantes === 0 ? 'Sua assinatura vence hoje' : `Sua assinatura vence em ${ass.dias_restantes} dia(s)`,
      'Renove em Minha assinatura pagando o Pix do mês para não perder os recursos do seu plano.');
  }
  if (ass.vencida && !recente('assinatura', '-3 days')) {
    notificar(est.id, 'assinatura', 'Sua assinatura venceu', 'Seus dados continuam salvos. Renove em Minha assinatura (Pix) para liberar tudo de novo.');
  } else if (ass.status === 'gratis' && !ass.vencida && !recente('assinatura', '-3 days')) {
    notificar(est.id, 'assinatura', 'Você está no plano Grátis',
      'Seu teste terminou e alguns recursos ficaram limitados. Assine um plano em Configurações → Assinatura para liberar tudo de novo.');
  }
}
get('/api/notificacoes', { semBloqueio: true }, (c) => {
  gerarAlertas(c.est);
  const itens = db.prepare('SELECT id, tipo, titulo, mensagem, lida, criado_em FROM notificacoes WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT ' + (tem(c.est, 'historico_notificacoes') ? 40 : 8)).all(c.est.id);
  const n = db.prepare('SELECT COUNT(*) n FROM notificacoes WHERE estabelecimento_id = ? AND lida = 0').get(c.est.id).n;
  return { itens, nao_lidas: n };
});
post('/api/notificacoes/ler-todas', { semBloqueio: true }, (c) => {
  db.prepare('UPDATE notificacoes SET lida = 1 WHERE estabelecimento_id = ?').run(c.est.id);
  return { ok: true };
});
post('/api/notificacoes/:id/ler', { semBloqueio: true }, (c) => {
  db.prepare('UPDATE notificacoes SET lida = 1 WHERE id = ? AND estabelecimento_id = ?').run(parseInt(c.params.id, 10) || 0, c.est.id);
  return { ok: true };
});

// ======================= Minha conta: exportar e excluir (LGPD) =======================
get('/api/conta/exportar', { semBloqueio: true }, (c) => {
  const e = c.est.id, tab = (t) => db.prepare(`SELECT * FROM ${t} WHERE estabelecimento_id = ?`).all(e);
  const { ip_hash, ...estab } = c.est; void ip_hash;
  const dados = { exportado_em: new Date().toISOString(), estabelecimento: estab, usuario: { nome: c.user.nome, email: c.user.email },
    profissionais: tab('profissionais'), servicos: tab('servicos'), produtos: tab('produtos'), clientes: tab('clientes'), agendamentos: tab('agendamentos'), lancamentos: tab('lancamentos'), notificacoes: tab('notificacoes') };
  return { __raw: true, status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="agendax-meus-dados.json"' }, body: JSON.stringify(dados, null, 2) };
});
post('/api/conta/excluir', { semBloqueio: true }, (c) => {
  if (!L.limite('excluir:' + c.user.id, 5, 900000)) throw erro(429, 'Muitas tentativas. Aguarde alguns minutos.');
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.user.id);
  if (!L.verificarSenha(String(c.body.senha || ''), u.senha_hash)) throw erro(400, 'Senha incorreta.');
  if (String(c.body.confirmar || '').trim().toUpperCase() !== 'EXCLUIR') throw erro(400, 'Digite EXCLUIR para confirmar.');
  db.prepare('DELETE FROM estabelecimentos WHERE id = ?').run(c.est.id); // apaga tudo em cascata (clientes, agenda, financeiro, sessões…)
  try { fs.rmSync(path.join(DATA_DIR, 'uploads', String(c.est.id)), { recursive: true, force: true }); } catch (_) { /* sem fotos */ }
  c.headers['Set-Cookie'] = cookieSessao('', 0);
  return { ok: true };
});

// ======================= Push (celular) =======================
get('/api/push/chave', { semBloqueio: true }, () => ({ chave: VAPID.publica }));
post('/api/push/assinar', { semBloqueio: true }, (c) => {
  const sub = c.body.subscription || {};
  const k = sub.keys || {};
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || sub.endpoint.length > 1000 || !k.p256dh || !k.auth) throw erro(400, 'Assinatura de notificação inválida.');
  db.prepare('INSERT INTO push_subs (estabelecimento_id, endpoint, p256dh, auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET estabelecimento_id = excluded.estabelecimento_id, p256dh = excluded.p256dh, auth = excluded.auth')
    .run(c.est.id, sub.endpoint, String(k.p256dh), String(k.auth));
  return { ok: true };
});
post('/api/push/cancelar', { semBloqueio: true }, (c) => {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND estabelecimento_id = ?').run(String(c.body.endpoint || ''), c.est.id);
  return { ok: true };
});
post('/api/push/testar', { semBloqueio: true }, (c) => { notificar(c.est.id, 'info', 'Teste de alerta 🔔', 'Se você ouviu o som e viu este aviso, está tudo certo.'); return { ok: true }; });

// ======================= Painel =======================
get('/api/dashboard', (c) => {
  const e = c.est, hoje = L.hojeLocal(e.fuso), agora = L.agoraLocal(e.fuso);
  const { ini, fim } = limitesMes(hoje);
  const doDia = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.inicio >= ? AND a.inicio < ? ORDER BY a.inicio`).all(e.id, hoje + ' 00:00', L.addDias(hoje, 1) + ' 00:00');
  const ativos = doDia.filter((a) => a.status !== 'cancelado');
  const soma = (tipo, de, ate) => db.prepare('SELECT COALESCE(SUM(valor),0) v FROM lancamentos WHERE estabelecimento_id = ? AND tipo = ? AND data >= ? AND data <= ?').get(e.id, tipo, de, ate).v;
  const d7 = L.addDias(hoje, -6);
  const rec7 = Object.fromEntries(db.prepare(`SELECT data, SUM(valor) v FROM lancamentos WHERE estabelecimento_id = ? AND tipo = 'receita' AND data >= ? AND data <= ? GROUP BY data`).all(e.id, d7, hoje).map((r) => [r.data, r.v]));
  const ag7 = Object.fromEntries(db.prepare(`SELECT substr(inicio,1,10) d, COUNT(*) n FROM agendamentos WHERE estabelecimento_id = ? AND status != 'cancelado' AND inicio >= ? AND inicio < ? GROUP BY d`).all(e.id, d7 + ' 00:00', L.addDias(hoje, 1) + ' 00:00').map((r) => [r.d, r.n]));
  const grafico = [];
  for (let i = 6; i >= 0; i--) { const d = L.addDias(hoje, -i); grafico.push({ data: d, faturamento: arred(rec7[d] || 0), agendamentos: ag7[d] || 0 }); }
  const top = db.prepare(`SELECT s.nome, COUNT(*) quantidade FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
    WHERE a.estabelecimento_id = ? AND a.status IN ('agendado','concluido') AND a.inicio >= ? GROUP BY s.id ORDER BY quantidade DESC LIMIT 5`).all(e.id, L.addDias(hoje, -29) + ' 00:00');
  return {
    hoje, agendamentos_hoje: ativos.length,
    concluidos_hoje: ativos.filter((a) => a.status === 'concluido').length,
    pendentes_hoje: ativos.filter((a) => a.status === 'agendado').length,
    faturamento_hoje: arred(soma('receita', hoje, hoje)),
    faturamento_mes: arred(soma('receita', ini, fim)),
    despesas_mes: arred(soma('despesa', ini, fim)),
    clientes_total: db.prepare('SELECT COUNT(*) n FROM clientes WHERE estabelecimento_id = ?').get(e.id).n,
    clientes_novos_mes: db.prepare('SELECT COUNT(*) n FROM clientes WHERE estabelecimento_id = ? AND substr(criado_em,1,10) >= ?').get(e.id, ini).n,
    cancelamentos_mes: db.prepare(`SELECT COUNT(*) n FROM agendamentos WHERE estabelecimento_id = ? AND status = 'cancelado' AND substr(inicio,1,10) >= ? AND substr(inicio,1,10) <= ?`).get(e.id, ini, fim).n,
    proximos: db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.status = 'agendado' AND a.inicio >= ? ORDER BY a.inicio LIMIT 6`).all(e.id, agora),
    primeiros_passos: [
      { id: 'conta', titulo: 'Criar sua conta', desc: 'Pronto! Seu teste grátis de 14 dias já começou.', feito: true },
      { id: 'servicos', titulo: 'Cadastrar seus serviços', desc: 'Com foto, preço e duração. Eles aparecem na sua página de agendamento.', feito: db.prepare('SELECT 1 FROM servicos WHERE estabelecimento_id = ? AND ativo = 1').get(e.id) != null, link: '#/servicos', rotulo: 'Cadastrar serviços' },
      { id: 'profissional', titulo: 'Vincular os serviços a um profissional', desc: 'Defina quem faz cada serviço e os horários de trabalho.', feito: db.prepare('SELECT 1 FROM profissional_servicos ps JOIN profissionais p ON p.id = ps.profissional_id WHERE p.estabelecimento_id = ? AND p.ativo = 1').get(e.id) != null, link: '#/profissionais', rotulo: 'Abrir profissionais' },
      { id: 'link', titulo: 'Compartilhar sua página de agendamento', desc: 'Envie o link para seus clientes marcarem sozinhos, a qualquer hora.', feito: false, acao: 'copiar-link', rotulo: 'Copiar link' },
      { id: 'agendamento', titulo: 'Fazer o primeiro agendamento', desc: 'Crie um horário na agenda ou receba um pelo link.', feito: db.prepare('SELECT 1 FROM agendamentos WHERE estabelecimento_id = ?').get(e.id) != null, link: '#/agenda', rotulo: 'Abrir agenda' },
    ],
    graficos_liberados: tem(c.est, 'dashboard_graficos'),
    agenda_hoje: doDia, grafico_7dias: tem(c.est, 'dashboard_graficos') ? grafico : [], servicos_top: tem(c.est, 'dashboard_graficos') ? top : [],
  };
});

// ======================= Exportações (Premium) =======================
const csvEsc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
const csvRaw = (nome, rows) => ({ __raw: true, status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}"` }, body: '\uFEFF' + rows.map((r) => r.map(csvEsc).join(';')).join('\r\n') });
get('/api/export/clientes.csv', { plano: 'exportar_clientes' }, (c) => {
  const rows = [['Nome', 'Telefone', 'E-mail', 'Atendimentos', 'Total gasto', 'Último atendimento', 'Observações']];
  for (const x of db.prepare(`${CLI_SELECT} WHERE c.estabelecimento_id = ? ORDER BY c.nome COLLATE NOCASE`).all(c.est.id)) {
    rows.push([x.nome, x.telefone, x.email, x.atendimentos, String(x.total_gasto).replace('.', ','), x.ultimo_atendimento || '', x.observacoes]);
  }
  return csvRaw('agendax-clientes.csv', rows);
});
get('/api/export/financeiro.csv', { plano: 'exportar_financeiro' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const rows = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor']];
  for (const l of db.prepare('SELECT * FROM lancamentos WHERE estabelecimento_id = ? AND data >= ? AND data <= ? ORDER BY data, id').all(c.est.id, de, ate)) {
    rows.push([l.data, l.tipo, l.descricao, l.categoria, String(l.valor).replace('.', ',')]);
  }
  return csvRaw(`agendax-financeiro-${de}_${ate}.csv`, rows);
});

// ======================= Clientes =======================
const CLI_SELECT = `SELECT c.*,
  (SELECT COUNT(*) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status = 'concluido') AS atendimentos,
  (SELECT COALESCE(SUM(a.preco),0) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status = 'concluido') AS total_gasto,
  (SELECT MAX(a.inicio) FROM agendamentos a WHERE a.cliente_id = c.id AND a.status = 'concluido') AS ultimo_atendimento
  FROM clientes c`;
function dadosCliente(b, est, atual) {
  const telefone = texto(b.telefone, 30, false, 'Telefone');
  const email = texto(b.email, 160, false, 'E-mail').toLowerCase();
  if (email && !L.emailValido(email)) throw erro(400, 'E-mail inválido.');
  const observacoes = texto(b.observacoes, 1000, false, 'Observações');
  if (est && observacoes && observacoes !== (atual ? atual.observacoes : '')) exigir(est, 'observacoes_clientes', 'Observações no cadastro do cliente estão disponíveis a partir do plano Profissional.');
  return { nome: texto(b.nome, 100, true, 'Nome'), telefone, email, observacoes };
}
get('/api/clientes', (c) => {
  const q = String(c.query.q || '').trim().toLowerCase();
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return db.prepare(`${CLI_SELECT} WHERE c.estabelecimento_id = ? AND (? = '' OR lower(c.nome) LIKE ? OR c.telefone LIKE ? OR lower(c.email) LIKE ?)
    ORDER BY c.nome COLLATE NOCASE LIMIT 500`).all(c.est.id, q, like, like, like);
});
post('/api/clientes', (c) => {
  checarLimite(c.est, 'clientes');
  const d = dadosCliente(c.body, c.est);
  const r = db.prepare('INSERT INTO clientes (estabelecimento_id, nome, telefone, email, observacoes) VALUES (?,?,?,?,?)').run(c.est.id, d.nome, d.telefone, d.email, d.observacoes);
  c.status = 201;
  return db.prepare(`${CLI_SELECT} WHERE c.id = ?`).get(r.lastInsertRowid);
});
get('/api/clientes/:id', (c) => {
  const cli = dono('clientes', c.params.id, c.est.id);
  const hist = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.cliente_id = ? ORDER BY a.inicio DESC LIMIT 200`).all(c.est.id, cli.id);
  const lib = tem(c.est, 'historico_cliente');
  return { ...db.prepare(`${CLI_SELECT} WHERE c.id = ?`).get(cli.id), historico: lib ? hist : [], historico_liberado: lib };
});
put('/api/clientes/:id', (c) => {
  const cli = dono('clientes', c.params.id, c.est.id);
  const d = dadosCliente(c.body, c.est, cli);
  db.prepare('UPDATE clientes SET nome=?, telefone=?, email=?, observacoes=? WHERE id=?').run(d.nome, d.telefone, d.email, d.observacoes, cli.id);
  return db.prepare(`${CLI_SELECT} WHERE c.id = ?`).get(cli.id);
});
del('/api/clientes/:id', (c) => {
  const cli = dono('clientes', c.params.id, c.est.id);
  if (db.prepare('SELECT 1 FROM agendamentos WHERE cliente_id = ?').get(cli.id)) throw erro(409, 'Este cliente possui histórico de atendimentos e não pode ser excluído.');
  db.prepare('DELETE FROM clientes WHERE id = ?').run(cli.id);
  return { ok: true };
});

// ======================= Serviços =======================
function sincronizarServicoProfs(estabId, servicoId, ids) {
  if (!Array.isArray(ids)) return;
  const validos = ids.map((i) => parseInt(i, 10)).filter((i) => db.prepare('SELECT 1 FROM profissionais WHERE id = ? AND estabelecimento_id = ?').get(i, estabId));
  db.prepare('DELETE FROM profissional_servicos WHERE servico_id = ?').run(servicoId);
  for (const p of new Set(validos)) db.prepare('INSERT INTO profissional_servicos (profissional_id, servico_id) VALUES (?,?)').run(p, servicoId);
}
function dadosServico(b) {
  return {
    nome: texto(b.nome, 80, true, 'Nome do serviço'), descricao: texto(b.descricao, 500, false, 'Descrição'),
    preco: arred(numero(b.preco, 'Preço', { min: 0, max: 100000 })),
    duracao_min: Math.round(numero(b.duracao_min, 'Duração', { min: 5, max: 600 })),
  };
}
get('/api/servicos', (c) => db.prepare('SELECT * FROM servicos WHERE estabelecimento_id = ? ORDER BY ativo DESC, nome COLLATE NOCASE').all(c.est.id).map(serializarServico));
post('/api/servicos', (c) => {
  checarLimite(c.est, 'servicos');
  const d = dadosServico(c.body);
  const foto = c.body.foto ? L.salvarImagem(c.body.foto, c.est.id) : '';
  const r = db.prepare('INSERT INTO servicos (estabelecimento_id, nome, descricao, preco, duracao_min, foto) VALUES (?,?,?,?,?,?)').run(c.est.id, d.nome, d.descricao, d.preco, d.duracao_min, foto);
  sincronizarServicoProfs(c.est.id, r.lastInsertRowid, c.body.profissionais);
  c.status = 201;
  return serializarServico(db.prepare('SELECT * FROM servicos WHERE id = ?').get(r.lastInsertRowid));
});
put('/api/servicos/:id', (c) => {
  const s = dono('servicos', c.params.id, c.est.id);
  const d = dadosServico(c.body);
  let foto = s.foto;
  if (c.body.foto) { foto = L.salvarImagem(c.body.foto, c.est.id); L.removerImagem(s.foto); }
  else if (c.body.remover_foto) { L.removerImagem(s.foto); foto = ''; }
  const ativo = c.body.ativo === undefined ? s.ativo : (c.body.ativo ? 1 : 0);
  db.prepare('UPDATE servicos SET nome=?, descricao=?, preco=?, duracao_min=?, foto=?, ativo=? WHERE id=?').run(d.nome, d.descricao, d.preco, d.duracao_min, foto, ativo, s.id);
  sincronizarServicoProfs(c.est.id, s.id, c.body.profissionais);
  return serializarServico(db.prepare('SELECT * FROM servicos WHERE id = ?').get(s.id));
});
del('/api/servicos/:id', (c) => {
  const s = dono('servicos', c.params.id, c.est.id);
  if (db.prepare('SELECT 1 FROM agendamentos WHERE servico_id = ?').get(s.id)) {
    db.prepare('UPDATE servicos SET ativo = 0 WHERE id = ?').run(s.id);
    return { ok: true, desativado: true };
  }
  L.removerImagem(s.foto);
  db.prepare('DELETE FROM servicos WHERE id = ?').run(s.id);
  return { ok: true };
});

// ======================= Profissionais =======================
function checarLimiteProfissionais(est, ignorarId) {
  const pl = L.planoEfetivo(est), max = pl.max_profissionais;
  if (max == null) return;
  const n = db.prepare('SELECT COUNT(*) n FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1 AND id != ?').get(est.id, ignorarId || 0).n;
  if (n >= max) throw erro(403, `O plano ${pl.nome} permite até ${max} profissional(is) ativo(s). Faça upgrade para adicionar mais.`, { upgrade: true });
}
function sincronizarProfServicos(estabId, profId, ids) {
  if (!Array.isArray(ids)) return;
  const validos = ids.map((i) => parseInt(i, 10)).filter((i) => db.prepare('SELECT 1 FROM servicos WHERE id = ? AND estabelecimento_id = ?').get(i, estabId));
  db.prepare('DELETE FROM profissional_servicos WHERE profissional_id = ?').run(profId);
  for (const s of new Set(validos)) db.prepare('INSERT INTO profissional_servicos (profissional_id, servico_id) VALUES (?,?)').run(profId, s);
}
function dadosProf(b, est, atual) {
  const cor = /^#[0-9a-fA-F]{6}$/.test(b.cor || '') ? b.cor : '#7c3aed';
  const horarios = JSON.stringify(validarHorarios(b.horarios || HORARIOS_PADRAO()));
  if (est) {
    if (horarios !== (atual ? atual.horarios : JSON.stringify(validarHorarios(HORARIOS_PADRAO())))) exigir(est, 'horarios_profissionais', 'Horários de trabalho personalizados estão disponíveis a partir do plano Profissional.');
    if (cor.toLowerCase() !== (atual ? atual.cor : '#7c3aed').toLowerCase()) exigir(est, 'cor_profissional', 'Cor personalizada do profissional está disponível no plano Premium.');
  }
  return {
    nome: texto(b.nome, 80, true, 'Nome'), telefone: texto(b.telefone, 30, false, 'Telefone'), cor,
    comissao_percent: arred(numero(b.comissao_percent, 'Comissão', { min: 0, max: 100, padrao: 0 })),
    horarios,
  };
}
get('/api/profissionais', (c) => db.prepare('SELECT * FROM profissionais WHERE estabelecimento_id = ? ORDER BY ativo DESC, nome COLLATE NOCASE').all(c.est.id).map(serializarProf));
post('/api/profissionais', (c) => {
  checarLimiteProfissionais(c.est);
  if (c.body.foto) exigir(c.est, 'fotos_profissionais', 'Foto de profissional está disponível a partir do plano Profissional.');
  const d = dadosProf(c.body, c.est);
  const foto = c.body.foto ? L.salvarImagem(c.body.foto, c.est.id) : '';
  const r = db.prepare('INSERT INTO profissionais (estabelecimento_id, nome, telefone, foto, cor, comissao_percent, horarios) VALUES (?,?,?,?,?,?,?)')
    .run(c.est.id, d.nome, d.telefone, foto, d.cor, d.comissao_percent, d.horarios);
  sincronizarProfServicos(c.est.id, r.lastInsertRowid, c.body.servicos);
  c.status = 201;
  return serializarProf(db.prepare('SELECT * FROM profissionais WHERE id = ?').get(r.lastInsertRowid));
});
put('/api/profissionais/:id', (c) => {
  const p = dono('profissionais', c.params.id, c.est.id);
  if (c.body.foto) exigir(c.est, 'fotos_profissionais', 'Foto de profissional está disponível a partir do plano Profissional.');
  const d = dadosProf(c.body, c.est, p);
  const ativo = c.body.ativo === undefined ? p.ativo : (c.body.ativo ? 1 : 0);
  if (ativo && !p.ativo) checarLimiteProfissionais(c.est, p.id);
  let foto = p.foto;
  if (c.body.foto) { foto = L.salvarImagem(c.body.foto, c.est.id); L.removerImagem(p.foto); }
  else if (c.body.remover_foto) { L.removerImagem(p.foto); foto = ''; }
  db.prepare('UPDATE profissionais SET nome=?, telefone=?, foto=?, cor=?, comissao_percent=?, horarios=?, ativo=? WHERE id=?')
    .run(d.nome, d.telefone, foto, d.cor, d.comissao_percent, d.horarios, ativo, p.id);
  sincronizarProfServicos(c.est.id, p.id, c.body.servicos);
  return serializarProf(db.prepare('SELECT * FROM profissionais WHERE id = ?').get(p.id));
});
del('/api/profissionais/:id', (c) => {
  const p = dono('profissionais', c.params.id, c.est.id);
  if (db.prepare('SELECT 1 FROM agendamentos WHERE profissional_id = ?').get(p.id)) {
    db.prepare('UPDATE profissionais SET ativo = 0 WHERE id = ?').run(p.id);
    return { ok: true, desativado: true };
  }
  L.removerImagem(p.foto);
  db.prepare('DELETE FROM profissionais WHERE id = ?').run(p.id);
  return { ok: true };
});
put('/api/profissionais/:id/comissao', { plano: 'comissoes' }, (c) => {
  const p = dono('profissionais', c.params.id, c.est.id);
  const v = arred(numero(c.body.comissao_percent, 'Comissão', { min: 0, max: 100 }));
  db.prepare('UPDATE profissionais SET comissao_percent = ? WHERE id = ?').run(v, p.id);
  return { ok: true, comissao_percent: v };
});

// ======================= Agenda =======================
function validarAgendamento(c, ignorarId, atualAg) {
  const b = c.body, e = c.est;
  const servico = dono('servicos', b.servico_id, e.id);
  const prof = dono('profissionais', b.profissional_id, e.id);
  if (!servico.ativo) throw erro(400, 'Serviço inativo.');
  if (!prof.ativo) throw erro(400, 'Profissional inativo.');
  if (!db.prepare('SELECT 1 FROM profissional_servicos WHERE profissional_id = ? AND servico_id = ?').get(prof.id, servico.id)) {
    throw erro(400, `${prof.nome} não realiza o serviço "${servico.nome}". Associe o serviço ao profissional.`);
  }
  if (!L.dataValida(b.data) || !L.horaValida(b.hora)) throw erro(400, 'Data ou hora inválida.');
  const inicio = `${b.data} ${b.hora}`;
  const fim = L.addMin(b.data, b.hora, servico.duracao_min);
  if (b.preco !== '' && b.preco != null && arred(numero(b.preco, 'Preço', { min: 0, max: 100000 })) !== arred(servico.preco)) exigir(e, 'preco_personalizado', 'Valor personalizado está disponível a partir do plano Profissional.');
  const obs = texto(b.observacoes, 500, false, 'Observações');
  if (obs && obs !== (atualAg ? atualAg.observacoes : '')) exigir(e, 'observacoes_agendamento', 'Observações nos agendamentos estão disponíveis no plano Premium.');
  const x = conflito(e.id, prof.id, inicio, fim, ignorarId);
  if (x) throw erro(409, `Conflito de horário: ${prof.nome} já tem ${x.cliente} das ${x.inicio.slice(11)} às ${x.fim.slice(11)}.`, { conflito: x });
  return { servico, prof, inicio, fim };
}
get('/api/agendamentos', (c) => {
  const { de, ate } = intervalo(c.query, c.est, 1);
  const prof = parseInt(c.query.profissional_id, 10) || 0;
  return comProdutos(db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.inicio >= ? AND a.inicio < ? AND (? = 0 OR a.profissional_id = ?)
    ORDER BY a.inicio LIMIT 1000`).all(c.est.id, de + ' 00:00', L.addDias(ate, 1) + ' 00:00', prof, prof));
});
get('/api/disponibilidade', (c) => {
  const servico = dono('servicos', c.query.servico_id, c.est.id);
  const prof = dono('profissionais', c.query.profissional_id, c.est.id);
  if (!L.dataValida(c.query.data)) throw erro(400, 'Data inválida.');
  return { slots: slotsLivres(c.est, prof, servico.duracao_min, c.query.data, true) };
});

// ======================= Produtos (opcionais no agendamento) =======================
const serializarProduto = (p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, foto: p.foto, ativo: !!p.ativo });
function dadosProduto(b) {
  return { nome: texto(b.nome, 80, true, 'Nome do produto'), descricao: texto(b.descricao, 300, false, 'Descrição'), preco: arred(numero(b.preco, 'Preço', { min: 0, max: 100000 })) };
}
get('/api/produtos', (c) => db.prepare('SELECT * FROM produtos WHERE estabelecimento_id = ? ORDER BY ativo DESC, nome COLLATE NOCASE').all(c.est.id).map(serializarProduto));
post('/api/produtos', (c) => {
  const d = dadosProduto(c.body);
  if (db.prepare('SELECT COUNT(*) n FROM produtos WHERE estabelecimento_id = ?').get(c.est.id).n >= 200) throw erro(400, 'Limite de 200 produtos atingido.');
  const foto = c.body.foto ? L.salvarImagem(c.body.foto, c.est.id) : '';
  const r = db.prepare('INSERT INTO produtos (estabelecimento_id, nome, descricao, preco, foto) VALUES (?,?,?,?,?)').run(c.est.id, d.nome, d.descricao, d.preco, foto);
  c.status = 201;
  return serializarProduto(db.prepare('SELECT * FROM produtos WHERE id = ?').get(r.lastInsertRowid));
});
put('/api/produtos/:id', (c) => {
  const p = dono('produtos', c.params.id, c.est.id), d = dadosProduto(c.body);
  let foto = p.foto;
  if (c.body.foto) { foto = L.salvarImagem(c.body.foto, c.est.id); L.removerImagem(p.foto); }
  else if (c.body.remover_foto) { L.removerImagem(p.foto); foto = ''; }
  const ativo = c.body.ativo === undefined ? p.ativo : (c.body.ativo ? 1 : 0);
  db.prepare('UPDATE produtos SET nome=?, descricao=?, preco=?, foto=?, ativo=? WHERE id=?').run(d.nome, d.descricao, d.preco, foto, ativo, p.id);
  return serializarProduto(db.prepare('SELECT * FROM produtos WHERE id = ?').get(p.id));
});
del('/api/produtos/:id', (c) => {
  const p = dono('produtos', c.params.id, c.est.id);
  L.removerImagem(p.foto);
  db.prepare('DELETE FROM produtos WHERE id = ?').run(p.id); // os pedidos antigos guardam nome e preço
  return { ok: true };
});
// itens: [{ id, qtd }] -> linhas validadas (só produtos ativos do estabelecimento); vazio = cliente não quis produto
function itensProdutos(estId, itens) {
  if (!Array.isArray(itens) || !itens.length) return [];
  if (itens.length > 20) throw erro(400, 'Produtos demais em um só agendamento.');
  const mapa = new Map();
  for (const it of itens) {
    const id = parseInt(it && it.id, 10), qtd = Math.min(20, Math.max(1, parseInt(it && it.qtd, 10) || 1));
    if (!id) continue;
    mapa.set(id, Math.min(20, (mapa.get(id) || 0) + qtd));
  }
  return [...mapa].map(([id, qtd]) => {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ? AND estabelecimento_id = ? AND ativo = 1').get(id, estId);
    if (!p) throw erro(400, 'Um dos produtos escolhidos não está mais disponível.');
    return { produto_id: p.id, nome: p.nome, preco: p.preco, qtd };
  });
}
const totalProdutos = (linhas) => arred(linhas.reduce((t, x) => t + x.preco * x.qtd, 0));
function gravarProdutos(agId, linhas) {
  db.prepare('DELETE FROM agendamento_produtos WHERE agendamento_id = ?').run(agId);
  for (const x of linhas) db.prepare('INSERT INTO agendamento_produtos (agendamento_id, produto_id, nome, preco, qtd) VALUES (?,?,?,?,?)').run(agId, x.produto_id, x.nome, x.preco, x.qtd);
}
function comProdutos(rows) {
  const lista = Array.isArray(rows) ? rows : [rows];
  if (!lista.length) return rows;
  const q = db.prepare('SELECT nome, preco, qtd FROM agendamento_produtos WHERE agendamento_id = ? ORDER BY id');
  for (const a of lista) a.produtos = q.all(a.id);
  return rows;
}
post('/api/agendamentos', (c) => {
  const e = c.est;
  const out = tx(() => {
    let clienteId = parseInt(c.body.cliente_id, 10);
    if (!clienteId && c.body.novo_cliente) {
      checarLimite(e, 'clientes');
      const d = dadosCliente(c.body.novo_cliente, e);
      clienteId = db.prepare('INSERT INTO clientes (estabelecimento_id, nome, telefone, email, observacoes) VALUES (?,?,?,?,?)').run(e.id, d.nome, d.telefone, d.email, d.observacoes).lastInsertRowid;
    }
    const cli = dono('clientes', clienteId, e.id);
    const v = validarAgendamento(c);
    checarLimiteAgendamentos(e, v.inicio);
    const preco = c.body.preco === '' || c.body.preco == null ? v.servico.preco : arred(numero(c.body.preco, 'Preço', { min: 0, max: 100000 }));
    const r = db.prepare(`INSERT INTO agendamentos (estabelecimento_id, cliente_id, profissional_id, servico_id, inicio, fim, preco, observacoes)
      VALUES (?,?,?,?,?,?,?,?)`).run(e.id, cli.id, v.prof.id, v.servico.id, v.inicio, v.fim, preco, texto(c.body.observacoes, 500, false, 'Observações'));
    return r.lastInsertRowid;
  });
  c.status = 201;
  return db.prepare(`${AG_SELECT} WHERE a.id = ?`).get(out);
});
put('/api/agendamentos/:id', (c) => {
  const a = dono('agendamentos', c.params.id, c.est.id);
  if (a.status !== 'agendado') throw erro(400, 'Só é possível editar agendamentos com status "agendado".');
  exigir(c.est, 'remarcar_agendamento', 'Editar e remarcar agendamentos está disponível a partir do plano Profissional. Você ainda pode cancelar e criar outro.');
  tx(() => {
    const cli = dono('clientes', c.body.cliente_id, c.est.id);
    const v = validarAgendamento(c, a.id, a);
    const extra = totalProdutos(db.prepare('SELECT preco, qtd FROM agendamento_produtos WHERE agendamento_id = ?').all(a.id));
    const preco = c.body.preco === '' || c.body.preco == null ? arred(v.servico.preco + extra) : arred(numero(c.body.preco, 'Preço', { min: 0, max: 100000 }));
    db.prepare(`UPDATE agendamentos SET cliente_id=?, profissional_id=?, servico_id=?, inicio=?, fim=?, preco=?, observacoes=?, lembrete_enviado=0 WHERE id=?`)
      .run(cli.id, v.prof.id, v.servico.id, v.inicio, v.fim, preco, texto(c.body.observacoes, 500, false, 'Observações'), a.id);
  });
  return db.prepare(`${AG_SELECT} WHERE a.id = ?`).get(a.id);
});
post('/api/agendamentos/:id/cancelar', (c) => {
  const a = dono('agendamentos', c.params.id, c.est.id);
  if (a.status === 'cancelado') throw erro(400, 'Agendamento já cancelado.');
  tx(() => {
    db.prepare("UPDATE agendamentos SET status = 'cancelado', comissao_percent = NULL, comissao_valor = NULL WHERE id = ?").run(a.id);
    db.prepare('DELETE FROM lancamentos WHERE agendamento_id = ?').run(a.id);
  });
  return db.prepare(`${AG_SELECT} WHERE a.id = ?`).get(a.id);
});
post('/api/agendamentos/:id/faltou', { plano: 'marcar_falta' }, (c) => {
  const a = dono('agendamentos', c.params.id, c.est.id);
  if (a.status !== 'agendado') throw erro(400, 'Só agendamentos pendentes podem ser marcados como falta.');
  db.prepare("UPDATE agendamentos SET status = 'faltou' WHERE id = ?").run(a.id);
  return db.prepare(`${AG_SELECT} WHERE a.id = ?`).get(a.id);
});
post('/api/agendamentos/:id/concluir', (c) => {
  const a = dono('agendamentos', c.params.id, c.est.id);
  if (a.status !== 'agendado') throw erro(400, 'Só agendamentos pendentes podem ser concluídos.');
  const valor = c.body.valor === '' || c.body.valor == null ? a.preco : arred(numero(c.body.valor, 'Valor', { min: 0, max: 100000 }));
  if (valor !== arred(a.preco)) exigir(c.est, 'preco_personalizado', 'Valor personalizado está disponível a partir do plano Profissional.');
  tx(() => {
    const p = db.prepare('SELECT comissao_percent FROM profissionais WHERE id = ?').get(a.profissional_id);
    const com = arred(valor * p.comissao_percent / 100);
    db.prepare("UPDATE agendamentos SET status = 'concluido', preco = ?, comissao_percent = ?, comissao_valor = ? WHERE id = ?").run(valor, p.comissao_percent, com, a.id);
    const s = db.prepare('SELECT nome FROM servicos WHERE id = ?').get(a.servico_id);
    const cli = db.prepare('SELECT nome FROM clientes WHERE id = ?').get(a.cliente_id);
    db.prepare("INSERT INTO lancamentos (estabelecimento_id, tipo, descricao, categoria, valor, data, agendamento_id) VALUES (?,?,?,?,?,?,?)")
      .run(c.est.id, 'receita', `${s.nome}${db.prepare('SELECT 1 FROM agendamento_produtos WHERE agendamento_id = ?').get(a.id) ? ' + produtos' : ''} — ${cli.nome}`, 'Serviços', valor, a.inicio.slice(0, 10), a.id);
  });
  return db.prepare(`${AG_SELECT} WHERE a.id = ?`).get(a.id);
});

// ======================= Financeiro =======================
get('/api/lancamentos', { plano: 'financeiro' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const tipo = ['receita', 'despesa'].includes(c.query.tipo) ? c.query.tipo : '';
  return db.prepare(`SELECT * FROM lancamentos WHERE estabelecimento_id = ? AND data >= ? AND data <= ? AND (? = '' OR tipo = ?)
    ORDER BY data DESC, id DESC LIMIT 1000`).all(c.est.id, de, ate, tipo, tipo);
});
post('/api/lancamentos', { plano: 'financeiro' }, (c) => {
  const b = c.body;
  if (!['receita', 'despesa'].includes(b.tipo)) throw erro(400, 'Tipo inválido.');
  const data = b.data || L.hojeLocal(c.est.fuso);
  if (!L.dataValida(data)) throw erro(400, 'Data inválida.');
  if (b.tipo === 'receita') exigir(c.est, 'receitas_avulsas', 'Receitas avulsas estão disponíveis no plano Premium. As receitas dos atendimentos entram sozinhas.');
  if (String(b.categoria || '').trim()) exigir(c.est, 'categorias_despesas', 'Categorias em receitas e despesas estão disponíveis no plano Premium. Deixe a categoria em branco ou faça upgrade.');
  const r = db.prepare('INSERT INTO lancamentos (estabelecimento_id, tipo, descricao, categoria, valor, data) VALUES (?,?,?,?,?,?)')
    .run(c.est.id, b.tipo, texto(b.descricao, 120, true, 'Descrição'), texto(b.categoria, 60, false, 'Categoria'), arred(numero(b.valor, 'Valor', { min: 0.01, max: 10000000 })), data);
  c.status = 201;
  return db.prepare('SELECT * FROM lancamentos WHERE id = ?').get(r.lastInsertRowid);
});
del('/api/lancamentos/:id', { plano: 'financeiro' }, (c) => {
  const l = dono('lancamentos', c.params.id, c.est.id);
  if (l.agendamento_id) throw erro(400, 'Esta receita veio de um atendimento concluído. Cancele o atendimento na agenda para removê-la.');
  db.prepare('DELETE FROM lancamentos WHERE id = ?').run(l.id);
  return { ok: true };
});
get('/api/financeiro/resumo', { plano: 'financeiro' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const eid = c.est.id;
  const tot = (tipo) => arred(db.prepare('SELECT COALESCE(SUM(valor),0) v FROM lancamentos WHERE estabelecimento_id = ? AND tipo = ? AND data >= ? AND data <= ?').get(eid, tipo, de, ate).v);
  const receitas = tot('receita'), despesas = tot('despesa');
  const linhas = db.prepare('SELECT data, tipo, SUM(valor) v FROM lancamentos WHERE estabelecimento_id = ? AND data >= ? AND data <= ? GROUP BY data, tipo').all(eid, de, ate);
  const mapa = {};
  for (const l of linhas) { (mapa[l.data] = mapa[l.data] || { receitas: 0, despesas: 0 })[l.tipo === 'receita' ? 'receitas' : 'despesas'] = arred(l.v); }
  const serie = [];
  for (let d = de; d <= ate; d = L.addDias(d, 1)) serie.push({ data: d, receitas: (mapa[d] || {}).receitas || 0, despesas: (mapa[d] || {}).despesas || 0 });
  const porCat = db.prepare(`SELECT CASE WHEN categoria = '' THEN 'Sem categoria' ELSE categoria END AS categoria, tipo, SUM(valor) total FROM lancamentos
    WHERE estabelecimento_id = ? AND data >= ? AND data <= ? GROUP BY 1, tipo ORDER BY total DESC`).all(eid, de, ate);
  return { de, ate, receitas, despesas, saldo: arred(receitas - despesas), serie, por_categoria: porCat };
});

// ======================= Comissões =======================
get('/api/comissoes', { plano: 'comissoes' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const resumo = db.prepare(`SELECT p.id AS profissional_id, p.nome, p.cor, p.comissao_percent, p.ativo,
      COUNT(a.id) AS atendimentos, COALESCE(SUM(a.preco),0) AS faturamento, COALESCE(SUM(a.comissao_valor),0) AS comissao_total
    FROM profissionais p LEFT JOIN agendamentos a ON a.profissional_id = p.id AND a.status = 'concluido' AND a.inicio >= ? AND a.inicio < ?
    WHERE p.estabelecimento_id = ? AND (p.ativo = 1 OR a.id IS NOT NULL) GROUP BY p.id ORDER BY comissao_total DESC, p.nome`)
    .all(de + ' 00:00', L.addDias(ate, 1) + ' 00:00', c.est.id);
  const detalhes = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.status = 'concluido' AND a.inicio >= ? AND a.inicio < ? ORDER BY a.inicio DESC LIMIT 500`)
    .all(c.est.id, de + ' 00:00', L.addDias(ate, 1) + ' 00:00');
  const total = resumo.reduce((s, r) => s + r.comissao_total, 0);
  return { de, ate, profissionais: resumo.map((r) => ({ ...r, faturamento: arred(r.faturamento), comissao_total: arred(r.comissao_total) })), total_comissoes: arred(total), detalhes };
});

// ======================= Relatórios =======================
get('/api/relatorios', { plano: 'relatorios' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const eid = c.est.id, a = de + ' 00:00', b = L.addDias(ate, 1) + ' 00:00';
  const porStatus = Object.fromEntries(['agendado', 'concluido', 'cancelado', 'faltou'].map((s) => [s, 0]));
  db.prepare('SELECT status, COUNT(*) n FROM agendamentos WHERE estabelecimento_id = ? AND inicio >= ? AND inicio < ? GROUP BY status').all(eid, a, b).forEach((r) => { porStatus[r.status] = r.n; });
  const totalAg = Object.values(porStatus).reduce((x, y) => x + y, 0);
  const fat = arred(db.prepare("SELECT COALESCE(SUM(valor),0) v FROM lancamentos WHERE estabelecimento_id = ? AND tipo = 'receita' AND data >= ? AND data <= ?").get(eid, de, ate).v);
  const mapa = Object.fromEntries(db.prepare("SELECT data, SUM(valor) v FROM lancamentos WHERE estabelecimento_id = ? AND tipo = 'receita' AND data >= ? AND data <= ? GROUP BY data").all(eid, de, ate).map((r) => [r.data, r.v]));
  const serie = [];
  for (let d = de; d <= ate; d = L.addDias(d, 1)) serie.push({ data: d, valor: arred(mapa[d] || 0) });
  const servicos = db.prepare(`SELECT s.nome, COUNT(*) quantidade, COALESCE(SUM(CASE WHEN a.status='concluido' THEN a.preco ELSE 0 END),0) faturamento
    FROM agendamentos a JOIN servicos s ON s.id = a.servico_id WHERE a.estabelecimento_id = ? AND a.status IN ('agendado','concluido') AND a.inicio >= ? AND a.inicio < ?
    GROUP BY s.id ORDER BY quantidade DESC, faturamento DESC LIMIT 10`).all(eid, a, b);
  const profs = db.prepare(`SELECT p.nome, p.cor, COUNT(*) atendimentos, COALESCE(SUM(a.preco),0) faturamento FROM agendamentos a JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.estabelecimento_id = ? AND a.status = 'concluido' AND a.inicio >= ? AND a.inicio < ? GROUP BY p.id ORDER BY faturamento DESC`).all(eid, a, b);
  const clientes = db.prepare(`SELECT c.nome, COUNT(*) visitas, COALESCE(SUM(a.preco),0) gasto FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
    WHERE a.estabelecimento_id = ? AND a.status = 'concluido' AND a.inicio >= ? AND a.inicio < ? GROUP BY c.id ORDER BY gasto DESC LIMIT 10`).all(eid, a, b);
  const canc = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.status IN ('cancelado','faltou') AND a.inicio >= ? AND a.inicio < ? ORDER BY a.inicio DESC LIMIT 30`).all(eid, a, b);
  const origem = db.prepare(`SELECT origem, COUNT(*) n FROM agendamentos WHERE estabelecimento_id = ? AND status != 'cancelado' AND inicio >= ? AND inicio < ? GROUP BY origem`).all(eid, a, b);
  const lib = Object.fromEntries(['rel_servicos', 'rel_profissionais', 'rel_clientes', 'rel_cancelamentos', 'rel_origem', 'rel_ticket'].map((k) => [k, tem(c.est, k)]));
  const so = (k, x, vazio) => (lib[k] ? x : vazio);
  return {
    liberado: lib,
    de, ate, faturamento_total: fat, atendimentos_concluidos: porStatus.concluido, agendamentos_total: totalAg,
    ticket_medio: so('rel_ticket', porStatus.concluido ? arred(fat / porStatus.concluido) : 0, null), por_status: porStatus,
    taxa_cancelamento: so('rel_ticket', totalAg ? Math.round((porStatus.cancelado / totalAg) * 1000) / 10 : 0, null),
    serie_faturamento: serie, servicos_top: so('rel_servicos', servicos.map((s) => ({ ...s, faturamento: arred(s.faturamento) })), []),
    profissionais: so('rel_profissionais', profs.map((p) => ({ ...p, faturamento: arred(p.faturamento) })), []), clientes_top: so('rel_clientes', clientes.map((x) => ({ ...x, gasto: arred(x.gasto) })), []),
    cancelamentos: so('rel_cancelamentos', canc, []), por_origem: so('rel_origem', origem, []),
  };
});
get('/api/relatorios/export.csv', { plano: 'exportar' }, (c) => {
  const { de, ate } = intervalo(c.query, c.est, 30);
  const linhas = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.inicio >= ? AND a.inicio < ? ORDER BY a.inicio`).all(c.est.id, de + ' 00:00', L.addDias(ate, 1) + ' 00:00');
  const esc = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [['Data', 'Hora', 'Cliente', 'Telefone', 'Serviço', 'Profissional', 'Status', 'Valor', 'Comissão', 'Origem']];
  for (const a of linhas) rows.push([a.inicio.slice(0, 10), a.inicio.slice(11), a.cliente_nome, a.cliente_telefone, a.servico_nome, a.profissional_nome, a.status, String(a.preco).replace('.', ','), a.comissao_valor == null ? '' : String(a.comissao_valor).replace('.', ','), a.origem]);
  return { __raw: true, status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="agendax-${de}_${ate}.csv"` }, body: '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') };
});

// ======================= Configurações e assinatura =======================
get('/api/config', (c) => estPublico(c.est));
put('/api/config', (c) => {
  const b = c.body;
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 40) throw erro(400, 'Endereço da página: use 3 a 40 letras minúsculas, números e hífens.');
  if (db.prepare('SELECT 1 FROM estabelecimentos WHERE slug = ? AND id != ?').get(slug, c.est.id)) throw erro(409, 'Este endereço já está em uso. Escolha outro.');
  if (slug !== c.est.slug) exigir(c.est, 'link_personalizado', 'Endereço personalizado da página está disponível no plano Premium.');
  const fuso = String(b.fuso || c.est.fuso);
  if (fuso !== c.est.fuso) exigir(c.est, 'fuso_horario', 'Fuso horário personalizado está disponível no plano Premium.');
  for (const [k, rot] of [['telefone', 'Telefone'], ['endereco', 'Endereço'], ['descricao', 'Descrição']]) {
    if (String(b[k] || '').trim() !== (c.est[k] || '')) exigir(c.est, 'pagina_personalizada', 'Descrição, endereço e telefone da página pública estão disponíveis a partir do plano Profissional.');
  }
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }); } catch (_) { throw erro(400, 'Fuso horário inválido.'); }
  const passo = parseInt(b.intervalo_slots, 10);
  if (![10, 15, 20, 30, 45, 60].includes(passo)) throw erro(400, 'Intervalo de horários inválido.');
  if (passo !== c.est.intervalo_slots) exigir(c.est, 'intervalo_horarios', 'Intervalo de horários personalizado está disponível a partir do plano Profissional.');
  db.prepare('UPDATE estabelecimentos SET nome=?, slug=?, telefone=?, endereco=?, descricao=?, fuso=?, intervalo_slots=? WHERE id=?')
    .run(texto(b.nome, 80, true, 'Nome'), slug, texto(b.telefone, 30, false, 'Telefone'), texto(b.endereco, 160, false, 'Endereço'), texto(b.descricao, 400, false, 'Descrição'), fuso, passo, c.est.id);
  return estPublico(db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(c.est.id));
});
const HEX = /^#[0-9a-fA-F]{6}$/;
put('/api/config/aparencia', (c) => {
  const b = c.body, f = b.fundo || {}, atual = L.aparenciaDe(c.est);
  const cor = (v, rot) => { if (!HEX.test(String(v || ''))) throw erro(400, `${rot}: use uma cor no formato #RRGGBB.`); return String(v).toLowerCase(); };
  const tipo = ['cor', 'tema', 'imagem'].includes(f.tipo) ? f.tipo : 'cor';
  if (tipo === 'tema' && !L.TEMAS_FUNDO.includes(f.tema)) throw erro(400, 'Tema de fundo inválido.');
  const nova = { cor_principal: cor(b.cor_principal, 'Cor principal'), cor_secundaria: cor(b.cor_secundaria, 'Cor secundária'), cor_destaque: cor(b.cor_destaque, 'Cor de destaque'),
    fundo: { tipo, cor: cor(f.cor || atual.fundo.cor, 'Cor do fundo'), tema: L.TEMAS_FUNDO.includes(f.tema) ? f.tema : atual.fundo.tema, imagem: atual.fundo.imagem } };
  if (tipo === 'imagem' && !nova.fundo.imagem) throw erro(400, 'Envie uma imagem de fundo antes de escolher esta opção.');
  if (JSON.stringify(nova) !== JSON.stringify(atual)) exigir(c.est, 'pagina_personalizada', 'Cores e fundo da página de agendamento estão disponíveis a partir do plano Profissional.');
  db.prepare('UPDATE estabelecimentos SET aparencia = ? WHERE id = ?').run(JSON.stringify(nova), c.est.id);
  return nova;
});
post('/api/config/fundo', (c) => {
  exigir(c.est, 'pagina_personalizada', 'Imagem de fundo da página de agendamento está disponível a partir do plano Profissional.');
  const url = L.salvarImagem(c.body.imagem, c.est.id);
  const ap = L.aparenciaDe(c.est); L.removerImagem(ap.fundo.imagem);
  ap.fundo.imagem = url; ap.fundo.tipo = 'imagem';
  db.prepare('UPDATE estabelecimentos SET aparencia = ? WHERE id = ?').run(JSON.stringify(ap), c.est.id);
  return ap;
});
del('/api/config/fundo', (c) => {
  const ap = L.aparenciaDe(c.est); L.removerImagem(ap.fundo.imagem);
  ap.fundo.imagem = ''; if (ap.fundo.tipo === 'imagem') ap.fundo.tipo = 'cor';
  db.prepare('UPDATE estabelecimentos SET aparencia = ? WHERE id = ?').run(JSON.stringify(ap), c.est.id);
  return ap;
});
post('/api/config/logo', { plano: 'logo' }, (c) => {
  const url = L.salvarImagem(c.body.imagem, c.est.id);
  L.removerImagem(c.est.logo);
  db.prepare('UPDATE estabelecimentos SET logo = ? WHERE id = ?').run(url, c.est.id);
  return { logo: url };
});
del('/api/config/logo', (c) => {
  L.removerImagem(c.est.logo);
  db.prepare("UPDATE estabelecimentos SET logo = '' WHERE id = ?").run(c.est.id);
  return { ok: true };
});
const COBRANCA_MIN = 30;           // minutos de validade do Pix
const DIAS_ASSINATURA = 30;        // dias liberados por pagamento aprovado
const pagPublico = (p) => ({ id: p.id, plano: p.plano, valor: p.valor, status: p.status, qr_code: p.status === 'pendente' ? p.qr_code : '', qr_base64: p.status === 'pendente' ? p.qr_base64 : '',
  expira_em: p.expira_em, criado_em: p.criado_em, pago_em: p.pago_em, validade_ate: p.validade_ate, transacao: p.provedor_id });
const agoraSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
function expirarPendentes() { db.prepare("UPDATE pagamentos SET status = 'expirado' WHERE status = 'pendente' AND expira_em < ?").run(agoraSql()); }

get('/api/assinatura', { semBloqueio: true }, (c) => {
  expirarPendentes();
  const pend = db.prepare("SELECT * FROM pagamentos WHERE estabelecimento_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 1").get(c.est.id);
  return {
    planos: Object.values(PLANOS), atual: c.assin.plano_efetivo, escolhido: c.est.plano,
    estado: { ...c.assin, trial_ate: c.est.trial_ate },
    pagamento: { modo: PAG.modo(), disponivel: PAG.modo() !== 'desligado' },
    pendente: pend ? pagPublico(pend) : null,
    pagamentos: db.prepare('SELECT * FROM pagamentos WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 12').all(c.est.id).map(pagPublico),
    profissionais_ativos: db.prepare('SELECT COUNT(*) n FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1').get(c.est.id).n,
  };
});
// Escolher o plano que pretende assinar (não cobra nem ativa nada). A ativação só acontece por pagamento confirmado.
post('/api/assinatura', { semBloqueio: true }, (c) => {
  const plano = PLANOS[c.body.plano];
  if (!plano || plano.id === 'gratis') throw erro(400, 'Plano inválido.');
  if (c.body.ativar) throw erro(400, 'A assinatura só é ativada depois do pagamento Pix confirmado.');
  db.prepare('UPDATE estabelecimentos SET plano = ? WHERE id = ? AND assinatura_status != ?').run(plano.id, c.est.id, 'ativa');
  const e = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(c.est.id);
  return { plano: e.plano, estado: { ...L.estadoAssinatura(e), trial_ate: e.trial_ate } };
});

// Gera a cobrança Pix. O valor vem do plano cadastrado no servidor: nada do que o navegador enviar altera o preço.
post('/api/assinatura/pix', { semBloqueio: true }, async (c) => {
  if (PAG.modo() === 'desligado') throw erro(501, 'O pagamento online ainda não foi configurado neste servidor.');
  const plano = PLANOS[c.body.plano];
  if (!plano || plano.id === 'gratis' || !plano.preco) throw erro(400, 'Plano inválido.');
  if (!L.limite('pix:' + c.est.id, 10, 3600000)) throw erro(429, 'Muitas cobranças geradas. Aguarde um pouco.');
  const ativos = db.prepare('SELECT COUNT(*) n FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1').get(c.est.id).n;
  if (plano.max_profissionais != null && ativos > plano.max_profissionais) {
    throw erro(400, `Você tem ${ativos} profissionais ativos e o plano ${plano.nome} permite ${plano.max_profissionais}. Desative alguns antes de assinar.`);
  }
  expirarPendentes();
  const pend = db.prepare("SELECT * FROM pagamentos WHERE estabelecimento_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 1").get(c.est.id);
  if (pend && pend.plano === plano.id) return pagPublico(pend); // mesma cobrança ainda válida: reaproveita
  if (pend) { await PAG.cancelar(pend.provedor_id); db.prepare("UPDATE pagamentos SET status = 'cancelado' WHERE id = ? AND status = 'pendente'").run(pend.id); }
  const referencia = 'ax-' + c.est.id + '-' + crypto.randomUUID();
  const expira = new Date(Date.now() + COBRANCA_MIN * 60000).toISOString().slice(0, 19).replace('T', ' ');
  const url = urlPublica() ? urlPublica() + '/api/webhooks/mercadopago' : '';
  const r = await PAG.criarPix({ valor: plano.preco, descricao: `AGENDA X — plano ${plano.nome} (30 dias)`, referencia, email: c.user.email, expiraMin: COBRANCA_MIN, urlNotificacao: url });
  const ins = db.prepare('INSERT INTO pagamentos (estabelecimento_id, plano, valor, referencia, provedor_id, qr_code, qr_base64, expira_em) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.est.id, plano.id, plano.preco, referencia, r.id, r.qr_code, r.qr_base64, expira);
  c.status = 201;
  return pagPublico(db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(ins.lastInsertRowid));
});

// Só a resposta oficial do provedor decide: confere referência, método Pix, moeda, valor e estado "approved".
async function sincronizarPagamento(pag) {
  const p = await PAG.buscar(pag.provedor_id);
  db.prepare('UPDATE pagamentos SET verificado_em = ? WHERE id = ?').run(Date.now(), pag.id);
  const confere = p.referencia === pag.referencia && p.metodo === 'pix' && p.moeda === 'BRL' && Math.abs(p.valor - pag.valor) < 0.005;
  if (p.status === 'approved') {
    if (!confere) {
      db.prepare("UPDATE pagamentos SET status = 'divergente' WHERE id = ? AND status IN ('pendente','expirado')").run(pag.id);
      console.warn(`PAGAMENTO DIVERGENTE: conta ${pag.estabelecimento_id}, cobrança ${pag.id}, esperado R$ ${pag.valor}, provedor informou R$ ${p.valor} (${p.referencia})`);
      return 'divergente';
    }
    return ativarAssinatura(pag.id, p.aprovado_em) ? 'aprovado' : 'ja_processado';
  }
  if (['cancelled', 'rejected', 'refunded', 'charged_back'].includes(p.status)) db.prepare("UPDATE pagamentos SET status = ? WHERE id = ? AND status = 'pendente'").run(p.status === 'cancelled' ? 'cancelado' : 'rejeitado', pag.id);
  return p.status;
}
// Idempotente: o UPDATE condicional garante que notificações duplicadas ou simultâneas ativem uma única vez.
function ativarAssinatura(pagId, aprovadoEm) {
  return tx(() => {
    const pag = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pagId);
    const est = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(pag.estabelecimento_id);
    const hoje = L.hojeLocal(est.fuso);
    const renova = est.assinatura_status === 'ativa' && est.assinatura_ate && est.assinatura_ate >= hoje && est.plano === pag.plano;
    const ate = L.addDias(renova ? est.assinatura_ate : hoje, DIAS_ASSINATURA);
    const r = db.prepare("UPDATE pagamentos SET status = 'aprovado', pago_em = ?, validade_ate = ? WHERE id = ? AND status IN ('pendente','expirado')").run(aprovadoEm ? String(aprovadoEm).slice(0, 19).replace('T', ' ') : agoraSql(), ate, pag.id);
    if (!r.changes) return false;
    db.prepare("UPDATE estabelecimentos SET plano = ?, assinatura_status = 'ativa', assinatura_ate = ? WHERE id = ?").run(pag.plano, ate, est.id);
    notificar(est.id, 'assinatura', 'Pagamento confirmado ✅', `Plano ${PLANOS[pag.plano].nome} ativo até ${ate.slice(8, 10)}/${ate.slice(5, 7)}/${ate.slice(0, 4)}.`);
    return true;
  });
}
get('/api/assinatura/pagamento/:id', { semBloqueio: true }, async (c) => {
  expirarPendentes();
  let pag = dono('pagamentos', c.params.id, c.est.id);
  // se o webhook demorar, confere direto no provedor (no máx. 1 vez a cada 4 s por cobrança)
  if (pag.status === 'pendente' && Date.now() - (pag.verificado_em || 0) > 4000 && PAG.modo() !== 'desligado') {
    try { await sincronizarPagamento(pag); } catch (e) { if (!e.status) throw e; }
    pag = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pag.id);
  }
  return pagPublico(pag);
});
post('/api/assinatura/pagamento/:id/cancelar', { semBloqueio: true }, async (c) => {
  const pag = dono('pagamentos', c.params.id, c.est.id);
  if (pag.status !== 'pendente') throw erro(400, 'Esta cobrança não está mais pendente.');
  await PAG.cancelar(pag.provedor_id);
  db.prepare("UPDATE pagamentos SET status = 'cancelado' WHERE id = ? AND status = 'pendente'").run(pag.id);
  return { ok: true };
});

// Webhook do provedor (sem sessão): autenticidade por assinatura HMAC; o estado real vem da consulta à API do provedor.
post('/api/webhooks/mercadopago', { publico: true }, async (c) => {
  if (PAG.modo() === 'desligado') throw erro(503, 'Pagamentos não configurados.');
  const dataId = String(c.query['data.id'] || (c.body.data && c.body.data.id) || '');
  const reqId = String(c.req.headers['x-request-id'] || '');
  if (!PAG.assinaturaValida({ dataId, xSignature: c.req.headers['x-signature'], xRequestId: reqId })) throw erro(401, 'Assinatura inválida.');
  const tipo = String(c.body.type || c.query.type || c.body.topic || '');
  if (tipo && tipo !== 'payment') return { ok: true, ignorado: true };
  const pag = db.prepare('SELECT * FROM pagamentos WHERE provedor_id = ?').get(dataId);
  const chave = reqId + '|' + dataId + '|' + String(c.body.action || '');
  if (!pag) { db.prepare('INSERT OR IGNORE INTO webhook_eventos (chave, provedor_id, resultado) VALUES (?,?,?)').run(chave, dataId, 'desconhecido'); return { ok: true, ignorado: true }; }
  let resultado;
  try { resultado = await sincronizarPagamento(pag); }
  catch (e) { if (e.status) throw erro(502, 'Não foi possível confirmar com o provedor agora.'); throw e; } // o provedor tenta de novo
  db.prepare('INSERT OR IGNORE INTO webhook_eventos (chave, provedor_id, resultado) VALUES (?,?,?)').run(chave, dataId, resultado);
  return { ok: true };
});
post('/api/assinatura/cancelar', { semBloqueio: true }, (c) => {
  db.prepare("UPDATE estabelecimentos SET assinatura_status = 'cancelada' WHERE id = ?").run(c.est.id);
  notificar(c.est.id, 'assinatura', 'Assinatura cancelada', 'Você voltou para o plano Grátis. Seus dados continuam salvos.');
  return { ok: true };
});

// ======================= Página pública de agendamento =======================
const janelaDias = (e) => (tem(e, 'agenda_online_60_dias') ? 60 : 14);
function estPorSlug(slug) {
  const e = db.prepare('SELECT * FROM estabelecimentos WHERE slug = ?').get(String(slug).toLowerCase());
  if (!e) throw erro(404, 'Estabelecimento não encontrado.');
  if (e.suspenso || !L.estadoAssinatura(e).acesso) throw erro(403, 'O agendamento online deste estabelecimento está temporariamente indisponível.');
  return e;
}
get('/api/public/:slug', { publico: true }, (c) => {
  const e = estPorSlug(c.params.slug);
  const servicos = db.prepare(`SELECT s.id, s.nome, s.descricao, s.preco, s.duracao_min, s.foto FROM servicos s WHERE s.estabelecimento_id = ? AND s.ativo = 1
    AND EXISTS (SELECT 1 FROM profissional_servicos ps JOIN profissionais p ON p.id = ps.profissional_id WHERE ps.servico_id = s.id AND p.ativo = 1) ORDER BY s.nome COLLATE NOCASE`).all(e.id);
  const profs = db.prepare('SELECT * FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1 ORDER BY nome').all(e.id)
    .map((p) => ({ id: p.id, nome: p.nome, foto: p.foto, servicos: profServicos(p.id) }));
  const hoje = L.hojeLocal(e.fuso);
  return { escolher_profissional: tem(e, 'escolher_profissional'), cancelamento_online: tem(e, 'cancelamento_online'),
    estabelecimento: { nome: e.nome, telefone: tem(e, 'pagina_personalizada') ? e.telefone : '', endereco: tem(e, 'pagina_personalizada') ? e.endereco : '', descricao: tem(e, 'pagina_personalizada') ? e.descricao : '', logo: e.logo && tem(e, 'logo') ? e.logo : '' }, aparencia: tem(e, 'pagina_personalizada') ? L.aparenciaDe(e) : L.APARENCIA_PADRAO, servicos, produtos: db.prepare('SELECT id, nome, descricao, preco, foto FROM produtos WHERE estabelecimento_id = ? AND ativo = 1 ORDER BY nome COLLATE NOCASE').all(e.id), profissionais: profs, hoje, max_data: L.addDias(hoje, janelaDias(e)), observacoes_online: tem(e, 'observacoes_online') };
});
get('/api/public/:slug/horarios', { publico: true }, (c) => {
  const e = estPorSlug(c.params.slug);
  const servico = db.prepare('SELECT * FROM servicos WHERE id = ? AND estabelecimento_id = ? AND ativo = 1').get(parseInt(c.query.servico_id, 10) || 0, e.id);
  if (!servico) throw erro(404, 'Serviço não encontrado.');
  const data = c.query.data;
  const hoje = L.hojeLocal(e.fuso);
  if (!L.dataValida(data) || data < hoje || data > L.addDias(hoje, janelaDias(e))) throw erro(400, `Escolha uma data nos próximos ${janelaDias(e)} dias.`);
  let profs = profissionaisDoServico(e.id, servico.id);
  const pid = tem(e, 'escolher_profissional') ? parseInt(c.query.profissional_id, 10) : 0;
  if (pid) profs = profs.filter((p) => p.id === pid);
  const mapa = new Map();
  for (const p of profs) for (const h of slotsLivres(e, p, servico.duracao_min, data, false)) if (!mapa.has(h)) mapa.set(h, p.id);
  return { slots: [...mapa.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([hora, profissional_id]) => ({ hora, profissional_id })) };
});
post('/api/public/:slug/agendar', { publico: true }, (c) => {
  if (!L.limite('pub:' + ipDe(c.req), 12, 3600000)) throw erro(429, 'Muitas solicitações. Tente novamente mais tarde.');
  const e = estPorSlug(c.params.slug), b = c.body;
  const nome = texto(b.nome, 100, true, 'Nome');
  const telefone = texto(b.telefone, 30, true, 'Telefone');
  if (telefone.replace(/\D/g, '').length < 10) throw erro(400, 'Informe um telefone válido com DDD.');
  const email = texto(b.email, 160, false, 'E-mail').toLowerCase();
  if (email && !L.emailValido(email)) throw erro(400, 'E-mail inválido.');
  const servico = db.prepare('SELECT * FROM servicos WHERE id = ? AND estabelecimento_id = ? AND ativo = 1').get(parseInt(b.servico_id, 10) || 0, e.id);
  if (!servico) throw erro(404, 'Serviço não encontrado.');
  if (!L.dataValida(b.data) || !L.horaValida(b.hora)) throw erro(400, 'Data ou hora inválida.');
  const hoje = L.hojeLocal(e.fuso);
  if (b.data < hoje || b.data > L.addDias(hoje, janelaDias(e))) throw erro(400, `Escolha uma data nos próximos ${janelaDias(e)} dias.`);
  const resultado = tx(() => {
    const itens = itensProdutos(e.id, b.produtos);
    checarLimiteAgendamentos(e, b.data);
    let candidatos = profissionaisDoServico(e.id, servico.id);
    const pid = tem(e, 'escolher_profissional') ? parseInt(b.profissional_id, 10) : 0;
    if (pid) candidatos = candidatos.filter((p) => p.id === pid);
    const prof = candidatos.find((p) => slotsLivres(e, p, servico.duracao_min, b.data, false).includes(b.hora));
    if (!prof) throw erro(409, 'Este horário acabou de ser ocupado. Escolha outro horário.');
    const dig = telefone.replace(/\D/g, '');
    let cli = db.prepare("SELECT * FROM clientes WHERE estabelecimento_id = ? AND replace(replace(replace(replace(telefone,' ',''),'-',''),'(',''),')','') LIKE ?").get(e.id, '%' + dig);
    if (!cli) {
      const id = db.prepare('INSERT INTO clientes (estabelecimento_id, nome, telefone, email) VALUES (?,?,?,?)').run(e.id, nome, telefone, email).lastInsertRowid;
      cli = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    }
    const inicio = `${b.data} ${b.hora}`, fim = L.addMin(b.data, b.hora, servico.duracao_min);
    const codigo = crypto.randomBytes(5).toString('hex').toUpperCase();
    db.prepare(`INSERT INTO agendamentos (estabelecimento_id, cliente_id, profissional_id, servico_id, inicio, fim, preco, origem, observacoes, codigo)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(e.id, cli.id, prof.id, servico.id, inicio, fim, arred(servico.preco + totalProdutos(itens)), 'online', tem(e, 'observacoes_online') ? texto(b.observacoes, 300, false, 'Observações') : '', codigo);
    const agId = db.prepare('SELECT id FROM agendamentos WHERE codigo = ? AND estabelecimento_id = ?').get(codigo, e.id).id;
    gravarProdutos(agId, itens);
    const txtProd = itens.length ? ` + ${itens.map((x) => (x.qtd > 1 ? x.qtd + 'x ' : '') + x.nome).join(', ')}` : '';
    notificar(e.id, 'agendamento', 'Novo agendamento online 📅', `${cli.nome} — ${servico.nome}${txtProd} em ${fmtData(b.data)} às ${b.hora} com ${prof.nome}.`);
    return { codigo, servico: servico.nome, profissional: prof.nome, data: b.data, hora: b.hora, preco: arred(servico.preco + totalProdutos(itens)), produtos: itens.map((x) => ({ nome: x.nome, preco: x.preco, qtd: x.qtd })), duracao_min: servico.duracao_min };
  });
  c.status = 201;
  return { ok: true, agendamento: resultado };
});
function agPorCodigo(e, codigo) {
  const cod = String(codigo || '').trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(cod)) throw erro(404, 'Agendamento não encontrado.');
  const a = db.prepare(`${AG_SELECT} WHERE a.estabelecimento_id = ? AND a.codigo = ?`).get(e.id, cod);
  if (!a) throw erro(404, 'Agendamento não encontrado.');
  return a;
}
get('/api/public/:slug/agendamento/:codigo', { publico: true }, (c) => {
  if (!L.limite('cod:' + ipDe(c.req), 30, 3600000)) throw erro(429, 'Muitas solicitações.');
  const a = agPorCodigo(estPorSlug(c.params.slug), c.params.codigo);
  return { servico: a.servico_nome, profissional: a.profissional_nome, data: a.inicio.slice(0, 10), hora: a.inicio.slice(11), status: a.status, preco: a.preco, produtos: comProdutos(a).produtos };
});
post('/api/public/:slug/cancelar', { publico: true }, (c) => {
  if (!L.limite('cod:' + ipDe(c.req), 30, 3600000)) throw erro(429, 'Muitas solicitações.');
  const e = estPorSlug(c.params.slug);
  if (!tem(e, 'cancelamento_online')) throw erro(403, 'O cancelamento online não está disponível neste estabelecimento. Entre em contato para desmarcar.');
  const a = agPorCodigo(e, c.body.codigo);
  if (a.status !== 'agendado') throw erro(400, 'Este agendamento não pode mais ser cancelado.');
  if (a.inicio <= L.agoraLocal(e.fuso)) throw erro(400, 'Este horário já passou.');
  db.prepare("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?").run(a.id);
  notificar(e.id, 'cancelamento', 'Agendamento cancelado pelo cliente', `${a.cliente_nome} cancelou ${a.servico_nome} de ${fmtData(a.inicio.slice(0, 10))} às ${a.inicio.slice(11)}.`);
  return { ok: true };
});


// ======================= Administração (só dono da plataforma) =======================
// Quem não é dono recebe 404, como se a área não existisse. O painel mostra totais e situação das contas,
// nunca os clientes, a agenda ou o financeiro de cada estabelecimento.
function soDono(c) { if (!c.user || !ehDono(c.user.email)) throw erro(404, 'Não encontrado.'); }
const contaAdmin = (e) => {
  const a = L.estadoAssinatura(e), u = db.prepare('SELECT nome, email, criado_em FROM usuarios WHERE estabelecimento_id = ? ORDER BY id LIMIT 1').get(e.id) || {};
  const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE estabelecimento_id = ?`).get(e.id).n;
  return { id: e.id, nome: e.nome, slug: e.slug, responsavel: u.nome || '', email: u.email || '', criado_em: e.criado_em, plano: e.plano, status: e.suspenso ? 'suspensa' : a.status,
    dias_restantes: a.dias_restantes, trial_ate: e.trial_ate, dono: ehDono(u.email), suspenso: !!e.suspenso,
    uso: { clientes: n('clientes'), profissionais: n('profissionais'), agendamentos: n('agendamentos') } };
};
get('/api/admin/resumo', { semBloqueio: true }, (c) => {
  soDono(c);
  const contas = db.prepare('SELECT * FROM estabelecimentos ORDER BY id DESC').all().map(contaAdmin);
  const cont = (f) => contas.filter(f).length, dias = (n) => contas.filter((x) => x.criado_em > new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace('T', ' ')).length;
  return {
    totais: { contas: contas.length, em_teste: cont((x) => x.status === 'trial'), assinantes: cont((x) => x.status === 'ativa' && !x.dono), limitadas: cont((x) => x.status === 'gratis'), suspensas: cont((x) => x.suspenso), novas_7d: dias(7), novas_30d: dias(30) },
    contas, historico: db.prepare('SELECT quando, admin_email, estabelecimento_id, acao, detalhe FROM admin_log ORDER BY id DESC LIMIT 30').all(),
  };
});
post('/api/admin/contas/:id', { semBloqueio: true }, (c) => {
  soDono(c);
  const e = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(parseInt(c.params.id, 10) || 0);
  if (!e) throw erro(404, 'Conta não encontrada.');
  const dono = db.prepare('SELECT email FROM usuarios WHERE estabelecimento_id = ?').all(e.id).some((u) => ehDono(u.email));
  if (dono) throw erro(400, 'Contas de proprietário não podem ser alteradas por aqui.');
  const b = c.body, acao = String(b.acao || ''); let detalhe = '';
  if (acao === 'plano') {
    if (!PLANOS[b.plano] || b.plano === 'gratis') throw erro(400, 'Plano inválido.');
    db.prepare("UPDATE estabelecimentos SET plano = ?, assinatura_status = 'ativa', assinatura_ate = NULL WHERE id = ?").run(b.plano, e.id);
    detalhe = `plano ${b.plano} liberado manualmente`;
    notificar(e.id, 'assinatura', 'Plano atualizado ✅', `Seu plano ${PLANOS[b.plano].nome} foi liberado.`);
  } else if (acao === 'estender') {
    const n = parseInt(b.dias, 10);
    if (!(n >= 1 && n <= 365)) throw erro(400, 'Informe de 1 a 365 dias.');
    const hoje = L.hojeLocal(e.fuso), base = e.trial_ate && e.trial_ate > hoje ? e.trial_ate : hoje;
    db.prepare("UPDATE estabelecimentos SET assinatura_status = 'trial', trial_ate = ? WHERE id = ?").run(L.addDias(base, n), e.id);
    detalhe = `teste estendido em ${n} dia(s)`;
    notificar(e.id, 'assinatura', 'Teste grátis estendido 🎁', `Você ganhou mais ${n} dia(s) com tudo liberado.`);
  } else if (acao === 'limitar') {
    db.prepare("UPDATE estabelecimentos SET assinatura_status = 'gratis' WHERE id = ?").run(e.id); detalhe = 'voltou ao plano limitado';
  } else if (acao === 'suspender' || acao === 'reativar') {
    const sus = acao === 'suspender' ? 1 : 0;
    db.prepare('UPDATE estabelecimentos SET suspenso = ? WHERE id = ?').run(sus, e.id);
    if (sus) db.prepare('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE estabelecimento_id = ?)').run(e.id);
    detalhe = sus ? 'conta suspensa' : 'conta reativada';
  } else throw erro(400, 'Ação inválida.');
  db.prepare('INSERT INTO admin_log (admin_email, estabelecimento_id, acao, detalhe) VALUES (?,?,?,?)').run(c.user.email, e.id, acao, detalhe);
  return contaAdmin(db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(e.id));
});

// ======================= Credenciais de pagamento (painel do administrador) =======================
// O token e a assinatura do webhook ficam no servidor, criptografados (AES-256-GCM). Nunca voltam para o navegador:
// o painel só mostra "definido" e as últimas letras. A chave de criptografia vem de CONFIG_KEY ou de um arquivo gerado
// na pasta de dados (separado do banco). O painel tem prioridade sobre as variáveis de ambiente.
const chaveConfig = (() => {
  if (process.env.CONFIG_KEY) return crypto.createHash('sha256').update('agendax-config|' + process.env.CONFIG_KEY).digest();
  const f = path.join(DATA_DIR, '.chave-config');
  try { const k = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); if (k.length === 32) return k; } catch (_) { /* cria abaixo */ }
  const k = crypto.randomBytes(32);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 }); } catch (_) { /* sem disco: vale só nesta execução */ }
  return k;
})();
function cifrar(txt) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', chaveConfig, iv);
  const ct = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decifrar(v) {
  try {
    const [iv, tag, ct] = String(v).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', chaveConfig, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}
const cfgLer = (k) => { const r = db.prepare('SELECT valor FROM config WHERE chave = ?').get(k); return r ? r.valor : ''; };
const cfgGravar = (k, v) => { if (v) db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, v); else db.prepare('DELETE FROM config WHERE chave = ?').run(k); };
const segredoPainel = (k) => { const v = cfgLer(k); return v ? decifrar(v) : ''; };
function urlPublica() { return (cfgLer('public_url') || process.env.PUBLIC_URL || '').replace(/\/$/, ''); }
PAG.setFonte(() => ({ token: segredoPainel('mp_token'), segredo: segredoPainel('mp_segredo') }));
const mascara = (t) => (t ? t.replace(/^([A-Za-z_]+-).*(.{4})$/, '$1…$2') : '');
function estadoPagamentos() {
  const tp = segredoPainel('mp_token'), sp = segredoPainel('mp_segredo');
  const tok = tp || process.env.MP_ACCESS_TOKEN || '', seg = sp || process.env.MP_WEBHOOK_SECRET || '';
  const url = urlPublica();
  return { modo: PAG.modo(), token: { definido: !!tok, origem: tp ? 'painel' : tok ? 'servidor' : '', mascara: mascara(tok) },
    segredo: { definido: !!seg, origem: sp ? 'painel' : seg ? 'servidor' : '' },
    public_url: url, webhook_url: url ? url + '/api/webhooks/mercadopago' : '' };
}
get('/api/admin/pagamentos', { semBloqueio: true }, (c) => { soDono(c); return estadoPagamentos(); });
put('/api/admin/pagamentos', { semBloqueio: true }, (c) => {
  soDono(c);
  if (!L.limite('adm-pag:' + c.user.id, 20, 3600000)) throw erro(429, 'Muitas alterações. Tente mais tarde.');
  const b = c.body, mudou = [];
  const tok = String(b.access_token || '').trim(), seg = String(b.webhook_secret || '').trim();
  let url = String(b.public_url || '').trim();
  if (tok) { if (!/^(TEST|APP_USR)-[A-Za-z0-9_-]{20,200}$/.test(tok)) throw erro(400, 'Esse Access Token não parece certo. Ele começa com TEST- (teste) ou APP_USR- (produção).'); }
  if (seg && !/^[\x21-\x7e]{8,200}$/.test(seg)) throw erro(400, 'A assinatura secreta parece inválida (sem espaços, de 8 a 200 caracteres).');
  if (url) {
    let u; try { u = new URL(url); } catch (_) { throw erro(400, 'Endereço inválido. Exemplo: https://meuapp.onrender.com'); }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !PROD)) throw erro(400, 'O endereço precisa começar com https://');
    url = u.origin;
  }
  tx(() => {
    if (b.remover_token) { cfgGravar('mp_token', ''); mudou.push('token removido'); } else if (tok) { cfgGravar('mp_token', cifrar(tok)); mudou.push('token'); }
    if (b.remover_segredo) { cfgGravar('mp_segredo', ''); mudou.push('assinatura removida'); } else if (seg) { cfgGravar('mp_segredo', cifrar(seg)); mudou.push('assinatura do webhook'); }
    if (url) { cfgGravar('public_url', url); mudou.push('endereço do app'); }
    if (mudou.length) db.prepare('INSERT INTO admin_log (admin_email, estabelecimento_id, acao, detalhe) VALUES (?,?,?,?)').run(c.user.email, c.est.id, 'pagamentos', 'Credenciais de pagamento: ' + mudou.join(', '));
  });
  return estadoPagamentos();
});
post('/api/admin/pagamentos/testar', { semBloqueio: true }, async (c) => {
  soDono(c);
  if (!L.limite('adm-pag-teste:' + c.user.id, 15, 3600000)) throw erro(429, 'Muitos testes. Tente mais tarde.');
  try { const r = await PAG.testar(); return { ok: true, modo: PAG.modo(), conta: r }; }
  catch (e) { throw erro(400, e.status === 502 ? 'Não consegui falar com o Mercado Pago agora. Tente de novo.' : 'O Mercado Pago recusou este token. Confira se copiou inteiro.'); }
});

// ======================= Servidor HTTP =======================
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function cabecalhosSeguranca(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

async function tratarAPI(req, res, url) {
  const achou = R.achar(req.method, url.pathname);
  if (!achou) {
    if (R.rotas.some((r) => r.re.test(url.pathname))) return L.enviarJSON(res, 405, { erro: 'Método não permitido.' });
    return L.enviarJSON(res, 404, { erro: 'Rota não encontrada.' });
  }
  const { rota, params } = achou;
  const c = { req, res, params, query: Object.fromEntries(url.searchParams), body: {}, status: 200, headers: {} };
  if (req.method !== 'GET') {
    const origem = req.headers.origin;
    if (origem) {
      let h = ''; try { h = new URL(origem).host; } catch (_) { /* inválida */ }
      const meu = (CONFIAR_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
      if (h !== String(meu).split(',')[0].trim()) throw erro(403, 'Origem da requisição não permitida.');
    }
    const tipo = String(req.headers['content-type'] || '');
    if (!tipo.includes('application/json')) throw erro(415, 'Content-Type deve ser application/json.');
    c.body = await L.lerCorpo(req, 6 * 1024 * 1024);
    if (c.body === null || typeof c.body !== 'object' || Array.isArray(c.body)) c.body = {};
  }
  if (!rota.opts.publico) {
    const s = carregarSessao(req);
    if (!s) throw erro(401, 'Sessão expirada. Faça login novamente.');
    c.user = s.user; c.est = s.est; c.assin = L.estadoAssinatura(s.est);
        if (rota.opts.plano && !L.planoEfetivo(c.est).recursos.includes(rota.opts.plano)) {
      throw erro(403, 'Este recurso não está disponível no seu plano. Faça upgrade para usar.', { upgrade: true, recurso: rota.opts.plano });
    }
  }
  const r = await rota.fn(c);
  if (r && r.__raw) { res.writeHead(r.status, { 'Cache-Control': 'no-store', ...r.headers }); return res.end(r.body); }
  L.enviarJSON(res, c.status, r === undefined ? { ok: true } : r, c.headers);
}

const servidor = http.createServer(async (req, res) => {
  cabecalhosSeguranca(res);
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/saude') { db.prepare('SELECT 1').get(); res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
    if (p === '/api/eventos' && req.method === 'GET') {
      const sess = carregarSessao(req);
      if (!sess) return L.enviarJSON(res, 401, { erro: 'Sessão expirada. Faça login novamente.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const id = sess.est.id;
      if (!ouvintes.has(id)) ouvintes.set(id, new Set());
      ouvintes.get(id).add(res);
      const bat = setInterval(() => { try { res.write(': ok\n\n'); } catch (_) { /* fecha abaixo */ } }, 25000);
      req.on('close', () => { clearInterval(bat); const set = ouvintes.get(id); if (set) { set.delete(res); if (!set.size) ouvintes.delete(id); } });
      return;
    }
    if (p.startsWith('/api/')) return await tratarAPI(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p === '/' || p === '/index.html') return L.servirArquivo(res, PUBLIC_DIR, 'index.html', { 'Cache-Control': 'no-cache' });
    if (p === '/app' || p === '/app/') return L.servirArquivo(res, PUBLIC_DIR, 'app.html', { 'Cache-Control': 'no-cache' });
    if (/^\/agendar\/[a-z0-9-]+\/?$/i.test(p)) return L.servirArquivo(res, PUBLIC_DIR, 'book.html', { 'Cache-Control': 'no-cache' });
    if (p.startsWith('/uploads/')) {
      if (L.servirArquivo(res, path.join(DATA_DIR, 'uploads'), p.slice('/uploads/'.length), { 'Cache-Control': 'public, max-age=86400' })) return;
    } else if (L.servirArquivo(res, PUBLIC_DIR, p.slice(1), { 'Cache-Control': 'no-cache' })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Página não encontrada');
  } catch (e) {
    if (e.status) {
      if (!res.headersSent) L.enviarJSON(res, e.status, { erro: e.message, ...e.extra });
    } else {
      console.error('Erro interno:', e);
      if (!res.headersSent) L.enviarJSON(res, 500, { erro: 'Erro interno do servidor.' });
    }
  }
});

setInterval(() => db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now()), 3600000).unref();
setInterval(() => { try { expirarPendentes(); } catch (_) { /* tenta na próxima */ } }, 600000).unref();

// Lembretes automáticos: não dependem de alguém estar com o app aberto (1x por minuto).
function lembretesAutomaticos() {
  try {
    const ids = db.prepare("SELECT DISTINCT estabelecimento_id id FROM agendamentos WHERE status = 'agendado' AND lembrete_enviado = 0 AND inicio >= date('now','-1 day') AND inicio < date('now','+2 day')").all();
    for (const { id } of ids) { const e = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(id); if (e) gerarAlertas(e); }
  } catch (err) { console.error('Erro nos lembretes:', err.message); }
}
// Backup diário do banco (cópia consistente) na pasta backups/, guardando os últimos 7.
function backupDiario() {
  try {
    const dir = path.join(DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const alvo = path.join(dir, `agendax-${new Date().toISOString().slice(0, 10)}.db`);
    if (!fs.existsSync(alvo)) db.exec(`VACUUM INTO '${alvo.replace(/'/g, "''")}'`);
    fs.readdirSync(dir).filter((f) => /^agendax-.*\.db$/.test(f)).sort().slice(0, -7).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  } catch (err) { console.error('Erro no backup:', err.message); }
}
if (require.main === module) {
  setInterval(lembretesAutomaticos, 60000).unref();
  backupDiario(); setInterval(backupDiario, 6 * 3600000).unref();
  const encerrar = () => { servidor.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) { /* ok */ } process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', encerrar); process.on('SIGINT', encerrar);
}

if (require.main === module) {
  servidor.listen(PORT, () => console.log(`AGENDA X rodando em http://localhost:${PORT}`));
}
module.exports = { servidor, lembretesAutomaticos, backupDiario };
