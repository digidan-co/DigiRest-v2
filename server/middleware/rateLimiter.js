const rateLimit = require('express-rate-limit');

// Rate limiter for login endpoint (strict)
// Allows 20 attempts per IP per 15 minutes — sufficient for multiple staff
// while preventing brute-force attacks. Uses skipSuccessfulRequests=true
// so successful logins don't count against the limit.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per 15 min per IP
    message: {
        error: 'Usuario bloqueado por multiples intentos fallidos, por favor inténtalo más tarde'
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

// Rate limiter for API endpoints (moderate)
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500, // 500 requests per minute (increased for busy operations)
    message: {
        error: 'Demasiadas solicitudes. Por favor, espera un momento.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for successful requests to avoid blocking legitimate users
    skipSuccessfulRequests: true
});

// Rate limiter for file uploads (strict)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 uploads per hour
    message: {
        error: 'Demasiadas subidas de archivos. Por favor, intenta más tarde.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = {
    loginLimiter,
    recordFailedAttempt,
    resetAttempts,
    checkBlocked,
    apiLimiter,
    uploadLimiter
};
