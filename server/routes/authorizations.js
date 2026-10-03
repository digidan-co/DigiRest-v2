const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { logAudit } = require('../utils/auditLogger');
const { revertStockForOrder } = require('../utils/inventory-helper');

module.exports = (io) => {
    // POST /authorizations/request - Request authorization to cancel or edit an order
    router.post('/authorizations/request', verifyToken, (req, res) => {
        const { orderId, type, reason } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'orderId es requerido' });
        }
        if (!type || !['cancel', 'edit'].includes(type)) {
            return res.status(400).json({ error: 'Tipo inválido. Permitidos: cancel, edit' });
        }

        // Check if order exists
        db.get('SELECT id, client, tableNum, total, status FROM orders WHERE id = ?', [orderId], (err, order) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

            if (type === 'cancel' && order.status === 'Anulado') {
                return res.status(400).json({ error: 'El pedido ya se encuentra anulado' });
            }

            const authId = 'AUTH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
            const requestedById = req.user?.id || 'unknown';
            const requestedByName = req.user?.name || 'Cajero';
            const sanitizedReason = (reason || '').trim() || (type === 'cancel' ? 'Anulación solicitada por cajero' : 'Edición solicitada por cajero');

            const sql = `INSERT INTO order_authorizations 
                (id, order_id, type, reason, status, requested_by_id, requested_by_name)
                VALUES (?, ?, ?, ?, 'pending', ?, ?)`;

            db.run(sql, [authId, orderId, type, sanitizedReason, requestedById, requestedByName], function (insErr) {
                if (insErr) {
                    console.error('[AUTHORIZATION] Error creating request:', insErr);
                    return res.status(500).json({ error: 'Error al registrar solicitud de autorización' });
                }

                const authPayload = {
                    id: authId,
                    orderId: order.id,
                    client: order.client || 'Cliente General',
                    tableNum: order.tableNum || 'N/A',
                    total: order.total || 0,
                    type,
                    reason: sanitizedReason,
                    requestedById,
                    requestedByName,
                    createdAt: new Date().toISOString()
                };

                // Broadcast to admins and supervisors in real-time
                io.to('admin').emit('authorization:requested', authPayload);
                io.to('supervisor').emit('authorization:requested', authPayload);
                // Also broadcast general event so active cashier/admin views stay in sync
                io.emit('authorization:requested', authPayload);

                // Anti-fraud audit log
                logAudit('AUTHORIZATION_REQUESTED', requestedById, req.ip, {
                    authId,
                    orderId,
                    type,
                    reason: sanitizedReason,
                    requestedByName
                });

                res.status(201).json({ success: true, authId });
            });
        });
    });

    // GET /authorizations/pending - List pending authorizations (Admins and Supervisors only)
    router.get('/authorizations/pending', verifyToken, requireRole(['admin', 'supervisor']), (req, res) => {
        const sql = `
            SELECT a.*, o.client, o.tableNum, o.total, o.status as order_status, o.type as order_type
            FROM order_authorizations a
            LEFT JOIN orders o ON a.order_id = o.id
            WHERE a.status = 'pending'
            ORDER BY a.created_at DESC
        `;

        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // POST /authorizations/:id/resolve - Approve or reject an authorization (Admins and Supervisors only)
    router.post('/authorizations/:id/resolve', verifyToken, requireRole(['admin', 'supervisor']), (req, res) => {
        const { id } = req.params;
        const { action, resolved_note } = req.body;

        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Acción inválida. Permitidos: approve, reject' });
        }

        db.get('SELECT * FROM order_authorizations WHERE id = ?', [id], (err, auth) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!auth) return res.status(404).json({ error: 'Solicitud no encontrada' });

            if (auth.status !== 'pending') {
                return res.status(400).json({ error: `La solicitud ya fue ${auth.status === 'approved' ? 'aprobada' : 'rechazada'}` });
            }

            const resolverId = req.user?.id || 'unknown';
            const resolverName = req.user?.name || 'Administrador';
            const newStatus = action === 'approve' ? 'approved' : 'rejected';
            const note = (resolved_note || '').trim() || null;

            const updateSql = `
                UPDATE order_authorizations
                SET status = ?, resolved_by_id = ?, resolved_by_name = ?, resolved_note = ?, resolved_at = datetime('now')
                WHERE id = ?
            `;

            db.run(updateSql, [newStatus, resolverId, resolverName, note, id], function (updErr) {
                if (updErr) return res.status(500).json({ error: updErr.message });

                if (newStatus === 'approved') {
                    if (auth.type === 'cancel') {
                        // Automatically cancel the order in database
                        const reasonWithAuth = `${auth.reason} (Autorizado por: ${resolverName})`;
                        db.run(
                            "UPDATE orders SET status = 'Anulado', cancel_reason = ? WHERE id = ?",
                            [reasonWithAuth, auth.order_id],
                            (cancelErr) => {
                                if (cancelErr) {
                                    console.error('[AUTHORIZATION] Error updating order status to Anulado:', cancelErr);
                                }

                                // Revert stock if inventory was deducted
                                revertStockForOrder(auth.order_id, resolverName, io);

                                // Notify all stations that order is cancelled
                                const cancelUpdate = {
                                    id: auth.order_id,
                                    status: 'Anulado',
                                    cancelReason: reasonWithAuth
                                };
                                io.emit('order_status_update', cancelUpdate);
                                io.emit('order_updated', cancelUpdate);

                                // Broadcast authorization resolution
                                io.emit('authorization:resolved', {
                                    id: auth.id,
                                    orderId: auth.order_id,
                                    type: 'cancel',
                                    status: 'approved',
                                    approvedBy: resolverName,
                                    requestedBy: auth.requested_by_name
                                });

                                // Anti-fraud audit log
                                logAudit('ORDER_CANCELLED_BY_AUTH', resolverId, req.ip, {
                                    authId: auth.id,
                                    orderId: auth.order_id,
                                    approvedBy: resolverName,
                                    requestedBy: auth.requested_by_name,
                                    reason: auth.reason
                                });

                                res.json({ success: true, status: 'approved', message: 'Pedido anulado con éxito' });
                            }
                        );
                    } else if (auth.type === 'edit') {
                        // Edit permission granted
                        io.emit('authorization:resolved', {
                            id: auth.id,
                            orderId: auth.order_id,
                            type: 'edit',
                            status: 'approved',
                            approvedBy: resolverName,
                            requestedBy: auth.requested_by_name
                        });

                        logAudit('ORDER_EDIT_AUTHORIZED', resolverId, req.ip, {
                            authId: auth.id,
                            orderId: auth.order_id,
                            approvedBy: resolverName,
                            requestedBy: auth.requested_by_name
                        });

                        res.json({ success: true, status: 'approved', message: 'Edición de pedido autorizada' });
                    }
                } else {
                    // Rejected
                    io.emit('authorization:resolved', {
                        id: auth.id,
                        orderId: auth.order_id,
                        type: auth.type,
                        status: 'rejected',
                        rejectedBy: resolverName,
                        requestedBy: auth.requested_by_name,
                        note: note
                    });

                    logAudit('ORDER_AUTH_REJECTED', resolverId, req.ip, {
                        authId: auth.id,
                        orderId: auth.order_id,
                        type: auth.type,
                        rejectedBy: resolverName,
                        requestedBy: auth.requested_by_name,
                        note: note
                    });

                    res.json({ success: true, status: 'rejected', message: 'Solicitud rechazada' });
                }
            });
        });
    });

    return router;
};
