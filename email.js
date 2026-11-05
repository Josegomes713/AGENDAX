'use strict';
// Envio de e-mails transacionais (confirmar e-mail, recuperar senha) por API HTTP. Sem dependências.
// Provedores: Brevo (BREVO_API_KEY) ou Resend (RESEND_API_KEY). A chave fica só em variável de ambiente no servidor.
// EMAIL_FROM = endereço remetente (no Brevo precisa ser um remetente verificado). EMAIL_FROM_NOME = nome exibido (opcional).
// As variáveis são lidas a cada envio (não na carga), e EMAIL_API_BASE permite apontar para um servidor falso nos testes.

function provedor() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}
const remetente = () => String(process.env.EMAIL_FROM || '').trim();
// Só "ativo" com chave E remetente definidos.
function ativo() { return !!provedor() && !!remetente(); }

async function enviar({ para, assunto, html, texto }) {
  const p = provedor();
  if (!p || !remetente()) return false;
  const nome = process.env.EMAIL_FROM_NOME || 'AGENDA X';
  const from = remetente();
  try {
    let r;
    if (p === 'brevo') {
      const base = process.env.EMAIL_API_BASE || 'https://api.brevo.com';
      r = await fetch(base + '/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: nome, email: from }, to: [{ email: para }], subject: assunto, htmlContent: html, textContent: texto }),
        signal: AbortSignal.timeout(10000),
      });
    } else {
      const base = process.env.EMAIL_API_BASE || 'https://api.resend.com';
      r = await fetch(base + '/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${nome} <${from}>`, to: [para], subject: assunto, html, text: texto }),
        signal: AbortSignal.timeout(10000),
      });
    }
    if (!r.ok) { console.warn(`E-mail não enviado (${p}): HTTP ${r.status}`); return false; }
    return true;
  } catch (e) { console.warn(`E-mail não enviado (${p}): ${e && e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede'}`); return false; }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function modelo({ titulo, nome, intro, botao, link, rodape }) {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f5f3fb;padding:24px"><div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;color:#171226">
    <div style="font-size:20px;font-weight:800;margin-bottom:16px">AGENDA <span style="color:#7c3aed">X</span></div>
    <h2 style="margin:0 0 12px;font-size:20px">${esc(titulo)}</h2>
    <p style="line-height:1.5">Olá, ${esc(nome || '')}!<br>${esc(intro)}</p>
    <p style="margin:22px 0"><a href="${esc(link)}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${esc(botao)}</a></p>
    <p style="font-size:13px;color:#6c6784;line-height:1.5">Se o botão não abrir, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${esc(link)}</span></p>
    <p style="font-size:13px;color:#6c6784;line-height:1.5">${esc(rodape)}</p></div></div>`;
  const texto = `Olá, ${nome || ''}!\n${intro}\n\n${botao}: ${link}\n\n${rodape}`;
  return { html, texto };
}

module.exports = { ativo, enviar, modelo };
