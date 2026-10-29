const net = require('net');
const rateLimit = require('express-rate-limit');

function normalizeClientIp(raw) {
    let ip = String(raw || '127.0.0.1').trim();
    if (ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }
    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7);
    }
    const zoneIdx = ip.indexOf('%');
    if (zoneIdx !== -1) {
        ip = ip.slice(0, zoneIdx);
    }
    if (typeof rateLimit.ipKeyGenerator === 'function') {
        return rateLimit.ipKeyGenerator(ip || '127.0.0.1');
    }
    if (net.isIP(ip) === 6) {
        // Normalizar IPv6 por prefijo /64 cuando express-rate-limit < v8 no incluye ipKeyGenerator
        const parts = ip.toLowerCase().split('::');
        const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
        const right = parts.length > 1 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
        const missing = Math.max(0, 8 - (left.length + right.length));
        const full = [...left, ...Array(missing).fill('0'), ...right].map(h => h.padStart(4, '0'));
        return `${full.slice(0, 4).join(':')}::/64`;
    }
    return ip || '127.0.0.1';
}

const safeKeyGenerator = (req) => normalizeClientIp(req.ip || req.socket?.remoteAddress || '127.0.0.1');

// Rate limiter for login endpoint (strict)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 failed attempts per 15 min per IP
    keyGenerator: safeKeyGenerator,
    message: {
        error: 'Usuario bloqueado por multiples intentos fallidos, por favor inténtalo más tarde'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skipFailedRequests: false
});

// Rate limiter for admin PIN verification modal (prevents 4-digit PIN brute-forcing)
const verifyAdminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 failed PIN attempts per 15 min per IP
    keyGenerator: safeKeyGenerator,
    message: {
        valid: false,
        error: 'Demasiados intentos de autorización fallidos. Espera 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skipFailedRequests: false
});

// ── In-memory tracker for failed login attempts per user ──
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_MS = 15 * 60 * 1000;

const failedAttemptsStore = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of failedAttemptsStore) {
        if (!entry.blockedUntil && entry.attempts.length === 0) {
            failedAttemptsStore.delete(key);
            continue;
        }
        entry.attempts = entry.attempts.filter(t => now - t < WINDOW_MS);
        if (entry.blockedUntil && now > entry.blockedUntil) {
            entry.blockedUntil = null;
        }
        if (!entry.blockedUntil && entry.attempts.length === 0) {
            failedAttemptsStore.delete(key);
        }
    }
}, 5 * 60 * 1000).unref();

function recordFailedAttempt(credential) {
    if (!credential || typeof credential !== 'string') return;
    const key = credential.toLowerCase().trim();
    const now = Date.now();
    let entry = failedAttemptsStore.get(key);
    if (!entry) {
        entry = { attempts: [], blockedUntil: null };
        failedAttemptsStore.set(key, entry);
    }
    entry.attempts = entry.attempts.filter(t => now - t < WINDOW_MS);
    entry.attempts.push(now);
    if (entry.attempts.length >= MAX_FAILED_ATTEMPTS) {
        entry.blockedUntil = now + BLOCK_MS;
    }
}

function resetAttempts(credential) {
    if (!credential || typeof credential !== 'string') return;
    failedAttemptsStore.delete(credential.toLowerCase().trim());
}

function checkBlocked(credential) {
    if (!credential || typeof credential !== 'string') return { blocked: false };
    const key = credential.toLowerCase().trim();
    const entry = failedAttemptsStore.get(key);
    if (!entry || !entry.blockedUntil) return { blocked: false };
    const now = Date.now();
    if (now < entry.blockedUntil) {
        return { blocked: true, remainingMs: entry.blockedUntil - now };
    }
    entry.blockedUntil = null;
    entry.attempts = [];
    return { blocked: false };
}

// Rate limiter for API endpoints (enforced on all requests except health/webhook)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 600, // 600 requests per minute per IP
    keyGenerator: safeKeyGenerator,
    skip: (req) => req.path === '/health' || req.path === '/saas/webhook',
    message: {
        error: 'Demasiadas solicitudes. Por favor, espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Rate limiter for file uploads (strict)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 uploads per hour
    keyGenerator: safeKeyGenerator,
    message: {
        error: 'Demasiadas subidas de archivos. Por favor, intenta más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    loginLimiter,
    verifyAdminLimiter,
    recordFailedAttempt,
    resetAttempts,
    checkBlocked,
    apiLimiter,
    uploadLimiter,
    safeKeyGenerator
};
