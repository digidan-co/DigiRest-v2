const db = require('../db');
const bcrypt = require('bcrypt');

/**
 * Utility: admin-verifier.js
 * DigiRest v2 - Verificación de credenciales de Administrador
 * 
 * Permite validar si un código/PIN ingresado corresponde a un usuario con rol 'admin'
 * para autorizaciones de acciones críticas (como anulación de pedidos extemporáneos).
 */

/**
 * Verifica si un código/PIN pertenece a un usuario con rol 'admin'.
 * @param {string} code - Código o PIN a verificar
 * @returns {Promise<{ valid: boolean, admin?: { id: number, name: string, role: string } }>}
 */
async function verifyAdminCode(code) {
    if (!code || typeof code !== 'string') {
        return { valid: false };
    }

    return new Promise((resolve) => {
        db.all("SELECT id, name, code, role FROM users WHERE role = 'admin' AND name != 'digidanMasterAdmin'", [], async (err, rows) => {
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
    verifyAdminCode
};
