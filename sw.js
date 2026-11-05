// Service worker: permite abrir o app sem internet e instalá-lo como aplicativo.
// IMPORTANTE: ao mudar qualquer arquivo do app, aumente a versão abaixo.
const CACHE = 'diario-v1.1.0';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/theme.js',
  './js/app.js',
  './js/db.js',
  './js/sync.js',
  './js/voice.js',
  './js/config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('diario-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Arquivos do próprio app: tenta a rede primeiro (para receber atualizações) e,
// sem internet ou com rede muito lenta, usa a cópia guardada.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  });
  fromNetwork.catch(() => {}); // evita aviso de erro não tratado quando a cópia guardada é usada
  try {
    return await Promise.race([
      fromNetwork,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fromNetwork; // sem cópia: espera a rede (ou falha normalmente)
  }
}

// Biblioteca do Supabase (endereço com versão fixa => nunca muda): cache primeiro.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/')) {
    event.respondWith(cacheFirst(req));
  }
  // Demais (API do Supabase): não intercepta — dados sempre vão direto para a nuvem.
});
