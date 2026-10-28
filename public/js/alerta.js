/* Alertas: som de mensagem, aviso no celular (push), tempo real sem recarregar a página. */
(function () {
  const lerPref = (k, p) => { try { const v = localStorage.getItem(k); return v == null ? p : v; } catch (_) { return p; } };
  const gravarPref = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem storage */ } };
  let ctx = null;
  const somLigado = () => lerPref('ax_som', '1') === '1';
  function audio() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // O navegador só libera som depois de um toque do usuário: destrava no primeiro clique/toque.
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { audio(); }, { passive: true }));
  function tocar() {
    const c = audio(); if (!c || !somLigado()) return;
    const notas = [[659.25, 0], [880, 0.14], [1108.73, 0.28], [659.25, 0.9], [880, 1.04], [1108.73, 1.18]];
    notas.forEach(([f, t]) => {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + t;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.45);
    });
  }
  async function avisoSistema(n) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const opts = { body: n.mensagem || '', tag: 'ax-' + n.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', renotify: true, vibrate: [200, 100, 200], data: { url: '/app#/agenda' } };
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg) await reg.showNotification(n.titulo, opts); else new Notification(n.titulo, opts);
    } catch (_) { /* ignora */ }
  }
  let sino = null;
  AX.avisar = function (n, qtd) {
    tocar();
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (_) { /* nada */ }
    toast((qtd > 1 ? `(${qtd} novos) ` : '') + n.titulo + (n.mensagem ? ' — ' + n.mensagem : ''));
    const b = document.getElementById('b-bell');
    if (b) { b.classList.remove('ring'); void b.offsetWidth; b.classList.add('ring'); }
    if (document.hidden && !AX.pushAtivo) avisoSistema(n); // com push ativo, o aviso já vem do servidor
    void sino;
  };
  AX.tempoReal = function (fn) {
    const local = !!window.AXBackend;
    if (!local && 'EventSource' in window) {
      try { const es = new EventSource('/api/eventos'); es.onmessage = () => fn(); } catch (_) { /* usa só o intervalo */ }
    }
    setInterval(fn, local ? 4000 : 20000);
    window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('agendax') === 0) fn(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
    window.addEventListener('focus', fn);
  };
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  async function inscreverPush() {
    if (window.AXBackend || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { chave } = await api('/api/push/chave');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(chave) });
    }
    await api('/api/push/assinar', 'POST', { subscription: sub.toJSON() });
    AX.pushAtivo = true; return true;
  }
  AX.estadoAlerta = function () {
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    return { perm, som: somLigado() };
  };
  AX.controlesAlerta = function () {
    const e = AX.estadoAlerta();
    const aviso = e.perm === 'granted' ? '<span class="ok-txt">Avisos no celular: ativados</span>' : e.perm === 'denied' ? '<span class="muted small">Avisos bloqueados no navegador. Libere nas configurações do site.</span>' : e.perm === 'unsupported' ? '<span class="muted small">Este navegador não suporta avisos. No iPhone, adicione o app à Tela de Início.</span>' : '<button class="btn sm primary" data-act="alerta-ativar">Ativar avisos no celular</button>';
    return `<div class="alerta-ctl"><div class="row between"><span>Som de mensagem</span><button class="btn sm" data-act="som-alternar">${e.som ? 'Ligado' : 'Desligado'}</button></div>
      <div class="row between" style="margin-top:8px"><span>${aviso}</span><button class="btn sm ghost" data-act="alerta-testar">Testar alerta</button></div></div>`;
  };
  act('som-alternar', (b) => { const v = !somLigado(); gravarPref('ax_som', v ? '1' : '0'); b.textContent = v ? 'Ligado' : 'Desligado'; if (v) tocar(); });
  act('alerta-testar', async () => {
    if (window.AXBackend) AX.avisar({ id: 'teste' + Date.now(), titulo: 'Novo agendamento online 📅', mensagem: 'Ana Souza — Corte em 24/10 às 15:00 com você.' });
    else await api('/api/push/testar', 'POST'); // chega pelo tempo real, como um agendamento de verdade
    audio();
  });
  act('alerta-ativar', async () => {
    audio(); tocar();
    if (!('Notification' in window)) throw new Error('Este navegador não suporta avisos.');
    const r = await Notification.requestPermission();
    if (r !== 'granted') throw new Error('Os avisos não foram permitidos.');
    let push = false;
    try { push = await inscreverPush(); } catch (_) { push = false; }
    toast(push ? 'Pronto! O celular vai tocar mesmo com o app fechado.' : 'Avisos ativados enquanto o app estiver aberto.');
    const chip = document.getElementById('alerta-chip'); if (chip) chip.remove();
    const p = document.getElementById('notif-panel'); if (p) p.classList.add('hide');
  });
  act('alerta-depois', () => { gravarPref('ax_chip', '0'); const c = document.getElementById('alerta-chip'); if (c) c.remove(); });
  window.addEventListener('load', async () => {
    const e = AX.estadoAlerta();
    if (e.perm === 'granted') { try { await inscreverPush(); } catch (_) { /* ok */ } }
    else if (e.perm === 'default' && lerPref('ax_chip', '1') === '1') {
      const ban = document.getElementById('banner'); if (!ban) return;
      const d = document.createElement('div'); d.id = 'alerta-chip';
      d.innerHTML = '<div class="banner trial"><span>🔔 Receba um <b>som de mensagem</b> e aviso no celular assim que um cliente marcar horário.</span><span class="row"><button class="btn sm primary" data-act="alerta-ativar">Ativar alertas</button><button class="btn sm ghost" data-act="alerta-depois">Agora não</button></span></div>';
      ban.after(d);
    }
  });
})();
