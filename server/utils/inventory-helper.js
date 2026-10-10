const db = require('../db');

const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows || [])));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (err) { err ? rej(err) : res(this); }));

/**
 * Descuenta los insumos y toppings de una lista específica de ítems (usada internamente y al añadir platos a comandas ya activas).
 */
async function deductItemsStock(orderId, items, userName = 'Sistema', io = null) {
    let orderItems = [];
    try {
        orderItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
    } catch (e) {
        console.error(`[Inventario] Error parseando items para orden ${orderId}:`, e.message);
        return { success: false, error: 'Items inválidos' };
    }

    if (!Array.isArray(orderItems) || orderItems.length === 0) {
        return { success: true, count: 0 };
    }

    let totalDeductions = 0;

    for (const item of orderItems) {
        const productId = item.productId || item.id;
        const qty = parseFloat(item.qty) || 1;

        // 1. Descuento de insumos por receta del plato
        if (productId) {
            try {
                const query = `
                    SELECT ri.supply_id, ri.quantity, s.name as supply_name, s.current_stock
                    FROM recipes r
                    JOIN recipe_items ri ON ri.recipe_id = r.id
                    JOIN supplies s ON s.id = ri.supply_id
                    WHERE r.product_id = ?
                `;
                const ingredients = await dbAll(query, [productId]);
                for (const ing of ingredients) {
                    const totalAmount = ing.quantity * qty;
                    const newStock = ing.current_stock - totalAmount;

                    await dbRun('UPDATE supplies SET current_stock = current_stock - ? WHERE id = ?', [totalAmount, ing.supply_id]);
                    await dbRun(
                        `INSERT INTO inventory_movements 
                         (supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name) 
                         VALUES (?, ?, 'DESCUENTO_PEDIDO', ?, ?, ?, ?, ?)`,
                        [
                            ing.supply_id,
                            ing.supply_name,
                            -totalAmount,
                            newStock,
                            orderId,
                            `Pedido #${orderId} (${item.name} x${qty})`,
                            userName
                        ]
                    );
                    totalDeductions++;
                }
            } catch (err) {
                console.error(`[Inventario] Error descontando ingredientes para producto ${productId}:`, err.message);
            }
        }

        // 2. Descuento de TOPPINGS seleccionados en el plato (Opción C: Propio o Insumo Vinculado)
        let itemToppings = [];
        if (item.toppings) {
            if (typeof item.toppings === 'string') {
                try { itemToppings = JSON.parse(item.toppings); } catch (e) { itemToppings = []; }
            } else if (Array.isArray(item.toppings)) {
                itemToppings = item.toppings;
            }
        }

        for (const top of itemToppings) {
            if (!top || (!top.id && !top.name)) continue;
            try {
                // Buscar configuración del topping
                const topRow = await dbGet(
                    `SELECT id, name, inventory_mode, stock, supply_id, supply_quantity 
                     FROM toppings 
                     WHERE id = ? OR name = ? 
                     LIMIT 1`,
                    [top.id || '', top.name || '']
                );

                if (topRow) {
                    // Si el topping tiene desactivado el control de inventario, omitir
                    if (topRow.inventory_mode === 'none') {
                        continue;
                    }

                    if (topRow.inventory_mode === 'linked_supply' && topRow.supply_id) {
                        // Modo Insumo Vinculado: descontar del insumo de bodega correspondiente
                        const supply = await dbGet(
                            `SELECT id, name, unit, current_stock FROM supplies WHERE id = ? LIMIT 1`,
                            [topRow.supply_id]
                        );
                        if (supply) {
                            const qtyPerPortion = (topRow.supply_quantity && topRow.supply_quantity > 0) ? topRow.supply_quantity : 1;
                            const totalSupplyDeduct = qty * qtyPerPortion;
                            const newSupplyStock = supply.current_stock - totalSupplyDeduct;

                            await dbRun('UPDATE supplies SET current_stock = current_stock - ? WHERE id = ?', [totalSupplyDeduct, supply.id]);
                            await dbRun(
                                `INSERT INTO inventory_movements 
                                 (supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name) 
                                 VALUES (?, ?, 'DESCUENTO_PEDIDO', ?, ?, ?, ?, ?)`,
                                [
                                    supply.id,
                                    supply.name,
                                    -totalSupplyDeduct,
                                    newSupplyStock,
                                    orderId,
                                    `Topping: ${topRow.name} en Pedido #${orderId} (${item.name}: x${qty} porc. = -${totalSupplyDeduct} ${supply.unit})`,
                                    userName
                                ]
                            );
                            totalDeductions++;
                        }
                    } else {
                        // Modo Directo: descontar del stock propio de porciones del topping
                        const portionsDeduct = qty;
                        const newPortionStock = (topRow.stock || 0) - portionsDeduct;

                        await dbRun('UPDATE toppings SET stock = stock - ? WHERE id = ?', [portionsDeduct, topRow.id]);
                        await dbRun(
                            `INSERT INTO inventory_movements 
                             (supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name) 
                             VALUES (?, ?, 'DESCUENTO_PEDIDO', ?, ?, ?, ?, ?)`,
                            [
                                topRow.id,
                                `Topping: ${topRow.name}`,
                                -portionsDeduct,
                                newPortionStock,
                                orderId,
                                `Topping en Pedido #${orderId} (${item.name}: +${topRow.name} x${portionsDeduct} porc.)`,
                                userName
                            ]
                        );
                        totalDeductions++;
                    }
                }
            } catch (err) {
                console.error(`[Inventario] Error descontando topping ${top.name || top.id}:`, err.message);
            }
        }
    }

    if (io) {
        io.to('admin').emit('inventory_updated', { orderId, type: 'deduction' });
        io.to('cajero').emit('inventory_updated', { orderId, type: 'deduction' });
    }

    return { success: true, totalDeductions };
}

