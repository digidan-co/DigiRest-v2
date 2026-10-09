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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Sanitize filename - remove special characters (allow only safe chars)
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const uniqueSuffix = uuidv4();
        const ext = path.extname(sanitized);
        cb(null, uniqueSuffix + ext);
    }
});

// File filter for security
const fileFilter = (req, file, cb) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.csv'];

    const ext = path.extname(file.originalname).toLowerCase();

    // Extension check first
    if (!allowedExtensions.includes(ext)) {
        return cb(new Error('Solo se permiten archivos de imagen (JPG, PNG, WEBP) o CSV'), false);
    }

    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1.5 * 1024 * 1024, // 1.5MB — el cliente ya comprime a WebP antes de subir
        files: 1 // Only 1 file per request
    },
    fileFilter: fileFilter
});

/**
 * Middleware to validate actual file content after multer writes the file.
 * Must be used AFTER upload.single('file') or upload.array() middleware.
 * Reads the saved file and checks magic bytes to confirm real content type.
 */
function validateUploadedFile(req, res, next) {
    if (!req.file) {
        return next(); // No file uploaded — skip validation
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    // Only validate image types (CSV has no reliable magic bytes)
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        return next();
    }

    // Read first 64 bytes of the saved file to check magic bytes
    const filePath = req.file.path;
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(64);
    const bytesRead = fs.readSync(fd, buffer, 0, 64, 0);
    fs.closeSync(fd);

    const isValid = validateFileContent(buffer.slice(0, bytesRead), ext);

    if (!isValid) {
        // Delete the fake file immediately
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return res.status(400).json({
            error: 'El archivo subido no coincide con el tipo de archivo esperado. Por favor, sube una imagen válida.'
        });
    }

    // Check overall storage limit (configurable via Dokploy)
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
    const uploadDir = path.join(__dirname, '../uploads/');
    let totalStorageBytes = 0;
    if (fs.existsSync(uploadDir)) {
        try {
            const files = fs.readdirSync(uploadDir);
            for (const f of files) {
                if (f.startsWith('.')) continue;
                const fp = path.join(uploadDir, f);
                const stat = fs.statSync(fp);
                if (stat.isFile()) totalStorageBytes += stat.size;
            }
        } catch (_) {}
    }

    if (totalStorageBytes > maxBytes) {
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return res.status(400).json({
            error: `Límite de almacenamiento de imágenes alcanzado (${maxMb}MB). Por favor elimina imágenes antiguas antes de subir nuevas.`
        });
    }

    next();
}

module.exports = { upload, validateUploadedFile };
