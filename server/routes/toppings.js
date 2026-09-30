const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken, requireRole } = require('./auth');
const { v4: uuidv4 } = require('uuid');

module.exports = (io) => {

    // --- GET ALL TOPPINGS (WITH DIRECT OR LINKED INVENTORY STOCK) ---
    router.get('/toppings', (req, res) => {
        const sql = `
            SELECT t.*, 
                   s.name as linked_supply_name,
                   s.unit as linked_supply_unit,
                   s.current_stock as linked_supply_stock,
                   CASE 
                       WHEN t.inventory_mode = 'linked_supply' AND s.id IS NOT NULL THEN
                           CASE 
                               WHEN COALESCE(t.supply_quantity, 1) > 0 THEN 
                                   FLOOR(COALESCE(s.current_stock, 0) / t.supply_quantity)
                               ELSE 0
                           END
                       ELSE COALESCE(t.stock, 0)
                   END as current_stock,
                   COALESCE(t.min_stock, 5) as min_stock,
                   'und' as unit
            FROM toppings t
            LEFT JOIN supplies s ON s.id = t.supply_id
            ORDER BY t.group_name ASC, t.name ASC
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // --- CREATE TOPPING (OPTION C: DIRECT STOCK OR LINKED KITCHEN SUPPLY) ---
    router.post('/toppings', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const {
            name,
            group_name,
            price,
            available,
            inventory_mode,
            stock,
            current_stock,
            min_stock,
            supply_id,
            supply_quantity
        } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'El nombre del topping es requerido' });
        }

        const cleanName = name.trim().slice(0, 100);
        const cleanGroup = (group_name && typeof group_name === 'string') ? group_name.trim().slice(0, 50) : 'General';
        const numPrice = !isNaN(parseFloat(price)) ? Math.max(0, parseFloat(price)) : 0;
        const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;
        const newId = req.body.id || `top_${uuidv4()}`;

        const mode = inventory_mode === 'linked_supply' ? 'linked_supply' : 'direct';
        const initialStock = !isNaN(parseFloat(stock ?? current_stock)) ? Math.max(0, parseFloat(stock ?? current_stock)) : 0;
        const alertMinStock = !isNaN(parseFloat(min_stock)) ? Math.max(0, parseFloat(min_stock)) : 5;
        const cleanSupplyId = (supply_id && typeof supply_id === 'string' && supply_id.trim()) ? supply_id.trim() : null;
        const cleanSupplyQty = !isNaN(parseFloat(supply_quantity)) && parseFloat(supply_quantity) > 0 ? parseFloat(supply_quantity) : 1;

        const sql = `
            INSERT INTO toppings (id, name, group_name, price, available, inventory_mode, stock, min_stock, supply_id, supply_quantity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            newId,
            cleanName,
            cleanGroup,
            numPrice,
            isAvail,
            mode,
            mode === 'direct' ? initialStock : 0,
            alertMinStock,
            mode === 'linked_supply' ? cleanSupplyId : null,
            mode === 'linked_supply' ? cleanSupplyQty : 1
        ];

        db.run(sql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // Si es stock propio directo y tiene stock inicial, registrar en movimientos de inventario
            if (mode === 'direct' && initialStock > 0) {
                db.run(
                    `INSERT INTO inventory_movements (supply_id, supply_name, type, quantity, stock_after, notes, user_name) 
                     VALUES (?, ?, 'ENTRADA_COMPRA', ?, ?, ?, ?)`,
                    [newId, `Topping: ${cleanName}`, initialStock, initialStock, 'Stock inicial de porciones al crear topping', req.user?.name || 'Admin']
                );
            }

            const createdTopping = {
                id: newId,
                name: cleanName,
                group_name: cleanGroup,
                price: numPrice,
                available: isAvail,
                inventory_mode: mode,
                stock: mode === 'direct' ? initialStock : 0,
                current_stock: mode === 'direct' ? initialStock : 0,
                min_stock: alertMinStock,
                supply_id: cleanSupplyId,
                supply_quantity: cleanSupplyQty,
                unit: 'und'
            };

            io.emit('toppings_updated');
            if (io.to) {
                io.to('admin').emit('inventory_updated', { type: 'topping_created', id: newId });
                io.to('cajero').emit('inventory_updated', { type: 'topping_created', id: newId });
            }
            res.status(201).json(createdTopping);
        });
    });

    // --- UPDATE TOPPING ---
    router.put('/toppings/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        const {
            name,
            group_name,
            price,
            available,
            inventory_mode,
            stock,
            current_stock,
            min_stock,
            supply_id,
            supply_quantity
        } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'El nombre del topping es requerido' });
        }

        const cleanName = name.trim().slice(0, 100);
        const cleanGroup = (group_name && typeof group_name === 'string') ? group_name.trim().slice(0, 50) : 'General';
        const numPrice = !isNaN(parseFloat(price)) ? Math.max(0, parseFloat(price)) : 0;
        const isAvail = (available === 1 || available === '1' || available === true || available === 'true') ? 1 : 0;
        const mode = inventory_mode === 'linked_supply' ? 'linked_supply' : 'direct';
        const cleanSupplyId = (supply_id && typeof supply_id === 'string' && supply_id.trim()) ? supply_id.trim() : null;
        const cleanSupplyQty = !isNaN(parseFloat(supply_quantity)) && parseFloat(supply_quantity) > 0 ? parseFloat(supply_quantity) : 1;
        const alertMinStock = !isNaN(parseFloat(min_stock)) ? Math.max(0, parseFloat(min_stock)) : 5;

        // Construir query dinámica para no pisar el stock directo si no se envía
        let updateSql = `
            UPDATE toppings 
            SET name = ?, group_name = ?, price = ?, available = ?, inventory_mode = ?, min_stock = ?, supply_id = ?, supply_quantity = ?
        `;
        const params = [
            cleanName,
            cleanGroup,
            numPrice,
            isAvail,
            mode,
            alertMinStock,
            mode === 'linked_supply' ? cleanSupplyId : null,
            cleanSupplyQty
        ];

        if (stock !== undefined || current_stock !== undefined) {
            const newStockVal = Math.max(0, parseFloat(stock ?? current_stock) || 0);
            updateSql += `, stock = ?`;
            params.push(newStockVal);
        }

        updateSql += ` WHERE id = ?`;
        params.push(id);

        db.run(updateSql, params, function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Topping no encontrado' });

            io.emit('toppings_updated');
            if (io.to) {
                io.to('admin').emit('inventory_updated', { type: 'topping_updated', id });
                io.to('cajero').emit('inventory_updated', { type: 'topping_updated', id });
            }
            res.json({
                id,
                name: cleanName,
                group_name: cleanGroup,
                price: numPrice,
                available: isAvail,
                inventory_mode: mode
            });
        });
    });

    // --- TOGGLE AVAILABILITY ---
    router.patch('/toppings/:id/toggle', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;

        db.get("SELECT available FROM toppings WHERE id = ?", [id], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Topping no encontrado' });

            const newAvailable = row.available === 1 ? 0 : 1;
            db.run("UPDATE toppings SET available = ? WHERE id = ?", [newAvailable, id], function (updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });

                io.emit('toppings_updated');
                res.json({ id, available: newAvailable });
            });
        });
    });

    // --- DELETE TOPPING ---
    router.delete('/toppings/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;

        db.run("DELETE FROM toppings WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Topping no encontrado' });

            io.emit('toppings_updated');
            if (io.to) {
                io.to('admin').emit('inventory_updated', { type: 'topping_deleted', id });
                io.to('cajero').emit('inventory_updated', { type: 'topping_deleted', id });
            }
            res.json({ success: true, message: 'Topping eliminado exitosamente' });
        });
    });

    return router;
};
