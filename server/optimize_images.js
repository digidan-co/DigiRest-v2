const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'pos.sqlite');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

console.log("Iniciando optimización de imágenes en Base64...");

db.all("SELECT id, name, img FROM products WHERE img LIKE 'data:image/%'", [], (err, rows) => {
    if (err) {
        console.error("Error leyendo base de datos:", err);
        return;
    }

    if (rows.length === 0) {
        console.log("No se encontraron imágenes en formato Base64 para optimizar.");
        return;
    }

    console.log(`Se encontraron ${rows.length} productos con imágenes Base64. Extrayendo a archivos...`);

    let processed = 0;

    rows.forEach(row => {
        try {
            // Ejemplo de img: data:image/jpeg;base64,/9j/4AAQSkZJRg...
            const matches = row.img.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            
            if (matches && matches.length === 3) {
                let ext = matches[1];
                if (ext === 'jpeg') ext = 'jpg';
                
                const buffer = Buffer.from(matches[2], 'base64');
                const filename = `optimized_prod_${row.id}_${Date.now()}.${ext}`;
                const filepath = path.join(uploadsDir, filename);
                
                fs.writeFileSync(filepath, buffer);
                
                const newImgUrl = `/server/uploads/${filename}`;
                
                db.run("UPDATE products SET img = ? WHERE id = ?", [newImgUrl, row.id], (err) => {
                    if (err) {
                        console.error(`Error actualizando producto ${row.name}:`, err);
                    } else {
                        processed++;
                        console.log(`[${processed}/${rows.length}] Producto '${row.name}' optimizado.`);
                        if (processed === rows.length) {
                            console.log("¡Optimización completada con éxito!");
                            console.log("Por favor, reinicia la instancia de Dokploy (Node.js) para liberar la memoria.");
                        }
                    }
                });
            } else {
                processed++;
                console.log(`El formato de la imagen del producto '${row.name}' no es un Base64 válido.`);
            }
        } catch (e) {
            processed++;
            console.error(`Excepción procesando el producto ${row.name}:`, e);
        }
    });
});
