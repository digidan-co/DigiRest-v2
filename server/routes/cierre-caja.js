const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');
const { logAudit } = require('../utils/auditLogger');

module.exports = function (io) {
    const router = express.Router();

    // GET all cierres de caja (or paginated)
    router.get('/cierre-caja', verifyToken, (req, res) => {
        const query = 'SELECT * FROM cierre_cajas ORDER BY id DESC LIMIT 50';
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('Error fetching cierres de caja:', err);
                return res.status(500).json({ error: 'Error fetching data' });
            }
            res.json({ success: true, data: rows });
        });
    });

    // POST create new cierre de caja (authenticated users only — cajero included)
    router.post('/cierre-caja', verifyToken, (req, res) => {
        const {
            fecha,
            hora,
            cantidad_pedidos,
            cantidad_platos,
            total_anulados,
            ingreso_efectivo,
            ingreso_transferencia,
            total_general,
            usuario
        } = req.body;

        if (!fecha || !hora || !usuario) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

        // Compute total gastos for the given fecha (Colombia offset)
        const gastosQuery = `SELECT SUM(valor) AS total_gastos FROM gastos_dia WHERE date(timestamp, '-5 hours') = date(?, '-5 hours')`;
        db.get(gastosQuery, [fecha], (err, row) => {
            if (err) {
                console.error('Error fetching daily gastos:', err);
                return res.status(500).json({ error: 'Error fetching daily gastos' });
            }

            const totalGastos = parseFloat(row && row.total_gastos) || 0;
            const adjustedTotal = (parseFloat(total_general) || 0) - totalGastos;

            const query = `
                INSERT INTO cierre_cajas 
                (fecha, hora, cantidad_pedidos, cantidad_platos, total_anulados, ingreso_efectivo, ingreso_transferencia, total_general, usuario, total_gastos)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                fecha,
                hora,
                cantidad_pedidos || 0,
                cantidad_platos || 0,
                total_anulados || 0,
                ingreso_efectivo || 0,
                ingreso_transferencia || 0,
                adjustedTotal,
                usuario,
                totalGastos
            ];

            db.run(query, params, function (err) {
                if (err) {
                    console.error('Error saving cierre de caja:', err);
                    return res.status(500).json({ error: 'Error saving entry' });
                }

                logAudit('CASH_CLOSING_CREATED', req.user?.id || 'unknown', req.ip, {
                    cierreId: this.lastID,
                    fecha,
                    hora,
                    usuario,
                    totalGeneral: total_general,
                    ingresoEfectivo: ingreso_efectivo,
                    ingresoTransferencia: ingreso_transferencia,
                    totalGastos,
                    adjustedTotal
                });

                res.status(201).json({ success: true, id: this.lastID, total_gastos: totalGastos, adjusted_total: adjustedTotal });
            });
        });
    });

    // DELETE /cierre-caja/:id — Admin only: delete single cierre record by ID
    router.delete('/cierre-caja/:id', verifyToken, (req, res) => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden eliminar registros de cierre de caja.' });
        }

        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            return res.status(400).json({ error: 'ID inválido proporcionado.' });
        }

        db.get('SELECT * FROM cierre_cajas WHERE id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Registro de cierre no encontrado.' });

            db.run('DELETE FROM cierre_cajas WHERE id = ?', [id], function (delErr) {
                if (delErr) {
                    console.error('Error deleting cierre de caja:', delErr);
                    return res.status(500).json({ error: 'Error al eliminar el registro.' });
                }

                logAudit('CASH_CLOSINGS_DELETED', req.user?.id, req.ip, {
                    cierreId: id,
                    fecha: row.fecha,
                    totalGeneral: row.total_general,
                    deletedBy: req.user?.name || 'Administrador'
                });

                res.json({ success: true, deleted: this.changes });
            });
        });
    });

    // DELETE /cierre-caja/batch — Admin only: delete multiple cierre records by ID
    router.delete('/cierre-caja/batch', verifyToken, (req, res) => {
        // Only admins can delete cierre records
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Solo administradores pueden eliminar registros de cierre de caja.' });
        }

        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Debes proporcionar un array de IDs para eliminar.' });
        }

        // Validate all IDs are numbers
        const numericIds = ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (numericIds.length === 0) {
            return res.status(400).json({ error: 'IDs inválidos proporcionados.' });
        }

        const placeholders = numericIds.map(() => '?').join(',');
        const query = `DELETE FROM cierre_cajas WHERE id IN (${placeholders})`;

        db.run(query, numericIds, function (err) {
            if (err) {
                console.error('Error deleting cierres de caja:', err);
                return res.status(500).json({ error: 'Error deleting records' });
            }

            logAudit('CASH_CLOSINGS_DELETED', req.user?.id, req.ip, {
                deletedCount: this.changes,
                admin: req.user?.name,
                ids: numericIds
            });

            res.json({ success: true, deleted: this.changes });
        });
    });

    return router;
};
