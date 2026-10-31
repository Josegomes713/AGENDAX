/* Roteador, menu lateral, banner de assinatura e notificações */
const MENU = [
  ['painel', 'Painel inicial', 'painel'], ['agenda', 'Agenda', 'agenda'], ['disponibilidade', 'Disponibilidade', 'relogio'], ['clientes', 'Clientes', 'clientes'], ['servicos', 'Serviços', 'servicos'], ['produtos', 'Produtos', 'caixa'],
  ['profissionais', 'Profissionais', 'profissionais'], ['financeiro', 'Financeiro', 'financeiro', 'financeiro'], ['comissoes', 'Comissões', 'comissoes', 'comissoes'],
  ['relatorios', 'Relatórios', 'relatorios', 'relatorios'], ['assinatura', 'Minha assinatura', 'cartao'], ['manual', 'Manual do usuário', 'livro'], ['configuracoes', 'Configurações', 'config'], ['admin', 'Administração', 'escudo'],
];
const temRecurso = (r) => !r || AX.me.assinatura.plano.recursos.includes(r);

function desenharMenu() {
  const rota = rotaAtual().nome;
  $('#side').innerHTML = `<div class="side-head"><a class="logo" href="#/painel"><img class="logo-mark" src="/icons/logo-app.png" alt="" width="40" height="40">AGENDA <b>X</b></a><div class="slogan">Sua agenda, seu negócio, seu crescimento</div></div>
    <nav class="nav">${MENU.filter((x) => x[0] !== 'admin' || AX.me.admin).map(([id, rot, ic, rec]) => `<a href="#/${id}" class="${rota === id ? 'on' : ''}" ${rota === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${rot}</span>${temRecurso(rec) ? '' : '<span class="lock">Upgrade</span>'}</a>`).join('')}
      <div class="sep"></div><button data-act="sair">${icon('sair')}<span>Sair</span></button></nav>
    <div class="side-foot"><strong>${esc(AX.me.estabelecimento.nome)}</strong><span>${esc(AX.me.usuario.nome)} · ${AX.me.assinatura.status === 'trial' ? 'Teste grátis' : 'Plano ' + esc(AX.me.assinatura.plano.nome)}</span></div>`;
}
function rotaAtual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [nome, q] = h.split('?');
  return { nome: VIEWS[nome || 'painel'] ? (nome || 'painel') : 'painel', params: Object.fromEntries(new URLSearchParams(q || '')) };
}
async function desenharRota(manter) {
  const { nome, params } = rotaAtual();
  const item = MENU.find((m) => m[0] === nome);
  $('#titulo').textContent = item ? item[1] : 'Painel';
  document.title = `${item ? item[1] : 'Painel'} — AGENDA X`;
  desenharMenu();
  const el = $('#view');
  if (!manter) el.innerHTML = '<div class="empty">Carregando…</div>';
  const y = window.scrollY;
  try { await VIEWS[nome](el, params); if (manter) window.scrollTo(0, y); }
  catch (e) {
    if (e.status === 403 && e.dados && e.dados.upgrade) el.innerHTML = upgradeCard('Recurso de plano superior', e.message);
    else el.innerHTML = `<div class="card">${vazio('Não foi possível carregar', e.message, '<button class="btn primary" data-act="recarregar">Tentar de novo</button>')}</div>`;
  }
}
AX.recarregar = () => desenharRota(true);
act('recarregar', () => desenharRota(false));
window.addEventListener('hashchange', () => { fecharMenu(); desenharRota(false); window.scrollTo(0, 0); });

function fecharMenu() { $('#side').classList.remove('open'); $('#scrim').classList.remove('open'); }
act('menu-abrir', () => { $('#side').classList.add('open'); $('#scrim').classList.add('open'); });
act('menu-fechar', fecharMenu);
act('sair', async () => { try { await api('/api/auth/logout', 'POST'); } finally { location.href = '/'; } });

