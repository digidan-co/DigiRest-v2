/**
 * Utility: combo-calculator.js
 * DigiRest v2 - Promociones y Combos
 * 
 * Realiza cálculos exactos para órdenes con uno o múltiples combos preestablecidos.
 * Preserva compatibilidad total con productos sueltos y descuentos manuales.
 */

/**
 * Calcula los totales, ahorros y desglose de combos en una lista de ítems de pedido.
 * @param {Array} items - Lista de items de la orden (puede incluir items normales y items de combos)
 * @returns {Object} { subtotalBase, totalComboDiscount, netItemsTotal, comboInstancesCount, discountReason }
 */
function calculateOrderCombos(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
        return {
            subtotalBase: 0,
            totalComboDiscount: 0,
            netItemsTotal: 0,
            comboInstancesCount: {},
            discountReason: ''
        };
    }

    let subtotalBase = 0;
    const comboGroups = {};
    const regularItems = [];

    // 1. Agrupar items por instancia de combo o como items regulares
    items.forEach(item => {
        const qty = parseFloat(item.qty || item.quantity) || 1;
        const itemPrice = parseFloat(item.price) || 0;
        const toppingsPrice = (Array.isArray(item.toppings) ? item.toppings : []).reduce(
            (sum, top) => sum + (parseFloat(top.price) || 0), 0
        );
        const itemTotal = (itemPrice + toppingsPrice) * qty;

        subtotalBase += itemTotal;

        if (item.combo_instance_id) {
            const instanceId = item.combo_instance_id;
            if (!comboGroups[instanceId]) {
                comboGroups[instanceId] = {
                    combo_id: item.combo_id,
                    combo_name: item.combo_name || 'Combo',
                    combo_price: parseFloat(item.combo_price) || 0,
                    combo_type: item.combo_type || 'FIXED_PRICE',
                    discount_value: parseFloat(item.discount_value) || 0,
                    items: [],
                    baseItemsTotal: 0,
                    toppingsTotal: 0
                };
            }
            comboGroups[instanceId].items.push(item);
            comboGroups[instanceId].baseItemsTotal += (itemPrice * qty);
            comboGroups[instanceId].toppingsTotal += (toppingsPrice * qty);
        } else {
            regularItems.push(item);
        }
    });

    let totalComboDiscount = 0;
    const comboCounts = {}; // { 'Combo Duo': 2, 'Combo Infantil': 1 }

    // 2. Procesar cada instancia de combo
    Object.values(comboGroups).forEach(group => {
        const cName = group.combo_name;
        comboCounts[cName] = (comboCounts[cName] || 0) + 1;

        let instanceDiscount = 0;

        switch (group.combo_type) {
            case 'FIXED_PRICE':
                // Si la suma regular de los platos base es mayor que el precio pactado del combo:
                if (group.baseItemsTotal > group.combo_price) {
                    instanceDiscount = group.baseItemsTotal - group.combo_price;
                }
                break;

            case 'PERCENT_DISCOUNT':
                const percent = Math.min(100, Math.max(0, group.discount_value));
                instanceDiscount = group.baseItemsTotal * (percent / 100);
                break;

            case 'FIXED_DISCOUNT':
                instanceDiscount = Math.min(group.baseItemsTotal, group.discount_value);
                break;

            case 'FREE_PRODUCT':
                // Sumar los items marcados como is_free o cortesía
                group.items.forEach(it => {
                    if (it.is_free) {
                        const itQty = parseFloat(it.qty) || 1;
                        instanceDiscount += (parseFloat(it.price) || 0) * itQty;
                    }
                });
                break;

            default:
                if (group.baseItemsTotal > group.combo_price && group.combo_price > 0) {
                    instanceDiscount = group.baseItemsTotal - group.combo_price;
                }
                break;
        }

        instanceDiscount = Math.max(0, Math.round(instanceDiscount));
        totalComboDiscount += instanceDiscount;
    });

    // 3. Generar la razón del descuento en base a los combos adquiridos
    const comboReasonParts = [];
    Object.entries(comboCounts).forEach(([name, count]) => {
        comboReasonParts.push(count > 1 ? `${count}x ${name}` : name);
    });

    const discountReason = comboReasonParts.length > 0 ? comboReasonParts.join(', ') : '';
    const netItemsTotal = Math.max(0, subtotalBase - totalComboDiscount);

    return {
        subtotalBase,
        totalComboDiscount,
        netItemsTotal,
        comboInstancesCount: comboCounts,
        discountReason
    };
}

module.exports = {
    calculateOrderCombos
};
