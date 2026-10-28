'use strict';
// Teste de ponta a ponta: sobe o servidor com banco temporário e exercita os fluxos principais.
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agendax-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_EMAILS = 'dono@teste.com';
process.env.MAX_TESTES_POR_IP = '1000';
process.env.MAX_CADASTROS_HORA = '1000';
process.env.DB_FILE = path.join(tmp, 'test.db');

const { servidor } = require('./server');
const { db } = require('./db');
const L = require('./lib');

// PNG 1x1 válido
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let base, passou = 0;
class Cliente {
  constructor() { this.cookie = ''; }
  async req(metodo, url, corpo) {
    const r = await fetch(base + url, {
      method: metodo,
      headers: Object.assign({ cookie: this.cookie }, metodo === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      body: metodo === 'GET' ? undefined : JSON.stringify(corpo || {}),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch (_) { d = t; }
    return { status: r.status, d, headers: r.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b); }
  put(u, b) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
}
async function t(nome, fn) {
  try { await fn(); passou++; console.log('  ✔', nome); }
  catch (e) { console.error('  ✘', nome, '\n   ', e.message); process.exitCode = 1; }
}
const amanha = () => L.addDias(L.hojeLocal('America/Fortaleza'), 1);
// próxima data (a partir de amanhã) que caia numa segunda a sexta
function diaUtil() { let d = amanha(); while ([0, 6].includes(L.diaSemana(d))) d = L.addDias(d, 1); return d; }


// ---------- Provedor de pagamentos FALSO (só nos testes): imita a API do Mercado Pago, sem dinheiro real ----------
const http = require('http');
const crypto = require('crypto');
const MP_SEGREDO = 'segredo-webhook-de-teste';
const fakeMP = { pag: new Map(), seq: 5000, auth: 'Bearer TEST-token-de-teste', criados: 0 };
const mpServidor = http.createServer((req, res) => {
  let corpo = ''; req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    const j = (st, o) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== fakeMP.auth) return j(401, { message: 'token inválido' });
    if (req.url === '/users/me') return j(200, { id: 123456, nickname: 'LOJA TESTE', site_id: 'MLB' });
    const m = /^\/v1\/payments(?:\/(\d+))?$/.exec(req.url);
    if (!m) return j(404, {});
    if (req.method === 'POST') {
      const b = JSON.parse(corpo || '{}'); const id = ++fakeMP.seq; fakeMP.criados++;
      const p = { id, status: 'pending', transaction_amount: b.transaction_amount, currency_id: 'BRL', external_reference: b.external_reference, payment_method_id: b.payment_method_id, date_approved: null, notification_url: b.notification_url, payer: b.payer };
      fakeMP.pag.set(String(id), p);
      return j(201, { ...p, point_of_interaction: { transaction_data: { qr_code: '00020126PIXFALSO' + id, qr_code_base64: PNG.split(',')[1] } } });
    }
    const p = fakeMP.pag.get(m[1]); if (!p) return j(404, { message: 'não existe' });
    if (req.method === 'GET') return j(200, p);
    if (req.method === 'PUT') { Object.assign(p, JSON.parse(corpo || '{}')); return j(200, p); }
    j(405, {});
  });
});
const fakeAprovar = (id, extra) => Object.assign(fakeMP.pag.get(String(id)), { status: 'approved', date_approved: new Date().toISOString() }, extra || {});
function webhookMP(id, { assinar = true, reqId = 'req-' + crypto.randomUUID(), ts = String(Date.now()), segredo = MP_SEGREDO } = {}) {
  const headers = { 'Content-Type': 'application/json', 'x-request-id': reqId };
  if (assinar) headers['x-signature'] = `ts=${ts},v1=` + crypto.createHmac('sha256', segredo).update(`id:${id};request-id:${reqId};ts:${ts};`).digest('hex');
  return fetch(`${base}/api/webhooks/mercadopago?data.id=${id}&type=payment`, { method: 'POST', headers, body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: String(id) } }) });
}

