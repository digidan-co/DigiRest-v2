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
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000'];

const io = new Server(server, {
    // Connection options
    pingTimeout: 60000,
    pingInterval: 25000,
    allowUpgrades: true,
    transports: ['polling', 'websocket'],
    // Cookie settings for session persistence (Traefik sticky sessions)
    cookie: {
        name: 'io',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/'
    },
    // CORS configuration
    cors: {
        origin: true,
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"]
    }
});

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for dev, enable in production with proper config
    crossOriginEmbedderPolicy: false
}));

// CSP enforcement
app.use((req, res, next) => {
    // Policy tailored to local-first offline-ready resources while allowing Google Fonts and secure assets
    const cspPolicy = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' https://cdn-icons-mp4.flaticon.com",
        "connect-src 'self' ws: wss: ws://* wss://*",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "report-uri /api/csp-report",
    ].join('; ');

    res.setHeader('Content-Security-Policy', cspPolicy);
    next();
});

// Compress responses — skip images/binary (they're already compressed)
app.use(compression({
    filter: (req, res) => {
        const contentType = res.getHeader('Content-Type') || '';
        // Don't compress already-compressed or binary responses
        if (/image|video|audio|font|zip|gz|br/.test(contentType)) return false;
        return compression.filter(req, res);
    },
    level: 6, // Balanced: good compression without max CPU
    threshold: 1024 // Only compress responses > 1KB
}));
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing — 2MB max (images should come as multipart/form-data via multer, not JSON)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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

// Static files for uploads (proof images and products)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/server/uploads', express.static(path.join(__dirname, 'uploads')));

// Shared cache strategy for static assets
function staticCacheHeaders(res, filePath) {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
        // HTML and service worker: never cache (always fresh)
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    } else if (/\.(webp|png|jpg|jpeg|gif|ico|svg|mp3|mp4|woff2?|ttf|eot)$/.test(filePath)) {
        // Images, media and fonts: cache for 7 days (immutable)
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (/\.(js|css)$/.test(filePath)) {
        // JS/CSS: cache with ETag revalidation and stale-while-revalidate for fast loads
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    }
}

// Built Vue frontend (Vite output) — the only frontend served.
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist, {
        maxAge: '1h',
        etag: true,
        setHeaders: staticCacheHeaders
    }));
    console.log('🌐 Sirviendo frontend Vue compilado desde frontend/dist');
} else {
    console.warn('⚠️ frontend/dist no encontrado. Ejecuta `npm run build` en frontend/ antes de desplegar.');
}

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// CSP violation reporting endpoint
app.post('/api/csp-report', (req, res) => {
    const report = req.body;
    console.warn('CSP Violation:', {
        documentUri: report['document-uri'],
        violatedDirective: report['violated-directive'],
        blockedUri: report['blocked-uri'],
        originalPolicy: report['original-policy'],
        timestamp: new Date().toISOString()
    });
    res.status(204).end();
});

const { router: authRouter, setIo } = require('./routes/auth');
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

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api', productsRouter);
app.use('/api', toppingsRouter);
app.use('/api', deliveryZonesRouter);
app.use('/api', customersRouter);
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

// SaaS Manager — estado de suscripción y anuncios desde panel.digidan.co
const saasService = require('./saasService');
app.get('/api/saas/status', async (req, res) => {
    try {
        const status = await saasService.getSaaSStatus();
        res.json(status);
    } catch (e) {
        // Si el panel no responde, retornamos un estado permisivo para no bloquear el sistema
        res.json({ estado: 'Activa', saldo_documentos: 0, vencimiento: null });
    }
});
app.get('/api/saas/anuncios', async (req, res) => {
    const anuncios = await saasService.getAnunciosActivos();
    res.json(anuncios);
});

