// Service Worker Robusto para DigiRest v2 (POS Offline Resilient)
const CACHE_VERSION = 'pos-v2-cache-v3';
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
        caches.open(APP_SHELL_CACHE).then(async (cache) => {
            // Precacheo individual tolerante a fallos: si un recurso secundario falla,
            // no impide que '/' y '/index.html' queden guardados en caché.
            await Promise.allSettled(
                APP_SHELL_FILES.map(async (assetUrl) => {
                    try {
                        const res = await fetch(assetUrl, {
                            credentials: 'same-origin',
                            cache: 'no-cache'
                        });
                        if (res && res.ok) {
                            await cache.put(assetUrl, res);
                        }
                    } catch (err) {
                        console.warn('SW Precache advertencia para', assetUrl, err);
                    }
                })
            );
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

async function cacheNavigationShell(req, res) {
    if (!res || res.status !== 200) return;
    try {
        const copyReq = res.clone();
        const copyRoot = res.clone();
        const copyIndex = res.clone();
        const cache = await caches.open(APP_SHELL_CACHE);
        await Promise.allSettled([
            cache.put(req, copyReq),
            cache.put('/', copyRoot),
            cache.put('/index.html', copyIndex)
        ]);
    } catch (_) {
        // Ignorar errores de cuota o escritura en caché
    }
}

async function handleNavigationRequest(req, url) {
    try {
        const networkRes = await fetch(req);
        if (networkRes && networkRes.status === 200) {
            cacheNavigationShell(req, networkRes);
            return networkRes;
        }
        if (networkRes) {
            return networkRes;
        }
    } catch (_) {
        // Al pulsar F5/reload, algunos navegadores fallan al reenviar el Request crudo con mode:'navigate'.
        // Reintentar con una petición GET limpia same-origin antes de declarar estado offline.
        try {
            const cleanRes = await fetch(url.pathname + url.search, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-cache'
            });
            if (cleanRes && cleanRes.ok) {
                if (cleanRes.status === 200) {
                    cacheNavigationShell(req, cleanRes);
                }
                return cleanRes;
            }
        } catch (_) {
            // Continuar al fallback de /index.html en red
        }

        try {
            const indexRes = await fetch('/index.html', {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-cache'
            });
            if (indexRes && indexRes.ok) {
                if (indexRes.status === 200) {
                    cacheNavigationShell(req, indexRes);
                }
                return indexRes;
            }
        } catch (_) {
            // Todos los intentos de red fallaron (offline real)
        }
    }

    // Sin red real: devolver App Shell desde caché
    const cached =
        (await caches.match(req, { ignoreSearch: true })) ||
        (await caches.match('/index.html', { ignoreSearch: true })) ||
        (await caches.match('/', { ignoreSearch: true }));
    if (cached) return cached;

    return new Response(
        '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Modo sin conexión</title></head><body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1e293b;text-align:center;padding:24px;"><div><h2 style="margin:0 0 8px;">Modo sin conexión</h2><p style="margin:0 0 16px;color:#475569;">Recarga cuando vuelva la conexión.</p><button onclick="location.reload()" style="background:#f97316;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:15px;font-weight:600;cursor:pointer;">Recargar</button></div></body></html>',
        {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }
    );
}

async function handleAssetRequest(req, url) {
    const saveCopy = (res) => {
        if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
    };

    try {
        const networkRes = await fetch(req);
        saveCopy(networkRes);
        return networkRes;
    } catch (_) {
        try {
            const retryTarget = url.origin === self.location.origin ? (url.pathname + url.search) : req.url;
            const retryRes = await fetch(retryTarget, { credentials: 'same-origin' });
            saveCopy(retryRes);
            return retryRes;
        } catch (_) {
            const cached = await caches.match(req, { ignoreSearch: true });
            if (cached) return cached;
            throw _;
        }
    }
}

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

    // 3. NAVEGACIÓN (HTML / App Shell): Network-First con reintento limpio en F5 y fallback a caché
    if (req.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(req, url));
        return;
    }

    // 4. SCRIPTS Y ESTILOS (JS, CSS): Network-First con reintento limpio y fallback a caché
    if (
        url.pathname.startsWith('/assets/') ||
        /\.(js|css)$/i.test(url.pathname)
    ) {
        event.respondWith(handleAssetRequest(req, url));
        return;
    }

    // 5. ASSETS MULTIMEDIA (Fuentes, Iconos, Audio, Imágenes): Cache-First con fallback a red
    if (
        url.pathname.startsWith('/webfonts/') ||
        url.pathname.startsWith('/img/') ||
        /\.(webp|png|jpg|jpeg|svg|ico|woff2?|ttf|mp3)$/i.test(url.pathname)
    ) {
        event.respondWith(
            caches.match(req).then((cachedRes) => {
                if (cachedRes) return cachedRes;
                return fetch(req).then((networkRes) => {
                    if (networkRes && networkRes.status === 200) {
                        const copy = networkRes.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
                    }
                    return networkRes;
                });
            })
        );
        return;
    }

    // 6. Cualquier otra petición estática menor: Cache-first con fallback a red
    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
    );
});
