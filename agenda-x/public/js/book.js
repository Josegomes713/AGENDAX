(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtData = (d) => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const slug = location.pathname.split('/').filter(Boolean)[1];
  const base = '/api/public/' + encodeURIComponent(slug);
  const S = { info: null, servico: null, profId: 0, data: null, slots: null, hora: null, slotProf: null, passo: 1, prod: {} };
  const body = $('#pub-body');

  async function chamar(url, metodo, corpo) {
    const o = { method: metodo || 'GET', headers: {} };
    if (metodo === 'POST') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(corpo || {}); }
    const r = await fetch(url, o);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.erro || 'Algo deu errado. Tente novamente.'); e.status = r.status; throw e; }
    return d;
  }
  const dots = (n) => `<div class="steps" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  const nomeProf = (id) => { const p = S.info.profissionais.find((x) => x.id === id); return p ? p.nome : ''; };

  function cabecalho(e) {
    document.title = `Agendar — ${e.nome}`;
    const mapa = e.endereco ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.endereco) : '';
    const fone = String(e.telefone || '').replace(/[^\d+]/g, '');
    const acoes = [fone ? `<a class="pub-act" href="tel:${esc(fone)}">Ligar</a>` : '', mapa ? `<a class="pub-act" href="${esc(mapa)}" target="_blank" rel="noopener">Como chegar</a>` : ''].filter(Boolean).join('');
    $('#pub-hd').innerHTML = `${e.logo ? `<img class="lg" src="${esc(e.logo)}" alt="">` : `<div class="lg">${esc((e.nome || '?')[0].toUpperCase())}</div>`}<h1>${esc(e.nome)}</h1>
      ${e.descricao ? `<p>${esc(e.descricao)}</p>` : ''}${e.endereco || e.telefone ? `<p class="small">${[e.endereco, e.telefone].filter(Boolean).map(esc).join(' · ')}</p>` : ''}${acoes ? `<div class="pub-acts">${acoes}</div>` : ''}`;
  }

  function passoServico() {
    S.passo = 1;
    body.innerHTML = `${dots(1)}<h2 style="font-size:20px;margin-bottom:12px">Escolha o serviço</h2>` +
      (S.info.servicos.length ? `<div class="svc-grid">${S.info.servicos.map((s) => `<div class="svc" role="button" tabindex="0" data-act="srv" data-id="${s.id}"><div class="ph">${s.foto ? `<img src="${esc(s.foto)}" alt="" loading="lazy">` : '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>'}</div>
        <div class="bd"><b>${esc(s.nome)}</b><p>${esc(s.descricao)}</p><div class="row between"><span class="price num">${brl(s.preco)}</span><span class="muted small">${s.duracao_min} min</span></div></div></div>`).join('')}</div>` : '<div class="empty"><strong>Ainda não há serviços disponíveis</strong>Volte em breve ou entre em contato com o estabelecimento.</div>') +
      (S.info.cancelamento_online ? `<p class="center mt"><a href="#" data-act="meu-codigo" class="small">Já agendou? Cancelar com meu código</a></p>` : '');
  }

  function diasHtml() {
    const out = []; let d = S.info.hoje;
    for (let i = 0; i < 28 && d <= S.info.max_data; i++) {
      const dt = new Date(d + 'T12:00:00Z');
      out.push(`<button class="day ${S.data === d ? 'on' : ''}" data-act="dia" data-d="${d}" aria-label="${fmtData(d)}"><small>${dt.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}</small><b>${d.slice(8, 10)}</b><small>${dt.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', '')}</small></button>`);
      const n = new Date(dt); n.setUTCDate(n.getUTCDate() + 1); d = n.toISOString().slice(0, 10);
    }
    return out.join('');
  }
  function passoHorario() {
    S.passo = 2;
    const s = S.servico, profs = S.info.profissionais.filter((p) => p.servicos.includes(s.id));
    body.innerHTML = `${dots(2)}<div class="row between"><div><b>${esc(s.nome)}</b> <span class="muted">· ${brl(s.preco)} · ${s.duracao_min} min</span></div><button class="btn sm ghost" data-act="voltar">Trocar serviço</button></div>
      ${profs.length > 1 && S.info.escolher_profissional ? `<h3 style="margin:18px 0 8px">Com quem?</h3><div class="chips"><label class="chip"><input type="radio" name="pf" value="0" ${!S.profId ? 'checked' : ''}>Sem preferência</label>${profs.map((p) => `<label class="chip"><input type="radio" name="pf" value="${p.id}" ${S.profId === p.id ? 'checked' : ''}>${p.foto ? `<img class="av" src="${esc(p.foto)}" alt="">` : `<span class="av">${esc((p.nome || '?')[0].toUpperCase())}</span>`}${esc(p.nome)}</label>`).join('')}</div>` : ''}
      <h3 style="margin:18px 0 8px">Escolha o dia</h3><div class="days">${diasHtml()}</div>
      <h3 style="margin:18px 0 4px">Escolha o horário</h3><div id="slots">${S.data ? '' : '<p class="muted small">Selecione um dia para ver os horários livres.</p>'}</div>
      <div class="row mt" style="justify-content:flex-end"><button class="btn primary" id="seguir" data-act="seguir" ${S.hora ? '' : 'disabled'}>Continuar</button></div>`;
    $$('input[name=pf]').forEach((r) => r.addEventListener('change', () => { S.profId = parseInt(r.value, 10); S.hora = null; if (S.data) carregarSlots(); }));
    if (S.data) carregarSlots();
  }
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  async function carregarSlots() {
    const box = $('#slots'); box.innerHTML = '<p class="muted small">Buscando horários…</p>';
    try {
      const q = `servico_id=${S.servico.id}&data=${S.data}` + (S.profId ? `&profissional_id=${S.profId}` : '');
      const r = await chamar(base + '/horarios?' + q);
      S.slots = r.slots;
      box.innerHTML = r.slots.length ? `<div class="slots">${r.slots.map((x) => `<button class="slot ${S.hora === x.hora ? 'on' : ''}" data-act="hora" data-h="${x.hora}" data-p="${x.profissional_id}">${x.hora}</button>`).join('')}</div>`
        : '<p class="muted">Sem horários livres neste dia. Tente outra data.</p>';
    } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }

  const itensSel = () => Object.entries(S.prod).filter(([, q]) => q > 0).map(([id, qtd]) => ({ id: parseInt(id, 10), qtd }));
  const totalPed = () => S.servico.preco + itensSel().reduce((t, x) => { const p = S.info.produtos.find((y) => y.id === x.id); return t + (p ? p.preco * x.qtd : 0); }, 0);
  function prodHtml() {
    const ps = S.info.produtos || [];
    if (!ps.length) return '';
    return `<h3 style="margin:6px 0 4px">Quer levar algum produto? <span class="muted small">(opcional)</span></h3><p class="muted small" style="margin-bottom:10px">Se não quiser, é só continuar: seu horário fica marcado do mesmo jeito.</p>
      <div class="prod-list">${ps.map((p) => `<div class="prod ${S.prod[p.id] > 0 ? 'on' : ''}" data-pid="${p.id}"><div class="pf">${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy">` : '📦'}</div><div class="grow"><b>${esc(p.nome)}</b>${p.descricao ? `<div class="muted small">${esc(p.descricao)}</div>` : ''}<span class="price num">${brl(p.preco)}</span></div>
        <div class="qtd"><button type="button" class="btn sm" data-act="prod-menos" data-id="${p.id}" aria-label="Diminuir">−</button><b id="q-${p.id}" class="num">${S.prod[p.id] || 0}</b><button type="button" class="btn sm" data-act="prod-mais" data-id="${p.id}" aria-label="Aumentar">+</button></div></div>`).join('')}</div>
      <div class="row between" style="margin:10px 0 16px"><span class="muted">Total</span><b class="num" id="p-total">${brl(totalPed())}</b></div>`;
  }
  function passoDados() {
    S.passo = 3;
    const s = S.servico;
    body.innerHTML = `${dots(3)}<div class="card flat" style="margin-bottom:16px;background:var(--p-50)"><b>${esc(s.nome)}</b> · ${brl(s.preco)}<div class="muted">${fmtData(S.data)} às ${esc(S.hora)} · com ${esc(nomeProf(S.slotProf))}</div></div>
      ${prodHtml()}<div id="p-err" class="err hide" role="alert"></div>
      <div class="field"><label class="f" for="p-nome">Seu nome</label><input class="inp" id="p-nome" maxlength="100" autocomplete="name"></div>
      <div class="field"><label class="f" for="p-tel">Telefone com DDD</label><input class="inp" id="p-tel" type="tel" maxlength="30" autocomplete="tel" placeholder="(85) 99999-9999"></div>
      <div class="field"><label class="f" for="p-email">E-mail (opcional)</label><input class="inp" id="p-email" type="email" maxlength="160" autocomplete="email"></div>
      ${S.info.observacoes_online ? '<div class="field"><label class="f" for="p-obs">Observações (opcional)</label><input class="inp" id="p-obs" maxlength="300"></div>' : ''}
      <div class="row between mt"><button class="btn" data-act="voltar">Voltar</button><button class="btn primary" id="confirmar" data-act="confirmar">Confirmar agendamento</button></div>`;
  }

  function passoFim(a) {
    body.innerHTML = `<div class="ok-box"><div class="tick">✓</div><h2 style="font-size:22px">Agendamento confirmado!</h2>
      <p class="muted">${esc(a.servico)} com ${esc(a.profissional)}${(a.produtos || []).length ? '<br>Produtos: ' + a.produtos.map((p) => (p.qtd > 1 ? p.qtd + 'x ' : '') + esc(p.nome)).join(', ') : ''}<br><b>${fmtData(a.data)} às ${esc(a.hora)}</b> · ${brl(a.preco)}</p>
      ${S.info.cancelamento_online ? `<div class="muted small">Seu código de cancelamento</div><div class="code">${esc(a.codigo)}</div>
      <p class="muted small">Guarde este código ou salve o link abaixo. Se precisar desmarcar, é só usá-lo.</p>
      <a class="btn" href="${location.pathname}?cancelar=${esc(a.codigo)}">Link para cancelar</a>` : '<p class="muted small">Para desmarcar, entre em contato com o estabelecimento.</p>'}
      <p class="mt"><a href="${location.pathname}">Fazer outro agendamento</a></p></div>`;
    $('#pub-hd').scrollIntoView();
  }

  async function telaCancelar(codigo) {
    try {
      const a = await chamar(`${base}/agendamento/${encodeURIComponent(codigo)}`);
      const pode = a.status === 'agendado';
      body.innerHTML = `<h2 style="font-size:20px;margin-bottom:10px">Seu agendamento</h2><div id="p-err" class="err hide"></div>
        <p><b>${esc(a.servico)}</b> com ${esc(a.profissional)}${(a.produtos || []).length ? '<br>Produtos: ' + a.produtos.map((p) => (p.qtd > 1 ? p.qtd + 'x ' : '') + esc(p.nome)).join(', ') : ''}<br>${fmtData(a.data)} às ${esc(a.hora)} · ${brl(a.preco)}</p>
        <p>Situação: <span class="badge b-${esc(a.status)}">${({ agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' })[a.status] || esc(a.status)}</span></p>
        <div class="row mt">${pode ? `<button class="btn danger" data-act="cancelar" data-c="${esc(codigo)}">Cancelar agendamento</button>` : ''}<a class="btn" href="${location.pathname}">Novo agendamento</a></div>`;
    } catch (e) { body.innerHTML = `<div class="empty"><strong>Agendamento não encontrado</strong>${esc(e.message)}<div class="mt"><a class="btn" href="${location.pathname}">Fazer um agendamento</a></div></div>`; }
  }

  function mudaProd(id, d) {
    S.prod[id] = Math.max(0, Math.min(20, (S.prod[id] || 0) + d));
    $('#q-' + id).textContent = S.prod[id]; $('[data-pid="' + id + '"]').classList.toggle('on', S.prod[id] > 0); $('#p-total').textContent = brl(totalPed());
  }
  const A = {
    srv(el) { S.servico = S.info.servicos.find((x) => String(x.id) === el.dataset.id); S.prod = {}; S.profId = 0; S.data = null; S.hora = null; passoHorario(); window.scrollTo(0, 0); },
    voltar() { S.passo === 3 ? passoHorario() : passoServico(); },
    dia(el) { S.data = el.dataset.d; S.hora = null; $$('.day').forEach((b) => b.classList.toggle('on', b === el)); $('#seguir').disabled = true; carregarSlots(); },
    hora(el) { S.hora = el.dataset.h; S.slotProf = parseInt(el.dataset.p, 10); $$('.slot').forEach((b) => b.classList.toggle('on', b === el)); $('#seguir').disabled = false; },
    'prod-mais'(el) { mudaProd(el.dataset.id, 1); },
    'prod-menos'(el) { mudaProd(el.dataset.id, -1); },
    seguir() { if (S.hora) { passoDados(); window.scrollTo(0, 0); } },
    async confirmar(el) {
      const err = $('#p-err'); err.classList.add('hide'); el.disabled = true;
      try {
        const r = await chamar(base + '/agendar', 'POST', { servico_id: S.servico.id, profissional_id: S.profId || null, data: S.data, hora: S.hora, produtos: itensSel(), nome: $('#p-nome').value, telefone: $('#p-tel').value, email: $('#p-email').value, observacoes: $('#p-obs') ? $('#p-obs').value : '' });
        passoFim(r.agendamento);
      } catch (e) {
        err.textContent = e.message; err.classList.remove('hide'); el.disabled = false;
        if (e.status === 409) { S.hora = null; setTimeout(passoHorario, 1800); }
      }
    },
    'meu-codigo'() {
      const c = prompt('Digite o código de cancelamento do seu agendamento:');
      if (c && c.trim()) location.href = `${location.pathname}?cancelar=${encodeURIComponent(c.trim())}`;
    },
    async cancelar(el) {
      if (!confirm('Cancelar este agendamento?')) return;
      try { await chamar(base + '/cancelar', 'POST', { codigo: el.dataset.c }); await telaCancelar(el.dataset.c); }
      catch (e) { const x = $('#p-err'); x.textContent = e.message; x.classList.remove('hide'); }
    },
  };
  document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) { e.preventDefault(); A[el.dataset.act](el); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.svc[data-act]')) e.target.click(); });

  (async function () {
    try {
      S.info = await chamar(base);
      if (window.AXA && S.info.aparencia) AXA.aplicar(S.info.aparencia);
      cabecalho(S.info.estabelecimento);
      const c = new URLSearchParams(location.search).get('cancelar');
      if (c) telaCancelar(c); else passoServico();
    } catch (e) {
      $('#pub-hd').innerHTML = '<div class="lg">?</div><h1>Agenda indisponível</h1>';
      body.innerHTML = `<div class="empty"><strong>${esc(e.message)}</strong>Confira o link ou fale diretamente com o estabelecimento.</div>`;
    }
  })();
})();
