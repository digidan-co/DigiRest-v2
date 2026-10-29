const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const { verifyToken, requireRole } = require('./auth');
const { validateConfig } = require('../middleware/validators');
const { logAudit } = require('../utils/auditLogger');

const PUBLIC_CONFIG_KEYS = new Set([
    'dataRestaurant',
    'AcountMoney',
    'bankAccounts',
    'imgRestaurantDefault',
    'imgBannerDefault',
    'uiNameColor',
    'uiPrimaryColor',
    'uiContrastColor',
    'uiThemeId',
    'uiBgAside'
]);

const ADMIN_ONLY_CONFIG_KEYS = new Set([
    'AcountMoney',
    'bankAccounts',
    'imgRestaurantDefault',
    'imgBannerDefault',
    'uiNameColor',
    'uiPrimaryColor',
    'uiContrastColor',
    'uiThemeId',
    'uiBgAside'
]);

module.exports = (io) => {
    // Get Config (Whitelisted public UI/payment keys)
    router.get('/config/:key', (req, res) => {
        const { key } = req.params;
        if (!PUBLIC_CONFIG_KEYS.has(key)) {
            return res.json(null);
        }
        db.get("SELECT value FROM config WHERE key = ?", [key], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) {
                return res.json(null);
            }
            try {
                res.json(JSON.parse(row.value));
            } catch (e) {
                console.error(`Error parsing config value for key "${key}":`, e);
                res.status(500).json({ error: 'Corrupted config value' });
            }
        });
    });

    // Set Config (Admin/Supervisor/Cajero only; Cajero cannot alter bank accounts or strict antifraud flags)
    router.post('/config', verifyToken, requireRole(['admin', 'cajero']), validateConfig, (req, res) => {
        const { key } = req.body;
        let { value } = req.body;

        if (key === 'orderCounter_PG' || key === 'orderCounter_PL') {
            return res.status(403).json({ error: 'Usa el endpoint de reinicio de contadores con verificación de administrador.' });
        }

        if (req.user.role === 'cajero' && ADMIN_ONLY_CONFIG_KEYS.has(key)) {
            return res.status(403).json({ error: 'Solo un administrador o supervisor puede modificar esta configuración.' });
        }

        const saveValue = (finalVal) => {
            const jsonValue = JSON.stringify(finalVal);
            const sql = `INSERT INTO config (key, value) VALUES (?, ?) 
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

            db.run(sql, [key, jsonValue], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                io.emit('config_updated', { key, value: finalVal });
                res.json({ message: 'Config saved', key });
            });
        };

        // Si un cajero cambia dataRestaurant (ej. abrir/cerrar turno isOpen), preservar banderas antifraude
        if (req.user.role === 'cajero' && key === 'dataRestaurant' && value && typeof value === 'object') {
            return db.get("SELECT value FROM config WHERE key = 'dataRestaurant'", [], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                let current = {};
                if (row && row.value) {
                    try { current = JSON.parse(row.value) || {}; } catch (_) {}
                }
                const safeValue = {
                    ...current,
                    isOpen: Boolean(value.isOpen)
                };
                saveValue(safeValue);
            });
        }

        saveValue(value);
    });

    // Reset Order Counters (Admin only — requires password re-confirmation)
    router.post('/config/reset-counters', verifyToken, async (req, res) => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden realizar esta acción.' });
        }

        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Debes ingresar tu código de acceso.' });
        }

        db.get('SELECT code FROM users WHERE id = ?', [req.user.id], async (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (!row && req.user.id !== 'master') {
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            if (row) {
                const match = await bcrypt.compare(code, row.code);
                if (!match) {
                    return res.status(401).json({ error: 'Código incorrecto. Operación cancelada.' });
                }
            }

            const resetSQL = `INSERT INTO config (key, value) VALUES (?, ?) 
                              ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

            db.run(resetSQL, ['orderCounter_PG', JSON.stringify({ count: 0 })], (err1) => {
                if (err1) return res.status(500).json({ error: err1.message });

                db.run(resetSQL, ['orderCounter_PL', JSON.stringify({ count: 0 })], (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });

                    console.log(`⚠️  Contadores restablecidos por: ${req.user.name} (${req.user.id})`);
                    logAudit('COUNTERS_RESET', req.user.id, req.ip, {
                        user: req.user.name,
                        role: req.user.role,
                        message: 'Contadores PG y PL restablecidos a 0'
                    });
                    res.json({ message: 'Contadores restablecidos correctamente. El próximo pedido comenzará en 1.' });
                });
            });
        });
    });

    return router;
};

