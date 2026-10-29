const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireRole } = require('./auth');
const { csvUpload } = require('../middleware/upload');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const fs = require('fs');
const { convertUnit, getCompatibleUnits } = require('../utils/unitConverter');

module.exports = (io) => {
    // =============================================
    // RESUMEN GENERAL DE INVENTARIO
    // =============================================
    router.get('/inventory/summary', verifyToken, (req, res) => {
        const query = `
            SELECT 
                COUNT(*) as total_supplies,
                SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END) as out_of_stock,
                SUM(CASE WHEN current_stock > 0 AND current_stock <= min_stock THEN 1 ELSE 0 END) as low_stock,
                SUM(current_stock * cost_per_unit) as total_value
            FROM supplies
        `;
        db.get(query, [], (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                total_supplies: row?.total_supplies || 0,
                out_of_stock: row?.out_of_stock || 0,
                low_stock: row?.low_stock || 0,
                total_value: row?.total_value || 0
            });
        });
    });

    // =============================================
    // INSUMOS (ALIMENTOS / MATERIA PRIMA)
    // =============================================

    // Listar todos los insumos
    router.get('/inventory/supplies', verifyToken, (req, res) => {
        const sql = `
            SELECT 
                id, name, unit, current_stock, min_stock, cost_per_unit, created_at,
                (current_stock <= min_stock) as is_low_stock,
                (current_stock <= 0) as is_out_of_stock,
                (current_stock * cost_per_unit) as total_cost
            FROM supplies
            ORDER BY name ASC
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    // Exportar insumos a CSV
    router.get('/inventory/supplies/export', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const sql = `SELECT id, name, unit, current_stock, min_stock, cost_per_unit, created_at FROM supplies ORDER BY name ASC`;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                const fields = ['id', 'name', 'unit', 'current_stock', 'min_stock', 'cost_per_unit', 'created_at'];
                const parser = new Parser({ fields });
                const csvData = parser.parse(rows);

                res.header('Content-Type', 'text/csv; charset=utf-8');
                res.header('Content-Disposition', 'attachment; filename=insumos_digirest.csv');
                res.send(csvData);
            } catch (err) {
                console.error('Error generating supplies CSV:', err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    // Importar insumos desde CSV
    router.post('/inventory/supplies/import', verifyToken, requireRole(['admin']), csvUpload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No se subió ningún archivo" });
        }

        const filePath = req.file.path;
        const results = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                let processed = 0;
                let errors = 0;

                const dbRun = (sql, params) => {
                    return new Promise((resolve, reject) => {
                        db.run(sql, params, function (err) {
                            if (err) reject(err);
                            else resolve(this);
                        });
                    });
                };

                const processBatch = async () => {
                    for (const row of results) {
                        try {
                            const name = (row.name || row.nombre || row.insumo || '').trim();
                            if (!name) continue;

                            const unit = (row.unit || row.unidad || row.medida || 'und').trim();
                            const current_stock = parseFloat(String(row.current_stock ?? row.stock_actual ?? row.stock ?? row.cantidad ?? 0).replace(/[^0-9.-]/g, '')) || 0;
                            const min_stock = parseFloat(String(row.min_stock ?? row.stock_minimo ?? row.minimo ?? 0).replace(/[^0-9.-]/g, '')) || 0;
                            const cost_per_unit = parseFloat(String(row.cost_per_unit ?? row.costo_unitario ?? row.costo ?? 0).replace(/[^0-9.-]/g, '')) || 0;

                            let existing = null;
                            if (row.id) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM supplies WHERE id = ?", [row.id], (err, r) => resolve(r));
                                });
                            }
                            if (!existing) {
                                existing = await new Promise((resolve) => {
                                    db.get("SELECT id FROM supplies WHERE LOWER(name) = LOWER(?)", [name], (err, r) => resolve(r));
                                });
                            }

                            if (existing) {
                                await dbRun(
                                    "UPDATE supplies SET name = ?, unit = ?, current_stock = ?, min_stock = ?, cost_per_unit = ? WHERE id = ?",
                                    [name, unit, current_stock, min_stock, cost_per_unit, existing.id]
                                );
                            } else {
                                const newId = row.id || uuidv4();
                                await dbRun(
                                    "INSERT INTO supplies (id, name, unit, current_stock, min_stock, cost_per_unit) VALUES (?, ?, ?, ?, ?, ?)",
                                    [newId, name, unit, current_stock, min_stock, cost_per_unit]
                                );
                            }
                            processed++;
                        } catch (e) {
                            console.error("Import Error supply row:", row, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    if (io) {
                        io.emit('supplies_updated');
                        io.emit('inventory_updated', { type: 'supplies_imported' });
                    }
                    res.json({ message: `Importación completada. Insumos procesados: ${processed}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

    // Crear insumo
    router.post('/inventory/supplies', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { name, unit, current_stock, min_stock, cost_per_unit } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del insumo es obligatorio' });
        }

        const id = uuidv4();
        const cleanName = name.trim();
        const cleanUnit = (unit || 'und').trim().toLowerCase();
        const stock = parseFloat(current_stock) || 0;
        const min = parseFloat(min_stock) || 0;
        const cost = parseFloat(cost_per_unit) || 0;

        const sql = `
            INSERT INTO supplies (id, name, unit, current_stock, min_stock, cost_per_unit)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.run(sql, [id, cleanName, cleanUnit, stock, min, cost], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // Registrar movimiento inicial si stock > 0
            if (stock > 0) {
                db.run(
                    `INSERT INTO inventory_movements 
                     (supply_id, supply_name, type, quantity, stock_after, notes, user_name) 
                     VALUES (?, ?, 'AJUSTE_MANUAL', ?, ?, 'Inventario inicial', ?)`,
                    [id, cleanName, stock, stock, req.user?.name || 'Admin']
                );
            }

            if (io) {
                io.emit('inventory_updated', { type: 'supply_created', id });
                io.emit('supplies_updated', { type: 'supply_created', id });
            }

            res.status(201).json({
                message: 'Insumo creado exitosamente',
                supply: { id, name: cleanName, unit: cleanUnit, current_stock: stock, min_stock: min, cost_per_unit: cost }
            });
        });
    });

    // Editar insumo
    router.put('/inventory/supplies/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        const { name, unit, min_stock, cost_per_unit } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'El nombre del insumo es obligatorio' });
        }

        const cleanName = name.trim();
        const cleanUnit = (unit || 'und').trim().toLowerCase();
        const min = parseFloat(min_stock) || 0;
        const cost = parseFloat(cost_per_unit) || 0;

        const sql = `
            UPDATE supplies 
            SET name = ?, unit = ?, min_stock = ?, cost_per_unit = ?
            WHERE id = ?
        `;

        db.run(sql, [cleanName, cleanUnit, min, cost, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado' });

            if (io) {
                io.emit('inventory_updated', { type: 'supply_updated', id });
                io.emit('supplies_updated', { type: 'supply_updated', id });
            }

            res.json({ message: 'Insumo actualizado exitosamente' });
        });
    });

    // Ajuste de stock rápido (Entrada de compra, Merma o Ajuste manual)
    router.post('/inventory/supplies/:id/adjust', verifyToken, requireRole(['admin', 'cajero', 'chef', 'cocinero']), (req, res) => {
        const { id } = req.params;
        const { amount, type, notes } = req.body; // type: 'ENTRADA_COMPRA' | 'MERMA' | 'AJUSTE_MANUAL'

        const adjustAmount = parseFloat(amount);
        if (isNaN(adjustAmount) || adjustAmount === 0) {
            return res.status(400).json({ error: 'Cantidad de ajuste inválida' });
        }

        const validTypes = ['ENTRADA_COMPRA', 'MERMA', 'AJUSTE_MANUAL'];
        const movementType = validTypes.includes(type) ? type : 'AJUSTE_MANUAL';

        db.get('SELECT name, current_stock FROM supplies WHERE id = ?', [id], (err, supply) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!supply) return res.status(404).json({ error: 'Insumo no encontrado' });

            const newStock = supply.current_stock + adjustAmount;

            db.run('UPDATE supplies SET current_stock = ? WHERE id = ?', [newStock, id], function (updErr) {
                if (updErr) return res.status(500).json({ error: updErr.message });

                // Registrar en kárdex
                db.run(
                    `INSERT INTO inventory_movements 
                     (supply_id, supply_name, type, quantity, stock_after, notes, user_name) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, supply.name, movementType, adjustAmount, newStock, notes || '', req.user?.name || 'Admin'],
                    () => {
                        if (io) {
                            io.emit('inventory_updated', { type: 'stock_adjusted', id });
                            io.emit('supplies_updated', { type: 'stock_adjusted', id });
                        }
                        res.json({
                            message: 'Stock ajustado exitosamente',
                            newStock,
                            supply: supply.name
                        });
                    }
                );
            });
        });
    });

    // Eliminar insumo
    router.delete('/inventory/supplies/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;

        // Verificar si se usa en recetas
        db.all(
            `SELECT r.name as recipe_name FROM recipe_items ri 
             JOIN recipes r ON r.id = ri.recipe_id 
             WHERE ri.supply_id = ?`,
            [id],
            (err, recipes) => {
                if (err) return res.status(500).json({ error: err.message });

                if (recipes && recipes.length > 0) {
                    const names = recipes.map(r => r.recipe_name).join(', ');
                    return res.status(400).json({
                        error: `No se puede eliminar: el insumo está en uso en las recetas: ${names}`
                    });
                }

                db.run('DELETE FROM supplies WHERE id = ?', [id], function (delErr) {
                    if (delErr) return res.status(500).json({ error: delErr.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado' });

                    if (io) {
                        io.emit('inventory_updated', { type: 'supply_deleted', id });
                        io.emit('supplies_updated', { type: 'supply_deleted', id });
                    }
                    res.json({ message: 'Insumo eliminado exitosamente' });
                });
            }
        );
    });

    // =============================================
    // RECETAS Y ESCANDALLOS
    // =============================================

    // Endpoint para unidades compatibles
    router.get('/inventory/units/compatible', verifyToken, (req, res) => {
        const { unit } = req.query;
        res.json({
            unit: unit || '',
            compatible_units: getCompatibleUnits(unit || '')
        });
    });

    // Listar recetas con ingredientes y costo estimado (con soporte para variantes y unidades)
    router.get('/inventory/recipes', verifyToken, (req, res) => {
        const sql = `
            SELECT 
                r.id, r.product_id, r.variant_id, r.variant_name, r.name, r.yield, r.instructions, r.created_at,
                p.name as product_name, p.price as product_price, p.category as product_category,
                p.has_variants, p.variants_config
            FROM recipes r
            LEFT JOIN products p ON p.id = r.product_id
            ORDER BY r.name ASC
        `;

        db.all(sql, [], (err, recipes) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!recipes || recipes.length === 0) return res.json([]);

            const itemSql = `
                SELECT 
                    ri.id, ri.recipe_id, ri.supply_id, ri.quantity, ri.unit as recipe_unit,
                    s.name as supply_name, s.unit as supply_unit, s.cost_per_unit, s.current_stock
                FROM recipe_items ri
                JOIN supplies s ON s.id = ri.supply_id
            `;

            db.all(itemSql, [], (iErr, allItems) => {
                if (iErr) return res.status(500).json({ error: iErr.message });

                const itemsByRecipeId = new Map();
                (allItems || []).forEach(item => {
                    const effectiveUnit = item.recipe_unit || item.supply_unit;
                    const qtyInSupplyUnit = convertUnit(item.quantity, effectiveUnit, item.supply_unit);
                    const itemCost = qtyInSupplyUnit * (item.cost_per_unit || 0);
                    const enrichedItem = {
                        ...item,
                        unit: effectiveUnit,
                        item_cost: Math.round(itemCost * 100) / 100
                    };
                    if (!itemsByRecipeId.has(item.recipe_id)) {
                        itemsByRecipeId.set(item.recipe_id, []);
                    }
                    itemsByRecipeId.get(item.recipe_id).push(enrichedItem);
                });

                const fullRecipes = recipes.map(rec => {
                    const recipeItems = itemsByRecipeId.get(rec.id) || [];
                    const totalCost = recipeItems.reduce((acc, curr) => acc + (curr.item_cost || 0), 0);

                    let effectivePrice = rec.product_price || 0;
                    if (rec.variant_id && rec.variants_config) {
                        try {
                            const vars = JSON.parse(rec.variants_config);
                            const matchedVar = vars.find(v => String(v.id) === String(rec.variant_id) || v.name === rec.variant_name);
                            if (matchedVar && matchedVar.price !== undefined) {
                                effectivePrice = parseFloat(matchedVar.price) || effectivePrice;
                            }
                        } catch (e) {}
                    }

                    const foodCostPct = effectivePrice > 0 ? ((totalCost / effectivePrice) * 100) : 0;
                    const margin = effectivePrice - totalCost;

                    return {
                        ...rec,
                        items: recipeItems,
                        total_cost: Math.round(totalCost * 100) / 100,
                        effective_price: effectivePrice,
                        margin: Math.round(margin * 100) / 100,
                        food_cost_pct: Math.round(foodCostPct * 10) / 10
                    };
                });

                res.json(fullRecipes);
            });
        });
    });

    // Obtener receta de un plato específico (soporta ?variant_id=...)
    router.get('/inventory/recipes/product/:productId', verifyToken, (req, res) => {
        const { productId } = req.params;
        const { variant_id } = req.query;

        let sql = 'SELECT * FROM recipes WHERE product_id = ?';
        let params = [productId];

        if (variant_id !== undefined && variant_id !== null && variant_id !== '') {
            sql += ' AND (variant_id = ? OR (variant_id IS NULL AND ? = ""))';
            params.push(variant_id, variant_id);
        }

        db.all(sql, params, (err, recipes) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!recipes || recipes.length === 0) {
                // Si buscó una variante específica pero aún no tiene receta propia, fallback a receta general
                if (variant_id) {
                    return db.get('SELECT * FROM recipes WHERE product_id = ? AND (variant_id IS NULL OR variant_id = "")', [productId], (fbErr, fbRecipe) => {
                        if (fbErr || !fbRecipe) return res.json({ exists: false, recipe: null, recipes: [] });
                        fetchRecipeDetails(fbRecipe, [fbRecipe]);
                    });
                }
                return res.json({ exists: false, recipe: null, recipes: [] });
            }

            fetchRecipeDetails(recipes[0], recipes);

            function fetchRecipeDetails(primaryRecipe, allRecipes) {
                const itemSql = `
                    SELECT 
                        ri.id, ri.supply_id, ri.quantity, ri.unit as recipe_unit,
                        s.name as supply_name, s.unit as supply_unit, s.cost_per_unit, s.current_stock
                    FROM recipe_items ri
                    JOIN supplies s ON s.id = ri.supply_id
                    WHERE ri.recipe_id = ?
                `;

                db.all(itemSql, [primaryRecipe.id], (iErr, items) => {
                    if (iErr) return res.status(500).json({ error: iErr.message });
                    const recipeItems = (items || []).map(item => {
                        const effectiveUnit = item.recipe_unit || item.supply_unit;
                        const qtyInSupplyUnit = convertUnit(item.quantity, effectiveUnit, item.supply_unit);
                        const itemCost = qtyInSupplyUnit * (item.cost_per_unit || 0);
                        return {
                            ...item,
                            unit: effectiveUnit,
                            item_cost: Math.round(itemCost * 100) / 100
                        };
                    });
                    const totalCost = recipeItems.reduce((acc, curr) => acc + (curr.item_cost || 0), 0);
                    res.json({
                        exists: true,
                        recipe: {
                            ...primaryRecipe,
                            items: recipeItems,
                            total_cost: Math.round(totalCost * 100) / 100
                        },
                        recipes: allRecipes
                    });
                });
            }
        });
    });

    // Guardar (Crear o Actualizar) receta para un plato o variante
    router.post('/inventory/recipes', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { product_id, variant_id, variant_name, name, yield: recipeYield, instructions, items } = req.body;

        if (!product_id) {
            return res.status(400).json({ error: 'Debes seleccionar un plato para vincular la receta' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'La receta debe incluir al menos un insumo/ingrediente' });
        }

        db.get('SELECT id, name, has_variants, variants_config FROM products WHERE id = ?', [product_id], (pErr, product) => {
            if (pErr || !product) {
                return res.status(404).json({ error: 'El plato seleccionado no existe' });
            }

            const cleanVariantId = variant_id && String(variant_id).trim() !== '' ? String(variant_id).trim() : null;
            let cleanVariantName = variant_name && String(variant_name).trim() !== '' ? String(variant_name).trim() : null;

            if (cleanVariantId && !cleanVariantName && product.variants_config) {
                try {
                    const vars = JSON.parse(product.variants_config);
                    const matched = vars.find(v => String(v.id) === cleanVariantId);
                    if (matched) cleanVariantName = matched.name;
                } catch (e) {}
            }

            let recipeName = (name && name.trim()) || product.name;
            if (cleanVariantName && !recipeName.toLowerCase().includes(cleanVariantName.toLowerCase())) {
                recipeName = `${recipeName} (${cleanVariantName})`;
            }

            const yieldVal = parseInt(recipeYield, 10) || 1;
            const recipeInstructions = instructions || '';

            // Verificar si ya existe una receta para este plato y variante
            const checkSql = cleanVariantId 
                ? 'SELECT id FROM recipes WHERE product_id = ? AND variant_id = ?'
                : 'SELECT id FROM recipes WHERE product_id = ? AND (variant_id IS NULL OR variant_id = "")';
            const checkParams = cleanVariantId ? [product_id, cleanVariantId] : [product_id];

            db.get(checkSql, checkParams, (rErr, existingRecipe) => {
                if (rErr) return res.status(500).json({ error: rErr.message });

                const recipeId = existingRecipe ? existingRecipe.id : uuidv4();

                if (existingRecipe) {
                    // Actualizar cabecera
                    db.run(
                        'UPDATE recipes SET name = ?, yield = ?, instructions = ?, variant_id = ?, variant_name = ? WHERE id = ?',
                        [recipeName, yieldVal, recipeInstructions, cleanVariantId, cleanVariantName, recipeId],
                        (updErr) => {
                            if (updErr) return res.status(500).json({ error: updErr.message });
                            saveRecipeItems();
                        }
                    );
                } else {
                    // Insertar nueva receta
                    db.run(
                        'INSERT INTO recipes (id, product_id, variant_id, variant_name, name, yield, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [recipeId, product_id, cleanVariantId, cleanVariantName, recipeName, yieldVal, recipeInstructions],
                        (insErr) => {
                            if (insErr) return res.status(500).json({ error: insErr.message });
                            saveRecipeItems();
                        }
                    );
                }

                function saveRecipeItems() {
                    // Borrar items anteriores y reinsertar
                    db.run('DELETE FROM recipe_items WHERE recipe_id = ?', [recipeId], (delErr) => {
                        if (delErr) return res.status(500).json({ error: delErr.message });

                        const insertStmt = db.prepare(
                            'INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES (?, ?, ?, ?, ?)'
                        );

                        items.forEach(item => {
                            const itemId = uuidv4();
                            const supplyId = item.supply_id;
                            const qty = parseFloat(item.quantity) || 0;
                            const unit = (item.unit || item.recipe_unit || '').trim().toLowerCase() || null;
                            if (supplyId && qty > 0) {
                                insertStmt.run(itemId, recipeId, supplyId, qty, unit);
                            }
                        });

                        insertStmt.finalize(() => {
                            if (io) {
                                io.emit('recipe_saved', { recipeId, productId: product_id, variantId: cleanVariantId });
                                io.emit('inventory_updated', { type: 'recipe_saved', recipeId });
                            }
                            res.json({
                                message: 'Receta guardada exitosamente',
                                recipeId,
                                variant_id: cleanVariantId,
                                variant_name: cleanVariantName
                            });
                        });
                    });
                }
            });
        });
    });

    // Eliminar receta
    router.delete('/inventory/recipes/:id', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const { id } = req.params;
        db.run('DELETE FROM recipes WHERE id = ?', [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Receta no encontrada' });
            if (io) {
                io.emit('recipe_deleted', { id });
                io.emit('inventory_updated', { type: 'recipe_deleted', id });
            }
            res.json({ message: 'Receta eliminada exitosamente' });
        });
    });

    // Exportar recetas a CSV
    router.get('/inventory/recipes/export', verifyToken, requireRole(['admin', 'cajero']), (req, res) => {
        const sql = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name,
                COALESCE(r.yield, 1) AS recipe_yield,
                COALESCE(r.instructions, '') AS instructions,
                COALESCE(s.id, '') AS supply_id,
                COALESCE(s.name, '') AS supply_name,
                COALESCE(ri.quantity, 0) AS quantity,
                COALESCE(s.unit, '') AS unit
            FROM recipes r
            JOIN products p ON r.product_id = p.id
            LEFT JOIN recipe_items ri ON ri.recipe_id = r.id
            LEFT JOIN supplies s ON ri.supply_id = s.id
            ORDER BY p.name ASC, s.name ASC
        `;
        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                const fields = ['product_id', 'product_name', 'recipe_yield', 'instructions', 'supply_id', 'supply_name', 'quantity', 'unit'];
                const parser = new Parser({ fields });
                const csvData = parser.parse(rows);

                res.header('Content-Type', 'text/csv; charset=utf-8');
                res.header('Content-Disposition', 'attachment; filename=recetas_digirest.csv');
                res.send(csvData);
            } catch (err) {
                console.error('Error generating recipes CSV:', err);
                res.status(500).json({ error: 'Error generating CSV' });
            }
        });
    });

    // Importar recetas desde CSV
    router.post('/inventory/recipes/import', verifyToken, requireRole(['admin']), csvUpload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: "No se subió ningún archivo" });
        }

        const filePath = req.file.path;
        const results = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => {
                let recipesCount = 0;
                let itemsCount = 0;
                let errors = 0;

                const dbRun = (sql, params) => {
                    return new Promise((resolve, reject) => {
                        db.run(sql, params, function (err) {
                            if (err) reject(err);
                            else resolve(this);
                        });
                    });
                };

                const processBatch = async () => {
                    // Group rows by product identifier
                    const grouped = {};
                    for (const row of results) {
                        const prodKey = (row.product_id || row.id_plato || row.product_name || row.plato || row.producto || '').trim();
                        if (!prodKey) continue;
                        if (!grouped[prodKey]) grouped[prodKey] = [];
                        grouped[prodKey].push(row);
                    }

                    for (const [key, rows] of Object.entries(grouped)) {
                        try {
                            const first = rows[0];
                            const prodId = (first.product_id || first.id_plato || '').trim();
                            const prodName = (first.product_name || first.plato || first.producto || '').trim();

                            // Find product in DB
                            let product = null;
                            if (prodId) {
                                product = await new Promise(res => db.get("SELECT id, name FROM products WHERE id = ?", [prodId], (err, r) => res(r)));
                            }
                            if (!product && prodName) {
                                product = await new Promise(res => db.get("SELECT id, name FROM products WHERE LOWER(name) = LOWER(?)", [prodName], (err, r) => res(r)));
                            }

                            if (!product) {
                                console.warn(`Recipe import: product not found for "${key}"`);
                                errors++;
                                continue;
                            }

                            const yieldVal = parseInt(first.recipe_yield || first.porciones || first.rendimiento || 1, 10) || 1;
                            const instructions = (first.instructions || first.instrucciones || '').trim();

                            // Find or create recipe
                            let recipe = await new Promise(res => db.get("SELECT id FROM recipes WHERE product_id = ?", [product.id], (err, r) => res(r)));
                            let recipeId;

                            if (recipe) {
                                recipeId = recipe.id;
                                await dbRun("UPDATE recipes SET name = ?, yield = ?, instructions = ? WHERE id = ?", [product.name, yieldVal, instructions, recipeId]);
                                // Clean existing items for clean sync
                                await dbRun("DELETE FROM recipe_items WHERE recipe_id = ?", [recipeId]);
                            } else {
                                recipeId = uuidv4();
                                await dbRun("INSERT INTO recipes (id, product_id, name, yield, instructions) VALUES (?, ?, ?, ?, ?)", [recipeId, product.id, product.name, yieldVal, instructions]);
                            }

                            // Insert ingredient items
                            for (const r of rows) {
                                const supplyName = (r.supply_name || r.insumo || r.ingrediente || '').trim();
                                const supplyId = (r.supply_id || r.id_insumo || '').trim();
                                const qty = parseFloat(String(r.quantity || r.cantidad || 0).replace(/[^0-9.-]/g, '')) || 0;
                                const unit = (r.unit || r.unidad || 'und').trim();

                                if (!supplyName && !supplyId) continue;
                                if (qty <= 0) continue;

                                let supply = null;
                                if (supplyId) {
                                    supply = await new Promise(res => db.get("SELECT id FROM supplies WHERE id = ?", [supplyId], (err, s) => res(s)));
                                }
                                if (!supply && supplyName) {
                                    supply = await new Promise(res => db.get("SELECT id FROM supplies WHERE LOWER(name) = LOWER(?)", [supplyName], (err, s) => res(s)));
                                }

                                if (!supply) {
                                    // Auto-create missing supply
                                    const newSupId = supplyId || uuidv4();
                                    await dbRun("INSERT INTO supplies (id, name, unit, current_stock, min_stock, cost_per_unit) VALUES (?, ?, ?, 0, 0, 0)", [newSupId, supplyName || 'Insumo importado', unit]);
                                    supply = { id: newSupId };
                                }

                                await dbRun("INSERT INTO recipe_items (id, recipe_id, supply_id, quantity) VALUES (?, ?, ?, ?)", [uuidv4(), recipeId, supply.id, qty]);
                                itemsCount++;
                            }

                            recipesCount++;
                        } catch (e) {
                            console.error("Import Error recipe group:", key, e);
                            errors++;
                        }
                    }

                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Error deleting uploaded file:", err);
                    });

                    if (io) {
                        io.emit('recipe_updated');
                        io.emit('inventory_updated', { type: 'recipe_imported' });
                    }
                    res.json({ message: `Importación completada. Recetas procesadas: ${recipesCount}, Ingredientes vinculados: ${itemsCount}, Errores: ${errors}` });
                };

                processBatch();
            });
    });

    // =============================================
    // KÁRDEX / MOVIMIENTOS DE INVENTARIO
    // =============================================
    router.get('/inventory/movements', verifyToken, (req, res) => {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
        const sql = `
            SELECT id, supply_id, supply_name, type, quantity, stock_after, order_id, notes, user_name, created_at
            FROM inventory_movements
            ORDER BY id DESC
            LIMIT ?
        `;
        db.all(sql, [limit], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        });
    });

    return router;
};
