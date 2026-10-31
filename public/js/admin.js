/* Administração: só aparece para o dono da plataforma (e-mail em ADMIN_EMAILS). Mostra contas e situação, nunca os dados dos clientes de cada negócio. */
(function () {
  let DADOS = null, filtro = { q: '', st: '' };
  const ROT = { trial: 'Em teste', ativa: 'Assinante', gratis: 'Limitada', suspensa: 'Suspensa' };
  const COR = { trial: 'b-agendado', ativa: 'b-concluido', gratis: 'b-faltou', suspensa: 'b-cancelado' };
  const NOMEPL = { basico: 'Básico', profissional: 'Profissional', premium: 'Premium' };
  const dataBr = (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '');
  function lista() {
    const q = filtro.q.trim().toLowerCase();
    const cs = DADOS.contas.filter((c) => (!filtro.st || c.status === filtro.st) && (!q || [c.nome, c.responsavel, c.email].join(' ').toLowerCase().includes(q)));
    $('#adm-lista').innerHTML = cs.length ? cs.map((c) => `<div class="card adm-row"><div class="grow"><b>${esc(c.nome)}</b> ${c.dono ? '<span class="badge b-plano">Proprietário</span>' : ''}<div class="muted small">${esc(c.responsavel)} · ${esc(c.email)}</div>
        <div class="muted small">Criada em ${dataBr(c.criado_em)} · ${c.uso.clientes} clientes · ${c.uso.profissionais} prof. · ${c.uso.agendamentos} agendamentos</div></div>
      <div class="adm-st"><span class="badge ${COR[c.status] || ''}">${ROT[c.status] || esc(c.status)}</span><div class="muted small">${c.status === 'trial' ? c.dias_restantes + ' dia(s) restante(s)' : c.status === 'ativa' ? 'Plano ' + esc(NOMEPL[c.plano] || c.plano) : ''}</div></div>
      ${c.dono ? '' : `<button class="btn sm" data-act="adm-gerir" data-id="${c.id}">Gerenciar</button>`}</div>`).join('') : '<div class="card">' + vazio('Nenhuma conta encontrada', 'Ajuste a busca ou o filtro.') + '</div>';
  }
  VIEWS.admin = async (el) => {
    if (!AX.me.admin) { location.hash = '#/painel'; return; }
    DADOS = await api('/api/admin/resumo');
    const t = DADOS.totais;
    const card = (l, v) => `<div class="card stat"><div class="lbl">${l}</div><div class="val num">${v}</div></div>`;
    el.innerHTML = `<p class="muted">Área só sua. Aqui você acompanha as contas e libera, estende ou suspende o acesso. Os clientes e a agenda de cada negócio não aparecem aqui.</p>
      <div class="grid g4 keep2 mt">${card('Contas', t.contas)}${card('Em teste', t.em_teste)}${card('Assinantes', t.assinantes)}${card('Limitadas', t.limitadas)}</div>
      <div class="grid g4 keep2 mt">${card('Novas em 7 dias', t.novas_7d)}${card('Novas em 30 dias', t.novas_30d)}${card('Suspensas', t.suspensas)}</div>
      <div class="toolbar mt"><input class="inp grow" id="adm-q" placeholder="Buscar por negócio, nome ou e-mail" aria-label="Buscar"><select class="inp" id="adm-st" aria-label="Situação" style="max-width:200px"><option value="">Todas as situações</option>${Object.entries(ROT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div id="adm-lista" class="grid"></div>
      <div class="card mt"><h3>Últimas ações</h3>${DADOS.historico.length ? `<div class="ag-list">${DADOS.historico.map((h) => `<div class="it"><div class="grow"><b>${esc(h.detalhe)}</b><div class="muted small">Conta nº ${h.estabelecimento_id} · ${esc(h.admin_email)}</div></div><div class="muted small">${esc(h.quando)}</div></div>`).join('')}</div>` : '<p class="muted">Nenhuma ação ainda.</p>'}</div>`;
    filtro = { q: '', st: '' }; lista();
    $('#adm-q').addEventListener('input', (e) => { filtro.q = e.target.value; lista(); });
    $('#adm-st').addEventListener('change', (e) => { filtro.st = e.target.value; lista(); });
  };
  act('adm-gerir', (b) => {
    const c = DADOS.contas.find((x) => String(x.id) === b.dataset.id);
    modal({ titulo: 'Gerenciar: ' + c.nome, rotuloSalvar: 'Aplicar',
      corpo: `<p class="muted small">${esc(c.responsavel)} · ${esc(c.email)}<br>Situação atual: <b>${ROT[c.status] || c.status}</b>${c.status === 'trial' ? ` (${c.dias_restantes} dia(s) restante(s), até ${dataBr(c.trial_ate)})` : ''}</p>
        <div class="field"><label class="f" for="ad-acao">O que fazer?</label><select class="inp" id="ad-acao">
          <option value="plano">Liberar um plano pago</option><option value="estender">Estender o teste grátis</option><option value="limitar">Voltar ao plano limitado</option>${c.suspenso ? '<option value="reativar">Reativar a conta</option>' : '<option value="suspender">Suspender a conta</option>'}</select></div>
        <div class="field" id="ad-plano-box"><label class="f" for="ad-plano">Plano</label><select class="inp" id="ad-plano"><option value="basico">Básico</option><option value="profissional" selected>Profissional</option><option value="premium">Premium</option></select></div>
        <div class="field hide" id="ad-dias-box"><label class="f" for="ad-dias">Quantos dias a mais?</label><input class="inp" id="ad-dias" type="number" min="1" max="365" value="14"></div>
        <p class="hint hide" id="ad-aviso"><b>Atenção:</b> suspender encerra o acesso da conta e tira a página de agendamento do ar. Os dados ficam guardados e você pode reativar quando quiser.</p>`,
      salvar: async () => {
        const acao = $('#ad-acao').value;
        await api('/api/admin/contas/' + c.id, 'POST', { acao, plano: $('#ad-plano').value, dias: $('#ad-dias').value });
        fecharModal(); toast('Conta atualizada.', 'ok'); recarregar();
      } });
    const ajusta = () => { const a = $('#ad-acao').value; $('#ad-plano-box').classList.toggle('hide', a !== 'plano'); $('#ad-dias-box').classList.toggle('hide', a !== 'estender'); $('#ad-aviso').classList.toggle('hide', a !== 'suspender'); };
    $('#ad-acao').addEventListener('change', ajusta); ajusta();
  });
})();
