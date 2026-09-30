const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('./auth');
const { Parser } = require('json2csv');

module.exports = (io) => {

    // Date comparison: timestamp is stored in UTC (ISO 8601).
    // To match "today" in Colombia (UTC-5), we apply '-5 hours' offset in SQLite
    // so that date(timestamp, '-5 hours') returns the Colombia calendar date.

    router.get('/daily-export', verifyToken, (req, res) => {
        const sql = `
            SELECT * FROM orders 
            WHERE date(timestamp, '-5 hours') = date('now', '-5 hours')
            ORDER BY timestamp DESC
        `;

        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error("Export Error:", err);
                return res.status(500).json({ error: err.message });
            }

            try {
                const pedidosData = [];
                const platosData = [];
                const anuladosData = [];

                let totalDia = 0;
                let totalEfectivo = 0;
                let totalTransferencia = 0;
                let totalLocal = 0;
                let totalDomicilio = 0;
                let totalRecoger = 0;
                let totalAnuladosCount = 0;
                let totalPropinas = 0;
                let totalDescuentos = 0;

                rows.forEach(row => {
                    const mappedOrder = {
                        'ID Pedido': row.id,
                        'Cliente': row.client || '',
                        'Mesero': row.waiterName || '',
                        'Mesa': row.tableNum || '',
                        'Chef': row.chefName || '',
                        'Repartidor': row.deliveryDriverName || '',
                        'Tipo': row.type || '',
                        'Método de Pago': row.payment || '',
                        'Propina': row.tip || 0,
                        'Descuento': row.discount || 0,
                        'Razón Descuento': row.discount_reason || '',
                        'Total Base': (parseFloat(row.total) || 0) + (parseFloat(row.discount) || 0) - (parseFloat(row.tip) || 0),
                        'Total Final': row.total || 0,
                        'Estado': row.status || '',
                        'Notas': row.notes || ''
                    };

                    if (row.status === 'Anulado' || row.status === 'Cancelado' || row.status === 'Eliminado') {
                        anuladosData.push(mappedOrder);
                        totalAnuladosCount++;
                    } else {
                        pedidosData.push(mappedOrder);

                        // Resumen calculations for valid orders
                        const t = parseFloat(row.total) || 0;
                        const tip = parseFloat(row.tip) || 0;
                        const desc = parseFloat(row.discount) || 0;
                        
                        totalDia += t;
                        totalPropinas += tip;
                        totalDescuentos += desc;

                        if (row.payment === 'Efectivo') totalEfectivo += t;
                        if (row.payment === 'Transferencia') totalTransferencia += t;

                        if (row.type === 'Local') totalLocal += t;
                        if (row.type === 'A Domicilio') totalDomicilio += t;
                        if (row.type === 'Recoger') totalRecoger += t;
                    }

                    // Extraer platos
                    try {
                        const items = JSON.parse(row.items);
                        if (Array.isArray(items)) {
                            items.forEach(item => {
                                platosData.push({
                                    'ID Pedido': row.id,
                                    'Plato': item.name,
                                    'Cantidad': item.qty || 1,
                                    'Precio Unitario': item.price || 0,
                                    'Precio Total': (item.price || 0) * (item.qty || 1)
                                });
                            });
                        }
                    } catch (e) {
                        // Fallback o ignorar si no es un JSON válido
                    }
                });

                const formatter = new Intl.NumberFormat('es-CO', {
                    style: 'currency',
                    currency: 'COP',
                    minimumFractionDigits: 0
                });

                const resumenData = [
                    { 'Resumen': 'Venta Bruta (Día)', 'Valor': formatter.format(totalDia - totalPropinas + totalDescuentos) },
                    { 'Resumen': 'Total Descuentos', 'Valor': formatter.format(totalDescuentos) },
                    { 'Resumen': 'Total Ingresado (Día)', 'Valor': formatter.format(totalDia - totalPropinas) },
                    { 'Resumen': 'Total Efectivo', 'Valor': formatter.format(totalEfectivo) },
                    { 'Resumen': 'Total Transferencia', 'Valor': formatter.format(totalTransferencia) },
                    { 'Resumen': 'Total Local', 'Valor': formatter.format(totalLocal) },
                    { 'Resumen': 'Total A Domicilio', 'Valor': formatter.format(totalDomicilio) },
                    { 'Resumen': 'Total para Recoger', 'Valor': formatter.format(totalRecoger) },
                    { 'Resumen': 'Cantidad de Pedidos Anulados', 'Valor': totalAnuladosCount }
                ];

                // Crear libro y hojas Excel
                const xlsx = require('xlsx');
                const wb = xlsx.utils.book_new();

                const wsResumen = xlsx.utils.json_to_sheet(resumenData);
                xlsx.utils.book_append_sheet(wb, wsResumen, "Resumen");

                const wsPedidos = xlsx.utils.json_to_sheet(pedidosData.length > 0 ? pedidosData : [{ Mensaje: "No hay pedidos" }]);
                xlsx.utils.book_append_sheet(wb, wsPedidos, "Pedidos");

                const wsPlatos = xlsx.utils.json_to_sheet(platosData.length > 0 ? platosData : [{ Mensaje: "No hay platos" }]);
                xlsx.utils.book_append_sheet(wb, wsPlatos, "Platos");

                const wsAnulados = xlsx.utils.json_to_sheet(anuladosData.length > 0 ? anuladosData : [{ Mensaje: "No hay anulados" }]);
                xlsx.utils.book_append_sheet(wb, wsAnulados, "Anulados");

                // Fetch gastos for today and include in the report
                db.all("SELECT destino, descripcion, valor, anotaciones, timestamp FROM gastos_dia WHERE date(timestamp, '-5 hours') = date('now', '-5 hours') ORDER BY timestamp DESC", [], (gErr, gastosRows) => {
                    if (gErr) {
                        console.error('Error fetching gastos for report:', gErr);
                        // Still send report without gastos
                        const bufferNoGastos = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
                        res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                        res.header('Content-Disposition', `attachment; filename=cierre_caja_${new Date().toISOString().split('T')[0]}.xlsx`);
                        return res.send(bufferNoGastos);
                    }

                    let totalGastos = 0;
                    const gastosData = (gastosRows || []).map(g => {
                        totalGastos += parseFloat(g.valor) || 0;
                        return {
                            'Destino': g.destino,
                            'Descripción': g.descripcion || '',
                            'Valor': g.valor || 0,
                            'Anotaciones': g.anotaciones || '',
                            'Fecha': g.timestamp || ''
                        };
                    });

                    // Append gastos sheet
                    const wsGastos = xlsx.utils.json_to_sheet(gastosData.length > 0 ? gastosData : [{ Mensaje: 'No hay gastos' }]);
                    xlsx.utils.book_append_sheet(wb, wsGastos, 'Gastos');

                    // Add gastos to resumen
                    resumenData.push({ 'Resumen': 'Total Gastos (Día)', 'Valor': formatter.format(totalGastos) });
                    // Add tips as informational line AFTER gastos (not included in any total)
                    resumenData.push({ 'Resumen': 'Total Propinas (Día)', 'Valor': formatter.format(totalPropinas) });

                    // Rebuild resumen sheet to ensure gastos appear
                    const wsResumen2 = xlsx.utils.json_to_sheet(resumenData);
                    wb.Sheets['Resumen'] = wsResumen2;

                    // Generate buffer and send
                    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
                    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.header('Content-Disposition', `attachment; filename=cierre_caja_${new Date().toISOString().split('T')[0]}.xlsx`);
                    res.send(buffer);
                });

            } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    return router;
};
