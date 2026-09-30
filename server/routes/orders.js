const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('./auth');
const { upload, validateUploadedFile } = require('../middleware/upload');
const { validateOrderInput } = require('../middleware/validators');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { processProof } = require('../utils/imageProcessor');
const { deductStockForOrder, revertStockForOrder } = require('../utils/inventory-helper');

// Rate limiter for public order creation (customers without auth)
const orderCreationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 orders per 15 min per IP
    message: {
        error: 'Demasiados pedidos. Por favor, intenta nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = (io) => {

    // Helper function to generate sequential IDs — ATOMIC operation
    // Uses a single SQL statement with RETURNING to prevent race conditions
    // where concurrent order creation could produce duplicate IDs.
    // Format: PG1, PL1, PG2, etc. (PG = Pedido General, PL = Pedido Local)
    async function generateOrderId(type) {
        return new Promise((resolve, reject) => {
            const isLocal = type === 'Local';
            const prefix = isLocal ? 'PL' : 'PG';
            const configKey = isLocal ? 'orderCounter_PL' : 'orderCounter_PG';

            // Atomically insert-or-increment the counter in ONE query.
            // SQLite guarantees this is serialized — no two requests can get the same count.
            // Initial value '{"count": 1}' ensures the first order is PG1/PL1.
            // After reset to {count: 0}, the UPDATE adds 1, yielding PG1 again.
            const sql = `
                INSERT INTO config (key, value) VALUES (?, '{"count": 1}')
                ON CONFLICT(key) DO UPDATE SET value = json_set(
                    value,
                    '$.count',
                    COALESCE(json_extract(value, '$.count'), 0) + 1
                )
                RETURNING value
            `;

            db.get(sql, [configKey], (err, row) => {
                if (err) return reject(err);
                if (!row || !row.value) return reject(new Error('Failed to generate order ID'));

                try {
                    const data = JSON.parse(row.value);
                    const counter = data.count || 0;
                    const newId = `${prefix}${counter}`;
                    resolve(newId);
                } catch (e) {
                    reject(new Error('Failed to parse counter value'));
                }
            });
        });
    }

    // Create New Order (Public or Waiter)
    // IMPORTANT: upload.single('proof') must come BEFORE validateOrderInput
    // so that multer parses FormData fields into req.body before validation runs.
    router.post('/orders', orderCreationLimiter, upload.single('proof'), validateOrderInput, async (req, res) => {
        // req.body contains text fields, req.file contains proof if sent
        const { client, phone, address, notes, type, payment, waiterId, waiterName, table, items, total } = req.body;

        let { proof } = req.body; // Can be a URL string if no file uploaded, or undefined

        // If file uploaded, compress it server-side (Sharp → WebP) before saving
        if (req.file) {
            try {
                const optimized = await processProof(req.file.path);
                proof = '/uploads/' + path.basename(optimized);
            } catch (e) {
                console.error('Error compressing proof, using original:', e.message);
                proof = '/uploads/' + req.file.filename;
            }
        }

        const tip = parseFloat(req.body.tip) || 0;
        const discount = parseFloat(req.body.discount) || 0;
        const discount_reason = req.body.discount_reason || "";
        const delivery_zone = req.body.delivery_zone || "";
        const delivery_fee = parseFloat(req.body.delivery_fee) || 0;

        try {
            // Generate formatted ID
            const newId = await generateOrderId(type || 'Domicilio');
            const finalStatus = req.body.status || 'Pendiente';

            // When using FormData, items might be a stringified JSON already or array? 
            // ApiClient with FormData does: formData.append('items', JSON.stringify(items)).
            // So req.body.items IS a string.
            let itemsJson = items;
            if (typeof items !== 'string') {
                itemsJson = JSON.stringify(items || []);
            }


            const sql = `INSERT INTO orders (id, client, phone, address, notes, type, payment, status, total, tip, discount, discount_reason, items, waiterId, waiterName, tableNum, proof, delivery_zone, delivery_fee) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            db.run(sql, [newId, client, phone, address, notes, type, payment, finalStatus, total, tip, discount, discount_reason, itemsJson, waiterId, waiterName, table, proof, delivery_zone, delivery_fee], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Parse items back for response
                let parsedItems = [];
                try { parsedItems = JSON.parse(itemsJson); } catch (e) { }

                const newOrder = {
                    id: newId,
                    client, phone, address, notes, type, payment,
                    status: finalStatus, total,
                    tip, discount, discount_reason, 
                    items: parsedItems,
                    waiterId, waiterName, table, proof,
                    delivery_zone, delivery_fee,
                    // Send ISO string directly. Client handles TZ.
                    timestamp: new Date().toISOString()
                };

                // Notify Kitchen & Admin via Socket.IO rooms
                // Broadcast to chef and admin rooms instead of all clients
                io.to('chef').emit('new_order', newOrder);
                io.to('cocinero').emit('new_order', newOrder); // Support localized role aliases
                io.to('admin').emit('new_order', newOrder);

                // Si el pedido entra directamente a cocina (no pasa por 'Pendiente')
                if (finalStatus !== 'Pendiente' && finalStatus !== 'Anulado') {
                    deductStockForOrder(newId, parsedItems, req.user?.name || waiterName || 'Mesero', io);
                }
                io.to('cajero').emit('new_order', newOrder);
                io.to('tracker').emit('new_order', newOrder);
                io.to('waiter').emit('new_order', newOrder);
                io.to('mesero').emit('new_order', newOrder);

                // If it's a delivery order, notify delivery drivers
                if (type === 'Domicilio') {
                    io.to('delivery').emit('new_order', newOrder);
                }

                // If waiter order, notify the specific waiter
                if (waiterId) {
                    io.to(`user_${waiterId}`).emit('new_order', newOrder);
                }

                // Log initial note to history if present
                if (notes && notes.trim().length > 0) {
                    // Determine author: WaiterName, or 'Cliente' (if public), or 'Sistema'
                    const noteAuthor = waiterName || (type === 'Local' ? 'Mesero' : 'Cliente');

                    db.run("INSERT INTO notes_log (order_id, note, created_by, resolved) VALUES (?, ?, ?, ?)",
                        [newId, notes, noteAuthor, 0], (err) => {
                            if (err) console.error("Error logging initial note history:", err);
                        });
                }

                // Upsert into customers CRM table if phone is provided
                let cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
                if (cleanPhone.startsWith('57') && cleanPhone.length === 12) {
                    cleanPhone = cleanPhone.slice(2);
                }

                if (cleanPhone.length >= 7) {
                    const custName = client && client.trim().length > 0 ? client.trim() : 'Cliente';
                    const custAddr = address && address !== 'N/A' ? address.trim() : '';
                    const custZone = delivery_zone ? delivery_zone.trim() : '';
                    const orderTotal = parseFloat(total) || 0;

                    const upsertCustomerSql = `
                        INSERT INTO customers (phone, name, address, delivery_zone, total_orders, total_spent, last_order_at, updated_at)
                        VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(phone) DO UPDATE SET
                            name = CASE 
                                WHEN customers.name IS NOT NULL AND customers.name != '' AND LOWER(customers.name) NOT IN ('cliente', 'cliente final') 
                                THEN customers.name 
                                WHEN excluded.name IS NOT NULL AND excluded.name != '' AND LOWER(excluded.name) NOT IN ('cliente', 'cliente final')
                                THEN excluded.name 
                                ELSE customers.name 
                            END,
                            address = CASE WHEN excluded.address != '' AND excluded.address != 'N/A' THEN excluded.address ELSE customers.address END,
                            delivery_zone = CASE WHEN excluded.delivery_zone != '' THEN excluded.delivery_zone ELSE customers.delivery_zone END,
                            total_orders = customers.total_orders + 1,
                            total_spent = customers.total_spent + excluded.total_spent,
                            last_order_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    db.run(upsertCustomerSql, [cleanPhone, custName, custAddr, custZone, orderTotal], (custErr) => {
                        if (custErr) console.error("Error updating customer CRM on order:", custErr.message);
                        else io.emit('customers_updated');
                    });
                }

                res.json(newOrder);
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get Active Orders (Trackers, Kitchen) - WITH PAGINATION
    router.get('/orders', (req, res) => {
        const {
            page = 1,
            limit = 50,
            status,
            type,
            from,
            to
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Build dynamic query
        let sql = `
            SELECT o.*, 
            (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id) as notes_count,
            (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id AND n.solved = 0) as unsolved_notes_count
            FROM orders o WHERE 1=1
        `;
        const params = [];

        // Date filter (default: last 24 hours if no date specified AND all != 'true')
        if (from) {
            sql += " AND datetime(timestamp) >= datetime(?)";
            params.push(from);
        } else if (req.query.all !== 'true') {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            sql += " AND datetime(timestamp) > datetime(?)";
            params.push(yesterday);
        }

        if (to) {
            sql += " AND datetime(timestamp) <= datetime(?)";
            params.push(to);
        }

        // Status filter
        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }

        // Type filter
        if (type) {
            sql += " AND type = ?";
            params.push(type);
        }

        // Count total for pagination metadata
        // For count, we don't need the subqueries, but easier to just wrap or replace
        const countSql = `SELECT COUNT(*) as total FROM orders o WHERE 1=1 ` +
            (from ? "AND datetime(timestamp) >= datetime(?) " : (req.query.all !== 'true' ? "AND datetime(timestamp) > datetime(?) " : "")) +
            (to ? "AND datetime(timestamp) <= datetime(?) " : "") +
            (status ? "AND status = ? " : "") +
            (type ? "AND type = ? " : "");

        // Re-map params for count (exact same order/logic as main query clauses)
        // Note: The params array is already built. We can use it. But for countSql, we need to match the placeholders.
        // Effectively, just replace the SELECT part of the query built so far? 
        // But I hardcoded sql string above. Let's restart the logic slightly for safer implementation.

        db.get(countSql, params, (err, countRow) => {
            if (err) return res.status(500).json({ error: err.message });

            const total = countRow ? countRow.total : 0;
            const totalPages = Math.ceil(total / parseInt(limit));

            // Add pagination
            sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
            params.push(parseInt(limit), offset);

            db.all(sql, params, (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                // Parse JSON items and add displayDate
                const orders = rows.map(o => ({
                    ...o,
                    table: o.tableNum, // Map tableNum to table for client compatibility
                    items: JSON.parse(o.items),
                    // SQLite stores typical "YYYY-MM-DD HH:MM:SS".
                    // If we just do new Date(o.timestamp), browser might treat as local. 
                    // We must append 'Z' to force UTC interpretation if it's not present.
                    // But check if it already has one.
                    timestamp: o.timestamp && !o.timestamp.endsWith('Z') ? o.timestamp + 'Z' : o.timestamp,
                    // Determine source for report compatibility
                    source: o.type === 'Local' ? 'Local' : 'General',
                    hasNotes: o.notes_count > 0,
                    hasUnsolvedNotes: o.unsolved_notes_count > 0
                }));

                res.json({
                    orders,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total,
                        totalPages,
                        hasMore: parseInt(page) < totalPages
                    }
                });
            });
        });
    });

    // Get Single Order by ID
    router.get('/orders/:id', (req, res) => {
        const { id } = req.params;
        const sql = `
            SELECT o.*, 
            (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id) as notes_count,
            (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id AND n.solved = 0) as unsolved_notes_count
            FROM orders o WHERE id = ?
        `;
        db.get(sql, [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Order not found' });

            const order = {
                ...row,
                table: row.tableNum,
                items: JSON.parse(row.items),
                displayDate: row.displayDate || new Date(row.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
                source: row.type === 'Local' ? 'Local' : 'General',
                hasNotes: row.notes_count > 0,
                hasUnsolvedNotes: row.unsolved_notes_count > 0
            };
            res.json(order);
        });
    });

    // Update Order Status
    router.put('/orders/:id/status', verifyToken, (req, res) => {
        const { status, chefName, deliveryDriverName } = req.body;
        const { id } = req.params;

        // Audit log for cancellations (track who cancelled orders)
        if (status === 'Anulado') {
            console.log(`[CANCEL] Order ${id} cancelled by ${req.user.name} (role: ${req.user.role})`);
        }

        // DELIVERY LOCK: Check if order is already locked by another driver
        if (status === 'En Reparto' || status === 'En ruta') {
            db.get('SELECT deliveryDriverId, deliveryDriverName FROM orders WHERE id = ?', [id], (err, order) => {
                if (err) return res.status(500).json({ error: err.message });
                if (!order) return res.status(404).json({ error: 'Order not found' });

                // If order already has a driver assigned and it's NOT the current user
                if (order.deliveryDriverId && order.deliveryDriverId != req.user.id) {
                    return res.status(409).json({
                        error: 'ORDER_LOCKED',
                        message: `Este pedido ya fue tomado por ${order.deliveryDriverName}`,
                        lockedBy: order.deliveryDriverName
                    });
                }

                // Order is available or already locked by this user, proceed with update
                performStatusUpdate();
            });
        } else {
            // Not a delivery status, proceed normally
            performStatusUpdate();
        }

        function performStatusUpdate() {
            // Build dynamic update query based on provided fields
            const updates = ['status = ?'];
            const values = [status];

            if (chefName !== undefined) {
                updates.push('chefName = ?');
                values.push(chefName);
            }

            if (deliveryDriverName !== undefined) {
                updates.push('deliveryDriverName = ?');
                values.push(deliveryDriverName);
            }

            if (req.body.deliveryDriverId !== undefined) {
                updates.push('deliveryDriverId = ?');
                values.push(req.body.deliveryDriverId);
            }

            if (req.body.cancelReason !== undefined) {
                updates.push('cancel_reason = ?');
                values.push(req.body.cancelReason);
            }

            values.push(id); // WHERE clause

            const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`;

            db.run(sql, values, function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const updateData = { id, status, chefName, deliveryDriverName, cancelReason: req.body.cancelReason };

                // Notify relevant rooms via Socket.IO
                io.to('admin').emit('order_status_update', updateData);
                io.to('cajero').emit('order_status_update', updateData);
                io.to('chef').emit('order_status_update', updateData);
                io.to('cocinero').emit('order_status_update', updateData);
                io.to('tracker').emit('order_status_update', updateData);
                io.to('mesero').emit('order_status_update', updateData);
                io.to('waiter').emit('order_status_update', updateData);

                // Emit to delivery room when status is delivery-related OR when deliveryDriverId changes (including unlock)
                if (status === 'Terminado' || status === 'En ruta' || status === 'En Reparto' || status === 'Entregado' || req.body.deliveryDriverId !== undefined) {
                    io.to('delivery').emit('order_status_update', updateData);
                }

                // INVENTARIO AUTOMÁTICO: Descuento al pasar a cocina / Reintegro al anular
                if (status === 'Recibido' || status === 'En Preparación' || status === 'En Cocina') {
                    deductStockForOrder(id, null, req.user?.name || 'Admin', io);
                } else if (status === 'Anulado' || status === 'Cancelado') {
                    revertStockForOrder(id, req.user?.name || 'Admin', io);
                }

                res.json(updateData);
            });
        }
    });

    return router;
};
