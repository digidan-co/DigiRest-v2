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
                            if (!row.name) continue;

                            let exists = false;
                            if (row.id) {
                                const check = await new Promise((resolve) => {
                                    db.get("SELECT id FROM categories WHERE id = ?", [row.id], (err, row) => {
                                        resolve(row);
                                    });
                                });
                                exists = !!check;
                            }

                            if (exists && row.id) {
                                await dbRun("UPDATE categories SET name = ? WHERE id = ?", [row.name, row.id]);
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun("INSERT INTO categories (id, name) VALUES (?, ?)", [newId, row.name]);
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
                    res.json({ message: `Import successful. Processed: ${processed}, Errors: ${errors}` });
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
        db.all("SELECT * FROM products ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            try {
                // Fields to export
                const fields = ['id', 'name', 'desc', 'price', 'category', 'available', 'img', 'created_at'];
                const opts = { fields };
                const parser = new Parser(opts);
                const csvData = parser.parse(rows);

                res.header('Content-Type', 'text/csv');
                res.header('Content-Disposition', 'attachment; filename=products.csv');
                res.send(csvData);
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    router.post('/products/import', verifyToken, requireRole(['admin']), upload.single('file'), (req, res) => {
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
                            if (!row.name || !row.price || !row.category) continue;

                            // Handle specific fields conversions
                            // Price: ensure number
                            const price = parseFloat(row.price);
                            // Available: ensure 1 or 0
                            const available = (row.available === '1' || row.available === 'true' || row.available === 1) ? 1 : 0;

                            // Image: use default if empty, or use provided
                            const img = row.img || '/img/noimage.png';

                            let exists = false;
                            if (row.id) {
                                const check = await new Promise((resolve) => {
                                    db.get("SELECT id FROM products WHERE id = ?", [row.id], (err, row) => {
                                        resolve(row);
                                    });
                                });
                                exists = !!check;
                            }

                            if (exists && row.id) {
                                await dbRun(
                                    "UPDATE products SET name=?, desc=?, price=?, category=?, available=?, img=? WHERE id=?",
                                    [row.name, row.desc || '', price, row.category, available, img, row.id]
                                );
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun(
                                    "INSERT INTO products (id, name, desc, price, category, available, img) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                    [newId, row.name, row.desc || '', price, row.category, available, img]
                                );
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

                    io.emit('products_updated');
                    res.json({ message: `Import successful. Processed: ${processed}, Errors: ${errors}` });
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
        db.run("DELETE FROM products WHERE id = ?", [req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('products_updated');
            res.json({ message: 'Deleted' });
        });
    });

    return router;
};
