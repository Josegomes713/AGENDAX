/* Telas essenciais: painel, agenda, clientes, serviços */
const VIEWS = {};
AX.agCache = {};
const cacheAgs = (l) => l.forEach((a) => { AX.agCache[a.id] = a; });
const urlPublica = () => location.origin + '/agendar/' + AX.me.estabelecimento.slug;
const recarregar = () => AX.recarregar && AX.recarregar();

act('copiar-link', async () => {
  try { await navigator.clipboard.writeText(urlPublica()); toast('Link copiado!', 'ok'); }
  catch (_) { prompt('Copie o link:', urlPublica()); }
});

/* =============== PAINEL =============== */
VIEWS.painel = async (el) => {
  const [d, profsL, servsL] = await Promise.all([api('/api/dashboard'), api('/api/profissionais'), api('/api/servicos')]);
  AX.profsCache = profsL; AX.servicosCache = servsL;
  cacheAgs(d.agenda_hoje); cacheAgs(d.proximos);
  const item = (a) => `<div class="it" data-act="ag-abrir" data-id="${a.id}" tabindex="0">
      <div class="time num">${hora(a.inicio)}</div><span class="dot" style="background:${esc(a.profissional_cor)}"></span>
      <div class="grow"><b>${esc(a.cliente_nome)}</b><div class="muted small">${esc(a.servico_nome)} · ${esc(a.profissional_nome)}</div></div>${badge(a.status)}</div>`;
  const dias = d.grafico_7dias.map((g) => ({ l: fmtDM(g.data), t: fmtData(g.data), v: [g.faturamento] }));
  const ags = d.grafico_7dias.map((g) => ({ l: fmtDM(g.data), t: fmtData(g.data), v: [g.agendamentos] }));
  const lkOk = (() => { try { return localStorage.getItem('ax_link_ok') === '1'; } catch (_) { return false; } })();
  const passos = d.primeiros_passos.map((p) => (p.id === 'link' ? { ...p, feito: lkOk } : p));
  const feitos = passos.filter((p) => p.feito).length;
  const guia = feitos === passos.length ? '' : `<div class="card onb"><div class="row between"><div><h3>Primeiros passos</h3><p class="muted small" style="margin:2px 0 0">${feitos} de ${passos.length} concluídos. Faltam poucos passos para seu negócio ficar no ar.</p></div><div class="onb-bar" aria-hidden="true"><i style="width:${Math.round((feitos / passos.length) * 100)}%"></i></div></div><div class="onb-list">${passos.map((p) => `<div class="onb-it ${p.feito ? 'ok' : ''}"><span class="onb-ck">${p.feito ? '✓' : ''}</span><div class="grow"><b>${esc(p.titulo)}</b><div class="muted small">${esc(p.desc)}</div></div>${p.feito ? '' : (p.acao ? `<button class="btn sm primary" data-act="${p.acao}">${esc(p.rotulo)}</button>` : `<a class="btn sm primary" href="${p.link}">${esc(p.rotulo)}</a>`)}</div>`).join('')}</div></div>`;
  const disp = `<div class="card mt"><div class="row between"><div><h3>Disponibilidade de horários</h3><p class="muted small" style="margin:2px 0 0">Defina os dias e horários em que cada profissional atende. Só esses horários ficam livres na agenda. Intervalo entre horários: ${AX.me.estabelecimento.intervalo_slots} min. <a href="#/configuracoes">Alterar</a></p></div></div>
    <div class="grid g3 mt-s">${profsL.filter((p) => p.ativo).map((p) => `<div class="card" style="box-shadow:none"><div class="row between"><b><span class="dot" style="background:${esc(p.cor)};display:inline-block;margin-right:6px"></span>${esc(p.nome)}</b><button class="btn sm primary" data-act="prof-editar" data-id="${p.id}">Configurar horários</button></div>
      <div class="small mt-s">${ORDEM_DIAS.map((i) => `<div class="row between" style="padding:3px 0;border-bottom:1px solid #f0ecfa"><span>${DIAS[i]}</span><span class="${p.horarios[i].ativo ? '' : 'muted'} num">${p.horarios[i].ativo ? esc(p.horarios[i].inicio) + ' – ' + esc(p.horarios[i].fim) : 'Fechado'}</span></div>`).join('')}</div></div>`).join('') || '<p class="muted">Cadastre um profissional para definir horários.</p>'}</div></div>`;
  el.innerHTML = guia + disp + `
  <div class="grid g4 keep2 mt">
    <div class="card stat"><div class="lbl">Agendamentos hoje</div><div class="val num">${d.agendamentos_hoje}</div><div class="sub">${d.concluidos_hoje} concluídos · ${d.pendentes_hoje} pendentes</div></div>
    <div class="card stat hl"><div class="lbl">Faturamento hoje</div><div class="val num">${brl(d.faturamento_hoje)}</div><div class="sub">Receitas lançadas no dia</div></div>
    <div class="card stat"><div class="lbl">Faturamento do mês</div><div class="val num">${brl(d.faturamento_mes)}</div><div class="sub">Despesas: ${brl(d.despesas_mes)}</div></div>
    <div class="card stat"><div class="lbl">Clientes</div><div class="val num">${d.clientes_total}</div><div class="sub">${d.clientes_novos_mes} novos no mês · ${d.cancelamentos_mes} cancelamentos</div></div>
  </div>
  <div class="grid g-main mt">
    <div class="card"><div class="row between"><h3>Agenda de hoje</h3><a class="btn sm" href="#/agenda">Abrir agenda</a></div>
      <div class="ag-list">${d.agenda_hoje.length ? d.agenda_hoje.map(item).join('') : vazio('Nenhum agendamento hoje', 'Crie um horário na agenda ou compartilhe sua página de agendamento.', '<button class="btn primary" data-act="ag-novo">Novo agendamento</button>')}</div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Próximos atendimentos</h3><div class="ag-list">${d.proximos.length ? d.proximos.map((a) => `<div class="it" data-act="ag-abrir" data-id="${a.id}"><div class="time num">${a.inicio.slice(0, 10) === d.hoje ? hora(a.inicio) : fmtDM(a.inicio.slice(0, 10))}</div><div class="grow"><b>${esc(a.cliente_nome)}</b><div class="muted small">${esc(a.servico_nome)}${a.inicio.slice(0, 10) !== d.hoje ? ' · ' + hora(a.inicio) : ''}</div></div></div>`).join('') : '<p class="muted">Sem atendimentos futuros marcados.</p>'}</div></div>
      <div class="card"><h3>Sua página de agendamento</h3><p class="muted small" style="margin-top:-6px">Envie este link para seus clientes marcarem sozinhos.</p>
        <input class="inp" readonly value="${esc(urlPublica())}" aria-label="Link da página de agendamento">
        <div class="row mt-s"><button class="btn primary sm" data-act="copiar-link">${icon('link')} Copiar link</button><a class="btn sm" href="${esc(urlPublica())}" target="_blank" rel="noopener">Abrir página</a></div></div>
    </div>
  </div>
  ${d.graficos_liberados ? `  <div class="grid g3 mt">
    <div class="card"><h3>Faturamento — últimos 7 dias</h3>${chartBarras(dias, ['#7c3aed'], brl)}</div>
    <div class="card"><h3>Agendamentos — últimos 7 dias</h3>${chartBarras(ags, ['#a78bfa'], (v) => v + ' agend.')}</div>
    <div class="card"><h3>Serviços mais procurados <span class="muted small">(30 dias)</span></h3>${barrasH(d.servicos_top.map((s) => ({ l: s.nome, v: s.quantidade })))}</div>
  </div>` : `<div class="card mt"><h3>Gráficos do painel</h3><p class="muted">Faturamento, agendamentos e serviços mais procurados dos últimos dias. Disponível no plano Premium. <a href="#/assinatura">Ver planos</a></p></div>`}`;
};
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.it[data-act]')) e.target.click(); });

