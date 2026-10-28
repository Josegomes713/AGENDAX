/* Núcleo: utilitários, API, modais, gráficos. Sem inline-scripts (CSP). */
const AX = { me: null, acts: {}, fotos: {} };
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
const fmtDM = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
const hora = (dt) => dt.slice(11, 16);
const iniciais = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
const STATUS = { agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' };
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const act = (nome, fn) => { AX.acts[nome] = fn; };

function hoje() { return new Date().toLocaleDateString('sv-SE', { timeZone: AX.me ? AX.me.estabelecimento.fuso : 'America/Fortaleza' }); }
function agoraMin() {
  const s = new Date().toLocaleTimeString('sv-SE', { timeZone: AX.me ? AX.me.estabelecimento.fuso : 'America/Fortaleza' });
  return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
}
function somaDias(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function nomeDia(d, opts) { return new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR', Object.assign({ timeZone: 'UTC' }, opts)); }
const minDe = (h) => parseInt(h.slice(0, 2), 10) * 60 + parseInt(h.slice(3, 5), 10);

const ICONS = {
  painel: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clientes: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  escudo: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  caixa: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5"/>',
  servicos: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/>',
  profissionais: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/>',
  financeiro: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  comissoes: '<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  relatorios: '<path d="M12 20V10M18 20V4M6 20v-4"/>',
  config: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cartao: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  livro: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  imprimir: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', esq: '<path d="M15 18l-6-6 6-6"/>', dir: '<path d="M9 18l6-6-6-6"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- API ---------- */
async function api(caminho, metodo, corpo) {
  metodo = metodo || 'GET';
  const opts = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (metodo !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo || {}); }
  let r;
  try { r = await fetch(caminho, opts); } catch (_) { throw new Error('Sem conexão com o servidor. Verifique sua internet.'); }
  if (r.status === 401) { location.href = '/'; throw new Error('Sessão expirada.'); }
  const ct = r.headers.get('content-type') || '';
  const dados = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    const e = new Error((dados && dados.erro) || 'Algo deu errado. Tente novamente.');
    e.status = r.status; e.dados = dados;
    if (r.status === 402 && window.atualizarBanner) window.atualizarBanner();
    throw e;
  }
  return dados;
}
const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/* ---------- Toast ---------- */
function toast(msg, tipo) {
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo || ''); t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), tipo === 'bad' ? 6000 : 3800);
}
function erroToast(e) { toast(e.message || 'Erro inesperado.', 'bad'); }

