/* Service worker do AGENDA X: deixa o app instalável e abre a casca mesmo sem internet.
   Dados (/api) nunca são guardados no cache. */
const CACHE = 'agendax-v13';
const CASCA = ['/app', '/style.css', '/favicon.svg', '/icons/favicon.png', '/icons/logo-app.png', '/icons/icon-192.png', '/js/aparencia.js', '/js/core.js', '/js/views1.js', '/js/views2.js', '/js/alerta.js', '/js/admin.js', '/js/manual.js', '/js/main.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/app'))));
});

/* Push: toca e mostra o aviso mesmo com o app fechado. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { titulo: 'AGENDA X', mensagem: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'AGENDA X', {
    body: d.mensagem || '', tag: 'ax-' + (d.id || Date.now()), renotify: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 300], requireInteraction: d.tipo === 'agendamento', data: { url: d.url || '/app#/agenda' },
  }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true })).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'push', id: d.id }))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app#/agenda';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes('/app'));
    if (c) { c.focus(); if ('navigate' in c) c.navigate(url).catch(() => {}); return; }
    return self.clients.openWindow(url);
  }));
});
