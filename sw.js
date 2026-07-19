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
