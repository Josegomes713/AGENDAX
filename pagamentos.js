'use strict';
// Provedor de pagamentos Pix: Mercado Pago (API de Pagamentos). Sem dependências externas.
// Credenciais SOMENTE no servidor (painel do administrador, criptografadas, ou variáveis de ambiente):
//   MP_ACCESS_TOKEN    token de acesso (de teste começa com "TEST-"; de produção com "APP_USR-")
//   MP_WEBHOOK_SECRET  assinatura secreta do webhook (painel do Mercado Pago > Webhooks)
//   PUBLIC_URL         endereço público do app (https://...), usado como notification_url
//   MP_API_BASE        (opcional, para testes automáticos) troca o endereço da API
const crypto = require('crypto');

const base = () => (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/$/, '');
// As credenciais podem vir do painel de administração (guardadas criptografadas no servidor) ou das variáveis de ambiente.
// O painel tem prioridade; remover no painel volta a valer a variável de ambiente.
let fonte = () => ({});
function setFonte(fn) { fonte = typeof fn === 'function' ? fn : () => ({}); }
const token = () => fonte().token || process.env.MP_ACCESS_TOKEN || '';
const segredo = () => fonte().segredo || process.env.MP_WEBHOOK_SECRET || '';

// desligado = sem credenciais; teste = credenciais de teste (nenhuma cobrança real); producao = cobranças reais
function modo() { const t = token(); if (!t) return 'desligado'; return t.startsWith('TEST-') ? 'teste' : 'producao'; }

async function chamar(metodo, caminho, corpo, idem) {
  const headers = { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' };
  if (idem) headers['X-Idempotency-Key'] = idem;
  let r;
  try { r = await fetch(base() + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(15000) }); }
  catch (e) { const err = new Error('Provedor de pagamentos indisponível.'); err.status = 502; throw err; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error((d && (d.message || d.error)) || 'O provedor recusou a operação.'); err.status = r.status >= 500 ? 502 : 400; err.detalhe = d; throw err; }
  return d;
}

const isoComFuso = (ms) => { const d = new Date(ms - 3 * 3600000); return d.toISOString().replace('Z', '').replace(/\.\d+$/, '.000') + '-03:00'; };

async function criarPix({ valor, descricao, referencia, email, expiraMin, urlNotificacao }) {
  const corpo = {
    transaction_amount: Number(valor), description: descricao, payment_method_id: 'pix', external_reference: referencia,
    payer: { email }, date_of_expiration: isoComFuso(Date.now() + expiraMin * 60000),
  };
  if (urlNotificacao) corpo.notification_url = urlNotificacao;
  const d = await chamar('POST', '/v1/payments', corpo, referencia);
  const t = d.point_of_interaction && d.point_of_interaction.transaction_data;
  if (!d.id || !t || !t.qr_code) { const err = new Error('O provedor não devolveu o código Pix.'); err.status = 502; throw err; }
  return { id: String(d.id), status: d.status, qr_code: t.qr_code, qr_base64: t.qr_code_base64 || '' };
}

async function buscar(id) {
  if (!/^\d{1,20}$/.test(String(id))) { const err = new Error('Identificador inválido.'); err.status = 400; throw err; }
  const d = await chamar('GET', '/v1/payments/' + id);
  return { id: String(d.id), status: d.status, valor: Number(d.transaction_amount), moeda: d.currency_id, referencia: d.external_reference || '', metodo: d.payment_method_id, aprovado_em: d.date_approved || null };
}

// Testa o token sem criar cobrança: pergunta ao Mercado Pago de quem é a conta.
async function testar() {
  if (!token()) { const err = new Error('Informe o Access Token primeiro.'); err.status = 400; throw err; }
  const d = await chamar('GET', '/users/me');
  return { id: String(d.id || ''), nome: d.nickname || [d.first_name, d.last_name].filter(Boolean).join(' ') || '', pais: d.site_id || '' };
}

async function cancelar(id) { try { await chamar('PUT', '/v1/payments/' + id, { status: 'cancelled' }); } catch (_) { /* melhor esforço */ } }

// Assinatura do webhook: x-signature "ts=...,v1=<hmac>" com manifesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
function assinaturaValida({ dataId, xSignature, xRequestId }) {
  const seg = segredo();
  if (!seg || !xSignature || !dataId) return false;
  const partes = Object.fromEntries(String(xSignature).split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-zA-Z0-9]+$/.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifesto = `id:${id};request-id:${xRequestId || ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', seg).update(manifesto).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(String(partes.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { setFonte, testar, modo, criarPix, buscar, cancelar, assinaturaValida };
