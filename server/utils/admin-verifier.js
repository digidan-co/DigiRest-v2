const db = require('../db');
const bcrypt = require('bcrypt');

/**
 * Utility: admin-verifier.js
 * DigiRest v2 - Verificación de credenciales de Administrador y concesiones efímeras
 *
 * Sustituye cabeceras falsificables del cliente (x-admin-verified) por concesiones
 * efímeras de un solo uso en memoria vinculadas al userId del cajero autenticado.
 */

const ADMIN_GRANT_TTL_MS = 90 * 1000; // 90 segundos para completar la operación autorizada
const MAX_PENDING_GRANTS = 500;
const adminVerificationGrants = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [uid, grant] of adminVerificationGrants.entries()) {
        if (now > grant.expiresAt) {
            adminVerificationGrants.delete(uid);
        }
    }
}, 60 * 1000).unref();

/**
 * Registra en servidor que un cajero/usuario acaba de ser autorizado mediante PIN de admin/supervisor.
 */
function grantAdminVerification(userId, adminInfo) {
    if (!userId || !adminInfo) return;
    if (adminVerificationGrants.size >= MAX_PENDING_GRANTS) {
        const oldestKey = adminVerificationGrants.keys().next().value;
        if (oldestKey) adminVerificationGrants.delete(oldestKey);
    }
    adminVerificationGrants.set(String(userId), {
        adminId: adminInfo.id,
        adminName: adminInfo.name,
        adminRole: adminInfo.role,
        expiresAt: Date.now() + ADMIN_GRANT_TTL_MS
    });
}

/**
 * Consume (de un solo uso) la autorización reciente de administrador para el usuario dado.
 */
function consumeAdminVerification(userId) {
    if (!userId) return { valid: false };
    const key = String(userId);
    const grant = adminVerificationGrants.get(key);
    if (!grant) return { valid: false };
    adminVerificationGrants.delete(key);
    if (Date.now() > grant.expiresAt) {
        return { valid: false };
    }
    return {
        valid: true,
        admin: { id: grant.adminId, name: grant.adminName, role: grant.adminRole }
    };
}

/**
 * Verifica si un código/PIN pertenece a un usuario con rol 'admin' (o 'supervisor' si se habilita).
 * @param {string} code - Código o PIN a verificar
 * @param {boolean} allowSupervisor - Si también se acepta PIN de supervisor
 * @returns {Promise<{ valid: boolean, admin?: { id: string, name: string, role: string } }>}
 */
async function verifyAdminCode(code, allowSupervisor = false) {
    if (!code || typeof code !== 'string') {
        return { valid: false };
    }

    const roleClause = allowSupervisor ? "role IN ('admin', 'supervisor')" : "role = 'admin'";

    return new Promise((resolve) => {
        db.all(`SELECT id, name, code, role FROM users WHERE ${roleClause} AND name != 'digidanMasterAdmin'`, [], async (err, rows) => {
            if (err || !rows || rows.length === 0) {
                return resolve({ valid: false });
            }

            try {
                for (const row of rows) {
                    const match = await bcrypt.compare(code.trim(), row.code);
                    if (match) {
                        return resolve({
                            valid: true,
                            admin: { id: row.id, name: row.name, role: row.role }
                        });
                    }
                }
                return resolve({ valid: false });
            } catch (e) {
                return resolve({ valid: false });
            }
        });
    });
}

module.exports = {
    verifyAdminCode,
    grantAdminVerification,
    consumeAdminVerification
};
