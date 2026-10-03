// Service Worker Robusto para DigiRest v2 (POS Offline Resilient)
const CACHE_VERSION = 'pos-v2-cache-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

// Recursos esenciales del App Shell a precachear
const APP_SHELL_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg',
    '/icon.png',
    '/noti.mp3',
    '/note_snd.mp3'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE).then((cache) => {
            return cache.addAll(APP_SHELL_FILES).catch((err) => {
                console.warn('SW Precache advertencia (algunos archivos se cachearán bajo demanda):', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== APP_SHELL_CACHE && name !== STATIC_CACHE) {
                        console.log('SW: Limpiando caché obsoleta:', name);
                        return caches.delete(name);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. NUNCA interceptar peticiones que NO sean GET
    if (req.method !== 'GET') {
        return;
    }

    // 2. BYPASS TOTAL para API y WebSockets (manejados por ApiClient e IndexedDB)
    if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/socket.io/') ||
        url.pathname.startsWith('/uploads/') ||
        url.search.includes('_t=')
    ) {
        return; // Deja que el navegador y ApiClient manejen la red y fallbacks directamente
    }

    // 3. NAVEGACIÓN (HTML / App Shell): Network-First con fallback inmediato a caché
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((networkRes) => {
                    if (networkRes && networkRes.status === 200) {
                        const copy = networkRes.clone();
                        caches.open(APP_SHELL_CACHE).then((cache) => cache.put(req, copy));
                    }
                    return networkRes;
                })
                .catch(async () => {
                    // Si no hay red (offline o servidor caído), devolver index.html de la caché
                    const cached = await caches.match(req) || await caches.match('/') || await caches.match('/index.html');
                    if (cached) return cached;
                    return new Response('<html><body><h2>Modo sin conexión</h2><p>Recarga cuando vuelva la conexión.</p></body></html>', {
                        headers: { 'Content-Type': 'text/html' }
                    });
                })
        );
        return;
    }

    // 4. ASSETS ESTÁTICOS (JS, CSS, Fuentes, Iconos, Audio): Stale-While-Revalidate
    if (
        url.pathname.startsWith('/assets/') ||
        url.pathname.startsWith('/webfonts/') ||
        url.pathname.startsWith('/img/') ||
        /\.(js|css|webp|png|jpg|jpeg|svg|ico|woff2?|ttf|mp3)$/i.test(url.pathname)
    ) {
        event.respondWith(
            caches.match(req).then((cachedRes) => {
                const fetchPromise = fetch(req)
                    .then((networkRes) => {
                        if (networkRes && networkRes.status === 200) {
                            const copy = networkRes.clone();
                            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
                        }
                        return networkRes;
                    })
                    .catch(() => cachedRes); // Si falla la red, ya tenemos cachedRes

                // Devolver inmediatamente la caché si existe, o esperar a la red
                return cachedRes || fetchPromise;
            })
        );
        return;
    }

    // 5. Cualquier otra petición estática menor: Cache-first con fallback a red
    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
    );
});
