const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');
const { validateGasto } = require('../middleware/validators');

module.exports = function (io) {
    const router = express.Router();

    // GET gastos (optionally by date via query ?date=YYYY-MM-DD)
    router.get('/gastos-dia', verifyToken, (req, res) => {
        const date = req.query.date;
        let query = 'SELECT * FROM gastos_dia ORDER BY timestamp DESC';
        const params = [];
        if (date) {
            query = "SELECT * FROM gastos_dia WHERE date(timestamp, '-5 hours') = date(?, '-5 hours') ORDER BY timestamp DESC";
            params.push(date);
        }
        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Error fetching gastos:', err);
                return res.status(500).json({ error: 'Error fetching data' });
            }
            res.json({ success: true, data: rows });
        });
    });

    const verifyAdmin = (req, res, next) => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden realizar esta acción.' });
        }
        next();
    };

    // POST create gasto
    router.post('/gastos-dia', verifyToken, verifyAdmin, validateGasto, (req, res) => {
        const { destino, descripcion, valor, anotaciones } = req.body;
        const query = `INSERT INTO gastos_dia (destino, descripcion, valor, anotaciones) VALUES (?, ?, ?, ?)`;
        db.run(query, [destino, descripcion || '', valor, anotaciones || ''], function (err) {
            if (err) {
                console.error('Error creating gasto:', err);
                return res.status(500).json({ error: 'Error creating gasto' });
            }
            // Broadcast via socket if available
            if (io) io.emit('gasto_created', { id: this.lastID });
            res.status(201).json({ success: true, id: this.lastID });
        });
    });

    // PUT update gasto
    router.put('/gastos-dia/:id', verifyToken, verifyAdmin, (req, res) => {
        const { id } = req.params;
        const { destino, descripcion, valor, anotaciones } = req.body;
        db.run('UPDATE gastos_dia SET destino = ?, descripcion = ?, valor = ?, anotaciones = ? WHERE id = ?',
            [destino, descripcion || '', valor, anotaciones || '', id], function (err) {
            if (err) {
                console.error('Error updating gasto:', err);
                return res.status(500).json({ error: 'Error updating gasto' });
            }
            if (io) io.emit('gasto_updated', { id });
            res.json({ success: true, id });
        });
    });

    // DELETE gasto
    router.delete('/gastos-dia/:id', verifyToken, verifyAdmin, (req, res) => {
        const { id } = req.params;
        db.run('DELETE FROM gastos_dia WHERE id = ?', [id], function (err) {
            if (err) {
                console.error('Error deleting gasto:', err);
                return res.status(500).json({ error: 'Error deleting gasto' });
            }
            if (io) io.emit('gasto_deleted', { id });
            res.json({ success: true });
        });
    });

    return router;
};
