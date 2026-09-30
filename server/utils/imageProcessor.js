const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

/**
 * Optimize and resize uploaded images
 * @param {string} inputPath - Path to original image
 * @param {Object} options - Processing options
 * @returns {Promise<string>} - Path to optimized image
 */
async function processImage(inputPath, options = {}) {
    const {
        maxWidth = 400,
        maxHeight = 400,
        quality = 70,
        format = 'webp'
    } = options;

    try {
        // Generate output path
        const ext = path.extname(inputPath);
        const outputPath = inputPath.replace(ext, `_opt.${format}`);

        // Process image
        await sharp(inputPath)
            .resize(maxWidth, maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .toFormat(format, { quality })
            .toFile(outputPath);

        // Delete original file
        await fs.unlink(inputPath);

        return outputPath;
    } catch (error) {
        console.error('Error processing image:', error);
        // If processing fails, return original path
        return inputPath;
    }
}

/**
 * Validate image file
 * @param {Object} file - Multer file object
 * @returns {boolean}
 */
function isValidImage(file) {
    const allowedMimeTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp'
    ];

    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();

    return allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext);
}

/**
 * Compress a payment proof image (receipt/screenshot) server-side.
 * Matches the browser-side `compressProof` (image-utils.js): width 500, quality 0.4.
 * Acts as a safety net when the client fails to compress before uploading.
 */
async function processProof(inputPath) {
    const ext = path.extname(inputPath);
    const outputPath = inputPath.replace(ext, '_opt.webp');

    try {
        await sharp(inputPath)
            .resize(500, null, { fit: 'inside', withoutEnlargement: true })
            .toFormat('webp', { quality: 40 })
            .toFile(outputPath);

        await fs.unlink(inputPath);
        return outputPath;
    } catch (error) {
        console.error('Error compressing proof, keeping original:', error.message);
        return inputPath;
    }
}

module.exports = {
    processImage,
    processProof,
    isValidImage
};
