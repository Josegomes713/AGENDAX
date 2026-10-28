/* Telas avançadas: profissionais, financeiro, comissões, relatórios, configurações */

/* ---------- Seletor de período compartilhado ---------- */
function aplicarPreset(st, p) {
  const h = hoje();
  st.preset = p;
  if (p === 'hoje') { st.de = h; st.ate = h; }
  else if (p === '7d') { st.de = somaDias(h, -6); st.ate = h; }
  else if (p === '30d') { st.de = somaDias(h, -29); st.ate = h; }
  else if (p === 'mes') { st.de = h.slice(0, 8) + '01'; st.ate = h; }
  else if (p === 'mespassado') {
    const d = new Date(h.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0);
    st.ate = d.toISOString().slice(0, 10); st.de = st.ate.slice(0, 8) + '01';
  }
}
function periodoHtml(st) {
  const opt = (v, t) => `<option value="${v}" ${st.preset === v ? 'selected' : ''}>${t}</option>`;
  return `<select class="inp" id="per-preset" aria-label="Período">${opt('hoje', 'Hoje')}${opt('7d', 'Últimos 7 dias')}${opt('30d', 'Últimos 30 dias')}${opt('mes', 'Este mês')}${opt('mespassado', 'Mês passado')}${opt('custom', 'Personalizado')}</select>
    <input class="inp" type="date" id="per-de" value="${st.de}" aria-label="De"><input class="inp" type="date" id="per-ate" value="${st.ate}" aria-label="Até">`;
}
function ligarPeriodo(st) {
  $('#per-preset').addEventListener('change', (e) => { if (e.target.value !== 'custom') aplicarPreset(st, e.target.value); else st.preset = 'custom'; recarregar(); });
  const mudou = () => { st.de = $('#per-de').value || st.de; st.ate = $('#per-ate').value || st.ate; st.preset = 'custom'; recarregar(); };
  $('#per-de').addEventListener('change', mudou); $('#per-ate').addEventListener('change', mudou);
}
const novoPeriodo = (p) => { const st = {}; aplicarPreset(st, p); return st; };

/* =============== PROFISSIONAIS =============== */
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
VIEWS.profissionais = async (el) => {
  const [lista, servicos, ass] = await Promise.all([api('/api/profissionais'), api('/api/servicos'), api('/api/assinatura')]);
  AX.profsCache = lista; AX.servicosCache = servicos;
  const max = AX.me.assinatura.plano.max_profissionais;
  const resumoHorario = (p) => { const d = ORDEM_DIAS.filter((i) => p.horarios[i].ativo); return d.length ? d.map((i) => DIAS[i].slice(0, 3)).join(', ') + ' · ' + p.horarios[d[0]].inicio + '–' + p.horarios[d[0]].fim : 'Sem expediente'; };
  el.innerHTML = `<div class="toolbar"><div class="grow muted">${ass.profissionais_ativos} de ${max == null ? 'ilimitados' : max} profissional(is) ativo(s) no plano ${esc(AX.me.assinatura.plano.nome)}.</div><button class="btn primary" data-act="prof-novo">${icon('plus')} Novo profissional</button></div>` +
    (lista.length ? `<div class="svc-grid">${lista.map((p) => `<div class="svc ${p.ativo ? '' : 'off'}"><div class="bd" style="gap:10px">
      <div class="row" style="flex-wrap:nowrap">${p.foto ? `<img class="avatar" src="${esc(p.foto)}" alt="">` : `<span class="avatar" style="background:${esc(p.cor)}22;color:${esc(p.cor)}">${esc(iniciais(p.nome))}</span>`}
      <div class="grow"><b>${esc(p.nome)}</b> ${p.ativo ? '' : '<span class="badge b-faltou">Inativo</span>'}<div class="muted small">${esc(p.telefone) || 'Sem telefone'}</div></div><span class="dot" style="background:${esc(p.cor)}" title="Cor na agenda"></span></div>
      <div class="small muted">${esc(resumoHorario(p))}</div>
      <div class="row between small"><span>${p.servicos.length} serviço(s)</span><span>Comissão: <b>${String(p.comissao_percent).replace('.', ',')}%</b></span></div>
      <button class="btn sm" data-act="prof-editar" data-id="${p.id}">Editar</button></div></div>`).join('')}</div>` : `<div class="card">${vazio('Nenhum profissional', 'Cadastre quem atende para liberar a agenda.')}</div>`);
};
function formProf(p) {
  p = p || { cor: '#7c3aed', comissao_percent: 0, servicos: [], horarios: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { ativo: d >= 1 && d <= 6, inicio: '09:00', fim: d === 6 ? '13:00' : '18:00' }])) };
  const svs = (AX.servicosCache || []).filter((s) => s.ativo || p.servicos.includes(s.id));
  modal({ titulo: p.id ? 'Editar profissional' : 'Novo profissional', largo: true, rotuloSalvar: 'Salvar profissional',
    extra: p.id ? `<button class="btn danger" data-act="prof-excluir" data-id="${p.id}" style="margin-right:auto">Excluir</button>` : '',
    corpo: `<div class="form-grid"><div class="field full"><label class="f">Foto (opcional)</label>${fotoPicker('prof', p.foto)}</div>
    <div class="field"><label class="f" for="p-nome">Nome</label><input class="inp" id="p-nome" maxlength="80" value="${esc(p.nome)}"></div>
    <div class="field"><label class="f" for="p-tel">Telefone</label><input class="inp" id="p-tel" type="tel" maxlength="30" value="${esc(p.telefone)}"></div>
    <div class="field"><label class="f" for="p-com">Comissão (%)</label><input class="inp" id="p-com" inputmode="decimal" value="${String(p.comissao_percent).replace('.', ',')}"><div class="hint">Percentual sobre cada atendimento concluído.</div></div>
    <div class="field"><label class="f" for="p-cor">Cor na agenda</label><input class="inp" id="p-cor" type="color" value="${esc(p.cor)}" style="padding:3px;height:40px"></div>
    <div class="field full"><label class="f">Serviços que realiza</label><div class="chips">${svs.length ? svs.map((s) => `<label class="chip"><input type="checkbox" name="p-srv" value="${s.id}" ${p.servicos.includes(s.id) ? 'checked' : ''}>${esc(s.nome)}</label>`).join('') : '<span class="muted small">Cadastre serviços primeiro em Serviços.</span>'}</div></div>
    <div class="field full"><div class="row between"><label class="f" style="margin:0">Horários de trabalho</label><button type="button" class="btn sm ghost" data-act="hr-copiar">Copiar horário de segunda para os dias ativos</button></div>
      <div class="hrs mt-s">${ORDEM_DIAS.map((d) => `<div class="hr-row"><label class="chk"><input type="checkbox" data-d="${d}" data-h="ativo" ${p.horarios[d].ativo ? 'checked' : ''}> ${DIAS[d]}</label><input class="inp" type="time" data-d="${d}" data-h="inicio" value="${p.horarios[d].inicio}" aria-label="Início ${DIAS[d]}"><input class="inp" type="time" data-d="${d}" data-h="fim" value="${p.horarios[d].fim}" aria-label="Fim ${DIAS[d]}"></div>`).join('')}</div></div>
    ${p.id ? `<label class="chk full"><input type="checkbox" id="p-ativo" ${p.ativo ? 'checked' : ''}> Profissional ativo (aparece na agenda e para clientes)</label>` : ''}</div>`,
    salvar: async (m) => {
      const horarios = {};
      for (let d = 0; d < 7; d++) horarios[d] = { ativo: $(`[data-d="${d}"][data-h=ativo]`, m).checked, inicio: $(`[data-d="${d}"][data-h=inicio]`, m).value, fim: $(`[data-d="${d}"][data-h=fim]`, m).value };
      const corpo = { nome: $('#p-nome').value, telefone: $('#p-tel').value, comissao_percent: $('#p-com').value, cor: $('#p-cor').value, horarios, servicos: $$('input[name=p-srv]:checked', m).map((i) => i.value), ...dadosFoto(m, 'prof') };
      if (p.id) corpo.ativo = $('#p-ativo').checked;
      await api(p.id ? '/api/profissionais/' + p.id : '/api/profissionais', p.id ? 'PUT' : 'POST', corpo);
      fecharModal(); toast('Profissional salvo.', 'ok'); recarregar();
    } });
}
act('prof-novo', () => formProf());
act('prof-editar', (b) => formProf(AX.profsCache.find((p) => String(p.id) === b.dataset.id)));
act('hr-copiar', () => {
  const i = $('[data-d="1"][data-h=inicio]').value, f = $('[data-d="1"][data-h=fim]').value;
  $$('[data-h=ativo]').forEach((c) => { if (c.checked) { const d = c.dataset.d; $(`[data-d="${d}"][data-h=inicio]`).value = i; $(`[data-d="${d}"][data-h=fim]`).value = f; } });
});
act('prof-excluir', async (b) => {
  if (!(await confirmar('Excluir este profissional? Se já tiver atendimentos, será apenas desativado.', 'Excluir', true))) return;
  const r = await api('/api/profissionais/' + b.dataset.id, 'DELETE'); fecharModal(); toast(r.desativado ? 'Profissional desativado (possui histórico).' : 'Profissional excluído.'); recarregar();
});