/* ---------- Banner de assinatura ---------- */
window.atualizarBanner = async function () {
  try { AX.me = await api('/api/me'); } catch (_) { return; }
  const a = AX.me.assinatura, b = $('#banner');
  const ver = (t, cls) => `<a class="btn sm primary" href="#/assinatura">${t}</a>`;
  if (a.status === 'trial') b.innerHTML = `<div class="banner trial"><span>Teste grátis com <b>tudo liberado</b>: ${a.dias_restantes} dia(s) restante(s). Depois você assina um plano ou continua no plano Grátis, com recursos limitados.</span>${ver('Ver planos')}</div>`;
  else if (a.status === 'gratis') b.innerHTML = `<div class="banner bad"><span><b>Seu teste terminou.</b> Você está no plano Grátis, com recursos limitados. Assine um plano para liberar tudo de novo.</span>${ver('Assinar um plano')}</div>`;
  else b.innerHTML = '';
  desenharMenu(); atualizarSino(AX.me.nao_lidas);
};

/* ---------- Notificações ---------- */
let ultimoId = null;
function atualizarSino(n) {
  const c = $('#cnt'); c.textContent = n > 99 ? '99+' : n; c.classList.toggle('hide', !n);
}
async function buscarNotificacoes(silencioso) {
  const r = await api('/api/notificacoes');
  atualizarSino(r.nao_lidas);
  const maior = r.itens.reduce((x, n) => Math.max(x, Number(n.id) || 0), 0);
  if (silencioso && ultimoId != null) {
    const novas = r.itens.filter((n) => n.id > ultimoId && !n.lida).sort((a, b) => a.id - b.id);
    if (novas.length) {
      AX.avisar(novas[novas.length - 1], novas.length);
      if (window.location.hash.startsWith('#/agenda') || window.location.hash.startsWith('#/painel') || !window.location.hash) AX.recarregar();
    }
  }
  if (ultimoId == null || maior > ultimoId) ultimoId = maior;
  return r;
}
function quando(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z'), min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora'; if (min < 60) return `há ${min} min`; if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('pt-BR');
}
act('notif-abrir', async () => {
  const p = $('#notif-panel');
  if (!p.classList.contains('hide')) { p.classList.add('hide'); return; }
  const r = await buscarNotificacoes();
  p.innerHTML = `<div class="hd"><span>Notificações</span><button class="btn sm ghost" data-act="notif-todas">Marcar todas como lidas</button></div>
    <div class="notif-list">${r.itens.length ? r.itens.map((n) => `<div class="notif ${n.lida ? '' : 'new'}" data-act="notif-ler" data-id="${n.id}" data-tipo="${esc(n.tipo)}"><div><div class="t">${esc(n.titulo)}</div><div class="m">${esc(n.mensagem)}</div><div class="d">${quando(n.criado_em)}</div></div></div>`).join('') : '<div class="empty">Nenhuma notificação por enquanto.</div>'}</div>${AX.controlesAlerta()}`;
  p.classList.remove('hide');
});
act('notif-ler', async (b) => {
  await api(`/api/notificacoes/${b.dataset.id}/ler`, 'POST'); $('#notif-panel').classList.add('hide');
  const t = b.dataset.tipo;
  if (t === 'assinatura') location.hash = '#/assinatura';
  else if (t === 'agendamento' || t === 'lembrete' || t === 'cancelamento') { if (location.hash.startsWith('#/agenda')) AX.recarregar(); else location.hash = '#/agenda'; }
  buscarNotificacoes();
});
act('notif-todas', async () => { await api('/api/notificacoes/ler-todas', 'POST'); $('#notif-panel').classList.add('hide'); buscarNotificacoes(); });
document.addEventListener('mousedown', (e) => { const p = $('#notif-panel'); if (p && !p.classList.contains('hide') && !e.target.closest('.bell')) p.classList.add('hide'); });

/* ---------- Início ---------- */
(async function iniciar() {
  try {
    AX.me = await api('/api/me');
  } catch (e) { return; }
  await window.atualizarBanner();
  await desenharRota(false);
  await buscarNotificacoes(false).catch(() => {});
  AX.tempoReal(() => buscarNotificacoes(true).catch(() => {}));
})();
