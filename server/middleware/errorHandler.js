// Centralized error handling middleware
const errorHandler = (err, req, res, next) => {
    // Log error details
    console.error('Error:', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
    });

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Don't expose internal errors in production
    const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Error interno del servidor'
        : err.message;

    // Send consistent error response
    res.status(statusCode).json({
        success: false,
        error: {
            message,
            code: err.code || 'INTERNAL_ERROR',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        }
    });
};

// 404 handler
const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: {
            message: 'Endpoint no encontrado',
            code: 'NOT_FOUND',
            path: req.path
        }
    });
};

module.exports = {
    errorHandler,
    notFoundHandler
};
