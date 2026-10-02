const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth');

module.exports = (io) => {
    const notifyCashflow = (type, data = {}) => {
        if (io) {
            io.to('admin').emit('cashflow_updated', { type, ...data });
            io.to('cajero').emit('cashflow_updated', { type, ...data });
        }
    };

    // =========================================================================
    // 1. GET /api/cashflow - RESUMEN CONSOLIDADO Y MOVIMIENTOS
    // =========================================================================
    router.get('/cashflow', verifyToken, (req, res) => {
        const { startDate, endDate, paymentMethod, accountId } = req.query;

        let orderDateFilter = "";
        let gastoDateFilter = "";
        let manualDateFilter = "";
        const orderParams = [];
        const gastoParams = [];
        const manualParams = [];

        if (startDate && endDate) {
            orderDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
            gastoDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
            manualDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
            orderParams.push(startDate, endDate);
            gastoParams.push(startDate, endDate);
            manualParams.push(startDate, endDate);
        } else if (startDate) {
            orderDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
            gastoDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
            manualDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
            orderParams.push(startDate);
            gastoParams.push(startDate);
            manualParams.push(startDate);
        } else if (endDate) {
            orderDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
            gastoDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
            manualDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
            orderParams.push(endDate);
            gastoParams.push(endDate);
            manualParams.push(endDate);
        }

        // 1. Entradas automáticas por pedidos (Cobrado)
        let orderSql = `
            SELECT 
                id, 
                'INGRESO_VENTA' as type,
                'Venta Pedido #' || id || CASE WHEN client IS NOT NULL AND client != '' THEN ' (' || client || ')' ELSE '' END as concept,
                COALESCE(payment, 'Efectivo') as payment_method,
                total as amount,
                timestamp,
                displayDate,
                account_id,
                cash_amount,
                transfer_amount,
                cash_account_id,
                transfer_account_id,
                payment_details
            FROM orders
            WHERE status = 'Cobrado' ${orderDateFilter}
        `;

        if (paymentMethod && paymentMethod !== 'Todos' && paymentMethod !== 'all') {
            orderSql += " AND (payment = ? OR payment = 'Mixto')";
            orderParams.push(paymentMethod);
        }

        if (accountId && accountId !== 'all') {
            orderSql += " AND (account_id = ? OR cash_account_id = ? OR transfer_account_id = ?)";
            orderParams.push(parseInt(accountId, 10), parseInt(accountId, 10), parseInt(accountId, 10));
        }

        orderSql += " ORDER BY timestamp DESC";

        // 2. Egresos de gastos_dia
        let gastoSql = `
            SELECT 
                id, 
                'EGRESO_GASTO' as type,
                destino || CASE WHEN descripcion IS NOT NULL AND descripcion != '' THEN ': ' || descripcion ELSE '' END as concept,
                'Efectivo' as payment_method,
                valor as amount,
                timestamp,
                null as displayDate
            FROM gastos_dia
            WHERE 1=1 ${gastoDateFilter}
        `;

        if (paymentMethod && paymentMethod !== 'Todos' && paymentMethod !== 'all' && paymentMethod !== 'Efectivo') {
            gastoSql += " AND 1=0";
        }

        gastoSql += " ORDER BY timestamp DESC";

        // 3. Movimientos manuales
        let manualSql = `
            SELECT 
                id,
                CASE WHEN type = 'INCOME' THEN 'INGRESO_MANUAL' ELSE 'EGRESO_MANUAL' END as type,
                concept,
                category_id,
                category_name,
                account_id,
                account_name,
                payment_method,
                amount,
                timestamp,
                null as displayDate,
                notes,
                user_name
            FROM cash_movements
            WHERE 1=1 ${manualDateFilter}
        `;

        if (paymentMethod && paymentMethod !== 'Todos' && paymentMethod !== 'all') {
            manualSql += " AND payment_method = ?";
            manualParams.push(paymentMethod);
        }
        if (accountId && accountId !== 'all') {
            manualSql += " AND account_id = ?";
            manualParams.push(parseInt(accountId, 10));
        }

        manualSql += " ORDER BY timestamp DESC";

        db.all(orderSql, orderParams, (err1, orders) => {
            if (err1) return res.status(500).json({ error: err1.message });

            db.all(gastoSql, gastoParams, (err2, gastos) => {
                if (err2) return res.status(500).json({ error: err2.message });

                db.all(manualSql, manualParams, (err3, manuals) => {
                    if (err3) return res.status(500).json({ error: err3.message });

                    const orderRows = orders || [];
                    const gastoRows = gastos || [];
                    const manualRows = manuals || [];

                    // Agrupar pedidos del día por método de pago para unificar ingresos
                    const ordersByDayAndMethod = new Map();

                    const addToGroup = (dayStr, pm, amt, orderId, timestamp, displayDate) => {
                        if (paymentMethod && paymentMethod !== 'Todos' && paymentMethod !== 'all' && pm !== paymentMethod) {
                            return;
                        }
                        const key = `${dayStr}___${pm}`;
                        if (!ordersByDayAndMethod.has(key)) {
                            ordersByDayAndMethod.set(key, {
                                day: dayStr,
                                payment_method: pm,
                                totalAmount: 0,
                                orderCount: 0,
                                latestTimestamp: timestamp,
                                latestDisplayDate: displayDate,
                                orderIds: []
                            });
                        }
                        const grp = ordersByDayAndMethod.get(key);
                        grp.totalAmount += (Number(amt) || 0);
                        grp.orderCount += 1;
                        if (!grp.orderIds.includes(orderId)) grp.orderIds.push(orderId);
                        if (new Date(timestamp) > new Date(grp.latestTimestamp)) {
                            grp.latestTimestamp = timestamp;
                            grp.latestDisplayDate = displayDate;
                        }
                    };

                    orderRows.forEach(o => {
                        let dayStr = '';
                        try {
                            const raw = o.timestamp || '';
                            const dt = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
                            const bogotaMs = dt.getTime() - 5 * 3600000;
                            dayStr = new Date(bogotaMs).toISOString().split('T')[0];
                        } catch (e) {
                            dayStr = (o.timestamp || '').substring(0, 10);
                        }

                        const pm = o.payment_method || 'Efectivo';
                        const tot = parseFloat(o.amount) || 0;

                        let splits = null;
                        if (o.payment_details) {
                            try {
                                const pd = typeof o.payment_details === 'string' ? JSON.parse(o.payment_details) : o.payment_details;
                                if (pd && Array.isArray(pd.splits) && pd.splits.length > 0) {
                                    splits = pd.splits;
                                }
                            } catch (_) {}
                        }

                        if (splits) {
                            splits.forEach(s => {
                                const sAmt = parseFloat(s.amount) || 0;
                                const sMethod = s.method || 'Efectivo';
                                if (sAmt > 0) addToGroup(dayStr, sMethod, sAmt, o.id, o.timestamp, o.displayDate);
                            });
                        } else if (pm === 'Mixto') {
                            const cAmt = parseFloat(o.cash_amount) || 0;
                            const tAmt = parseFloat(o.transfer_amount) || Math.max(0, tot - cAmt);
                            if (cAmt > 0) addToGroup(dayStr, 'Efectivo', cAmt, o.id, o.timestamp, o.displayDate);
                            if (tAmt > 0) addToGroup(dayStr, 'Transferencia', tAmt, o.id, o.timestamp, o.displayDate);
                        } else {
                            addToGroup(dayStr, pm, tot, o.id, o.timestamp, o.displayDate);
                        }
                    });

                    const unifiedOrderMovements = Array.from(ordersByDayAndMethod.values()).map(g => {
                        const isSingle = g.orderCount === 1;
                        const ordersSummary = g.orderIds.length <= 4
                            ? g.orderIds.map(id => `#${id}`).join(', ')
                            : `${g.orderIds.slice(0, 3).map(id => `#${id}`).join(', ')} y ${g.orderIds.length - 3} más`;

                        return {
                            id: `ventas-${g.day}-${g.payment_method}`,
                            type: 'INCOME',
                            category: 'Ventas del Día',
                            category_name: 'Ventas del Día',
                            source: 'Pedido Cobrado',
                            created_by: 'Sistema',
                            concept: `Ventas del Día (${g.orderCount} ${isSingle ? 'pedido' : 'pedidos'})`,
                            payment_method: g.payment_method,
                            account_name: g.payment_method === 'Transferencia' ? 'Bancolombia Negocio' : (g.payment_method === 'Datáfono' ? 'Datáfono Principal' : 'Caja Principal (Efectivo)'),
                            amount: g.totalAmount,
                            timestamp: g.latestTimestamp,
                            date: g.latestTimestamp,
                            displayDate: g.latestDisplayDate,
                            notes: `${g.orderCount} ${isSingle ? 'pedido completado' : 'pedidos completados'} (${ordersSummary})`,
                            isManual: false
                        };
                    });

                    // Consolidar todos los movimientos con propiedades unificadas
                    const allMovements = [
                        ...unifiedOrderMovements,
                        ...gastoRows.map(g => ({
                            id: 'gasto-' + g.id,
                            type: 'EXPENSE',
                            category: 'Gasto del Día',
                            category_name: 'Gasto del Día',
                            source: 'Gasto Registrado',
                            created_by: 'Sistema',
                            concept: g.concept,
                            payment_method: g.payment_method || 'Efectivo',
                            account_name: 'Caja Menor',
                            amount: Number(g.amount) || 0,
                            timestamp: g.timestamp,
                            date: g.timestamp,
                            displayDate: null,
                            isManual: false
                        })),
                        ...manualRows.map(m => ({
                            id: m.id,
                            type: m.type === 'INGRESO_MANUAL' ? 'INCOME' : 'EXPENSE',
                            category: m.category_name || (m.type === 'INGRESO_MANUAL' ? 'Otros Ingresos' : 'Otros Egresos'),
                            category_name: m.category_name || (m.type === 'INGRESO_MANUAL' ? 'Otros Ingresos' : 'Otros Egresos'),
                            source: m.user_name || 'Admin',
                            created_by: m.user_name || 'Admin',
                            concept: m.concept,
                            account_name: m.account_name || m.payment_method,
                            payment_method: m.payment_method || 'Efectivo',
                            amount: Number(m.amount) || 0,
                            timestamp: m.timestamp,
                            date: m.timestamp,
                            notes: m.notes,
                            isManual: true,
                            displayDate: null
                        }))
                    ];

                    allMovements.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                    let totalIncome = 0;
                    let totalExpense = 0;
                    let automaticSales = 0;
                    let automaticExpenses = 0;

                    const byPayment = {
                        Efectivo: { income: 0, expense: 0, net: 0, salesIncome: 0, manualIncome: 0, totalExpense: 0, balance: 0 },
                        Transferencia: { income: 0, expense: 0, net: 0, salesIncome: 0, manualIncome: 0, totalExpense: 0, balance: 0 },
                        Datáfono: { income: 0, expense: 0, net: 0, salesIncome: 0, manualIncome: 0, totalExpense: 0, balance: 0 },
                        Otros: { income: 0, expense: 0, net: 0, salesIncome: 0, manualIncome: 0, totalExpense: 0, balance: 0 }
                    };

                    allMovements.forEach(m => {
                        const pmKey = (m.payment_method === 'Efectivo' || m.payment_method === 'Transferencia' || m.payment_method === 'Datáfono')
                            ? m.payment_method
                            : 'Otros';

                        if (m.type === 'INCOME') {
                            totalIncome += m.amount;
                            byPayment[pmKey].income += m.amount;
                            byPayment[pmKey].net += m.amount;
                            if (m.source === 'Pedido Cobrado') {
                                automaticSales += m.amount;
                                byPayment[pmKey].salesIncome += m.amount;
                            } else {
                                byPayment[pmKey].manualIncome += m.amount;
                            }
                        } else {
                            totalExpense += m.amount;
                            byPayment[pmKey].expense += m.amount;
                            byPayment[pmKey].net -= m.amount;
                            byPayment[pmKey].totalExpense += m.amount;
                            if (m.source === 'Gasto Registrado') {
                                automaticExpenses += m.amount;
                            }
                        }
                    });

                    Object.keys(byPayment).forEach(k => {
                        byPayment[k].balance = byPayment[k].net;
                    });

                    const netCashflow = totalIncome - totalExpense;

                    const byPaymentMethod = {
                        Efectivo: {
                            incomes: byPayment.Efectivo.income,
                            expenses: byPayment.Efectivo.expense,
                            sales: byPayment.Efectivo.salesIncome,
                            manual_incomes: byPayment.Efectivo.manualIncome,
                            balance: byPayment.Efectivo.net
                        },
                        Transferencia: {
                            incomes: byPayment.Transferencia.income,
                            expenses: byPayment.Transferencia.expense,
                            sales: byPayment.Transferencia.salesIncome,
                            manual_incomes: byPayment.Transferencia.manualIncome,
                            balance: byPayment.Transferencia.net
                        },
                        Datáfono: {
                            incomes: byPayment.Datáfono.income,
                            expenses: byPayment.Datáfono.expense,
                            sales: byPayment.Datáfono.salesIncome,
                            manual_incomes: byPayment.Datáfono.manualIncome,
                            balance: byPayment.Datáfono.net
                        },
                        Otros: {
                            incomes: byPayment.Otros.income,
                            expenses: byPayment.Otros.expense,
                            sales: byPayment.Otros.salesIncome,
                            manual_incomes: byPayment.Otros.manualIncome,
                            balance: byPayment.Otros.net
                        }
                    };

                    res.json({
                        summary: {
                            total_income: totalIncome,
                            total_incomes: totalIncome,
                            total_expense: totalExpense,
                            total_expenses: totalExpense,
                            net_cashflow: netCashflow,
                            net: netCashflow,
                            automatic_sales: automaticSales,
                            sales_total: automaticSales,
                            automatic_expenses: automaticExpenses,
                            orders_count: orderRows.length,
                            expenses_count: gastoRows.length,
                            manual_count: manualRows.length,
                            total_transactions: allMovements.length,
                            by_payment: byPayment,
                            by_payment_method: byPaymentMethod
                        },
                        movements: allMovements,
                        transactions: allMovements
                    });
                });
            });
        });
    });

    // =========================================================================
    // 2. MOVIMIENTOS MANUALES (POST & DELETE)
    // =========================================================================
    router.post('/cashflow/movement', verifyToken, (req, res) => {
        const { type, concept, category_id, category_name, account_id, payment_method, amount, notes } = req.body;

        if (!type || (type !== 'INCOME' && type !== 'EXPENSE')) {
            return res.status(400).json({ error: 'Tipo de movimiento inválido (INCOME o EXPENSE)' });
        }
        if (!concept || !concept.trim()) {
            return res.status(400).json({ error: 'El concepto es obligatorio' });
        }
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
        }

        const id = uuidv4();
        const pm = payment_method || 'Efectivo';
        const user = req.user?.name || 'Admin';

        // Obtener nombre de cuenta si se pasó account_id
        const findAccountSql = account_id ? "SELECT name FROM finance_accounts WHERE id = ?" : null;
        const findCatSql = category_id ? "SELECT name FROM finance_categories WHERE id = ?" : null;

        const processInsert = (accName, catName) => {
            const sql = `
                INSERT INTO cash_movements (
                    id, type, concept, category_id, category_name, account_id, account_name, payment_method, amount, notes, user_name
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(sql, [
                id,
                type,
                concept.trim(),
                category_id || null,
                catName || category_name || null,
                account_id || null,
                accName || null,
                pm,
                parsedAmount,
                notes || '',
                user
            ], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Actualizar saldo de la cuenta si está vinculada
                if (account_id) {
                    const balanceDiff = type === 'INCOME' ? parsedAmount : -parsedAmount;
                    db.run("UPDATE finance_accounts SET current_balance = current_balance + ? WHERE id = ?", [balanceDiff, account_id]);
                }

                notifyCashflow('movement_created', { id, type });

                res.status(201).json({
                    message: 'Movimiento registrado con éxito',
                    movement: { id, type, concept: concept.trim(), category_name: catName, payment_method: pm, amount: parsedAmount }
                });
            });
        };

        if (account_id) {
            db.get(findAccountSql, [account_id], (accErr, accRow) => {
                const accName = accRow ? accRow.name : null;
                if (category_id) {
                    db.get(findCatSql, [category_id], (catErr, catRow) => {
                        processInsert(accName, catRow ? catRow.name : null);
                    });
                } else {
                    processInsert(accName, category_name);
                }
            });
        } else if (category_id) {
            db.get(findCatSql, [category_id], (catErr, catRow) => {
                processInsert(null, catRow ? catRow.name : null);
            });
        } else {
            processInsert(null, category_name);
        }
    });

    router.delete('/cashflow/movement/:id', verifyToken, (req, res) => {
        const { id } = req.params;

        db.get('SELECT * FROM cash_movements WHERE id = ?', [id], (findErr, movement) => {
            if (findErr) return res.status(500).json({ error: findErr.message });
            if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado' });

            db.run('DELETE FROM cash_movements WHERE id = ?', [id], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                // Revertir saldo en la cuenta asociada si existía
                if (movement.account_id) {
                    const reverseDiff = movement.type === 'INCOME' ? -movement.amount : movement.amount;
                    db.run("UPDATE finance_accounts SET current_balance = current_balance + ? WHERE id = ?", [reverseDiff, movement.account_id]);
                }

                notifyCashflow('movement_deleted', { id });
                res.json({ message: 'Movimiento eliminado con éxito' });
            });
        });
    });

    // =========================================================================
    // 3. CUENTAS / FONDOS (FINANCE ACCOUNTS)
    // =========================================================================
    router.get('/cashflow/accounts', verifyToken, (req, res) => {
        const { type, active } = req.query;
        let sql = "SELECT * FROM finance_accounts WHERE 1=1";
        const params = [];

        if (type && type !== 'all') {
            sql += " AND type = ?";
            params.push(type);
        }
        if (active !== undefined && active !== '') {
            sql += " AND is_active = ?";
            params.push(active === 'true' || active === '1' ? 1 : 0);
        }

        sql += " ORDER BY type ASC, name ASC";

        db.all(sql, params, (err, accounts) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!accounts || accounts.length === 0) return res.json([]);

            // Calcular saldo real acumulado considerando:
            // 1. Pedidos en estado 'Cobrado' por método de pago y cuentas destino
            // 2. Gastos registrados directos
            // 3. Movimientos manuales de flujo de caja
            // 4. Abonos y pagos de CxP / CxC
            db.all("SELECT id, total, payment, status, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details FROM orders WHERE status = 'Cobrado'", [], (oErr, orders) => {
                db.all("SELECT account_id, type, amount FROM cash_movements", [], (mErr, movements) => {
                    db.all("SELECT account_id, type, amount FROM finance_payments", [], (pErr, payments) => {
                        db.all("SELECT valor as amount, 'Efectivo' as payment_method FROM gastos_dia", [], (gErr, gastos) => {
                            const safeOrders = orders || [];
                            const safeMovements = movements || [];
                            const safePayments = payments || [];
                            const safeGastos = gastos || [];

                            // Cuentas predeterminadas activas por tipo de fondo
                            const efectivoAcc = accounts.find(a => a.type === 'Efectivo' && a.is_active === 1) || accounts.find(a => a.type === 'Efectivo');
                            const datafonoAcc = accounts.find(a => a.type === 'Datáfono' && a.is_active === 1) || accounts.find(a => a.type === 'Datáfono');
                            const transferAcc = accounts.find(a => a.type === 'Transferencia' && a.is_active === 1) || accounts.find(a => a.type === 'Transferencia');
                            const nequiAcc = accounts.find(a => a.name.toLowerCase().includes('nequi') || (a.bank_name && a.bank_name.toLowerCase().includes('nequi')));

                            const enriched = accounts.map(acc => {
                                let bal = parseFloat(acc.initial_balance) || 0;

                                // 1. Sumar ventas cobradas dirigiendo a las cuentas seleccionadas
                                safeOrders.forEach(o => {
                                    const pm = (o.payment || 'Efectivo').toLowerCase();
                                    const tot = parseFloat(o.total) || 0;
                                    const isMixed = o.payment === 'Mixto' || pm === 'mixto';

                                    let splits = null;
                                    if (o.payment_details) {
                                        try {
                                            const pd = typeof o.payment_details === 'string' ? JSON.parse(o.payment_details) : o.payment_details;
                                            if (pd && Array.isArray(pd.splits) && pd.splits.length > 0) {
                                                splits = pd.splits;
                                            }
                                        } catch (_) {}
                                    }

                                    if (splits) {
                                        splits.forEach(s => {
                                            const sAmt = parseFloat(s.amount) || 0;
                                            if (sAmt <= 0) return;
                                            const sMethod = (s.method || 'Efectivo').toLowerCase();
                                            const sAccId = s.account_id ? parseInt(s.account_id, 10) : null;
                                            if (sAccId && acc.id === sAccId) {
                                                bal += sAmt;
                                            } else if (!sAccId) {
                                                if (sMethod.includes('efectivo') && efectivoAcc && acc.id === efectivoAcc.id) {
                                                    bal += sAmt;
                                                } else if ((sMethod.includes('dat') || sMethod.includes('tarjeta') || sMethod.includes('bold') || sMethod.includes('redeban')) && datafonoAcc && acc.id === datafonoAcc.id) {
                                                    bal += sAmt;
                                                } else if ((sMethod.includes('nequi') || sMethod.includes('daviplata')) && nequiAcc && acc.id === nequiAcc.id) {
                                                    bal += sAmt;
                                                } else if (transferAcc && acc.id === transferAcc.id) {
                                                    bal += sAmt;
                                                } else if (efectivoAcc && acc.id === efectivoAcc.id) {
                                                    bal += sAmt;
                                                }
                                            }
                                        });
                                    } else if (isMixed) {
                                        const cashPart = parseFloat(o.cash_amount) || 0;
                                        const transferPart = parseFloat(o.transfer_amount) || Math.max(0, tot - cashPart);

                                        // Parte Efectivo -> cuenta seleccionada o caja activa
                                        if (cashPart > 0) {
                                            if (o.cash_account_id && acc.id === o.cash_account_id) {
                                                bal += cashPart;
                                            } else if (!o.cash_account_id && efectivoAcc && acc.id === efectivoAcc.id) {
                                                bal += cashPart;
                                            }
                                        }

                                        // Parte Transferencia -> cuenta seleccionada o banco activo
                                        if (transferPart > 0) {
                                            if (o.transfer_account_id && acc.id === o.transfer_account_id) {
                                                bal += transferPart;
                                            } else if (!o.transfer_account_id && transferAcc && acc.id === transferAcc.id) {
                                                bal += transferPart;
                                            }
                                        }
                                    } else {
                                        // Pago Simple: Si el usuario seleccionó una cuenta destino específica, va directo a esa cuenta
                                        if (o.account_id && acc.id === o.account_id) {
                                            bal += tot;
                                        } else if (!o.account_id) {
                                            // Fallback por tipo de método
                                            if (pm === 'efectivo') {
                                                if (efectivoAcc && acc.id === efectivoAcc.id) bal += tot;
                                            } else if (pm.includes('dat') || pm.includes('tarjeta') || pm.includes('bold') || pm.includes('redeban')) {
                                                if (datafonoAcc && acc.id === datafonoAcc.id) bal += tot;
                                            } else if (pm.includes('nequi') || pm.includes('daviplata')) {
                                                if (nequiAcc && acc.id === nequiAcc.id) bal += tot;
                                                else if (transferAcc && acc.id === transferAcc.id) bal += tot;
                                            } else {
                                                if (transferAcc && acc.id === transferAcc.id) bal += tot;
                                                else if (efectivoAcc && acc.id === efectivoAcc.id) bal += tot;
                                            }
                                        }
                                    }
                                });

                                // 2. Restar gastos registrados
                                safeGastos.forEach(g => {
                                    const pm = (g.payment_method || 'Efectivo').toLowerCase();
                                    const amt = parseFloat(g.amount) || 0;
                                    if (pm === 'efectivo' && efectivoAcc && acc.id === efectivoAcc.id) {
                                        bal -= amt;
                                    } else if ((pm.includes('dat') || pm.includes('tarjeta')) && datafonoAcc && acc.id === datafonoAcc.id) {
                                        bal -= amt;
                                    } else if (transferAcc && acc.id === transferAcc.id) {
                                        bal -= amt;
                                    }
                                });

                                // 3. Movimientos manuales de flujo
                                safeMovements.forEach(m => {
                                    if (m.account_id === acc.id) {
                                        const amt = parseFloat(m.amount) || 0;
                                        if (m.type === 'INCOME') bal += amt;
                                        else if (m.type === 'EXPENSE') bal -= amt;
                                    }
                                });

                                // 4. Pagos y Cobros (CxP / CxC)
                                safePayments.forEach(p => {
                                    if (p.account_id === acc.id) {
                                        const amt = parseFloat(p.amount) || 0;
                                        if (p.type === 'RECEIVABLE') bal += amt;
                                        else if (p.type === 'PAYABLE') bal -= amt;
                                    }
                                });

                                return {
                                    ...acc,
                                    current_balance: bal
                                };
                            });

                            res.json(enriched);
                        });
                    });
                });
            });
        });
    });

    router.post('/cashflow/accounts', verifyToken, (req, res) => {
        const { name, type, account_number, bank_name, initial_balance, description } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio' });
        }
        const accType = type || 'Efectivo';
        const initBal = parseFloat(initial_balance) || 0;

        const sql = `
            INSERT INTO finance_accounts (name, type, account_number, bank_name, initial_balance, current_balance, description, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `;

        db.run(sql, [name.trim(), accType, account_number || '', bank_name || '', initBal, initBal, description || ''], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('account_created', { id: this.lastID });
            res.status(201).json({ id: this.lastID, message: 'Cuenta creada con éxito' });
        });
    });

    router.put('/cashflow/accounts/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const { name, type, account_number, bank_name, description, is_active } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre es obligatorio' });
        }

        const sql = `
            UPDATE finance_accounts
            SET name = ?, type = ?, account_number = ?, bank_name = ?, description = ?, is_active = ?
            WHERE id = ?
        `;

        db.run(sql, [name.trim(), type || 'Efectivo', account_number || '', bank_name || '', description || '', is_active !== undefined ? (is_active ? 1 : 0) : 1, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('account_updated', { id });
            res.json({ message: 'Cuenta actualizada con éxito' });
        });
    });

    // Desactivar / Reactivar cuenta
    router.patch('/cashflow/accounts/:id/toggle', verifyToken, (req, res) => {
        const { id } = req.params;
        db.get("SELECT is_active FROM finance_accounts WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Cuenta no encontrada' });
            const newStatus = row.is_active === 1 ? 0 : 1;
            db.run("UPDATE finance_accounts SET is_active = ? WHERE id = ?", [newStatus, id], function (updErr) {
                if (updErr) return res.status(500).json({ error: updErr.message });
                notifyCashflow('account_updated', { id });
                res.json({ message: newStatus === 1 ? 'Cuenta activada' : 'Cuenta desactivada', is_active: newStatus });
            });
        });
    });

    // Eliminar cuenta permanentemente (solo si no tiene movimientos asociados)
    router.delete('/cashflow/accounts/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.get(`
            SELECT 
                (SELECT COUNT(*) FROM cash_movements WHERE account_id = ?) +
                (SELECT COUNT(*) FROM finance_payments WHERE account_id = ?) AS total_usage
        `, [id, id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            const usage = row ? (row.total_usage || 0) : 0;
            if (usage > 0) {
                return res.status(400).json({ 
                    error: `No es posible eliminar esta cuenta porque tiene ${usage} movimiento(s) o transacciones registradas. Puedes desactivarla para mantener el historial contable intacto.` 
                });
            }
            db.run("DELETE FROM finance_accounts WHERE id = ?", [id], function (delErr) {
                if (delErr) return res.status(500).json({ error: delErr.message });
                notifyCashflow('account_deleted', { id });
                res.json({ message: 'Cuenta eliminada con éxito' });
            });
        });
    });

    // Transferencia entre cuentas
    router.post('/cashflow/accounts/transfer', verifyToken, (req, res) => {
        const { from_account_id, to_account_id, amount, notes } = req.body;
        const parsedAmount = parseFloat(amount);

        if (!from_account_id || !to_account_id) {
            return res.status(400).json({ error: 'Debes seleccionar cuenta origen y destino' });
        }
        if (from_account_id === to_account_id) {
            return res.status(400).json({ error: 'Las cuentas origen y destino deben ser distintas' });
        }
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }

        db.get("SELECT name FROM finance_accounts WHERE id = ?", [from_account_id], (errFrom, rowFrom) => {
            if (!rowFrom) return res.status(404).json({ error: 'Cuenta de origen no encontrada' });
            db.get("SELECT name FROM finance_accounts WHERE id = ?", [to_account_id], (errTo, rowTo) => {
                if (!rowTo) return res.status(404).json({ error: 'Cuenta de destino no encontrada' });

                const user = req.user?.name || 'Admin';
                const idOut = uuidv4();
                const idIn = uuidv4();

                db.run("UPDATE finance_accounts SET current_balance = current_balance - ? WHERE id = ?", [parsedAmount, from_account_id]);
                db.run("UPDATE finance_accounts SET current_balance = current_balance + ? WHERE id = ?", [parsedAmount, to_account_id]);

                // Registrar movimientos
                const insertSql = `
                    INSERT INTO cash_movements (id, type, concept, account_id, account_name, payment_method, amount, notes, user_name)
                    VALUES (?, ?, ?, ?, ?, 'Transferencia', ?, ?, ?)
                `;

                db.run(insertSql, [idOut, 'EXPENSE', `Transferencia hacia: ${rowTo.name}`, from_account_id, rowFrom.name, parsedAmount, notes || '', user]);
                db.run(insertSql, [idIn, 'INCOME', `Transferencia desde: ${rowFrom.name}`, to_account_id, rowTo.name, parsedAmount, notes || '', user], (insErr) => {
                    if (insErr) return res.status(500).json({ error: insErr.message });
                    notifyCashflow('transfer_completed');
                    res.json({ message: 'Transferencia realizada con éxito' });
                });
            });
        });
    });

    // =========================================================================
    // 4. CATEGORÍAS DE FLUJO DE CAJA (CATEGORIES)
    // =========================================================================
    router.get('/cashflow/categories', verifyToken, (req, res) => {
        const { type } = req.query;
        let sql = "SELECT * FROM finance_categories WHERE 1=1";
        const params = [];

        if (type && (type === 'INCOME' || type === 'EXPENSE')) {
            sql += " AND type = ?";
            params.push(type);
        }

        sql += " ORDER BY type ASC, name ASC";

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    router.post('/cashflow/categories', verifyToken, (req, res) => {
        const { name, type, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
        if (!type || (type !== 'INCOME' && type !== 'EXPENSE')) {
            return res.status(400).json({ error: 'El tipo debe ser INCOME o EXPENSE' });
        }

        const sql = "INSERT INTO finance_categories (name, type, description) VALUES (?, ?, ?)";
        db.run(sql, [name.trim(), type, description || ''], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('category_created', { id: this.lastID });
            res.status(201).json({ id: this.lastID, message: 'Categoría creada con éxito' });
        });
    });

    router.put('/cashflow/categories/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        const { name, description } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

        const sql = "UPDATE finance_categories SET name = ?, description = ? WHERE id = ?";
        db.run(sql, [name.trim(), description || '', id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('category_updated', { id });
            res.json({ message: 'Categoría actualizada con éxito' });
        });
    });

    router.delete('/cashflow/categories/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.get("SELECT is_default FROM finance_categories WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Categoría no encontrada' });
            if (row.is_default === 1) {
                return res.status(400).json({ error: 'No se pueden eliminar las categorías base del sistema' });
            }
            db.get(`
                SELECT 
                    (SELECT COUNT(*) FROM cash_movements WHERE category_id = ?) +
                    (SELECT COUNT(*) FROM finance_payables WHERE category_id = ?) +
                    (SELECT COUNT(*) FROM finance_receivables WHERE category_id = ?) AS total_usage
            `, [id, id, id], (uErr, uRow) => {
                if (uErr) return res.status(500).json({ error: uErr.message });
                const usage = uRow ? (uRow.total_usage || 0) : 0;
                if (usage > 0) {
                    return res.status(400).json({ 
                        error: `No es posible eliminar esta categoría porque está vinculada a ${usage} movimiento(s) o registros financieros.` 
                    });
                }
                db.run("DELETE FROM finance_categories WHERE id = ?", [id], function (delErr) {
                    if (delErr) return res.status(500).json({ error: delErr.message });
                    notifyCashflow('category_deleted', { id });
                    res.json({ message: 'Categoría eliminada con éxito' });
                });
            });
        });
    });

    // =========================================================================
    // 5. CUENTAS POR PAGAR (CxP)
    // =========================================================================
    router.get('/cashflow/payables', verifyToken, (req, res) => {
        const { status } = req.query;

        // Auto-actualizar deudas vencidas
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        db.run("UPDATE finance_payables SET status = 'Vencido' WHERE status = 'Pendiente' AND due_date < ?", [today]);

        let sql = `
            SELECT p.*, c.name as category_name
            FROM finance_payables p
            LEFT JOIN finance_categories c ON p.category_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            sql += " AND p.status = ?";
            params.push(status);
        }

        sql += " ORDER BY p.due_date ASC, p.id DESC";

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    router.post('/cashflow/payables', verifyToken, (req, res) => {
        const { supplier_name, concept, invoice_number, original_amount, due_date, category_id, notes } = req.body;
        const amount = parseFloat(original_amount);

        if (!supplier_name || !supplier_name.trim()) return res.status(400).json({ error: 'El proveedor/acreedor es obligatorio' });
        if (!concept || !concept.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
        if (!due_date) return res.status(400).json({ error: 'La fecha límite de pago es obligatoria' });

        const sql = `
            INSERT INTO finance_payables (supplier_name, concept, invoice_number, original_amount, balance_pending, due_date, status, category_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
        `;

        db.run(sql, [supplier_name.trim(), concept.trim(), invoice_number || '', amount, amount, due_date, category_id || null, notes || ''], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('payable_created', { id: this.lastID });
            res.status(201).json({ id: this.lastID, message: 'Cuenta por pagar registrada con éxito' });
        });
    });

    router.post('/cashflow/payables/:id/pay', verifyToken, (req, res) => {
        const { id } = req.params;
        const { amount, account_id, payment_method, notes } = req.body;
        const payAmount = parseFloat(amount);

        if (isNaN(payAmount) || payAmount <= 0) return res.status(400).json({ error: 'Monto de pago inválido' });

        db.get("SELECT * FROM finance_payables WHERE id = ?", [id], (err, payable) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!payable) return res.status(404).json({ error: 'Cuenta por pagar no encontrada' });
            if (payable.status === 'Pagado') return res.status(400).json({ error: 'Esta cuenta ya está totalmente pagada' });

            const newBalance = Math.max(0, payable.balance_pending - payAmount);
            const newStatus = newBalance <= 0 ? 'Pagado' : payable.status;
            const pm = payment_method || 'Efectivo';
            const user = req.user?.name || 'Admin';

            // Actualizar cuenta por pagar
            db.run("UPDATE finance_payables SET balance_pending = ?, status = ? WHERE id = ?", [newBalance, newStatus, id]);

            // Obtener nombre de cuenta si existe
            const findAcc = account_id ? "SELECT name FROM finance_accounts WHERE id = ?" : null;
            const recordPayment = (accName) => {
                // Registrar egreso en cash_movements
                const moveId = uuidv4();
                const moveSql = `
                    INSERT INTO cash_movements (
                        id, type, concept, category_name, account_id, account_name, payment_method, amount, notes, user_name, payable_id
                    )
                    VALUES (?, 'EXPENSE', ?, 'Pago Proveedor (CxP)', ?, ?, ?, ?, ?, ?, ?)
                `;
                const conceptTxt = `Pago CxP: ${payable.supplier_name} - ${payable.concept}`;

                db.run(moveSql, [moveId, conceptTxt, account_id || null, accName || pm, pm, payAmount, notes || '', user, id]);

                // Descontar saldo de la cuenta de fondos
                if (account_id) {
                    db.run("UPDATE finance_accounts SET current_balance = current_balance - ? WHERE id = ?", [payAmount, account_id]);
                }

                // Registrar en historial de pagos
                db.run(`
                    INSERT INTO finance_payments (payable_id, type, amount, account_id, account_name, payment_method, notes, user_name)
                    VALUES (?, 'PAYABLE', ?, ?, ?, ?, ?, ?)
                `, [id, payAmount, account_id || null, accName || pm, pm, notes || '', user]);

                notifyCashflow('payable_paid', { id, newBalance, newStatus });
                res.json({ message: 'Pago registrado con éxito', balance_pending: newBalance, status: newStatus });
            };

            if (account_id) {
                db.get(findAcc, [account_id], (accErr, accRow) => {
                    recordPayment(accRow ? accRow.name : null);
                });
            } else {
                recordPayment(null);
            }
        });
    });

    router.delete('/cashflow/payables/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM finance_payables WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('payable_deleted', { id });
            res.json({ message: 'Cuenta por pagar eliminada con éxito' });
        });
    });

    // =========================================================================
    // 6. CUENTAS POR COBRAR (CxC)
    // =========================================================================
    router.get('/cashflow/receivables', verifyToken, (req, res) => {
        const { status } = req.query;

        // Auto-actualizar cobros vencidos
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        db.run("UPDATE finance_receivables SET status = 'Vencido' WHERE status = 'Pendiente' AND due_date < ?", [today]);

        let sql = `
            SELECT r.*, c.name as category_name
            FROM finance_receivables r
            LEFT JOIN finance_categories c ON r.category_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'all') {
            sql += " AND r.status = ?";
            params.push(status);
        }

        sql += " ORDER BY r.due_date ASC, r.id DESC";

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    router.post('/cashflow/receivables', verifyToken, (req, res) => {
        const { client_name, concept, invoice_number, original_amount, due_date, category_id, notes } = req.body;
        const amount = parseFloat(original_amount);

        if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'El cliente/deudor es obligatorio' });
        if (!concept || !concept.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
        if (!due_date) return res.status(400).json({ error: 'La fecha límite de cobro es obligatoria' });

        const sql = `
            INSERT INTO finance_receivables (client_name, concept, invoice_number, original_amount, balance_pending, due_date, status, category_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?)
        `;

        db.run(sql, [client_name.trim(), concept.trim(), invoice_number || '', amount, amount, due_date, category_id || null, notes || ''], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('receivable_created', { id: this.lastID });
            res.status(201).json({ id: this.lastID, message: 'Cuenta por cobrar registrada con éxito' });
        });
    });

    router.post('/cashflow/receivables/:id/collect', verifyToken, (req, res) => {
        const { id } = req.params;
        const { amount, account_id, payment_method, notes } = req.body;
        const collectAmount = parseFloat(amount);

        if (isNaN(collectAmount) || collectAmount <= 0) return res.status(400).json({ error: 'Monto de recaudo inválido' });

        db.get("SELECT * FROM finance_receivables WHERE id = ?", [id], (err, receivable) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!receivable) return res.status(404).json({ error: 'Cuenta por cobrar no encontrada' });
            if (receivable.status === 'Cobrado') return res.status(400).json({ error: 'Esta cuenta ya está totalmente cobrada' });

            const newBalance = Math.max(0, receivable.balance_pending - collectAmount);
            const newStatus = newBalance <= 0 ? 'Cobrado' : receivable.status;
            const pm = payment_method || 'Efectivo';
            const user = req.user?.name || 'Admin';

            // Actualizar cuenta por cobrar
            db.run("UPDATE finance_receivables SET balance_pending = ?, status = ? WHERE id = ?", [newBalance, newStatus, id]);

            const findAcc = account_id ? "SELECT name FROM finance_accounts WHERE id = ?" : null;
            const recordCollection = (accName) => {
                // Registrar ingreso en cash_movements
                const moveId = uuidv4();
                const moveSql = `
                    INSERT INTO cash_movements (
                        id, type, concept, category_name, account_id, account_name, payment_method, amount, notes, user_name, receivable_id
                    )
                    VALUES (?, 'INCOME', ?, 'Abono Cliente (CxC)', ?, ?, ?, ?, ?, ?, ?)
                `;
                const conceptTxt = `Recaudo CxC: ${receivable.client_name} - ${receivable.concept}`;

                db.run(moveSql, [moveId, conceptTxt, account_id || null, accName || pm, pm, collectAmount, notes || '', user, id]);

                // Sumar saldo a la cuenta de fondos
                if (account_id) {
                    db.run("UPDATE finance_accounts SET current_balance = current_balance + ? WHERE id = ?", [collectAmount, account_id]);
                }

                // Registrar en historial de pagos
                db.run(`
                    INSERT INTO finance_payments (receivable_id, type, amount, account_id, account_name, payment_method, notes, user_name)
                    VALUES (?, 'RECEIVABLE', ?, ?, ?, ?, ?, ?)
                `, [id, collectAmount, account_id || null, accName || pm, pm, notes || '', user]);

                notifyCashflow('receivable_collected', { id, newBalance, newStatus });
                res.json({ message: 'Recaudo registrado con éxito', balance_pending: newBalance, status: newStatus });
            };

            if (account_id) {
                db.get(findAcc, [account_id], (accErr, accRow) => {
                    recordCollection(accRow ? accRow.name : null);
                });
            } else {
                recordCollection(null);
            }
        });
    });

    router.delete('/cashflow/receivables/:id', verifyToken, (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM finance_receivables WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('receivable_deleted', { id });
            res.json({ message: 'Cuenta por cobrar eliminada con éxito' });
        });
    });

    return router;
};
