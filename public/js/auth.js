(function () {
  const $ = (id) => document.getElementById(id);
  const MEM = 'ax_conta';
  const lembrada = () => { try { const d = JSON.parse(localStorage.getItem(MEM) || 'null'); return d && d.email ? d : null; } catch (_) { return null; } };
  const lembrar = (u) => { try { if (u && u.email) localStorage.setItem(MEM, JSON.stringify({ email: u.email, nome: u.nome || '' })); } catch (_) { /* sem storage */ } };
  const esquecer = () => { try { localStorage.removeItem(MEM); } catch (_) { /* sem storage */ } };
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function mostrar(v) {
    $('v-inicio').classList.toggle('hide', v !== 'inicio');
    $('v-login').classList.toggle('hide', v !== 'login');
    $('v-reg').classList.toggle('hide', v !== 'reg');
    $('v-rec').classList.toggle('hide', v !== 'rec');
    $('v-cod').classList.toggle('hide', v !== 'cod');
    $('v-red').classList.toggle('hide', v !== 'red');
    $('v-adm').classList.toggle('hide', v !== 'adm');
    history.replaceState(null, '', v === 'reg' ? '#cadastro' : '#');
    if (v === 'login') { const m = lembrada(); if (m && !$('l-email').value) $('l-email').value = m.email; setTimeout(() => ($('l-email').value ? $('l-senha') : $('l-email')).focus({ preventScroll: true }), 50); }
  }
  document.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); mostrar(a.dataset.go); }));
  const mem = lembrada();
  if (mem) {
    $('lembrada').classList.remove('hide'); $('lb-outra').classList.remove('hide');
    $('lb-nome').textContent = mem.nome || mem.email; $('lb-email').textContent = mem.email; $('lb-av').textContent = (mem.nome || mem.email)[0].toUpperCase();
    $('b-continuar').textContent = 'Continuar como ' + (mem.nome || mem.email).split(' ')[0];
    $('l-email').value = mem.email;
  }
  $('b-outra').addEventListener('click', (e) => { e.preventDefault(); esquecer(); $('l-email').value = ''; $('lembrada').classList.add('hide'); $('lb-outra').classList.add('hide'); $('b-continuar').textContent = 'Entrar na minha conta'; });
  // Link de redefinição vindo do e-mail (#redefinir=TOKEN): o token sai da barra de endereço na hora
  let tokenRed = '';
  const mt = /^#redefinir=([A-Za-z0-9_-]{20,100})$/.exec(location.hash);
  if (mt) tokenRed = mt[1];
  mostrar(tokenRed ? 'red' : location.hash === '#cadastro' ? 'reg' : 'inicio');
  // recuperação por e-mail só aparece quando o servidor tem o envio de e-mails ligado
  fetch('/api/auth/recursos').then((r) => r.json()).then((d) => {
    if (!d.email) return;
    $('rec-email-box').classList.remove('hide'); $('rec-cod-box').classList.add('hide'); $('rec-usar-email-p').classList.remove('hide');
  }).catch(() => {});
  $('rec-usar-cod').addEventListener('click', (e) => { e.preventDefault(); $('rec-email-box').classList.add('hide'); $('rec-cod-box').classList.remove('hide'); });
  $('rec-usar-email').addEventListener('click', (e) => { e.preventDefault(); $('rec-cod-box').classList.add('hide'); $('rec-email-box').classList.remove('hide'); });
  // mostrar/ocultar senha
  document.querySelectorAll('input[type=password]').forEach((i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ver-senha'; b.textContent = 'Mostrar'; b.setAttribute('aria-label', 'Mostrar ou ocultar a senha');
    i.parentNode.style.position = 'relative'; i.style.paddingRight = '84px'; i.after(b);
    b.addEventListener('click', () => { const v = i.type === 'password'; i.type = v ? 'text' : 'password'; b.textContent = v ? 'Ocultar' : 'Mostrar'; });
  });
  $('b-existe-entrar').addEventListener('click', () => { $('l-email').value = $('r-email').value.trim().toLowerCase(); mostrar('login'); });
  $('b-existe-rec').addEventListener('click', () => { $('rc-email').value = $('r-email').value.trim().toLowerCase(); mostrar('rec'); });

  // Cadastro inteligente: avisa na hora se o e-mail já tem conta e sugere correção de erros de digitação comuns.
  const DOMINIOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.com.br': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com', 'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com' };
  $('r-email').addEventListener('blur', async () => {
    const em = $('r-email').value.trim().toLowerCase(), dica = $('r-email-dica');
    dica.textContent = ''; $('r-existe').classList.add('hide');
    if (!em) return;
    if (!EMAIL_OK.test(em)) { dica.textContent = 'Esse e-mail parece incompleto. Exemplo: nome@email.com'; return; }
    const dom = em.split('@')[1];
    if (DOMINIOS[dom]) { const certo = em.split('@')[0] + '@' + DOMINIOS[dom]; dica.innerHTML = 'Você quis dizer <a href="#" id="r-corrigir">' + certo.replace(/[<>&"]/g, '') + '</a>?'; $('r-corrigir').addEventListener('click', (e) => { e.preventDefault(); $('r-email').value = certo; $('r-email').dispatchEvent(new Event('blur')); }); }
    try {
      const r = await fetch('/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) });
      const d = await r.json();
      if (r.ok && d.existe && $('r-email').value.trim().toLowerCase() === em) $('r-existe').classList.remove('hide');
    } catch (_) { /* sem rede: o servidor confere no envio */ }
  });
  async function enviar(url, corpo, btn, erroEl) {
    erroEl.classList.add('hide'); $('r-existe').classList.add('hide'); btn.disabled = true;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(d.erro || 'Não foi possível concluir. Tente novamente.'); e.dados = d; throw e; }
      if (d.usuario) lembrar(d.usuario);
      if (d.codigo_recuperacao) { mostrarCodigo(d.codigo_recuperacao, url.indexOf('recuperar') > -1 ? '#' : '/app'); btn.disabled = false; return; }
      if (d.usuario) lembrar(d.usuario);
      location.href = '/app';
    } catch (e) {
      if (e.dados && e.dados.existe) $('r-existe').classList.remove('hide');
      erroEl.textContent = e.message; erroEl.classList.remove('hide'); btn.disabled = false;
    }
  }
  function mostrarCodigo(cod, destino) {
    $('cod-txt').textContent = cod; mostrar('cod');
    $('b-cod-copiar').onclick = async () => { try { await navigator.clipboard.writeText(cod); $('b-cod-copiar').textContent = 'Copiado!'; } catch (_) { /* seleção manual */ } };
    $('b-cod-ok').onclick = () => { if (destino === '#') { mostrar('login'); } else location.href = destino; };
  }
  $('f-rec').addEventListener('submit', (e) => {
    e.preventDefault();
    enviar('/api/auth/recuperar', { email: $('rc-email').value, codigo: $('rc-cod').value, nova: $('rc-nova').value }, $('b-rec'), $('e-rec'));
  });
  $('f-esq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const er = $('e-esq'), ok = $('ok-esq'), btn = $('b-esq'), em = $('es-email').value.trim();
    er.classList.add('hide'); ok.classList.add('hide');
    if (!EMAIL_OK.test(em)) { er.textContent = 'Digite um e-mail válido. Exemplo: nome@email.com'; er.classList.remove('hide'); return; }
    btn.disabled = true;
    try {
      const r = await fetch('/api/auth/esqueci', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível enviar agora. Tente de novo.');
      ok.textContent = 'Pronto! Se existir uma conta com esse e-mail, enviamos um link. Confira a caixa de entrada e o spam. O link vale por 1 hora.'; ok.classList.remove('hide');
    } catch (x) { er.textContent = x.message; er.classList.remove('hide'); }
    btn.disabled = false;
  });
  $('f-red').addEventListener('submit', async (e) => {
    e.preventDefault();
    const er = $('e-red'), btn = $('b-red'); er.classList.add('hide');
    if ($('rd-nova').value.length < 8) { er.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; er.classList.remove('hide'); return; }
    btn.disabled = true;
    try {
      const r = await fetch('/api/auth/redefinir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenRed, nova: $('rd-nova').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível salvar. Tente de novo.');
      tokenRed = ''; $('rd-nova').value = ''; mostrar('login');
      $('ok-login').textContent = 'Senha alterada! Entre com a nova senha.'; $('ok-login').classList.remove('hide');
    } catch (x) { er.textContent = x.message; er.classList.remove('hide'); }
    btn.disabled = false;
  });
  function invalido(erroEl, campo, msg) { erroEl.textContent = msg; erroEl.classList.remove('hide'); campo.focus(); return true; }
  $('f-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const em = $('l-email').value.trim();
    if (!em) return invalido($('e-login'), $('l-email'), 'Digite seu e-mail.');
    if (!EMAIL_OK.test(em)) return invalido($('e-login'), $('l-email'), 'Esse e-mail parece incompleto. Exemplo: nome@email.com');
    if (!$('l-senha').value) return invalido($('e-login'), $('l-senha'), 'Digite sua senha.');
    enviar('/api/auth/login', { email: em, senha: $('l-senha').value, manter: $('l-manter').checked }, $('b-login'), $('e-login'));
  });
  $('f-reg').addEventListener('submit', (e) => {
    e.preventDefault();
    const plano = document.querySelector('input[name=plano]:checked').value, em = $('r-email').value.trim(), er = $('e-reg');
    if (!$('r-est').value.trim()) return invalido(er, $('r-est'), 'Informe o nome do seu estabelecimento.');
    if (!$('r-nome').value.trim()) return invalido(er, $('r-nome'), 'Informe o seu nome.');
    if (!EMAIL_OK.test(em)) return invalido(er, $('r-email'), 'Digite um e-mail válido. Exemplo: nome@email.com');
    if ($('r-senha').value.length < 8) return invalido(er, $('r-senha'), 'A senha precisa ter pelo menos 8 caracteres.');
    enviar('/api/auth/register', { nome_estabelecimento: $('r-est').value, nome: $('r-nome').value, email: em, senha: $('r-senha').value, plano, manter: $('r-manter').checked }, $('b-reg'), $('e-reg'));
  });
  $('f-adm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const er = $('e-adm'), btn = $('b-adm'); er.classList.add('hide');
    if (!EMAIL_OK.test($('a-email').value.trim()) || !$('a-senha').value) return invalido(er, $('a-email'), 'Digite o e-mail e a senha.');
    btn.disabled = true;
    try {
      const r = await fetch('/api/auth/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('a-email').value, senha: $('a-senha').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Acesso negado.');
      location.href = '/app#/admin';
    } catch (x) { er.textContent = x.message; er.classList.remove('hide'); btn.disabled = false; }
  });
  // já logado? vai direto ao painel
  if (!tokenRed) fetch('/api/me').then((r) => { if (r.ok) location.href = '/app'; }).catch(() => {});
})();
