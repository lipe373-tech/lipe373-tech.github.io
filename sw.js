// Service worker mínimo — necessário para o app ser instalável.
// Estratégia: sempre rede primeiro; sem cache agressivo para nunca servir versão velha.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {
  // passthrough: deixa o navegador buscar normalmente
});
