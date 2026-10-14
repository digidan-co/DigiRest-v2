const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { validateUser } = require('../middleware/validators');

module.exports = (io) => {

// Get All Users (Admin only) - Sanitized: no password hashes exposed (Excludes master admin)
router.get('/', verifyToken, requireRole(['admin']), (req, res) => {
    db.all("SELECT id, name, COALESCE(username, name) as username, role, created_at, work_schedule, allowed_finance_accounts FROM users WHERE id != 'digidan_master_admin' AND username != 'digidanMasterAdmin' AND name != 'digidanMasterAdmin' ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create/Update User (Admin only)
router.post('/', verifyToken, requireRole(['admin']), validateUser, async (req, res) => {
    const { id, name, username, code, role, work_schedule, allowed_finance_accounts } = req.body;
    const finalUsername = (username && username.trim()) || name.trim();
    const scheduleStr = work_schedule !== undefined ? (typeof work_schedule === 'string' ? work_schedule : JSON.stringify(work_schedule)) : null;
    const accountsStr = allowed_finance_accounts !== undefined ? (typeof allowed_finance_accounts === 'string' ? allowed_finance_accounts : JSON.stringify(allowed_finance_accounts)) : null;

    if (id === 'digidan_master_admin' || id === 'master') {
        return res.status(403).json({ error: 'No se puede modificar el usuario administrador maestro desde esta sección.' });
    }
    if (finalUsername.toLowerCase() === 'digidanmasteradmin' || name.toLowerCase() === 'digidanmasteradmin') {
        return res.status(400).json({ error: 'El nombre de usuario digidanMasterAdmin está reservado.' });
    }

    try {
        let hashedCode = code;

        if (id) {
            // Update
            if (code) {
                // Update with new password
                hashedCode = await bcrypt.hash(code, 10);
                let sql = `UPDATE users SET name = ?, username = ?, code = ?, role = ?`;
                const params = [name, finalUsername, hashedCode, role];

                if (scheduleStr !== null) {
                    sql += `, work_schedule = ?`;
                    params.push(scheduleStr);
                }
                if (accountsStr !== null) {
                    sql += `, allowed_finance_accounts = ?`;
                    params.push(accountsStr);
                }
                sql += ` WHERE id = ?`;
                params.push(id);

                db.run(sql, params, function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    io.emit('users_updated');
                    res.json({ message: 'User updated', id });
                });
            } else {
                // Update details only (keep old password)
                let sql = `UPDATE users SET name = ?, username = ?, role = ?`;
                const params = [name, finalUsername, role];

                if (scheduleStr !== null) {
                    sql += `, work_schedule = ?`;
                    params.push(scheduleStr);
                }
                if (accountsStr !== null) {
                    sql += `, allowed_finance_accounts = ?`;
                    params.push(accountsStr);
                }
                sql += ` WHERE id = ?`;
                params.push(id);

                db.run(sql, params, function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    io.emit('users_updated');
                    res.json({ message: 'User updated', id });
                });
            }
        } else {
            // Create
            if (!code) return res.status(400).json({ error: "Code is required for new users" });

            hashedCode = await bcrypt.hash(code, 10);
            const newId = uuidv4();
            const sql = `INSERT INTO users (id, name, username, code, role, work_schedule, allowed_finance_accounts) VALUES (?, ?, ?, ?, ?, ?, ?)`;
            db.run(sql, [newId, name, finalUsername, hashedCode, role, scheduleStr, accountsStr], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                io.emit('users_updated');
                res.json({ message: 'User created', id: newId });
            });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error hashing password" });
    }
});

// Update User Schedule (Admin only)
router.post('/:id/schedule', verifyToken, requireRole(['admin']), (req, res) => {
    const { id } = req.params;
    const { schedule } = req.body;

    const scheduleStr = schedule ? (typeof schedule === 'string' ? schedule : JSON.stringify(schedule)) : null;

    db.run("UPDATE users SET work_schedule = ? WHERE id = ?", [scheduleStr, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('users_updated');
        res.json({ message: 'Horario actualizado correctamente', id, schedule: scheduleStr });
    });
});

// Update User Allowed Finance Accounts (Admin only)
router.post('/:id/finance-accounts', verifyToken, requireRole(['admin']), (req, res) => {
    const { id } = req.params;
    const { allowed_finance_accounts } = req.body;

    const accountsStr = Array.isArray(allowed_finance_accounts)
        ? JSON.stringify(allowed_finance_accounts)
        : (typeof allowed_finance_accounts === 'string' ? allowed_finance_accounts : '[]');

    db.run("UPDATE users SET allowed_finance_accounts = ? WHERE id = ?", [accountsStr, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('users_updated');
        res.json({ message: 'Permisos de cuentas actualizados correctamente', id, allowed_finance_accounts: accountsStr });
    });
});

// Delete User (Admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), (req, res) => {
    const { id } = req.params;

    // Prevent deletion of master admin
    if (id === 'digidan_master_admin' || id === 'master') {
        return res.status(403).json({ error: 'No se puede eliminar el usuario administrador maestro.' });
    }

    db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('users_updated');
        res.json({ message: 'User deleted' });
    });
});

return router;
};
