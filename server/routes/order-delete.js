const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');

module.exports = (io) => {
    // DELETE /orders/:id - Delete order (Admin, Cajero, or Waiter who created it)
    router.delete('/orders/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const userRole = req.user ? req.user.role : null;
        const userId = req.user ? req.user.id : null;

        // Check if user is allowed to delete this order
        db.get('SELECT waiterId, status FROM orders WHERE id = ?', [id], (findErr, order) => {
            if (findErr) return res.status(500).json({ error: findErr.message });
            if (!order) return res.status(404).json({ error: 'Order not found' });

            // Admin and Cajero can delete any order. Waiters can only delete their own pending orders.
            const isPrivileged = userRole === 'admin' || userRole === 'cajero';
            const isOwnerWaiter = (userRole === 'mesero' || userRole === 'waiter') && order.waiterId === userId && order.status === 'Pendiente';

            if (!isPrivileged && !isOwnerWaiter) {
                return res.status(403).json({ error: 'No tienes permisos para eliminar este pedido.' });
            }

            db.serialize(() => {
                // 1. Delete from notes_log (History)
                db.run("DELETE FROM notes_log WHERE order_id = ?", [id], (err) => {
                    if (err) console.error("Error deleting notes history:", err);
                });

                // 2. Delete Order (Cascade handles order_notes)
                db.run("DELETE FROM orders WHERE id = ?", [id], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'Order not found' });
                    }

                    // Emit Socket.io event for real-time update
                    io.to('admin').emit('order_deleted', { id });
                    io.to('cajero').emit('order_deleted', { id });
                    io.to('chef').emit('order_deleted', { id });
                    io.to('cocinero').emit('order_deleted', { id });
                    io.to('mesero').emit('order_deleted', { id });
                    io.to('waiter').emit('order_deleted', { id });
                    io.to('delivery').emit('order_deleted', { id });
                    io.to('repartidor').emit('order_deleted', { id });
                    io.to('tracker').emit('order_deleted', { id });
                    io.to('admin').emit('order_note_deleted', { orderId: id });

                    res.json({ message: 'Order deleted', id });
                });
            });
        });
    });

    // POST /orders/cleanup - Delete oldest N orders by type (Admin only)
    router.post('/orders/cleanup', verifyToken, requireRole(['admin']), (req, res) => {

        const { deleteCountLocal = 0, deleteCountGeneral = 0 } = req.body;

        const countLocal = parseInt(deleteCountLocal) || 0;
        const countGeneral = parseInt(deleteCountGeneral) || 0;

        if (countLocal <= 0 && countGeneral <= 0) {
            return res.status(400).json({ error: 'Invalid delete counts' });
        }

        const sqlLocal = `
            DELETE FROM orders WHERE id IN (
                SELECT id FROM orders WHERE type = 'Local' ORDER BY timestamp ASC LIMIT ?
            )
        `;

        // DEBUG: Check distribution before
        db.all("SELECT type, COUNT(*) as c FROM orders GROUP BY type", [], (err, rows) => {
            if (err) console.error("DEBUG TYPE ERR:", err);
        });

        const sqlGeneral = `
            DELETE FROM orders WHERE id IN (
                SELECT id FROM orders WHERE (type != 'Local' OR type IS NULL OR type = '') ORDER BY timestamp ASC LIMIT ?
            )
        `;

        let localDeleted = 0;
        let generalDeleted = 0;

        const runCleanup = async () => {
            try {
                if (countLocal > 0) {
                    // First, get IDs that will be deleted so we can clean their notes
                    const localIds = await new Promise((resolve, reject) => {
                        db.all(
                            "SELECT id FROM orders WHERE type = 'Local' ORDER BY timestamp ASC LIMIT ?",
                            [countLocal],
                            (err, rows) => err ? reject(err) : resolve(rows.map(r => r.id))
                        );
                    });

                    if (localIds.length > 0) {
                        const placeholders = localIds.map(() => '?').join(',');
                        // Explicitly delete notes (in case CASCADE is not active on this connection context)
                        await new Promise((resolve) => {
                            db.run(`DELETE FROM order_notes WHERE id_order IN (${placeholders})`, localIds, (err) => {
                                if (err) console.error('Error deleting local order notes:', err);
                                resolve();
                            });
                        });
                        await new Promise((resolve) => {
                            db.run(`DELETE FROM notes_log WHERE order_id IN (${placeholders})`, localIds, (err) => {
                                if (err) console.error('Error deleting local notes_log:', err);
                                resolve();
                            });
                        });
                    }

                    await new Promise((resolve, reject) => {
                        db.run(sqlLocal, [countLocal], function (err) {
                            if (err) reject(err);
                            else {
                                localDeleted = this.changes;
                                resolve();
                            }
                        });
                    });
                }

                if (countGeneral > 0) {
                    // First, get IDs that will be deleted
                    const generalIds = await new Promise((resolve, reject) => {
                        db.all(
                            "SELECT id FROM orders WHERE (type != 'Local' OR type IS NULL OR type = '') ORDER BY timestamp ASC LIMIT ?",
                            [countGeneral],
                            (err, rows) => err ? reject(err) : resolve(rows.map(r => r.id))
                        );
                    });

                    if (generalIds.length > 0) {
                        const placeholders = generalIds.map(() => '?').join(',');
                        await new Promise((resolve) => {
                            db.run(`DELETE FROM order_notes WHERE id_order IN (${placeholders})`, generalIds, (err) => {
                                if (err) console.error('Error deleting general order notes:', err);
                                resolve();
                            });
                        });
                        await new Promise((resolve) => {
                            db.run(`DELETE FROM notes_log WHERE order_id IN (${placeholders})`, generalIds, (err) => {
                                if (err) console.error('Error deleting general notes_log:', err);
                                resolve();
                            });
                        });
                    }

                    await new Promise((resolve, reject) => {
                        db.run(sqlGeneral, [countGeneral], function (err) {
                            if (err) reject(err);
                            else {
                                generalDeleted = this.changes;
                                resolve();
                            }
                        });
                    });
                }

                const total = localDeleted + generalDeleted;
                if (total > 0) {
                    // Final safety sweep: remove any remaining orphaned note references
                    await new Promise((resolve) => {
                        db.run("DELETE FROM order_notes WHERE id_order NOT IN (SELECT id FROM orders)", (err) => {
                            if (err) console.error('Error sweeping orphaned order_notes:', err);
                            resolve();
                        });
                    });
                    await new Promise((resolve) => {
                        db.run("DELETE FROM notes_log WHERE order_id NOT IN (SELECT id FROM orders)", (err) => {
                            if (err) console.error('Error sweeping orphaned notes_log:', err);
                            resolve();
                        });
                    });

                    io.emit('orders_cleaned', { localDeleted, generalDeleted, total });
                }
                res.json({ localDeleted, generalDeleted, total });

            } catch (err) {
                console.error('Cleanup error:', err);
                res.status(500).json({ error: err.message });
            }
        };

        runCleanup();
    });

    return router;
};
