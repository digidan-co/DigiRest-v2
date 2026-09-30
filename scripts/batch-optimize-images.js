/**
 * Batch Image Optimizer
 *
 * Optimizes all existing product images stored on disk using sharp.
 * Run this once after deployment to retroactively compress images
 * that were uploaded before server-side optimization was implemented.
 *
 * Usage:
 *   node scripts/batch-optimize-images.js
 *
 * This script:
 * 1. Reads all products from the SQLite database
 * 2. For each product with a non-default image URL:
 *    - Reads the image file from disk
 *    - Resizes to max 250px with sharp (WebP, quality 50)
 *    - Saves the optimized version (overwrites or creates _opt.webp)
 *    - Updates the database if the filename changed
 * 3. Reports total savings
 */

const sqlite3 = require('sqlite3').verbose();
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Paths — adjust these if your structure differs
const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'pos.sqlite');
const SERVER_UPLOADS_DIR = path.join(__dirname, '..', 'server', 'uploads');
const PROJECT_ROOT = path.join(__dirname, '..');

console.log('='.repeat(60));
console.log('  OPTIMIZADOR DE IMÁGENES — BATCH');
console.log('='.repeat(60));
console.log(`BD: ${DB_PATH}`);
console.log(`Uploads: ${SERVER_UPLOADS_DIR}`);
console.log('');

// Configuration for optimization
const OPTIONS = {
    maxWidth: 400,
    maxHeight: 400,
    quality: 70,
    format: 'webp'
};

// Stats
let stats = {
    processed: 0,
    skippedNoFile: 0,
    skippedDefault: 0,
    skippedError: 0,
    bytesBefore: 0,
    bytesAfter: 0
};

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Resolve a stored image URL to an absolute file path on disk.
 * Handles formats like:
 *   /server/uploads/uuid.webp    → server/uploads/uuid.webp
 *   /uploads/uuid.jpg            → server/uploads/uuid.jpg
 *   uploads/uuid.png             → server/uploads/uuid.png
 */
function resolveImagePath(imgUrl) {
    if (!imgUrl || imgUrl === '/img/noimage.png' || imgUrl.startsWith('data:')) {
        return null;
    }

    // Strip leading slash and normalize
    let relativePath = imgUrl.replace(/^\/+/, '');

    // If it starts with 'server/uploads/' or 'uploads/', resolve accordingly
    if (relativePath.startsWith('server/uploads/')) {
        return path.join(PROJECT_ROOT, relativePath);
    } else if (relativePath.startsWith('uploads/')) {
        return path.join(PROJECT_ROOT, 'server', relativePath);
    }

    // Fallback: assume it's directly in server/uploads/
    return path.join(SERVER_UPLOADS_DIR, path.basename(relativePath));
}

async function optimizeImage(filePath) {
    const ext = path.extname(filePath);
    // Output will always be .webp
    const outputPath = filePath.replace(ext, `_opt.webp`);

    const beforeSize = fs.statSync(filePath).size;

    await sharp(filePath)
        .resize(OPTIONS.maxWidth, OPTIONS.maxHeight, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .toFormat(OPTIONS.format, { quality: OPTIONS.quality })
        .toFile(outputPath);

    const afterSize = fs.statSync(outputPath).size;

    // Delete the original file
    fs.unlinkSync(filePath);

    return {
        outputPath,
        beforeSize,
        afterSize,
        // Return the URL-friendly path (for DB update)
        outputUrl: '/server/uploads/' + path.basename(outputPath)
    };
}

async function main() {
    // Check if DB exists
    if (!fs.existsSync(DB_PATH)) {
        console.error('ERROR: Base de datos no encontrada en:', DB_PATH);
        console.error('Asegúrate de ejecutar este script desde el directorio raíz del proyecto.');
        process.exit(1);
    }

    const db = new sqlite3.Database(DB_PATH);

    // Get all products with images
    const products = await new Promise((resolve, reject) => {
        db.all("SELECT id, name, img FROM products WHERE img IS NOT NULL AND img != ''", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`Productos encontrados con imagen: ${products.length}`);
    console.log('');

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const filePath = resolveImagePath(product.img);

        // Skip default/noimage
        if (!filePath) {
            if (product.img === '/img/noimage.png' || product.img.startsWith('data:')) {
                stats.skippedDefault++;
            } else {
                stats.skippedNoFile++;
                console.log(`  [${i + 1}/${products.length}] ⚠  ${product.name.padEnd(25)} Sin ruta válida: ${product.img}`);
            }
            continue;
        }

        // Skip if file doesn't exist on disk
        if (!fs.existsSync(filePath)) {
            stats.skippedNoFile++;
            console.log(`  [${i + 1}/${products.length}] ⚠  ${product.name.padEnd(25)} Archivo no encontrado: ${filePath}`);
            continue;
        }

        // Re-optimize all images to ensure best quality/size balance
        // This will re-process even already-optimized files with new settings

        try {
            const result = await optimizeImage(filePath);

            // Update the database with the new URL
            await new Promise((resolve, reject) => {
                db.run("UPDATE products SET img = ? WHERE id = ?", [result.outputUrl, product.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            stats.processed++;
            stats.bytesBefore += result.beforeSize;
            stats.bytesAfter += result.afterSize;

            const saved = result.beforeSize - result.afterSize;
            const pct = ((saved / result.beforeSize) * 100).toFixed(1);
            console.log(`  [${i + 1}/${products.length}] ✅  ${product.name.padEnd(25)} ${formatBytes(result.beforeSize)} → ${formatBytes(result.afterSize)} (${pct}% ahorro)`);

        } catch (err) {
            stats.skippedError++;
            console.log(`  [${i + 1}/${products.length}] ❌  ${product.name.padEnd(25)} Error: ${err.message}`);
        }
    }

    db.close();

    // Final report
    console.log('');
    console.log('='.repeat(60));
    console.log('  REPORTE FINAL');
    console.log('='.repeat(60));
    console.log(`  Procesadas:        ${stats.processed}`);
    console.log(`  Sin archivo:       ${stats.skippedNoFile}`);
    console.log(`  Default/Skip:      ${stats.skippedDefault}`);
    console.log(`  Errores:           ${stats.skippedError}`);
    console.log('');
    if (stats.bytesBefore > 0) {
        const totalSaved = stats.bytesBefore - stats.bytesAfter;
        const pct = ((totalSaved / stats.bytesBefore) * 100).toFixed(1);
        console.log(`  Tamaño antes:      ${formatBytes(stats.bytesBefore)}`);
        console.log(`  Tamaño después:    ${formatBytes(stats.bytesAfter)}`);
        console.log(`  Ahorro total:      ${formatBytes(totalSaved)} (${pct}%)`);
    }
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
