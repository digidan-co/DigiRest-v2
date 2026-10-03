const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('./auth');
const { upload, validateUploadedFile } = require('../middleware/upload');
const { validateOrderInput } = require('../middleware/validators');
const fs = require('fs');
const path = require('path');
const { processProof } = require('../utils/imageProcessor');
const { logAudit } = require('../utils/auditLogger');

module.exports = (io) => {
    // PUT /orders/:id - Update existing order (with optional proof upload)
    router.put('/orders/:id', verifyToken, upload.single('proof'), validateOrderInput, async (req, res) => {
        const { id } = req.params;
        const { client, phone, address, notes, type, payment, status, table, items, proof, total } = req.body; // proof might be "" or "null" string
        
        const tip = parseFloat(req.body.tip) || 0;
        const discount = parseFloat(req.body.discount) || 0;
        const discount_reason = req.body.discount_reason || "";

        const itemsJson = typeof items === 'string' ? items : JSON.stringify(items || []);

        // Get proof path if file was uploaded (compress server-side first)
        let newProofPath = req.file ? `/uploads/${req.file.filename}` : null;
        if (req.file) {
            try {
                const optimized = await processProof(req.file.path);
                newProofPath = '/uploads/' + path.basename(optimized);
            } catch (e) {
                console.error('Error compressing proof, using original:', e.message);
            }
        }

        // Check if we need to remove or replace the proof
        // If newProofPath exists -> Replace
        // If proof is explicitly empty string or "null" -> Remove
        const shouldRemoveProof = (proof === "" || proof === "null" || proof === null) && !newProofPath;
        const shouldReplaceProof = !!newProofPath;

        const account_id = req.body.account_id ? parseInt(req.body.account_id, 10) : null;
        const cash_amount = parseFloat(req.body.cash_amount) || 0;
        const transfer_amount = parseFloat(req.body.transfer_amount) || 0;
        const cash_account_id = req.body.cash_account_id ? parseInt(req.body.cash_account_id, 10) : null;
        const transfer_account_id = req.body.transfer_account_id ? parseInt(req.body.transfer_account_id, 10) : null;
        const payment_details = typeof req.body.payment_details === 'object' ? JSON.stringify(req.body.payment_details) : (req.body.payment_details || null);

        const proceedWithOrderUpdate = () => {
            // First, get current order to see if there is an old file to delete
            db.get('SELECT proof, type, waiterId, waiterName FROM orders WHERE id = ?', [id], (err, currentOrder) => {
                if (err) return res.status(500).json({ error: err.message });
                if (!currentOrder) return res.status(404).json({ error: 'Order not found' });

            // Handle file deletion
            if ((shouldRemoveProof || shouldReplaceProof) && currentOrder.proof) {
                const oldPathStr = currentOrder.proof;
                // Only delete if it looks like a local upload (starts with /uploads/) and not a placeholder or external link
                if (oldPathStr.startsWith('/uploads/')) {
                    const absolutePath = path.join(__dirname, '../../server', oldPathStr);
                    fs.unlink(absolutePath, (err) => {
                        if (err) console.error("Failed to delete old proof:", absolutePath, err.message);
                    });
                }
            }

            // Build SQL
            let sql, params;

            if (shouldReplaceProof) {
                // UPDATE with new file
                sql = `UPDATE orders SET 
                         client = ?, phone = ?, address = ?, notes = ?, 
                         type = ?, payment = ?, status = ?, tableNum = ?, items = ?, total = ?, tip = ?, discount = ?, discount_reason = ?,
                         account_id = ?, cash_amount = ?, transfer_amount = ?, cash_account_id = ?, transfer_account_id = ?, payment_details = ?, proof = ?
                         WHERE id = ?`;
                params = [client, phone, address, notes, type, payment, status, table, itemsJson, total, tip, discount, discount_reason, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details, newProofPath, id];
            } else if (shouldRemoveProof) {
                // UPDATE setting proof to NULL
                sql = `UPDATE orders SET 
                         client = ?, phone = ?, address = ?, notes = ?, 
                         type = ?, payment = ?, status = ?, tableNum = ?, items = ?, total = ?, tip = ?, discount = ?, discount_reason = ?,
                         account_id = ?, cash_amount = ?, transfer_amount = ?, cash_account_id = ?, transfer_account_id = ?, payment_details = ?, proof = NULL
                         WHERE id = ?`;
                params = [client, phone, address, notes, type, payment, status, table, itemsJson, total, tip, discount, discount_reason, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details, id];
            } else {
                // UPDATE without changing proof
                sql = `UPDATE orders SET 
                         client = ?, phone = ?, address = ?, notes = ?, 
                         type = ?, payment = ?, status = ?, tableNum = ?, items = ?, total = ?, tip = ?, discount = ?, discount_reason = ?,
                         account_id = ?, cash_amount = ?, transfer_amount = ?, cash_account_id = ?, transfer_account_id = ?, payment_details = ?
                         WHERE id = ?`;
                params = [client, phone, address, notes, type, payment, status, table, itemsJson, total, tip, discount, discount_reason, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details, id];
            }

            db.run(sql, params, function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Construct updated data object
                const updateData = {
                    id,
                    ...req.body,
                    items: JSON.parse(itemsJson),
                    tip, discount, discount_reason,
                    proof: shouldReplaceProof ? newProofPath : (shouldRemoveProof ? null : currentOrder.proof),
                    waiterId: currentOrder.waiterId,
                    waiterName: currentOrder.waiterName
                };

                // Broadcast to all connected clients for instant real-time sync across staff views
                io.emit('order_updated', updateData);
                io.emit('order_status_update', updateData);

                // Emit Socket.io event for real-time update to relevant rooms
                io.to('admin').emit('order_updated', updateData);
                io.to('cajero').emit('order_updated', updateData);
                io.to('chef').emit('order_updated', updateData);
                io.to('cocinero').emit('order_updated', updateData);
                io.to('tracker').emit('order_updated', updateData);
                io.to('mesero').emit('order_updated', updateData);
                io.to('waiter').emit('order_updated', updateData);

                if (currentOrder.waiterId) {
                    io.to(`user_${currentOrder.waiterId}`).emit('order_updated', updateData);
                }

                // Notify delivery if it's a delivery order
                if (type === 'Domicilio') {
                    io.to('delivery').emit('order_updated', updateData);
                    io.to('repartidor').emit('order_updated', updateData);
                }

                // Log audit for order edit
                logAudit('ORDER_EDITED', req.user?.id || 'unknown', req.ip, {
                    orderId: id,
                    userName: req.user?.name || 'Usuario',
                    userRole: req.user?.role || 'N/A',
                    total: total || updateData.total || 0,
                    client: client || updateData.client || 'Cliente'
                });

                res.json({ message: 'Order updated', id });
            });
        });
        };

        // Cajero edit authorization check (Strict Mode enforcement)
        if (req.user?.role === 'cajero') {
            db.get("SELECT value FROM config WHERE key = 'dataRestaurant'", [], (cfgErr, cfgRow) => {
                let cajeroCanEdit = true;
                if (cfgRow && cfgRow.value) {
                    try {
                        const parsed = JSON.parse(cfgRow.value);
                        if (parsed.cajeroCanEdit === false) cajeroCanEdit = false;
                    } catch (e) {}
                }

                if (!cajeroCanEdit) {
                    const isVerified = req.headers['x-admin-verified'] === 'true' || req.body.adminVerified === true;
                    if (!isVerified) {
                        return db.get(
                            "SELECT id FROM order_authorizations WHERE order_id = ? AND type = 'edit' AND status = 'approved' AND datetime(resolved_at, '+15 minutes') >= datetime('now') LIMIT 1",
                            [id],
                            (authErr, authRow) => {
                                if (authErr || !authRow) {
                                    return res.status(403).json({
                                        error: 'La edición de pedidos por cajeros requiere autorización previa de un administrador o supervisor.'
                                    });
                                }
                                proceedWithOrderUpdate();
                            }
                        );
                    }
                }
                proceedWithOrderUpdate();
            });
            return;
        }

        proceedWithOrderUpdate();
    });


    // PATCH /orders/:id/toggle-item - Toggle item checked status
    router.patch('/orders/:id/toggle-item', verifyToken, (req, res) => {
        const { id } = req.params;
        const { itemIndex, checked, checkedQty, isWaiterOrder } = req.body; // use itemIndex now

        db.get('SELECT items, type, waiterId FROM orders WHERE id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Order not found' });

            let items = [];
            try {
                items = JSON.parse(row.items);
            } catch (e) {
                return res.status(500).json({ error: 'Invalid items data' });
            }

            // check bounds
            if (itemIndex === undefined || itemIndex < 0 || itemIndex >= items.length) {
                return res.status(404).json({ error: 'Item not found in order' });
            }

            if (checkedQty !== undefined) {
                // Support partial quantities
                items[itemIndex].checkedQty = Math.max(0, Math.min(checkedQty, items[itemIndex].qty));
                items[itemIndex].checked = items[itemIndex].checkedQty >= items[itemIndex].qty;
                items[itemIndex].checkedBy = items[itemIndex].checkedQty > 0 ? (req.user.name || 'Chef') : null;
            } else {
                // Fallback for simple boolean checked
                items[itemIndex].checked = checked; // bool
                items[itemIndex].checkedQty = checked ? items[itemIndex].qty : 0;
                items[itemIndex].checkedBy = checked ? (req.user.name || 'Chef') : null;
            }

            const itemsJson = JSON.stringify(items);

            db.run('UPDATE orders SET items = ? WHERE id = ?', [itemsJson, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // Construct generic update object, similar to full update but lighter if we wanted
                // But let's send the full order update event so clients re-render cleanly
                // We need to re-fetch the full order or just construct what we changed?
                // The frontend expects the full object in 'order_updated' usually, or we can send a specific event.
                // Existing listeners for 'order_updated' replace the whole object in state.

                // Let's fetch full order to be safe and consistent with other updates
                db.get('SELECT * FROM orders WHERE id = ?', [id], (err, fullOrder) => {
                    if (!err && fullOrder) {
                        const orderData = {
                            ...fullOrder,
                            items: items, // Use the parsed items
                            displayDate: fullOrder.displayDate || new Date(fullOrder.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
                            table: fullOrder.tableNum // Compatibility
                        };

                        // Broadcast to all connected clients (chef, waiter, admin, etc.) so dish progress updates with 0ms latency
                        io.emit('order_updated', orderData);
                        io.emit('order_status_update', orderData);
                        io.emit('order_item_toggled', orderData);

                        io.to('admin').emit('order_updated', orderData);
                        io.to('cajero').emit('order_updated', orderData);
                        io.to('chef').emit('order_updated', orderData);
                        io.to('cocinero').emit('order_updated', orderData);
                        io.to('tracker').emit('order_updated', orderData);

                        // Always notify waiters room and specific waiter if assigned
                        io.to('waiter').emit('order_updated', orderData);
                        io.to('mesero').emit('order_updated', orderData);
                        if (orderData.waiterId) {
                            io.to(`user_${orderData.waiterId}`).emit('order_updated', orderData);
                        }
                    }
                });

                res.json({ success: true, checked });
            });
        });
    });

    return router;
};
