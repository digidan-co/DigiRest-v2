const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { v4: uuidv4 } = require('uuid');

module.exports = (io) => {

    // Helper DB async
    const dbAllAsync = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    };

    const dbGetAsync = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    };

    const dbRunAsync = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    };

    // =========================================================================
    // CUPONES (ADMIN / CAJERO)
    // =========================================================================

    // Listar todos los cupones
    router.get('/coupons', verifyToken, requireRole(['admin', 'cajero']), async (req, res) => {
        try {
            const rows = await dbAllAsync("SELECT * FROM coupons ORDER BY created_at DESC");
            const parsed = rows.map(r => ({
                ...r,
                channels: typeof r.channels === 'string' ? JSON.parse(r.channels || '[]') : r.channels
            }));
            res.json(parsed);
        } catch (err) {
            console.error('Error fetching coupons:', err);
            res.status(500).json({ error: 'Error al obtener cupones' });
        }
    });

    // Crear cupón
    router.post('/coupons', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const {
                code,
                description = '',
                discount_type = 'PERCENT',
                discount_value = 0,
                min_order_total = 0,
                max_uses = 0,
                valid_until = null,
                channels = ['Local', 'Domicilio', 'Para Llevar'],
                active = 1
            } = req.body;

            const cleanCode = (code || '').trim().toUpperCase();
            if (!cleanCode) {
                return res.status(400).json({ error: 'El código del cupón es obligatorio' });
            }

            const parsedValue = Math.max(0, parseFloat(discount_value) || 0);
            if (parsedValue <= 0) {
                return res.status(400).json({ error: 'El valor del descuento debe ser mayor a 0' });
            }

            if (discount_type === 'PERCENT' && parsedValue > 100) {
                return res.status(400).json({ error: 'El porcentaje de descuento no puede superar el 100%' });
            }

            const existing = await dbGetAsync("SELECT id FROM coupons WHERE code = ?", [cleanCode]);
            if (existing) {
                return res.status(400).json({ error: `El código "${cleanCode}" ya existe` });
            }

            const id = uuidv4();
            const channelsJson = JSON.stringify(Array.isArray(channels) ? channels : ['Local', 'Domicilio', 'Para Llevar']);

            await dbRunAsync(`
                INSERT INTO coupons (
                    id, code, description, discount_type, discount_value,
                    min_order_total, max_uses, used_count, valid_until, channels, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            `, [
                id,
                cleanCode,
                description.trim(),
                discount_type === 'FIXED' ? 'FIXED' : 'PERCENT',
                parsedValue,
                Math.max(0, parseFloat(min_order_total) || 0),
                Math.max(0, parseInt(max_uses, 10) || 0),
                valid_until ? valid_until : null,
                channelsJson,
                active ? 1 : 0
            ]);

            const created = await dbGetAsync("SELECT * FROM coupons WHERE id = ?", [id]);
            if (created) {
                created.channels = JSON.parse(created.channels || '[]');
            }

            if (io) io.emit('coupon_changed', { action: 'create', coupon: created });
            res.status(201).json(created);
        } catch (err) {
            console.error('Error creating coupon:', err);
            res.status(500).json({ error: err.message || 'Error al crear cupón' });
        }
    });

    // Actualizar cupón
    router.put('/coupons/:id', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const {
                code,
                description = '',
                discount_type = 'PERCENT',
                discount_value = 0,
                min_order_total = 0,
                max_uses = 0,
                valid_until = null,
                channels = ['Local', 'Domicilio', 'Para Llevar'],
                active = 1
            } = req.body;

            const existing = await dbGetAsync("SELECT * FROM coupons WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Cupón no encontrado' });
            }

            const cleanCode = (code || '').trim().toUpperCase();
            if (!cleanCode) {
                return res.status(400).json({ error: 'El código del cupón es obligatorio' });
            }

            const parsedValue = Math.max(0, parseFloat(discount_value) || 0);
            if (parsedValue <= 0) {
                return res.status(400).json({ error: 'El valor del descuento debe ser mayor a 0' });
            }

            if (discount_type === 'PERCENT' && parsedValue > 100) {
                return res.status(400).json({ error: 'El porcentaje de descuento no puede superar el 100%' });
            }

            const duplicate = await dbGetAsync("SELECT id FROM coupons WHERE code = ? AND id != ?", [cleanCode, id]);
            if (duplicate) {
                return res.status(400).json({ error: `El código "${cleanCode}" ya está en uso por otro cupón` });
            }

            const channelsJson = JSON.stringify(Array.isArray(channels) ? channels : ['Local', 'Domicilio', 'Para Llevar']);

            await dbRunAsync(`
                UPDATE coupons SET
                    code = ?,
                    description = ?,
                    discount_type = ?,
                    discount_value = ?,
                    min_order_total = ?,
                    max_uses = ?,
                    valid_until = ?,
                    channels = ?,
                    active = ?
                WHERE id = ?
            `, [
                cleanCode,
                description.trim(),
                discount_type === 'FIXED' ? 'FIXED' : 'PERCENT',
                parsedValue,
                Math.max(0, parseFloat(min_order_total) || 0),
                Math.max(0, parseInt(max_uses, 10) || 0),
                valid_until ? valid_until : null,
                channelsJson,
                active ? 1 : 0,
                id
            ]);

            const updated = await dbGetAsync("SELECT * FROM coupons WHERE id = ?", [id]);
            if (updated) {
                updated.channels = JSON.parse(updated.channels || '[]');
            }

            if (io) io.emit('coupon_changed', { action: 'update', coupon: updated });
            res.json(updated);
        } catch (err) {
            console.error('Error updating coupon:', err);
            res.status(500).json({ error: err.message || 'Error al actualizar cupón' });
        }
    });

    // Toggle activo cupón
    router.patch('/coupons/:id/toggle', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await dbGetAsync("SELECT active FROM coupons WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Cupón no encontrado' });
            }
            const nextActive = existing.active ? 0 : 1;
            await dbRunAsync("UPDATE coupons SET active = ? WHERE id = ?", [nextActive, id]);

            if (io) io.emit('coupon_changed', { action: 'toggle', id, active: nextActive });
            res.json({ id, active: nextActive });
        } catch (err) {
            console.error('Error toggling coupon:', err);
            res.status(500).json({ error: 'Error al cambiar estado de cupón' });
        }
    });

    // Eliminar cupón
    router.delete('/coupons/:id', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await dbGetAsync("SELECT id FROM coupons WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Cupón no encontrado' });
            }

            await dbRunAsync("DELETE FROM coupons WHERE id = ?", [id]);
            if (io) io.emit('coupon_changed', { action: 'delete', id });
            res.json({ message: 'Cupón eliminado correctamente' });
        } catch (err) {
            console.error('Error deleting coupon:', err);
            res.status(500).json({ error: 'Error al eliminar cupón' });
        }
    });

    // =========================================================================
    // VALIDACIÓN PÚBLICA DE CUPÓN (Para Carrito Cliente y Comanda Mesero / Caja)
    // =========================================================================
    router.post('/coupons/validate', async (req, res) => {
        try {
            const { code, order_total = 0, channel = 'Domicilio' } = req.body;
            const cleanCode = (code || '').trim().toUpperCase();

            if (!cleanCode) {
                return res.json({ valid: false, error: 'Por favor ingresa un código de cupón' });
            }

            const coupon = await dbGetAsync("SELECT * FROM coupons WHERE code = ?", [cleanCode]);
            if (!coupon) {
                return res.json({ valid: false, error: 'El código de cupón no existe' });
            }

            if (!coupon.active) {
                return res.json({ valid: false, error: 'Este cupón se encuentra inactivo' });
            }

            // Validar expiración
            if (coupon.valid_until) {
                const now = new Date();
                const validUntil = new Date(coupon.valid_until);
                // Si la fecha es válida y ya pasó el final del día
                if (!isNaN(validUntil.getTime()) && now > validUntil) {
                    return res.json({ valid: false, error: 'Este cupón ha expirado' });
                }
            }

            // Validar usos máximos
            if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
                return res.json({ valid: false, error: 'Este cupón ha alcanzado el límite máximo de usos' });
            }

            // Validar canal
            let allowedChannels = [];
            try {
                allowedChannels = JSON.parse(coupon.channels || '[]');
            } catch (e) {
                allowedChannels = ['Local', 'Domicilio', 'Para Llevar'];
            }
            if (allowedChannels.length > 0 && !allowedChannels.includes(channel)) {
                return res.json({
                    valid: false,
                    error: `Este cupón no es válido para pedidos de tipo ${channel} (válido para: ${allowedChannels.join(', ')})`
                });
            }

            // Validar total mínimo
            const currentSubtotal = Math.max(0, parseFloat(order_total) || 0);
            if (coupon.min_order_total > 0 && currentSubtotal < coupon.min_order_total) {
                return res.json({
                    valid: false,
                    error: `El pedido debe ser de al menos $${coupon.min_order_total.toLocaleString('es-CO')} para aplicar este cupón`
                });
            }

            // Calcular monto de descuento
            let discountAmount = 0;
            if (coupon.discount_type === 'PERCENT') {
                discountAmount = Math.round((currentSubtotal * coupon.discount_value) / 100);
            } else {
                discountAmount = Math.min(currentSubtotal, coupon.discount_value);
            }

            return res.json({
                valid: true,
                coupon: {
                    id: coupon.id,
                    code: coupon.code,
                    description: coupon.description,
                    discount_type: coupon.discount_type,
                    discount_value: coupon.discount_value,
                    min_order_total: coupon.min_order_total
                },
                discountAmount,
                discountReason: `Cupón: ${coupon.code} (${coupon.discount_type === 'PERCENT' ? coupon.discount_value + '%' : '$' + coupon.discount_value.toLocaleString('es-CO')})`
            });
        } catch (err) {
            console.error('Error validating coupon:', err);
            res.status(500).json({ valid: false, error: 'Error interno al validar cupón' });
        }
    });

    // =========================================================================
    // CAMPAÑAS DE DESCUENTO (ADMIN / CAJERO)
    // =========================================================================

    // Listar campañas
    router.get('/discount-campaigns', verifyToken, requireRole(['admin', 'cajero']), async (req, res) => {
        try {
            const rows = await dbAllAsync("SELECT * FROM discount_campaigns ORDER BY created_at DESC");
            const parsed = rows.map(r => ({
                ...r,
                product_ids: typeof r.product_ids === 'string' ? JSON.parse(r.product_ids || '[]') : r.product_ids,
                days_of_week: typeof r.days_of_week === 'string' ? JSON.parse(r.days_of_week || '[]') : r.days_of_week,
                channels: typeof r.channels === 'string' ? JSON.parse(r.channels || '[]') : r.channels
            }));
            res.json(parsed);
        } catch (err) {
            console.error('Error fetching discount campaigns:', err);
            res.status(500).json({ error: 'Error al obtener campañas' });
        }
    });

    // Crear campaña
    router.post('/discount-campaigns', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const {
                name,
                description = '',
                discount_percent = 0,
                scope = 'ALL', // 'ALL', 'CATEGORY', 'SELECTED_PRODUCTS'
                category_id = null,
                category_name = null,
                product_ids = [],
                start_date = null,
                end_date = null,
                start_time = null,
                end_time = null,
                days_of_week = ['1', '2', '3', '4', '5', '6', '7'],
                channels = ['Local', 'Domicilio', 'Para Llevar'],
                active = 1
            } = req.body;

            const cleanName = (name || '').trim();
            if (!cleanName) {
                return res.status(400).json({ error: 'El nombre de la campaña es obligatorio' });
            }

            const parsedPercent = Math.max(0, parseFloat(discount_percent) || 0);
            if (parsedPercent <= 0 || parsedPercent > 100) {
                return res.status(400).json({ error: 'El porcentaje de descuento debe estar entre 1% y 100%' });
            }

            const id = uuidv4();
            const productIdsJson = JSON.stringify(Array.isArray(product_ids) ? product_ids : []);
            const daysJson = JSON.stringify(Array.isArray(days_of_week) ? days_of_week : ['1', '2', '3', '4', '5', '6', '7']);
            const channelsJson = JSON.stringify(Array.isArray(channels) ? channels : ['Local', 'Domicilio', 'Para Llevar']);

            await dbRunAsync(`
                INSERT INTO discount_campaigns (
                    id, name, description, discount_percent, scope,
                    category_id, category_name, product_ids,
                    start_date, end_date, start_time, end_time,
                    days_of_week, channels, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                cleanName,
                description.trim(),
                parsedPercent,
                scope,
                category_id || null,
                category_name || null,
                productIdsJson,
                start_date || null,
                end_date || null,
                start_time || null,
                end_time || null,
                daysJson,
                channelsJson,
                active ? 1 : 0
            ]);

            const created = await dbGetAsync("SELECT * FROM discount_campaigns WHERE id = ?", [id]);
            if (created) {
                created.product_ids = JSON.parse(created.product_ids || '[]');
                created.days_of_week = JSON.parse(created.days_of_week || '[]');
                created.channels = JSON.parse(created.channels || '[]');
            }

            if (io) io.emit('campaign_changed', { action: 'create', campaign: created });
            res.status(201).json(created);
        } catch (err) {
            console.error('Error creating discount campaign:', err);
            res.status(500).json({ error: err.message || 'Error al crear campaña' });
        }
    });

    // Actualizar campaña
    router.put('/discount-campaigns/:id', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const {
                name,
                description = '',
                discount_percent = 0,
                scope = 'ALL',
                category_id = null,
                category_name = null,
                product_ids = [],
                start_date = null,
                end_date = null,
                start_time = null,
                end_time = null,
                days_of_week = ['1', '2', '3', '4', '5', '6', '7'],
                channels = ['Local', 'Domicilio', 'Para Llevar'],
                active = 1
            } = req.body;

            const existing = await dbGetAsync("SELECT id FROM discount_campaigns WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Campaña no encontrada' });
            }

            const cleanName = (name || '').trim();
            if (!cleanName) {
                return res.status(400).json({ error: 'El nombre de la campaña es obligatorio' });
            }

            const parsedPercent = Math.max(0, parseFloat(discount_percent) || 0);
            if (parsedPercent <= 0 || parsedPercent > 100) {
                return res.status(400).json({ error: 'El porcentaje de descuento debe estar entre 1% y 100%' });
            }

            const productIdsJson = JSON.stringify(Array.isArray(product_ids) ? product_ids : []);
            const daysJson = JSON.stringify(Array.isArray(days_of_week) ? days_of_week : ['1', '2', '3', '4', '5', '6', '7']);
            const channelsJson = JSON.stringify(Array.isArray(channels) ? channels : ['Local', 'Domicilio', 'Para Llevar']);

            await dbRunAsync(`
                UPDATE discount_campaigns SET
                    name = ?,
                    description = ?,
                    discount_percent = ?,
                    scope = ?,
                    category_id = ?,
                    category_name = ?,
                    product_ids = ?,
                    start_date = ?,
                    end_date = ?,
                    start_time = ?,
                    end_time = ?,
                    days_of_week = ?,
                    channels = ?,
                    active = ?
                WHERE id = ?
            `, [
                cleanName,
                description.trim(),
                parsedPercent,
                scope,
                category_id || null,
                category_name || null,
                productIdsJson,
                start_date || null,
                end_date || null,
                start_time || null,
                end_time || null,
                daysJson,
                channelsJson,
                active ? 1 : 0,
                id
            ]);

            const updated = await dbGetAsync("SELECT * FROM discount_campaigns WHERE id = ?", [id]);
            if (updated) {
                updated.product_ids = JSON.parse(updated.product_ids || '[]');
                updated.days_of_week = JSON.parse(updated.days_of_week || '[]');
                updated.channels = JSON.parse(updated.channels || '[]');
            }

            if (io) io.emit('campaign_changed', { action: 'update', campaign: updated });
            res.json(updated);
        } catch (err) {
            console.error('Error updating campaign:', err);
            res.status(500).json({ error: err.message || 'Error al actualizar campaña' });
        }
    });

    // Toggle activo campaña
    router.patch('/discount-campaigns/:id/toggle', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await dbGetAsync("SELECT active FROM discount_campaigns WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Campaña no encontrada' });
            }
            const nextActive = existing.active ? 0 : 1;
            await dbRunAsync("UPDATE discount_campaigns SET active = ? WHERE id = ?", [nextActive, id]);

            if (io) io.emit('campaign_changed', { action: 'toggle', id, active: nextActive });
            res.json({ id, active: nextActive });
        } catch (err) {
            console.error('Error toggling campaign:', err);
            res.status(500).json({ error: 'Error al cambiar estado de campaña' });
        }
    });

    // Eliminar campaña
    router.delete('/discount-campaigns/:id', verifyToken, requireRole(['admin']), async (req, res) => {
        try {
            const { id } = req.params;
            const existing = await dbGetAsync("SELECT id FROM discount_campaigns WHERE id = ?", [id]);
            if (!existing) {
                return res.status(404).json({ error: 'Campaña no encontrada' });
            }

            await dbRunAsync("DELETE FROM discount_campaigns WHERE id = ?", [id]);
            if (io) io.emit('campaign_changed', { action: 'delete', id });
            res.json({ message: 'Campaña eliminada correctamente' });
        } catch (err) {
            console.error('Error deleting campaign:', err);
            res.status(500).json({ error: 'Error al eliminar campaña' });
        }
    });

    // =========================================================================
    // ENDPOINT PÚBLICO: DESCUENTOS Y CAMPAÑAS ACTIVAS (Para el Menú Web y App)
    // =========================================================================
    router.get('/active-discounts', async (req, res) => {
        try {
            const now = new Date();
            // Formatos locales YYYY-MM-DD y HH:MM
            const todayStr = now.toISOString().slice(0, 10);
            const currentHours = String(now.getHours()).padStart(2, '0');
            const currentMins = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${currentHours}:${currentMins}`;
            // Día de la semana (1 = Lunes, ..., 7 = Domingo)
            const dayOfWeek = String(now.getDay() === 0 ? 7 : now.getDay());

            const campaigns = await dbAllAsync(`
                SELECT * FROM discount_campaigns 
                WHERE active = 1
            `);

            const activeCampaigns = campaigns.filter(c => {
                // Filtro fecha inicio y fin
                if (c.start_date && todayStr < c.start_date) return false;
                if (c.end_date && todayStr > c.end_date) return false;

                // Filtro horario
                if (c.start_time && currentTimeStr < c.start_time) return false;
                if (c.end_time && currentTimeStr > c.end_time) return false;

                // Filtro días de la semana
                let days = ['1', '2', '3', '4', '5', '6', '7'];
                try {
                    days = JSON.parse(c.days_of_week || '[]');
                } catch (e) { }
                if (days.length > 0 && !days.includes(dayOfWeek)) return false;

                return true;
            }).map(c => ({
                id: c.id,
                name: c.name,
                description: c.description,
                discount_percent: c.discount_percent,
                scope: c.scope,
                category_id: c.category_id,
                category_name: c.category_name,
                product_ids: typeof c.product_ids === 'string' ? JSON.parse(c.product_ids || '[]') : c.product_ids,
                channels: typeof c.channels === 'string' ? JSON.parse(c.channels || '[]') : c.channels
            }));

            res.json({
                activeCampaigns
            });
        } catch (err) {
            console.error('Error fetching active discounts:', err);
            res.status(500).json({ error: 'Error al consultar descuentos activos' });
        }
    });

    return router;
};
