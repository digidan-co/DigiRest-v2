const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyToken } = require('./auth');
const { v4: uuidv4 } = require('uuid');
const { validateNote } = require('../middleware/validators');

module.exports = (io) => {

    // Get Notes for an Order
    router.get('/orders/:orderId/notes', verifyToken, (req, res) => {
        const { orderId } = req.params;
        const sql = `
            SELECT n.*, u.name as waiter_name, us.name as solved_by_name 
            FROM order_notes n 
            LEFT JOIN users u ON n.id_waiter = u.id 
            LEFT JOIN users us ON n.id_user_solved = us.id
            WHERE n.id_order = ? 
            ORDER BY n.created_at ASC
        `;

        db.all(sql, [orderId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            // Format for frontend
            const notes = rows.map(r => ({
                id: r.id_note,
                orderId: r.id_order,
                waiterId: r.id_waiter,
                waiterName: r.waiter_name || 'Desconocido',
                content: r.note,
                solved: !!r.solved,
                solvedBy: r.id_user_solved,
                solvedByName: r.solved_by_name,
                createdAt: r.created_at
            }));

            res.json(notes);
        });
    });

    // Create Note(s)
    router.post('/orders/:orderId/notes', verifyToken, validateNote, (req, res) => {
        const { orderId } = req.params;
        const { notes, waiterId, authorName } = req.body; // notes expects array of strings, or single string

        if (!notes || (Array.isArray(notes) && notes.length === 0)) {
            return res.status(400).json({ error: "No content provided" });
        }

        const notesArray = Array.isArray(notes) ? notes : [notes];
        const stmt = db.prepare("INSERT INTO order_notes (id_note, id_waiter, id_order, note) VALUES (?, ?, ?, ?)");

        const createdNotes = [];

        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            let errorOccurred = false;

            notesArray.forEach(noteText => {
                if (errorOccurred) return;

                const id = uuidv4();
                stmt.run([id, waiterId, orderId, noteText], function (err) {
                    if (err) {
                        errorOccurred = true;
                        return;
                    }

                    // Log to history (notes_log)
                    // Use provided authorName or 'Mesero' fallback
                    const createdBy = authorName || (waiterId ? 'Mesero' : 'Sistema');

                    db.run("INSERT INTO notes_log (order_id, note, created_by, resolved) VALUES (?, ?, ?, ?)",
                        [orderId, noteText, createdBy, 0], (err) => {
                            if (err) console.error("Error logging note history:", err);
                        });

                    createdNotes.push({
                        id,
                        orderId,
                        waiterId,
                        content: noteText,
                        solved: false,
                        createdAt: new Date()
                    });
                });
            });

            if (errorOccurred) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Failed to save notes" });
            } else {
                db.run("COMMIT", () => {
                    stmt.finalize();

                    // Notify clients
                    const notificationData = {
                        orderId,
                        notes: createdNotes
                    };

                    io.emit('new_order_note', notificationData);

                    res.status(201).json(createdNotes);
                });
            }
        });
    });

    // Solve/Unsolve Note
    router.patch('/notes/:id/solve', verifyToken, (req, res) => {
        const { id } = req.params;
        const { solved, userId } = req.body;
        const isSolved = solved ? 1 : 0;

        // 1. Get current note to know orderId (for broadcasting room)
        db.get("SELECT * FROM order_notes WHERE id_note = ?", [id], (err, noteRow) => {
            if (err || !noteRow) return res.status(404).json({ error: "Note not found" });

            // 2. Update Status
            // Set solved_at to CURRENT_TIMESTAMP if resolving, else NULL
            const solvedAt = isSolved ? new Date().toISOString() : null; // JS date for broadcast, SQL uses its own or param

            db.run(
                "UPDATE order_notes SET solved = ?, id_user_solved = ?, solved_at = ? WHERE id_note = ?",
                [isSolved, isSolved ? userId : null, isSolved ? new Date().toISOString() : null, id],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    // 3. Sync update to notes_log (Match by order_id and note text)
                    db.run("UPDATE notes_log SET resolved = ? WHERE order_id = ? AND note = ?",
                        [isSolved, noteRow.id_order, noteRow.note],
                        (err) => { if (err) console.error("Error syncing note log status:", err); });

                    // 4. Broadcast Update
                    const eventData = {
                        id: noteRow.id_note,
                        orderId: noteRow.id_order,
                        solved: !!isSolved,
                        solvedBy: isSolved ? userId : null,
                        solvedAt: solvedAt,
                        note: noteRow.note,
                        resolved: isSolved
                    };
                    io.emit('order_note_updated', eventData);

                    res.json({ success: true });
                });
        });
    });

    // Delete Note
    router.delete('/notes/:id', verifyToken, (req, res) => {
        const { id } = req.params;

        db.get("SELECT id_order FROM order_notes WHERE id_note = ?", [id], (err, row) => {
            if (err || !row) return res.status(404).json({ error: "Note not found" });

            const orderId = row.id_order;

            db.run("DELETE FROM order_notes WHERE id_note = ?", [id], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                const eventData = { id, orderId };
                io.emit('order_note_deleted', eventData);

                res.json({ success: true });
            });
        });
    });

    // Get All Recent Notes (Global View - Today Only)
    router.get('/notes/all-active', verifyToken, (req, res) => {
        // Filter to today in Colombia timezone (UTC-5 = UTC-5h = '-05:00')
        // SQLite stores created_at in UTC, so today in Bogotá = date(created_at, '-5 hours')
        const sql = `
            SELECT n.*,
            strftime('%Y-%m-%dT%H:%M:%SZ', n.created_at) as created_at,
            u.name as note_waiter_name, o.tableNum, o.client, o.waiterName as order_waiter_name, us.name as solved_by_name
            FROM order_notes n 
            LEFT JOIN users u ON n.id_waiter = u.id 
            LEFT JOIN users us ON n.id_user_solved = us.id
            LEFT JOIN orders o ON n.id_order = o.id
            WHERE date(n.created_at, '-5 hours') = date('now', '-5 hours')
            ORDER BY n.created_at DESC
            LIMIT 300
            `;

        db.all(sql, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            // Group by Order
            const groups = {};
            rows.forEach(r => {
                if (!groups[r.id_order]) {
                    groups[r.id_order] = {
                        orderId: r.id_order,
                        client: r.client,
                        table: r.tableNum || 'N/A',
                        waiter: r.order_waiter_name || 'Sin Mesero',
                        notes: []
                    };
                }
                groups[r.id_order].notes.push({
                    id: r.id_note,
                    waiterName: r.note_waiter_name || 'Mesero',
                    content: r.note,
                    createdAt: r.created_at,
                    solved: !!r.solved,
                    solvedBy: r.id_user_solved,
                    solvedByName: r.solved_by_name,
                    solvedAt: r.solved_at
                });
            });

            res.json(Object.values(groups));
        });
    });

    // Get Archived Notes by Date (from notes_log - permanent history)
    // GET /notes/archived?date=YYYY-MM-DD  (date in Colombia timezone YYYY-MM-DD)
    router.get('/notes/archived', verifyToken, (req, res) => {
        const { date } = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Fecha inválida. Usa formato YYYY-MM-DD' });
        }

        // Apply -5 hours offset so the stored UTC time is compared against Colombia (UTC-5) date
        const sql = `
            SELECT nl.*, 
                   strftime('%Y-%m-%dT%H:%M:%SZ', nl.created_at) as created_at_fmt
            FROM notes_log nl
            WHERE date(nl.created_at, '-5 hours') = ?
            ORDER BY nl.created_at DESC
        `;

        db.all(sql, [date], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    return router;
};
