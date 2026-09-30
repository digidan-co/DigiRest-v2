const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');

module.exports = (io) => {

    // --- GET CRM CUSTOMERS STATS / KPIS ---
    router.get('/customers/stats', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const statsSql = `
            SELECT 
                COUNT(*) as total_customers,
                SUM(CASE WHEN total_orders >= 3 THEN 1 ELSE 0 END) as frequent_customers,
                SUM(CASE WHEN last_order_at IS NOT NULL AND (julianday('now', '-5 hours') - julianday(last_order_at)) >= 15 THEN 1 ELSE 0 END) as inactive_customers,
                COALESCE(AVG(total_spent), 0) as avg_spent,
                COALESCE(SUM(total_spent), 0) as total_revenue
            FROM customers
        `;

        db.get(statsSql, [], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                totalCustomers: row?.total_customers || 0,
                frequentCustomers: row?.frequent_customers || 0,
                inactiveCustomers: row?.inactive_customers || 0,
                avgSpent: Math.round(row?.avg_spent || 0),
                totalRevenue: row?.total_revenue || 0
            });
        });
    });

    // --- GET ALL CUSTOMERS WITH SEARCH & FILTER ---
    router.get('/customers', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { search = '', filter = 'all', sort = 'last_order' } = req.query;

        let sql = `
            SELECT 
                c.*,
                ROUND(julianday('now', '-5 hours') - julianday(c.last_order_at)) as days_since_last_order,
                CASE 
                    WHEN c.total_orders >= 3 THEN 'frequent'
                    WHEN c.last_order_at IS NOT NULL AND (julianday('now', '-5 hours') - julianday(c.last_order_at)) >= 15 THEN 'inactive'
                    WHEN c.total_orders = 1 THEN 'new'
                    ELSE 'regular'
                END as customer_segment
            FROM customers c
            WHERE 1=1
        `;
        const params = [];

        if (search && search.trim().length > 0) {
            const cleanSearch = `%${search.trim().toLowerCase()}%`;
            sql += ` AND (LOWER(c.name) LIKE ? OR c.phone LIKE ? OR LOWER(COALESCE(c.address, '')) LIKE ? OR LOWER(COALESCE(c.delivery_zone, '')) LIKE ?)`;
            params.push(cleanSearch, cleanSearch, cleanSearch, cleanSearch);
        }

        if (filter === 'frequent') {
            sql += ` AND c.total_orders >= 3`;
        } else if (filter === 'inactive') {
            sql += ` AND c.last_order_at IS NOT NULL AND (julianday('now', '-5 hours') - julianday(c.last_order_at)) >= 15`;
        } else if (filter === 'new') {
            sql += ` AND c.total_orders = 1`;
        }

        if (sort === 'orders') {
            sql += ` ORDER BY c.total_orders DESC, c.total_spent DESC`;
        } else if (sort === 'spent') {
            sql += ` ORDER BY c.total_spent DESC, c.total_orders DESC`;
        } else if (sort === 'name') {
            sql += ` ORDER BY c.name ASC`;
        } else {
            sql += ` ORDER BY c.last_order_at DESC, c.total_spent DESC`;
        }

        sql += ` LIMIT 150`;

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // --- GET SINGLE CUSTOMER PROFILE + ORDER HISTORY ---
    router.get('/customers/:phone', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { phone } = req.params;

        db.get(`
            SELECT 
                c.*,
                ROUND(julianday('now', '-5 hours') - julianday(c.last_order_at)) as days_since_last_order
            FROM customers c WHERE c.phone = ?
        `, [phone], (err, customer) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!customer) return res.status(404).json({ error: 'Cliente no encontrado' });

            // Fetch order history for this phone
            const ordersSql = `
                SELECT id, total, type, payment, status, items, timestamp, delivery_zone, delivery_fee, notes
                FROM orders 
                WHERE phone = ? 
                ORDER BY timestamp DESC 
                LIMIT 25
            `;
            db.all(ordersSql, [phone], (ordersErr, orders) => {
                if (ordersErr) return res.status(500).json({ error: ordersErr.message });

                const parsedOrders = (orders || []).map(o => {
                    let items = [];
                    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items; } catch (e) { }
                    return { ...o, items };
                });

                res.json({
                    customer,
                    orders: parsedOrders
                });
            });
        });
    });

    // --- UPDATE CUSTOMER PROFILE & NOTES ---
    router.put('/customers/:phone', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { phone } = req.params;
        const { name, address, delivery_zone, notes } = req.body;

        const cleanName = name ? name.trim().slice(0, 100) : null;
        const cleanAddr = address !== undefined ? (address ? address.trim().slice(0, 150) : '') : null;
        const cleanZone = delivery_zone !== undefined ? (delivery_zone ? delivery_zone.trim().slice(0, 80) : '') : null;
        const cleanNotes = notes !== undefined ? (notes ? notes.trim().slice(0, 500) : '') : null;

        const updateFields = [];
        const params = [];

        if (cleanName !== null) { updateFields.push('name = ?'); params.push(cleanName); }
        if (cleanAddr !== null) { updateFields.push('address = ?'); params.push(cleanAddr); }
        if (cleanZone !== null) { updateFields.push('delivery_zone = ?'); params.push(cleanZone); }
        if (cleanNotes !== null) { updateFields.push('notes = ?'); params.push(cleanNotes); }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(phone);

        const sql = `UPDATE customers SET ${updateFields.join(', ')} WHERE phone = ?`;
        db.run(sql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

            io.emit('customers_updated');
            res.json({ message: 'Cliente actualizado correctamente', phone });
        });
    });

    // --- SYNC / BACKFILL CUSTOMERS FROM ORDERS ---
    router.post('/customers/sync', verifyToken, requireRole(['admin']), (req, res) => {
        if (db.syncCustomersFromOrders) {
            db.syncCustomersFromOrders((err) => {
                if (err) return res.status(500).json({ error: err.message });
                io.emit('customers_updated');
                res.json({ message: 'Sincronización de clientes completada con éxito' });
            });
        } else {
            res.status(500).json({ error: 'Método de sincronización no disponible' });
        }
    });

    return router;
};