// Health check endpoint (no rate limiting)
app.get('/api/health', (req, res) => {
    const health = {
        status: 'ok',
        server: 'pos-backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    };

    // Test database connection
    db.get('SELECT 1', [], (err) => {
        if (err) {
            health.status = 'degraded';
            health.database = 'error';
        } else {
            health.database = 'connected';
        }
        res.json(health);
    });
});

const jwt = require('jsonwebtoken');

// Socket.io Logic with Secure Room Authorization
const PUBLIC_ROOMS = new Set(['tracker', 'public', 'client']);

io.on('connection', (socket) => {

    // Allow joining public rooms (for order status tracking) or specific order channels
    socket.on('join_room', (room) => {
        if (!room) return;
        const isPublicRoom = PUBLIC_ROOMS.has(room) || room.startsWith('order_');
        // If it's a privileged role room, verify authentication
        if (!isPublicRoom) {
            const userRole = socket.user?.role;
            const isAllowed = userRole === 'admin' || userRole === room ||
                (userRole === 'chef' && room === 'cocinero') ||
                (userRole === 'mesero' && room === 'waiter') ||
                (userRole === 'delivery' && room === 'repartidor');

            if (!isAllowed) {
                return; // Deny unauthorized room join
            }
        }
        socket.join(room);
    });

    // Authenticate socket using JWT token
    socket.on('authenticate', (data = {}) => {
        const token = data.token || socket.handshake.auth?.token;
        const SECRET = process.env.JWT_SECRET;

        const joinRoleRooms = (role, userId) => {
            if (!role) return;
            socket.join(role);
            // Join localized aliases to guarantee real-time updates reach all client views
            if (role === 'chef') socket.join('cocinero');
            if (role === 'cocinero') socket.join('chef');
            if (role === 'mesero') socket.join('waiter');
            if (role === 'waiter') socket.join('mesero');
            if (role === 'delivery') socket.join('repartidor');
            if (role === 'repartidor') socket.join('delivery');

            if (userId) {
                socket.join(`user_${userId}`);
            }
            socket.emit('authenticated');
        };

        if (token && SECRET) {
            jwt.verify(token, SECRET, (err, decoded) => {
                if (!err && decoded) {
                    // Validate if token is blacklisted
                    db.get("SELECT token FROM token_blacklist WHERE token = ?", [token], (blErr, blacklisted) => {
                        if (blacklisted) {
                            socket.emit('session_replaced', {
                                message: 'Has iniciado sesión en otro dispositivo, serás redirigido al inicio'
                            });
                            return;
                        }

                        // Validate against active_sessions (Single Session Enforcement)
                        db.get("SELECT token FROM active_sessions WHERE user_id = ?", [decoded.id], (sessErr, active) => {
                            if (active && active.token !== token) {
                                socket.emit('session_replaced', {
                                    message: 'Has iniciado sesión en otro dispositivo, serás redirigido al inicio'
                                });
                                return;
                            }

                            socket.user = decoded;
                            joinRoleRooms(decoded.role, decoded.id);
                        });
                    });
                } else if (data.role && data.userId) {
                    joinRoleRooms(data.role, data.userId);
                }
            });
        } else if (data.role && data.userId) {
            joinRoleRooms(data.role, data.userId);
        }
    });

    socket.on('disconnect', () => {

    });
});

// ====================================================================
// NIGHTLY NOTES ARCHIVER — runs at midnight Bogotá time (00:00 COT = 05:00 UTC)
// Purges previous-day order_notes from the active table, keeping notes_log as archive
// ====================================================================
function scheduleNightlyNotesArchive() {
    const now = new Date();
    // Next midnight in Colombia = next 05:00 UTC
    const nextMidnightUTC = new Date();
    nextMidnightUTC.setUTCHours(5, 0, 0, 0);
    if (nextMidnightUTC <= now) {
        nextMidnightUTC.setUTCDate(nextMidnightUTC.getUTCDate() + 1);
    }

    const msUntilMidnight = nextMidnightUTC - now;

    setTimeout(() => {
        archivePreviousDayNotes();
        // Reschedule for next night
        setInterval(archivePreviousDayNotes, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
}

function archivePreviousDayNotes() {

    // Find order_notes from previous days (using Colombia UTC-5 offset)
    db.all(
        "SELECT * FROM order_notes WHERE date(created_at, '-5 hours') < date('now', '-5 hours')",
        [],
        (err, rows) => {
            if (err) {
                console.error('Error fetching old notes for archive:', err);
                return;
            }

            if (rows.length === 0) return;

            // Archive each note to notes_log if not already there (avoid duplicates)
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

            // Now delete all previous-day notes from the active table
            db.run(
                "DELETE FROM order_notes WHERE date(created_at, '-5 hours') < date('now', '-5 hours')",
                [],
                function (err) {
                    if (err) console.error('Error deleting old active notes:', err);

                    // Maintain WAL file size on VPS disk without blocking active connections
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

// --- DEBUG PERSISTENCE CHECK ---


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
