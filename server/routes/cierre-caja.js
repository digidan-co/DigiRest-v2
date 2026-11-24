const express = require('express');
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { logAudit } = require('../utils/auditLogger');

module.exports = function (io) {
    const router = express.Router();

    // GET all cierres de caja (Admin / Cajero / Supervisor only)
    router.get('/cierre-caja', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        let query = 'SELECT * FROM cierre_cajas';
        const params = [];

        if (req.user && req.user.role !== 'admin') {
            const userName = req.user.name || '';
            const userLogin = req.user.username || '';
            query += ' WHERE (LOWER(usuario) = LOWER(?) OR LOWER(usuario) = LOWER(?))';
            params.push(userName, userLogin);
        }

        query += ' ORDER BY id DESC LIMIT 50';
        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Error fetching cierres de caja:', err);
                return res.status(500).json({ error: 'Error fetching data' });
            }
            res.json({ success: true, data: rows });
        });
    });

    // POST create new cierre de caja (Admin / Cajero / Supervisor only)
    router.post('/cierre-caja', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const {
            fecha,
            hora,
            cantidad_pedidos,
            cantidad_platos,
            total_anulados,
            total_propinas,
            total_descuentos,
            ingreso_efectivo,
            ingreso_transferencia,
            total_general,
            usuario,
            total_domicilios
        } = req.body;

        if (!fecha || !hora || !usuario) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }

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
                (fecha, hora, cantidad_pedidos, cantidad_platos, total_anulados, total_propinas, total_descuentos, ingreso_efectivo, ingreso_transferencia, total_general, usuario, total_gastos, total_domicilios)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                fecha,
                hora,
                cantidad_pedidos || 0,
                cantidad_platos || 0,
                total_anulados || 0,
                total_propinas || 0,
                total_descuentos || 0,
                ingreso_efectivo || 0,
                ingreso_transferencia || 0,
                adjustedTotal,
                usuario,
                totalGastos,
                parseFloat(total_domicilios) || 0
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
                    userName: req.user?.name || usuario,
                    totalGeneral: total_general,
                    ingresoEfectivo: ingreso_efectivo,
                    ingresoTransferencia: ingreso_transferencia,
                    totalGastos,
                    adjustedTotal,
                    totalDomicilios: total_domicilios || 0
                });

                res.status(201).json({ success: true, id: this.lastID, total_gastos: totalGastos, adjusted_total: adjustedTotal, total_domicilios: total_domicilios || 0 });
            });
        });
    });

    // POST liquidar repartidor de domicilio (Admin / Cajero) -> registra egreso en gastos_dia
    router.post('/cierre-caja/liquidar-domicilio', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { driverName, amount, count, date } = req.body;
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ error: 'Monto de liquidación inválido' });
        }
        const name = (driverName || 'Repartidor General').trim();
        const trips = parseInt(count, 10) || 1;
        const fechaDesc = date ? ` - Fecha: ${date}` : '';
        const descripcion = `Liquidación Domicilios: ${name} (${trips} pedido${trips > 1 ? 's' : ''})${fechaDesc}`;
        const anotaciones = `Liquidación a repartidor independiente realizada por ${req.user?.name || req.user?.username || 'Cajero'}`;

        const query = `INSERT INTO gastos_dia (destino, descripcion, valor, anotaciones) VALUES ('Otro', ?, ?, ?)`;
        db.run(query, [descripcion, numAmount, anotaciones], function (err) {
            if (err) {
                console.error('Error registrando liquidación de domicilio en gastos_dia:', err);
                return res.status(500).json({ error: 'Error al registrar liquidación' });
            }

            if (io) {
                io.emit('gasto_created', { id: this.lastID, valor: numAmount, descripcion });
            }

            logAudit('DELIVERY_LIQUIDATION_RECORDED', req.user?.id || 'unknown', req.ip, {
                gastoId: this.lastID,
                driverName: name,
                amount: numAmount,
                count: trips,
                userName: req.user?.name || req.user?.username
            });

            res.status(201).json({ success: true, id: this.lastID, amount: numAmount, message: 'Liquidación registrada como egreso correctamente' });
        });
    });

    // DELETE /cierre-caja/batch — Admin only (MUST be declared before /:id)
    router.delete('/cierre-caja/batch', verifyToken, requireRole(['admin']), (req, res) => {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Debes proporcionar un array de IDs para eliminar.' });
        }

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
                userName: req.user?.name,
                admin: req.user?.name,
                ids: numericIds
            });

            res.json({ success: true, deleted: this.changes });
        });
    });

    // DELETE /cierre-caja/:id — Admin only: delete single cierre record by ID
    router.delete('/cierre-caja/:id', verifyToken, requireRole(['admin']), (req, res) => {
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
                    userName: req.user?.name || 'Administrador',
                    deletedBy: req.user?.name || 'Administrador'
                });

                res.json({ success: true, deleted: this.changes });
            });
        });
    });

    return router;
};
