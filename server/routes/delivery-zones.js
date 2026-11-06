const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { csvUpload } = require('../middleware/upload');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const fs = require('fs');

module.exports = (io) => {

    // --- CSV DELIVERY ZONES ---

    router.get('/delivery-zones/export', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        db.all("SELECT * FROM delivery_zones ORDER BY fee ASC, name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                const fields = ['id', 'name', 'fee', 'estimated_time', 'available', 'min_order', 'created_at'];
                const parser = new Parser({ fields });
                const csvData = parser.parse(rows || []);

                res.header('Content-Type', 'text/csv; charset=utf-8');
                res.header('Content-Disposition', 'attachment; filename=zonas_domicilio_digirest.csv');
                res.send(csvData);
            } catch (err) {
                console.error('Error generating delivery zones CSV:', err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    router.post('/delivery-zones/import', verifyToken, requireRole(['admin']), csvUpload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No se subió ningún archivo" });
        }

        const filePath = req.file.path;
        const results = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                let processed = 0;
                let errors = 0;

                const dbRun = (sql, params) => {
                    return new Promise((resolve, reject) => {
                        db.run(sql, params, function (err) {
                            if (err) reject(err);
                            else resolve(this);
                        });
                    });
                };

                const processBatch = async () => {
                    for (const row of results) {
                        try {
                            const name = (row.name || row.nombre || row.zona || row.sector || '').trim();
                            if (!name) continue;

                            const fee = parseFloat(String(row.fee ?? row.tarifa ?? row.costo ?? row.precio ?? 0).replace(/[^0-9.-]/g, '')) || 0;
                            const estimated_time = (row.estimated_time || row.tiempo_estimado || row.tiempo || '30-45 min').trim();

                            const rawAvail = row.available !== undefined ? row.available : row.disponible;
                            const available = (rawAvail === undefined || rawAvail === '' || rawAvail === '1' || rawAvail === 1 || rawAvail === 'true' || rawAvail === true || String(rawAvail).toLowerCase() === 'si' || String(rawAvail).toLowerCase() === 'sí') ? 1 : 0;

                            const min_order = parseFloat(String(row.min_order ?? row.pedido_minimo ?? row.minimo ?? 0).replace(/[^0-9.-]/g, '')) || 0;

                            let existing = null;
                            if (row.id) {
                                existing = await new Promise(r => db.get("SELECT id FROM delivery_zones WHERE id = ?", [row.id], (err, rRow) => r(rRow)));
                            }
                            if (!existing) {
                                existing = await new Promise(r => db.get("SELECT id FROM delivery_zones WHERE LOWER(name) = LOWER(?)", [name], (err, rRow) => r(rRow)));
                            }

                            if (existing) {
                                await dbRun(
                                    `UPDATE delivery_zones 
                                     SET name=?, fee=?, estimated_time=?, available=?, min_order=?
                                     WHERE id=?`,
                                    [name, fee, estimated_time, available, min_order, existing.id]
                                );
                            } else {
                                const newId = row.id || `zone_${uuidv4().slice(0, 8)}`;
                                await dbRun(
                                    `INSERT INTO delivery_zones 
                                     (id, name, fee, estimated_time, available, min_order)
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [newId, name, fee, estimated_time, available, min_order]
                                );
                            }
                            processed++;
                        } catch (e) {
                            console.error("Import Error delivery zone row:", row, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    io.emit('delivery_zones_updated');
                    res.json({ message: `Importación completada. Procesadas: ${processed}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

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
