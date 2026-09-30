const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '../server/data/pos.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database at', dbPath);
    seedData();
});

function randomDate(start, end) {
    // Return date within last hour to ensure they appear in "Active" view (last 24h filter)
    return new Date(Date.now() - Math.floor(Math.random() * 3600000));
}

function seedData() {
    const LOCAL_COUNT = 20;
    const GENERAL_COUNT = 30;

    let completed = 0;
    const TOTAL = LOCAL_COUNT + GENERAL_COUNT;

    const checkDone = () => {
        completed++;
        if (completed >= TOTAL) {
            console.log(`\nSuccessfully seeded ${LOCAL_COUNT} Local orders and ${GENERAL_COUNT} General orders.`);
            db.close();
        }
    };

    const statuses = ['Pendiente', 'Recibido', 'En preparación', 'Terminado', 'Entregado', 'Cobrado'];
    const deliveryStatuses = ['En Reparto', 'Entregado'];

    // Seed Local Orders
    console.log("Seeding Local Orders...");
    for (let i = 0; i < LOCAL_COUNT; i++) {
        const id = `LOC_${Date.now()}_${i}`;
        const timestamp = randomDate(new Date(2025, 0, 1), new Date()).toISOString();
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        const sql = `INSERT INTO orders (
            id, type, tableNum, waiterName, chefName, status, total, items, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const items = JSON.stringify([{ name: 'Test Dish Local', qty: 1, price: 15.00 }]);

        db.run(sql, [
            id, 'Local', Math.floor(Math.random() * 10) + 1, 'Juan Pérez', 'Chef Luigi',
            status, 15.00, items, timestamp
        ], (err) => {
            if (err) console.error("Error inserting local:", err.message);
            else process.stdout.write(".");
            checkDone();
        });
    }

    // Seed General Orders
    console.log("\nSeeding General Orders...");
    for (let i = 0; i < GENERAL_COUNT; i++) {
        const id = `GEN_${Date.now()}_${i}`;
        const timestamp = randomDate(new Date(2025, 0, 1), new Date()).toISOString();
        const status = deliveryStatuses[Math.floor(Math.random() * deliveryStatuses.length)];

        const sql = `INSERT INTO orders (
            id, type, client, address, phone, deliveryDriverName, status, total, items, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const items = JSON.stringify([{ name: 'Test Dish General', qty: 2, price: 25.00 }]);

        db.run(sql, [
            id, 'Domicilio', `Cliente ${i}`, 'Calle Falsa 123', '555-0000', 'Repartidor Veloz',
            status, 25.00, items, timestamp
        ], (err) => {
            if (err) console.error("Error inserting general:", err.message);
            else process.stdout.write("*");
            checkDone();
        });
    }
}