(async () => {
  await new Promise((r) => servidor.listen(0, r));
  await new Promise((r) => mpServidor.listen(0, r));
  process.env.MP_API_BASE = 'http://127.0.0.1:' + mpServidor.address().port;
  process.env.MP_ACCESS_TOKEN = 'TEST-token-de-teste'; process.env.MP_WEBHOOK_SECRET = MP_SEGREDO;
  base = 'http://127.0.0.1:' + servidor.address().port;
  const A = new Cliente(), B = new Cliente(), anon = new Cliente();
  console.log('AGENDA X — testes');

  await t('páginas estáticas e cabeçalhos de segurança', async () => {
    const r = await anon.get('/'); assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-security-policy'));
    assert.equal((await anon.get('/app')).status, 200);
    assert.equal((await anon.get('/../server.js')).status, 404);
    assert.equal((await anon.get('/uploads/../../server.js')).status, 404);
  });

  await t('PWA e página de vendas: manifest, service worker, ícones e planos públicos', async () => {
    const m = await anon.get('/manifest.webmanifest'); assert.equal(m.status, 200); assert.equal(m.d.short_name, 'AGENDA X'); assert.equal(m.d.display, 'standalone');
    assert.equal((await anon.get('/sw.js')).status, 200);
    for (const i of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) assert.equal((await fetch(base + '/icons/' + i)).status, 200);
    const pl = await anon.get('/api/planos'); assert.equal(pl.status, 200);
    assert.deepEqual(pl.d.planos.map((p) => p.id), ['gratis', 'basico', 'profissional', 'premium']); assert.equal(pl.d.trial_dias, 14);
    const home = await anon.get('/'); assert.match(home.d, /manifest\.webmanifest/); assert.match(home.d, /Perguntas frequentes/);
  });

  await t('API protegida exige login', async () => {
    assert.equal((await anon.get('/api/clientes')).status, 401);
    assert.equal((await anon.get('/api/dashboard')).status, 401);
  });

  await t('cadastro valida dados e cria sessão (cookie HttpOnly)', async () => {
    assert.equal((await anon.post('/api/auth/register', { nome_estabelecimento: 'X', nome: 'A', email: 'ruim', senha: '12345678' })).status, 400);
    assert.equal((await anon.post('/api/auth/register', { nome_estabelecimento: 'X', nome: 'A', email: 'a@a.com', senha: '123' })).status, 400);
    const r = await A.post('/api/auth/register', { nome_estabelecimento: 'Barbearia Alfa', nome: 'Alfa', email: 'alfa@teste.com', senha: 'senha-forte-1', plano: 'premium' });
    assert.equal(r.status, 201);
    assert.match(r.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await anon.post('/api/auth/register', { nome_estabelecimento: 'Y', nome: 'A', email: 'ALFA@teste.com', senha: 'senha-forte-1' })).status, 409);
    const me = await A.get('/api/me');
    assert.equal(me.d.assinatura.status, 'trial');
    assert.equal(me.d.assinatura.dias_restantes, 14);
    assert.equal(me.d.estabelecimento.slug, 'barbearia-alfa');
  });

  await t('primeiros passos do painel avançam conforme o uso', async () => {
    const d0 = (await A.get('/api/dashboard')).d.primeiros_passos;
    assert.deepEqual(d0.map((p) => p.id), ['conta', 'servicos', 'profissional', 'link', 'agendamento']);
    assert.equal(d0.find((p) => p.id === 'conta').feito, true);
    assert.equal(d0.find((p) => p.id === 'servicos').feito, false);
    assert.equal(d0.find((p) => p.id === 'agendamento').feito, false);
  });

  await t('senha é guardada com hash (nunca em texto puro)', async () => {
    const u = db.prepare('SELECT senha_hash FROM usuarios WHERE email = ?').get('alfa@teste.com');
    assert.ok(!u.senha_hash.includes('senha-forte-1'));
    assert.ok(u.senha_hash.includes(':'));
  });

  await t('login correto e incorreto', async () => {
    const C = new Cliente();
    assert.equal((await C.post('/api/auth/login', { email: 'alfa@teste.com', senha: 'errada123' })).status, 401);
    assert.equal((await C.post('/api/auth/login', { email: 'alfa@teste.com', senha: 'senha-forte-1' })).status, 200);
    assert.equal((await C.get('/api/me')).status, 200);
    await C.post('/api/auth/logout');
    C.cookie = '';
  });

  let servId, profId, cliId;
  await t('serviço com foto, descrição, preço e duração', async () => {
    const profs = (await A.get('/api/profissionais')).d; profId = profs[0].id;
    assert.equal((await A.post('/api/servicos', { nome: 'Corte', preco: 'abc', duracao_min: 30 })).status, 400);
    assert.equal((await A.post('/api/servicos', { nome: 'Corte', preco: 40, duracao_min: 30, foto: 'data:image/png;base64,AAAA' })).status, 400, 'foto falsa deve ser rejeitada');
    const r = await A.post('/api/servicos', { nome: 'Corte masculino', descricao: 'Tesoura e máquina', preco: 45, duracao_min: 45, foto: PNG, profissionais: [profId] });
    assert.equal(r.status, 201); servId = r.d.id;
    assert.match(r.d.foto, /^\/uploads\/\d+\/[a-f0-9]+\.png$/);
    const img = await fetch(base + r.d.foto); assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  });

  await t('clientes: criar, buscar, validar', async () => {
    assert.equal((await A.post('/api/clientes', { nome: '' })).status, 400);
    const r = await A.post('/api/clientes', { nome: 'João Silva', telefone: '(85) 99999-1111' });
    assert.equal(r.status, 201); cliId = r.d.id;
    assert.equal((await A.get('/api/clientes?q=jo%C3%A3o')).d.length, 1);
  });

  const data = diaUtil();
  let agId;
  await t('agenda: criar agendamento e bloquear conflito', async () => {
    const r = await A.post('/api/agendamentos', { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '10:00' });
    assert.equal(r.status, 201); agId = r.d.id;
    assert.equal(r.d.fim.slice(11), '10:45');
    const c1 = await A.post('/api/agendamentos', { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '10:30' });
    assert.equal(c1.status, 409, 'sobreposição deve ser barrada');
    const c2 = await A.post('/api/agendamentos', { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '09:30' });
    assert.equal(c2.status, 409, 'termina após início do outro');
    const ok = await A.post('/api/agendamentos', { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '10:45' });
    assert.equal(ok.status, 201, 'horário encostado é permitido');
    await A.post(`/api/agendamentos/${ok.d.id}/cancelar`);
  });

  await t('editar agendamento ignora o próprio horário no conflito', async () => {
    const r = await A.put(`/api/agendamentos/${agId}`, { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '10:15', observacoes: 'remarcado' });
    assert.equal(r.status, 200); assert.equal(r.d.inicio.slice(11), '10:15');
    await A.put(`/api/agendamentos/${agId}`, { cliente_id: cliId, profissional_id: profId, servico_id: servId, data, hora: '10:00' });
  });

  await t('página pública lista serviços com foto e só horários livres', async () => {
    const r = await anon.get('/api/public/barbearia-alfa');
    assert.equal(r.status, 200);
    assert.equal(r.d.servicos[0].nome, 'Corte masculino');
    assert.ok(r.d.servicos[0].foto);
    assert.ok(!JSON.stringify(r.d).includes('senha_hash') && !JSON.stringify(r.d).includes('email'), 'sem vazamento');
    const h = await anon.get(`/api/public/barbearia-alfa/horarios?servico_id=${servId}&data=${data}`);
    const horas = h.d.slots.map((s) => s.hora);
    assert.ok(horas.length > 3);
    assert.ok(!horas.includes('10:00') && !horas.includes('10:30'), 'horário ocupado não aparece');
    assert.ok(horas.includes('09:00'));
  });

  let codigo;
  await t('agendamento online cria cliente, gera código e notifica', async () => {
    const r = await anon.post('/api/public/barbearia-alfa/agendar', { servico_id: servId, data, hora: '14:00', nome: 'Maria', telefone: '(85) 98888-2222' });
    assert.equal(r.status, 201); codigo = r.d.agendamento.codigo;
    const dup = await anon.post('/api/public/barbearia-alfa/agendar', { servico_id: servId, data, hora: '14:00', nome: 'Pedro', telefone: '(85) 97777-3333' });
    assert.equal(dup.status, 409, 'dupla reserva barrada');
    assert.equal((await anon.post('/api/public/barbearia-alfa/agendar', { servico_id: servId, data, hora: '14:30', nome: 'Z', telefone: '123' })).status, 400);
    const n = (await A.get('/api/notificacoes')).d;
    assert.ok(n.itens.some((i) => i.tipo === 'agendamento'));
    assert.ok(n.nao_lidas >= 1);
    assert.equal((await A.post('/api/notificacoes/ler-todas')).status, 200);
    assert.equal((await A.get('/api/notificacoes')).d.nao_lidas, 0);
  });

  await t('cliente cancela pelo código e libera o horário', async () => {
    assert.equal((await anon.get(`/api/public/barbearia-alfa/agendamento/${codigo}`)).d.status, 'agendado');
    assert.equal((await anon.post('/api/public/barbearia-alfa/cancelar', { codigo })).status, 200);
    const h = await anon.get(`/api/public/barbearia-alfa/horarios?servico_id=${servId}&data=${data}`);
    assert.ok(h.d.slots.some((s) => s.hora === '14:00'));
    assert.ok((await A.get('/api/notificacoes')).d.itens.some((i) => i.tipo === 'cancelamento'));
  });

  await t('concluir gera receita e comissão parametrizada', async () => {
    assert.equal((await A.put(`/api/profissionais/${profId}/comissao`, { comissao_percent: 40 })).status, 200);
    const r = await A.post(`/api/agendamentos/${agId}/concluir`, {});
    assert.equal(r.status, 200); assert.equal(r.d.status, 'concluido'); assert.equal(r.d.comissao_valor, 18);
    const lanc = (await A.get(`/api/lancamentos?de=${data}&ate=${data}`)).d;
    assert.equal(lanc.length, 1); assert.equal(lanc[0].valor, 45);
    const com = (await A.get(`/api/comissoes?de=${data}&ate=${data}`)).d;
    assert.equal(com.total_comissoes, 18);
    assert.equal((await A.post(`/api/agendamentos/${agId}/concluir`, {})).status, 400, 'não conclui duas vezes');
    assert.equal((await A.get(`/api/clientes/${cliId}`)).d.historico.length >= 1, true);
  });

  await t('financeiro: despesa e resumo', async () => {
    assert.equal((await A.post('/api/lancamentos', { tipo: 'despesa', descricao: 'Aluguel', valor: 15, data })).status, 201);
    const r = (await A.get(`/api/financeiro/resumo?de=${data}&ate=${data}`)).d;
    assert.equal(r.receitas, 45); assert.equal(r.despesas, 15); assert.equal(r.saldo, 30);
  });

  await t('relatórios e painel', async () => {
    const r = await A.get(`/api/relatorios?de=${data}&ate=${data}`);
    assert.equal(r.status, 200); assert.equal(r.d.faturamento_total, 45);
    assert.equal((await A.get('/api/dashboard')).status, 200);
    const csv = await A.get(`/api/relatorios/export.csv?de=${data}&ate=${data}`);
    assert.equal(csv.status, 200); assert.match(csv.d, /Corte masculino/);
  });

  await t('isolamento entre estabelecimentos', async () => {
    await B.post('/api/auth/register', { nome_estabelecimento: 'Salão Beta', nome: 'Beta', email: 'beta@teste.com', senha: 'senha-forte-2', plano: 'basico' });
    assert.equal((await B.get('/api/clientes')).d.length, 0);
    assert.equal((await B.get('/api/servicos')).d.length, 0);
    assert.equal((await B.get(`/api/clientes/${cliId}`)).status, 404);
    assert.equal((await B.put(`/api/clientes/${cliId}`, { nome: 'Hack' })).status, 404);
    assert.equal((await B.del(`/api/servicos/${servId}`)).status, 404);
    assert.equal((await B.post(`/api/agendamentos/${agId}/cancelar`)).status, 404);
    const bp = (await B.get('/api/profissionais')).d[0];
    const x = await B.post('/api/agendamentos', { cliente_id: cliId, profissional_id: bp.id, servico_id: servId, data, hora: '11:00' });
    assert.ok([404, 400].includes(x.status), 'não agenda com cliente/serviço de outro estabelecimento');
    assert.equal((await anon.get('/api/public/salao-beta')).d.servicos.length, 0);
  });

  await t('teste de 14 dias libera tudo (mesmo escolhendo o plano Básico)', async () => {
    const me = (await B.get('/api/me')).d;
    assert.equal(me.assinatura.status, 'trial'); assert.equal(me.assinatura.plano.id, 'premium');
    assert.equal(me.assinatura.plano_escolhido.id, 'basico');
    assert.equal((await B.get('/api/relatorios')).status, 200);
    assert.equal((await B.get('/api/comissoes')).status, 200);
    assert.equal((await B.get('/api/financeiro/resumo')).status, 200);
    assert.equal((await B.post('/api/profissionais', { nome: 'Segundo' })).status, 201);
  });

  await t('plano Básico pago: sem relatórios/comissões/CSV e 1 profissional', async () => {
    db.prepare("UPDATE estabelecimentos SET assinatura_status = 'ativa', plano = 'basico' WHERE slug = 'salao-beta'").run();
    db.prepare("UPDATE profissionais SET ativo = 0 WHERE id != (SELECT MIN(id) FROM profissionais WHERE estabelecimento_id = (SELECT id FROM estabelecimentos WHERE slug = 'salao-beta')) AND estabelecimento_id = (SELECT id FROM estabelecimentos WHERE slug = 'salao-beta')").run();
    const r1 = await B.get('/api/relatorios'); assert.equal(r1.status, 403); assert.ok(r1.d.upgrade);
    assert.equal((await B.get('/api/comissoes')).status, 403);
    assert.equal((await B.get('/api/relatorios/export.csv')).status, 403);
    assert.equal((await B.get('/api/financeiro/resumo')).status, 200, 'financeiro é do Básico');
    assert.equal((await B.post('/api/profissionais', { nome: 'Terceiro' })).status, 403, 'limite de profissionais do plano');
    assert.equal((await A.post('/api/profissionais', { nome: 'Segundo' })).status, 201, 'premium permite mais');
  });

  await t('fim do teste: cai no plano Grátis (não bloqueia), com limites', async () => {
    db.prepare("UPDATE estabelecimentos SET trial_ate = '2000-01-01', assinatura_status = 'trial' WHERE slug = 'salao-beta'").run();
    const me = (await B.get('/api/me')).d;
    assert.equal(me.assinatura.status, 'gratis'); assert.equal(me.assinatura.plano.id, 'gratis');
    assert.equal((await B.post('/api/clientes', { nome: 'Novo 1' })).status, 201, 'continua escrevendo');
    const f = await B.get('/api/financeiro/resumo'); assert.equal(f.status, 403); assert.ok(f.d.upgrade);
    assert.equal((await B.get('/api/relatorios')).status, 403);
    assert.equal((await B.post('/api/config/logo', { imagem: PNG })).status, 403, 'logo não é do Grátis');
    for (let i = 1; i <= 5; i++) assert.equal((await B.post('/api/servicos', { nome: 'S' + i, preco: 10, duracao_min: 30 })).status, 201);
    const s6 = await B.post('/api/servicos', { nome: 'S6', preco: 10, duracao_min: 30 });
    assert.equal(s6.status, 403, 'máx. 5 serviços no Grátis'); assert.ok(s6.d.upgrade);
    assert.equal((await anon.get('/api/public/salao-beta')).status, 200, 'página pública segue no ar');
    assert.ok((await B.get('/api/notificacoes')).d.itens.some((i) => i.titulo.includes('plano Grátis')));
  });

  await t('Grátis: limite de clientes e de agendamentos por mês', async () => {
    const eid = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'salao-beta'").get().id;
    for (let i = 0; i < 60; i++) db.prepare('INSERT INTO clientes (estabelecimento_id, nome) VALUES (?,?)').run(eid, 'Fake ' + i);
    const c = await B.post('/api/clientes', { nome: 'Passou' });
    assert.equal(c.status, 403); assert.match(c.d.erro, /50 cliente/);
    const prof = db.prepare('SELECT id FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1').get(eid).id;
    const sv = db.prepare('SELECT id FROM servicos WHERE estabelecimento_id = ? LIMIT 1').get(eid).id;
    const cli = db.prepare('SELECT id FROM clientes WHERE estabelecimento_id = ? LIMIT 1').get(eid).id;
    const mes = data.slice(0, 7);
    for (let i = 0; i < 30; i++) db.prepare("INSERT INTO agendamentos (estabelecimento_id, cliente_id, profissional_id, servico_id, inicio, fim, preco) VALUES (?,?,?,?,?,?,0)").run(eid, cli, prof, sv, `${mes}-28 08:${String(i).padStart(2, '0')}`, `${mes}-28 08:${String(i).padStart(2, '0')}`);
    db.prepare("DELETE FROM profissional_servicos WHERE servico_id = ?").run(sv);
    db.prepare("INSERT INTO profissional_servicos VALUES (?,?)").run(prof, sv);
    const ag = await B.post('/api/agendamentos', { cliente_id: cli, profissional_id: prof, servico_id: sv, data: diaUtil(), hora: '10:00' });
    if (diaUtil().slice(0, 7) === mes) { assert.equal(ag.status, 403); assert.match(ag.d.erro, /30 agendamentos/); }
  });

  await t('assinatura por Pix: valor do servidor, só ativa com pagamento aprovado e webhook assinado', async () => {
    assert.equal((await B.post('/api/assinatura', { plano: 'gratis', ativar: true })).status, 400);
    assert.equal((await B.post('/api/assinatura', { plano: 'basico', ativar: true })).status, 400, 'ativar sem pagar é recusado');
    assert.equal((await B.post('/api/assinatura/pix', { plano: 'gratis' })).status, 400);
    // o navegador tenta impor um valor: ignorado, vale o preço do plano no servidor
    const r = await B.post('/api/assinatura/pix', { plano: 'basico', valor: 0.01, preco: 1 });
    assert.equal(r.status, 201); assert.equal(r.d.valor, 20); assert.equal(r.d.status, 'pendente');
    assert.ok(r.d.qr_code.startsWith('00020126PIXFALSO') && r.d.qr_base64, 'QR Code e Copia e Cola');
    const prov = fakeMP.pag.get(String(fakeMP.seq)); assert.equal(prov.transaction_amount, 20); assert.equal(prov.payment_method_id, 'pix');
    const pid = r.d.id, provId = r.d.transacao;
    assert.equal((await B.get('/api/me')).d.assinatura.status, 'gratis', 'pendente não libera nada');
    assert.equal((await B.get('/api/assinatura')).d.pendente.id, pid);
    // webhook falso / sem assinatura / assinatura com outro segredo: recusado e nada muda
    assert.equal((await webhookMP(provId, { assinar: false })).status, 401);
    assert.equal((await webhookMP(provId, { segredo: 'outro-segredo' })).status, 401);
    fakeAprovar(provId); // o provedor aprova...
    assert.equal((await B.get('/api/me')).d.assinatura.status, 'gratis', 'sem webhook válido, nada muda');
    // webhook assinado: confirma consultando o provedor
    const w = await webhookMP(provId); assert.equal(w.status, 200);
    const me = (await B.get('/api/me')).d;
    assert.equal(me.assinatura.status, 'ativa'); assert.equal(me.assinatura.plano.id, 'basico');
    const ate = L.addDias(L.hojeLocal('America/Fortaleza'), 30); assert.equal(me.assinatura.assinatura_ate, ate);
    const pg = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pid);
    assert.equal(pg.status, 'aprovado'); assert.equal(pg.validade_ate, ate); assert.ok(pg.pago_em); assert.equal(pg.provedor_id, provId); assert.equal(pg.valor, 20);
    // notificação duplicada: não ativa de novo nem estende
    assert.equal((await webhookMP(provId)).status, 200); assert.equal((await webhookMP(provId)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE titulo LIKE 'Pagamento confirmado%' AND estabelecimento_id = ?").get(pg.estabelecimento_id).n, 1);
    assert.equal((await B.get('/api/me')).d.assinatura.assinatura_ate, ate);
    assert.equal((await B.post('/api/servicos', { nome: 'S6', preco: 10, duracao_min: 30 })).status, 201);
    assert.equal((await B.get('/api/financeiro/resumo')).status, 200);
    assert.equal((await B.post('/api/assinatura/cancelar')).status, 200);
    assert.equal((await B.get('/api/me')).d.assinatura.plano.id, 'gratis');
  });

  await t('planos: 5 / 10 / 20 funções e Profissional a R$37,90', async () => {
    const P = (await B.get('/api/assinatura')).d.planos; const g = (id) => P.find((p) => p.id === id);
    assert.equal(g('basico').total_funcoes, 5); assert.equal(g('profissional').total_funcoes, 15); assert.equal(g('premium').total_funcoes, 35);
    assert.equal(g('profissional').preco, 37.9); assert.equal(g('gratis').total_funcoes, 0);
    const extras = (id) => g(id).recursos.filter((r) => !['agenda', 'clientes', 'servicos', 'pagina_publica'].includes(r)).length;
    assert.equal(extras('basico'), 5); assert.equal(extras('profissional'), 15); assert.equal(extras('premium'), 35);
    assert.equal(g('basico').funcoes.length, 5); assert.equal(g('profissional').funcoes.length, 10); assert.equal(g('premium').funcoes.length, 20);
  });

  await t('funções por plano: Básico sem foto de profissional/intervalo; Profissional sem CSV de clientes e relatórios premium', async () => {
    const eidB = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'salao-beta'").get().id;
    db.prepare("UPDATE estabelecimentos SET assinatura_status = 'ativa', plano = 'basico' WHERE id = ?").run(eidB);
    const pid = db.prepare('SELECT id FROM profissionais WHERE estabelecimento_id = ? LIMIT 1').get(eidB).id;
    assert.equal((await B.put(`/api/profissionais/${pid}`, { nome: 'X', foto: PNG })).status, 403, 'foto de profissional = Profissional+');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 15 })).status, 403, 'intervalo = Profissional+');
    assert.equal((await B.post('/api/lancamentos', { tipo: 'despesa', descricao: 'x', valor: 1, categoria: 'Aluguel' })).status, 403, 'categorias = Premium');
    assert.equal((await B.post('/api/lancamentos', { tipo: 'despesa', descricao: 'x', valor: 1 })).status, 201);
    assert.equal((await B.get('/api/export/clientes.csv')).status, 403);
    assert.equal((await B.get('/api/export/financeiro.csv')).status, 403);
    db.prepare("UPDATE estabelecimentos SET plano = 'profissional' WHERE id = ?").run(eidB);
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 15 })).status, 200);
    const rel = (await B.get(`/api/relatorios`)).d;
    assert.equal(rel.liberado.rel_servicos, false); assert.equal(rel.ticket_medio, null); assert.deepEqual(rel.clientes_top, []);
    assert.equal((await B.get('/api/export/clientes.csv')).status, 403);
    db.prepare("UPDATE estabelecimentos SET plano = 'premium' WHERE id = ?").run(eidB);
    assert.equal((await B.get('/api/export/clientes.csv')).status, 200);
    assert.equal((await B.get('/api/export/financeiro.csv')).status, 200);
    assert.equal((await B.get('/api/relatorios')).d.liberado.rel_ticket, true);
    assert.equal((await B.post('/api/lancamentos', { tipo: 'despesa', descricao: 'y', valor: 1, categoria: 'Aluguel' })).status, 201);
  });

  await t('novas funções: Básico bloqueia editar/valor/observações/falta; Profissional libera; Premium libera o resto', async () => {
    const eidB = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'salao-beta'").get().id;
    db.prepare("UPDATE estabelecimentos SET assinatura_status = 'ativa', plano = 'basico' WHERE id = ?").run(eidB);
    const prof = db.prepare('SELECT id FROM profissionais WHERE estabelecimento_id = ? AND ativo = 1').get(eidB).id;
    const sv = db.prepare('SELECT id, preco FROM servicos WHERE estabelecimento_id = ? LIMIT 1').get(eidB);
    db.prepare('INSERT OR IGNORE INTO profissional_servicos VALUES (?,?)').run(prof, sv.id);
    const cli = db.prepare('SELECT id FROM clientes WHERE estabelecimento_id = ? LIMIT 1').get(eidB).id;
    db.prepare('DELETE FROM agendamentos WHERE estabelecimento_id = ?').run(eidB);
    const dia = diaUtil();
    const base = { cliente_id: cli, profissional_id: prof, servico_id: sv.id, data: dia, hora: '09:00' };
    assert.equal((await B.post('/api/agendamentos', { ...base, preco: sv.preco + 7 })).status, 403, 'valor personalizado');
    assert.equal((await B.post('/api/agendamentos', { ...base, observacoes: 'oi' })).status, 403, 'observações do agendamento');
    const ok = await B.post('/api/agendamentos', base); assert.equal(ok.status, 201);
    assert.equal((await B.put(`/api/agendamentos/${ok.d.id}`, { ...base, hora: '10:00' })).status, 403, 'remarcar');
    assert.equal((await B.post(`/api/agendamentos/${ok.d.id}/faltou`)).status, 403, 'marcar falta');
    assert.equal((await B.post('/api/clientes', { nome: 'Com nota', observacoes: 'vip' })).status, 403, 'observação de cliente');
    assert.equal((await B.post('/api/lancamentos', { tipo: 'receita', descricao: 'avulsa', valor: 5 })).status, 403, 'receita avulsa');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'novo-endereco', intervalo_slots: 30 })).status, 403, 'link personalizado');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 30, fuso: 'America/Sao_Paulo' })).status, 403, 'fuso');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 30, descricao: 'Texto' })).status, 403, 'página personalizada');
    const pr = (await B.get('/api/profissionais')).d.find((x) => x.id === prof);
    const h = JSON.parse(JSON.stringify(pr.horarios)); h[1].inicio = '10:00';
    assert.equal((await B.put(`/api/profissionais/${prof}`, { ...pr, horarios: h })).status, 403, 'horários do profissional');
    assert.equal((await B.put(`/api/profissionais/${prof}`, { ...pr, cor: '#112233' })).status, 403, 'cor');
    assert.equal((await B.get('/api/dashboard')).d.graficos_liberados, false);
    assert.equal((await B.get('/api/notificacoes')).d.itens.length <= 8, true);
    // Profissional libera as de nível 2
    db.prepare("UPDATE estabelecimentos SET plano = 'profissional' WHERE id = ?").run(eidB);
    assert.equal((await B.put(`/api/agendamentos/${ok.d.id}`, { ...base, hora: '10:00' })).status, 200, 'remarcar liberado');
    assert.equal((await B.post('/api/agendamentos', { ...base, hora: '15:00', preco: sv.preco + 7 })).status, 201, 'valor liberado');
    assert.equal((await B.post('/api/clientes', { nome: 'Com nota', observacoes: 'vip' })).status, 201, 'obs cliente liberada');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 30, descricao: 'Texto' })).status, 200);
    assert.equal((await B.post(`/api/agendamentos/${ok.d.id}/faltou`)).status, 403, 'falta ainda é Premium');
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'novo-endereco', intervalo_slots: 30, descricao: 'Texto' })).status, 403, 'link ainda é Premium');
    // Premium libera tudo
    db.prepare("UPDATE estabelecimentos SET plano = 'premium' WHERE id = ?").run(eidB);
    assert.equal((await B.post(`/api/agendamentos/${ok.d.id}/faltou`)).status, 200);
    assert.equal((await B.post('/api/lancamentos', { tipo: 'receita', descricao: 'avulsa', valor: 5 })).status, 201);
    assert.equal((await B.get('/api/dashboard')).d.graficos_liberados, true);
    assert.equal((await B.put('/api/config', { nome: 'Salão Beta', slug: 'novo-endereco', intervalo_slots: 30, descricao: 'Texto' })).status, 200);
    await B.put('/api/config', { nome: 'Salão Beta', slug: 'salao-beta', intervalo_slots: 30, descricao: 'Texto' });
  });

  await t('janela da agenda online: 14 dias fora do Premium, 60 no Premium', async () => {
    const eidB = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'salao-beta'").get().id;
    db.prepare("UPDATE estabelecimentos SET plano = 'profissional', assinatura_status = 'ativa' WHERE id = ?").run(eidB);
    const hoje = (await anon.get('/api/public/salao-beta')).d.hoje;
    let r = (await anon.get('/api/public/salao-beta')).d; assert.equal(r.max_data, L.addDias(hoje, 14)); assert.equal(r.observacoes_online, false);
    db.prepare("UPDATE estabelecimentos SET plano = 'premium' WHERE id = ?").run(eidB);
    r = (await anon.get('/api/public/salao-beta')).d; assert.equal(r.max_data, L.addDias(hoje, 60)); assert.equal(r.observacoes_online, true);
  });

  await t('página pública respeita as funções do plano', async () => {
    const eidB = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'salao-beta'").get().id;
    db.prepare("UPDATE estabelecimentos SET plano = 'basico' WHERE id = ?").run(eidB);
    let r = (await anon.get('/api/public/salao-beta')).d;
    assert.equal(r.escolher_profissional, false); assert.equal(r.cancelamento_online, true);
    db.prepare("UPDATE estabelecimentos SET plano = 'premium', assinatura_status = 'cancelada' WHERE id = ?").run(eidB);
    r = (await anon.get('/api/public/salao-beta')).d;
    assert.equal(r.cancelamento_online, false, 'Grátis não tem cancelamento online');
    assert.equal((await anon.post('/api/public/salao-beta/cancelar', { codigo: 'ABCDEF1234' })).status, 403);
  });

  await t('conta dona (ADMIN_EMAILS): Premium ativo, sem expirar', async () => {
    const O = new Cliente();
    await O.post('/api/auth/admin', { email: 'dono@teste.com', senha: 'senha-forte-3' });
    const me = (await O.get('/api/me')).d;
    assert.equal(me.assinatura.status, 'ativa'); assert.equal(me.assinatura.plano.id, 'premium');
    assert.equal((await O.get('/api/relatorios')).status, 200);
    db.prepare("UPDATE estabelecimentos SET trial_ate='2000-01-01', assinatura_status='trial', plano='basico' WHERE id=(SELECT estabelecimento_id FROM usuarios WHERE email='dono@teste.com')").run();
    await O.post('/api/auth/login', { email: 'dono@teste.com', senha: 'senha-forte-3' });
    assert.equal((await O.get('/api/me')).d.assinatura.status, 'ativa');
  });

  await t('slug de configuração único e validado', async () => {
    assert.equal((await A.put('/api/config', { nome: 'Alfa', slug: 'salao-beta', intervalo_slots: 30 })).status, 409);
    assert.equal((await A.put('/api/config', { nome: 'Alfa', slug: 'Slug Ruim!', intervalo_slots: 30 })).status, 400);
  });

  await t('troca de senha e rejeita JSON malformado', async () => {
    assert.equal((await A.put('/api/me/senha', { atual: 'x', nova: 'novasenha123' })).status, 400);
    assert.equal((await A.put('/api/me/senha', { atual: 'senha-forte-1', nova: 'novasenha123' })).status, 200);
    const r = await fetch(base + '/api/clientes', { method: 'POST', headers: { cookie: A.cookie, 'Content-Type': 'application/json' }, body: '{ruim' });
    assert.equal(r.status, 400);
  });

  await t('push: criptografia RFC 8291 e assinatura VAPID', async () => {
    const crypto = require('crypto'); const PUSH = require('./push');
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16).toString('base64url');
    const corpo = PUSH.criptografar('{"titulo":"Olá 🔔"}', ua.getPublicKey().toString('base64url'), auth);
    assert.equal(PUSH.descriptografar(corpo, ua, auth), '{"titulo":"Olá 🔔"}');
    const ch = PUSH.carregarChaves(tmp); const jwt = PUSH.jwtVapid(ch, 'https://fcm.googleapis.com/fcm/send/abc');
    const [h, p, s] = jwt.split('.');
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(ch.publica, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(ch.publica, 'base64url').subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');
  });

  await t('tempo real: agendamento online chega por SSE na hora e rotas push', async () => {
    assert.equal((await anon.get('/api/push/chave')).status, 401);
    assert.ok((await A.get('/api/push/chave')).d.chave.length > 80);
    assert.equal((await A.post('/api/push/assinar', { subscription: { endpoint: 'http://x', keys: {} } })).status, 400);
    assert.equal((await A.post('/api/push/assinar', { subscription: { endpoint: 'https://push.invalid/abc', keys: { p256dh: 'x', auth: 'y' } } })).status, 200);
    assert.equal((await anon.get('/api/eventos')).status, 401);
    const ac = new AbortController();
    const r = await fetch(base + '/api/eventos', { headers: { cookie: A.cookie }, signal: ac.signal });
    assert.equal(r.status, 200); assert.ok(String(r.headers.get('content-type')).includes('text/event-stream'));
    const leitor = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const espera = (async () => { while (!buf.includes('Teste de alerta')) { const { value, done } = await leitor.read(); if (done) break; buf += dec.decode(value); } return buf; })();
    await A.post('/api/push/testar', {});
    const txt = await Promise.race([espera, new Promise((_, rj) => setTimeout(() => rj(new Error('sem evento')), 3000))]).catch((e) => e.message);
    ac.abort();
    assert.ok(String(txt).includes('Teste de alerta') || String(txt).includes('"info"'), String(txt));
  });

  await t('pagamentos: desligado, divergências, fraudes, expiração, renovação e isolamento', async () => {
    const X = new Cliente();
    await X.post('/api/auth/register', { nome_estabelecimento: 'Pagto Teste', nome: 'P', email: 'pagto@teste.com', senha: 'senha-forte-9' });
    const estX = db.prepare("SELECT id FROM estabelecimentos WHERE slug = 'pagto-teste'").get().id;
    const sit = async () => (await X.get('/api/me')).d.assinatura;
    // sem credenciais no servidor: não cobra e não ativa nada
    const tokenOk = process.env.MP_ACCESS_TOKEN; process.env.MP_ACCESS_TOKEN = '';
    assert.equal((await X.post('/api/assinatura/pix', { plano: 'premium' })).status, 501);
    assert.equal((await X.get('/api/assinatura')).d.pagamento.disponivel, false);
    assert.equal((await webhookMP(1)).status, 503);
    process.env.MP_ACCESS_TOKEN = tokenOk;
    assert.equal((await X.post('/api/assinatura', { plano: 'basico' })).status, 200); // só registra a escolha
    assert.equal((await sit()).status, 'trial');
    // valor divergente aprovado pelo provedor: NÃO ativa
    const p1 = (await X.post('/api/assinatura/pix', { plano: 'premium' })).d; assert.equal(p1.valor, 59.9);
    fakeAprovar(p1.transacao, { transaction_amount: 1 });
    await webhookMP(p1.transacao);
    assert.equal(db.prepare('SELECT status FROM pagamentos WHERE id = ?').get(p1.id).status, 'divergente');
    assert.equal(db.prepare('SELECT assinatura_status s FROM estabelecimentos WHERE id = ?').get(estX).s, 'trial');
    // referência trocada (pagamento de outra conta/cobrança): NÃO ativa
    const p2 = (await X.post('/api/assinatura/pix', { plano: 'profissional' })).d; assert.equal(p2.valor, 37.9);
    fakeAprovar(p2.transacao, { external_reference: 'ax-999-outra' });
    await webhookMP(p2.transacao);
    assert.equal(db.prepare('SELECT status FROM pagamentos WHERE id = ?').get(p2.id).status, 'divergente');
    // método diferente de Pix: NÃO ativa
    const p3 = (await X.post('/api/assinatura/pix', { plano: 'profissional' })).d;
    fakeAprovar(p3.transacao, { payment_method_id: 'visa' });
    await webhookMP(p3.transacao);
    assert.equal((await sit()).status, 'trial');
    // id desconhecido no webhook assinado: ignorado
    assert.equal((await webhookMP(987654321)).status, 200);
    // cobrança pendente é reaproveitada; trocar de plano cancela a anterior no provedor
    const p4 = (await X.post('/api/assinatura/pix', { plano: 'basico' })).d;
    const criados = fakeMP.criados;
    assert.equal((await X.post('/api/assinatura/pix', { plano: 'basico' })).d.id, p4.id); assert.equal(fakeMP.criados, criados);
    const p5 = (await X.post('/api/assinatura/pix', { plano: 'premium' })).d; assert.notEqual(p5.id, p4.id);
    assert.equal(fakeMP.pag.get(p4.transacao).status, 'cancelled'); assert.equal(db.prepare('SELECT status FROM pagamentos WHERE id = ?').get(p4.id).status, 'cancelado');
    // outro estabelecimento não enxerga nem cancela a cobrança
    assert.equal((await B.get('/api/assinatura/pagamento/' + p5.id)).status, 404);
    assert.equal((await B.post('/api/assinatura/pagamento/' + p5.id + '/cancelar')).status, 404);
    assert.ok(!JSON.stringify((await B.get('/api/assinatura')).d).includes(p5.transacao));
    // sem webhook: a consulta da tela confirma direto no provedor (estado oficial)
    assert.equal((await X.get('/api/assinatura/pagamento/' + p5.id)).d.status, 'pendente');
    fakeAprovar(p5.transacao);
    db.prepare('UPDATE pagamentos SET verificado_em = 0 WHERE id = ?').run(p5.id);
    assert.equal((await X.get('/api/assinatura/pagamento/' + p5.id)).d.status, 'aprovado');
    const s1 = await sit(); assert.equal(s1.status, 'ativa'); assert.equal(s1.plano.id, 'premium'); assert.equal(s1.dias_restantes, 30);
    // renovar o mesmo plano soma 30 dias ao fim da validade atual
    const p6 = (await X.post('/api/assinatura/pix', { plano: 'premium' })).d; fakeAprovar(p6.transacao); await Promise.all([webhookMP(p6.transacao), webhookMP(p6.transacao), webhookMP(p6.transacao)]); // simultâneos
    assert.equal((await sit()).dias_restantes, 60);
    // vencida: volta ao plano limitado, dados preservados
    db.prepare("UPDATE estabelecimentos SET assinatura_ate = ? WHERE id = ?").run(L.addDias(L.hojeLocal('America/Fortaleza'), -1), estX);
    const v = await sit(); assert.equal(v.status, 'gratis'); assert.equal(v.vencida, true);
    // cobrança vencida sem pagamento vira "expirado"
    const p7 = (await X.post('/api/assinatura/pix', { plano: 'basico' })).d;
    db.prepare("UPDATE pagamentos SET expira_em = '2000-01-01 00:00:00' WHERE id = ?").run(p7.id);
    assert.equal((await X.get('/api/assinatura')).d.pendente, null);
    assert.equal(db.prepare('SELECT status FROM pagamentos WHERE id = ?').get(p7.id).status, 'expirado');
    // histórico traz data, plano, valor, validade e id da transação
    const h = (await X.get('/api/assinatura')).d.pagamentos.find((p) => p.id === p5.id);
    assert.ok(h.pago_em && h.validade_ate && h.transacao && h.valor === 59.9 && h.plano === 'premium');
  });

  await t('revisão: e-mail de dono não pode ser tomado pelo cadastro comum', async () => {
    const X = new Cliente();
    const r = await X.post('/api/auth/register', { nome_estabelecimento: 'Dono 2', nome: 'D', email: 'dono@teste.com', senha: 'senha-forte-3' });
    assert.equal(r.status, 403);
    assert.equal((await X.get('/api/me')).status, 401);
  });

  await t('entrada do administrador: só e-mail de dono e senha, sem código', async () => {
    db.prepare("DELETE FROM estabelecimentos WHERE id IN (SELECT estabelecimento_id FROM usuarios WHERE email = 'dono@teste.com')").run();
    const X = new Cliente();
    assert.equal((await X.post('/api/auth/admin', { email: 'outro@teste.com', senha: 'senha-forte-3' })).status, 401);
    assert.equal((await X.post('/api/auth/admin', { email: 'dono@teste.com', senha: 'curta' })).status, 400);
    assert.equal((await X.get('/api/admin/resumo')).status, 401);
    const ok = await X.post('/api/auth/admin', { email: 'dono@teste.com', senha: 'senha-forte-3' });
    assert.equal(ok.status, 200); assert.equal(ok.d.admin, true);
    assert.equal((await X.get('/api/me')).d.admin, true);
    assert.equal((await X.get('/api/admin/resumo')).status, 200);
    const Y = new Cliente();
    assert.equal((await Y.post('/api/auth/admin', { email: 'dono@teste.com', senha: 'errada-123' })).status, 401);
    assert.equal((await Y.post('/api/auth/admin', { email: 'dono@teste.com', senha: 'senha-forte-3' })).status, 200);
  });

  await t('revisão: recuperação de senha por código, uso único e sessões encerradas', async () => {
    const X = new Cliente(), Y = new Cliente();
    const reg = await X.post('/api/auth/register', { nome_estabelecimento: 'Rec Teste', nome: 'R', email: 'rec@teste.com', senha: 'senha-antiga-1' });
    const cod = reg.d.codigo_recuperacao;
    assert.match(cod, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal((await Y.post('/api/auth/recuperar', { email: 'rec@teste.com', codigo: 'AAAA-AAAA-AAAA-AAAA', nova: 'senha-nova-123' })).status, 400);
    const ok = await Y.post('/api/auth/recuperar', { email: 'rec@teste.com', codigo: cod.toLowerCase(), nova: 'senha-nova-123' });
    assert.equal(ok.status, 200); assert.ok(ok.d.codigo_recuperacao && ok.d.codigo_recuperacao !== cod);
    assert.equal((await Y.post('/api/auth/recuperar', { email: 'rec@teste.com', codigo: cod, nova: 'outra-senha-123' })).status, 400); // código antigo morreu
    assert.equal((await X.get('/api/me')).status, 401); // sessão antiga encerrada
    assert.equal((await Y.post('/api/auth/login', { email: 'rec@teste.com', senha: 'senha-nova-123' })).status, 200);
    assert.equal((await Y.put('/api/me/recuperacao', { senha: 'errada' })).status, 400);
    assert.ok((await Y.put('/api/me/recuperacao', { senha: 'senha-nova-123' })).d.codigo_recuperacao);
  });

  await t('revisão: limite de contas de teste por IP e checagem de origem (CSRF)', async () => {
    process.env.MAX_TESTES_POR_IP = '1';
    db.prepare("UPDATE estabelecimentos SET ip_hash = 'outro'").run();
    const X = new Cliente();
    assert.equal((await X.post('/api/auth/register', { nome_estabelecimento: 'Lim 1', nome: 'L', email: 'lim1@teste.com', senha: 'senha-forte-9' })).status, 201);
    assert.equal((await new Cliente().post('/api/auth/register', { nome_estabelecimento: 'Lim 2', nome: 'L', email: 'lim2@teste.com', senha: 'senha-forte-9' })).status, 429);
    process.env.MAX_TESTES_POR_IP = '1000';
    const r = await fetch(base + '/api/clientes', { method: 'POST', headers: { cookie: X.cookie, 'Content-Type': 'application/json', Origin: 'https://site-malicioso.com' }, body: JSON.stringify({ nome: 'x' }) });
    assert.equal(r.status, 403);
  });

  await t('revisão: exportar e excluir conta apagam tudo; /saude responde', async () => {
    const X = new Cliente();
    await X.post('/api/auth/register', { nome_estabelecimento: 'Excluir Teste', nome: 'E', email: 'excluir@teste.com', senha: 'senha-forte-9' });
    await X.post('/api/clientes', { nome: 'Maria', telefone: '85999990000' });
    const estId = db.prepare("SELECT estabelecimento_id id FROM usuarios WHERE email = 'excluir@teste.com'").get().id;
    const exp = await X.get('/api/conta/exportar');
    assert.equal(exp.status, 200); assert.equal(exp.d.clientes.length, 1); assert.ok(!JSON.stringify(exp.d).includes('senha_hash')); assert.ok(!JSON.stringify(exp.d).includes('ip_hash'));
    assert.equal((await X.post('/api/conta/excluir', { senha: 'errada', confirmar: 'EXCLUIR' })).status, 400);
    assert.equal((await X.post('/api/conta/excluir', { senha: 'senha-forte-9', confirmar: 'x' })).status, 400);
    assert.equal((await X.post('/api/conta/excluir', { senha: 'senha-forte-9', confirmar: 'excluir' })).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios WHERE email = 'excluir@teste.com'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes WHERE estabelecimento_id = ?').get(estId).n, 0);
    assert.equal((await X.get('/api/me')).status, 401);
    assert.equal((await anon.get('/saude')).status, 200);
    for (const pg of ['/termos.html', '/privacidade.html']) assert.equal((await anon.get(pg)).status, 200);
  });

  await t('revisão: lembretes automáticos e backup diário', async () => {
    const S = require('./server');
    const X = new Cliente();
    await X.post('/api/auth/register', { nome_estabelecimento: 'Lembrete Teste', nome: 'L', email: 'lemb@teste.com', senha: 'senha-forte-9' });
    const est = db.prepare("SELECT e.* FROM estabelecimentos e JOIN usuarios u ON u.estabelecimento_id = e.id WHERE u.email = 'lemb@teste.com'").get();
    const prof = db.prepare('SELECT id FROM profissionais WHERE estabelecimento_id = ?').get(est.id).id;
    const sv = Number(db.prepare("INSERT INTO servicos (estabelecimento_id, nome, preco, duracao_min) VALUES (?,?,?,?)").run(est.id, 'Corte', 40, 30).lastInsertRowid);
    const cl = Number(db.prepare("INSERT INTO clientes (estabelecimento_id, nome) VALUES (?,?)").run(est.id, 'Zé').lastInsertRowid);
    const agora = L.agoraLocal(est.fuso), ini = L.addMin(agora.slice(0, 10), agora.slice(11, 16), 20);
    db.prepare("INSERT INTO agendamentos (estabelecimento_id, cliente_id, profissional_id, servico_id, inicio, fim, preco) VALUES (?,?,?,?,?,?,?)").run(est.id, cl, prof, sv, ini, L.addMin(ini.slice(0, 10), ini.slice(11), 30), 40);
    S.lembretesAutomaticos();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE estabelecimento_id = ? AND tipo = 'lembrete'").get(est.id).n, 1);
    S.lembretesAutomaticos();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE estabelecimento_id = ? AND tipo = 'lembrete'").get(est.id).n, 1); // não repete
    S.backupDiario();
    assert.ok(fs.readdirSync(path.join(tmp, 'backups')).some((f) => /^agendax-.*\.db$/.test(f)));
  });

  await t('aparência: cores, fundo, imagem e página pública', async () => {
    const X = new Cliente();
    await X.post('/api/auth/register', { nome_estabelecimento: 'Aparencia Teste', nome: 'A', email: 'apar@teste.com', senha: 'senha-forte-9' });
    const cfg = (await X.get('/api/config')).d;
    assert.equal(cfg.aparencia.cor_principal, '#7c3aed');
    const ok = await X.put('/api/config/aparencia', { cor_principal: '#112233', cor_secundaria: '#000000', cor_destaque: '#ff0000', fundo: { tipo: 'tema', tema: 'oceano', cor: '#ffffff' } });
    assert.equal(ok.status, 200); assert.equal(ok.d.fundo.tema, 'oceano');
    assert.equal((await X.put('/api/config/aparencia', { cor_principal: 'azul', cor_secundaria: '#000000', cor_destaque: '#ff0000', fundo: {} })).status, 400);
    assert.equal((await X.put('/api/config/aparencia', { cor_principal: '#112233', cor_secundaria: '#000000', cor_destaque: '#ff0000', fundo: { tipo: 'imagem' } })).status, 400);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const im = await X.post('/api/config/fundo', { imagem: png });
    assert.equal(im.status, 200); assert.equal(im.d.fundo.tipo, 'imagem'); assert.ok(im.d.fundo.imagem);
    const pub = (await new Cliente().get('/api/public/' + cfg.slug)).d;
    assert.equal(pub.aparencia.cor_principal, '#112233');
    assert.equal((await X.del('/api/config/fundo')).d.fundo.tipo, 'cor');
  });

  await t('produtos: cadastro, escolha opcional no agendamento público e valor somado', async () => {
    const X = new Cliente();
    await X.post('/api/auth/register', { nome_estabelecimento: 'Produtos Teste', nome: 'P', email: 'prod@teste.com', senha: 'senha-forte-9' });
    const sv = (await X.post('/api/servicos', { nome: 'Corte', preco: '40', duracao_min: 30, profissionais: [(await X.get('/api/profissionais')).d[0].id] })).d;
    const pr = await X.post('/api/produtos', { nome: 'Pomada', preco: '25,50', descricao: 'Fixação forte' });
    assert.equal(pr.status, 201); assert.equal(pr.d.preco, 25.5);
    assert.equal((await X.post('/api/produtos', { nome: '', preco: 1 })).status, 400);
    const slug = (await X.get('/api/config')).d.slug;
    const anon = new Cliente(), info = (await anon.get('/api/public/' + slug)).d;
    assert.equal(info.produtos.length, 1);
    let dia, hs = [];
    for (let i = 1; i < 8 && hs.length < 3; i++) { dia = L.addDias(info.hoje, i); hs = (await anon.get(`/api/public/${slug}/horarios?servico_id=${sv.id}&data=${dia}`)).d.slots || []; }
    assert.ok(hs.length >= 3, 'há horários livres');
    // sem produto: só agenda
    const a1 = await anon.post(`/api/public/${slug}/agendar`, { servico_id: sv.id, data: dia, hora: hs[0].hora, nome: 'Sem Produto', telefone: '(85) 98888-1111' });
    assert.equal(a1.status, 201); assert.equal(a1.d.agendamento.preco, 40); assert.equal(a1.d.agendamento.produtos.length, 0);
    // com produto
    const a2 = await anon.post(`/api/public/${slug}/agendar`, { servico_id: sv.id, data: dia, hora: hs[1].hora, nome: 'Com Produto', telefone: '(85) 98888-3333', produtos: [{ id: pr.d.id, qtd: 2 }] });
    assert.equal(a2.status, 201); assert.equal(a2.d.agendamento.preco, 91); assert.equal(a2.d.agendamento.produtos[0].qtd, 2);
    const lista = (await X.get(`/api/agendamentos?de=${dia}&ate=${dia}`)).d;
    assert.equal(lista.find((a) => a.preco === 91).produtos[0].nome, 'Pomada');
    // produto inexistente / de outra conta é recusado
    assert.equal((await anon.post(`/api/public/${slug}/agendar`, { servico_id: sv.id, data: dia, hora: hs[2].hora, nome: 'X', telefone: '(85) 98888-4444', produtos: [{ id: 99999, qtd: 1 }] })).status, 400);
    // inativo some da página
    await X.put('/api/produtos/' + pr.d.id, { nome: 'Pomada', preco: '25,50', ativo: false });
    assert.equal((await anon.get('/api/public/' + slug)).d.produtos.length, 0);
    assert.equal((await X.del('/api/produtos/' + pr.d.id)).status, 200);
  });

  await t('login e cadastro: novo, duplicado, memória, sessão, saída e recuperação', async () => {
    const reg = { nome_estabelecimento: 'Studio Login', nome: 'Lia Souza', email: 'lia@teste.com', senha: 'senha-forte-7' };
    // dados incorretos → mensagens claras
    for (const [parte, msg] of [[{ email: 'sem-arroba' }, /E-mail inválido/], [{ senha: 'curta' }, /pelo menos|entre 8/], [{ nome: '' }, /nome/i], [{ nome_estabelecimento: '' }, /estabelecimento/i]]) {
      const r = await new Cliente().post('/api/auth/register', { ...reg, ...parte });
      assert.equal(r.status, 400); assert.match(r.d.erro, msg);
    }
    // cadastro novo: cria conta, entra direto e recebe 14 dias de teste
    const L1 = new Cliente();
    const r = await L1.post('/api/auth/register', { ...reg, manter: true });
    assert.equal(r.status, 201); assert.ok(r.d.codigo_recuperacao);
    const me = (await L1.get('/api/me')).d;
    assert.equal(me.usuario.email, 'lia@teste.com'); assert.equal(me.assinatura.status, 'trial');
    // senha nunca em texto puro
    const hash = db.prepare('SELECT senha_hash FROM usuarios WHERE email = ?').get('lia@teste.com').senha_hash;
    assert.ok(!hash.includes('senha-forte-7'));
    // duplicados (inclusive com maiúsculas e espaços)
    for (const em of ['lia@teste.com', '  LIA@Teste.com ']) {
      const d = await new Cliente().post('/api/auth/register', { ...reg, nome_estabelecimento: 'Outro', email: em });
      assert.equal(d.status, 409); assert.equal(d.d.existe, true);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM usuarios WHERE email = 'lia@teste.com'").get().n, 1);
    // reconhecimento da conta
    const anonimo = new Cliente();
    assert.deepEqual((await anonimo.post('/api/auth/email', { email: 'LIA@teste.com' })).d, { valido: true, existe: true });
    assert.deepEqual((await anonimo.post('/api/auth/email', { email: 'nova@teste.com' })).d, { valido: true, existe: false });
    assert.equal((await anonimo.post('/api/auth/email', { email: 'xx' })).d.valido, false);
    // senha incorreta: mesma mensagem para e-mail existente e inexistente
    const e1 = await new Cliente().post('/api/auth/login', { email: 'lia@teste.com', senha: 'errada-123' });
    const e2 = await new Cliente().post('/api/auth/login', { email: 'ninguem@teste.com', senha: 'errada-123' });
    assert.equal(e1.status, 401); assert.equal(e2.status, 401); assert.equal(e1.d.erro, e2.d.erro);
    // sessão persistente: "manter conectado" dura dias; sem marcar, é cookie de sessão do navegador
    const M = new Cliente(), N = new Cliente();
    const lm = await M.post('/api/auth/login', { email: 'lia@teste.com', senha: 'senha-forte-7', manter: true });
    const ln = await N.post('/api/auth/login', { email: 'lia@teste.com', senha: 'senha-forte-7', manter: false });
    const ckM = lm.headers.get('set-cookie'), ckN = ln.headers.get('set-cookie');
    assert.match(ckM, /Max-Age=\d+/); assert.doesNotMatch(ckN, /Max-Age/);
    assert.match(ckM, /HttpOnly/); assert.match(ckM, /SameSite=Lax/);
    // "fechar e reabrir": novo cliente reaproveitando o cookie guardado continua conectado
    const reaberto = new Cliente(); reaberto.cookie = M.cookie;
    assert.equal((await reaberto.get('/api/me')).status, 200);
    // sair: a sessão deixa de valer, mesmo com o cookie antigo, e dá para entrar de novo
    await M.post('/api/auth/logout');
    const velho = new Cliente(); velho.cookie = reaberto.cookie;
    assert.equal((await velho.get('/api/me')).status, 401);
    const de_novo = new Cliente();
    assert.equal((await de_novo.post('/api/auth/login', { email: 'lia@teste.com', senha: 'senha-forte-7' })).status, 200);
    // recuperação de senha com código; sessões antigas caem
    const rec = await new Cliente().post('/api/auth/recuperar', { email: 'lia@teste.com', codigo: r.d.codigo_recuperacao, nova: 'nova-senha-88' });
    assert.equal(rec.status, 200);
    assert.equal((await de_novo.get('/api/me')).status, 401);
    assert.equal((await new Cliente().post('/api/auth/login', { email: 'lia@teste.com', senha: 'senha-forte-7' })).status, 401);
    assert.equal((await new Cliente().post('/api/auth/login', { email: 'lia@teste.com', senha: 'nova-senha-88' })).status, 200);
    // isolamento: a conta nova não enxerga nada de outro estabelecimento
    const I = new Cliente(); await I.post('/api/auth/login', { email: 'lia@teste.com', senha: 'nova-senha-88' });
    for (const rota of ['clientes', 'servicos', 'produtos', 'agendamentos', 'lancamentos', 'notificacoes']) {
      const x = await I.get('/api/' + rota); assert.equal(x.status, 200);
      assert.ok(!JSON.stringify(x.d).includes('alfa@teste.com') && (!Array.isArray(x.d) || x.d.every((i) => !i.nome || !['João Silva', 'Corte masculino'].includes(i.nome))), rota);
    }
    assert.equal((await I.get(`/api/clientes/${cliId}`)).status, 404);
    assert.equal((await I.put(`/api/servicos/${servId}`, { nome: 'x', preco: 1, duracao_min: 30 })).status, 404);
    assert.equal((await I.get('/api/conta/exportar')).d.usuario.email, 'lia@teste.com');
  });

  await t('administração: só o dono vê contas; suspender, estender e liberar plano', async () => {
    const O = new Cliente();
    await O.post('/api/auth/login', { email: 'dono@teste.com', senha: 'senha-forte-3' });
    assert.equal((await O.get('/api/me')).d.admin, true);
    const resumo = await O.get('/api/admin/resumo');
    assert.equal(resumo.status, 200); assert.ok(resumo.d.totais.contas >= 3);
    const txt = JSON.stringify(resumo.d);
    assert.ok(!/senha_hash|recup_hash|ip_hash/.test(txt), 'sem dados secretos');
    assert.ok(!txt.includes('João Silva'), 'sem clientes de outros negócios');
    // quem não é dono: 404 em tudo, e /api/me não marca admin
    const U = new Cliente(); await U.post('/api/auth/register', { nome_estabelecimento: 'Susp Teste', nome: 'S', email: 'susp@teste.com', senha: 'senha-forte-5' });
    const resumo2 = (await O.get('/api/admin/resumo')).d;
    assert.equal((await U.get('/api/me')).d.admin, false);
    assert.equal((await U.get('/api/admin/resumo')).status, 404);
    const alvo = resumo2.contas.find((c) => c.email === 'susp@teste.com');
    assert.equal((await U.post('/api/admin/contas/' + alvo.id, { acao: 'plano', plano: 'premium' })).status, 404);
    assert.equal((await new Cliente().get('/api/admin/resumo')).status, 401, 'sem login');
    // ações do dono
    const a1 = await O.post('/api/admin/contas/' + alvo.id, { acao: 'plano', plano: 'profissional' });
    assert.equal(a1.status, 200); assert.equal(a1.d.status, 'ativa'); assert.equal(a1.d.plano, 'profissional');
    const a2 = await O.post('/api/admin/contas/' + alvo.id, { acao: 'estender', dias: 10 });
    assert.equal(a2.d.status, 'trial'); assert.ok(a2.d.dias_restantes >= 9);
    assert.equal((await O.post('/api/admin/contas/' + alvo.id, { acao: 'estender', dias: 0 })).status, 400);
    assert.equal((await O.post('/api/admin/contas/' + alvo.id, { acao: 'xyz' })).status, 400);
    // suspender: sessão cai, login e página pública bloqueados; reativar volta
    const slug = db.prepare('SELECT slug FROM estabelecimentos WHERE id = ?').get(alvo.id).slug;
    assert.equal((await O.post('/api/admin/contas/' + alvo.id, { acao: 'suspender' })).d.status, 'suspensa');
    assert.equal((await U.get('/api/me')).status, 401);
    assert.equal((await new Cliente().post('/api/auth/login', { email: 'susp@teste.com', senha: 'senha-forte-5' })).status, 403);
    assert.equal((await new Cliente().get('/api/public/' + slug)).status, 403);
    assert.equal((await O.post('/api/admin/contas/' + alvo.id, { acao: 'reativar' })).d.suspenso, false);
    assert.equal((await new Cliente().post('/api/auth/login', { email: 'susp@teste.com', senha: 'senha-forte-5' })).status, 200);
    // o dono não altera a própria conta nem outro dono
    const eu = resumo.d.contas.find((c) => c.email === 'dono@teste.com');
    assert.equal((await O.post('/api/admin/contas/' + eu.id, { acao: 'suspender' })).status, 400);
    assert.ok((await O.get('/api/admin/resumo')).d.historico.length >= 4, 'histórico das ações');
  });

  await t('pagamentos pelo painel do administrador: token criptografado, só o dono, teste de conexão', async () => {
    const O = new Cliente(); await O.post('/api/auth/login', { email: 'dono@teste.com', senha: 'senha-forte-3' });
    const U = new Cliente(); await U.post('/api/auth/register', { nome_estabelecimento: 'Pag Painel', nome: 'P', email: 'pagpainel@teste.com', senha: 'senha-forte-9' });
    // quem não é dono: 404 em tudo
    assert.equal((await U.get('/api/admin/pagamentos')).status, 404);
    assert.equal((await U.put('/api/admin/pagamentos', { access_token: 'TEST-abcdefghijklmnopqrstuvwxyz' })).status, 404);
    assert.equal((await U.post('/api/admin/pagamentos/testar', {})).status, 404);
    assert.equal((await new Cliente().get('/api/admin/pagamentos')).status, 401);
    const g0 = await O.get('/api/admin/pagamentos');
    assert.equal(g0.status, 200); assert.equal(g0.d.token.origem, 'servidor'); assert.ok(!JSON.stringify(g0.d).includes('token-de-teste'), 'token do servidor nunca volta inteiro');
    // validações
    assert.equal((await O.put('/api/admin/pagamentos', { access_token: 'qualquer-coisa' })).status, 400);
    assert.equal((await O.put('/api/admin/pagamentos', { public_url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await O.put('/api/admin/pagamentos', { webhook_secret: 'curto' })).status, 400);
    // salva token novo pelo painel
    const novoTok = 'TEST-painel-1234567890-abcdefghijklmnop', antes = fakeMP.auth;
    const r = await O.put('/api/admin/pagamentos', { access_token: novoTok, webhook_secret: 'segredo-do-painel-123', public_url: 'https://meuapp.onrender.com/qualquer/caminho' });
    assert.equal(r.status, 200); assert.equal(r.d.token.origem, 'painel'); assert.equal(r.d.segredo.origem, 'painel');
    assert.equal(r.d.public_url, 'https://meuapp.onrender.com'); assert.equal(r.d.webhook_url, 'https://meuapp.onrender.com/api/webhooks/mercadopago');
    assert.ok(!JSON.stringify(r.d).includes('1234567890-abcdefghij'), 'resposta não devolve o token');
    assert.ok(!JSON.stringify((await O.get('/api/admin/pagamentos')).d).includes('1234567890-abcdefghij'));
    const guardado = db.prepare("SELECT valor FROM config WHERE chave = 'mp_token'").get().valor;
    assert.ok(!guardado.includes('painel-1234567890') && !guardado.includes('TEST-'), 'guardado criptografado');
    // testar conexão (o provedor falso só aceita o token novo)
    assert.equal((await O.post('/api/admin/pagamentos/testar', {})).status, 400, 'token novo ainda não é aceito pelo provedor falso');
    fakeMP.auth = 'Bearer ' + novoTok;
    const ok = await O.post('/api/admin/pagamentos/testar', {});
    assert.equal(ok.status, 200); assert.equal(ok.d.conta.nome, 'LOJA TESTE'); assert.equal(ok.d.modo, 'teste');
    // a cobrança usa o token do painel
    const pix = await U.post('/api/assinatura/pix', { plano: 'basico' });
    assert.equal(pix.status, 201, JSON.stringify(pix.d));
    // webhook valida com a assinatura do painel
    const id = fakeMP.seq;
    assert.equal((await webhookMP(id, { segredo: 'segredo-do-painel-123' })).status, 200);
    assert.equal((await webhookMP(id, { segredo: MP_SEGREDO })).status, 401, 'a assinatura antiga não vale mais');
    // histórico não guarda valores
    const hist = (await O.get('/api/admin/resumo')).d.historico.filter((h) => h.acao === 'pagamentos');
    assert.ok(hist.length >= 1 && !JSON.stringify(hist).includes('1234567890'));
    // remover volta a valer o ambiente
    const rem = await O.put('/api/admin/pagamentos', { remover_token: true, remover_segredo: true });
    assert.equal(rem.d.token.origem, 'servidor'); assert.equal(rem.d.segredo.origem, 'servidor');
    fakeMP.auth = antes;
    db.prepare("DELETE FROM config WHERE chave = 'public_url'").run();
  });

  console.log(`\n${passou} testes passaram${process.exitCode ? ' (com falhas)' : ' — tudo certo'}.`);
  servidor.close(); mpServidor.close(); fs.rmSync(tmp, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