/* ---------- Modal ---------- */
function modal({ titulo, corpo, salvar, rotuloSalvar, largo, extra, semRodape }) {
  fecharModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'modal-bg';
  bg.innerHTML = `<div class="modal ${largo ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    <div class="modal-hd"><h2>${esc(titulo)}</h2><button class="x" data-act="modal-fechar" aria-label="Fechar">×</button></div>
    <div class="modal-bd"><div class="err hide" id="modal-err" role="alert"></div>${corpo}</div>
    ${semRodape ? '' : `<div class="modal-ft">${extra || ''}<button class="btn" data-act="modal-fechar">Cancelar</button>${salvar ? `<button class="btn primary" id="modal-salvar">${esc(rotuloSalvar || 'Salvar')}</button>` : ''}</div>`}
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) fecharModal(); });
  const bs = $('#modal-salvar');
  if (bs) bs.addEventListener('click', async () => {
    bs.disabled = true; $('#modal-err').classList.add('hide');
    try { await salvar(bg); } catch (e) { const el = $('#modal-err'); if (el) { el.textContent = e.message; el.classList.remove('hide'); el.scrollIntoView({ block: 'nearest' }); } }
    if (document.body.contains(bs)) bs.disabled = false;
  });
  const primeiro = $('input:not([type=hidden]):not([type=checkbox]):not([type=file]),select,textarea', bg);
  if (primeiro && window.innerWidth > 700) primeiro.focus();
  return bg;
}
function fecharModal() { const m = $('#modal-bg'); if (m) m.remove(); }
act('modal-fechar', fecharModal);
function confirmar(msg, rotulo, perigo) {
  return new Promise((res) => {
    const bg = modal({ titulo: 'Confirmar', corpo: `<p>${esc(msg)}</p>`, semRodape: true });
    const ft = document.createElement('div'); ft.className = 'modal-ft';
    ft.innerHTML = `<button class="btn" id="c-no">Voltar</button><button class="btn ${perigo ? 'danger' : 'primary'}" id="c-ok">${esc(rotulo || 'Confirmar')}</button>`;
    $('.modal', bg).appendChild(ft);
    $('#c-no').onclick = () => { fecharModal(); res(false); };
    $('#c-ok').onclick = () => { fecharModal(); res(true); };
    $('#c-ok').focus();
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharModal(); const p = $('#notif-panel'); if (p) p.classList.add('hide'); } });

/* ---------- Delegação de eventos ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = AX.acts[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { if (err && err.message) erroToast(err); }
});

/* ---------- Fotos (redimensiona no navegador antes de enviar) ---------- */
function lerImagem(arquivo, maxLado) {
  return new Promise((resolve, reject) => {
    if (!arquivo || !/^image\//.test(arquivo.type)) return reject(new Error('Escolha um arquivo de imagem.'));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa imagem.')); };
    img.src = url;
  });
}
function fotoPicker(id, urlAtual, rotulo) {
  return `<div class="photo-pick" data-foto="${id}">
    <div class="pv">${urlAtual ? `<img src="${esc(urlAtual)}" alt="">` : icon('img')}</div>
    <div><input type="file" accept="image/png,image/jpeg,image/webp" class="hide" data-foto-input="${id}">
      <button type="button" class="btn sm" data-act="foto-escolher">${esc(rotulo || 'Escolher foto')}</button>
      <button type="button" class="btn sm ghost danger ${urlAtual ? '' : 'hide'}" data-act="foto-remover">Remover</button>
      <div class="hint">JPG, PNG ou WebP.</div></div></div>`;
}
act('foto-escolher', (el) => $('input[type=file]', el.closest('.photo-pick')).click());
act('foto-remover', (el) => {
  const p = el.closest('.photo-pick');
  p.dataset.novo = ''; p.dataset.remover = '1';
  $('.pv', p).innerHTML = icon('img'); el.classList.add('hide');
});
document.addEventListener('change', async (e) => {
  const inp = e.target.closest('[data-foto-input]');
  if (!inp || !inp.files[0]) return;
  const p = inp.closest('.photo-pick');
  try {
    const d = await lerImagem(inp.files[0], 1000);
    p.dataset.novo = d; p.dataset.remover = '';
    $('.pv', p).innerHTML = `<img src="${d}" alt="">`;
    $('[data-act=foto-remover]', p).classList.remove('hide');
  } catch (err) { erroToast(err); }
  inp.value = '';
});
function dadosFoto(raiz, id) {
  const p = $(`[data-foto="${id}"]`, raiz);
  return p ? { foto: p.dataset.novo || undefined, remover_foto: p.dataset.remover === '1' && !p.dataset.novo } : {};
}

/* ---------- Gráficos (SVG simples) ---------- */
function compacto(n) { n = Number(n); if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n % 1000 ? 1 : 0).replace('.', ',') + 'k'; return String(Math.round(n * 10) / 10).replace('.', ','); }
function chartBarras(itens, cores, fmt) {
  fmt = fmt || ((v) => v);
  const W = 600, H = 230, pl = 46, pr = 8, pt = 12, pb = 28;
  const n = itens.length; if (!n) return '<div class="empty">Sem dados no período.</div>';
  const k = itens[0].v.length;
  let max = Math.max(1, ...itens.flatMap((i) => i.v));
  const passo = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / passo) * passo;
  const gw = (W - pl - pr) / n, bw = Math.max(2, Math.min(30, (gw * 0.72) / k));
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    s += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="#ece8f7"/><text x="${pl - 6}" y="${yy + 4}" text-anchor="end">${compacto(v)}</text>`;
  }
  const cada = Math.ceil(n / 8);
  itens.forEach((it, i) => {
    const x0 = pl + gw * i + (gw - bw * k) / 2;
    it.v.forEach((v, j) => {
      const h = (H - pt - pb) * (v / max);
      s += `<rect x="${x0 + bw * j}" y="${y(v)}" width="${bw - (k > 1 ? 1 : 0)}" height="${Math.max(h, 0)}" rx="2" fill="${cores[j]}"><title>${esc(it.t || it.l)}: ${esc(fmt(v, j))}</title></rect>`;
    });
    if (i % cada === 0) s += `<text x="${pl + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(it.l)}</text>`;
  });
  return s + '</svg>';
}
function barrasH(itens, fmt) {
  if (!itens.length) return '<div class="empty">Sem dados no período.</div>';
  const max = Math.max(...itens.map((i) => i.v), 1);
  return itens.map((i) => `<div class="bar-row"><span class="nm" title="${esc(i.l)}">${esc(i.l)}</span><span class="tr"><i style="width:${Math.max(3, (i.v / max) * 100)}%"></i></span><span class="vl num">${esc(fmt ? fmt(i.v) : i.v)}</span></div>`).join('');
}

/* ---------- Bloqueio por plano ---------- */
function upgradeCard(titulo, texto) {
  return `<div class="card center" style="max-width:520px;margin:30px auto"><h3 style="font-size:20px">${esc(titulo)}</h3>
    <p class="muted">${esc(texto)}</p><a class="btn primary" href="#/assinatura">Ver planos</a></div>`;
}
const vazio = (t, d, btn) => `<div class="empty"><strong>${esc(t)}</strong>${esc(d || '')}${btn ? `<div class="mt">${btn}</div>` : ''}</div>`;
