const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'pos.sqlite');
const templateDbPath = path.resolve(__dirname, 'default_template.sqlite');

// Si la base de datos no existe (por ejemplo al montar un volumen nuevo y vacío en Dokploy),
// inicializamos automáticamente copiando la plantilla limpia con el usuario digidanMasterAdmin
if (!fs.existsSync(dbPath) && fs.existsSync(templateDbPath)) {
    try {
        console.log('📦 Inicializando pos.sqlite desde plantilla inicial en volumen montado...');
        fs.copyFileSync(templateDbPath, dbPath);
    } catch (e) {
        console.warn('⚠️ No se pudo copiar la plantilla de BD:', e.message);
    }
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        // ⚠️ CRITICAL: SQLite does NOT enforce foreign keys by default.
        // This PRAGMA must be enabled per-connection for ON DELETE CASCADE to work.
        db.run('PRAGMA foreign_keys = ON', (pragmaErr) => {
            if (pragmaErr) console.error('Failed to enable foreign keys:', pragmaErr.message);

            // Enable WAL mode for better concurrency (allows simultaneous reads during writes)
            db.run('PRAGMA journal_mode = WAL', (walErr) => {
                if (walErr) console.error('Failed to set WAL mode:', walErr.message);
            });

            // Wait up to 5 seconds before failing on a locked database (instead of failing immediately)
            db.run('PRAGMA busy_timeout = 5000', (timeoutErr) => {
                if (timeoutErr) console.error('Failed to set busy_timeout:', timeoutErr.message);
            });

            // Performance optimizations for high-throughput reads/writes & VPS efficiency
            db.run('PRAGMA synchronous = NORMAL');
            db.run('PRAGMA cache_size = -64000'); // 64MB memory cache for queries
            db.run('PRAGMA temp_store = MEMORY'); // Keep temp tables and sorting in RAM
            db.run('PRAGMA mmap_size = 268435456'); // 256MB memory-mapped I/O (direct kernel-to-process memory reads)
            db.run('PRAGMA wal_autocheckpoint = 1000'); // Keep WAL file bounded to prevent disk bloat

            // Init schema after enabling FK enforcement
            initSchema();
        });
    }
});

