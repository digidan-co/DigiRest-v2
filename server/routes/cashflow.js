const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireRole } = require('./auth');

module.exports = (io) => {
    const notifyCashflow = (type, data = {}) => {
        if (io) {
            io.to('admin').emit('cashflow_updated', { type, ...data });
            io.to('cajero').emit('cashflow_updated', { type, ...data });
        }
    };

    // Helper para verificar y obtener IDs de cuentas permitidas para roles operativos (cajero/supervisor)
    const getUserAllowedAccounts = (userId, userRole, callback) => {
        if (userRole === 'admin') {
            return callback(null, 'ALL');
        }
        if (!userId) {
            return callback(null, []);
        }
        db.get("SELECT role, allowed_finance_accounts FROM users WHERE id = ?", [userId], (err, row) => {
            if (err || !row) return callback(err, []);
            if (row.role === 'admin') return callback(null, 'ALL');
            let allowed = [];
            if (row.allowed_finance_accounts) {
                try {
                    const parsed = JSON.parse(row.allowed_finance_accounts);
                    if (Array.isArray(parsed)) {
                        allowed = parsed.map(x => parseInt(x, 10)).filter(x => !isNaN(x));
                    }
                } catch (e) {
                    console.error('Error parsing allowed_finance_accounts:', e);
                }
            }
            callback(null, allowed);
        });
    };

    // =========================================================================
    // 1. GET /api/cashflow - RESUMEN CONSOLIDADO Y MOVIMIENTOS
    // =========================================================================
    router.get('/cashflow', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { startDate, endDate, paymentMethod, accountId } = req.query;
        const userId = req.user?.id;
        const userRole = req.user?.role;

        getUserAllowedAccounts(userId, userRole, (userErr, allowedAccountIds) => {
            if (userErr) return res.status(500).json({ error: userErr.message });

            // Si es un rol no-admin y no tiene ninguna cuenta asignada, no revelar movimientos
            if (allowedAccountIds !== 'ALL' && (!allowedAccountIds || allowedAccountIds.length === 0)) {
                return res.json({
                    summary: { totalIngresos: 0, totalEgresos: 0, balanceNeto: 0, movimientosCount: 0 },
                    movements: [],
                    transactions: [],
                    pagination: { page: 1, limit: 100, total: 0, totalPages: 1 }
                });
            }

            if (allowedAccountIds !== 'ALL' && accountId && accountId !== 'all') {
                if (!allowedAccountIds.includes(parseInt(accountId, 10))) {
                    return res.json({
                        summary: { totalIngresos: 0, totalEgresos: 0, balanceNeto: 0, movimientosCount: 0 },
                        movements: [],
                        transactions: [],
                        pagination: { page: 1, limit: 100, total: 0, totalPages: 1 }
                    });
                }
            }

            let effStartDate = startDate;
            let effEndDate = endDate;
            if (userRole === 'cajero') {
                const todayStr = new Date(Date.now() - 5 * 3600 * 1000).toISOString().split('T')[0];
                effStartDate = todayStr;
                effEndDate = todayStr;
            }

            let orderDateFilter = "";
            let gastoDateFilter = "";
            let manualDateFilter = "";
            const orderParams = [];
            const gastoParams = [];
            const manualParams = [];

            if (effStartDate && effEndDate) {
                orderDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
                gastoDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
                manualDateFilter = " AND date(timestamp, '-5 hours') BETWEEN date(?) AND date(?)";
                orderParams.push(effStartDate, effEndDate);
                gastoParams.push(effStartDate, effEndDate);
                manualParams.push(effStartDate, effEndDate);
            } else if (effStartDate) {
                orderDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
                gastoDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
                manualDateFilter = " AND date(timestamp, '-5 hours') >= date(?)";
                orderParams.push(effStartDate);
                gastoParams.push(effStartDate);
                manualParams.push(effStartDate);
            } else if (effEndDate) {
                orderDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
                gastoDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
                manualDateFilter = " AND date(timestamp, '-5 hours') <= date(?)";
                orderParams.push(effEndDate);
                gastoParams.push(effEndDate);
                manualParams.push(effEndDate);
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
        } else if (allowedAccountIds !== 'ALL') {
            const placeholders = allowedAccountIds.map(() => '?').join(',');
            manualSql += ` AND (account_id IN (${placeholders}))`;
            manualParams.push(...allowedAccountIds);
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
    });

    // =========================================================================
    // 2. MOVIMIENTOS MANUALES (POST & DELETE)
    // =========================================================================
    router.post('/cashflow/movement', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

        getUserAllowedAccounts(req.user?.id, req.user?.role, (userErr, allowedAccountIds) => {
            if (userErr) return res.status(500).json({ error: userErr.message });
            if (account_id && allowedAccountIds !== 'ALL') {
                const parsedAccId = parseInt(account_id, 10);
                if (!allowedAccountIds.includes(parsedAccId)) {
                    return res.status(403).json({ error: 'No tienes permiso para registrar movimientos en la cuenta seleccionada.' });
                }
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
    });

    router.delete('/cashflow/movement/:id', verifyToken, requireRole(['admin']), (req, res) => {
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
    router.get('/cashflow/accounts', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { type, active } = req.query;
        const userId = req.user?.id;
        const userRole = req.user?.role;

        getUserAllowedAccounts(userId, userRole, (userErr, allowedAccountIds) => {
            if (userErr) return res.status(500).json({ error: userErr.message });

            // Privacidad estricta: roles no-admin sin cuentas asignadas no ven fondos
            if (allowedAccountIds !== 'ALL' && (!allowedAccountIds || allowedAccountIds.length === 0)) {
                return res.json([]);
            }

            let sql = "SELECT * FROM finance_accounts WHERE 1=1";
            const params = [];

            if (allowedAccountIds !== 'ALL') {
                const placeholders = allowedAccountIds.map(() => '?').join(',');
                sql += ` AND id IN (${placeholders})`;
                params.push(...allowedAccountIds);
            }

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

                const queryAll = (q, p = []) => new Promise((resolve, reject) => {
                    db.all(q, p, (qErr, rows) => qErr ? reject(qErr) : resolve(rows || []));
                });

                Promise.all([
                    queryAll(`
                        SELECT
                            COALESCE(payment, 'Efectivo') as payment,
                            account_id,
                            cash_account_id,
                            transfer_account_id,
                            SUM(COALESCE(total, 0)) as sum_total,
                            SUM(COALESCE(cash_amount, 0)) as sum_cash,
                            SUM(CASE WHEN COALESCE(transfer_amount, 0) != 0 THEN transfer_amount ELSE MAX(0, COALESCE(total, 0) - COALESCE(cash_amount, 0)) END) as sum_transfer
                        FROM orders
                        WHERE status = 'Cobrado' AND (payment_details IS NULL OR TRIM(payment_details) = '')
                        GROUP BY COALESCE(payment, 'Efectivo'), account_id, cash_account_id, transfer_account_id
                    `),
                    queryAll(`
                        SELECT total, payment, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details
                        FROM orders
                        WHERE status = 'Cobrado' AND payment_details IS NOT NULL AND TRIM(payment_details) != ''
                    `),
                    queryAll(`
                        SELECT account_id, type, SUM(COALESCE(amount, 0)) as total_amount
                        FROM cash_movements
                        WHERE account_id IS NOT NULL
                        GROUP BY account_id, type
                    `),
                    queryAll(`
                        SELECT account_id, type, SUM(COALESCE(amount, 0)) as total_amount
                        FROM finance_payments
                        WHERE account_id IS NOT NULL
                        GROUP BY account_id, type
                    `),
                    queryAll(`SELECT COALESCE(SUM(valor), 0) as total_gastos FROM gastos_dia`)
                ]).then(([groupedOrders, splitOrders, groupedMovements, groupedPayments, gastoSumRows]) => {
                    const efectivoAcc = accounts.find(a => a.type === 'Efectivo' && a.is_active === 1) || accounts.find(a => a.type === 'Efectivo');
                    const datafonoAcc = accounts.find(a => a.type === 'Datáfono' && a.is_active === 1) || accounts.find(a => a.type === 'Datáfono');
                    const transferAcc = accounts.find(a => a.type === 'Transferencia' && a.is_active === 1) || accounts.find(a => a.type === 'Transferencia');
                    const nequiAcc = accounts.find(a => a.name.toLowerCase().includes('nequi') || (a.bank_name && a.bank_name.toLowerCase().includes('nequi')));

                    const balMap = new Map();
                    accounts.forEach(a => balMap.set(a.id, parseFloat(a.initial_balance) || 0));
                    const addBal = (accId, delta) => {
                        if (!accId || !balMap.has(accId)) return;
                        balMap.set(accId, balMap.get(accId) + delta);
                    };

                    const routeStandardPayment = (pmRaw, accId, cashAccId, transferAccId, tot, cashPart, transferPart) => {
                        const pm = (pmRaw || 'Efectivo').toLowerCase();
                        if (pm === 'mixto') {
                            if (cashPart > 0) addBal(cashAccId || efectivoAcc?.id, cashPart);
                            if (transferPart > 0) addBal(transferAccId || transferAcc?.id, transferPart);
                        } else if (accId) {
                            addBal(accId, tot);
                        } else if (pm === 'efectivo') {
                            addBal(efectivoAcc?.id, tot);
                        } else if (pm.includes('dat') || pm.includes('tarjeta') || pm.includes('bold') || pm.includes('redeban')) {
                            addBal(datafonoAcc?.id, tot);
                        } else if (pm.includes('nequi') || pm.includes('daviplata')) {
                            addBal((nequiAcc || transferAcc)?.id, tot);
                        } else {
                            addBal((transferAcc || efectivoAcc)?.id, tot);
                        }
                    };

                    groupedOrders.forEach(g => {
                        routeStandardPayment(
                            g.payment,
                            g.account_id,
                            g.cash_account_id,
                            g.transfer_account_id,
                            parseFloat(g.sum_total) || 0,
                            parseFloat(g.sum_cash) || 0,
                            parseFloat(g.sum_transfer) || 0
                        );
                    });

                    splitOrders.forEach(o => {
                        let splits = null;
                        try {
                            const pd = typeof o.payment_details === 'string' ? JSON.parse(o.payment_details) : o.payment_details;
                            if (pd && Array.isArray(pd.splits) && pd.splits.length > 0) splits = pd.splits;
                        } catch (_) {}

                        if (splits) {
                            splits.forEach(s => {
                                const sAmt = parseFloat(s.amount) || 0;
                                if (sAmt <= 0) return;
                                const sMethod = (s.method || 'Efectivo').toLowerCase();
                                const sAccId = s.account_id ? parseInt(s.account_id, 10) : null;
                                if (sAccId) {
                                    addBal(sAccId, sAmt);
                                } else if (sMethod.includes('efectivo') && efectivoAcc) {
                                    addBal(efectivoAcc.id, sAmt);
                                } else if ((sMethod.includes('dat') || sMethod.includes('tarjeta') || sMethod.includes('bold') || sMethod.includes('redeban')) && datafonoAcc) {
                                    addBal(datafonoAcc.id, sAmt);
                                } else if ((sMethod.includes('nequi') || sMethod.includes('daviplata')) && nequiAcc) {
                                    addBal(nequiAcc.id, sAmt);
                                } else if (transferAcc) {
                                    addBal(transferAcc.id, sAmt);
                                } else if (efectivoAcc) {
                                    addBal(efectivoAcc.id, sAmt);
                                }
                            });
                        } else {
                            const tot = parseFloat(o.total) || 0;
                            const cPart = parseFloat(o.cash_amount) || 0;
                            const tPart = parseFloat(o.transfer_amount) || Math.max(0, tot - cPart);
                            routeStandardPayment(o.payment, o.account_id, o.cash_account_id, o.transfer_account_id, tot, cPart, tPart);
                        }
                    });

                    const totalGastos = parseFloat(gastoSumRows[0]?.total_gastos) || 0;
                    if (totalGastos > 0 && efectivoAcc) {
                        addBal(efectivoAcc.id, -totalGastos);
                    }

                    groupedMovements.forEach(m => {
                        const amt = parseFloat(m.total_amount) || 0;
                        if (m.type === 'INCOME') addBal(m.account_id, amt);
                        else if (m.type === 'EXPENSE') addBal(m.account_id, -amt);
                    });

                    groupedPayments.forEach(p => {
                        const amt = parseFloat(p.total_amount) || 0;
                        if (p.type === 'RECEIVABLE') addBal(p.account_id, amt);
                        else if (p.type === 'PAYABLE') addBal(p.account_id, -amt);
                    });

                    const enriched = accounts.map(acc => ({
                        ...acc,
                        current_balance: balMap.get(acc.id) ?? (parseFloat(acc.initial_balance) || 0)
                    }));

                    res.json(enriched);
                }).catch(calcErr => {
                    res.status(500).json({ error: calcErr.message });
                });
            });
        });
    });

    router.post('/cashflow/accounts', verifyToken, requireRole(['admin']), (req, res) => {
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

    router.put('/cashflow/accounts/:id', verifyToken, requireRole(['admin']), (req, res) => {
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
    router.patch('/cashflow/accounts/:id/toggle', verifyToken, requireRole(['admin']), (req, res) => {
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
    router.delete('/cashflow/accounts/:id', verifyToken, requireRole(['admin']), (req, res) => {
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

    // Conciliación Bancaria / Ajuste de Saldo de Cuenta (Solo Admin)
    router.post('/cashflow/accounts/:id/reconcile', verifyToken, requireRole(['admin']), (req, res) => {
        const { id } = req.params;
        const { new_balance, reason } = req.body;
        const parsedNewBalance = parseFloat(new_balance);

        if (isNaN(parsedNewBalance)) {
            return res.status(400).json({ error: 'Debes proporcionar un saldo real numérico válido' });
        }

        db.get("SELECT * FROM finance_accounts WHERE id = ?", [id], (err, account) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!account) return res.status(404).json({ error: 'Cuenta no encontrada' });

            const oldBalance = parseFloat(account.current_balance) || 0;
            const diff = parsedNewBalance - oldBalance;
            const user = req.user?.name || 'Administrador';

            if (Math.abs(diff) < 0.0001) {
                return res.json({ 
                    message: 'El saldo ingresado es idéntico al saldo actual de la cuenta. No requiere ajuste.',
                    current_balance: oldBalance
                });
            }

            // Actualizar el saldo directo de la cuenta
            db.run("UPDATE finance_accounts SET current_balance = ? WHERE id = ?", [parsedNewBalance, id], function (updErr) {
                if (updErr) return res.status(500).json({ error: updErr.message });

                // Registrar movimiento de auditoría contable (Conciliación)
                const moveId = uuidv4();
                const isPositive = diff > 0;
                const moveType = isPositive ? 'INCOME' : 'EXPENSE';
                const moveAmount = Math.abs(diff);
                const concept = isPositive 
                    ? `Conciliación (+ Sobrante): ${account.name}` 
                    : `Conciliación (- Faltante): ${account.name}`;
                const noteText = reason && reason.trim() 
                    ? reason.trim() 
                    : `Ajuste de saldo de $${oldBalance.toLocaleString('es-CO')} a $${parsedNewBalance.toLocaleString('es-CO')}`;

                const insertSql = `
                    INSERT INTO cash_movements (
                        id, type, concept, category_name, account_id, account_name, payment_method, amount, notes, user_name
                    )
                    VALUES (?, ?, ?, 'Conciliación / Ajuste', ?, ?, ?, ?, ?, ?)
                `;

                db.run(insertSql, [
                    moveId,
                    moveType,
                    concept,
                    id,
                    account.name,
                    account.type || 'Efectivo',
                    moveAmount,
                    noteText,
                    user
                ], (insErr) => {
                    if (insErr) {
                        console.error('Error al registrar movimiento de conciliación:', insErr);
                    }
                    notifyCashflow('account_reconciled', { id, newBalance: parsedNewBalance, diff });
                    res.json({
                        message: 'Saldo ajustado y conciliado exitosamente',
                        previous_balance: oldBalance,
                        new_balance: parsedNewBalance,
                        difference: diff
                    });
                });
            });
        });
    });

    // Transferencia entre cuentas
    router.post('/cashflow/accounts/transfer', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

        getUserAllowedAccounts(req.user?.id, req.user?.role, (allowErr, allowedAccountIds) => {
            if (allowErr) return res.status(500).json({ error: allowErr.message });

            if (allowedAccountIds !== 'ALL') {
                const fromIdNum = Number(from_account_id);
                const toIdNum = Number(to_account_id);
                if (!allowedAccountIds.includes(fromIdNum) || !allowedAccountIds.includes(toIdNum)) {
                    return res.status(403).json({ error: 'No tienes permiso para transferir fondos desde o hacia una de estas cuentas' });
                }
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
    });

    // =========================================================================
    // 4. CATEGORÍAS DE FLUJO DE CAJA (CATEGORIES)
    // =========================================================================
    router.get('/cashflow/categories', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.post('/cashflow/categories', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.put('/cashflow/categories/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.delete('/cashflow/categories/:id', verifyToken, requireRole(['admin']), (req, res) => {
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
    router.get('/cashflow/payables', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.post('/cashflow/payables', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.post('/cashflow/payables/:id/pay', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        const { amount, account_id, payment_method, notes } = req.body;
        const payAmount = parseFloat(amount);

        if (isNaN(payAmount) || payAmount <= 0) return res.status(400).json({ error: 'Monto de pago inválido' });

        getUserAllowedAccounts(req.user?.id, req.user?.role, (allowErr, allowedAccountIds) => {
            if (allowErr) return res.status(500).json({ error: allowErr.message });
            if (account_id && allowedAccountIds !== 'ALL' && !allowedAccountIds.includes(Number(account_id))) {
                return res.status(403).json({ error: 'No tienes permiso para operar sobre esta cuenta' });
            }

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
});

    router.delete('/cashflow/payables/:id', verifyToken, requireRole(['admin']), (req, res) => {
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
    router.get('/cashflow/receivables', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.post('/cashflow/receivables', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
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

    router.post('/cashflow/receivables/:id/collect', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        const { amount, account_id, payment_method, notes } = req.body;
        const collectAmount = parseFloat(amount);

        if (isNaN(collectAmount) || collectAmount <= 0) return res.status(400).json({ error: 'Monto de recaudo inválido' });

        getUserAllowedAccounts(req.user?.id, req.user?.role, (allowErr, allowedAccountIds) => {
            if (allowErr) return res.status(500).json({ error: allowErr.message });
            if (account_id && allowedAccountIds !== 'ALL' && !allowedAccountIds.includes(Number(account_id))) {
                return res.status(403).json({ error: 'No tienes permiso para operar sobre esta cuenta' });
            }

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
});

    router.delete('/cashflow/receivables/:id', verifyToken, requireRole(['admin']), (req, res) => {
        const { id } = req.params;
        db.run("DELETE FROM finance_receivables WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            notifyCashflow('receivable_deleted', { id });
            res.json({ message: 'Cuenta por cobrar eliminada con éxito' });
        });
    });

    return router;
};
