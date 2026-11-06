const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { upload, csvUpload } = require('../middleware/upload');
const { processImage } = require('../utils/imageProcessor');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const fs = require('fs');

module.exports = (io) => {

    // --- CSV PROMOTIONS AND COMBOS ---

    router.get('/promotions-combos/export', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        db.all("SELECT * FROM promotions_combos ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                const fields = [
                    'id', 'name', 'description', 'category', 'img', 'type',
                    'combo_price', 'discount_value', 'items_config', 'available',
                    'days_of_week', 'start_time', 'end_time', 'channels', 'created_at'
                ];
                const parser = new Parser({ fields });
                const csvData = parser.parse(rows || []);

                res.header('Content-Type', 'text/csv; charset=utf-8');
                res.header('Content-Disposition', 'attachment; filename=combos_promociones_digirest.csv');
                res.send(csvData);
            } catch (err) {
                console.error('Error generating combos CSV:', err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    router.post('/promotions-combos/import', verifyToken, requireRole(['admin']), csvUpload.single('file'), (req, res) => {
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
                            const name = (row.name || row.nombre || row.combo || row.promocion || '').trim();
                            if (!name) continue;

                            const description = (row.description !== undefined ? row.description : (row.descripcion || '')).trim();
                            const category = (row.category || row.categoria || 'Combos').trim();
                            const img = (row.img || row.imagen || row.foto || '/img/noimage.png').trim() || '/img/noimage.png';
                            const type = (row.type || row.tipo || 'FIXED_PRICE').trim();

                            const combo_price = parseFloat(String(row.combo_price ?? row.precio_combo ?? row.precio ?? 0).replace(/[^0-9.-]/g, '')) || 0;
                            const discount_value = parseFloat(String(row.discount_value ?? row.valor_descuento ?? row.descuento ?? 0).replace(/[^0-9.-]/g, '')) || 0;

                            const items_config = row.items_config || row.configuracion_items || '[]';

                            const rawAvail = row.available !== undefined ? row.available : row.disponible;
                            const available = (rawAvail === undefined || rawAvail === '' || rawAvail === '1' || rawAvail === 1 || rawAvail === 'true' || rawAvail === true || String(rawAvail).toLowerCase() === 'si' || String(rawAvail).toLowerCase() === 'sí') ? 1 : 0;

                            const days_of_week = row.days_of_week || row.dias_semana || '["1","2","3","4","5","6","7"]';
                            const start_time = (row.start_time || row.hora_inicio || '').trim() || null;
                            const end_time = (row.end_time || row.hora_fin || '').trim() || null;
                            const channels = row.channels || row.canales || '["Local","Domicilio","Para Llevar"]';

                            let existing = null;
                            if (row.id) {
                                existing = await new Promise(r => db.get("SELECT id FROM promotions_combos WHERE id = ?", [row.id], (err, rRow) => r(rRow)));
                            }
                            if (!existing) {
                                existing = await new Promise(r => db.get("SELECT id FROM promotions_combos WHERE LOWER(name) = LOWER(?)", [name], (err, rRow) => r(rRow)));
                            }

                            if (existing) {
                                await dbRun(
                                    `UPDATE promotions_combos 
                                     SET name=?, description=?, category=?, img=?, type=?, combo_price=?, discount_value=?, items_config=?, available=?, days_of_week=?, start_time=?, end_time=?, channels=?
                                     WHERE id=?`,
                                    [name, description, category, img, type, combo_price, discount_value, items_config, available, days_of_week, start_time, end_time, channels, existing.id]
                                );
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun(
                                    `INSERT INTO promotions_combos 
                                     (id, name, description, category, img, type, combo_price, discount_value, items_config, available, days_of_week, start_time, end_time, channels)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [newId, name, description, category, img, type, combo_price, discount_value, items_config, available, days_of_week, start_time, end_time, channels]
                                );
                            }
                            processed++;
                        } catch (e) {
                            console.error("Import Error combo row:", row, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    io.emit('promotions_updated');
                    io.emit('promotions_combos_updated');
                    res.json({ message: `Importación completada. Procesados: ${processed}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

    // Helper para parsear campos JSON de forma segura
    const parseComboRow = (row) => {
        if (!row) return null;
        let items_config = [];
        let days_of_week = ['1', '2', '3', '4', '5', '6', '7'];
        let channels = ['Local', 'Domicilio', 'Para Llevar'];

        try {
            items_config = typeof row.items_config === 'string' ? JSON.parse(row.items_config) : (row.items_config || []);
        } catch (e) { items_config = []; }

        try {
            days_of_week = typeof row.days_of_week === 'string' ? JSON.parse(row.days_of_week) : (row.days_of_week || []);
        } catch (e) { }

        try {
            channels = typeof row.channels === 'string' ? JSON.parse(row.channels) : (row.channels || []);
        } catch (e) { }

        return {
            ...row,
            available: Number(row.available) === 1,
            combo_price: parseFloat(row.combo_price) || 0,
            discount_value: parseFloat(row.discount_value) || 0,
            items_config,
            days_of_week,
            channels
        };
    };

    // --- LIST ALL PROMOTIONS AND COMBOS ---
    router.get('/promotions-combos', (req, res) => {
        const { active_only, channel } = req.query;
        let sql = 'SELECT * FROM promotions_combos';
        const params = [];

        if (active_only === 'true' || active_only === '1') {
            sql += ' WHERE available = 1';
        }
        sql += ' ORDER BY created_at DESC';

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            let parsed = (rows || []).map(parseComboRow);

            if (channel) {
                const targetChannel = String(channel).trim().toLowerCase();
                parsed = parsed.filter(c => {
                    const cChannels = Array.isArray(c.channels) ? c.channels : [];
                    return cChannels.some(ch => String(ch).trim().toLowerCase() === targetChannel);
                });
            }

            res.json(parsed);
        });
    });

    // --- GET SINGLE COMBO ---
    router.get('/promotions-combos/:id', (req, res) => {
        db.get('SELECT * FROM promotions_combos WHERE id = ?', [req.params.id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Combo no encontrado' });
            res.json(parseComboRow(row));
        });
    });

    // --- CREATE NEW COMBO ---
    router.post('/promotions-combos', verifyToken, requireRole(['admin', 'cajero']), upload.single('image'), async (req, res) => {
        try {
            const {
                name,
                description,
                category = 'Combos',
                type = 'FIXED_PRICE',
                combo_price = 0,
                discount_value = 0,
                items_config,
                available = 1,
                days_of_week,
                start_time,
                end_time,
                channels
            } = req.body;

            if (!name || !name.trim()) {
                return res.status(400).json({ error: 'El nombre del combo es obligatorio' });
            }

            let imgUrl = req.body.img || '/img/noimage.png';

            // Si se subió imagen nueva — optimizar con Sharp
            if (req.file) {
                try {
                    const optimizedPath = await processImage(req.file.path);
                    imgUrl = '/server/uploads/' + path.basename(optimizedPath);
                } catch (imgErr) {
                    console.error('Error optimizando imagen del combo:', imgErr);
                    imgUrl = '/server/uploads/' + req.file.filename;
                }
            }

            const id = uuidv4();
            const itemsConfigJson = typeof items_config === 'string' ? items_config : JSON.stringify(items_config || []);
            const daysOfWeekJson = typeof days_of_week === 'string' ? days_of_week : JSON.stringify(days_of_week || ['1', '2', '3', '4', '5', '6', '7']);
            const channelsJson = typeof channels === 'string' ? channels : JSON.stringify(channels || ['Local', 'Domicilio', 'Para Llevar']);
            const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;

            const sql = `
                INSERT INTO promotions_combos 
                (id, name, description, category, img, type, combo_price, discount_value, items_config, available, days_of_week, start_time, end_time, channels)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                id,
                name.trim(),
                description ? description.trim() : '',
                category ? category.trim() : 'Combos',
                imgUrl,
                type,
                parseFloat(combo_price) || 0,
                parseFloat(discount_value) || 0,
                itemsConfigJson,
                isAvail,
                daysOfWeekJson,
                start_time || null,
                end_time || null,
                channelsJson
            ];

            db.run(sql, params, function (err) {
                if (err) return res.status(500).json({ error: err.message });

                db.get('SELECT * FROM promotions_combos WHERE id = ?', [id], (getErr, newRow) => {
                    const created = parseComboRow(newRow);
                    if (io) {
                        io.emit('promotions_combos_updated');
                    }
                    res.status(201).json(created);
                });
            });

        } catch (err) {
            console.error('Error al crear promoción/combo:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // --- UPDATE COMBO ---
    router.put('/promotions-combos/:id', verifyToken, requireRole(['admin', 'cajero']), upload.single('image'), async (req, res) => {
        try {
            const { id } = req.params;
            const {
                name,
                description,
                category,
                type,
                combo_price,
                discount_value,
                items_config,
                available,
                days_of_week,
                start_time,
                end_time,
                channels
            } = req.body;

            db.get('SELECT * FROM promotions_combos WHERE id = ?', [id], async (findErr, existing) => {
                if (findErr) return res.status(500).json({ error: findErr.message });
                if (!existing) return res.status(404).json({ error: 'Combo no encontrado' });

                let imgUrl = req.body.img !== undefined ? req.body.img : existing.img;

                if (req.file) {
                    try {
                        const optimizedPath = await processImage(req.file.path);
                        imgUrl = '/server/uploads/' + path.basename(optimizedPath);
                    } catch (imgErr) {
                        console.error('Error optimizando imagen del combo:', imgErr);
                        imgUrl = '/server/uploads/' + req.file.filename;
                    }
                }

                const fields = [];
                const values = [];

                if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
                if (description !== undefined) { fields.push('description = ?'); values.push(description.trim()); }
                if (category !== undefined) { fields.push('category = ?'); values.push(category.trim()); }
                if (imgUrl !== undefined) { fields.push('img = ?'); values.push(imgUrl); }
                if (type !== undefined) { fields.push('type = ?'); values.push(type); }
                if (combo_price !== undefined) { fields.push('combo_price = ?'); values.push(parseFloat(combo_price) || 0); }
                if (discount_value !== undefined) { fields.push('discount_value = ?'); values.push(parseFloat(discount_value) || 0); }
                if (items_config !== undefined) {
                    const json = typeof items_config === 'string' ? items_config : JSON.stringify(items_config);
                    fields.push('items_config = ?');
                    values.push(json);
                }
                if (available !== undefined) {
                    const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;
                    fields.push('available = ?');
                    values.push(isAvail);
                }
                if (days_of_week !== undefined) {
                    const json = typeof days_of_week === 'string' ? days_of_week : JSON.stringify(days_of_week);
                    fields.push('days_of_week = ?');
                    values.push(json);
                }
                if (start_time !== undefined) { fields.push('start_time = ?'); values.push(start_time || null); }
                if (end_time !== undefined) { fields.push('end_time = ?'); values.push(end_time || null); }
                if (channels !== undefined) {
                    const json = typeof channels === 'string' ? channels : JSON.stringify(channels);
                    fields.push('channels = ?');
                    values.push(json);
                }

                if (fields.length === 0) {
                    return res.json(parseComboRow(existing));
                }

                const sql = `UPDATE promotions_combos SET ${fields.join(', ')} WHERE id = ?`;
                values.push(id);

                db.run(sql, values, function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    db.get('SELECT * FROM promotions_combos WHERE id = ?', [id], (getErr, updatedRow) => {
                        const updated = parseComboRow(updatedRow);
                        if (io) {
                            io.emit('promotions_combos_updated');
                        }
                        res.json(updated);
                    });
                });
            });

        } catch (err) {
            console.error('Error al actualizar promoción/combo:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // --- TOGGLE AVAILABILITY ---
    router.patch('/promotions-combos/:id/toggle', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        db.get('SELECT available FROM promotions_combos WHERE id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Combo no encontrado' });

            const newAvail = row.available === 1 ? 0 : 1;
            db.run('UPDATE promotions_combos SET available = ? WHERE id = ?', [newAvail, id], function (updErr) {
                if (updErr) return res.status(500).json({ error: updErr.message });

                if (io) {
                    io.emit('promotions_combos_updated');
                }
                res.json({ id, available: newAvail === 1 });
            });
        });
    });

    // --- DELETE COMBO ---
    router.delete('/promotions-combos/:id', verifyToken, requireRole(['admin']), (req, res) => {
        const { id } = req.params;
        db.run('DELETE FROM promotions_combos WHERE id = ?', [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (io) {
                io.emit('promotions_combos_updated');
            }
            res.json({ message: 'Combo eliminado exitosamente' });
        });
    });

    return router;
};
