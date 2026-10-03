const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const { verifyToken } = require('./auth');
const { validateConfig } = require('../middleware/validators');
const { logAudit } = require('../utils/auditLogger');

module.exports = (io) => {
    // Get Config (Public)
    router.get('/config/:key', (req, res) => {
        const { key } = req.params;
        db.get("SELECT value FROM config WHERE key = ?", [key], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) {
                // If config key doesn't exist yet (e.g. imgBannerDefault), return null instead of 404
                // so the frontend client doesn't log unhandled API_ERROR
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

    // Set Config (Authenticated users only — cajero included for isOpen toggle and close register)
    router.post('/config', verifyToken, validateConfig, (req, res) => {
        const { key, value } = req.body;

        const jsonValue = JSON.stringify(value);
        const sql = `INSERT INTO config (key, value) VALUES (?, ?) 
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

        db.run(sql, [key, jsonValue], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            io.emit('config_updated', { key, value });
            res.json({ message: 'Config saved', key });
        });
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

