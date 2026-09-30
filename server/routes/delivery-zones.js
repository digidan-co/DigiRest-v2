const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { v4: uuidv4 } = require('uuid');

module.exports = (io) => {

    // --- GET ALL DELIVERY ZONES ---
    router.get('/delivery-zones', (req, res) => {
        db.all("SELECT * FROM delivery_zones ORDER BY fee ASC, name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // --- CREATE DELIVERY ZONE ---
    router.post('/delivery-zones', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { name, fee, estimated_time, available, min_order } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'El nombre del sector o zona es requerido' });
        }

        const cleanName = name.trim().slice(0, 100);
        const numFee = !isNaN(parseFloat(fee)) ? Math.max(0, parseFloat(fee)) : 0;
        const cleanTime = (estimated_time && typeof estimated_time === 'string') ? estimated_time.trim().slice(0, 50) : '30-45 min';
        const numMinOrder = !isNaN(parseFloat(min_order)) ? Math.max(0, parseFloat(min_order)) : 0;
        const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;
        const newId = req.body.id || `zone_${uuidv4().slice(0, 8)}`;

        const sql = `INSERT INTO delivery_zones (id, name, fee, estimated_time, available, min_order) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sql, [newId, cleanName, numFee, cleanTime, isAvail, numMinOrder], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const createdZone = {
                id: newId,
                name: cleanName,
                fee: numFee,
                estimated_time: cleanTime,
                available: isAvail,
                min_order: numMinOrder
            };

            io.emit('delivery_zones_updated');
            res.status(201).json(createdZone);
        });
    });

    // --- UPDATE DELIVERY ZONE ---
    router.put('/delivery-zones/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        const { name, fee, estimated_time, available, min_order } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'El nombre del sector o zona es requerido' });
        }

        const cleanName = name.trim().slice(0, 100);
        const numFee = !isNaN(parseFloat(fee)) ? Math.max(0, parseFloat(fee)) : 0;
        const cleanTime = (estimated_time && typeof estimated_time === 'string') ? estimated_time.trim().slice(0, 50) : '30-45 min';
        const numMinOrder = !isNaN(parseFloat(min_order)) ? Math.max(0, parseFloat(min_order)) : 0;
        const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;

        const sql = `UPDATE delivery_zones SET name = ?, fee = ?, estimated_time = ?, available = ?, min_order = ? WHERE id = ?`;
        db.run(sql, [cleanName, numFee, cleanTime, isAvail, numMinOrder, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Zona de domicilio no encontrada' });

            io.emit('delivery_zones_updated');
            res.json({
                id,
                name: cleanName,
                fee: numFee,
                estimated_time: cleanTime,
                available: isAvail,
                min_order: numMinOrder
            });
        });
    });

    // --- TOGGLE AVAILABILITY ---
    router.patch('/delivery-zones/:id/toggle', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;

        db.get("SELECT available FROM delivery_zones WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Zona de domicilio no encontrada' });

            const newAvail = row.available === 1 ? 0 : 1;
            db.run("UPDATE delivery_zones SET available = ? WHERE id = ?", [newAvail, id], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });

                io.emit('delivery_zones_updated');
                res.json({ id, available: newAvail });
            });
        });
    });

    // --- DELETE DELIVERY ZONE ---
    router.delete('/delivery-zones/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;

        db.run("DELETE FROM delivery_zones WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Zona de domicilio no encontrada' });

            io.emit('delivery_zones_updated');
            res.json({ message: 'Zona eliminada correctamente', id });
        });
    });

    return router;
};
