const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

/**
 * Real content validation via magic bytes (file signatures).
 * Browser-supplied MIME types are easily spoofed; this checks the actual bytes.
 * @param {Buffer} buffer - File buffer to inspect
 * @param {string} extension - File extension (e.g., '.jpg')
 * @returns {boolean} - Whether the buffer matches the expected type
 */
function validateFileContent(buffer, extension) {
    if (!buffer || buffer.length < 12) return false;

    const header = buffer.toString('hex', 0, 12).toUpperCase();

    switch (extension) {
        case '.jpg':
        case '.jpeg':
            // JPEG starts with FF D8 FF
            return header.startsWith('FFD8FF');
        case '.png':
            // PNG starts with 89 50 4E 47 0D 0A 1A 0A
            return header.startsWith('89504E470D0A1A0A');
        case '.webp':
            // WebP starts with RIFF .... WEBP
            return header.startsWith('52494646') && header.substring(8, 16) === '57454250';
        case '.gif':
            // GIF starts with 47 49 46 38
            return header.startsWith('47494638');
        default:
            // For CSV and other non-magic-byte types, skip content check
            return true;
    }
}

const UPLOAD_DIR = path.join(__dirname, '../uploads/');

// Cache total upload directory size in memory for 60s to avoid blocking fs.readdirSync + statSync on every upload
let _cachedStorageBytes = null;
let _cachedStorageAt = 0;

function getUploadsStorageBytes() {
    const now = Date.now();
    if (_cachedStorageBytes !== null && (now - _cachedStorageAt) < 60000) {
        return _cachedStorageBytes;
    }
    let total = 0;
    if (fs.existsSync(UPLOAD_DIR)) {
        try {
            const files = fs.readdirSync(UPLOAD_DIR);
            for (const f of files) {
                if (f.startsWith('.')) continue;
                const fp = path.join(UPLOAD_DIR, f);
                const stat = fs.statSync(fp);
                if (stat.isFile()) total += stat.size;
            }
        } catch (_) {}
    }
    _cachedStorageBytes = total;
    _cachedStorageAt = now;
    return total;
}

function invalidateUploadsStorageCache() {
    _cachedStorageBytes = null;
    _cachedStorageAt = 0;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueSuffix = uuidv4();
        const ext = path.extname(sanitized).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

// Strict filter for image uploads ONLY (products & payment proofs)
const imageFileFilter = (req, file, cb) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        return cb(new Error('Solo se permiten imágenes válidas (JPG, PNG o WEBP)'), false);
    }
    cb(null, true);
};

// Filter for admin CSV imports ONLY
const csvFileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv') {
        return cb(new Error('Solo se permiten archivos CSV (.csv)'), false);
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1.5 * 1024 * 1024, // 1.5MB — el cliente ya comprime a WebP antes de subir
        files: 1
    },
    fileFilter: imageFileFilter
});

const csvUpload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024, // 2MB max CSV
        files: 1
    },
    fileFilter: csvFileFilter
});

/**
 * Middleware to validate actual file content after multer writes the file.
 * Must be used AFTER upload.single('...') middleware.
 * Reads the saved file and checks magic bytes to confirm real content type.
 */
function validateUploadedFile(req, res, next) {
    if (!req.file) {
        return next();
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filePath = req.file.path;

    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return res.status(400).json({ error: 'Formato de imagen no permitido.' });
    }

    let isValid = false;
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(64);
        const bytesRead = fs.readSync(fd, buffer, 0, 64, 0);
        fs.closeSync(fd);
        isValid = validateFileContent(buffer.slice(0, bytesRead), ext);
    } catch (_) {
        isValid = false;
    }

    if (!isValid) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return res.status(400).json({
            error: 'El archivo subido no coincide con una imagen real válida.'
        });
    }

    const rawStorageMb = process.env.MAX_IMAGE_STORAGE_MB
        || process.env.MAX_STORAGE_MB
        || process.env.STORAGE_LIMIT_MB
        || process.env.MAX_IMAGE_MB
        || process.env.MAX_IMAGES_MB
        || process.env.MAX_STORAGE
        || process.env.STORAGE_LIMIT
        || process.env.STORAGE_MB;
    const maxMb = rawStorageMb ? (parseInt(String(rawStorageMb).replace(/[^0-9]/g, ''), 10) || 50) : 50;
    const maxBytes = maxMb * 1024 * 1024;
    const totalStorageBytes = getUploadsStorageBytes();

    if (totalStorageBytes > maxBytes) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return res.status(400).json({
            error: `Límite de almacenamiento de imágenes alcanzado (${maxMb}MB). Por favor elimina imágenes antiguas antes de subir nuevas.`
        });
    }

    // Account for newly added file in cached counter
    if (_cachedStorageBytes !== null && req.file.size) {
        _cachedStorageBytes += req.file.size;
    }

    next();
}

module.exports = { upload, csvUpload, validateUploadedFile, invalidateUploadsStorageCache };