/**
 * Descuenta los insumos asociados a una orden completa si aún no ha sido descontada.
 */
function deductStockForOrder(orderId, items, userName = 'Sistema', io = null) {
    if (!orderId) return Promise.resolve({ success: false, reason: 'ID de orden requerido' });

    return new Promise((resolve) => {
        db.get('SELECT id, stock_deducted, items FROM orders WHERE id = ?', [orderId], async (err, order) => {
            if (err || !order) {
                console.error(`[Inventario] Error al buscar orden ${orderId}:`, err?.message);
                return resolve({ success: false, error: err?.message || 'Orden no encontrada' });
            }

            if (order.stock_deducted === 1) {
                // Ya fue descontado, evitar doble descuento
                return resolve({ success: true, alreadyDeducted: true });
            }

            const itemsToDeduct = items || order.items;
            await deductItemsStock(orderId, itemsToDeduct, userName, io);

            db.run('UPDATE orders SET stock_deducted = 1 WHERE id = ?', [orderId], () => {
                resolve({ success: true });
            });
        });
    });
}

/**
 * Reintegra insumos si un pedido previamente descontado es cancelado o anulado.
 */
async function revertStockForOrder(orderId, userName = 'Sistema', io = null) {
    if (!orderId) return { success: false };

    try {
        const order = await dbGet('SELECT id, stock_deducted FROM orders WHERE id = ?', [orderId]);
        if (!order || order.stock_deducted !== 1) {
            return { success: true, reverted: false };
        }

        const movements = await dbAll(
            "SELECT supply_id, supply_name, quantity FROM inventory_movements WHERE order_id = ? AND type = 'DESCUENTO_PEDIDO'",
            [orderId]
        );

        if (movements && movements.length > 0) {
            for (const mov of movements) {
                const restoreQty = Math.abs(mov.quantity);

                // Reintegrar en supplies si existe
                const supply = await dbGet('SELECT current_stock FROM supplies WHERE id = ?', [mov.supply_id]);
                if (supply) {
                    const newStock = supply.current_stock + restoreQty;
                    await dbRun('UPDATE supplies SET current_stock = current_stock + ? WHERE id = ?', [restoreQty, mov.supply_id]);
                    await dbRun(
                        `INSERT INTO inventory_movements 
                         (supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name) 
                         VALUES (?, ?, 'REINTEGRO_ANULACION', ?, ?, ?, ?, ?)`,
                        [mov.supply_id, mov.supply_name, restoreQty, newStock, orderId, `Reintegro por anulación de pedido #${orderId}`, userName]
                    );
                }

                // Reintegrar en toppings si es un topping directo
                const top = await dbGet('SELECT stock FROM toppings WHERE id = ?', [mov.supply_id]);
                if (top) {
                    const newStock = (top.stock || 0) + restoreQty;
                    await dbRun('UPDATE toppings SET stock = stock + ? WHERE id = ?', [restoreQty, mov.supply_id]);
                    await dbRun(
                        `INSERT INTO inventory_movements 
                         (supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name) 
                         VALUES (?, ?, 'REINTEGRO_ANULACION', ?, ?, ?, ?, ?)`,
                        [mov.supply_id, mov.supply_name, restoreQty, newStock, orderId, `Reintegro por anulación de pedido #${orderId}`, userName]
                    );
                }
            }
        }

        // Resetear flag stock_deducted a 0
        await dbRun('UPDATE orders SET stock_deducted = 0 WHERE id = ?', [orderId]);

        if (io) {
            io.to('admin').emit('inventory_updated', { orderId, type: 'revert' });
            io.to('cajero').emit('inventory_updated', { orderId, type: 'revert' });
        }

        return { success: true, reverted: true, count: movements?.length || 0 };
    } catch (err) {
        console.error(`[Inventario] Error revirtiendo stock para orden ${orderId}:`, err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    deductItemsStock,
    deductStockForOrder,
    revertStockForOrder
};