/* =============== FINANCEIRO =============== */
AX.fin = null;
VIEWS.financeiro = async (el) => {
  if (!temRecurso('financeiro')) { el.innerHTML = upgradeCard('Financeiro nos planos pagos', 'Controle receitas, despesas e o saldo do seu negócio. Disponível a partir do plano Básico; durante o teste grátis tudo fica liberado.'); return; }
  if (!AX.fin) AX.fin = novoPeriodo('mes');
  const st = AX.fin, q = qs({ de: st.de, ate: st.ate });
  const [r, lanc] = await Promise.all([api('/api/financeiro/resumo?' + q), api('/api/lancamentos?' + q)]);
  const serie = r.serie.map((s) => ({ l: fmtDM(s.data), t: fmtData(s.data), v: [s.receitas, s.despesas] }));
  const despCat = r.por_categoria.filter((c) => c.tipo === 'despesa').map((c) => ({ l: c.categoria, v: c.total }));
  const recCat = r.por_categoria.filter((c) => c.tipo === 'receita').map((c) => ({ l: c.categoria, v: c.total }));
  el.innerHTML = `<div class="toolbar">${periodoHtml(st)}<div class="grow"></div>${temRecurso('exportar_financeiro') ? `<a class="btn" href="/api/export/financeiro.csv?${q}">Exportar CSV</a>` : ''}<button class="btn ok" data-act="lan-novo" data-t="receita">${icon('plus')} Receita</button><button class="btn danger" data-act="lan-novo" data-t="despesa">${icon('plus')} Despesa</button></div>
  <div class="grid g3 keep2"><div class="card stat"><div class="lbl">Receitas</div><div class="val num" style="color:var(--ok)">${brl(r.receitas)}</div></div>
    <div class="card stat"><div class="lbl">Despesas</div><div class="val num" style="color:var(--bad)">${brl(r.despesas)}</div></div>
    <div class="card stat hl"><div class="lbl">Saldo do período</div><div class="val num">${brl(r.saldo)}</div></div></div>
  <div class="grid g-main mt"><div class="card"><h3>Receitas e despesas por dia</h3><div class="legend"><span><i style="background:#7c3aed"></i>Receitas</span><span><i style="background:#f59e0b"></i>Despesas</span></div>${chartBarras(serie, ['#7c3aed', '#f59e0b'], brl)}</div>
    <div class="card"><h3>Despesas por categoria</h3>${barrasH(despCat, brl)}<h3 style="margin-top:20px">Receitas por categoria</h3>${barrasH(recCat, brl)}</div></div>
  <div class="card mt"><h3>Lançamentos</h3>${lanc.length ? `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th class="r">Valor</th><th></th></tr></thead><tbody>${lanc.map((l) => `<tr><td class="num">${fmtData(l.data)}</td><td><span class="badge b-${l.tipo}">${l.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td><td>${esc(l.descricao)}</td><td>${esc(l.categoria) || '—'}</td><td class="r num"><b style="color:${l.tipo === 'receita' ? 'var(--ok)' : 'var(--bad)'}">${l.tipo === 'despesa' ? '−' : ''}${brl(l.valor)}</b></td><td class="r">${l.agendamento_id ? '<span class="muted small">Atendimento</span>' : `<button class="btn sm ghost danger" data-act="lan-excluir" data-id="${l.id}" aria-label="Excluir lançamento">Excluir</button>`}</td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhum lançamento no período', 'Receitas aparecem sozinhas quando você conclui atendimentos. Registre despesas como aluguel e produtos.')}</div>`;
  ligarPeriodo(st);
};
act('lan-novo', (b) => {
  const t = b.dataset.t;
  modal({ titulo: t === 'receita' ? 'Nova receita' : 'Nova despesa', rotuloSalvar: 'Salvar lançamento',
    corpo: `<div class="form-grid"><div class="field full"><label class="f" for="l-desc">Descrição</label><input class="inp" id="l-desc" maxlength="120" placeholder="${t === 'receita' ? 'Ex.: Venda de pomada' : 'Ex.: Aluguel do salão'}"></div>
    <div class="field"><label class="f" for="l-valor">Valor (R$)</label><input class="inp" id="l-valor" inputmode="decimal"></div><div class="field"><label class="f" for="l-data">Data</label><input class="inp" type="date" id="l-data" value="${hoje()}"></div>
    <div class="field full"><label class="f" for="l-cat">Categoria</label><input class="inp" id="l-cat" maxlength="60" list="l-cats" placeholder="${t === 'receita' ? 'Produtos' : 'Aluguel, Produtos, Energia…'}"><datalist id="l-cats">${(t === 'receita' ? ['Serviços', 'Produtos', 'Outros'] : ['Aluguel', 'Produtos', 'Energia e água', 'Internet', 'Marketing', 'Equipamentos', 'Impostos', 'Outros']).map((c) => `<option value="${c}">`).join('')}</datalist></div></div>`,
    salvar: async () => { await api('/api/lancamentos', 'POST', { tipo: t, descricao: $('#l-desc').value, valor: $('#l-valor').value, data: $('#l-data').value, categoria: $('#l-cat').value }); fecharModal(); toast('Lançamento salvo.', 'ok'); recarregar(); } });
});
act('lan-excluir', async (b) => { if (!(await confirmar('Excluir este lançamento?', 'Excluir', true))) return; await api('/api/lancamentos/' + b.dataset.id, 'DELETE'); toast('Lançamento excluído.'); recarregar(); });

/* =============== COMISSÕES =============== */
AX.com = null;
VIEWS.comissoes = async (el) => {
  if (!temRecurso('comissoes')) { el.innerHTML = upgradeCard('Comissões no plano Profissional', 'Defina o percentual de cada profissional e acompanhe quanto pagar no fim do período. Disponível nos planos Profissional e Premium.'); return; }
  if (!AX.com) AX.com = novoPeriodo('mes');
  const st = AX.com;
  const r = await api('/api/comissoes?' + qs({ de: st.de, ate: st.ate }));
  el.innerHTML = `<div class="toolbar">${periodoHtml(st)}</div>
  <div class="grid g3 keep2"><div class="card stat hl"><div class="lbl">Total de comissões</div><div class="val num">${brl(r.total_comissoes)}</div><div class="sub">Atendimentos concluídos no período</div></div>
  <div class="card stat"><div class="lbl">Faturamento dos atendimentos</div><div class="val num">${brl(r.profissionais.reduce((s, p) => s + p.faturamento, 0))}</div></div>
  <div class="card stat"><div class="lbl">Atendimentos concluídos</div><div class="val num">${r.profissionais.reduce((s, p) => s + p.atendimentos, 0)}</div></div></div>
  <div class="card mt"><h3>Por profissional</h3><p class="muted small" style="margin-top:-6px">Alterar o percentual vale para atendimentos concluídos daqui para frente; os anteriores mantêm a comissão da época.</p>
  ${r.profissionais.length ? `<div class="tbl-wrap"><table><thead><tr><th>Profissional</th><th>Comissão (%)</th><th class="r">Atendimentos</th><th class="r">Faturamento</th><th class="r">A pagar</th></tr></thead><tbody>${r.profissionais.map((p) => `<tr><td><span class="dot" style="background:${esc(p.cor)}"></span> <b>${esc(p.nome)}</b>${p.ativo ? '' : ' <span class="badge b-faltou">Inativo</span>'}</td>
    <td><div class="row gap-s" style="flex-wrap:nowrap"><input class="inp" style="width:84px" inputmode="decimal" id="cp-${p.profissional_id}" value="${String(p.comissao_percent).replace('.', ',')}" aria-label="Comissão de ${esc(p.nome)}"><button class="btn sm" data-act="com-salvar" data-id="${p.profissional_id}">Salvar</button></div></td>
    <td class="r num">${p.atendimentos}</td><td class="r num">${brl(p.faturamento)}</td><td class="r num"><b>${brl(p.comissao_total)}</b></td></tr>`).join('')}</tbody></table></div>` : vazio('Nenhum profissional', '')}</div>
  <div class="card mt"><h3>Detalhe dos atendimentos</h3>${r.detalhes.length ? `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th class="r">Valor</th><th class="r">Comissão</th></tr></thead><tbody>${r.detalhes.map((a) => `<tr><td class="num">${fmtData(a.inicio.slice(0, 10))}</td><td>${esc(a.cliente_nome)}</td><td>${esc(a.servico_nome)}</td><td>${esc(a.profissional_nome)}</td><td class="r num">${brl(a.preco)}</td><td class="r num">${brl(a.comissao_valor)}</td></tr>`).join('')}</tbody></table></div>` : vazio('Sem atendimentos concluídos no período', 'Conclua atendimentos na agenda para gerar comissões.')}</div>`;
  ligarPeriodo(st);
};
act('com-salvar', async (b) => {
  await api(`/api/profissionais/${b.dataset.id}/comissao`, 'PUT', { comissao_percent: $('#cp-' + b.dataset.id).value });
  toast('Comissão atualizada.', 'ok'); recarregar();
});

/* =============== RELATÓRIOS =============== */
AX.rel = null;
const trava = () => '<p class="muted">Disponível no plano Premium. <a href="#/assinatura">Ver planos</a></p>';
VIEWS.relatorios = async (el) => {
  if (!temRecurso('relatorios')) { el.innerHTML = upgradeCard('Relatórios no plano Profissional', 'Veja faturamento, cancelamentos, serviços mais procurados e desempenho da equipe. Disponível nos planos Profissional e Premium.'); return; }
  if (!AX.rel) AX.rel = novoPeriodo('30d');
  const st = AX.rel, r = await api('/api/relatorios?' + qs({ de: st.de, ate: st.ate }));
  const serie = r.serie_faturamento.map((s) => ({ l: fmtDM(s.data), t: fmtData(s.data), v: [s.valor] }));
  const exportar = temRecurso('exportar');
  el.innerHTML = `<div class="toolbar">${periodoHtml(st)}<div class="grow"></div>${exportar ? `<a class="btn" href="/api/relatorios/export.csv?${qs({ de: st.de, ate: st.ate })}">Exportar CSV</a>` : '<a class="btn" href="#/assinatura" title="Disponível no plano Premium">Exportar CSV (Premium)</a>'}</div>
  <div class="grid g4 keep2"><div class="card stat hl"><div class="lbl">Faturamento</div><div class="val num">${brl(r.faturamento_total)}</div></div>
    <div class="card stat"><div class="lbl">Atendimentos concluídos</div><div class="val num">${r.atendimentos_concluidos}</div><div class="sub">de ${r.agendamentos_total} agendamentos</div></div>
    <div class="card stat"><div class="lbl">Ticket médio</div><div class="val num">${r.liberado.rel_ticket ? brl(r.ticket_medio) : '—'}</div>${r.liberado.rel_ticket ? '' : '<div class="sub">Plano Premium</div>'}</div>
    <div class="card stat"><div class="lbl">Taxa de cancelamento</div><div class="val num">${r.liberado.rel_ticket ? String(r.taxa_cancelamento).replace('.', ',') + '%' : '—'}</div><div class="sub">${r.liberado.rel_ticket ? `${r.por_status.cancelado} cancelados · ${r.por_status.faltou} faltas` : 'Plano Premium'}</div></div></div>
  <div class="card mt"><h3>Faturamento por dia</h3>${chartBarras(serie, ['#7c3aed'], brl)}</div>
  <div class="grid g2 mt"><div class="card"><h3>Serviços mais procurados</h3>${r.liberado.rel_servicos ? barrasH(r.servicos_top.map((s) => ({ l: s.nome, v: s.quantidade })), (v) => v + 'x') : trava()}</div>
    <div class="card"><h3>Agendamentos por situação</h3>${barrasH(Object.entries(r.por_status).map(([k, v]) => ({ l: STATUS[k], v })))}<h3 style="margin-top:20px">Origem dos agendamentos</h3>${r.liberado.rel_origem ? barrasH(r.por_origem.map((o) => ({ l: o.origem === 'online' ? 'Página online' : 'Cadastrado no sistema', v: o.n }))) : trava()}</div></div>
  <div class="grid g2 mt"><div class="card"><h3>Faturamento por profissional</h3>${r.liberado.rel_profissionais ? barrasH(r.profissionais.map((p) => ({ l: p.nome, v: p.faturamento })), brl) : trava()}</div>
    <div class="card"><h3>Melhores clientes</h3>${!r.liberado.rel_clientes ? trava() : r.clientes_top.length ? `<div class="tbl-wrap"><table><thead><tr><th>Cliente</th><th class="r">Visitas</th><th class="r">Gasto</th></tr></thead><tbody>${r.clientes_top.map((c) => `<tr><td>${esc(c.nome)}</td><td class="r num">${c.visitas}</td><td class="r num">${brl(c.gasto)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sem atendimentos concluídos no período.</p>'}</div></div>
  <div class="card mt"><h3>Cancelamentos e faltas</h3>${!r.liberado.rel_cancelamentos ? trava() : r.cancelamentos.length ? `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Situação</th></tr></thead><tbody>${r.cancelamentos.map((a) => `<tr><td class="num">${fmtData(a.inicio.slice(0, 10))} ${hora(a.inicio)}</td><td>${esc(a.cliente_nome)}</td><td>${esc(a.servico_nome)}</td><td>${esc(a.profissional_nome)}</td><td>${badge(a.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum cancelamento ou falta no período.</p>'}</div>`;
  ligarPeriodo(st);
};

/* =============== MINHA ASSINATURA =============== */
VIEWS.assinatura = async (el) => {
  const a = await api('/api/assinatura'), e = a.estado, pg = a.pagamento || {};
  const dataBr = (d) => (d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '');
  const stTxt = e.status === 'ativa' ? (e.assinatura_ate ? `Assinatura ativa até ${dataBr(e.assinatura_ate)} (${e.dias_restantes} dia(s))` : 'Assinatura ativa')
    : e.status === 'trial' ? `Teste grátis com tudo liberado — ${e.dias_restantes} dia(s) restante(s) (até ${fmtData(e.trial_ate)})`
    : e.vencida ? `Assinatura vencida em ${dataBr(e.assinatura_ate)} (plano limitado)` : 'Plano limitado (recursos reduzidos)';
  const nomeDe = (id) => a.planos.find((p) => p.id === id).nome;
  const aviso = e.status === 'trial' ? '<p class="hint mt-s">Quando o teste acabar, a cobrança só começa se você assinar. Sem assinatura, a conta continua no plano limitado e seus dados ficam salvos.</p>'
    : e.status === 'gratis' ? '<p class="hint mt-s">Seus dados continuam salvos. Pague o Pix de um plano para liberar tudo de novo.</p>'
    : '<p class="hint mt-s">Não há renovação automática: perto do vencimento você recebe um aviso e paga o Pix do mês seguinte.</p>';
  const passo = (ok, t) => `<span class="pix-passo ${ok ? 'on' : ''}">${ok ? '✓' : '•'} ${t}</span>`;
  const pend = a.pendente;
  const estados = `<div class="pix-passos">${passo(!!pend, 'Aguardando pagamento')}${passo(!pend && a.pagamentos[0] && a.pagamentos[0].status === 'aprovado', 'Pagamento confirmado')}${passo(e.status === 'ativa', 'Assinatura ativa')}</div>`;
  const cardPend = pend ? `<div class="card mb pix-pend"><div class="row between"><div><div class="muted small">Aguardando pagamento</div><b>Plano ${esc(nomeDe(pend.plano))} · ${brl(pend.valor)}</b></div>
    <div class="row"><button class="btn primary" data-act="pix-abrir" data-id="${pend.id}">Ver QR Code e Pix</button><button class="btn ghost" data-act="pix-cancelar" data-id="${pend.id}">Cancelar cobrança</button></div></div></div>` : '';
  const nomeSt = { aprovado: 'Confirmado', pendente: 'Aguardando', expirado: 'Expirado', cancelado: 'Cancelado', rejeitado: 'Recusado', divergente: 'Em análise' };
  const hist = a.pagamentos.length ? `<div class="card mt"><h3>Histórico de pagamentos</h3><div class="ag-list">${a.pagamentos.map((p) => `<div class="it"><div class="grow"><b>Plano ${esc(nomeDe(p.plano))} · ${brl(p.valor)}</b><div class="muted small">${esc(String(p.criado_em).slice(0, 10).split('-').reverse().join('/'))}${p.validade_ate ? ' · válido até ' + dataBr(p.validade_ate) : ''}${p.transacao ? ' · transação ' + esc(p.transacao) : ''}</div></div><span class="badge ${p.status === 'aprovado' ? 'b-concluido' : p.status === 'pendente' ? 'b-agendado' : 'b-faltou'}">${nomeSt[p.status] || esc(p.status)}</span></div>`).join('')}</div></div>` : '';
  el.innerHTML = `<div class="card mb"><div class="row between"><div><div class="muted small">Situação</div><b style="font-size:18px">${esc(stTxt)}</b></div><span class="badge b-plano">Plano ${esc(nomeDe(a.atual))}</span></div>${estados}${aviso}
      ${pg.disponivel ? (pg.modo === 'producao' ? '' : `<p class="hint mt-s"><b>${pg.modo === 'demo' ? 'Demonstração' : 'Modo de teste'}:</b> nenhuma cobrança real é feita.</p>`) : '<p class="hint mt-s">O pagamento por Pix ainda não foi configurado neste servidor. Por enquanto, escolha o plano que pretende assinar.</p>'}</div>${cardPend}
      <div class="plans">${a.planos.map((p) => {
        const atual = p.id === a.atual && e.status !== 'trial'; const pago = p.id !== 'gratis';
        let botao;
        if (!pago) botao = atual ? '<button class="btn" disabled>Plano atual</button>' : '<button class="btn" disabled>Plano após o teste, sem assinatura</button>';
        else if (!pg.disponivel) botao = a.escolhido === p.id && e.status !== 'ativa' ? '<button class="btn" disabled>Plano escolhido ✓</button>' : `<button class="btn primary" data-act="plano-trocar" data-id="${p.id}" data-ativar="0">Escolher ${esc(p.nome)}</button>`;
        else if (e.status === 'ativa' && atual) botao = `<button class="btn primary" data-act="pix-gerar" data-id="${p.id}">Renovar +30 dias · ${brl(p.preco)}</button>`;
        else botao = `<button class="btn primary" data-act="pix-gerar" data-id="${p.id}">${e.status === 'ativa' ? 'Mudar para' : 'Assinar'} ${esc(p.nome)} · ${brl(p.preco)}</button>`;
        if (!pago) {
          const prem = a.planos.find((x) => x.id === 'premium') || {};
          const emTeste = e.status === 'trial';
          return `<div class="plan ${emTeste ? 'cur' : ''}">${emTeste ? '<span class="tag">Seu teste</span>' : ''}<h3>14 dias grátis</h3><div class="pr num">R$ 0 <small>por 14 dias</small></div><ul><li>Tudo dos planos pagos liberado</li><li>Todas as ${prem.total_funcoes || ''} funções do plano Premium</li><li>Sem cartão de crédito</li><li>Depois, escolha o plano que quiser</li></ul>${emTeste ? `<button class="btn" disabled>Em andamento: ${e.dias_restantes} dia(s)</button>` : '<button class="btn" disabled>Teste já utilizado</button>'}</div>`;
        }
        return `<div class="plan ${atual ? 'cur' : ''}">${atual ? '<span class="tag">Plano atual</span>' : ''}<h3>${esc(p.nome)}</h3><div class="pr num">${p.preco ? brl(p.preco) : 'R$ 0'} <small>/mês</small></div><ul>${p.destaques.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>${p.herda ? `<div class="fn-hd">Tudo do plano ${esc(p.herda)} e mais <b>${p.funcoes.length} funções</b></div><ul class="fn">${p.funcoes.map((f) => `<li>${esc(f.nome)}</li>`).join('')}</ul><div class="muted small" style="margin:4px 0 10px">Total: ${p.total_funcoes} funções liberadas</div>` : ''}${botao}</div>`;
      }).join('')}</div>${hist}`;
};
let pixTimer = null;
function abrirPix(p, modo) {
  clearInterval(pixTimer);
  const dataBr = (d) => (d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '');
  const bg = modal({ titulo: 'Pagar com Pix', semRodape: true, corpo: '<div id="pix-box"></div>' });
  const caixa = $('#pix-box', bg);
  const exp = new Date(String(p.expira_em).replace(' ', 'T') + 'Z').getTime();
  const desenhar = (x) => {
    if (x.status === 'aprovado') {
      caixa.innerHTML = `<div class="center"><div class="pix-ok">✓</div><h3>Pagamento confirmado!</h3><p class="muted">Plano ${esc(x.plano)} ativo até <b>${dataBr(x.validade_ate)}</b>.</p><button class="btn primary" data-act="modal-fechar">Concluir</button></div>`; return;
    }
    if (x.status !== 'pendente') { caixa.innerHTML = `<div class="center"><p><b>Esta cobrança não está mais ativa (${esc(x.status)}).</b></p><button class="btn" data-act="modal-fechar">Fechar</button></div>`; return; }
    caixa.innerHTML = `<div class="center"><div class="muted small">Aguardando pagamento</div><div style="font-size:26px;font-weight:800">${brl(x.valor)}</div>
      ${x.qr_base64 ? `<img class="pix-qr" alt="QR Code do Pix" src="data:image/${modo === 'demo' ? 'svg+xml' : 'png'};base64,${esc(x.qr_base64)}">` : ''}
      <label class="f" for="pix-cod">Pix Copia e Cola</label><textarea class="inp" id="pix-cod" readonly rows="3">${esc(x.qr_code)}</textarea>
      <div class="row mt-s" style="justify-content:center"><button class="btn primary" data-act="pix-copiar">Copiar código</button></div>
      <p class="muted small mt-s">Abra o app do seu banco, escolha Pix e leia o QR Code ou cole o código. A liberação é automática, em instantes.</p>
      <p class="muted small" id="pix-tempo"></p>${modo === 'demo' ? `<button class="btn" data-act="pix-demo" data-id="${x.id}">Simular pagamento (só demonstração)</button>` : ''}</div>`;
  };
  desenhar(p);
  const tempo = () => { const t = $('#pix-tempo'); if (!t) return; const r = Math.max(0, Math.round((exp - Date.now()) / 1000)); t.textContent = r ? `Expira em ${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}` : 'Cobrança expirada. Gere outra.'; };
  tempo();
  pixTimer = setInterval(async () => {
    if (!$('#pix-box')) { clearInterval(pixTimer); return; }
    tempo();
    try {
      const x = await api('/api/assinatura/pagamento/' + p.id);
      if (x.status !== 'pendente') { clearInterval(pixTimer); desenhar(x); if (x.status === 'aprovado') { AX.me = await api('/api/me'); if (window.atualizarBanner) window.atualizarBanner(); recarregar(); } }
    } catch (_) { /* tenta no próximo ciclo */ }
  }, 3000);
}
act('pix-gerar', async (b) => {
  const a = await api('/api/assinatura');
  const p = await api('/api/assinatura/pix', 'POST', { plano: b.dataset.id });
  abrirPix(p, (a.pagamento || {}).modo);
});
act('pix-abrir', async (b) => { const a = await api('/api/assinatura'); abrirPix(await api('/api/assinatura/pagamento/' + b.dataset.id), (a.pagamento || {}).modo); });
act('pix-cancelar', async (b) => { await api('/api/assinatura/pagamento/' + b.dataset.id + '/cancelar', 'POST'); toast('Cobrança cancelada.'); recarregar(); });
act('pix-copiar', async () => { const c = $('#pix-cod'); try { await navigator.clipboard.writeText(c.value); toast('Código Pix copiado.', 'ok'); } catch (_) { c.select(); toast('Selecione e copie o código.'); } });
act('pix-demo', async (b) => { await api('/api/assinatura/pagamento/' + b.dataset.id + '/simular-demo', 'POST'); });

/* =============== CONFIGURAÇÕES =============== */
VIEWS.configuracoes = async (el, params) => {
  if (params.aba === 'assinatura') { location.hash = '#/assinatura'; return; }
  const aba = ['estabelecimento', 'aparencia', 'conta'].includes(params.aba) ? params.aba : 'estabelecimento';
  const tab = (id, t) => `<a class="btn ghost" style="border-radius:0;border-bottom:3px solid ${aba === id ? 'var(--p)' : 'transparent'};color:${aba === id ? 'var(--p-600)' : 'var(--muted)'}" href="#/configuracoes?aba=${id}">${t}</a>`;
  el.innerHTML = `<div class="tabs">${tab('estabelecimento', 'Estabelecimento')}${tab('aparencia', 'Aparência')}${tab('conta', 'Minha conta')}</div><div id="cfg"></div>`;
  const box = $('#cfg');
  if (aba === 'estabelecimento') {
    const c = await api('/api/config');
    box.innerHTML = `<div class="grid g-main"><div class="card"><h3>Dados do estabelecimento</h3><div id="cfg-err" class="err hide"></div><div class="form-grid">
      <div class="field full"><label class="f" for="c-nome">Nome</label><input class="inp" id="c-nome" maxlength="80" value="${esc(c.nome)}"></div>
      <div class="field"><label class="f" for="c-tel">Telefone</label><input class="inp" id="c-tel" type="tel" maxlength="30" value="${esc(c.telefone)}"></div>
      <div class="field"><label class="f" for="c-end">Endereço</label><input class="inp" id="c-end" maxlength="160" value="${esc(c.endereco)}"></div>
      <div class="field full"><label class="f" for="c-desc">Apresentação (aparece na página de agendamento)</label><textarea class="inp" id="c-desc" maxlength="400">${esc(c.descricao)}</textarea></div>
      <div class="field"><label class="f" for="c-slug">Endereço da página</label><input class="inp" id="c-slug" maxlength="40" value="${esc(c.slug)}"><div class="hint">${esc(location.origin)}/agendar/<b id="slug-prev">${esc(c.slug)}</b></div></div>
      <div class="field"><label class="f" for="c-passo">Intervalo entre horários</label><select class="inp" id="c-passo">${[10, 15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === c.intervalo_slots ? 'selected' : ''}>${n} minutos</option>`).join('')}</select></div>
      <div class="field full"><label class="f" for="c-fuso">Fuso horário</label><select class="inp" id="c-fuso">${[['America/Fortaleza', 'Brasília — Nordeste (Fortaleza)'], ['America/Sao_Paulo', 'Brasília (São Paulo)'], ['America/Manaus', 'Amazonas (Manaus)'], ['America/Cuiaba', 'Mato Grosso (Cuiabá)'], ['America/Rio_Branco', 'Acre (Rio Branco)'], ['America/Noronha', 'Fernando de Noronha']].map(([v, t]) => `<option value="${v}" ${v === c.fuso ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <button class="btn primary" data-act="cfg-salvar">Salvar alterações</button></div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Página de agendamento</h3><p class="muted small" style="margin-top:-6px">Seus clientes escolhem serviço, profissional e horário por aqui.</p><input class="inp" readonly value="${esc(location.origin + '/agendar/' + c.slug)}" aria-label="Link"><div class="row mt-s"><button class="btn sm primary" data-act="copiar-link">Copiar link</button><a class="btn sm" target="_blank" rel="noopener" href="/agendar/${esc(c.slug)}">Abrir</a></div></div></div></div>`;
    $('#c-slug').addEventListener('input', (e) => { $('#slug-prev').textContent = e.target.value; });
  } else if (aba === 'aparencia') {
    const c = await api('/api/config');
    AP = JSON.parse(JSON.stringify(AXA.mescla(c.aparencia)));
    AP_LOGO = c.logo;
    box.innerHTML = `<div class="grid g-main"><div>
      <div class="card ap-sec"><h3>${icon('img')} Identidade Visual do Site</h3><div id="ap-err" class="err hide"></div>
        <label class="f">Logomarca</label>
        <div class="ap-logo">${fotoPicker('logo', c.logo, 'Enviar imagem')}</div>
        <button class="btn sm mt-s" data-act="logo-salvar">Salvar logomarca</button>
        <div class="hr"></div>
        ${[['cor_principal', 'Cor Principal', 'Botões, links e destaques'], ['cor_secundaria', 'Cor Secundária', 'Fundos escuros (cabeçalho)'], ['cor_destaque', 'Cor de Destaque', 'Acentos e ícones']].map(([k, t, d]) => `<div><label class="f">${t}</label><div class="muted small">${d}</div><div class="ap-cor"><input type="color" data-ap-cor="${k}" value="${AP[k]}" aria-label="${t}"><b data-ap-hex="${k}">${AP[k]}</b></div></div>`).join('')}
      </div>
      <div class="card ap-sec"><h3>Fundo da Página de Agendamento</h3>
        <div class="ap-tipos">${[['cor', 'Cor Sólida'], ['tema', 'Temático'], ['imagem', 'Imagem']].map(([k, t]) => `<button class="btn" data-act="ap-tipo" data-id="${k}">${t}</button>`).join('')}</div>
        <div id="ap-fundo"></div>
      </div>
      <button class="btn primary" data-act="ap-salvar">Salvar aparência</button> <button class="btn ghost" data-act="ap-padrao">Restaurar padrão</button>
    </div>
    <div class="grid" style="align-content:start"><div class="card"><h3>Pré-visualização</h3><div id="ap-prev"></div><p class="muted small mt-s">É assim que seus clientes veem a página de agendamento.</p></div></div></div>`;
    apDesenhar();
  } else {
    box.innerHTML = `<div class="card" style="max-width:520px"><h3>Minha conta</h3><p class="muted">${esc(AX.me.usuario.nome)} · ${esc(AX.me.usuario.email)}</p><h3 style="margin-top:22px">Alterar senha</h3><div id="sn-err" class="err hide"></div>
      <div class="field"><label class="f" for="sn-at">Senha atual</label><input class="inp" id="sn-at" type="password" autocomplete="current-password"></div>
      <div class="field"><label class="f" for="sn-nv">Nova senha</label><input class="inp" id="sn-nv" type="password" autocomplete="new-password"><div class="hint">Mínimo de 8 caracteres.</div></div>
      <button class="btn primary" data-act="senha-salvar">Alterar senha</button>
      <h3 style="margin-top:26px">Código de recuperação</h3><p class="muted small">Se esquecer a senha, este código permite criar uma nova na tela de entrada. Gerar um novo cancela o anterior.</p><div id="rc-err" class="err hide"></div>
      <div class="field"><label class="f" for="rc-senha">Sua senha</label><input class="inp" id="rc-senha" type="password" autocomplete="current-password"></div>
      <button class="btn" data-act="rec-gerar">Gerar novo código</button><div id="rc-out" class="mt-s"></div>
      <h3 style="margin-top:26px">Meus dados</h3><p class="muted small">Baixe uma cópia de tudo que está no seu app (clientes, agenda, financeiro) ou exclua a conta de forma definitiva.</p>
      <div class="row"><a class="btn" href="/api/conta/exportar" download>Baixar meus dados</a><button class="btn danger" data-act="conta-excluir">Excluir minha conta</button></div></div>`;
  }
};

let AP = null, AP_LOGO = '';
function apDesenhar() {
  if (!AP) return;
  $$('[data-act=ap-tipo]').forEach((b) => b.classList.toggle('on', b.dataset.id === AP.fundo.tipo));
  const f = AP.fundo, t = f.tipo;
  let h = '';
  if (t === 'cor') h = `<label class="f">Cor de fundo</label><div class="ap-cor"><input type="color" data-ap-fundo="cor" value="${f.cor}" aria-label="Cor de fundo"><div><b data-ap-hex="fundo">${f.cor}</b><div class="muted small">Clique para abrir o seletor de cor</div></div></div>
    <label class="f">Paleta rápida</label><div class="ap-paleta">${AXA.PALETA.map((c) => `<button type="button" data-act="ap-paleta" data-id="${c}" style="background:${c}" title="${c}" aria-label="${c}" class="${c.toLowerCase() === f.cor.toLowerCase() ? 'on' : ''}"></button>`).join('')}</div>`;
  else if (t === 'tema') h = `<div class="ap-temas">${AXA.TEMAS.map((x) => `<button type="button" class="ap-tema ${x.id === f.tema ? 'on' : ''}" data-act="ap-tema" data-id="${x.id}" style="background:${x.css};${['rosa', 'minimal'].includes(x.id) ? 'color:#333;text-shadow:none' : ''}">${x.nome}</button>`).join('')}</div>`;
  else h = `<div class="photo-pick"><div class="pv" style="${f.imagem ? `background:url('${esc(f.imagem)}') center/cover` : ''}">${f.imagem ? '' : icon('img')}</div><div><input type="file" accept="image/png,image/jpeg,image/webp" class="hide" id="ap-img"><button type="button" class="btn sm" data-act="ap-img-escolher">Enviar imagem de fundo</button> <button type="button" class="btn sm ghost danger ${f.imagem ? '' : 'hide'}" data-act="ap-img-remover">Remover</button><div class="hint">Imagem salva na hora. Use uma foto do seu espaço.</div></div></div>`;
  $('#ap-fundo').innerHTML = h;
  const inp = $('#ap-img'); if (inp) inp.addEventListener('change', apEnviarImg);
  apPrev();
}
function apPrev() {
  const v = AXA.variaveis(AP), fc = AXA.fundoCss(AP);
  const est = (AX.me && AX.me.estabelecimento) || {};
  $('#ap-prev').innerHTML = `<div class="ap-prev" style="${Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')}"><div class="hd" style="background:${v['--pub-hd']};color:${v['--pub-hd-ink']}"><div class="lg">${AP_LOGO ? `<img src="${esc(AP_LOGO)}" alt="">` : esc((est.nome || 'A').slice(0, 1))}</div><b>${esc(est.nome || 'Seu estabelecimento')}</b><span class="dots"><i style="background:${AP.cor_principal}"></i><i style="background:${AP.cor_secundaria}"></i><i style="background:${AP.cor_destaque}"></i></span></div>
    <div class="bd" style="background:${fc.background}"><button class="btn primary" style="background:${v['--p']};border-color:${v['--p']};color:${AXA.tinta(AP.cor_principal)}">Agendar horário</button></div></div>`;
}
document.addEventListener('input', (e) => {
  if (!AP) return;
  const k = e.target.dataset && e.target.dataset.apCor;
  if (k) { AP[k] = e.target.value; const b = $(`[data-ap-hex=${k}]`); if (b) b.textContent = e.target.value; apPrev(); }
  if (e.target.dataset && e.target.dataset.apFundo === 'cor') { AP.fundo.cor = e.target.value; const b = $('[data-ap-hex=fundo]'); if (b) b.textContent = e.target.value; $$('.ap-paleta button').forEach((x) => x.classList.remove('on')); apPrev(); }
});
act('ap-tipo', (b) => { AP.fundo.tipo = b.dataset.id; apDesenhar(); });
act('ap-paleta', (b) => { AP.fundo.cor = b.dataset.id; apDesenhar(); });
act('ap-tema', (b) => { AP.fundo.tema = b.dataset.id; apDesenhar(); });
act('ap-img-escolher', () => $('#ap-img').click());
async function apEnviarImg(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = await lerImagem(file, 1600);
    const r = await api('/api/config/fundo', 'POST', { imagem: d });
    AP = JSON.parse(JSON.stringify(AXA.mescla(r))); toast('Imagem de fundo salva.', 'ok'); apDesenhar();
  } catch (err) { erroCfg('#ap-err', err); }
}
act('ap-img-remover', async () => {
  try { const r = await api('/api/config/fundo', 'DELETE'); AP = JSON.parse(JSON.stringify(AXA.mescla(r))); AP.fundo.tipo = 'cor'; apDesenhar(); toast('Imagem removida.'); } catch (err) { erroCfg('#ap-err', err); }
});
act('ap-padrao', () => { AP = JSON.parse(JSON.stringify(AXA.PADRAO)); $$('[data-ap-cor]').forEach((i) => { i.value = AP[i.dataset.apCor]; $(`[data-ap-hex=${i.dataset.apCor}]`).textContent = AP[i.dataset.apCor]; }); apDesenhar(); });
act('ap-salvar', async () => {
  $('#ap-err').classList.add('hide');
  try {
    const r = await api('/api/config/aparencia', 'PUT', { cor_principal: AP.cor_principal, cor_secundaria: AP.cor_secundaria, cor_destaque: AP.cor_destaque, fundo: { tipo: AP.fundo.tipo, cor: AP.fundo.cor, tema: AP.fundo.tema } });
    AP = JSON.parse(JSON.stringify(AXA.mescla(r)));
    toast('Aparência salva.', 'ok'); AX.me = await api('/api/me');
  } catch (e) { erroCfg('#ap-err', e); }
});
const erroCfg = (id, e) => { const x = $(id); if (x) { x.textContent = e.message; x.classList.remove('hide'); } else erroToast(e); };
act('cfg-salvar', async () => {
  $('#cfg-err').classList.add('hide');
  try {
    const c = await api('/api/config', 'PUT', { nome: $('#c-nome').value, telefone: $('#c-tel').value, endereco: $('#c-end').value, descricao: $('#c-desc').value, slug: $('#c-slug').value, fuso: $('#c-fuso').value, intervalo_slots: $('#c-passo').value });
    AX.me.estabelecimento = c; toast('Configurações salvas.', 'ok'); await window.atualizarBanner(); recarregar();
  } catch (e) { erroCfg('#cfg-err', e); }
});
act('logo-salvar', async () => {
  const f = dadosFoto(document, 'logo');
  if (f.foto) await api('/api/config/logo', 'POST', { imagem: f.foto }); else if (f.remover_foto) await api('/api/config/logo', 'DELETE'); else { toast('Escolha uma imagem primeiro.'); return; }
  toast('Logo atualizado.', 'ok'); AX.me = await api('/api/me'); recarregar();
});
act('plano-trocar', async (b) => {
  const r = await api('/api/assinatura', 'POST', { plano: b.dataset.id, ativar: b.dataset.ativar === '1' });
  toast(b.dataset.ativar === '1' ? 'Assinatura ativada!' : 'Plano escolhido. Avisaremos quando a assinatura estiver disponível.', 'ok'); await window.atualizarBanner(); recarregar();
});
act('assin-cancelar', async () => { if (!(await confirmar('Cancelar a assinatura? Você volta para o plano Grátis, com recursos limitados. Seus dados continuam salvos.', 'Cancelar assinatura', true))) return; await api('/api/assinatura/cancelar', 'POST'); toast('Assinatura cancelada.'); await window.atualizarBanner(); recarregar(); });
act('senha-salvar', async () => {
  try { await api('/api/me/senha', 'PUT', { atual: $('#sn-at').value, nova: $('#sn-nv').value }); toast('Senha alterada.', 'ok'); $('#sn-at').value = ''; $('#sn-nv').value = ''; $('#sn-err').classList.add('hide'); }
  catch (e) { erroCfg('#sn-err', e); }
});

act('rec-gerar', async () => {
  try {
    const r = await api('/api/me/recuperacao', 'PUT', { senha: $('#rc-senha').value });
    $('#rc-err').classList.add('hide'); $('#rc-senha').value = '';
    $('#rc-out').innerHTML = `<div class="card center" style="margin:0"><div class="muted small">Anote agora: ele não aparece de novo.</div><b class="num" style="font-size:20px;user-select:all">${esc(r.codigo_recuperacao)}</b></div>`;
  } catch (e) { erroCfg('#rc-err', e); }
});
act('conta-excluir', () => {
  modal({ titulo: 'Excluir minha conta', rotuloSalvar: 'Excluir definitivamente', corpo: `<p>Isto apaga <b>todos</b> os dados do estabelecimento (clientes, agenda, financeiro e fotos). Não dá para desfazer. Considere baixar seus dados antes.</p>
    <div class="field"><label class="f" for="ex-senha">Sua senha</label><input class="inp" id="ex-senha" type="password" autocomplete="current-password"></div>
    <div class="field"><label class="f" for="ex-conf">Digite EXCLUIR para confirmar</label><input class="inp" id="ex-conf" autocomplete="off"></div>`,
    salvar: async () => { await api('/api/conta/excluir', 'POST', { senha: $('#ex-senha').value, confirmar: $('#ex-conf').value }); location.href = '/'; } });
});

/* =============== DISPONIBILIDADE DE HORÁRIOS =============== */
AX.disp = { prof: 0 };
VIEWS.disponibilidade = async (el) => {
  const [lista, servicos, cfg] = await Promise.all([api('/api/profissionais'), api('/api/servicos'), api('/api/config')]);
  AX.profsCache = lista; AX.servicosCache = servicos;
  const ativos = lista.filter((p) => p.ativo);
  if (!ativos.length) { el.innerHTML = `<div class="card">${vazio('Nenhum profissional ativo', 'Cadastre quem atende para definir os horários.', '<a class="btn primary" href="#/profissionais">Abrir profissionais</a>')}</div>`; return; }
  if (!ativos.some((p) => p.id === AX.disp.prof)) AX.disp.prof = ativos[0].id;
  const p = ativos.find((x) => x.id === AX.disp.prof);
  el.innerHTML = `<div class="card"><h3>Disponibilidade de horários</h3>
    <p class="muted small" style="margin-top:-6px">Marque os dias e horários em que cada profissional atende. Só esses horários ficam livres na agenda.</p>
    <div class="row mt-s" style="gap:8px;flex-wrap:wrap">${ativos.map((x) => `<button class="btn sm ${x.id === p.id ? 'primary' : ''}" data-act="disp-prof" data-id="${x.id}">${esc(x.nome)}</button>`).join('')}</div>
    <div class="hrs mt">${ORDEM_DIAS.map((d) => `<div class="hr-row"><label class="chk"><input type="checkbox" data-d="${d}" data-h="ativo" ${p.horarios[d].ativo ? 'checked' : ''}> ${DIAS[d]}</label><input class="inp" type="time" data-d="${d}" data-h="inicio" value="${p.horarios[d].inicio}" aria-label="Início ${DIAS[d]}"><input class="inp" type="time" data-d="${d}" data-h="fim" value="${p.horarios[d].fim}" aria-label="Fim ${DIAS[d]}"></div>`).join('')}</div>
    <div class="field mt"><label class="f" for="d-passo">Intervalo entre horários</label><select class="inp" id="d-passo" style="max-width:220px">${[10, 15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === cfg.intervalo_slots ? 'selected' : ''}>${n} minutos</option>`).join('')}</select><div class="hint">Vale para todos os profissionais.</div></div>
    <div class="row mt"><button class="btn primary" data-act="disp-salvar" data-id="${p.id}">Salvar disponibilidade</button><button class="btn" data-act="disp-copiar" data-id="${p.id}">Copiar para todos os profissionais</button></div></div>`;
};
act('disp-prof', (b) => { AX.disp.prof = parseInt(b.dataset.id, 10); AX.recarregar(); });
function lerHorariosTela() {
  const h = {};
  for (let d = 0; d < 7; d++) h[d] = { ativo: $(`[data-d="${d}"][data-h=ativo]`).checked, inicio: $(`[data-d="${d}"][data-h=inicio]`).value, fim: $(`[data-d="${d}"][data-h=fim]`).value };
  return h;
}
async function gravarHorarios(p, horarios) {
  await api('/api/profissionais/' + p.id, 'PUT', { nome: p.nome, telefone: p.telefone, comissao_percent: p.comissao_percent, cor: p.cor, horarios, servicos: p.servicos });
}
async function gravarPasso() {
  const c = await api('/api/config');
  const passo = $('#d-passo').value;
  if (String(c.intervalo_slots) !== passo) await api('/api/config', 'PUT', { nome: c.nome, telefone: c.telefone, endereco: c.endereco, descricao: c.descricao, slug: c.slug, fuso: c.fuso, intervalo_slots: passo });
}
act('disp-salvar', async (b) => {
  const p = AX.profsCache.find((x) => String(x.id) === b.dataset.id);
  await gravarHorarios(p, lerHorariosTela()); await gravarPasso();
  toast('Disponibilidade salva.', 'ok'); AX.me = await api('/api/me'); AX.recarregar();
});
act('disp-copiar', async (b) => {
  if (!(await confirmar('Copiar estes horários para todos os profissionais ativos?', 'Copiar'))) return;
  const h = lerHorariosTela();
  for (const p of AX.profsCache.filter((x) => x.ativo)) await gravarHorarios(p, h);
  await gravarPasso(); toast('Horários copiados para todos.', 'ok'); AX.recarregar();
});
