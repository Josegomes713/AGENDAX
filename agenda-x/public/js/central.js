/* Central do Proprietário: só aparece para o dono. Todos os números vêm de /api/central/* (banco real); o servidor também confere o dono. */
(function () {
  const ABAS = [['geral', 'Visão geral'], ['planos', 'Planos e assinaturas'], ['pagamentos', 'Pagamentos'], ['ativacao', 'Ativação automática'], ['teste', 'Teste grátis'], ['financeiro', 'Financeiro'], ['inteligencia', 'Intelligence']];
  const NOMEPL = { gratis: 'Grátis', basico: 'Básico', profissional: 'Profissional', premium: 'Premium', teste: 'Teste grátis' };
  const dt = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '—');
  const dth = (s) => (s ? dt(s) + ' ' + String(s).slice(11, 16) + ' UTC' : '—');
  const mesRot = (m) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][parseInt(m.slice(5, 7), 10) - 1] + '/' + m.slice(2, 4);
  const COR_ST = { aprovado: 'b-concluido', pendente: 'b-agendado', rejeitado: 'b-cancelado', cancelado: 'b-cancelado', expirado: 'b-faltou', divergente: 'b-cancelado', ativa: 'b-concluido', trial: 'b-agendado', gratis: 'b-faltou', suspensa: 'b-cancelado' };
  const ROT_AT = { ativado: ['Ativado', 'b-concluido'], duplicado: ['Repetido ignorado', 'b-agendado'], pendente: ['Pendente: não liberou', 'b-faltou'], divergente: ['Divergente', 'b-cancelado'], falha: ['Falha', 'b-cancelado'], recusado: ['Recusado', 'b-cancelado'], manual: ['Manual', 'b-plano'] };
  let aba = 'geral', filtroPag = { status: '', q: '' }, DADOS = {};
  const card = (l, v, sub, hl) => `<div class="card stat cp-stat ${hl ? 'hl' : ''}"><div class="lbl">${l}</div><div class="val num">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const vazioCard = (t, m) => `<div class="card">${vazio(t, m)}</div>`;

  function barras(serie, chave, rot, fmt, titulo) {
    const max = Math.max(1, ...serie.map((x) => x[chave])), W = 600, H = 170, bw = W / serie.length;
    const todosZero = serie.every((x) => !x[chave]);
    return `<div class="card cp-chart"><h3>${titulo}</h3><svg viewBox="0 0 ${W} ${H + 28}" role="img" aria-label="${esc(titulo)}" preserveAspectRatio="xMidYMid meet">
      ${serie.map((x, i) => { const h = Math.round((x[chave] / max) * H); const lbl = serie.length > 12 ? (i % 5 === 0 ? rot(x) : '') : rot(x);
        return `<g><title>${esc(rot(x))}: ${esc(fmt(x[chave]))}</title><rect x="${i * bw + bw * 0.18}" y="${H - h}" width="${bw * 0.64}" height="${Math.max(h, x[chave] ? 3 : 1)}" rx="4" fill="${x[chave] ? 'url(#cpg)' : '#d8d1ee'}"/><text x="${i * bw + bw / 2}" y="${H + 18}" text-anchor="middle" font-size="12" fill="#6c6784">${esc(lbl)}</text></g>`; }).join('')}
      <defs><linearGradient id="cpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7"/><stop offset="1" stop-color="#6d28d9"/></linearGradient></defs></svg>
      ${todosZero ? '<p class="muted small">Ainda sem movimento neste período.</p>' : ''}</div>`;
  }
  const tabela = (cab, linhas) => `<div class="card cp-table"><div class="tbl-wrap"><table class="tbl"><thead><tr>${cab.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table></div></div>`;

  async function geral() {
    const [r, f, ia] = await Promise.all([api('/api/central/resumo'), api('/api/central/financeiro'), api('/api/central/inteligencia')]);
    const i = r.indicadores, g = r.crescimento;
    const cresc = g.variacao_pct == null ? (g.mes_atual ? `${g.mes_atual} novo(s) este mês` : 'sem base para comparar') : `${g.variacao_pct > 0 ? '+' : ''}${String(g.variacao_pct).replace('.', ',')}% vs mês anterior`;
    return `<div class="grid g4 keep2">${card('Clientes cadastrados', i.clientes)}${card('Total de assinantes', i.assinantes_total, 'já pagaram ou têm plano pago')}${card('Planos ativos', i.planos_ativos)}${card('Planos gratuitos', i.planos_gratuitos)}</div>
      <div class="grid g4 keep2 mt">${card('Em período de teste', i.em_teste)}${card('Pagamentos pendentes', i.pagamentos_pendentes)}${card('Pagamentos aprovados', i.pagamentos_aprovados)}${card('Planos vencidos', i.planos_vencidos)}</div>
      <div class="grid g2 mt">${card('Faturamento do mês', brl(i.faturamento_mensal), 'só pagamentos aprovados', true)}${card('Crescimento de assinantes', `${g.mes_atual} novo(s)`, cresc, true)}</div>
      <div class="grid g2 mt">${barras(r.serie_meses, 'novos_assinantes', (x) => mesRot(x.mes), (v) => v + ' assinante(s) novo(s)', 'Novos assinantes por mês (1º pagamento)')}${barras(r.serie_meses, 'novos_clientes', (x) => mesRot(x.mes), (v) => v + ' cadastro(s)', 'Novos cadastros por mês')}</div>
      ${ia.alertas.length ? `<div class="card mt"><h3>Atenção</h3>${ia.alertas.slice(0, 4).map((a) => `<p class="cp-al ${a.nivel}">${esc(a.texto)}</p>`).join('')}</div>` : ''}`;
  }

  async function planos() {
    const d = await api('/api/central/planos'); DADOS.planos = d;
    const ST = { ativa: 'Ativa', trial: 'Em teste', gratis: 'Grátis', suspensa: 'Suspensa' };
    const linhas = d.assinaturas.map((a) => `<tr><td><b>${esc(a.nome)}</b><div class="muted small">${esc(a.email)}</div></td><td>${esc(NOMEPL[a.plano] || a.plano)}${a.forma ? `<div class="muted small">${a.forma}</div>` : ''}</td>
      <td><span class="badge ${COR_ST[a.status] || ''}">${a.vencida ? 'Vencida' : ST[a.status] || esc(a.status)}</span></td><td>${dth(a.contratado_em)}</td><td>${dt(a.vence_em)}${a.dias_restantes != null && (a.status === 'ativa' || a.status === 'trial') ? `<div class="muted small">${a.dias_restantes} dia(s)</div>` : ''}</td>
      <td class="right"><button class="btn sm" data-act="cp-hist" data-id="${a.id}">Histórico</button> <button class="btn sm primary" data-act="cp-gerir" data-id="${a.id}">Gerenciar</button></td></tr>`);
    return `<div class="grid g3 keep2">${d.planos.map((p) => card(esc(p.nome), p.clientes + ' cliente(s)', `${p.tipo === 'pago' ? brl(p.preco) + '/mês · pago' : 'gratuito'} · ${p.funcoes} funções extras`)).join('')}</div>
      <h3 class="mt">Assinaturas</h3>${d.assinaturas.length ? tabela(['Cliente', 'Plano', 'Situação', 'Contratação', 'Vencimento', ''], linhas) : vazioCard('Nenhum cliente ainda', 'Quando alguém se cadastrar, aparece aqui.')}`;
  }
  act('cp-hist', async (b) => {
    const h = await api('/api/central/contas/' + b.dataset.id + '/historico');
    const ORI = { pix: 'Pagamento Pix', proprietario: 'Proprietário', cliente: 'Cliente' };
    modal({ titulo: 'Histórico: ' + h.conta.nome, semRodape: true, largo: true, corpo: `<h4>Alterações de assinatura</h4>${h.historico.length ? `<div class="ag-list">${h.historico.map((x) => `<div class="it"><div class="grow"><b>${esc(x.detalhe || '')}</b><div class="muted small">${ORI[x.origem] || esc(x.origem)} · ${esc(x.de_plano || '—')}/${esc(x.de_status || '—')} → ${esc(x.para_plano || '—')}/${esc(x.para_status || '—')}${x.autor ? ' · ' + esc(x.autor) : ''}</div></div><div class="muted small">${dth(x.quando)}</div></div>`).join('')}</div>` : '<p class="muted">Nenhuma alteração registrada.</p>'}
      <h4 class="mt">Pagamentos</h4>${h.pagamentos.length ? `<div class="ag-list">${h.pagamentos.map((x) => `<div class="it"><div class="grow"><b>${brl(x.valor)}</b> · ${esc(NOMEPL[x.plano] || x.plano)}<div class="muted small">${esc(x.status)}${x.validade_ate ? ' · até ' + dt(x.validade_ate) : ''}</div></div><div class="muted small">${dth(x.pago_em || x.criado_em)}</div></div>`).join('')}</div>` : '<p class="muted">Sem pagamentos.</p>'}` });
  });
  act('cp-gerir', (b) => {
    const a = DADOS.planos.assinaturas.find((x) => String(x.id) === b.dataset.id), paga = a.status === 'ativa';
    modal({ titulo: 'Gerenciar: ' + a.nome, rotuloSalvar: 'Confirmar e aplicar',
      corpo: `<p class="muted small">${esc(a.email)}<br>Situação atual: <b>${paga ? 'Plano ' + esc(NOMEPL[a.plano] || a.plano) + ' ativo' : a.status === 'trial' ? 'Em teste grátis' : 'Plano Grátis'}</b></p>
        <div class="field"><label class="f" for="cp-acao">O que fazer?</label><select class="inp" id="cp-acao"><option value="ativar">Ativar um plano pago manualmente</option>${paga ? '<option value="cancelar">Cancelar a assinatura</option>' : ''}</select></div>
        <div id="cp-box"><div class="field"><label class="f" for="cp-plano">Plano</label><select class="inp" id="cp-plano"><option value="basico">Básico</option><option value="profissional" selected>Profissional</option><option value="premium">Premium</option></select></div>
        <div class="field"><label class="f" for="cp-dias">Por quantos dias?</label><input class="inp" id="cp-dias" type="number" min="1" max="365" value="30"></div></div>
        <label class="chip"><input type="checkbox" id="cp-ok"> Entendo: a mudança vale na hora, avisa o cliente e fica registrada.</label>`,
      salvar: async () => {
        if (!$('#cp-ok').checked) { toast('Marque a confirmação para continuar.', 'bad'); return; }
        await api('/api/central/assinaturas/' + a.id, 'POST', { acao: $('#cp-acao').value, plano: $('#cp-plano').value, dias: $('#cp-dias').value, confirmar: true });
        fecharModal(); toast('Assinatura atualizada e registrada.', 'ok'); desenhar();
      } });
    const aj = () => $('#cp-box').classList.toggle('hide', $('#cp-acao').value !== 'ativar'); $('#cp-acao').addEventListener('change', aj); aj();
  });

  async function pagamentos() {
    const d = await api('/api/central/pagamentos?status=' + encodeURIComponent(filtroPag.status) + '&q=' + encodeURIComponent(filtroPag.q)); const c = d.contagem;
    const n = (k) => (c[k] ? c[k].n : 0), v = (k) => (c[k] ? c[k].valor : 0);
    const linhas = d.pagamentos.map((p) => `<tr><td><b>${esc(p.cliente)}</b><div class="muted small">${esc(p.email || '')}</div></td><td>${esc(NOMEPL[p.plano] || p.plano)}</td><td>${brl(p.valor)}</td><td>${p.metodo}<div class="muted small">${p.provedor}</div></td>
      <td><span class="badge ${COR_ST[p.status] || ''}">${esc(p.rotulo)}</span></td><td>${dth(p.pago_em || p.criado_em)}</td><td class="small" style="word-break:break-all">${esc(p.transacao || '—')}</td>
      <td class="right">${p.status === 'pendente' || p.status === 'divergente' || p.status === 'expirado' ? `<button class="btn sm" data-act="cp-reconsultar" data-id="${p.id}">Reconsultar</button>` : ''}</td></tr>`);
    return `<div class="grid g4 keep2">${card('Aprovados', n('aprovado'), brl(v('aprovado')))}${card('Pendentes', n('pendente'), brl(v('pendente')))}${card('Recusados', n('rejeitado') + n('divergente'), 'inclui divergentes')}${card('Cancelados / expirados', n('cancelado') + n('expirado'))}</div>
      <div class="toolbar mt"><input class="inp grow" id="cp-q" placeholder="Buscar por cliente, e-mail ou transação" value="${esc(filtroPag.q)}" aria-label="Buscar"><select class="inp" id="cp-st" aria-label="Situação" style="max-width:200px"><option value="">Todas</option>${['aprovado', 'pendente', 'rejeitado', 'cancelado', 'expirado', 'divergente'].map((s) => `<option value="${s}" ${filtroPag.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>
      ${d.pagamentos.length ? tabela(['Cliente', 'Plano', 'Valor', 'Método', 'Situação', 'Data e hora', 'Transação', ''], linhas) : vazioCard('Nenhum pagamento', 'Quando alguém gerar um Pix, aparece aqui.')}`;
  }
  act('cp-reconsultar', async (b) => {
    try { const r = await api('/api/central/pagamentos/' + b.dataset.id + '/reconsultar', 'POST', {}); toast('Consultado no Mercado Pago: ' + r.resultado, 'ok'); } catch (e) { toast(e.message, 'bad'); }
    desenhar();
  });

  async function ativacao() {
    const d = await api('/api/central/ativacoes'), s = d.saude;
    return `<p class="muted">Aqui você confere se o plano é liberado sozinho quando o Pix é aprovado. Cobrança criada ou pendente <b>nunca</b> libera plano pago.</p>
      <div class="card"><h3>Verificações do sistema</h3>${d.verificacoes.map((v) => `<div class="cp-ver"><span class="badge ${v.ok ? 'b-concluido' : 'b-cancelado'}">${v.ok ? 'OK' : 'Atenção'}</span><div><b>${esc(v.titulo)}</b><div class="muted small">${esc(v.detalhe)}</div></div></div>`).join('')}
        <p class="muted small mt">Endereço do webhook: ${s.webhook_url ? '<code>' + esc(s.webhook_url) + '</code>' : 'não definido'}</p></div>
      <h3 class="mt">Registro de ativações</h3>${d.ativacoes.length ? tabela(['Quando', 'Cliente', 'Origem', 'Resultado', 'Motivo'], d.ativacoes.map((a) => { const r = ROT_AT[a.resultado] || [a.resultado, '']; return `<tr><td>${dth(a.quando)}</td><td>${esc(a.cliente || '—')}</td><td>${esc(a.origem)}</td><td><span class="badge ${r[1]}">${r[0]}</span></td><td class="small">${esc(a.motivo)}</td></tr>`; })) : vazioCard('Nenhuma ativação ainda', 'Cada ativação ou falha aparece aqui, com o motivo.')}
      <h3 class="mt">Avisos recebidos do Mercado Pago</h3>${d.webhooks.length ? tabela(['Recebido', 'Cliente', 'Transação', 'Resultado'], d.webhooks.map((w) => `<tr><td>${dth(w.recebido_em)}</td><td>${esc(w.cliente || '—')}</td><td class="small">${esc(w.transacao || '—')}</td><td>${esc(w.descricao)}</td></tr>`)) : vazioCard('Nenhum aviso recebido', 'Quando o Mercado Pago avisar um pagamento, aparece aqui.')}`;
  }

  async function teste() {
    const d = await api('/api/central/teste'); const SIT = { em_teste: ['Em teste', 'b-agendado'], encerrado: ['Encerrado', 'b-faltou'], convertido: ['Virou pagante', 'b-concluido'] };
    return `<div class="grid g4 keep2">${card('Em teste', d.em_teste)}${card('Testes encerrados', d.encerrados)}${card('Viraram pagantes', d.convertidos)}${card('Conversão', d.taxa_conversao_pct == null ? '—' : String(d.taxa_conversao_pct).replace('.', ',') + '%', 'pagantes ÷ testes encerrados')}</div>
      <h3 class="mt">Clientes</h3>${d.lista.length ? tabela(['Cliente', 'Início', 'Encerramento', 'Situação'], d.lista.map((x) => `<tr><td><b>${esc(x.nome)}</b><div class="muted small">${esc(x.email)}</div></td><td>${dt(x.inicio)}</td><td>${dt(x.fim)}${x.situacao === 'em_teste' ? `<div class="muted small">${x.dias_restantes} dia(s)</div>` : ''}</td><td><span class="badge ${SIT[x.situacao][1]}">${SIT[x.situacao][0]}</span></td></tr>`)) : vazioCard('Nenhum cliente ainda', 'Os testes aparecem aqui assim que alguém se cadastrar.')}`;
  }

  async function financeiro() {
    const f = await api('/api/central/financeiro');
    return `<p class="muted">Receita = somente pagamentos <b>aprovados</b>. Dias no horário de Fortaleza.</p><div class="grid g4 keep2">${card('Hoje', brl(f.dia))}${card('Últimos 7 dias', brl(f.semana))}${card('Mês atual', brl(f.mes))}${card('Total recebido', brl(f.total_recebido), f.pagamentos_aprovados + ' pagamento(s)', true)}</div>
      <div class="grid g2 mt">${card('Pagamentos pendentes', f.pendentes.n, brl(f.pendentes.valor) + ' ainda não recebidos')}${card('Por plano', f.por_plano.length ? f.por_plano.map((p) => `${esc(NOMEPL[p.plano] || p.plano)}: ${brl(p.valor)}`).join(' · ') : 'sem pagamentos', '')}</div>
      <div class="grid g2 mt">${barras(f.serie_diaria, 'valor', (x) => x.dia.slice(8, 10) + '/' + x.dia.slice(5, 7), brl, 'Faturamento diário (30 dias)')}${barras(f.serie_mensal, 'valor', (x) => mesRot(x.mes), brl, 'Faturamento mensal (6 meses)')}</div>
      <h3 class="mt">Histórico financeiro</h3>${f.historico.length ? tabela(['Data e hora', 'Cliente', 'Plano', 'Valor', 'Transação'], f.historico.map((h) => `<tr><td>${dth(h.pago_em)}</td><td>${esc(h.cliente)}</td><td>${esc(NOMEPL[h.plano] || h.plano)}</td><td>${brl(h.valor)}</td><td class="small">${esc(h.transacao || '—')}</td></tr>`)) : vazioCard('Nenhum recebimento ainda', 'Pagamentos aprovados aparecem aqui.')}`;
  }

  async function inteligencia() {
    const d = await api('/api/central/inteligencia');
    return `<div class="card cp-ia"><h3>AGENDA X Intelligence</h3><p class="muted small">Feito só com os dados reais do banco, sem estimativas inventadas.</p><h4>Resumo do desempenho</h4><ul>${d.resumo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <div class="card mt"><h3>Alertas</h3>${d.alertas.length ? d.alertas.map((a) => `<p class="cp-al ${a.nivel}">${esc(a.texto)}</p>`).join('') : '<p class="muted">Nenhum alerta. Tudo certo com os dados atuais.</p>'}</div>
      <div class="card mt"><h3>Próximos do vencimento</h3>${d.vencendo.length ? `<div class="ag-list">${d.vencendo.map((v) => `<div class="it"><div class="grow"><b>${esc(v.nome)}</b><div class="muted small">${v.tipo === 'teste' ? 'Teste grátis termina' : 'Plano pago vence'} em ${dt(v.data)}</div></div><div>${v.dias} dia(s)</div></div>`).join('')}</div>` : '<p class="muted">Nada vencendo nos próximos dias.</p>'}</div>
      <div class="card mt"><h3>Recomendações</h3>${d.recomendacoes.map((r) => `<p>• ${esc(r.texto)}<br><span class="muted small">Base: ${esc(r.base)}</span></p>`).join('')}</div>`;
  }

  const VISTAS = { geral, planos, pagamentos, ativacao, teste, financeiro, inteligencia };
  let el = null;
  async function desenhar() {
    if (!el) return;
    const corpo = el.querySelector('#cp-corpo');
    try { corpo.innerHTML = await VISTAS[aba](); } catch (e) { corpo.innerHTML = `<div class="card">${vazio('Não foi possível carregar', e.message)}</div>`; }
    const q = $('#cp-q'), st = $('#cp-st');
    if (q) { q.addEventListener('change', (e) => { filtroPag.q = e.target.value; desenhar(); }); st.addEventListener('change', (e) => { filtroPag.status = e.target.value; desenhar(); }); }
  }
  VIEWS.central = async (e) => {
    if (!AX.me.admin) { location.hash = '#/painel'; return; }
    el = e;
    el.innerHTML = `<div class="cp-hero"><div class="cp-crown">${icon('coroa')}</div><div><h2>Central do Proprietário</h2><p>Assinaturas, pagamentos e faturamento do AGENDA X em um só lugar. Só você vê esta área.</p></div></div>
      <div class="tabs" role="tablist">${ABAS.map(([id, r]) => `<button role="tab" data-act="cp-aba" data-id="${id}" class="${id === aba ? 'on' : ''}">${r}</button>`).join('')}</div><div id="cp-corpo"><div class="empty">Carregando…</div></div>`;
    await desenhar();
  };
  act('cp-aba', (b) => { aba = b.dataset.id; el.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.id === aba)); $('#cp-corpo').innerHTML = '<div class="empty">Carregando…</div>'; desenhar(); });
})();