function initSchema() {
    const schema = `
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT,
        code TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        desc TEXT,
        price REAL NOT NULL,
        category TEXT NOT NULL,
        available INTEGER DEFAULT 1,
        img TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        client TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        type TEXT NOT NULL,
        payment TEXT,
        status TEXT DEFAULT 'Pendiente',
        total REAL DEFAULT 0,
        tip REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        discount_reason TEXT,
        items JSON,
        waiterId TEXT,
        waiterName TEXT,
        tableNum TEXT,
        chefName TEXT,
        deliveryDriverId TEXT,
        deliveryDriverName TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        proof TEXT,
        cancel_reason TEXT,
        displayDate TEXT,
        delivery_zone TEXT,
        delivery_fee REAL DEFAULT 0,
        account_id INTEGER,
        cash_amount REAL DEFAULT 0,
        transfer_amount REAL DEFAULT 0,
        cash_account_id INTEGER,
        transfer_account_id INTEGER,
        payment_details TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value JSON
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        user_id TEXT,
        ip_address TEXT,
        details JSON,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_blacklist (
        token TEXT PRIMARY KEY,
        user_id TEXT,
        revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
        user_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_notes (
        id_note TEXT PRIMARY KEY,
        id_waiter TEXT,
        id_order TEXT NOT NULL,
        note TEXT NOT NULL,
        solved INTEGER DEFAULT 0,
        id_user_solved TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(id_order) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        note TEXT,
        waiter_name TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL,
        due_date TEXT, 
        status TEXT DEFAULT 'pending', 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT NOT NULL,
        phone TEXT,
        table_num TEXT,
        pax INTEGER,
        observation TEXT,
        reservation_date TEXT, 
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gastos_dia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        destino TEXT NOT NULL CHECK (destino IN ('Compra de Insumos', 'Pago Nómina', 'Servicio Público', 'Compra de Inmueble', 'Mantenimiento', 'Imprevisto', 'Otro')),
        descripcion TEXT,
        valor REAL NOT NULL,
        anotaciones TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cierre_cajas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        cantidad_pedidos INTEGER DEFAULT 0,
        cantidad_platos INTEGER DEFAULT 0,
        total_anulados REAL DEFAULT 0,
        total_propinas REAL DEFAULT 0,
        total_descuentos REAL DEFAULT 0,
        ingreso_efectivo REAL DEFAULT 0,
        ingreso_transferencia REAL DEFAULT 0,
        total_general REAL DEFAULT 0,
        usuario TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- INVENTARIO DE ALIMENTOS / INSUMOS Y RECETAS
    -- =============================================
    CREATE TABLE IF NOT EXISTS supplies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        current_stock REAL DEFAULT 0,
        min_stock REAL DEFAULT 0,
        cost_per_unit REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        yield INTEGER DEFAULT 1,
        instructions TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        supply_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY(supply_id) REFERENCES supplies(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supply_id TEXT NOT NULL,
        supply_name TEXT,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        stock_after REAL,
        order_id TEXT,
        notes TEXT,
        user_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- TOPPINGS Y ADICIONES PARA PLATOS
    -- =============================================
    CREATE TABLE IF NOT EXISTS toppings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        price REAL DEFAULT 0,
        available INTEGER DEFAULT 1,
        inventory_mode TEXT DEFAULT 'direct',
        stock REAL DEFAULT 0,
        min_stock REAL DEFAULT 5,
        supply_id TEXT,
        supply_quantity REAL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- FLUJO DE CAJA (MOVIMIENTOS MANUALES Y REGISTROS)
    -- =============================================
    CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,           -- 'INCOME' (Ingreso/Entrada) o 'EXPENSE' (Egreso/Salida)
        concept TEXT NOT NULL,
        category_id INTEGER,
        category_name TEXT,
        account_id INTEGER,
        account_name TEXT,
        payment_method TEXT NOT NULL, -- 'Efectivo', 'Transferencia', 'Datáfono', 'Otro'
        amount REAL NOT NULL,
        notes TEXT,
        user_name TEXT,
        payable_id INTEGER,
        receivable_id INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- CUENTAS / FONDOS (CAJA, BANCOS, DATÁFONO)
    -- =============================================
    CREATE TABLE IF NOT EXISTS finance_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'Efectivo', -- 'Efectivo', 'Transferencia', 'Datáfono', 'Otro'
        account_number TEXT,
        bank_name TEXT,
        initial_balance REAL DEFAULT 0,
        current_balance REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- CATEGORÍAS DE FLUJO DE CAJA
    -- =============================================
    CREATE TABLE IF NOT EXISTS finance_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
        description TEXT,
        is_default INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- CUENTAS POR PAGAR (CxP)
    -- =============================================
    CREATE TABLE IF NOT EXISTS finance_payables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT NOT NULL,
        concept TEXT NOT NULL,
        invoice_number TEXT,
        original_amount REAL NOT NULL,
        balance_pending REAL NOT NULL,
        due_date DATE NOT NULL,
        status TEXT DEFAULT 'Pendiente' CHECK (status IN ('Pendiente', 'Pagado', 'Vencido', 'Anulado')),
        category_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- CUENTAS POR COBRAR (CxC)
    -- =============================================
    CREATE TABLE IF NOT EXISTS finance_receivables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT NOT NULL,
        concept TEXT NOT NULL,
        invoice_number TEXT,
        original_amount REAL NOT NULL,
        balance_pending REAL NOT NULL,
        due_date DATE NOT NULL,
        status TEXT DEFAULT 'Pendiente' CHECK (status IN ('Pendiente', 'Cobrado', 'Vencido', 'Anulado')),
        category_id INTEGER,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- PAGOS / ABONOS DE CxP Y CxC
    -- =============================================
    CREATE TABLE IF NOT EXISTS finance_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payable_id INTEGER,
        receivable_id INTEGER,
        type TEXT NOT NULL CHECK (type IN ('PAYABLE', 'RECEIVABLE')),
        amount REAL NOT NULL,
        account_id INTEGER,
        account_name TEXT,
        payment_method TEXT,
        notes TEXT,
        user_name TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- ZONAS Y TARIFAS DE DOMICILIO
    -- =============================================
    CREATE TABLE IF NOT EXISTS delivery_zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fee REAL NOT NULL DEFAULT 0,
        estimated_time TEXT,
        available INTEGER DEFAULT 1,
        min_order REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- MINI CRM: CLIENTES (CUSTOMERS)
    -- =============================================
    CREATE TABLE IF NOT EXISTS customers (
        phone TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        delivery_zone TEXT,
        notes TEXT,
        total_orders INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        last_order_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- =============================================
    -- SOLICITUDES DE AUTORIZACIÓN (ANULACIÓN Y EDICIÓN)
    -- =============================================
    CREATE TABLE IF NOT EXISTS order_authorizations (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by_id TEXT,
        requested_by_name TEXT,
        resolved_by_id TEXT,
        resolved_by_name TEXT,
        resolved_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME
    );
    `;

    db.exec(schema, (err) => {
        if (err) {
            console.error("Schema initialization failed:", err);
        } else {

            // Migration: Add deliveryDriverId if missing
            db.run("ALTER TABLE orders ADD COLUMN deliveryDriverId TEXT", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN cancel_reason TEXT", (err) => { });

            // Migration: Add stock_deducted flag to orders
            db.run("ALTER TABLE orders ADD COLUMN stock_deducted INTEGER DEFAULT 0", (err) => { });

            // Migration: Add tips and discounts if missing
            db.run("ALTER TABLE orders ADD COLUMN tip REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN discount REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN discount_reason TEXT", (err) => { });

            // Migration: Add tips and discounts to cierre
            db.run("ALTER TABLE cierre_cajas ADD COLUMN total_propinas REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE cierre_cajas ADD COLUMN total_descuentos REAL DEFAULT 0", (err) => { });
            // Migration: Add total_gastos to cierre_cajas
            db.run("ALTER TABLE cierre_cajas ADD COLUMN total_gastos REAL DEFAULT 0", (err) => { });

            // Migration: Add solved_at to order_notes
            db.run("ALTER TABLE order_notes ADD COLUMN solved_at DATETIME", (err) => { });

            // Migration: Cashflow enhancements
            db.run("ALTER TABLE cash_movements ADD COLUMN category_id INTEGER", (err) => { });
            db.run("ALTER TABLE cash_movements ADD COLUMN category_name TEXT", (err) => { });
            db.run("ALTER TABLE cash_movements ADD COLUMN account_id INTEGER", (err) => { });
            db.run("ALTER TABLE cash_movements ADD COLUMN account_name TEXT", (err) => { });
            db.run("ALTER TABLE cash_movements ADD COLUMN payable_id INTEGER", (err) => { });
            db.run("ALTER TABLE cash_movements ADD COLUMN receivable_id INTEGER", (err) => { });

            // Migration: Add username column to users if missing & populate from name
            db.run("ALTER TABLE users ADD COLUMN username TEXT", (err) => {
                db.run("UPDATE users SET username = name WHERE username IS NULL OR username = ''", () => { });
            });

            // Migration: Add work_schedule column to users for schedule enforcement
            db.run("ALTER TABLE users ADD COLUMN work_schedule TEXT", (err) => { });

            // Migration: Add toppings, recommendations, and promo columns to products
            db.run("ALTER TABLE products ADD COLUMN has_toppings INTEGER DEFAULT 0", (err) => { });
            db.run("ALTER TABLE products ADD COLUMN toppings_config TEXT", (err) => { });
            db.run("ALTER TABLE products ADD COLUMN is_recommended INTEGER DEFAULT 0", (err) => { });
            db.run("ALTER TABLE products ADD COLUMN is_promo INTEGER DEFAULT 0", (err) => { });
            db.run("ALTER TABLE products ADD COLUMN promo_price REAL DEFAULT 0", (err) => { });

            // Migration: Add dish variants (sizes/portions with different prices) to products
            db.run("ALTER TABLE products ADD COLUMN has_variants INTEGER DEFAULT 0", (err) => { });
            db.run("ALTER TABLE products ADD COLUMN variants_config TEXT DEFAULT '[]'", (err) => { });

            // Migration: Add delivery_zone and delivery_fee to orders
            db.run("ALTER TABLE orders ADD COLUMN delivery_zone TEXT", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0", (err) => { });

            // Migration: Add payment destination accounts and mixed payment breakdown to orders
            db.run("ALTER TABLE orders ADD COLUMN account_id INTEGER", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN cash_amount REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN transfer_amount REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN cash_account_id INTEGER", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN transfer_account_id INTEGER", (err) => { });
            db.run("ALTER TABLE orders ADD COLUMN payment_details TEXT", (err) => { });

            // Migration: Add Option C columns to toppings (direct stock or linked kitchen supply)
            db.run("ALTER TABLE toppings ADD COLUMN inventory_mode TEXT DEFAULT 'direct'", (err) => { });
            db.run("ALTER TABLE toppings ADD COLUMN stock REAL DEFAULT 0", (err) => { });
            db.run("ALTER TABLE toppings ADD COLUMN min_stock REAL DEFAULT 5", (err) => { });
            db.run("ALTER TABLE toppings ADD COLUMN supply_id TEXT", (err) => { });
            db.run("ALTER TABLE toppings ADD COLUMN supply_quantity REAL DEFAULT 1", (err) => { });

            // Initialize toppings direct stock from existing supplies if available
            db.run(`
                UPDATE toppings 
                SET stock = COALESCE((SELECT current_stock FROM supplies WHERE supplies.id = toppings.supply_id OR supplies.id = toppings.id), 0),
                    min_stock = COALESCE((SELECT min_stock FROM supplies WHERE supplies.id = toppings.supply_id OR supplies.id = toppings.id), 5)
                WHERE (stock = 0 OR stock IS NULL) AND EXISTS (SELECT 1 FROM supplies WHERE supplies.id = toppings.supply_id OR supplies.id = toppings.id)
            `, (err) => { });

            // Indexes for High-Performance Queries (thousands of orders support)
            const indexes = [
                "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
                "CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders(timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_orders_status_timestamp ON orders(status, timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_orders_type_timestamp ON orders(type, timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_orders_waiterId ON orders(waiterId)",
                "CREATE INDEX IF NOT EXISTS idx_orders_deliveryDriverId ON orders(deliveryDriverId)",
                "CREATE INDEX IF NOT EXISTS idx_order_notes_id_order ON order_notes(id_order)",
                "CREATE INDEX IF NOT EXISTS idx_order_notes_created_at ON order_notes(created_at)",
                "CREATE INDEX IF NOT EXISTS idx_notes_log_order_id ON notes_log(order_id)",
                "CREATE INDEX IF NOT EXISTS idx_gastos_dia_timestamp ON gastos_dia(timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_cierre_cajas_fecha ON cierre_cajas(fecha)",
                "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)",
                "CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_orders_colombia_date ON orders(date(timestamp, '-5 hours'))",
                "CREATE INDEX IF NOT EXISTS idx_gastos_dia_colombia_date ON gastos_dia(date(timestamp, '-5 hours'))",
                "CREATE INDEX IF NOT EXISTS idx_orders_datetime ON orders(datetime(timestamp))",
                "CREATE INDEX IF NOT EXISTS idx_recipes_product_id ON recipes(product_id)",
                "CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe_id ON recipe_items(recipe_id)",
                "CREATE INDEX IF NOT EXISTS idx_recipe_items_supply_id ON recipe_items(supply_id)",
                "CREATE INDEX IF NOT EXISTS idx_inventory_movements_supply_id ON inventory_movements(supply_id)",
                "CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_id ON inventory_movements(order_id)",
                "CREATE INDEX IF NOT EXISTS idx_cash_movements_timestamp ON cash_movements(timestamp)",
                "CREATE INDEX IF NOT EXISTS idx_finance_accounts_type ON finance_accounts(type)",
                "CREATE INDEX IF NOT EXISTS idx_finance_categories_type ON finance_categories(type)",
                "CREATE INDEX IF NOT EXISTS idx_finance_payables_status ON finance_payables(status)",
                "CREATE INDEX IF NOT EXISTS idx_finance_receivables_status ON finance_receivables(status)",
                "CREATE INDEX IF NOT EXISTS idx_toppings_group ON toppings(group_name)",
                "CREATE INDEX IF NOT EXISTS idx_delivery_zones_avail ON delivery_zones(available)",
                "CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name)",
                "CREATE INDEX IF NOT EXISTS idx_customers_last_order ON customers(last_order_at)",
                "CREATE INDEX IF NOT EXISTS idx_customers_total_orders ON customers(total_orders)"
            ];

            indexes.forEach(idxSql => {
                db.run(idxSql, (idxErr) => {
                    if (idxErr) console.error("Index creation error:", idxSql, idxErr.message);
                });
            });

            seedDefaultUser();
            seedFinanceDefaults();
            seedDeliveryZones();
            syncCustomersFromOrders();
        }
    });
}

const bcrypt = require('bcrypt');

function seedDefaultUser() {
    // Verificar si ya existe el usuario maestro
    db.get("SELECT id FROM users WHERE id = 'digidan_master_admin'", [], async (err, row) => {
        if (!row) {
            const masterId = 'digidan_master_admin';
            const masterUser = 'digidanMasterAdmin';
            const masterPass = '3264';

            try {
                const hashedCode = await bcrypt.hash(masterPass, 10);
                db.run(`INSERT INTO users (id, name, username, code, role) VALUES (?, ?, ?, ?, ?)`,
                    [masterId, masterUser, masterUser, hashedCode, 'admin'],
                    (err) => {
                        if (err) console.error("Error creating master admin:", err);
                    });
            } catch (e) {
                console.error("Error hashing password during seed:", e);
            }
        } else {
            db.run("UPDATE users SET username = name WHERE id = 'digidan_master_admin' AND (username IS NULL OR username = '')");
        }
    });
}

function seedFinanceDefaults() {
    // Seed default accounts
    db.get("SELECT COUNT(*) as count FROM finance_accounts", [], (err, row) => {
        if (!err && row && row.count === 0) {
            const initialAccounts = [
                { name: 'Caja Principal (Efectivo)', type: 'Efectivo', bank_name: 'Caja Física', desc: 'Fondo principal de caja en efectivo' },
                { name: 'Caja Menor', type: 'Efectivo', bank_name: 'Caja Chica', desc: 'Fondo para gastos menores e imprevistos' },
                { name: 'Bancolombia Negocio', type: 'Transferencia', bank_name: 'Bancolombia', desc: 'Cuenta empresarial para transferencias' },
                { name: 'Nequi / Daviplata', type: 'Transferencia', bank_name: 'Nequi', desc: 'Billeteras digitales para cobros inmediatos' },
                { name: 'Datáfono Principal', type: 'Datáfono', bank_name: 'Bold / Redeban', desc: 'Fondo receptor de pagos con tarjetas' }
            ];

            const insertStmt = db.prepare(`
                INSERT INTO finance_accounts (name, type, bank_name, description, initial_balance, current_balance, is_active)
                VALUES (?, ?, ?, ?, 0, 0, 1)
            `);

            initialAccounts.forEach(acc => {
                insertStmt.run([acc.name, acc.type, acc.bank_name, acc.desc]);
            });
            insertStmt.finalize();
        }
    });

    // Seed default categories
    db.get("SELECT COUNT(*) as count FROM finance_categories", [], (err, row) => {
        if (!err && row && row.count === 0) {
            const initialCategories = [
                // Incomes
                { name: 'Ventas del Día', type: 'INCOME', desc: 'Ingresos por venta y pedidos del restaurante', is_default: 1 },
                { name: 'Préstamo Socio', type: 'INCOME', desc: 'Aportes temporales de socios', is_default: 1 },
                { name: 'Inyección de Capital', type: 'INCOME', desc: 'Capital aportado para inversión', is_default: 1 },
                { name: 'Abono Cliente (CxC)', type: 'INCOME', desc: 'Recaudo de cuentas por cobrar', is_default: 1 },
                { name: 'Otros Ingresos', type: 'INCOME', desc: 'Ingresos varios y extraordinarios', is_default: 1 },
                // Expenses
                { name: 'Gastos en Inventario / Insumos', type: 'EXPENSE', desc: 'Compra de materia prima e insumos', is_default: 1 },
                { name: 'Pago de Nómina', type: 'EXPENSE', desc: 'Salarios de cocina, meseros y personal', is_default: 1 },
                { name: 'Servicios Públicos', type: 'EXPENSE', desc: 'Agua, luz, gas, internet y telefonía', is_default: 1 },
                { name: 'Pago Proveedor (CxP)', type: 'EXPENSE', desc: 'Abonos y cancelación de deudas con proveedores', is_default: 1 },
                { name: 'Mantenimiento y Reparaciones', type: 'EXPENSE', desc: 'Mantenimiento de equipos y locaciones', is_default: 1 },
                { name: 'Arriendo', type: 'EXPENSE', desc: 'Canon de arrendamiento del local', is_default: 1 },
                { name: 'Otros Egresos', type: 'EXPENSE', desc: 'Egresos menores e imprevistos', is_default: 1 }
            ];

            const insertCatStmt = db.prepare(`
                INSERT INTO finance_categories (name, type, description, is_default)
                VALUES (?, ?, ?, ?)
            `);

            initialCategories.forEach(cat => {
                insertCatStmt.run([cat.name, cat.type, cat.desc, cat.is_default]);
            });
            insertCatStmt.finalize();
        }
    });
}

function seedDeliveryZones() {
    db.get("SELECT COUNT(*) as count FROM delivery_zones", [], (err, row) => {
        if (!err && row && row.count === 0) {
            const initialZones = [
                { id: 'zone-centro', name: 'Zona Centro / Casco Urbano', fee: 3500, estimated_time: '25-35 min', available: 1, min_order: 15000 },
                { id: 'zone-norte', name: 'Zona Norte / Periferia', fee: 5000, estimated_time: '35-45 min', available: 1, min_order: 20000 },
                { id: 'zone-sur', name: 'Zona Sur / Valles', fee: 6000, estimated_time: '40-50 min', available: 1, min_order: 25000 },
                { id: 'zone-rural', name: 'Zona Rural / Extramuros', fee: 8500, estimated_time: '50-60 min', available: 1, min_order: 35000 }
            ];

            const insertStmt = db.prepare(`
                INSERT INTO delivery_zones (id, name, fee, estimated_time, available, min_order)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            initialZones.forEach(z => {
                insertStmt.run([z.id, z.name, z.fee, z.estimated_time, z.available, z.min_order]);
            });
            insertStmt.finalize();
            console.log("Delivery zones seeded successfully.");
        }
    });
}

function normalizePhoneNumber(p) {
    if (!p) return '';
    let digits = String(p).replace(/\D/g, '');
    if (digits.startsWith('57') && digits.length === 12) {
        digits = digits.slice(2);
    }
    return digits;
}

function syncCustomersFromOrders(callback) {
    db.all("SELECT phone, client, address, delivery_zone, total, timestamp FROM orders WHERE phone IS NOT NULL AND TRIM(phone) != '' ORDER BY timestamp ASC", [], (err, rows) => {
        if (err) {
            console.error("Error fetching orders for customer sync:", err.message);
            if (callback) callback(err);
            return;
        }

        // Group orders by normalized phone number
        const groups = {};
        (rows || []).forEach(row => {
            const phone = normalizePhoneNumber(row.phone);
            if (phone.length < 7) return; // Ignore incomplete numbers

            if (!groups[phone]) {
                groups[phone] = {
                    phone,
                    name: 'Cliente',
                    address: '',
                    delivery_zone: '',
                    total_orders: 0,
                    total_spent: 0,
                    last_order_at: null
                };
            }

            const g = groups[phone];
            g.total_orders += 1;
            g.total_spent += parseFloat(row.total) || 0;
            g.last_order_at = row.timestamp || g.last_order_at;

            const clientName = (row.client || '').trim();
            if (clientName && !['cliente', 'cliente final', 'consumidor final'].includes(clientName.toLowerCase())) {
                g.name = clientName;
            } else if (g.name === 'Cliente' && clientName) {
                g.name = clientName;
            }

            if (row.address && row.address !== 'N/A' && row.address.trim()) {
                g.address = row.address.trim();
            }
            if (row.delivery_zone && row.delivery_zone.trim()) {
                g.delivery_zone = row.delivery_zone.trim();
            }
        });

        const list = Object.values(groups);
        if (list.length === 0) {
            if (callback) callback(null);
            return;
        }

        const upsertSql = `
            INSERT INTO customers (phone, name, address, delivery_zone, total_orders, total_spent, last_order_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(phone) DO UPDATE SET
                name = CASE 
                    WHEN customers.name IS NOT NULL AND customers.name != '' AND LOWER(customers.name) NOT IN ('cliente', 'cliente final') 
                    THEN customers.name 
                    ELSE excluded.name 
                END,
                address = CASE WHEN excluded.address != '' AND excluded.address != 'N/A' THEN excluded.address ELSE customers.address END,
                delivery_zone = CASE WHEN excluded.delivery_zone != '' THEN excluded.delivery_zone ELSE customers.delivery_zone END,
                total_orders = excluded.total_orders,
                total_spent = excluded.total_spent,
                last_order_at = excluded.last_order_at,
                updated_at = CURRENT_TIMESTAMP
        `;

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare(upsertSql);
            list.forEach(c => {
                stmt.run([c.phone, c.name, c.address, c.delivery_zone, c.total_orders, c.total_spent, c.last_order_at]);
            });
            stmt.finalize();
            db.run("COMMIT", (commitErr) => {
                if (commitErr) console.error("Error committing customers sync:", commitErr.message);
                else console.log(`Customers CRM synced: unified ${list.length} unique phone numbers.`);
                if (callback) callback(commitErr);
            });
        });
    });
}

db.syncCustomersFromOrders = syncCustomersFromOrders;

module.exports = db;

