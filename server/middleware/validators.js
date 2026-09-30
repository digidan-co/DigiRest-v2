/**
 * Custom input validation and sanitization middleware.
 * Lightweight alternative to express-validator — no external dependency.
 * Validates and sanitizes critical user inputs across the API.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidUUID(str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function sanitizeString(str, maxLen = 255) {
    if (typeof str !== 'string') return '';
    // Trim whitespace, strip HTML tags, limit length
    return str.trim()
              .replace(/<[^>]*>/g, '') // Strip HTML
              .slice(0, maxLen);
}

function sanitizeNumeric(value) {
    const num = Number(value);
    return !isNaN(num) && isFinite(num) ? num : null;
}

// ─── Validation chains ──────────────────────────────────────────────────────

/**
 * Login validation: user (email-like string), code (4-digit numeric)
 */
/**
 * Login validation: user (case-sensitive username), code (case-sensitive password/code with letters, numbers, symbols)
 */
function validateLogin(req, res, next) {
    const errors = [];

    if (!req.body.user || typeof req.body.user !== 'string' || req.body.user.trim().length < 2) {
        errors.push('El usuario debe tener al menos 2 caracteres');
    } else {
        // Keep exact casing and characters
        req.body.user = req.body.user.trim().slice(0, 100);
    }

    if (!req.body.code || typeof req.body.code !== 'string' || req.body.code.length < 3) {
        errors.push('La contraseña o código debe tener al menos 3 caracteres');
    } else {
        // Keep exact casing and characters (symbols, letters, numbers)
        req.body.code = String(req.body.code).slice(0, 100);
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos de inicio de sesión inválidos', details: errors });
    }
    next();
}

/**
 * User creation/update validation
 */
function validateUser(req, res, next) {
    const errors = [];

    // Name: Display name (shown in aside, order signatures, reports)
    if (!req.body.name || typeof req.body.name !== 'string' || req.body.name.trim().length < 2) {
        errors.push('El nombre debe tener al menos 2 caracteres');
    } else {
        req.body.name = sanitizeString(req.body.name, 100);
    }

    // Username: Login identifier
    if (req.body.username !== undefined) {
        if (typeof req.body.username !== 'string' || req.body.username.trim().length < 2) {
            errors.push('El usuario debe tener al menos 2 caracteres');
        } else {
            req.body.username = req.body.username.trim().slice(0, 100);
        }
    }

    // Code: Password/PIN (symbols, letters, numbers allowed, case-sensitive)
    if (req.body.code) {
        if (typeof req.body.code !== 'string' || req.body.code.length < 3) {
            errors.push('La contraseña o código debe tener al menos 3 caracteres');
        } else {
            req.body.code = String(req.body.code).slice(0, 100);
        }
    }

    const allowedRoles = ['mesero', 'admin', 'cajero', 'chef', 'delivery'];
    if (req.body.role && !allowedRoles.includes(req.body.role)) {
        errors.push(`Rol inválido. Permitidos: ${allowedRoles.join(', ')}`);
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos de usuario inválidos', details: errors });
    }
    next();
}

/**
 * Order creation validation (client-facing and waiter)
 */
function validateOrderInput(req, res, next) {
    const errors = [];

    // Validate client name if present
    if (req.body.client_name !== undefined) {
        if (req.body.client_name !== '' && typeof req.body.client_name === 'string') {
            req.body.client_name = sanitizeString(req.body.client_name, 100);
        }
    }

    // Validate phone (Colombian format: 10 digits)
    if (req.body.client_phone !== undefined && req.body.client_phone !== '') {
        const phone = String(req.body.client_phone).replace(/\D/g, '');
        if (phone.length < 10) {
            errors.push('El teléfono debe tener al menos 10 dígitos');
        } else {
            req.body.client_phone = phone.slice(0, 10);
        }
    }

    // Validate order type
    if (req.body.order_type !== undefined) {
        if (!['Local', 'General', 'Domicilio'].includes(req.body.order_type)) {
            errors.push('Tipo de pedido inválido. Use: Local, General o Domicilio');
        }
    }

    // Validate payment method
    if (req.body.payment_method !== undefined) {
        if (!['Efectivo', 'Tarjeta', 'Transferencia', 'Pendiente'].includes(req.body.payment_method)) {
            errors.push('Método de pago inválido');
        }
    }

    // Validate items array
    if (req.body.items !== undefined) {
        // When using FormData (with proof upload), multer parses items as a JSON string.
        // Parse it back to an array for validation.
        let items = req.body.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                errors.push('El formato de los items es inválido');
                // Skip further item validation if parse failed
                if (errors.length > 0) {
                    return res.status(400).json({ error: 'Datos del pedido inválidos', details: errors });
                }
            }
        }
        if (!Array.isArray(items) || items.length === 0) {
            errors.push('El pedido debe contener al menos un item');
        } else {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item.id || !isValidUUID(item.id)) {
                    errors.push(`Item #${i + 1}: ID de producto inválido`);
                }
                if (!item.name || typeof item.name !== 'string') {
                    errors.push(`Item #${i + 1}: Nombre de producto requerido`);
                }
                const itemQty = item.quantity ?? item.qty ?? 0;
                if (!itemQty || itemQty < 1) {
                    errors.push(`Item #${i + 1}: Cantidad inválida`);
                }
                if (!item.price || item.price <= 0) {
                    errors.push(`Item #${i + 1}: Precio inválido`);
                }
            }
        }
    }

    // Validate notes
    if (req.body.notes !== undefined && typeof req.body.notes === 'string') {
        req.body.notes = sanitizeString(req.body.notes, 500);
    }

    // Validate table number
    if (req.body.table_num !== undefined && req.body.table_num !== '') {
        req.body.table_num = sanitizeString(String(req.body.table_num), 10);
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos del pedido inválidos', details: errors });
    }
    next();
}

