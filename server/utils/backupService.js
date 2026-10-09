const path = require('path');
const fs = require('fs');
const db = require('../db');

const dataDir = path.resolve(__dirname, '..', 'data');
const backupsDir = path.join(dataDir, 'backups');

// Asegurar que la carpeta de copias de seguridad exista
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

/**
 * Formatea bytes en formato legible (KB, MB).
 */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Obtiene la fecha y hora formateada en zona horaria Colombia (UTC-5).
 */
function getColombiaDateString() {
    const d = new Date();
    // UTC-5 offset
    const colombiaTime = new Date(d.getTime() - (5 * 60 * 60 * 1000));
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = colombiaTime.getUTCFullYear();
    const mm = pad(colombiaTime.getUTCMonth() + 1);
    const dd = pad(colombiaTime.getUTCDate());
    const hh = pad(colombiaTime.getUTCHours());
    const min = pad(colombiaTime.getUTCMinutes());
    const ss = pad(colombiaTime.getUTCSeconds());
    return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

/**
 * Realiza una copia de seguridad atómica no bloqueante usando SQLite VACUUM INTO.
 * @param {string} label - Etiqueta descriptiva (ej. 'auto', 'manual')
 * @returns {Promise<{ filename: string, path: string, size: string }>}
 */
async function createBackup(label = 'auto') {
    return new Promise((resolve, reject) => {
        const dateStr = getColombiaDateString();
        const filename = `pos_backup_${label}_${dateStr}.sqlite`;
        const backupPath = path.join(backupsDir, filename);

        // Si el archivo ya existiera por alguna razón, eliminarlo primero
        if (fs.existsSync(backupPath)) {
            try { fs.unlinkSync(backupPath); } catch (_) {}
        }

        const safePath = backupPath.replace(/'/g, "''");
        const sql = `VACUUM INTO '${safePath}'`;

        db.run(sql, (err) => {
            if (err) {
                console.error('❌ Error creando copia de seguridad SQLite:', err.message);
                return reject(err);
            }

            try {
                const stat = fs.statSync(backupPath);
                const size = formatBytes(stat.size);
                console.log(`💾 [BACKUP] Copia de seguridad creada con éxito: ${filename} (${size})`);

                // Limpiar respaldos antiguos para no llenar el disco
                pruneOldBackups();

                resolve({
                    filename,
                    path: backupPath,
                    size,
                    sizeBytes: stat.size,
                    createdAt: new Date().toISOString()
                });
            } catch (statErr) {
                resolve({
                    filename,
                    path: backupPath,
                    size: 'Desconocido',
                    createdAt: new Date().toISOString()
                });
            }
        });
    });
}

/**
 * Conserva únicamente las últimas N copias de seguridad y garantiza que el
 * tamaño total de la carpeta de respaldos nunca exceda la cuota límite en MB.
 */
function pruneOldBackups() {
    try {
        if (!fs.existsSync(backupsDir)) return;

        // Configurable desde Dokploy / .env (Por defecto: 7 días de retención y máx 50MB)
        const rawKeep = process.env.BACKUP_RETENTION_DAYS;
        const maxKeep = rawKeep ? (parseInt(String(rawKeep).replace(/[^0-9]/g, ''), 10) || 7) : 7;
        const rawStorageMb = process.env.MAX_BACKUP_STORAGE_MB || process.env.BACKUP_STORAGE_LIMIT_MB;
        const maxStorageMb = rawStorageMb ? (parseInt(String(rawStorageMb).replace(/[^0-9]/g, ''), 10) || 50) : 50;
        const maxStorageBytes = maxStorageMb * 1024 * 1024;

        let files = fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.sqlite'))
            .map(f => {
                const fullPath = path.join(backupsDir, f);
                const stat = fs.statSync(fullPath);
                return { name: f, path: fullPath, mtime: stat.mtimeMs, size: stat.size };
            })
            .sort((a, b) => b.mtime - a.mtime); // Más recientes primero

        // 1. Regla de cantidad máxima (Retención de últimos N días)
        if (files.length > maxKeep) {
            const toDelete = files.slice(maxKeep);
            for (const file of toDelete) {
                try {
                    fs.unlinkSync(file.path);
                    console.log(`🧹 [BACKUP] Eliminada copia antigua por rotación (${maxKeep} días): ${file.name}`);
                } catch (e) {
                    console.warn(`No se pudo eliminar backup antiguo ${file.name}:`, e.message);
                }
            }
            // Actualizar lista restante
            files = files.slice(0, maxKeep);
        }

        // 2. Regla de cuota estricta en MB (Evita saturar el disco del VPS)
        let totalBytes = files.reduce((acc, f) => acc + f.size, 0);
        while (totalBytes > maxStorageBytes && files.length > 1) {
            // Eliminar el archivo más antiguo de la lista
            const oldest = files.pop();
            try {
                fs.unlinkSync(oldest.path);
                totalBytes -= oldest.size;
                console.log(`🛡️ [BACKUP CUOTA] Eliminado ${oldest.name} para mantener almacenamiento bajo ${maxStorageMb}MB`);
            } catch (e) {
                console.warn(`Error al liberar cuota de backup:`, e.message);
                break;
            }
        }
    } catch (e) {
        console.error('Error rotando copias de seguridad:', e.message);
    }
}

/**
 * Obtiene la lista de copias de seguridad disponibles en disco.
 */
function getBackupList() {
    try {
        if (!fs.existsSync(backupsDir)) return [];
        return fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.sqlite'))
            .map(f => {
                const fullPath = path.join(backupsDir, f);
                const stat = fs.statSync(fullPath);
                return {
                    filename: f,
                    path: fullPath,
                    size: formatBytes(stat.size),
                    sizeBytes: stat.size,
                    createdAt: new Date(stat.mtimeMs).toISOString()
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
        console.error('Error listando copias de seguridad:', e);
        return [];
    }
}

/**
 * Programa la ejecución automática de copias de seguridad diarias a las 03:00 AM Colombia (08:00 UTC).
 */
function scheduleDailyBackup() {
    // Ejecutar un respaldo inicial 15 segundos después de iniciar el servidor si no hay ninguno creado hoy
    setTimeout(() => {
        const backups = getBackupList();
        const todayDate = new Date().toISOString().split('T')[0];
        const hasTodayBackup = backups.some(b => b.filename.includes(todayDate));
        if (!hasTodayBackup) {
            console.log('📦 Generando primera copia de seguridad del día...');
            createBackup('auto').catch(e => console.error('Fallo en backup inicial:', e.message));
        }
    }, 15000);

    const now = new Date();
    // Próxima 03:00 AM Colombia = 08:00 UTC
    const nextBackupUTC = new Date();
    nextBackupUTC.setUTCHours(8, 0, 0, 0);
    if (nextBackupUTC <= now) {
        nextBackupUTC.setUTCDate(nextBackupUTC.getUTCDate() + 1);
    }

    const msUntilNext = nextBackupUTC - now;
    setTimeout(() => {
        createBackup('auto').catch(e => console.error('Error en backup nocturno:', e.message));
        // Repetir cada 24 horas
        setInterval(() => {
            createBackup('auto').catch(e => console.error('Error en backup programado:', e.message));
        }, 24 * 60 * 60 * 1000);
    }, msUntilNext);
}

module.exports = {
    createBackup,
    getBackupList,
    scheduleDailyBackup,
    backupsDir
};
