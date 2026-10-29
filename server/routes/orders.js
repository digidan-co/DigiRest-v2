const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { verifyToken, verifyOptionalToken, isSupportMasterUser, requireRole } = require('./auth');
const { upload, validateUploadedFile } = require('../middleware/upload');
const { safeKeyGenerator } = require('../middleware/rateLimiter');
const { validateOrderInput } = require('../middleware/validators');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { processProof } = require('../utils/imageProcessor');
const { deductStockForOrder, revertStockForOrder } = require('../utils/inventory-helper');
const { calculateOrderCombos } = require('../utils/combo-calculator');
const { isSameDayOrder, getColombiaDateString } = require('../utils/date-helper');
const { verifyAdminCode, consumeAdminVerification } = require('../utils/admin-verifier');
const saasService = require('../saasService');

const { logAudit } = require('../utils/auditLogger');

const STAFF_ORDER_ROOMS = ['admin', 'cajero', 'supervisor', 'chef', 'cocinero', 'mesero', 'waiter'];

function sanitizeOrderForPublicTracker(orderObj) {
    return {
        id: orderObj.id,
        status: orderObj.status,
        type: orderObj.type,
        timestamp: orderObj.timestamp,
        displayDate: orderObj.displayDate || null,
        source: orderObj.type === 'Local' ? 'Local' : 'General'
    };
}

function dbAllAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Recalcula en servidor precios de platos, variantes, promociones, toppings, combos y tarifa de domicilio
 * para pedidos públicos sin JWT de personal, neutralizando manipulación de precios o montos negativos.
 */