/**
 * Product validation (create/update)
 */
function validateProduct(req, res, next) {
    const errors = [];

    // Name is required for creation, optional for updates (e.g., toggling availability)
    const hasId = !!req.body.id;
    if (!hasId) {
        // Only require name when creating a new product
        if (!req.body.name || typeof req.body.name !== 'string' || req.body.name.trim().length < 1) {
            errors.push('El nombre del producto es requerido');
        } else {
            req.body.name = sanitizeString(req.body.name, 100);
        }
    } else {
        // Sanitize name if provided during update
        if (req.body.name !== undefined) {
            req.body.name = sanitizeString(String(req.body.name), 100);
        }
    }

    if (req.body.desc !== undefined) {
        req.body.desc = sanitizeString(String(req.body.desc), 500);
    }

    if (req.body.price !== undefined) {
        const price = sanitizeNumeric(req.body.price);
        if (price === null || price <= 0) {
            errors.push('El precio debe ser un número positivo');
        } else {
            req.body.price = price;
        }
    }

    if (req.body.category !== undefined && typeof req.body.category === 'string') {
        if (!isValidUUID(req.body.category) && req.body.category !== '') {
            errors.push('ID de categoría inválido');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos del producto inválidos', details: errors });
    }
    next();
}

/**
 * Config validation — validates { key, value } payload.
 * The config route receives { key, value } (not individual fields).
 * Key must be a non-empty string; value must be present.
 */
function validateConfig(req, res, next) {
    const errors = [];

    // Validate key exists and is a non-empty string
    if (!req.body.key || typeof req.body.key !== 'string' || req.body.key.trim().length < 1) {
        errors.push('La clave de configuración es requerida');
    } else {
        req.body.key = sanitizeString(req.body.key, 100);
    }

    // Validate value exists (can be string, boolean, object, etc.)
    if (req.body.value === undefined || req.body.value === null) {
        errors.push('El valor de configuración es requerido');
    } else {
        // Sanitize string values
        if (typeof req.body.value === 'string') {
            req.body.value = sanitizeString(req.body.value, 5000);
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos de configuración inválidos', details: errors });
    }
    next();
}

/**
 * Gastos (daily expense) validation
 */
function validateGasto(req, res, next) {
    const errors = [];

    // Allowed destino values matching DB CHECK constraint
    const allowedDestinos = [
        'Compra de Insumos', 'Pago Nómina', 'Servicio Público',
        'Compra de Inmueble', 'Mantenimiento', 'Imprevisto', 'Otro'
    ];

    // destino is required and must be one of the allowed values
    if (!req.body.destino || typeof req.body.destino !== 'string' || req.body.destino.trim().length < 1) {
        errors.push('El destino del gasto es requerido');
    } else {
        req.body.destino = sanitizeString(req.body.destino, 255);
        if (!allowedDestinos.includes(req.body.destino)) {
            errors.push(`Destino inválido. Permitidos: ${allowedDestinos.join(', ')}`);
        }
    }

    // descripcion is optional
    if (req.body.descripcion !== undefined && typeof req.body.descripcion === 'string') {
        req.body.descripcion = sanitizeString(req.body.descripcion, 500);
    }

    // valor is required and must be a positive number
    if (req.body.valor === undefined || req.body.valor === null) {
        errors.push('El valor del gasto es requerido');
    } else {
        const num = sanitizeNumeric(req.body.valor);
        if (num === null || num < 0) {
            errors.push('El valor del gasto debe ser un número positivo');
        } else {
            req.body.valor = num;
        }
    }

    // anotaciones is optional
    if (req.body.anotaciones !== undefined && typeof req.body.anotaciones === 'string') {
        req.body.anotaciones = sanitizeString(req.body.anotaciones, 1000);
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Datos del gasto inválidos', details: errors });
    }
    next();
}

/**
 * Notes validation
 */
function validateNote(req, res, next) {
    const errors = [];

    // Frontend sends { notes: string[] } — validate the array of strings
    const notes = req.body.notes;
    if (!notes || (Array.isArray(notes) && notes.length === 0)) {
        errors.push('El contenido de la nota es requerido');
    } else {
        const notesArray = Array.isArray(notes) ? notes : [notes];
        for (let i = 0; i < notesArray.length; i++) {
            if (typeof notesArray[i] !== 'string' || notesArray[i].trim().length < 1) {
                errors.push(`La nota #${i + 1} no tiene contenido válido`);
            } else {
                notesArray[i] = sanitizeString(notesArray[i], 1000);
            }
        }
        // Update req.body.notes to the sanitized array for downstream use
        req.body.notes = notesArray;
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Nota inválida', details: errors });
    }
    next();
}

module.exports = {
    validateLogin,
    validateUser,
    validateOrderInput,
    validateProduct,
    validateConfig,
    validateNote,
    validateGasto
};
