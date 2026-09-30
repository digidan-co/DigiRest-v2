// SERVICE WORKER DE SEGURIDAD (BYPASS MODE)
// Esta versión limpia cualquier rastro de cachés antiguas o defectuosas 
// y devuelve el control total de la red al navegador de forma nativa.
const CACHE_NAME = 'pos-restaurante-v10-bypass';

self.addEventListener('install', (event) => {
    // Instalación inmediata
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Destruimos todas las cachés anteriores para asegurar que nada roto sobreviva
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    return caches.delete(cacheName);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Al NO invocar event.respondWith(), el navegador procesará la petición
    // a la red exactamente igual a como si no existiera un Service Worker.
    // Esto resuelve de raíz todos los problemas del Error 504, 304 Not Modified,
    // y los fallos de fetch en recargas de Firefox.
    return;
});
