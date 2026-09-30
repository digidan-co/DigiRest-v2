const rateLimit = require('express-rate-limit');

// Rate limiter for login endpoint (strict)
// Allows 20 attempts per IP per 15 minutes — sufficient for multiple staff
// while preventing brute-force attacks. Uses skipSuccessfulRequests=true
// so successful logins don't count against the limit.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per 15 min per IP — enough for multiple staff on same network
    message: {
        error: 'Demasiados intentos de login. Por favor, intenta nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Don't count successful logins against the limit
    skipSuccessfulRequests: true,
    skipFailedRequests: false
});

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
    apiLimiter,
    uploadLimiter
};
