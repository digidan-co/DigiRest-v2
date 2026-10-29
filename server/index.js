const path = require('path');
const fs = require('fs');

// Cargar variables de entorno: busca en server/.env o en la raíz .env según el contexto de ejecución
const serverEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(serverEnvPath)) {
    require('dotenv').config({ path: serverEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
} else {
    require('dotenv').config();
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const db = require('./db');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Catch any unhandled errors gracefully so logs show exact details
process.on('uncaughtException', (err) => {
    console.error('💥 [CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- OPTIMIZACIÓN DE MEMORIA: deshabilitar caché interna de sharp/libvips ---
// Por defecto sharp guarda imágenes procesadas en memoria C++ (fuera del heap JS).
// En un servidor multitenancy con imágenes únicas esto crece sin control.
// Deshabilitarlo reduce drásticamente el uso de RAM nativa.
try {
    const sharp = require('sharp');
    sharp.cache(false);        // sin caché de tiles/imágenes
    sharp.concurrency(1);     // máx 1 hilo de libvips (evita picos de CPU)
} catch (e) { /* sharp no instalado todavía, se ignora */ }

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Parse ALLOWED_ORIGINS from environment (comma-separated)
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
    : [];

function isAllowedOrigin(origin, hostHeader = '') {
    if (!origin) return true; // Peticiones same-origin directas / server-to-server
    if (rawAllowedOrigins.includes(origin)) return true;
    try {
        const parsed = new URL(origin);
        const cleanHost = String(hostHeader).split(',')[0].trim().toLowerCase();
        // Permitir siempre same-origin (cuando Origin coincide con el Host del propio contenedor)
        if (cleanHost && parsed.host.toLowerCase() === cleanHost) return true;
        // En desarrollo local o subdominios oficiales *.digidan.co si ALLOWED_ORIGINS='*' o vacío
        if (rawAllowedOrigins.length === 0 || rawAllowedOrigins.includes('*')) {
            if (
                parsed.hostname === 'localhost' ||
                parsed.hostname === '127.0.0.1' ||
                parsed.hostname === 'digidan.co' ||
                parsed.hostname.endsWith('.digidan.co')
            ) {
                return true;
            }
        }
    } catch (_) {
        return false;
    }
    return false;
}

const io = new Server(server, {
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 100 * 1024, // 100KB max payload por mensaje WebSocket
    allowUpgrades: true,
    transports: ['polling', 'websocket'],
    cookie: {
        name: 'io',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    },
    allowRequest: (req, callback) => {
        const ok = isAllowedOrigin(req.headers.origin, req.headers.host);
        callback(null, ok);
    },
    cors: {
        origin: (origin, cb) => cb(null, !origin || rawAllowedOrigins.includes(origin) || rawAllowedOrigins.includes('*') || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|https:\/\/([a-z0-9-]+\.)?digidan\.co$/i.test(origin)),
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"]
    }
});

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CSP enforcement (sin 'unsafe-eval')
app.use((req, res, next) => {
    const cspPolicy = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' https://cdn-icons-mp4.flaticon.com",
        "connect-src 'self' ws: wss:",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "report-uri /api/csp-report",
    ].join('; ');

    res.setHeader('Content-Security-Policy', cspPolicy);
    next();
});

// Compress dynamic responses — skip images/binary and already precompressed assets
app.use(compression({
    filter: (req, res) => {
        if (res.getHeader('Content-Encoding')) return false;
        const contentType = res.getHeader('Content-Type') || '';
        if (/image|video|audio|font|zip|gz|br/.test(contentType)) return false;
        return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024
}));

app.use((req, res, next) => {
    cors({
        origin: (origin, cb) => {
            if (isAllowedOrigin(origin, req.headers.host)) return cb(null, true);
            return cb(new Error('Origen CORS no autorizado'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Code']
    })(req, res, next);
});

// Body parsing — 512KB max (imágenes se suben por multipart/form-data vía multer)
app.use(express.json({ limit: '512kb', type: ['application/json', 'application/csp-report'] }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// Dynamic PWA Manifest
app.get('/manifest.json', (req, res) => {
    db.all("SELECT key, value FROM config WHERE key IN ('dataRestaurant', 'imgRestaurantDefault')", [], (err, rows) => {
        let name = "Restaurante App";
        let logo = "img/icon.png";

        if (rows) {
            rows.forEach(row => {
                if (row.key === 'dataRestaurant') {
                    try {
                        const data = JSON.parse(row.value);
                        if (data.name) name = data.name;
                    } catch (e) { }
                }
                if (row.key === 'imgRestaurantDefault') {
                    try {
                        const imgData = JSON.parse(row.value);
                        if (imgData.url) logo = imgData.url;
                        else if (imgData.Base64) logo = imgData.Base64;
                    } catch (e) { }
                }
            });
        }

        const manifest = {
            "name": name,
            "short_name": name.substring(0, 12),
            "description": "Sistema de Punto de Venta POS",
            "start_url": "/",
            "display": "standalone",
            "background_color": "#ffffff",
            "theme_color": "#f97316",
            "orientation": "portrait",
            "icons": [
                {
                    "src": logo,
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "any maskable"
                },
                {
                    "src": logo,
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "any maskable"
                }
            ]
        };
        res.json(manifest);
    });
});

// Static files for uploads (proof images and products) with security headers
const uploadsStaticOptions = {
    setHeaders: (res, filePath) => {
        // Prevent search engines and crawlers from indexing receipts/proofs or uploaded files
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        if (/\.(webp|png|jpg|jpeg|gif)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
};
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), uploadsStaticOptions));
app.use('/server/uploads', express.static(path.join(__dirname, 'uploads'), uploadsStaticOptions));

// Shared cache strategy for static assets
function staticCacheHeaders(res, filePath) {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    } else if (
        filePath.includes(`${path.sep}assets${path.sep}`) &&
        /\.(js|css|woff2?|ttf|eot|webp|png|jpg|jpeg|svg)$/.test(filePath)
    ) {
        // Hashed Vite assets: cache for 1 year (immutable)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(webp|png|jpg|jpeg|gif|ico|svg|mp3|mp4|woff2?|ttf|eot)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (/\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    }
}

// Built Vue frontend (Vite output) — serve precompressed .br / .gz assets with zero CPU overhead
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    const PRECOMPRESSED_MIMES = {
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json; charset=utf-8'
    };

    app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const ext = path.extname(req.path).toLowerCase();
        const mimeType = PRECOMPRESSED_MIMES[ext];
        if (!mimeType) return next();

        const safeRel = path.normalize(req.path).replace(/^(\.\.(\/|\\|$))+/, '');
        const origFile = path.join(frontendDist, safeRel);
        if (!origFile.startsWith(frontendDist)) return next();

        const acceptEnc = req.headers['accept-encoding'] || '';
        let chosenExt = null;
        let chosenEncoding = null;

        if (acceptEnc.includes('br') && fs.existsSync(`${origFile}.br`)) {
            chosenExt = '.br';
            chosenEncoding = 'br';
        } else if (acceptEnc.includes('gzip') && fs.existsSync(`${origFile}.gz`)) {
            chosenExt = '.gz';
            chosenEncoding = 'gzip';
        }

        if (!chosenExt) return next();

        req.url = `${req.path}${chosenExt}`;
        res.setHeader('Content-Encoding', chosenEncoding);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Vary', 'Accept-Encoding');
        staticCacheHeaders(res, origFile);
        next();
    });

    app.use(express.static(frontendDist, {
        maxAge: '1h',
        etag: true,
        index: 'index.html',
        dotfiles: 'deny',
        setHeaders: staticCacheHeaders
    }));
    console.log('🌐 Sirviendo frontend Vue compilado desde frontend/dist');
} else {
    console.warn('⚠️ frontend/dist no encontrado. Ejecuta `npm run build` en frontend/ antes de desplegar.');
}

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// CSP violation reporting endpoint (sanitized & bounded)
app.post('/api/csp-report', (req, res) => {
    const raw = req.body && (req.body['csp-report'] || req.body);
    if (raw && typeof raw === 'object') {
        console.warn('CSP Violation:', {
            documentUri: String(raw['document-uri'] || '').slice(0, 200),
            violatedDirective: String(raw['violated-directive'] || '').slice(0, 100),
            blockedUri: String(raw['blocked-uri'] || '').slice(0, 200)
        });
    }
    res.status(204).end();
});

const { router: authRouter, verifyToken, verifyOptionalToken, requireRole, setIo } = require('./routes/auth');
setIo(io);
const usersRouter = require('./routes/users')(io);
const productsRouter = require('./routes/products')(io);
const ordersRouter = require('./routes/orders')(io);
const orderUpdateRouter = require('./routes/order-update')(io);
const orderDeleteRouter = require('./routes/order-delete')(io);
const configRouter = require('./routes/config')(io);
const notesRouter = require('./routes/notes')(io);
const reportsRouter = require('./routes/reports')(io);
const adminFeaturesRouter = require('./routes/admin-features')(io);
const orderAddItemRouter = require('./routes/order-add-item')(io);
const cierreCajaRouter = require('./routes/cierre-caja')(io);
const gastosDiaRouter = require('./routes/gastos-dia')(io);
const inventoryRouter = require('./routes/inventory')(io);
const cashflowRouter = require('./routes/cashflow')(io);
const toppingsRouter = require('./routes/toppings')(io);
const deliveryZonesRouter = require('./routes/delivery-zones')(io);
const customersRouter = require('./routes/customers')(io);
const authorizationsRouter = require('./routes/authorizations')(io);
const promotionsCombosRouter = require('./routes/promotions-combos')(io);

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', productsRouter);
app.use('/api', toppingsRouter);
app.use('/api', deliveryZonesRouter);
app.use('/api', customersRouter);
app.use('/api', promotionsCombosRouter);
app.use('/api', ordersRouter);
app.use('/api', orderUpdateRouter);
app.use('/api', orderAddItemRouter);
app.use('/api', orderDeleteRouter);
app.use('/api', configRouter);
app.use('/api', notesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminFeaturesRouter);
app.use('/api', cierreCajaRouter);
app.use('/api', gastosDiaRouter);
app.use('/api', inventoryRouter);
app.use('/api', cashflowRouter);
app.use('/api', authorizationsRouter);

// SaaS Manager — estado de suscripción, webhook firmado y anuncios desde panel.digidan.co
const saasService = require('./saasService');
app.get('/api/saas/status', async (req, res) => {
    try {
        const staffUser = await verifyOptionalToken(req);
        const status = await saasService.getSaaSStatus();
        if (staffUser) {
            return res.json(status);
        }
        // Respuesta mínima sin exponer URLs internas ni subdominio a visitantes anónimos
        return res.json({
            configured: Boolean(status.configured),
            estado: status.estado || 'Activa'
        });
    } catch (e) {
        res.json({ configured: false, estado: 'Activa' });
    }
});

// Push Webhook firmado (HMAC-SHA256) desde panel.digidan.co para sincronización en tiempo real
app.post('/api/saas/webhook', (req, res) => {
    const rawTs = req.headers['x-digidan-timestamp'];
    const signature = req.headers['x-digidan-signature'];

    if (!saasService.verifySaaSWebhookSignature(rawTs, signature, req.body || {})) {
        return res.status(401).json({ error: 'Firma de webhook inválida o expirada' });
    }

    const payload = req.body || {};
    saasService.invalidateCache(payload.data || payload);

    if (io) {
        io.to('admin').emit('saas_status_updated', {
            event: payload.event || 'status_changed',
            timestamp: new Date().toISOString()
        });
    }

    return res.json({ ok: true });
});

app.get('/api/saas/anuncios', verifyToken, requireRole(['admin']), async (req, res) => {
    try {
        const anuncios = await saasService.getAnunciosActivos();
        res.json(anuncios);
    } catch (error) {
        console.error('[DigiRest SaaS] Error obteniendo anuncios:', error.message);
        res.json([]);
    }
});

// Endpoint de diagnóstico para verificar la conexión con panel / app.digidan.co
app.get('/api/saas/diagnostics', verifyToken, requireRole(['admin']), async (req, res) => {
    const { url, key } = saasService.getSaasConfig();
    let statusTest = null;
    let anunciosTest = null;

    try {
        statusTest = await saasService.getSaaSStatus(true);
    } catch (e) {
        statusTest = { error: e.message };
    }

    try {
        anunciosTest = await saasService.getAnunciosActivos(true);
    } catch (e) {
        anunciosTest = { error: e.message };
    }

    res.json({
        configured_url: url || '(no definida en Dokploy)',
        has_key: Boolean(key),
        key_preview: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : '(no definida en Dokploy)',
        status: statusTest,
        anuncios_count: Array.isArray(anunciosTest) ? anunciosTest.length : 0,
        anuncios: anunciosTest
    });
});

// Health check endpoint (exempt from apiLimiter)
app.get('/api/health', (req, res) => {
    const health = {
        status: 'ok',
        server: 'pos-backend',
        timestamp: new Date().toISOString()
    };

    db.get('SELECT 1', [], (err) => {
        if (err) {
            health.status = 'degraded';
            health.database = 'error';
            return res.status(503).json(health);
        }
        health.database = 'connected';
        res.json(health);
    });
});

const jwt = require('jsonwebtoken');

// Socket.io Logic with Strict JWT Room Authorization
const PUBLIC_ROOMS = new Set(['tracker', 'public', 'client']);

function getAllowedRoomsForUser(userObj) {
    const allowed = new Set(['tracker', 'public', 'client']);
    if (!userObj || !userObj.role) return allowed;
    const r = String(userObj.role).toLowerCase();
    allowed.add(r);
    if (r === 'chef' || r === 'cocinero') {
        allowed.add('chef');
        allowed.add('cocinero');
    }
    if (r === 'mesero' || r === 'waiter') {
        allowed.add('mesero');
        allowed.add('waiter');
    }
    if (r === 'delivery' || r === 'repartidor') {
        allowed.add('delivery');
        allowed.add('repartidor');
    }
    if (r === 'admin' || r === 'cajero' || r === 'supervisor') {
        allowed.add('admin');
        allowed.add('cajero');
        allowed.add('supervisor');
    }
    if (userObj.id) {
        allowed.add(`user_${userObj.id}`);
    }
    return allowed;
}

function verifySocketJwt(token, callback) {
    const SECRET = process.env.JWT_SECRET;
    if (!token || !SECRET) return callback(null);

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err || !decoded || !decoded.id) return callback(null);
        db.get("SELECT token FROM token_blacklist WHERE token = ?", [token], (blErr, blRow) => {
            if (blErr || blRow) return callback(null);
            db.get("SELECT token FROM active_sessions WHERE user_id = ?", [decoded.id], (sErr, sRow) => {
                if (sErr || !sRow || sRow.token !== token) return callback(null);
                callback(decoded);
            });
        });
    });
}

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    verifySocketJwt(token, (decoded) => {
        if (decoded) socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    // Join rooms with strict authorization check
    socket.on('join_room', (room) => {
        if (!room || typeof room !== 'string' || room.length > 64) return;
        if (PUBLIC_ROOMS.has(room)) {
            socket.join(room);
            return;
        }
        if (socket.user) {
            const allowed = getAllowedRoomsForUser(socket.user);
            if (allowed.has(room)) {
                socket.join(room);
            }
        }
    });

    // Authenticate socket strictly via valid JWT token + active session (never trust raw role payload)
    socket.on('authenticate', (data = {}) => {
        const token = (data && typeof data === 'object' ? data.token : null) || socket.handshake.auth?.token;
        if (!token) return;

        verifySocketJwt(token, (decoded) => {
            if (!decoded) return;
            socket.user = decoded;
            const allowedRooms = getAllowedRoomsForUser(decoded);
            for (const roomName of allowedRooms) {
                if (!PUBLIC_ROOMS.has(roomName)) {
                    socket.join(roomName);
                }
            }
            socket.emit('authenticated');
        });
    });

    socket.on('disconnect', () => {});
});

// ====================================================================
// NIGHTLY NOTES ARCHIVER — runs at midnight Bogotá time (00:00 COT = 05:00 UTC)
// ====================================================================
function scheduleNightlyNotesArchive() {
    const now = new Date();
    const nextMidnightUTC = new Date();
    nextMidnightUTC.setUTCHours(5, 0, 0, 0);
    if (nextMidnightUTC <= now) {
        nextMidnightUTC.setUTCDate(nextMidnightUTC.getUTCDate() + 1);
    }

    const msUntilMidnight = nextMidnightUTC - now;

    setTimeout(() => {
        archivePreviousDayNotes();
        setInterval(archivePreviousDayNotes, 24 * 60 * 60 * 1000).unref();
    }, msUntilMidnight).unref();
}

function archivePreviousDayNotes() {
    db.all(
        "SELECT * FROM order_notes WHERE date(created_at, '-5 hours') < date('now', '-5 hours')",
        [],
        (err, rows) => {
            if (err) {
                console.error('Error fetching old notes for archive:', err);
                return;
            }

            if (rows.length === 0) return;

            rows.forEach(note => {
                db.get(
                    "SELECT id FROM notes_log WHERE order_id = ? AND note = ? AND date(created_at, '-5 hours') = date(?, '-5 hours')",
                    [note.id_order, note.note, note.created_at],
                    (err, existing) => {
                        if (!existing && !err) {
                            db.run(
                                "INSERT INTO notes_log (order_id, note, created_by, created_at, resolved) VALUES (?, ?, ?, ?, ?)",
                                [note.id_order, note.note, 'Archivado', note.created_at, note.solved || 0],
                                (err) => { if (err) console.error('Error archiving note to log:', err); }
                            );
                        }
                    }
                );
            });

            db.run(
                "DELETE FROM order_notes WHERE date(created_at, '-5 hours') < date('now', '-5 hours')",
                [],
                function (err) {
                    if (err) console.error('Error deleting old active notes:', err);

                    db.run('PRAGMA wal_checkpoint(PASSIVE)', (cpErr) => {
                        if (cpErr) console.warn('Nightly WAL checkpoint notice:', cpErr.message);
                    });
                }
            );
        }
    );
}

// Start the nightly scheduler
scheduleNightlyNotesArchive();

// Start the daily database backup scheduler
const { scheduleDailyBackup } = require('./utils/backupService');
scheduleDailyBackup();

// 404 handler (must be after all routes)
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 3000;

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Error: El puerto ${PORT} ya está en uso por otro proceso.`);
        console.error(`💡 Solución: Puedes liberarlo ejecutando en la terminal: fuser -k ${PORT}/tcp\n`);
    } else {
        console.error(`❌ Error al iniciar el servidor:`, err.message);
    }
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor POS iniciado exitosamente`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📝 Base de datos: SQLite`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});

// Graceful shutdown to checkpoint WAL and close SQLite cleanly in Docker
let isShuttingDown = false;
function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 [${signal}] Cerrando servidor DigiRest de forma segura...`);
    server.close(() => {
        db.run('PRAGMA wal_checkpoint(TRUNCATE)', () => {
            db.close(() => {
                process.exit(0);
            });
        });
    });
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