/* =============== AGENDA =============== */
AX.ag = null;
const PX = 1.15;
VIEWS.agenda = async (el) => {
  if (!AX.ag) AX.ag = { data: hoje(), modo: window.innerWidth < 700 ? 'lista' : 'grade', prof: 0 };
  const st = AX.ag;
  const [profsTodos, ags] = await Promise.all([api('/api/profissionais'), api('/api/agendamentos?' + qs({ de: st.data, ate: st.data }))]);
  cacheAgs(ags);
  let profs = profsTodos.filter((p) => p.ativo);
  if (st.prof) profs = profs.filter((p) => p.id === st.prof);
  const titulo = nomeDia(st.data, { weekday: 'long', day: 'numeric', month: 'long' });
  const cab = `<div class="agenda-head">
    <button class="btn" data-act="ag-dia" data-n="-1" aria-label="Dia anterior">${icon('esq')}</button>
    <div class="title">${esc(titulo)}</div>
    <button class="btn" data-act="ag-dia" data-n="1" aria-label="Próximo dia">${icon('dir')}</button>
    <button class="btn" data-act="ag-hoje">Hoje</button>
    <input class="inp" type="date" id="ag-data" value="${st.data}" style="width:auto" aria-label="Escolher data">
    <select class="inp" id="ag-prof" style="width:auto" aria-label="Filtrar profissional"><option value="0">Todos os profissionais</option>${profsTodos.filter((p) => p.ativo).map((p) => `<option value="${p.id}" ${p.id === st.prof ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
    <div class="grow"></div>
    <div class="tabs" style="margin:0;border:0"><button class="${st.modo === 'grade' ? 'on' : ''}" data-act="ag-modo" data-m="grade">Grade</button><button class="${st.modo === 'lista' ? 'on' : ''}" data-act="ag-modo" data-m="lista">Lista</button></div>
    <button class="btn primary" data-act="ag-novo">${icon('plus')} Novo agendamento</button></div>`;
  let corpo;
  if (st.modo === 'lista') {
    corpo = `<div class="card">${ags.length ? `<div class="ag-list">${ags.filter((a) => !st.prof || a.profissional_id === st.prof).map((a) => `<div class="it" data-act="ag-abrir" data-id="${a.id}" tabindex="0">
      <div class="time num">${hora(a.inicio)}</div><span class="dot" style="background:${esc(a.profissional_cor)}"></span>
      <div class="grow"><b>${esc(a.cliente_nome)}</b><div class="muted small">${esc(a.servico_nome)} · ${esc(a.profissional_nome)} · até ${hora(a.fim)}</div></div>
      <div class="right"><div class="num"><b>${brl(a.preco)}</b></div>${badge(a.status)}</div></div>`).join('')}</div>` : vazio('Dia livre', 'Nenhum agendamento para esta data.', '<button class="btn primary" data-act="ag-novo">Novo agendamento</button>')}</div>`;
  } else if (!profs.length) {
    corpo = `<div class="card">${vazio('Nenhum profissional ativo', 'Cadastre um profissional para usar a agenda.', '<a class="btn primary" href="#/profissionais">Ir para profissionais</a>')}</div>`;
  } else {
    const dow = new Date(st.data + 'T12:00:00Z').getUTCDay();
    const vis = ags.filter((a) => (a.status === 'agendado' || a.status === 'concluido') && profs.some((p) => p.id === a.profissional_id));
    let ini = 8 * 60, fim = 20 * 60;
    const trab = profs.filter((p) => p.horarios[dow].ativo);
    if (trab.length) { ini = Math.min(...trab.map((p) => minDe(p.horarios[dow].inicio))); fim = Math.max(...trab.map((p) => minDe(p.horarios[dow].fim))); }
    vis.forEach((a) => { ini = Math.min(ini, minDe(hora(a.inicio))); fim = Math.max(fim, minDe(hora(a.fim))); });
    ini = Math.floor(ini / 60) * 60; fim = Math.min(24 * 60, Math.ceil(fim / 60) * 60);
    const H = (fim - ini) * PX;
    let horas = '';
    for (let m = ini; m <= fim; m += 60) horas += `<span class="cal-h" style="top:${(m - ini) * PX}px">${String(m / 60).padStart(2, '0')}:00</span>`;
    let linhas = '';
    for (let m = ini; m < fim; m += 60) linhas += `<div class="cal-line" style="top:${(m - ini) * PX}px"></div>`;
    const agora = st.data === hoje() ? agoraMin() : -1;
    const cols = profs.map((p) => {
      const h = p.horarios[dow];
      let off = '';
      if (!h.ativo) off = `<div class="cal-off" style="top:0;height:${H}px"></div>`;
      else {
        const a = minDe(h.inicio), b = minDe(h.fim);
        if (a > ini) off += `<div class="cal-off" style="top:0;height:${(a - ini) * PX}px"></div>`;
        if (b < fim) off += `<div class="cal-off" style="top:${(b - ini) * PX}px;height:${(fim - b) * PX}px"></div>`;
      }
      const evs = vis.filter((a) => a.profissional_id === p.id).map((a) => {
        const t = (minDe(hora(a.inicio)) - ini) * PX, hh = Math.max(24, (minDe(hora(a.fim)) - minDe(hora(a.inicio))) * PX - 2);
        return `<div class="ev st-${esc(a.status)}" data-act="ag-abrir" data-id="${a.id}" style="top:${t}px;height:${hh}px;background:${esc(p.cor)}22;border-color:${esc(p.cor)}" tabindex="0">
          <b>${hora(a.inicio)} · ${esc(a.cliente_nome)}</b>${esc(a.servico_nome)}</div>`;
      }).join('');
      const nowl = agora >= ini && agora <= fim ? `<div class="now-line" style="top:${(agora - ini) * PX}px"></div>` : '';
      return `<div class="cal-col"><div class="cal-hd"><span class="dot" style="background:${esc(p.cor)}"></span>${esc(p.nome)}</div>
        <div class="cal-body" style="height:${H}px;cursor:pointer" data-act="cal-click" data-prof="${p.id}" data-ini="${ini}">${linhas}${off}${evs}${nowl}</div></div>`;
    }).join('');
    corpo = `<div class="cal" style="grid-template-columns:54px repeat(${profs.length},minmax(170px,1fr))">
      <div class="cal-hours"><div class="cal-hd"></div><div class="cal-body" style="height:${H}px">${horas}</div></div>${cols}</div>
      <p class="muted small mt-s">Toque em um horário vazio para agendar. Áreas listradas estão fora do expediente.</p>`;
  }
  el.innerHTML = cab + corpo;
  $('#ag-data').addEventListener('change', (e) => { if (e.target.value) { st.data = e.target.value; recarregar(); } });
  $('#ag-prof').addEventListener('change', (e) => { st.prof = parseInt(e.target.value, 10) || 0; recarregar(); });
  const cal = $('.cal'); if (cal && st.data === hoje()) { const t = Math.max(0, (agoraMin() - 8 * 60) * PX - 100); cal.scrollTop = t; }
};
act('ag-dia', (b) => { AX.ag.data = somaDias(AX.ag.data, parseInt(b.dataset.n, 10)); recarregar(); });
act('ag-hoje', () => { AX.ag.data = hoje(); recarregar(); });
act('ag-modo', (b) => { AX.ag.modo = b.dataset.m; recarregar(); });
act('ag-novo', () => formAgendamento({ data: AX.ag ? AX.ag.data : hoje() }));
act('cal-click', (b, e) => {
  const r = b.getBoundingClientRect();
  const passo = AX.me.estabelecimento.intervalo_slots || 30;
  let m = parseInt(b.dataset.ini, 10) + Math.floor((e.clientY - r.top) / PX / passo) * passo;
  formAgendamento({ data: AX.ag.data, profissional_id: parseInt(b.dataset.prof, 10), hora: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') });
});

async function formAgendamento(pre) {
  pre = pre || {};
  const [clientes, servicos, profs] = await Promise.all([api('/api/clientes'), api('/api/servicos'), api('/api/profissionais')]);
  const sv = servicos.filter((s) => s.ativo), pf = profs.filter((p) => p.ativo);
  if (!sv.length) { toast('Cadastre um serviço antes de criar agendamentos.', 'bad'); location.hash = '#/servicos'; return; }
  if (!pf.length) { toast('Cadastre um profissional antes de criar agendamentos.', 'bad'); location.hash = '#/profissionais'; return; }
  const edit = !!pre.id;
  const corpo = `<div class="form-grid">
    <div class="field full"><label class="f" for="a-cli">Cliente</label><select class="inp" id="a-cli"><option value="">Selecione…</option><option value="novo">+ Cadastrar novo cliente</option>${clientes.map((c) => `<option value="${c.id}">${esc(c.nome)}${c.telefone ? ' — ' + esc(c.telefone) : ''}</option>`).join('')}</select></div>
    <div class="full hide" id="a-novo"><div class="form-grid"><div class="field"><label class="f" for="a-nome">Nome do cliente</label><input class="inp" id="a-nome" maxlength="100"></div><div class="field"><label class="f" for="a-tel">Telefone</label><input class="inp" id="a-tel" type="tel" maxlength="30"></div></div></div>
    <div class="field"><label class="f" for="a-srv">Serviço</label><select class="inp" id="a-srv">${sv.map((s) => `<option value="${s.id}">${esc(s.nome)} — ${brl(s.preco)} · ${s.duracao_min} min</option>`).join('')}</select></div>
    <div class="field"><label class="f" for="a-prof">Profissional</label><select class="inp" id="a-prof"></select></div>
    <div class="field"><label class="f" for="a-data">Data</label><input class="inp" type="date" id="a-data"></div>
    <div class="field"><label class="f" for="a-hora">Hora</label><input class="inp" type="time" id="a-hora" step="300"></div>
    <div class="field full"><div class="hint" id="a-slots-t">Horários livres do profissional neste dia:</div><div class="slots" id="a-slots"></div></div>
    <div class="field"><label class="f" for="a-preco">Valor (R$)</label><input class="inp" id="a-preco" inputmode="decimal" placeholder="Valor do serviço"></div>
    <div class="field"><label class="f" for="a-obs">Observações</label><input class="inp" id="a-obs" maxlength="500"></div></div>`;
  const bg = modal({
    titulo: edit ? 'Editar agendamento' : 'Novo agendamento', largo: true, corpo, rotuloSalvar: edit ? 'Salvar alterações' : 'Agendar',
    salvar: async () => {
      const cli = $('#a-cli').value;
      if (!cli) throw new Error('Selecione ou cadastre o cliente.');
      const corpoReq = { servico_id: $('#a-srv').value, profissional_id: $('#a-prof').value, data: $('#a-data').value, hora: $('#a-hora').value, preco: $('#a-preco').value, observacoes: $('#a-obs').value };
      if (!corpoReq.profissional_id) throw new Error('Nenhum profissional realiza este serviço.');
      if (!corpoReq.hora) throw new Error('Informe o horário.');
      if (cli === 'novo') corpoReq.novo_cliente = { nome: $('#a-nome').value, telefone: $('#a-tel').value }; else corpoReq.cliente_id = cli;
      await api(edit ? '/api/agendamentos/' + pre.id : '/api/agendamentos', edit ? 'PUT' : 'POST', corpoReq);
      fecharModal(); toast(edit ? 'Agendamento atualizado.' : 'Agendamento criado.', 'ok'); recarregar();
    },
  });
  const selProf = $('#a-prof', bg);
  function atualizarProfs() {
    const sid = parseInt($('#a-srv', bg).value, 10), atual = selProf.value;
    const ok = pf.filter((p) => p.servicos.includes(sid));
    selProf.innerHTML = ok.length ? ok.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('') : '<option value="">Nenhum profissional realiza este serviço</option>';
    if (ok.some((p) => String(p.id) === atual)) selProf.value = atual;
    const s = sv.find((x) => x.id === sid); if (s) $('#a-preco', bg).placeholder = brl(s.preco);
  }
  let tok = 0;
  async function atualizarSlots() {
    const box = $('#a-slots', bg), sid = $('#a-srv', bg).value, pid = selProf.value, data = $('#a-data', bg).value;
    if (!sid || !pid || !data) { box.innerHTML = ''; return; }
    const meu = ++tok;
    try {
      const r = await api('/api/disponibilidade?' + qs({ servico_id: sid, profissional_id: pid, data }));
      if (meu !== tok) return;
      const livres = r.slots.filter((h) => !(edit && false));
      box.innerHTML = livres.length ? livres.map((h) => `<button type="button" class="slot ${h === $('#a-hora', bg).value ? 'on' : ''}" data-act="slot-pick" data-h="${h}">${h}</button>`).join('') : '<span class="muted small">Sem horários livres neste dia (você ainda pode digitar um horário).</span>';
    } catch (_) { box.innerHTML = ''; }
  }
  bg.addEventListener('change', (e) => {
    if (e.target.id === 'a-cli') $('#a-novo', bg).classList.toggle('hide', e.target.value !== 'novo');
    if (e.target.id === 'a-srv') atualizarProfs();
    if (['a-srv', 'a-prof', 'a-data'].includes(e.target.id)) atualizarSlots();
    if (e.target.id === 'a-hora') $$('.slot', bg).forEach((s) => s.classList.toggle('on', s.dataset.h === e.target.value));
  });
  if (pre.cliente_id) $('#a-cli', bg).value = pre.cliente_id;
  if (pre.servico_id && sv.some((s) => s.id === pre.servico_id)) $('#a-srv', bg).value = pre.servico_id;
  atualizarProfs();
  if (pre.profissional_id) { const o = $$('option', selProf).find((x) => x.value === String(pre.profissional_id)); if (o) selProf.value = String(pre.profissional_id); }
  $('#a-data', bg).value = pre.data || hoje();
  if (pre.hora) $('#a-hora', bg).value = pre.hora;
  if (pre.preco != null && edit) $('#a-preco', bg).value = pre.preco;
  if (pre.observacoes) $('#a-obs', bg).value = pre.observacoes;
  atualizarSlots();
}
AX.formAgendamento = formAgendamento;
act('slot-pick', (b) => { $('#a-hora').value = b.dataset.h; $$('.slot').forEach((s) => s.classList.toggle('on', s === b)); });

function detalheAgendamento(a) {
  const linhas = [['Cliente', `${esc(a.cliente_nome)}${a.cliente_telefone ? ' · ' + esc(a.cliente_telefone) : ''}`], ['Serviço', esc(a.servico_nome)], ['Profissional', esc(a.profissional_nome)],
    ['Data', `${fmtData(a.inicio.slice(0, 10))} das ${hora(a.inicio)} às ${hora(a.fim)}`], ['Valor', `<b class="num">${brl(a.preco)}</b>`]];
  if (a.produtos && a.produtos.length) linhas.splice(3, 0, ['Produtos', a.produtos.map((p) => `${p.qtd > 1 ? p.qtd + 'x ' : ''}${esc(p.nome)} (${brl(p.preco * p.qtd)})`).join('<br>')]);
  if (a.comissao_valor != null) linhas.push(['Comissão', brl(a.comissao_valor)]);
  linhas.push(['Origem', a.origem === 'online' ? 'Página de agendamento online' : 'Cadastrado no sistema']);
  if (a.observacoes) linhas.push(['Observações', esc(a.observacoes)]);
  return `<div class="row between" style="margin-bottom:12px"><span class="muted">Status</span>${badge(a.status)}</div>` +
    linhas.map(([k, v]) => `<div class="row between" style="padding:7px 0;border-top:1px solid #f0ecf9"><span class="muted">${k}</span><span style="text-align:right">${v}</span></div>`).join('');
}
act('ag-abrir', async (b) => {
  let a = AX.agCache[b.dataset.id];
  if (!a || !a.produtos) { const l = await api('/api/agendamentos?' + qs({ de: AX.ag ? AX.ag.data : hoje(), ate: AX.ag ? AX.ag.data : hoje() })); cacheAgs(l); a = AX.agCache[b.dataset.id]; }
  if (!a) return;
  let extra = '';
  if (a.status === 'agendado') extra = `<button class="btn ok" data-act="ag-concluir" data-id="${a.id}">Concluir atendimento</button><button class="btn" data-act="ag-editar" data-id="${a.id}">Editar</button><button class="btn" data-act="ag-faltou" data-id="${a.id}">Marcar falta</button><button class="btn danger" data-act="ag-cancelar" data-id="${a.id}">Cancelar</button>`;
  else if (a.status === 'concluido') extra = `<button class="btn danger" data-act="ag-cancelar" data-id="${a.id}">Cancelar atendimento</button>`;
  modal({ titulo: 'Agendamento', corpo: detalheAgendamento(a), semRodape: true });
  const ft = document.createElement('div'); ft.className = 'modal-ft'; ft.innerHTML = extra + '<button class="btn" data-act="modal-fechar">Fechar</button>';
  $('.modal').appendChild(ft);
});
act('ag-editar', (b) => { const a = AX.agCache[b.dataset.id]; fecharModal(); formAgendamento({ id: a.id, cliente_id: a.cliente_id, servico_id: a.servico_id, profissional_id: a.profissional_id, data: a.inicio.slice(0, 10), hora: hora(a.inicio), preco: a.preco, observacoes: a.observacoes }); });
act('ag-concluir', (b) => {
  const a = AX.agCache[b.dataset.id];
  modal({ titulo: 'Concluir atendimento', rotuloSalvar: 'Concluir e lançar receita', corpo: `<p class="muted">${esc(a.cliente_nome)} — ${esc(a.servico_nome)}</p><div class="field"><label class="f" for="c-valor">Valor recebido (R$)</label><input class="inp" id="c-valor" inputmode="decimal" value="${String(a.preco).replace('.', ',')}"></div><p class="hint">A receita entra no financeiro e a comissão do profissional é calculada.</p>`,
    salvar: async () => { await api(`/api/agendamentos/${a.id}/concluir`, 'POST', { valor: $('#c-valor').value }); fecharModal(); toast('Atendimento concluído.', 'ok'); recarregar(); } });
});
act('ag-faltou', async (b) => { if (!(await confirmar('Marcar este cliente como faltante? O horário volta a ficar livre.', 'Marcar falta'))) return; await api(`/api/agendamentos/${b.dataset.id}/faltou`, 'POST'); toast('Falta registrada.'); recarregar(); });
act('ag-cancelar', async (b) => {
  const a = AX.agCache[b.dataset.id];
  if (!(await confirmar(a.status === 'concluido' ? 'Cancelar este atendimento concluído? A receita lançada será removida.' : 'Cancelar este agendamento? O horário volta a ficar livre.', 'Cancelar agendamento', true))) return;
  await api(`/api/agendamentos/${a.id}/cancelar`, 'POST'); toast('Agendamento cancelado.'); recarregar();
});

/* =============== CLIENTES =============== */
VIEWS.clientes = async (el) => {
  const busca = AX.buscaCli || '';
  el.innerHTML = `<div class="toolbar"><input class="inp grow" id="cli-q" type="search" placeholder="Buscar por nome, telefone ou e-mail" value="${esc(busca)}" aria-label="Buscar clientes">${temRecurso('exportar_clientes') ? '<a class="btn" href="/api/export/clientes.csv">Exportar CSV</a>' : ''}<button class="btn primary" data-act="cli-novo">${icon('plus')} Novo cliente</button></div><div class="card" id="cli-lista"></div>`;
  async function lista() {
    const l = await api('/api/clientes?' + qs({ q: AX.buscaCli }));
    $('#cli-lista').innerHTML = l.length ? `<div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th>Telefone</th><th class="r">Atendimentos</th><th class="r">Total gasto</th><th>Último atendimento</th></tr></thead><tbody>${l.map((c) => `<tr data-act="cli-ficha" data-id="${c.id}" style="cursor:pointer">
      <td><div class="row gap-s" style="flex-wrap:nowrap"><span class="avatar">${esc(iniciais(c.nome))}</span><b>${esc(c.nome)}</b></div></td><td>${esc(c.telefone) || '—'}</td><td class="r num">${c.atendimentos}</td><td class="r num">${brl(c.total_gasto)}</td><td>${c.ultimo_atendimento ? fmtData(c.ultimo_atendimento.slice(0, 10)) : '—'}</td></tr>`).join('')}</tbody></table></div>`
      : (AX.buscaCli ? vazio('Nenhum cliente encontrado', 'Tente outro nome ou telefone.') : vazio('Nenhum cliente ainda', 'Clientes são criados ao agendar ou quando agendam pela sua página.', '<button class="btn primary" data-act="cli-novo">Cadastrar primeiro cliente</button>'));
  }
  let t; $('#cli-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { AX.buscaCli = e.target.value; lista().catch(erroToast); }, 250); });
  await lista();
};
function formCliente(c) {
  c = c || {};
  modal({ titulo: c.id ? 'Editar cliente' : 'Novo cliente', rotuloSalvar: 'Salvar cliente',
    corpo: `<div class="form-grid"><div class="field full"><label class="f" for="k-nome">Nome</label><input class="inp" id="k-nome" maxlength="100" value="${esc(c.nome)}"></div>
    <div class="field"><label class="f" for="k-tel">Telefone</label><input class="inp" id="k-tel" type="tel" maxlength="30" value="${esc(c.telefone)}"></div>
    <div class="field"><label class="f" for="k-email">E-mail</label><input class="inp" id="k-email" type="email" maxlength="160" value="${esc(c.email)}"></div>
    <div class="field full"><label class="f" for="k-obs">Observações</label><textarea class="inp" id="k-obs" maxlength="1000" placeholder="Preferências, alergias, estilo de corte…">${esc(c.observacoes)}</textarea></div></div>`,
    salvar: async () => { await api(c.id ? '/api/clientes/' + c.id : '/api/clientes', c.id ? 'PUT' : 'POST', { nome: $('#k-nome').value, telefone: $('#k-tel').value, email: $('#k-email').value, observacoes: $('#k-obs').value }); fecharModal(); toast('Cliente salvo.', 'ok'); recarregar(); } });
}
act('cli-novo', () => formCliente());
act('cli-ficha', async (b) => {
  const c = await api('/api/clientes/' + b.dataset.id); cacheAgs(c.historico); AX.cliAtual = c;
  const hist = c.historico_liberado === false ? '<p class="muted">O histórico de atendimentos está disponível a partir do plano Básico. <a href="#/assinatura" data-act="modal-fechar">Ver planos</a></p>' : c.historico.length ? `<div class="ag-list">${c.historico.map((a) => `<div class="it" data-act="ag-abrir" data-id="${a.id}"><div class="time num" style="min-width:84px">${fmtData(a.inicio.slice(0, 10))}<div class="muted small">${hora(a.inicio)}</div></div><div class="grow"><b>${esc(a.servico_nome)}</b><div class="muted small">${esc(a.profissional_nome)}</div></div><div class="right num">${brl(a.preco)}<div>${badge(a.status)}</div></div></div>`).join('')}</div>` : '<p class="muted">Ainda sem atendimentos.</p>';
  modal({ titulo: c.nome, largo: true, semRodape: true, corpo: `<div class="grid g3 keep2" style="margin-bottom:16px"><div><div class="muted small">Telefone</div><b>${esc(c.telefone) || '—'}</b></div><div><div class="muted small">E-mail</div><b>${esc(c.email) || '—'}</b></div><div><div class="muted small">Total gasto</div><b class="num">${brl(c.total_gasto)}</b> <span class="muted small">(${c.atendimentos} atend.)</span></div></div>
    ${c.observacoes ? `<div class="card flat" style="margin-bottom:16px"><div class="muted small">Observações</div>${esc(c.observacoes)}</div>` : ''}<h3 style="margin-bottom:6px">Histórico de atendimentos</h3>${hist}` });
  const ft = document.createElement('div'); ft.className = 'modal-ft';
  ft.innerHTML = `<button class="btn danger" data-act="cli-excluir" data-id="${c.id}">Excluir</button><button class="btn" data-act="cli-editar">Editar</button><button class="btn primary" data-act="cli-agendar">Novo agendamento</button>`;
  $('.modal').appendChild(ft);
});
act('cli-editar', () => formCliente(AX.cliAtual));
act('cli-agendar', () => formAgendamento({ cliente_id: AX.cliAtual.id }));
act('cli-excluir', async (b) => { if (!(await confirmar('Excluir este cliente? Esta ação não pode ser desfeita.', 'Excluir', true))) return; await api('/api/clientes/' + b.dataset.id, 'DELETE'); toast('Cliente excluído.'); recarregar(); });

/* =============== SERVIÇOS =============== */
VIEWS.servicos = async (el) => {
  const [lista, profs] = await Promise.all([api('/api/servicos'), api('/api/profissionais')]);
  AX.servicosCache = lista; AX.profsCache = profs;
  el.innerHTML = `<div class="toolbar"><div class="grow muted">Estes serviços aparecem na sua página de agendamento, com foto, preço e duração.</div><button class="btn primary" data-act="srv-novo">${icon('plus')} Novo serviço</button></div>` +
    (lista.length ? `<div class="svc-grid">${lista.map((s) => `<div class="svc ${s.ativo ? '' : 'off'}"><div class="ph">${s.foto ? `<img src="${esc(s.foto)}" alt="Foto de ${esc(s.nome)}" loading="lazy">` : icon('servicos')}</div>
      <div class="bd"><div class="row between" style="flex-wrap:nowrap"><b>${esc(s.nome)}</b>${s.ativo ? '' : '<span class="badge b-faltou">Inativo</span>'}</div><p>${esc(s.descricao) || 'Sem descrição.'}</p>
      <div class="row between"><span class="price num">${brl(s.preco)}</span><span class="muted small">${s.duracao_min} min · ${s.profissionais.length} prof.</span></div>
      <button class="btn sm" data-act="srv-editar" data-id="${s.id}">Editar</button></div></div>`).join('')}</div>` : `<div class="card">${vazio('Cadastre seu primeiro serviço', 'Adicione nome, preço, duração e uma foto para seus clientes escolherem.', '<button class="btn primary" data-act="srv-novo">Novo serviço</button>')}</div>`);
};
function formServico(s) {
  s = s || { profissionais: [] };
  const profs = (AX.profsCache || []).filter((p) => p.ativo || s.profissionais.includes(p.id));
  const bg = modal({ titulo: s.id ? 'Editar serviço' : 'Novo serviço', largo: true, rotuloSalvar: 'Salvar serviço',
    extra: s.id ? `<button class="btn danger" data-act="srv-excluir" data-id="${s.id}" style="margin-right:auto">Excluir</button>` : '',
    corpo: `<div class="form-grid"><div class="field full"><label class="f">Foto do serviço</label>${fotoPicker('srv', s.foto)}</div>
    <div class="field full"><label class="f" for="s-nome">Nome</label><input class="inp" id="s-nome" maxlength="80" value="${esc(s.nome)}" placeholder="Ex.: Corte masculino"></div>
    <div class="field full"><label class="f" for="s-desc">Descrição</label><textarea class="inp" id="s-desc" maxlength="500" placeholder="O que está incluído no serviço">${esc(s.descricao)}</textarea></div>
    <div class="field"><label class="f" for="s-preco">Preço (R$)</label><input class="inp" id="s-preco" inputmode="decimal" value="${s.preco != null ? String(s.preco).replace('.', ',') : ''}"></div>
    <div class="field"><label class="f" for="s-dur">Duração (minutos)</label><input class="inp" id="s-dur" type="number" min="5" max="600" step="5" value="${s.duracao_min || 30}"></div>
    <div class="field full"><label class="f">Quem realiza este serviço</label><div class="chips">${profs.length ? profs.map((p) => `<label class="chip"><input type="checkbox" name="s-prof" value="${p.id}" ${s.profissionais.includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('') : '<span class="muted small">Cadastre profissionais primeiro.</span>'}</div><div class="hint">Só profissionais marcados aparecem para este serviço na agenda e na página de agendamento.</div></div>
    ${s.id ? `<label class="chk full"><input type="checkbox" id="s-ativo" ${s.ativo ? 'checked' : ''}> Serviço ativo (visível para clientes)</label>` : ''}</div>`,
    salvar: async (m) => {
      const corpo = { nome: $('#s-nome').value, descricao: $('#s-desc').value, preco: $('#s-preco').value, duracao_min: $('#s-dur').value, profissionais: $$('input[name=s-prof]:checked', m).map((i) => i.value), ...dadosFoto(m, 'srv') };
      if (s.id) corpo.ativo = $('#s-ativo').checked;
      await api(s.id ? '/api/servicos/' + s.id : '/api/servicos', s.id ? 'PUT' : 'POST', corpo);
      fecharModal(); toast('Serviço salvo.', 'ok'); recarregar();
    } });
  return bg;
}
act('srv-novo', () => formServico());
act('srv-editar', (b) => formServico(AX.servicosCache.find((s) => String(s.id) === b.dataset.id)));
act('srv-excluir', async (b) => {
  if (!(await confirmar('Excluir este serviço? Se ele já tiver atendimentos, será apenas desativado.', 'Excluir', true))) return;
  const r = await api('/api/servicos/' + b.dataset.id, 'DELETE'); fecharModal(); toast(r.desativado ? 'Serviço desativado (possui histórico).' : 'Serviço excluído.'); recarregar();
});


/* =============== PRODUTOS =============== */
VIEWS.produtos = async (el) => {
  const lista = await api('/api/produtos');
  AX.produtosCache = lista;
  el.innerHTML = `<div class="toolbar"><div class="grow muted">Seus clientes podem adicionar estes produtos ao agendar. Se não quiserem, é só marcar o horário.</div><button class="btn primary" data-act="prd-novo">${icon('plus')} Novo produto</button></div>` +
    (lista.length ? `<div class="svc-grid">${lista.map((s) => `<div class="svc ${s.ativo ? '' : 'off'}"><div class="ph">${s.foto ? `<img src="${esc(s.foto)}" alt="Foto de ${esc(s.nome)}" loading="lazy">` : icon('caixa')}</div>
      <div class="bd"><div class="row between" style="flex-wrap:nowrap"><b>${esc(s.nome)}</b>${s.ativo ? '' : '<span class="badge b-faltou">Inativo</span>'}</div><p>${esc(s.descricao) || 'Sem descrição.'}</p>
      <div class="row between"><span class="price num">${brl(s.preco)}</span></div>
      <button class="btn sm" data-act="prd-editar" data-id="${s.id}">Editar</button></div></div>`).join('')}</div>` : `<div class="card">${vazio('Cadastre seu primeiro produto', 'Adicione nome, preço e uma foto. Ele aparece como opção na hora do cliente agendar.', '<button class="btn primary" data-act="prd-novo">Novo produto</button>')}</div>`);
};
function formProduto(s) {
  s = s || {};
  modal({ titulo: s.id ? 'Editar produto' : 'Novo produto', largo: true, rotuloSalvar: 'Salvar produto',
    extra: s.id ? `<button class="btn danger" data-act="prd-excluir" data-id="${s.id}" style="margin-right:auto">Excluir</button>` : '',
    corpo: `<div class="form-grid"><div class="field full"><label class="f">Foto do produto</label>${fotoPicker('prd', s.foto)}</div>
    <div class="field full"><label class="f" for="pd-nome">Nome</label><input class="inp" id="pd-nome" maxlength="80" value="${esc(s.nome)}" placeholder="Ex.: Pomada modeladora"></div>
    <div class="field full"><label class="f" for="pd-desc">Descrição</label><textarea class="inp" id="pd-desc" maxlength="300">${esc(s.descricao)}</textarea></div>
    <div class="field"><label class="f" for="pd-preco">Preço (R$)</label><input class="inp" id="pd-preco" inputmode="decimal" value="${s.preco != null ? String(s.preco).replace('.', ',') : ''}"></div>
    ${s.id ? `<label class="chk full"><input type="checkbox" id="pd-ativo" ${s.ativo ? 'checked' : ''}> Produto ativo (visível para clientes)</label>` : ''}</div>`,
    salvar: async (m) => {
      const corpo = { nome: $('#pd-nome').value, descricao: $('#pd-desc').value, preco: $('#pd-preco').value, ...dadosFoto(m, 'prd') };
      if (s.id) corpo.ativo = $('#pd-ativo').checked;
      await api(s.id ? '/api/produtos/' + s.id : '/api/produtos', s.id ? 'PUT' : 'POST', corpo);
      fecharModal(); toast('Produto salvo.', 'ok'); recarregar();
    } });
}
act('prd-novo', () => formProduto());
act('prd-editar', (b) => formProduto(AX.produtosCache.find((s) => String(s.id) === b.dataset.id)));
act('prd-excluir', async (b) => {
  if (!(await confirmar('Excluir este produto? Os agendamentos antigos continuam com o registro dele.', 'Excluir', true))) return;
  await api('/api/produtos/' + b.dataset.id, 'DELETE'); fecharModal(); toast('Produto excluído.'); recarregar();
});

document.addEventListener('click', (e) => { if (e.target.closest('[data-act=copiar-link]') || e.target.closest('a[href*="/agendar/"]')) { try { localStorage.setItem('ax_link_ok', '1'); } catch (_) { /* sem storage */ } } }, true);
