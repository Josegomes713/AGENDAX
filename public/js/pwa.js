/* Registro do service worker e botão "Instalar app". */
(function () {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  let evt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); evt = e;
    document.querySelectorAll('[data-install]').forEach((b) => b.classList.remove('hide'));
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]'); if (!b || !evt) return;
    evt.prompt(); try { await evt.userChoice; } catch (_) { /* ignorado */ } evt = null;
    document.querySelectorAll('[data-install]').forEach((x) => x.classList.add('hide'));
  });
})();
