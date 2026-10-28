/* Administração: só aparece para o dono da plataforma (e-mail em ADMIN_EMAILS). Mostra contas e situação, nunca os dados dos clientes de cada negócio. */
(function () {
  let DADOS = null, PAGCFG = null, filtro = { q: '', st: '' };
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
  const MODO = { desligado: ['Desligado', 'b-faltou'], teste: ['Modo de teste', 'b-agendado'], producao: ['Cobrança real', 'b-concluido'] };
  function pagCartao() {
    const el = $('#adm-pag'); if (!el) return;
    const p = PAGCFG;
    if (!p) { el.innerHTML = ''; return; }
    const m = MODO[p.modo] || MODO.desligado, orig = (o) => (o === 'painel' ? 'painel' : o === 'servidor' ? 'servidor' : '');
    el.innerHTML = `<div class="card mt"><div class="row between"><h3>Pagamentos dos planos (Pix · Mercado Pago)</h3><span class="badge ${m[1]}">${m[0]}</span></div>
      <p class="muted small">Cole aqui o token e a assinatura do Mercado Pago. Eles ficam guardados criptografados no servidor e nunca aparecem de volta nesta tela.</p>
      <div class="adm-pg-linhas">
        <div><span class="muted small">Access Token</span><br><b>${p.token.definido ? esc(p.token.mascara) : 'não definido'}</b>${p.token.definido ? ` <span class="muted small">(${orig(p.token.origem)})</span>` : ''}</div>
        <div><span class="muted small">Assinatura do webhook</span><br><b>${p.segredo.definido ? 'definida' : 'não definida'}</b>${p.segredo.definido ? ` <span class="muted small">(${orig(p.segredo.origem)})</span>` : ''}</div>
        <div><span class="muted small">Endereço do app</span><br><b>${p.public_url ? esc(p.public_url) : 'não definido'}</b></div>
      </div>
      ${p.webhook_url ? `<p class="small mt-s">Endereço do aviso (webhook) para cadastrar no Mercado Pago:<br><code id="adm-wh">${esc(p.webhook_url)}</code> <button class="btn sm" data-act="adm-pag-copiar">Copiar</button></p>` : '<p class="hint mt-s">Informe o endereço do app para ver o endereço do webhook.</p>'}
      ${p.modo === 'producao' ? '<p class="hint mt-s"><b>Atenção:</b> o token é de produção. Os pagamentos são reais.</p>' : ''}
      <div class="row mt" style="gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="adm-pag-editar">Configurar</button><button class="btn" data-act="adm-pag-testar" ${p.token.definido ? '' : 'disabled'}>Testar conexão</button></div>
      <p class="muted small mt-s" id="adm-pag-res" aria-live="polite"></p></div>`;
  }
  act('adm-pag-copiar', async (b) => { try { await navigator.clipboard.writeText($('#adm-wh').textContent); b.textContent = 'Copiado!'; } catch (_) { /* seleção manual */ } });
  act('adm-pag-testar', async (b) => {
    const r = $('#adm-pag-res'); r.textContent = 'Testando…'; b.disabled = true;
    try { const d = await api('/api/admin/pagamentos/testar', 'POST', {}); r.textContent = '✅ Conexão certa. Conta do Mercado Pago' + (d.conta && d.conta.nome ? ': ' + d.conta.nome : '') + ' · ' + (MODO[d.modo] || MODO.desligado)[0] + '.'; }
    catch (e) { r.textContent = '❌ ' + e.message; }
    b.disabled = false;
  });
  act('adm-pag-editar', () => {
    const p = PAGCFG;
    modal({ titulo: 'Pagamentos: Mercado Pago', rotuloSalvar: 'Salvar',
      corpo: `<p class="muted small">Deixe em branco o que não quiser mudar. Comece com o token de <b>teste</b> (TEST-). O de produção (APP_USR-) cobra de verdade.</p>
        <div class="field"><label class="f" for="pg-tok">Access Token</label><input class="inp" id="pg-tok" type="password" autocomplete="off" placeholder="${p.token.definido ? 'já definido — cole outro para trocar' : 'TEST-… ou APP_USR-…'}"></div>
        <div class="field"><label class="f" for="pg-seg">Assinatura secreta do webhook</label><input class="inp" id="pg-seg" type="password" autocomplete="off" placeholder="${p.segredo.definido ? 'já definida — cole outra para trocar' : 'copie do painel do Mercado Pago, em Webhooks'}"></div>
        <div class="field"><label class="f" for="pg-url">Endereço do app</label><input class="inp" id="pg-url" type="url" autocomplete="off" value="${esc(p.public_url || location.origin)}"></div>
        ${p.token.origem === 'painel' || p.segredo.origem === 'painel' ? '<div class="field"><label class="chk"><input type="checkbox" id="pg-rem"> Apagar as credenciais salvas no painel</label></div>' : ''}`,
      salvar: async () => {
        const rem = $('#pg-rem') && $('#pg-rem').checked;
        PAGCFG = await api('/api/admin/pagamentos', 'PUT', { access_token: $('#pg-tok').value, webhook_secret: $('#pg-seg').value, public_url: $('#pg-url').value, remover_token: rem && p.token.origem === 'painel', remover_segredo: rem && p.segredo.origem === 'painel' });
        fecharModal(); toast('Pagamentos atualizados.', 'ok'); pagCartao();
      } });
  });
  VIEWS.admin = async (el) => {
    if (!AX.me.admin) { location.hash = '#/painel'; return; }
    DADOS = await api('/api/admin/resumo');
    PAGCFG = await api('/api/admin/pagamentos').catch(() => null);
    const t = DADOS.totais;
    const card = (l, v) => `<div class="card stat"><div class="lbl">${l}</div><div class="val num">${v}</div></div>`;
    el.innerHTML = `<p class="muted">Área só sua. Aqui você acompanha as contas e libera, estende ou suspende o acesso. Os clientes e a agenda de cada negócio não aparecem aqui.</p>
      <div id="adm-pag"></div>
      <div class="grid g4 keep2 mt">${card('Contas', t.contas)}${card('Em teste', t.em_teste)}${card('Assinantes', t.assinantes)}${card('Limitadas', t.limitadas)}</div>
      <div class="grid g4 keep2 mt">${card('Novas em 7 dias', t.novas_7d)}${card('Novas em 30 dias', t.novas_30d)}${card('Suspensas', t.suspensas)}</div>
      <div class="toolbar mt"><input class="inp grow" id="adm-q" placeholder="Buscar por negócio, nome ou e-mail" aria-label="Buscar"><select class="inp" id="adm-st" aria-label="Situação" style="max-width:200px"><option value="">Todas as situações</option>${Object.entries(ROT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div id="adm-lista" class="grid"></div>
      <div class="card mt"><h3>Últimas ações</h3>${DADOS.historico.length ? `<div class="ag-list">${DADOS.historico.map((h) => `<div class="it"><div class="grow"><b>${esc(h.detalhe)}</b><div class="muted small">Conta nº ${h.estabelecimento_id} · ${esc(h.admin_email)}</div></div><div class="muted small">${esc(h.quando)}</div></div>`).join('')}</div>` : '<p class="muted">Nenhuma ação ainda.</p>'}</div>`;
    filtro = { q: '', st: '' }; pagCartao(); lista();
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
