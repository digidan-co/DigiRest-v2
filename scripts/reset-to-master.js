const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const dbDir = path.resolve(__dirname, '../server/data');
['pos.sqlite', 'pos.sqlite-wal', 'pos.sqlite-shm'].forEach(file => {
    const p = path.join(dbDir, file);
    if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log(`Eliminado archivo antiguo: ${file}`);
    }
});

// Require db.js to let it create the schema and seed
const db = require('../server/db');

setTimeout(async () => {
    db.serialize(() => {
        // Clear all transactional and test data
        db.run("DELETE FROM orders");
        db.run("DELETE FROM order_notes");
        db.run("DELETE FROM notes_log");
        db.run("DELETE FROM products");
        db.run("DELETE FROM categories");
        db.run("DELETE FROM customers");
        db.run("DELETE FROM reservations");
        db.run("DELETE FROM tasks");
        db.run("DELETE FROM cierre_cajas");
        db.run("DELETE FROM gastos_dia");
        db.run("DELETE FROM supplies");
        db.run("DELETE FROM recipes");
        db.run("DELETE FROM recipe_items");
        db.run("DELETE FROM inventory_movements");
        db.run("DELETE FROM cash_movements");
        db.run("DELETE FROM toppings");
        db.run("DELETE FROM delivery_zones");
        db.run("DELETE FROM active_sessions");
        db.run("DELETE FROM token_blacklist");
        db.run("DELETE FROM audit_logs");
        db.run("DELETE FROM finance_payables");
        db.run("DELETE FROM finance_receivables");
        db.run("DELETE FROM finance_payments");

        // Users: delete all except digidan_master_admin
        db.run("DELETE FROM users WHERE id != 'digidan_master_admin'");

        // Config: reset to generic clean defaults
        db.run("DELETE FROM config");
        const defaultConfigs = [
            ['restaurantData', JSON.stringify({ name: 'DigiRest POS', slogan: 'Sistema de Gestión Gastronómica', phone: '', address: '' })],
            ['uiPrimaryColor', JSON.stringify('#f5b55f')],
            ['uiThemeId', JSON.stringify('amber')],
            ['uiBgAside', JSON.stringify('#052244')],
            ['uiContrastColor', JSON.stringify('#1e2122')],
            ['inventory_auto_record', 'true']
        ];
        const cfgStmt = db.prepare("INSERT INTO config (key, value) VALUES (?, ?)");
        defaultConfigs.forEach(([k, v]) => cfgStmt.run(k, v));
        cfgStmt.finalize();

        // Check users
        db.all("SELECT id, name, username, role FROM users", [], (err, users) => {
            console.log("\n--- USUARIOS EN BASE DE DATOS LIMPIA ---");
            console.log(users);
        });

        // Run vacuum to shrink database to absolute minimum
        db.run("VACUUM", () => {
            console.log("\n✅ Base de datos pos.sqlite reseteada y limpia con éxito.");
            process.exit(0);
        });
    });
}, 2500);
