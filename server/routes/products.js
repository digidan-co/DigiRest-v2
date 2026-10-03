const express = require('express');
const router = express.Router();
const path = require('path');
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { upload, validateUploadedFile } = require('../middleware/upload');
const { validateProduct } = require('../middleware/validators');
const { processImage } = require('../utils/imageProcessor');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const fs = require('fs');

module.exports = (io) => {

    // --- CATEGORIES ---

    router.get('/categories', (req, res) => {
        db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // --- CSV CATEGORIES ---

    router.get('/categories/export', (req, res) => {
        db.all("SELECT * FROM categories ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            try {
                const fields = ['id', 'name', 'created_at'];
                const opts = { fields };
                const parser = new Parser(opts);
                const csvData = parser.parse(rows);

                res.header('Content-Type', 'text/csv');
                res.header('Content-Disposition', 'attachment; filename=categories.csv');
                res.send(csvData);
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    router.post('/categories/import', verifyToken, requireRole(['admin']), upload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
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
                            const name = (row.name || row.nombre || row.categoria || '').trim();
                            if (!name) continue;

                            let existing = null;
                            if (row.id) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM categories WHERE id = ?", [row.id], (err, r) => resolve(r));
                                });
                            }
                            if (!existing) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", [name], (err, r) => resolve(r));
                                });
                            }

                            if (existing) {
                                await dbRun("UPDATE categories SET name = ? WHERE id = ?", [name, existing.id]);
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun("INSERT INTO categories (id, name) VALUES (?, ?)", [newId, name]);
                            }
                            processed++;
                        } catch (e) {
                            console.error("Import Error row:", row, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    io.emit('categories_updated');
                    res.json({ message: `Importación completada. Procesadas: ${processed}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

    router.post('/categories', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id, name } = req.body;
        if (id) {
            db.get("SELECT name FROM categories WHERE id = ?", [id], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                if (!row) return res.status(404).json({ error: 'Category not found' });

                const oldName = row.name;

                db.run("UPDATE products SET category = ? WHERE category = ?", [name, oldName], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    db.run("UPDATE categories SET name = ? WHERE id = ?", [name, id], function (err) {
                        if (err) return res.status(500).json({ error: err.message });
                        io.emit('categories_updated');
                        res.json({ id, name });
                    });
                });
            });
        } else {
            const newId = uuidv4();
            db.run("INSERT INTO categories (id, name) VALUES (?, ?)", [newId, name], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                io.emit('categories_updated');
                res.json({ id: newId, name });
            });
        }
    });

    router.delete('/categories/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        db.run("DELETE FROM categories WHERE id = ?", [req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('categories_updated');
            res.json({ message: 'Deleted' });
        });
    });

    // --- PRODUCTS ---

    router.get('/products', (req, res) => {
        db.all("SELECT * FROM products ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // --- TOP DISHES (LAST 7 DAYS STATS) ---
    router.get('/products/top-dishes-7d', (req, res) => {
        const sql = `
            SELECT items 
            FROM orders 
            WHERE timestamp >= datetime('now', '-7 days')
              AND status != 'Cancelado' AND status != 'Anulado'
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const countMap = {};
            (rows || []).forEach(row => {
                try {
                    const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
                    if (Array.isArray(items)) {
                        items.forEach(item => {
                            const keyId = item.productId || item.id;
                            const qty = Number(item.qty) || 1;
                            if (keyId) countMap[keyId] = (countMap[keyId] || 0) + qty;
                            if (item.name) countMap[item.name] = (countMap[item.name] || 0) + qty;
                        });
                    }
                } catch (e) {}
            });

            db.all("SELECT * FROM products WHERE available = 1", [], (pErr, products) => {
                if (pErr) return res.status(500).json({ error: pErr.message });

                const scored = (products || []).map(p => {
                    const ordersCount = Math.max(countMap[p.id] || 0, countMap[p.name] || 0);
                    return { ...p, order_count_7d: ordersCount };
                });

                // Filter to dishes that have at least 1 order, or if none, return recommended/popular
                const ordered = scored.filter(p => p.order_count_7d > 0);
                ordered.sort((a, b) => b.order_count_7d - a.order_count_7d);

                res.json(ordered);
            });
        });
    });

    // --- CSV PRODUCTS ---

    router.get('/products/export', (req, res) => {
        db.all("SELECT * FROM products ORDER BY category ASC, name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            try {
                // Fields to export (includes all current v2 fields and preserves legacy fields)
                const fields = [
                    'id', 'name', 'desc', 'price', 'category', 'available', 'img',
                    'has_toppings', 'toppings_config', 'is_recommended', 'is_promo', 'promo_price', 'created_at'
                ];
                const opts = { fields };
                const parser = new Parser(opts);
                const csvData = parser.parse(rows);

                res.header('Content-Type', 'text/csv; charset=utf-8');
                res.header('Content-Disposition', 'attachment; filename=platos_digirest.csv');
                res.send(csvData);
            } catch (err) {
                console.error('Error generating products CSV:', err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    router.post('/products/import', verifyToken, requireRole(['admin']), upload.single('file'), (req, res) => {
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
                            // Extract values supporting both English headers and Spanish aliases
                            const name = (row.name || row.nombre || row.plato || row.producto || '').trim();
                            if (!name) continue;

                            const desc = (row.desc !== undefined ? row.desc : (row.descripcion !== undefined ? row.descripcion : (row.detalles || ''))).trim();

                            const rawPrice = row.price !== undefined ? row.price : (row.precio !== undefined ? row.precio : (row.valor !== undefined ? row.valor : 0));
                            const price = parseFloat(String(rawPrice).replace(/[^0-9.-]/g, '')) || 0;

                            const category = (row.category || row.categoria || 'General').trim();

                            const rawAvail = row.available !== undefined ? row.available : row.disponible;
                            const available = (rawAvail === undefined || rawAvail === '' || rawAvail === '1' || rawAvail === 1 || rawAvail === 'true' || rawAvail === true || String(rawAvail).toLowerCase() === 'si' || String(rawAvail).toLowerCase() === 'sí') ? 1 : 0;

                            const img = (row.img || row.imagen || row.foto || '/img/noimage.png').trim() || '/img/noimage.png';

                            // New v2 fields with safe defaults for older CSV exports
                            const rawHasTop = row.has_toppings !== undefined ? row.has_toppings : (row.tiene_toppings !== undefined ? row.tiene_toppings : 0);
                            const has_toppings = (rawHasTop === '1' || rawHasTop === 1 || rawHasTop === 'true' || rawHasTop === true || String(rawHasTop).toLowerCase() === 'si') ? 1 : 0;

                            const toppings_config = row.toppings_config || row.configuracion_toppings || '[]';

                            const rawRec = row.is_recommended !== undefined ? row.is_recommended : (row.es_recomendado !== undefined ? row.es_recomendado : (row.recomendado !== undefined ? row.recomendado : 0));
                            const is_recommended = (rawRec === '1' || rawRec === 1 || rawRec === 'true' || rawRec === true || String(rawRec).toLowerCase() === 'si') ? 1 : 0;

                            const rawPromo = row.is_promo !== undefined ? row.is_promo : (row.es_promo !== undefined ? row.es_promo : (row.promocion !== undefined ? row.promocion : 0));
                            const is_promo = (rawPromo === '1' || rawPromo === 1 || rawPromo === 'true' || rawPromo === true || String(rawPromo).toLowerCase() === 'si') ? 1 : 0;

                            const rawPromoPrice = row.promo_price !== undefined ? row.promo_price : (row.precio_promo !== undefined ? row.precio_promo : 0);
                            const promo_price = parseFloat(String(rawPromoPrice).replace(/[^0-9.-]/g, '')) || 0;

                            // Auto-create category if missing
                            if (category) {
                                const catExists = await new Promise((resolve) => {
                                    db.get("SELECT id FROM categories WHERE LOWER(name) = LOWER(?) OR id = ?", [category, category], (err, r) => resolve(r));
                                });
                                if (!catExists) {
                                    await dbRun("INSERT INTO categories (id, name) VALUES (?, ?)", [uuidv4(), category]);
                                }
                            }

                            // Check if product exists by id or by case-insensitive name
                            let existing = null;
                            if (row.id) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM products WHERE id = ?", [row.id], (err, r) => resolve(r));
                                });
                            }
                            if (!existing) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM products WHERE LOWER(name) = LOWER(?)", [name], (err, r) => resolve(r));
                                });
                            }

                            if (existing) {
                                await dbRun(
                                    `UPDATE products 
                                     SET name=?, desc=?, price=?, category=?, available=?, img=?, 
                                         has_toppings=?, toppings_config=?, is_recommended=?, is_promo=?, promo_price=?
                                     WHERE id=?`,
                                    [name, desc, price, category, available, img, has_toppings, toppings_config, is_recommended, is_promo, promo_price, existing.id]
                                );
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun(
                                    `INSERT INTO products 
                                     (id, name, desc, price, category, available, img, has_toppings, toppings_config, is_recommended, is_promo, promo_price)
                                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [newId, name, desc, price, category, available, img, has_toppings, toppings_config, is_recommended, is_promo, promo_price]
                                );
                            }
                            processed++;
                        } catch (e) {
                            console.error("Import Error product row:", row, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    io.emit('categories_updated');
                    io.emit('products_updated');
                    res.json({ message: `Importación completada. Procesados: ${processed}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

    router.post('/products', verifyToken, requireRole(['admin', 'cajero']), upload.single('image'), validateProduct, async (req, res) => {
        let { id, name, desc, price, category, available, has_toppings, toppings_config, is_recommended, is_promo, promo_price } = req.body;
        let imgUrl = req.body.img;

        // If new file uploaded — optimize with sharp after multer saves it
        if (req.file) {
            try {
                const optimizedPath = await processImage(req.file.path);
                // processImage deletes the original and returns path like: ..._opt.webp
                imgUrl = '/server/uploads/' + path.basename(optimizedPath);
            } catch (imgErr) {
                console.error('Error optimizing image:', imgErr);
                // Fallback: use the original multer-saved file
                imgUrl = '/server/uploads/' + req.file.filename;
            }
        }

        // Resolve category UUID to category name for DB storage (backward-compatible)
        // The validator already confirmed it's a valid UUID, now look up the name
        const resolveCategory = (cb) => {
            if (category === undefined || category === '') return cb(null);
            // Check if category looks like a UUID
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(category)) {
                db.get("SELECT name FROM categories WHERE id = ?", [category], (err, row) => {
                    if (err) return cb(err);
                    category = row ? row.name : category;
                    cb(null);
                });
            } else {
                cb(null);
            }
        };

        resolveCategory((err) => {
            if (err) return res.status(500).json({ error: err.message });

            if (id) {
                // Update - Dynamic Query Construction
                const fields = [];
                const values = [];

                if (name !== undefined) { fields.push('name = ?'); values.push(name); }
                if (desc !== undefined) { fields.push('desc = ?'); values.push(desc); }
                if (price !== undefined) { fields.push('price = ?'); values.push(price); }
                if (category !== undefined) { fields.push('category = ?'); values.push(category); }
                if (available !== undefined) {
                    fields.push('available = ?');
                    const isAvailable = available === 'true' || available === true || available === 1 || available === '1';
                    values.push(isAvailable ? 1 : 0);
                }
                if (imgUrl !== undefined) { fields.push('img = ?'); values.push(imgUrl); }
                if (has_toppings !== undefined) {
                    const ht = has_toppings === 'true' || has_toppings === true || has_toppings === 1 || has_toppings === '1';
                    fields.push('has_toppings = ?');
                    values.push(ht ? 1 : 0);
                }
                if (toppings_config !== undefined) {
                    const tc = typeof toppings_config === 'object' ? JSON.stringify(toppings_config) : toppings_config;
                    fields.push('toppings_config = ?');
                    values.push(tc || null);
                }
                if (is_recommended !== undefined) {
                    const ir = is_recommended === 'true' || is_recommended === true || is_recommended === 1 || is_recommended === '1';
                    fields.push('is_recommended = ?');
                    values.push(ir ? 1 : 0);
                }
                if (is_promo !== undefined) {
                    const ip = is_promo === 'true' || is_promo === true || is_promo === 1 || is_promo === '1';
                    fields.push('is_promo = ?');
                    values.push(ip ? 1 : 0);
                }
                if (promo_price !== undefined) {
                    const pp = !isNaN(parseFloat(promo_price)) ? parseFloat(promo_price) : 0;
                    fields.push('promo_price = ?');
                    values.push(pp);
                }

                if (fields.length === 0) {
                    return res.json({ message: 'No changes provided', id });
                }

                values.push(id); // For WHERE clause

                const sql = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;

                db.run(sql, values, function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const isAvailable = available === 'true' || available === true || available === 1 || available === '1';
                    io.emit('products_updated');
                    res.json({ id, ...req.body, img: imgUrl, available: isAvailable ? 1 : 0 });
                });
            } else {
                // Create (Must have all required fields)
                if (!name || !price || !category) {
                    return res.status(400).json({ error: "Missing required fields for creation" });
                }

                const newId = uuidv4();
                const sql = `INSERT INTO products (id, name, desc, price, category, available, img, has_toppings, toppings_config, is_recommended, is_promo, promo_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

                let availInt = 1;
                if (available !== undefined) {
                    const isAvailable = available === 'true' || available === true || available === 1 || available === '1';
                    availInt = isAvailable ? 1 : 0;
                }

                const ht = has_toppings === 'true' || has_toppings === true || has_toppings === 1 || has_toppings === '1' ? 1 : 0;
                const tc = typeof toppings_config === 'object' ? JSON.stringify(toppings_config) : (toppings_config || null);
                const ir = is_recommended === 'true' || is_recommended === true || is_recommended === 1 || is_recommended === '1' ? 1 : 0;
                const ip = is_promo === 'true' || is_promo === true || is_promo === 1 || is_promo === '1' ? 1 : 0;
                const pp = !isNaN(parseFloat(promo_price)) ? parseFloat(promo_price) : 0;

                if (!imgUrl) {
                    imgUrl = '/img/noimage.png';
                }

                db.run(sql, [newId, name, desc || '', price, category, availInt, imgUrl || null, ht, tc, ir, ip, pp], function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    io.emit('products_updated');
                    res.json({
                        id: newId,
                        name,
                        desc,
                        price,
                        category,
                        available: availInt,
                        img: imgUrl,
                        has_toppings: ht,
                        toppings_config: tc,
                        is_recommended: ir,
                        is_promo: ip,
                        promo_price: pp
                    });
                });
            }
        });
    });

    // Quick toggle for recommended status
    router.patch('/products/:id/toggle-recommended', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        db.get("SELECT is_recommended FROM products WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Producto no encontrado' });

            const newRec = row.is_recommended === 1 ? 0 : 1;
            db.run("UPDATE products SET is_recommended = ? WHERE id = ?", [newRec, id], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                io.emit('products_updated');
                res.json({ id, is_recommended: newRec });
            });
        });
    });

    // Quick toggle for promo status
    router.patch('/products/:id/toggle-promo', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        db.get("SELECT is_promo FROM products WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Producto no encontrado' });

            const newPromo = row.is_promo === 1 ? 0 : 1;
            db.run("UPDATE products SET is_promo = ? WHERE id = ?", [newPromo, id], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                io.emit('products_updated');
                res.json({ id, is_promo: newPromo });
            });
        });
    });

    router.delete('/products/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        db.get("SELECT img, name FROM products WHERE id = ?", [req.params.id], (findErr, prod) => {
            db.run("DELETE FROM products WHERE id = ?", [req.params.id], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Limpiar archivo de imagen física en disco si no es la imagen por defecto
                if (prod && prod.img && (prod.img.startsWith('/uploads/') || prod.img.startsWith('/server/uploads/'))) {
                    try {
                        const rel = prod.img.replace('/server/uploads/', 'uploads/').replace('/uploads/', 'uploads/');
                        const full = path.resolve(__dirname, '..', rel);
                        if (fs.existsSync(full)) {
                            fs.unlink(full, (unlinkErr) => {
                                if (!unlinkErr) console.log('🧹 [STORAGE] Imagen huérfana de producto eliminada:', rel);
                            });
                        }
                    } catch (_) {}
                }

                io.emit('products_updated');
                res.json({ message: 'Deleted' });
            });
        });
    });

    return router;
};