async function recalculatePublicOrderPricing(rawItems, rawDeliveryZone, orderType, rawDeliveryFee) {
    const [products, toppings, combos, zones] = await Promise.all([
        dbAllAsync("SELECT id, name, price, is_promo, promo_price, has_variants, variants_config FROM products"),
        dbAllAsync("SELECT id, name, price FROM toppings"),
        dbAllAsync("SELECT id, name, type, combo_price, discount_value FROM promotions_combos"),
        dbAllAsync("SELECT id, name, fee FROM delivery_zones")
    ]);

    const prodById = new Map();
    const prodByName = new Map();
    for (const p of products) {
        prodById.set(String(p.id), p);
        if (p.name) prodByName.set(String(p.name).trim().toLowerCase(), p);
    }

    const topById = new Map();
    const topByName = new Map();
    for (const t of toppings) {
        topById.set(String(t.id), t);
        if (t.name) topByName.set(String(t.name).trim().toLowerCase(), t);
    }

    const comboMap = new Map();
    for (const c of combos) {
        const cid = String(c.id);
        comboMap.set(cid, c);
        comboMap.set(cid.startsWith('combo_') ? cid.slice(6) : `combo_${cid}`, c);
        if (c.name) comboMap.set(String(c.name).trim().toLowerCase(), c);
    }

    const resolveProductUnitPrice = (prod, item) => {
        const baseRegular = Math.max(0, parseFloat(prod.price) || 0);
        const basePromo = (prod.is_promo === 1 && parseFloat(prod.promo_price) > 0)
            ? parseFloat(prod.promo_price)
            : baseRegular;

        const varId = item.variant_id || item.variantId || null;
        const varName = item.variant_name || item.variantName || (typeof item.variant === 'string' ? item.variant : item.variant?.name) || null;
        if (prod.has_variants === 1 && prod.variants_config && (varId || varName)) {
            try {
                const vars = JSON.parse(prod.variants_config);
                if (Array.isArray(vars)) {
                    const matched = vars.find(v =>
                        (varId && String(v.id) === String(varId)) ||
                        (varName && v.name && String(v.name).trim().toLowerCase() === String(varName).trim().toLowerCase())
                    );
                    if (matched) {
                        const vPrice = Math.max(0, parseFloat(matched.price) || baseRegular);
                        if (prod.is_promo === 1 && parseFloat(matched.promo_price) > 0) {
                            return parseFloat(matched.promo_price);
                        }
                        return vPrice;
                    }
                }
            } catch (_) {}
        }
        return basePromo;
    };

    const sanitizedItems = (Array.isArray(rawItems) ? rawItems : []).map((rawItem) => {
        const item = { ...rawItem };
        const qty = Math.max(1, Math.min(200, parseInt(item.qty ?? item.quantity, 10) || 1));
        item.qty = qty;

        // Sanitize toppings prices from DB
        if (Array.isArray(item.toppings)) {
            item.toppings = item.toppings.map((top) => {
                const dbTop = (top.id && topById.get(String(top.id))) ||
                    (top.name && topByName.get(String(top.name).trim().toLowerCase()));
                return {
                    ...top,
                    price: dbTop ? Math.max(0, parseFloat(dbTop.price) || 0) : Math.max(0, parseFloat(top.price) || 0)
                };
            });
        }

        const rawProdId = String(item.productId || item.id || '').split('_')[0];
        const rawComboKey = item.combo_id || (String(item.id || '').startsWith('combo_') ? String(item.id) : null);
        const dbCombo = (rawComboKey && comboMap.get(String(rawComboKey))) ||
            (item.combo_name && comboMap.get(String(item.combo_name).trim().toLowerCase())) ||
            (item.is_combo && item.name && comboMap.get(String(item.name).trim().toLowerCase()));

        if (item.is_combo && dbCombo) {
            // Calcular precio base real sumando sub-items si existen
            let realBase = 0;
            if (Array.isArray(item.combo_items) && item.combo_items.length > 0) {
                for (const sub of item.combo_items) {
                    const subQty = Math.max(1, parseInt(sub.qty ?? sub.quantity, 10) || 1);
                    const subProd = (sub.product_id && prodById.get(String(sub.product_id))) ||
                        (sub.id && prodById.get(String(sub.id))) ||
                        (sub.name && prodByName.get(String(sub.name).trim().toLowerCase()));
                    if (subProd) {
                        realBase += resolveProductUnitPrice(subProd, sub) * subQty;
                    } else {
                        realBase += Math.max(0, parseFloat(sub.price) || 0) * subQty;
                    }
                }
            }
            const cPrice = Math.max(0, parseFloat(dbCombo.combo_price) || 0);
            const dVal = Math.max(0, parseFloat(dbCombo.discount_value) || 0);
            let finalComboUnit = cPrice;
            let unitDisc = 0;

            if (dbCombo.type === 'FIXED_PRICE' && cPrice > 0) {
                finalComboUnit = cPrice;
                unitDisc = realBase > cPrice ? (realBase - cPrice) : 0;
            } else if (dbCombo.type === 'PERCENT_DISCOUNT' && realBase > 0) {
                unitDisc = Math.round(realBase * (Math.min(100, dVal) / 100));
                finalComboUnit = Math.max(0, realBase - unitDisc);
            } else if (dbCombo.type === 'FIXED_DISCOUNT' && realBase > 0) {
                unitDisc = Math.min(realBase, dVal);
                finalComboUnit = Math.max(0, realBase - unitDisc);
            } else if (realBase > 0) {
                finalComboUnit = cPrice > 0 ? cPrice : realBase;
            }

            item.price = finalComboUnit;
            item.base_price = realBase > 0 ? realBase : (finalComboUnit + unitDisc);
            item.discount_amount = unitDisc;
            return item;
        }

        // Si usa combo_instance_id legacy, forzar metadatos reales del combo desde BD
        if (item.combo_instance_id) {
            if (dbCombo) {
                item.combo_type = dbCombo.type;
                item.combo_price = Math.max(0, parseFloat(dbCombo.combo_price) || 0);
                item.discount_value = Math.max(0, parseFloat(dbCombo.discount_value) || 0);
                if (dbCombo.type !== 'FREE_PRODUCT') item.is_free = false;
            } else {
                delete item.combo_instance_id;
                item.is_free = false;
            }
        }

        const dbProd = prodById.get(String(item.productId || item.id || '')) ||
            prodById.get(rawProdId) ||
            (item.name && prodByName.get(String(item.name).trim().toLowerCase()));

        if (dbProd) {
            item.price = resolveProductUnitPrice(dbProd, item);
        } else {
            item.price = Math.max(0, parseFloat(item.price) || 0);
        }

        return item;
    });

    let verifiedDeliveryFee = 0;
    if (orderType === 'Domicilio' || rawDeliveryZone) {
        const cleanZone = String(rawDeliveryZone || '').trim().toLowerCase();
        const matchedZone = cleanZone
            ? zones.find(z => String(z.id).toLowerCase() === cleanZone || String(z.name || '').trim().toLowerCase() === cleanZone)
            : null;
        if (matchedZone) {
            verifiedDeliveryFee = Math.max(0, parseFloat(matchedZone.fee) || 0);
        } else {
            verifiedDeliveryFee = Math.max(0, parseFloat(rawDeliveryFee) || 0);
        }
    }

    const comboCalc = calculateOrderCombos(sanitizedItems);
    return {
        sanitizedItems,
        comboCalc,
        verifiedDeliveryFee
    };
}

// Rate limiter for public order creation (customers without valid staff JWT)
const orderCreationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 orders per 15 min per IP for public clients
    keyGenerator: safeKeyGenerator,
    message: {
        error: 'Demasiados pedidos. Por favor, intenta nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        if (!token || !process.env.JWT_SECRET) return false;
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return true;
        } catch (_) {
            return false;
        }
    }
});

