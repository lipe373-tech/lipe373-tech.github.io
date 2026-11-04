// Service worker mínimo — necessário para o app ser instalável.
// Estratégia: sempre rede (sem cache), para nunca servir versão velha.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // limpa qualquer cache antigo que tenha ficado de versões anteriores
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
// sem handler de fetch: o navegador busca tudo direto da rede

// Aviso diário da aba Tráfego (enviado por api/trafego-avisos.mjs).
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json().data || {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.titulo || 'Saldo de anúncios', {
    body: d.corpo || 'Há contas perto de acabar.',
    icon: 'icon-192.png',
    tag: 'trafego-aviso',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (abertas.length) return abertas[0].focus();
    return self.clients.openWindow('./');
  })());
});
