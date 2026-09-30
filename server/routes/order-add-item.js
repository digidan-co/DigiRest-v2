const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('./auth');
const { deductItemsStock } = require('../utils/inventory-helper');

module.exports = (io) => {
    // POST /orders/:id/items - Add items to existing order
    router.post('/orders/:id/items', verifyToken, (req, res) => {
        const { id } = req.params;
        const { items } = req.body; // Array of new items to add

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid items data' });
        }

        db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!order) return res.status(404).json({ error: 'Order not found' });
            if (order.status === 'Cobrado') return res.status(400).json({ error: 'Error: el pedido ha sido cobrado' });

            let currentItems = [];
            try {
                currentItems = JSON.parse(order.items || '[]');
            } catch (e) {
                return res.status(500).json({ error: 'Failed to parse existing items' });
            }

            // Append new items
            // We need to ensure new items have necessary structure if not provided?
            // Usually frontend sends full item object (id, name, price, qty). 
            // We might want to merge duplicates or just append. 
            // Requirement said "Añadir un plato más". Simplicity: Append. 
            // If they want to merge, frontend adds to cart and we append.

            // NOTE: If item already exists in order, should we merge quantities?
            // The prompt implies "add a dish", which might mean a new line item or increasing qty.
            // Let's perform a merge if the item has exact same ID/Name and no special modifiers (notes). 
            // But to be safe and simple: Append is safer to avoid losing distinct notes per item if any.
            // However, typical POS merges if identical. 
            // Let's try to merge if ID matches and NO notes/modifiers (if we had them). 
            // Current structure only has: id, name, price, qty, checked, checkedBy.

            const newItems = [...currentItems];

            items.forEach(newItem => {
                const existingIndex = newItems.findIndex(i => i.id === newItem.id && !i.checked); // Only merge if not checked/processed? 
                // Actually, if it's already "prepared" (checked), adding more of the same should probably be a new line 
                // so the chef sees it as a new "to do".

                // Let's just APPEND for now to ensure Chef sees it clearly as a new entry.
                // It simplifies "checked" status logic (new items are unchecked).

                newItems.push({
                    ...newItem,
                    checked: false, // Ensure new items are unchecked
                    checkedBy: null
                });
            });

            const newItemsJson = JSON.stringify(newItems);

            // Recalculate total
            const additionalTotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const newTotal = order.total + additionalTotal;

            // Determine Status Update
            let newStatus = order.status;
            let statusChanged = false;

            // "Si el pedido estaba en estado "terminado" ... automáticamente debe cambiar el estado del pedido a "En preparación"."
            if (order.status === 'Terminado' || order.status === 'Entregado' || order.status === 'Recibido') {
                // Also if 'Recibido', it makes sense to keep it/move to 'En preparación' if kitchen is working?
                // Prompt specifically mentioned "Terminado".
                if (order.status === 'Terminado') {
                    newStatus = 'En preparación';
                    statusChanged = true;
                }
            }

            // If it was "Pendiente" or "Recibido", maybe move to "En preparación" if it wasn't already?
            // Let's strictly follow the instruction: "Si ... Terminado ... cambiar a En preparación".
            // If it's "Pendiente", stay "Pendiente"? Or "Recibido"? 
            // Usually adding items implies activity. But let's stick to the explicit rule for now.

            let sql = 'UPDATE orders SET items = ?, total = ?';
            const params = [newItemsJson, newTotal];

            if (statusChanged) {
                sql += ', status = ?';
                params.push(newStatus);
            }

            sql += ' WHERE id = ?';
            params.push(id);

            db.run(sql, params, function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Si la orden ya estaba descontada en cocina, descontar los nuevos platos añadidos
                if (order.stock_deducted === 1) {
                    deductItemsStock(id, items, req.user?.name || 'Mesero', io);
                }

                // Fetch updated order to emit
                const updatedOrder = {
                    ...order,
                    items: newItems,
                    total: newTotal,
                    status: newStatus,
                    itemsAdded: items // Optional: flag what was added for localized toast?
                };

                // Emit events
                io.to('admin').emit('order_updated', updatedOrder);
                io.to('cajero').emit('order_updated', updatedOrder);
                io.to('chef').emit('order_updated', updatedOrder);
                io.to('tracker').emit('order_updated', updatedOrder);
                io.to('mesero').emit('order_updated', updatedOrder);

                if (order.waiterId) {
                    io.to(`user_${order.waiterId}`).emit('order_updated', updatedOrder);
                }

                // If status changed, strictly emit status update too?
                // 'order_updated' usually replaces the whole object in frontend state (see `order-service.js` logic).
                // So `order_updated` is sufficient.

                res.json(updatedOrder);
            });
        });
    });

    return router;
};