module.exports = (io) => {

    // Helper function to generate sequential IDs — ATOMIC operation
    // Uses a single SQL statement with RETURNING to prevent race conditions
    // where concurrent order creation could produce duplicate IDs.
    // Format: PG1, PL1, PG2, etc. (PG = Pedido General, PL = Pedido Local)
    async function generateOrderId(type) {
        return new Promise((resolve, reject) => {
            const isLocal = type === 'Local';
            const prefix = isLocal ? 'PL' : 'PG';
            const configKey = isLocal ? 'orderCounter_PL' : 'orderCounter_PG';

            // Atomically insert-or-increment the counter in ONE query.
            // SQLite guarantees this is serialized — no two requests can get the same count.
            // Initial value '{"count": 1}' ensures the first order is PG1/PL1.
            // After reset to {count: 0}, the UPDATE adds 1, yielding PG1 again.
            const sql = `
                INSERT INTO config (key, value) VALUES (?, '{"count": 1}')
                ON CONFLICT(key) DO UPDATE SET value = json_set(
                    value,
                    '$.count',
                    COALESCE(json_extract(value, '$.count'), 0) + 1
                )
                RETURNING value
            `;

            db.get(sql, [configKey], (err, row) => {
                if (err) return reject(err);
                if (!row || !row.value) return reject(new Error('Failed to generate order ID'));

                try {
                    const data = JSON.parse(row.value);
                    const counter = data.count || 0;
                    const newId = `${prefix}${counter}`;
                    resolve(newId);
                } catch (e) {
                    reject(new Error('Failed to parse counter value'));
                }
            });
        });
    }

    // Create New Order (Public or Waiter)
    // IMPORTANT: upload.single('proof') must come BEFORE validateOrderInput
    // so that multer parses FormData fields into req.body before validation runs.
    router.post('/orders', orderCreationLimiter, upload.single('proof'), validateUploadedFile, validateOrderInput, async (req, res) => {
        const staffUser = await verifyOptionalToken(req);

        // Verificar suscripción SaaS antes de crear pedidos (exenta soporte maestro)
        if (!isSupportMasterUser(staffUser)) {
            try {
                const saas = saasService.getCachedSaaSStatus() || await saasService.getSaaSStatus();
                if (saas && (saas.estado === 'Suspendida' || saas.estado === 'Suspendido' || saas.isExpired)) {
                    return res.status(403).json({
                        error: 'El servicio de recepción de pedidos se encuentra temporalmente inactivo.',
                        code: 'SAAS_SUSPENDED'
                    });
                }
            } catch (_) {}
        }

        const { client, phone, address, notes, type, payment, table, items, total } = req.body;
        const waiterId = staffUser ? (req.body.waiterId || staffUser.id) : null;
        const waiterName = staffUser ? (req.body.waiterName || staffUser.name) : null;

        let { proof } = req.body;
        // Evitar rutas arbitrarias en pedidos públicos cuando no se subió archivo real
        if (!staffUser && !req.file) {
            proof = null;
        }

        if (req.file) {
            try {
                const optimized = await processProof(req.file.path);
                proof = '/uploads/' + path.basename(optimized);
            } catch (e) {
                console.error('Error compressing proof, using original:', e.message);
                proof = '/uploads/' + req.file.filename;
            }
        }

        let tip = Math.max(0, parseFloat(req.body.tip) || 0);
        let discount = staffUser ? Math.max(0, parseFloat(req.body.discount) || 0) : 0;
        let discount_reason = staffUser ? (req.body.discount_reason || "") : "";
        const delivery_zone = req.body.delivery_zone || "";
        let delivery_fee = Math.max(0, parseFloat(req.body.delivery_fee) || 0);

        try {
            const newId = await generateOrderId(type || 'Domicilio');
            const ALLOWED_STAFF_INITIAL_STATUS = new Set(['Pendiente', 'Recibido', 'En Preparación', 'En preparación', 'En Cocina', 'Terminado', 'Cobrado']);
            const finalStatus = (staffUser && req.body.status && ALLOWED_STAFF_INITIAL_STATUS.has(req.body.status))
                ? req.body.status
                : 'Pendiente';

            let parsedItems = [];
            try {
                parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
            } catch (e) {
                parsedItems = [];
            }

            let finalOrderTotal = Math.max(0, parseFloat(total) || 0);

            if (!staffUser) {
                // Recalcular estrictamente precios, variantes, promos, toppings, combos y domicilio desde SQLite
                const pricing = await recalculatePublicOrderPricing(parsedItems, delivery_zone, type || 'Domicilio', delivery_fee);
                parsedItems = pricing.sanitizedItems;
                delivery_fee = pricing.verifiedDeliveryFee;
                discount = pricing.comboCalc.totalComboDiscount;
                discount_reason = pricing.comboCalc.discountReason || '';
                finalOrderTotal = Math.max(0, pricing.comboCalc.netItemsTotal + delivery_fee + tip);
            } else {
                // Personal autenticado: mantener flujo actual con auto-evaluación de combos
                const comboCalc = calculateOrderCombos(parsedItems);
                if (comboCalc.totalComboDiscount > 0) {
                    if (discount === 0) {
                        discount = comboCalc.totalComboDiscount;
                        if (finalOrderTotal >= comboCalc.subtotalBase) {
                            finalOrderTotal = Math.max(0, finalOrderTotal - discount);
                        }
                    }
                    if (!discount_reason) {
                        discount_reason = comboCalc.discountReason;
                    } else if (!discount_reason.includes(comboCalc.discountReason)) {
                        discount_reason = `${discount_reason} (${comboCalc.discountReason})`;
                    }
                }
            }

            const itemsJson = JSON.stringify(parsedItems);

            const account_id = (staffUser && req.body.account_id) ? parseInt(req.body.account_id, 10) : null;
            const cash_amount = staffUser ? (Math.max(0, parseFloat(req.body.cash_amount) || 0)) : 0;
            const transfer_amount = staffUser ? (Math.max(0, parseFloat(req.body.transfer_amount) || 0)) : 0;
            const cash_account_id = (staffUser && req.body.cash_account_id) ? parseInt(req.body.cash_account_id, 10) : null;
            const transfer_account_id = (staffUser && req.body.transfer_account_id) ? parseInt(req.body.transfer_account_id, 10) : null;
            const payment_details = (staffUser && req.body.payment_details)
                ? (typeof req.body.payment_details === 'object' ? JSON.stringify(req.body.payment_details) : req.body.payment_details)
                : null;

            const sql = `INSERT INTO orders (id, client, phone, address, notes, type, payment, status, total, tip, discount, discount_reason, items, waiterId, waiterName, tableNum, proof, delivery_zone, delivery_fee, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            db.run(sql, [newId, client, phone, address, notes, type, payment, finalStatus, finalOrderTotal, tip, discount, discount_reason, itemsJson, waiterId, waiterName, table, proof, delivery_zone, delivery_fee, account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const newOrder = {
                    id: newId,
                    client, phone, address, notes, type, payment,
                    status: finalStatus,
                    total: finalOrderTotal,
                    tip, discount, discount_reason,
                    items: parsedItems,
                    waiterId, waiterName, table,
                    tableNum: table,
                    proof,
                    delivery_zone, delivery_fee,
                    account_id, cash_amount, transfer_amount, cash_account_id, transfer_account_id, payment_details,
                    timestamp: new Date().toISOString()
                };

                // Si el pedido entra directamente a cocina (no pasa por 'Pendiente')
                if (finalStatus !== 'Pendiente' && finalStatus !== 'Anulado') {
                    deductStockForOrder(newId, parsedItems, staffUser?.name || waiterName || 'Mesero', io);
                }

                // Emisión deduplicada únicamente a salas autenticadas de personal (sin fugas globales io.emit)
                const targetRooms = [...STAFF_ORDER_ROOMS];
                if (type === 'Domicilio') {
                    targetRooms.push('delivery', 'repartidor');
                }
                if (waiterId) {
                    targetRooms.push(`user_${waiterId}`);
                }
                io.to(targetRooms).emit('new_order', newOrder);

                // Al turnero público ('tracker') solo se emite ID y estado sin PII ni comprobantes
                io.to('tracker').emit('new_order', sanitizeOrderForPublicTracker(newOrder));

                // Log initial note to history if present
                if (notes && notes.trim().length > 0) {
                    const noteAuthor = waiterName || (type === 'Local' ? 'Mesero' : 'Cliente');
                    db.run("INSERT INTO notes_log (order_id, note, created_by, resolved) VALUES (?, ?, ?, ?)",
                        [newId, notes, noteAuthor, 0], (err) => {
                            if (err) console.error("Error logging initial note history:", err);
                        });
                }

                // Upsert into customers CRM table if phone is provided
                let cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
                if (cleanPhone.startsWith('57') && cleanPhone.length === 12) {
                    cleanPhone = cleanPhone.slice(2);
                }

                if (cleanPhone.length >= 7) {
                    const custName = client && client.trim().length > 0 ? client.trim() : 'Cliente';
                    const custAddr = address && address !== 'N/A' ? address.trim() : '';
                    const custZone = delivery_zone ? delivery_zone.trim() : '';

                    const upsertCustomerSql = `
                        INSERT INTO customers (phone, name, address, delivery_zone, total_orders, total_spent, last_order_at, updated_at)
                        VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(phone) DO UPDATE SET
                            name = CASE 
                                WHEN customers.name IS NOT NULL AND customers.name != '' AND LOWER(customers.name) NOT IN ('cliente', 'cliente final') 
                                THEN customers.name 
                                WHEN excluded.name IS NOT NULL AND excluded.name != '' AND LOWER(excluded.name) NOT IN ('cliente', 'cliente final')
                                THEN excluded.name 
                                ELSE customers.name 
                            END,
                            address = CASE WHEN excluded.address != '' AND excluded.address != 'N/A' THEN excluded.address ELSE customers.address END,
                            delivery_zone = CASE WHEN excluded.delivery_zone != '' THEN excluded.delivery_zone ELSE customers.delivery_zone END,
                            total_orders = customers.total_orders + 1,
                            total_spent = customers.total_spent + excluded.total_spent,
                            last_order_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    db.run(upsertCustomerSql, [cleanPhone, custName, custAddr, custZone, finalOrderTotal], (custErr) => {
                        if (custErr) console.error("Error updating customer CRM on order:", custErr.message);
                        else io.to(['admin', 'cajero', 'supervisor']).emit('customers_updated');
                    });
                }

                res.json(newOrder);
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get Active Orders (Staff full access; Public tracker sanitized without PII & bounded pagination)
    router.get('/orders', async (req, res) => {
        const staffUser = await verifyOptionalToken(req);

        const rawPage = Math.max(1, parseInt(req.query.page, 10) || 1);
        const maxAllowedLimit = !staffUser
            ? 50
            : ((req.query.from || req.query.to) ? 2000 : 500);
        const safeLimit = Math.max(1, Math.min(maxAllowedLimit, parseInt(req.query.limit, 10) || 50));
        const offset = (rawPage - 1) * safeLimit;

        const status = req.query.status;
        const type = req.query.type;
        const from = staffUser ? req.query.from : null;
        const to = staffUser ? req.query.to : null;
        const allowAll = Boolean(staffUser && req.query.all === 'true');

        let whereClause = " WHERE 1=1";
        const params = [];

        if (!staffUser) {
            // Visitantes públicos (turnero/tracker): solo pedidos activos recientes (últimas 12h), nunca anulados
            const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
            whereClause += " AND status != 'Anulado' AND status != 'Cancelado' AND datetime(timestamp) > datetime(?)";
            params.push(cutoff);
        } else if (from) {
            whereClause += " AND datetime(timestamp) >= datetime(?)";
            params.push(from);
        } else if (!allowAll) {
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            whereClause += " AND (status NOT IN ('Cobrado', 'Anulado') OR datetime(timestamp) > datetime(?))";
            params.push(yesterday);
        }

        if (to) {
            whereClause += " AND datetime(timestamp) <= datetime(?)";
            params.push(to);
        }

        if (status) {
            whereClause += " AND status = ?";
            params.push(status);
        }

        if (type) {
            whereClause += " AND type = ?";
            params.push(type);
        }

        const countSql = `SELECT COUNT(*) as total FROM orders o${whereClause}`;
        const sql = staffUser
            ? `SELECT o.*,
                (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id) as notes_count,
                (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id AND n.solved = 0) as unsolved_notes_count
               FROM orders o${whereClause}
               ORDER BY timestamp DESC LIMIT ? OFFSET ?`
            : `SELECT o.id, o.status, o.type, o.timestamp, o.displayDate
               FROM orders o${whereClause}
               ORDER BY timestamp DESC LIMIT ? OFFSET ?`;

        db.get(countSql, params, (err, countRow) => {
            if (err) return res.status(500).json({ error: err.message });

            const total = countRow ? countRow.total : 0;
            const totalPages = Math.max(1, Math.ceil(total / safeLimit));

            db.all(sql, [...params, safeLimit, offset], (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });

                const orders = (rows || []).map(o => {
                    const normalizedTs = o.timestamp && !o.timestamp.endsWith('Z') ? o.timestamp + 'Z' : o.timestamp;
                    if (!staffUser) {
                        return sanitizeOrderForPublicTracker({ ...o, timestamp: normalizedTs });
                    }
                    let parsedItems = [];
                    try { parsedItems = JSON.parse(o.items || '[]'); } catch (_) {}
                    return {
                        ...o,
                        table: o.tableNum,
                        items: parsedItems,
                        timestamp: normalizedTs,
                        source: o.type === 'Local' ? 'Local' : 'General',
                        hasNotes: o.notes_count > 0,
                        hasUnsolvedNotes: o.unsolved_notes_count > 0
                    };
                });

                res.json({
                    orders,
                    pagination: {
                        page: rawPage,
                        limit: safeLimit,
                        total,
                        totalPages,
                        hasMore: rawPage < totalPages
                    }
                });
            });
        });
    });

    // Get Single Order by ID (Staff gets full order; Public tracker gets non-PII status only)
    router.get('/orders/:id', async (req, res) => {
        const { id } = req.params;
        const staffUser = await verifyOptionalToken(req);

        const sql = staffUser
            ? `SELECT o.*,
                (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id) as notes_count,
                (SELECT COUNT(*) FROM order_notes n WHERE n.id_order = o.id AND n.solved = 0) as unsolved_notes_count
               FROM orders o WHERE id = ?`
            : `SELECT id, status, type, timestamp, displayDate FROM orders WHERE id = ?`;

        db.get(sql, [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Order not found' });

            const displayDate = row.displayDate || new Date(row.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
            if (!staffUser) {
                return res.json(sanitizeOrderForPublicTracker({ ...row, displayDate }));
            }

            let parsedItems = [];
            try { parsedItems = JSON.parse(row.items || '[]'); } catch (_) {}
            const order = {
                ...row,
                table: row.tableNum,
                items: parsedItems,
                displayDate,
                source: row.type === 'Local' ? 'Local' : 'General',
                hasNotes: row.notes_count > 0,
                hasUnsolvedNotes: row.unsolved_notes_count > 0
            };
            res.json(order);
        });
    });

    // Update Order Status
    router.put('/orders/:id/status', verifyToken, (req, res) => {
        const { status, chefName, deliveryDriverName } = req.body;
        const { id } = req.params;

        // Restringir el estado 'Cobrado' exclusivamente a roles de caja / administración
        if (status === 'Cobrado' && !['admin', 'cajero', 'supervisor'].includes(req.user?.role)) {
            return res.status(403).json({ error: 'Solo personal de caja o administración puede marcar pedidos como cobrados.' });
        }

        let isExtemporaryCancel = false;
        let approvingAdmin = null;

        if (status === 'Anulado' || status === 'Cancelado') {
            console.log(`[CANCEL] Order ${id} cancellation requested by ${req.user.name} (role: ${req.user.role})`);
        }

        const handleUpdateFlow = (adminAuthorizer = null, isExtemp = false) => {
            isExtemporaryCancel = isExtemp;
            approvingAdmin = adminAuthorizer;

            if (status === 'En Reparto' || status === 'En ruta') {
                db.get('SELECT deliveryDriverId, deliveryDriverName FROM orders WHERE id = ?', [id], (err, order) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (!order) return res.status(404).json({ error: 'Order not found' });

                    if (order.deliveryDriverId && order.deliveryDriverId != req.user.id) {
                        return res.status(409).json({
                            error: 'ORDER_LOCKED',
                            message: `Este pedido ya fue tomado por ${order.deliveryDriverName}`,
                            lockedBy: order.deliveryDriverName
                        });
                    }

                    performStatusUpdate();
                });
            } else {
                performStatusUpdate();
            }
        };

        // Verificación de anulación / cancelación en servidor (sin confiar en x-admin-verified)
        if (status === 'Anulado' || status === 'Cancelado') {
            db.get('SELECT timestamp, client, total, payment FROM orders WHERE id = ?', [id], async (fetchErr, orderRow) => {
                if (fetchErr) return res.status(500).json({ error: fetchErr.message });
                if (!orderRow) return res.status(404).json({ error: 'Pedido no encontrado' });

                const isSameDay = isSameDayOrder(orderRow.timestamp);
                let adminAuthName = null;

                // CORTE 11:59 P. M.: Si el pedido es de días anteriores, SOLO ADMINISTRADORES
                if (!isSameDay) {
                    if (req.user.role === 'admin') {
                        adminAuthName = req.user.name;
                    } else {
                        const adminCode = req.body.adminCode || req.headers['x-admin-code'];
                        const authCheck = await verifyAdminCode(adminCode, false);
                        if (authCheck.valid) {
                            adminAuthName = authCheck.admin.name;
                        } else {
                            return res.status(403).json({
                                error: 'Este pedido pertenece a una jornada ya cerrada (corte 11:59 p. m.). Solo un Administrador puede anular pedidos de días anteriores.'
                            });
                        }
                    }
                }

                // Verificación cajero (modo estricto) validada en servidor
                if (req.user.role === 'cajero') {
                    db.get("SELECT value FROM config WHERE key = 'dataRestaurant'", [], async (cfgErr, cfgRow) => {
                        let cajeroCanCancel = true;
                        if (cfgRow && cfgRow.value) {
                            try {
                                const parsed = JSON.parse(cfgRow.value);
                                if (parsed.cajeroCanCancel === false) cajeroCanCancel = false;
                            } catch (e) {}
                        }

                        if (!cajeroCanCancel && !adminAuthName) {
                            // 1) Consumir autorización reciente emitida por POST /api/auth/verify-admin
                            const grant = consumeAdminVerification(req.user.id);
                            if (grant.valid) {
                                adminAuthName = grant.admin.name;
                                return handleUpdateFlow(adminAuthName, !isSameDay);
                            }

                            // 2) O validar código directo si fue enviado en esta misma petición
                            const directCode = req.body.adminCode || req.headers['x-admin-code'];
                            if (directCode) {
                                const directCheck = await verifyAdminCode(directCode, true);
                                if (directCheck.valid) {
                                    adminAuthName = directCheck.admin.name;
                                    return handleUpdateFlow(adminAuthName, !isSameDay);
                                }
                            }

                            // 3) O consumir aprobación remota en order_authorizations (de un solo uso)
                            return db.get(
                                "SELECT id, resolved_by_name FROM order_authorizations WHERE order_id = ? AND type = 'cancel' AND status = 'approved' LIMIT 1",
                                [id],
                                (authErr, authRow) => {
                                    if (authErr || !authRow) {
                                        return res.status(403).json({
                                            error: 'La anulación de pedidos por cajeros requiere autorización previa de un administrador o supervisor.'
                                        });
                                    }
                                    db.run("UPDATE order_authorizations SET status = 'consumed' WHERE id = ?", [authRow.id], () => {});
                                    handleUpdateFlow(authRow.resolved_by_name || null, !isSameDay);
                                }
                            );
                        }
                        handleUpdateFlow(adminAuthName, !isSameDay);
                    });
                    return;
                }

                handleUpdateFlow(adminAuthName, !isSameDay);
            });
            return;
        }

        handleUpdateFlow();

        function performStatusUpdate() {
            const updates = ['status = ?'];
            const values = [status];

            if (chefName !== undefined) {
                updates.push('chefName = ?');
                values.push(chefName);
            }

            if (deliveryDriverName !== undefined) {
                updates.push('deliveryDriverName = ?');
                values.push(deliveryDriverName);
            }

            if (req.body.deliveryDriverId !== undefined) {
                updates.push('deliveryDriverId = ?');
                values.push(req.body.deliveryDriverId);
            }

            if (req.body.cancelReason !== undefined) {
                updates.push('cancel_reason = ?');
                values.push(req.body.cancelReason);
            }

            if (req.body.payment !== undefined) {
                updates.push('payment = ?');
                values.push(req.body.payment);
            }

            if (req.body.account_id !== undefined) {
                updates.push('account_id = ?');
                values.push(req.body.account_id ? parseInt(req.body.account_id, 10) : null);
            }

            if (req.body.cash_amount !== undefined) {
                updates.push('cash_amount = ?');
                values.push(parseFloat(req.body.cash_amount) || 0);
            }

            if (req.body.transfer_amount !== undefined) {
                updates.push('transfer_amount = ?');
                values.push(parseFloat(req.body.transfer_amount) || 0);
            }

            if (req.body.cash_account_id !== undefined) {
                updates.push('cash_account_id = ?');
                values.push(req.body.cash_account_id ? parseInt(req.body.cash_account_id, 10) : null);
            }

            if (req.body.transfer_account_id !== undefined) {
                updates.push('transfer_account_id = ?');
                values.push(req.body.transfer_account_id ? parseInt(req.body.transfer_account_id, 10) : null);
            }

            if (req.body.payment_details !== undefined) {
                updates.push('payment_details = ?');
                values.push(typeof req.body.payment_details === 'object' ? JSON.stringify(req.body.payment_details) : req.body.payment_details);
            }

            if (req.body.proof !== undefined) {
                updates.push('proof = ?');
                values.push(req.body.proof);
            }

            values.push(id);

            const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = ?`;

            db.run(sql, values, function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const updateData = {
                    id,
                    status,
                    chefName,
                    deliveryDriverName,
                    cancelReason: req.body.cancelReason,
                    payment: req.body.payment,
                    account_id: req.body.account_id,
                    cash_amount: req.body.cash_amount,
                    transfer_amount: req.body.transfer_amount,
                    cash_account_id: req.body.cash_account_id,
                    transfer_account_id: req.body.transfer_account_id,
                    proof: req.body.proof
                };

                // Emisión deduplicada a salas autenticadas de personal
                const statusRooms = [...STAFF_ORDER_ROOMS];
                if (status === 'Terminado' || status === 'En ruta' || status === 'En Reparto' || status === 'Entregado' || req.body.deliveryDriverId !== undefined) {
                    statusRooms.push('delivery', 'repartidor');
                }
                io.to(statusRooms).emit('order_status_update', updateData);
                io.to(statusRooms).emit('order_updated', updateData);

                // Al turnero público solo se envía ID y estado
                io.to('tracker').emit('order_status_update', { id, status });

                if (status === 'Cobrado') {
                    io.to(['admin', 'cajero', 'supervisor']).emit('cashflow_updated', { type: 'order_collected', orderId: id });
                }

                // INVENTARIO AUTOMÁTICO: Descuento al pasar a cocina / Reintegro al anular
                if (status === 'Recibido' || status === 'En Preparación' || status === 'En Cocina') {
                    deductStockForOrder(id, null, req.user?.name || 'Admin', io);
                } else if (status === 'Anulado' || status === 'Cancelado') {
                    revertStockForOrder(id, req.user?.name || 'Admin', io);

                    db.get("SELECT client, total, payment, timestamp FROM orders WHERE id = ?", [id], (fetchErr, ordRow) => {
                        const auditAction = isExtemporaryCancel ? 'ORDER_CANCELLED_EXTEMPORARY' : 'ORDER_CANCELLED';
                        logAudit(auditAction, req.user?.id || 'unknown', req.ip, {
                            orderId: id,
                            client: ordRow?.client || 'Cliente',
                            total: ordRow?.total || 0,
                            payment: ordRow?.payment || 'N/A',
                            cancelReason: req.body.cancelReason || 'Sin motivo especificado',
                            userName: req.user?.name || 'Usuario',
                            userRole: req.user?.role || 'N/A',
                            extemporary: isExtemporaryCancel,
                            originalDate: ordRow?.timestamp || null,
                            authorizedBy: approvingAdmin || null
                        });
                    });
                }

                res.json(updateData);
            });
        }
    });

    // POST /orders/:id/cobrar — Cobrar pedido (Solo Admin / Cajero / Supervisor)
    router.post('/orders/:id/cobrar', verifyToken, requireRole(['admin', 'cajero']), upload.single('proof'), validateUploadedFile, async (req, res) => {
        const { id } = req.params;
        const {
            payment = 'Efectivo',
            account_id,
            cash_amount,
            transfer_amount,
            cash_account_id,
            transfer_account_id,
            payment_details,
            notes
        } = req.body;

        let proofPath = null;
        if (req.file) {
            try {
                const optimized = await processProof(req.file.path);
                proofPath = '/uploads/' + path.basename(optimized);
            } catch (e) {
                console.error('Error optimizing proof on cobrar:', e.message);
                proofPath = `/uploads/${req.file.filename}`;
            }
        }

        db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

            const finalProof = proofPath || (req.body.proof !== undefined ? req.body.proof : order.proof);
            let finalPaymentDetails = null;
            if (payment_details) {
                finalPaymentDetails = typeof payment_details === 'object' ? JSON.stringify(payment_details) : payment_details;
            }

            let calcCash = parseFloat(cash_amount) || 0;
            let calcTransfer = parseFloat(transfer_amount) || 0;
            let calcCashAcc = cash_account_id ? parseInt(cash_account_id, 10) : null;
            let calcTransferAcc = transfer_account_id ? parseInt(transfer_account_id, 10) : null;

            if (finalPaymentDetails) {
                try {
                    const parsed = JSON.parse(finalPaymentDetails);
                    if (parsed && Array.isArray(parsed.splits) && parsed.splits.length > 0) {
                        let sumCash = 0;
                        let sumTrans = 0;
                        parsed.splits.forEach(s => {
                            const amt = parseFloat(s.amount) || 0;
                            const m = (s.method || '').toLowerCase();
                            if (m.includes('efectivo') || m === 'cash') {
                                sumCash += amt;
                                if (!calcCashAcc && s.account_id) calcCashAcc = parseInt(s.account_id, 10);
                            } else if (m.includes('trans') || m.includes('nequi') || m.includes('davi') || m.includes('banco')) {
                                sumTrans += amt;
                                if (!calcTransferAcc && s.account_id) calcTransferAcc = parseInt(s.account_id, 10);
                            }
                        });
                        if (calcCash === 0 && sumCash > 0) calcCash = sumCash;
                        if (calcTransfer === 0 && sumTrans > 0) calcTransfer = sumTrans;
                    }
                } catch (_) {}
            }

            const finalCashAmt = calcCash;
            const finalTransferAmt = calcTransfer;
            const finalAccId = account_id ? parseInt(account_id, 10) : null;
            const finalCashAccId = calcCashAcc;
            const finalTransferAccId = calcTransferAcc;

            let finalNotes = order.notes || '';
            if (notes && typeof notes === 'string' && notes.trim()) {
                finalNotes = finalNotes ? `${finalNotes} | Pago: ${notes.trim()}` : notes.trim();
            }

            const sql = `
                UPDATE orders SET
                    status = 'Cobrado',
                    payment = ?,
                    account_id = ?,
                    cash_amount = ?,
                    transfer_amount = ?,
                    cash_account_id = ?,
                    transfer_account_id = ?,
                    payment_details = ?,
                    proof = ?,
                    notes = ?
                WHERE id = ?
            `;

            db.run(sql, [
                payment,
                finalAccId,
                finalCashAmt,
                finalTransferAmt,
                finalCashAccId,
                finalTransferAccId,
                payment_details || null,
                finalProof,
                finalNotes,
                id
            ], function (uErr) {
                if (uErr) return res.status(500).json({ error: uErr.message });

                let parsedItems = [];
                try {
                    parsedItems = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
                } catch (_) {}

                const updateData = {
                    ...order,
                    id,
                    status: 'Cobrado',
                    payment,
                    account_id: finalAccId,
                    cash_amount: finalCashAmt,
                    transfer_amount: finalTransferAmt,
                    cash_account_id: finalCashAccId,
                    transfer_account_id: finalTransferAccId,
                    payment_details,
                    proof: finalProof,
                    notes: finalNotes,
                    total: order.total,
                    type: order.type,
                    waiterId: order.waiterId,
                    waiterName: order.waiterName,
                    table: order.tableNum,
                    items: parsedItems
                };

                const collectRooms = [...STAFF_ORDER_ROOMS, 'delivery', 'repartidor'];
                if (order.waiterId) {
                    collectRooms.push(`user_${order.waiterId}`);
                }
                io.to(collectRooms).emit('order_status_update', updateData);
                io.to(collectRooms).emit('order_updated', updateData);
                io.to('tracker').emit('order_status_update', { id, status: 'Cobrado' });

                io.to(['admin', 'cajero', 'supervisor']).emit('cashflow_updated', { type: 'order_collected', orderId: id });

                res.json({ success: true, message: 'Pedido cobrado exitosamente', order: updateData });
            });
        });
    });

    return router;
};
