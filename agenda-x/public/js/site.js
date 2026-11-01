/* Página de vendas: planos vindos do servidor e botões de chamada. */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function abrir(modo) {
    const link = document.querySelector('[data-go=' + (modo === 'reg' ? 'reg' : 'login') + ']');
    if (link) link.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { const f = document.getElementById(modo === 'reg' ? 'r-est' : 'l-email'); if (f) f.focus({ preventScroll: true }); }, 350);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-cta]'); if (b) { e.preventDefault(); abrir(b.dataset.cta); } });

  fetch('/api/planos').then((r) => r.json()).then((d) => {
    const box = document.getElementById('mk-plans');
    const prem = d.planos.find((x) => x.id === 'premium') || {};
    box.innerHTML = d.planos.map((p) => {
      if (p.id === 'gratis') return `<article class="mk-plan"><h3>14 dias grátis</h3><div class="pr">R$ 0 <small>por 14 dias</small></div><ul><li>Tudo dos planos pagos liberado</li><li>Todas as ${prem.total_funcoes || ''} funções do plano Premium</li><li>Sem cartão de crédito</li><li>Depois, escolha o plano que quiser</li></ul><button class="btn" data-cta="reg">Começar 14 dias grátis</button></article>`;
      const extra = p.herda ? `<div class="fn">Tudo do ${esc(p.herda)} e mais ${p.funcoes.length} funções</div><ul>${p.funcoes.slice(0, 6).map((f) => `<li>${esc(f.nome)}</li>`).join('')}${p.funcoes.length > 6 ? `<li><b>+ ${p.funcoes.length - 6} funções</b></li>` : ''}</ul>`
        : `<ul>${p.destaques.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
      const lim = p.herda ? `<ul>${p.destaques.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
      return `<article class="mk-plan ${p.id === 'profissional' ? 'hot' : ''}">${p.id === 'profissional' ? '<span class="tag">Mais escolhido</span>' : ''}<h3>${esc(p.nome)}</h3>
        <div class="pr">${p.preco ? brl(p.preco) : 'R$ 0'} <small>/mês</small></div>${lim}${extra}
        <button class="btn ${p.id === 'profissional' ? 'primary' : ''}" data-cta="reg">${p.preco ? 'Testar 14 dias grátis' : 'Começar grátis'}</button></article>`;
    }).join('');
  }).catch(() => { const b = document.getElementById('mk-plans'); if (b) b.innerHTML = '<div class="empty">Não foi possível carregar os planos agora.</div>'; });
})();
