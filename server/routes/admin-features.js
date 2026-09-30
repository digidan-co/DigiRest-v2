const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');

module.exports = (io) => {

    // ========================
    // TASKS
    // ========================
    router.get('/tasks', verifyToken, (req, res) => {
        db.all("SELECT * FROM tasks ORDER BY status DESC, due_date ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    router.post('/tasks', verifyToken, (req, res) => {
        const { description, due_date } = req.body;
        if (!description) return res.status(400).json({ error: "Description required" });

        db.run("INSERT INTO tasks (description, due_date) VALUES (?, ?)", [description, due_date], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, description, due_date, status: 'pending' });
        });
    });

    router.put('/tasks/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        db.run("UPDATE tasks SET status = ? WHERE id = ?", [status, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // PATCH /tasks/:id — used by frontend toggleTask (sends {completed: bool})
    router.patch('/tasks/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const { completed } = req.body;
        const status = completed ? 'done' : 'pending';
        db.run("UPDATE tasks SET status = ? WHERE id = ?", [status, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    router.delete('/tasks/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM tasks WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // ========================
    // RESERVATIONS
    // ========================
    router.get('/reservations', verifyToken, (req, res) => {
        // Only return upcoming reservations (from start of today onwards, Colombia timezone UTC-5)
        // We compute Colombia's midnight: today in Bogotá = UTC - 5 hours
        const nowUTC = new Date();
        // Colombia offset is UTC-5, i.e. subtract 5 hours from UTC to get COT
        const colombiaMidnightUTC = new Date(nowUTC);
        colombiaMidnightUTC.setUTCHours(colombiaMidnightUTC.getUTCHours() - 5); // shift to COT
        colombiaMidnightUTC.setUTCHours(0, 0, 0, 0); // midnight in COT = midnight UTC after shift
        colombiaMidnightUTC.setUTCHours(colombiaMidnightUTC.getUTCHours() + 5); // shift back to UTC
        const todayISO = colombiaMidnightUTC.toISOString();

        db.all(
            "SELECT * FROM reservations WHERE reservation_date >= ? ORDER BY reservation_date ASC",
            [todayISO],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows);
            }
        );
    });

    router.post('/reservations', verifyToken, (req, res) => {
        const { client_name, phone, table_num, pax, observation, reservation_date } = req.body;

        if (!client_name || !reservation_date) {
            return res.status(400).json({ error: "Name and Date required" });
        }

        const sql = `INSERT INTO reservations (client_name, phone, table_num, pax, observation, reservation_date) 
                     VALUES (?, ?, ?, ?, ?, ?)`;

        db.run(sql, [client_name, phone, table_num, pax, observation, reservation_date], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, msg: "Reserva creada" });
        });
    });

    router.put('/reservations/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const { client_name, phone, table_num, pax, observation, reservation_date } = req.body;

        if (!client_name || !reservation_date) {
            return res.status(400).json({ error: "Name and Date required" });
        }

        const sql = `UPDATE reservations 
                     SET client_name = ?, phone = ?, table_num = ?, pax = ?, observation = ?, reservation_date = ?
                     WHERE id = ?`;

        db.run(sql, [client_name, phone, table_num, pax, observation, reservation_date, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Reserva no encontrada" });
            res.json({ success: true });
        });
    });

    router.delete('/reservations/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM reservations WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });

    // ========================
    // NOTES LOG (HISTORY)
    // ========================
    // We need to populate this log when notes are created too.
    // For now, let's expose the read endpoint.
    // The population should happen in `routes/notes.js` -> I need to update that too.
    router.get('/notes-history', verifyToken, (req, res) => {
        db.all("SELECT * FROM notes_log ORDER BY created_at DESC LIMIT 200", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    router.delete('/notes-history/:id', verifyToken, requireRole(['admin']), (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM notes_log WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
    // ========================
    // OPTIMIZE IMAGES TOOL
    // ========================
    router.get('/optimize-images', verifyToken, requireRole(['admin']), async (req, res) => {
        const fs = require('fs');
        const path = require('path');
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        try {
            const sharp = require('sharp');
            const rows = await new Promise((resolve, reject) => {
                db.all("SELECT id, name, img FROM products WHERE img IS NOT NULL", [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            let processed = 0;
            let errors = 0;

            for (const row of rows) {
                try {
                    // 1. Check if it's Base64
                    if (row.img.startsWith('data:image/')) {
                        const matches = row.img.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
                        if (matches && matches.length === 3) {
                            const buffer = Buffer.from(matches[2], 'base64');
                            const filename = `optimized_prod_${row.id}_${Date.now()}.webp`;
                            const filepath = path.join(uploadsDir, filename);
                            
                            await sharp(buffer).webp({ quality: 80 }).toFile(filepath);
                            
                            const newImgUrl = `/server/uploads/${filename}`;
                            await new Promise((resolve) => {
                                db.run("UPDATE products SET img = ? WHERE id = ?", [newImgUrl, row.id], resolve);
                            });
                            processed++;
                        }
                    } 
                    // 2. Check if it's a local JPG/PNG
                    else if (row.img.startsWith('/server/uploads/') && !row.img.endsWith('.webp')) {
                        const oldFilename = row.img.replace('/server/uploads/', '');
                        const oldFilepath = path.join(uploadsDir, oldFilename);
                        
                        if (fs.existsSync(oldFilepath)) {
                            const newFilename = oldFilename.replace(/\.[^/.]+$/, "") + ".webp";
                            const newFilepath = path.join(uploadsDir, newFilename);
                            
                            await sharp(oldFilepath).webp({ quality: 80 }).toFile(newFilepath);
                            
                            const newImgUrl = `/server/uploads/${newFilename}`;
                            await new Promise((resolve) => {
                                db.run("UPDATE products SET img = ? WHERE id = ?", [newImgUrl, row.id], resolve);
                            });
                            
                            // Delete old file
                            fs.unlinkSync(oldFilepath);
                            processed++;
                        }
                    }
                } catch (e) {
                    console.error("Optimization error for row", row.id, e);
                    errors++;
                }
            }

            res.json({ 
                message: "¡Optimización masiva a WebP completada!",
                totalProcesadas: processed,
                errores: errors,
                nota: "Por favor, recarga tu página (o reinicia el backend) para que la memoria baje."
            });

        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // SYSTEM REAL STATS (SQLite + Storage)
    // ==========================================
    let cachedStats = null;
    let lastStatsFetch = 0;

    router.get('/system/stats', verifyToken, async (req, res) => {
        const now = Date.now();
        // 15 seconds TTL cache to prevent disk/db thrashing on fast reloads
        if (cachedStats && (now - lastStatsFetch) < 15000) {
            return res.json(cachedStats);
        }

        try {
            const queryCount = (sql) => new Promise((resolve) => {
                db.get(sql, [], (err, row) => {
                    if (err || !row) resolve(0);
                    else resolve(row.count || 0);
                });
            });

            const [
                ordersCount,
                productsCount,
                categoriesCount,
                usersCount,
                gastosCount,
                cierreCount,
                tasksCount,
                reservationsCount,
                notesCount
            ] = await Promise.all([
                queryCount("SELECT COUNT(*) as count FROM orders"),
                queryCount("SELECT COUNT(*) as count FROM products"),
                queryCount("SELECT COUNT(*) as count FROM categories"),
                queryCount("SELECT COUNT(*) as count FROM users"),
                queryCount("SELECT COUNT(*) as count FROM gastos_dia"),
                queryCount("SELECT COUNT(*) as count FROM cierre_caja"),
                queryCount("SELECT COUNT(*) as count FROM tasks"),
                queryCount("SELECT COUNT(*) as count FROM reservations"),
                queryCount("SELECT COUNT(*) as count FROM order_notes")
            ]);

            const otherRecords = usersCount + gastosCount + cierreCount + tasksCount + reservationsCount + notesCount;
            const totalRecords = ordersCount + productsCount + categoriesCount + otherRecords;

            // Measure SQLite DB size on disk (pos.sqlite, wal, shm)
            const dataDir = path.resolve(__dirname, '../data');
            let dbSizeBytes = 0;
            const dbFiles = ['pos.sqlite', 'pos.sqlite-wal', 'pos.sqlite-shm'];
            for (const f of dbFiles) {
                const fp = path.join(dataDir, f);
                if (fs.existsSync(fp)) {
                    try {
                        dbSizeBytes += fs.statSync(fp).size;
                    } catch (e) {}
                }
            }

            // Measure images count and total size in uploads directory
            const uploadsDir = path.resolve(__dirname, '../uploads');
            let imgCount = 0;
            let imgSizeBytes = 0;
            if (fs.existsSync(uploadsDir)) {
                try {
                    const files = fs.readdirSync(uploadsDir);
                    for (const file of files) {
                        if (file.startsWith('.')) continue;
                        const fp = path.join(uploadsDir, file);
                        const stat = fs.statSync(fp);
                        if (stat.isFile()) {
                            imgCount++;
                            imgSizeBytes += stat.size;
                        }
                    }
                } catch (e) {}
            }

            const formatBytes = (bytes) => {
                if (!bytes || bytes === 0) return '0 KB';
                if (bytes < 1024) return `${bytes} B`;
                if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
            };

            const maxRecordsLimit = parseInt(process.env.MAX_RECORDS_LIMIT, 10) || 15000;
            const maxImageStorageMb = parseInt(process.env.MAX_IMAGE_STORAGE_MB, 10) || 50;

            const stats = {
                records: {
                    orders: ordersCount,
                    products: productsCount,
                    categories: categoriesCount,
                    others: otherRecords,
                    total: totalRecords,
                    limit: maxRecordsLimit
                },
                database: {
                    sizeBytes: dbSizeBytes,
                    sizeFormatted: formatBytes(dbSizeBytes)
                },
                images: {
                    count: imgCount,
                    sizeBytes: imgSizeBytes,
                    sizeFormatted: formatBytes(imgSizeBytes),
                    limitMB: maxImageStorageMb,
                    limitBytes: maxImageStorageMb * 1024 * 1024
                },
                health: 'ok',
                timestamp: new Date().toISOString()
            };

            cachedStats = stats;
            lastStatsFetch = now;
            res.json(stats);
        } catch (error) {
            console.error('Error in /system/stats:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ==========================================
    // REAL DASHBOARD AGGREGATED STATS (SQLite)
    // ==========================================
    let cachedDashboardStats = null;
    let lastDashboardFetch = 0;

    router.get('/dashboard/stats', verifyToken, async (req, res) => {
        const now = Date.now();
        // 5 seconds cache to avoid duplicate calls on socket bursts
        if (cachedDashboardStats && (now - lastDashboardFetch) < 5000) {
            return res.json(cachedDashboardStats);
        }

        try {
            const queryAll = (sql, params = []) => new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            const [totalRows, todayRows, sevenDaysRevenue, sevenDaysWaiters, recentDishes] = await Promise.all([
                // 1. Total Histórico real
                queryAll(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN LOWER(COALESCE(payment, '')) = 'transferencia' THEN 1 ELSE 0 END) as transfer_count,
                        SUM(CASE WHEN LOWER(COALESCE(payment, '')) != 'transferencia' THEN 1 ELSE 0 END) as cash_count,
                        SUM(CASE WHEN status = 'Anulado' THEN 1 ELSE 0 END) as cancelled_count,
                        SUM(CASE WHEN status != 'Anulado' THEN 1 ELSE 0 END) as completed_count,
                        SUM(CASE WHEN type = 'Domicilio' THEN 1 ELSE 0 END) as delivery_count,
                        SUM(CASE WHEN type IN ('Recoger', 'Para Recoger') THEN 1 ELSE 0 END) as pickup_count,
                        SUM(CASE WHEN type NOT IN ('Domicilio', 'Recoger', 'Para Recoger') THEN 1 ELSE 0 END) as local_count
                    FROM orders
                `),
                // 2. Hoy (UTC-5 Colombia, con ventana de turno de 2 AM)
                queryAll(`
                    SELECT 
                        COUNT(CASE WHEN status != 'Anulado' THEN 1 END) as today_orders,
                        SUM(CASE WHEN status NOT IN ('Pendiente', 'Anulado') THEN total ELSE 0 END) as today_revenue,
                        SUM(CASE WHEN status NOT IN ('Pendiente', 'Anulado') AND LOWER(COALESCE(payment, '')) = 'transferencia' THEN total ELSE 0 END) as today_transfer,
                        SUM(CASE WHEN status NOT IN ('Pendiente', 'Anulado') AND LOWER(COALESCE(payment, '')) != 'transferencia' THEN total ELSE 0 END) as today_cash
                    FROM orders
                    WHERE date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) = date(strftime('%Y-%m-%d %H:%M:%S', 'now', '-5 hours', '-2 hours'))
                `),
                // 3. Ingresos últimos 7 días por fecha (UTC-5 Colombia, shift-aware)
                queryAll(`
                    SELECT 
                        date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) as day,
                        SUM(CASE WHEN status NOT IN ('Pendiente', 'Anulado') THEN total ELSE 0 END) as revenue
                    FROM orders
                    WHERE date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) >= date(strftime('%Y-%m-%d %H:%M:%S', 'now', '-5 hours', '-2 hours'), '-6 days')
                    GROUP BY day
                    ORDER BY day ASC
                `),
                // 4. Mesas atendidas por mesero últimos 7 días (UTC-5 Colombia, shift-aware)
                queryAll(`
                    SELECT 
                        COALESCE(NULLIF(waiterName, ''), 'Sin asignar') as waiter,
                        COUNT(*) as count
                    FROM orders
                    WHERE status != 'Anulado'
                      AND type = 'Local'
                      AND date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) >= date(strftime('%Y-%m-%d %H:%M:%S', 'now', '-5 hours', '-2 hours'), '-6 days')
                    GROUP BY waiter
                    ORDER BY count DESC
                `),
                // 5. Platos vendidos en los últimos 7 días y hoy
                queryAll(`
                    SELECT 
                        items, 
                        date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) as day
                    FROM orders
                    WHERE status != 'Anulado'
                      AND date(strftime('%Y-%m-%d %H:%M:%S', timestamp, '-5 hours', '-2 hours')) >= date(strftime('%Y-%m-%d %H:%M:%S', 'now', '-5 hours', '-2 hours'), '-6 days')
                `)
            ]);

            // Procesar platos más vendidos (7 días y hoy)
            const weeklyDishMap = {};
            const todayDishMap = {};
            
            // Current shift day in Colombia
            const shiftDateObj = new Date(Date.now() - (5 + 2) * 3600 * 1000);
            const todayStr = shiftDateObj.toISOString().split('T')[0];

            recentDishes.forEach(row => {
                let items = [];
                try {
                    items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
                } catch (e) {}

                const isOrderToday = row.day === todayStr;

                items.forEach(item => {
                    const name = item.name || 'Producto';
                    const qty = Number(item.qty || item.quantity) || 1;
                    const price = item.price || 0;

                    // 7 days
                    if (!weeklyDishMap[name]) weeklyDishMap[name] = { name, count: 0, price };
                    weeklyDishMap[name].count += qty;

                    // Today
                    if (isOrderToday) {
                        if (!todayDishMap[name]) todayDishMap[name] = { name, count: 0, price };
                        todayDishMap[name].count += qty;
                    }
                });
            });

            const topDishesWeekly = Object.values(weeklyDishMap).sort((a, b) => b.count - a.count);
            const topDishesToday = Object.values(todayDishMap).sort((a, b) => b.count - a.count);

            const result = {
                totals: totalRows[0] || {
                    total: 0, transfer_count: 0, cash_count: 0,
                    cancelled_count: 0, completed_count: 0,
                    delivery_count: 0, pickup_count: 0, local_count: 0
                },
                today: todayRows[0] || {
                    today_orders: 0, today_revenue: 0, today_transfer: 0, today_cash: 0
                },
                sevenDaysRevenue,
                sevenDaysWaiters,
                starDishWeekly: topDishesWeekly[0] || null,
                topDishesToday: topDishesToday.slice(0, 3)
            };

            cachedDashboardStats = result;
            lastDashboardFetch = now;
            res.json(result);
        } catch (error) {
            console.error('Error in /dashboard/stats:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
