const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { loginLimiter, recordFailedAttempt, resetAttempts, checkBlocked } = require('../middleware/rateLimiter');
const { validateLogin } = require('../middleware/validators');
const saasService = require('../saasService');

// Reference to Socket.IO instance (set from server/index.js)
let _io = null;
function setIo(io) { _io = io; }

// Validate JWT_SECRET on startup
const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
    console.error('FATAL: JWT_SECRET environment variable is not set!');
    process.exit(1);
}
if (SECRET_KEY.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters long!');
    console.error('Generate a secure secret with: openssl rand -base64 32');
    process.exit(1);
}

// Validate MASTER_KEY if provided
const MASTER_KEY = process.env.MASTER_KEY;
if (MASTER_KEY && MASTER_KEY.length < 32) {
    console.warn('WARNING: MASTER_KEY should be at least 32 characters long for security');
}

/**
 * Verifica si un usuario no-administrador tiene horario laboral asignado
 * y si el momento actual está dentro de los días y horas permitidos.
 */
function checkUserSchedule(userRow) {
    if (!userRow || userRow.role === 'admin' || userRow.id === 'master' || userRow.id === 'digidan_master_admin') {
        return { allowed: true };
    }

    if (!userRow.work_schedule) {
        return { allowed: true };
    }

    let schedule = null;
    try {
        schedule = typeof userRow.work_schedule === 'string' ? JSON.parse(userRow.work_schedule) : userRow.work_schedule;
    } catch (e) {
        console.error('Error parsing user work_schedule:', e);
        return { allowed: true };
    }

    if (!schedule || schedule.enabled === false) {
        return { allowed: true };
    }

    // Normalize shifts (supporting new multi-shift structure as well as legacy single schedule)
    let shifts = [];
    if (Array.isArray(schedule.shifts) && schedule.shifts.length > 0) {
        shifts = schedule.shifts;
    } else if (Array.isArray(schedule.days) && schedule.days.length > 0) {
        shifts = [{
            name: 'Jornada Principal',
            days: schedule.days,
            start_time: schedule.start_time,
            end_time: schedule.end_time
        }];
    }

    if (shifts.length === 0) {
        return { allowed: true };
    }

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Domingo, 1=Lunes, ..., 6=Sábado
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const currentDayName = dayNames[dayOfWeek];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    function isTimeMatch(curTime, startTime, endTime) {
        if (!startTime || !endTime) return true;
        let endNorm = (endTime === '00:00' || endTime === '24:00') ? '24:00' : endTime;
        if (startTime <= endNorm) {
            return curTime >= startTime && curTime <= endNorm;
        } else {
            // Overnight shift (e.g. 18:00 to 02:00)
            return curTime >= startTime || curTime <= endNorm;
        }
    }

    // Check if current moment matches ANY of the user's assigned shifts
    for (const shift of shifts) {
        const days = Array.isArray(shift.days) ? shift.days : [];
        if (days.includes(dayOfWeek)) {
            if (isTimeMatch(currentTime, shift.start_time, shift.end_time)) {
                return { allowed: true, matchingShift: shift.name };
            }
        }
        // Overnight shift started the previous day
        const prevDay = (dayOfWeek + 6) % 7;
        if (days.includes(prevDay) && shift.start_time && shift.end_time && shift.start_time > shift.end_time) {
            if (currentTime <= shift.end_time) {
                return { allowed: true, matchingShift: shift.name };
            }
        }
    }

    const dayMap = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };
    const shiftsSummary = shifts.map(s => {
        const dStr = (s.days || []).map(d => dayMap[d] || d).join(', ');
        return `"${s.name || 'Jornada'}": [${dStr}] ${s.start_time || ''} a ${s.end_time || ''}`;
    }).join(' | ');

    return {
        allowed: false,
        message: `Acceso bloqueado: Actualmente (${currentDayName} ${currentTime}) no te encuentras dentro de ninguna de tus jornadas laborales asignadas (${shiftsSummary}). Consulta con el administrador.`
    };
}

/**
 * Login Endpoint — Step 1 of two-step flow.
 * Authenticates credentials, then checks if an active session already exists.
 * - If no active session: creates one and returns { token, user }.
 * - If active session exists: returns { hasActiveSession: true, user } (no token).
 *   The client must show a confirmation modal and call /auth/confirm-login.
 */
router.post('/login', loginLimiter, validateLogin, async (req, res, next) => {
    try {
        const { user, code } = req.body;

        if (!user || !code) {
            return res.status(400).json({
                error: 'Usuario y código son requeridos'
            });
        }

        const blockStatus = checkBlocked(user);
        if (blockStatus.blocked) {
            return res.status(429).json({
                error: 'Usuario bloqueado por multiples intentos fallidos, por favor inténtalo más tarde'
            });
        }

        // ── MASTER USER (Invisible Admin for Multi-Instance Management) ──
        if (MASTER_KEY && MASTER_KEY.length >= 32 && code === MASTER_KEY) {
            resetAttempts(user);
            const clientIp = req.ip || req.connection.remoteAddress;
            console.log(`SECURITY: Master Access Granted from IP: ${clientIp}`);

            // Check if master already has an active session
            db.get("SELECT token FROM active_sessions WHERE user_id = 'master'", [], (sessErr, existing) => {
                if (sessErr) console.error('Error checking master active session:', sessErr);

                if (existing && existing.token) {
                    // Check if the existing token is expired (stale session)
                    const decoded = jwt.decode(existing.token);
                    const isExpired = decoded && decoded.exp
                        ? (decoded.exp * 1000) < Date.now()
                        : false;

                    if (!isExpired) {
                        // Session is still active — ask user for confirmation
                        return res.json({
                            hasActiveSession: true,
                            user: { id: 'master', name: 'Master User', role: 'admin' }
                        });
                    }

                    // Token is expired — clean up stale session and proceed
                    console.log(`[SESSION] Cleaning stale session for master (token expired)`);
                    db.run("DELETE FROM active_sessions WHERE user_id = 'master'", [], () => {});
                    // Fall through to normal login below
                }

                // No active session (or stale one was cleaned) — proceed with normal login
                const token = jwt.sign(
                    { id: 'master', role: 'admin', name: 'Master User' },
                    SECRET_KEY,
                    { expiresIn: '2h' }
                );

                db.run(
                    `INSERT OR REPLACE INTO active_sessions (user_id, token, created_at) VALUES ('master', ?, datetime('now'))`,
                    [token],
                    (insErr) => {
                        if (insErr) console.error('Error storing master active session:', insErr);
                    }
                );

                res.json({
                    token,
                    user: { id: 'master', name: 'Master User', role: 'admin' }
                });
            });

            return; // Prevent fall-through to regular user login
        }

        // ── REGULAR USER AUTHENTICATION ──
        // Case-sensitive check for username or fallback to name/id
        const query = `SELECT * FROM users WHERE (username = ? COLLATE BINARY OR (username IS NULL AND name = ? COLLATE BINARY) OR id = ?)`;

        db.get(query, [user, user, user], async (err, row) => {
            if (err) {
                console.error('Database error during login:', err);
                return next(err);
            }

            if (!row) {
                recordFailedAttempt(user);
                return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
            }

            // Explicit case-sensitive check in JavaScript
            const userIdentifier = row.username || row.name || row.id;
            if (userIdentifier !== user && row.id !== user) {
                recordFailedAttempt(user);
                return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
            }

            try {
                const match = await bcrypt.compare(code, row.code);
                if (!match) {
                    recordFailedAttempt(user);
                    return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
                }

                resetAttempts(user);

                // ── Work Schedule Enforcement (Non-admin users only) ──
                const scheduleCheck = checkUserSchedule(row);
                if (!scheduleCheck.allowed) {
                    return res.status(403).json({ error: scheduleCheck.message });
                }

                // ── SaaS Central Verification (Verificar antes de permitir acceso) ──
                let saasStatus = null;
                let warningSaaS = null;
                let anunciosData = [];
                try {
                    saasStatus = await saasService.getSaaSStatus();
                } catch (saasErr) {
                    console.warn('[DigiRest SaaS] No se pudo verificar suscripción:', saasErr.message);
                }

                if (saasStatus) {
                    // 1. Bloquear si suspendido o vencido
                    if (saasStatus.estado === 'Suspendida' || saasStatus.estado === 'Suspendido' || saasStatus.isExpired) {
                        return res.status(403).json({
                            error: 'El acceso al sistema se encuentra temporalemente inactivo por falta de pago'
                        });
                    }

                    // 2. Generar aviso si el admin tiene ≤3 días
                    if (saasStatus.vencimiento && row.role === 'admin') {
                        const expDateStr = saasStatus.vencimiento.includes('T')
                            ? saasStatus.vencimiento
                            : `${saasStatus.vencimiento}T12:00:00`;
                        const msLeft = new Date(expDateStr) - new Date();
                        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
                        if (daysLeft <= 3 && daysLeft >= 0) {
                            warningSaaS = {
                                daysLeft,
                                message: `Tu suscripción de DigiRest vencerá en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}.`
                            };
                        }
                    }

                    // 3. Cargar anuncios activos (solo para admin)
                    if (row.role === 'admin') {
                        try {
                            anunciosData = await saasService.getAnunciosActivos();
                        } catch (e) { /* no bloquear login por esto */ }
                    }
                }

                // ── Single Session Enforcement (Step 1: Check) ──
                db.get("SELECT token FROM active_sessions WHERE user_id = ?", [row.id], async (sessErr, existing) => {
                    if (sessErr) console.error('Error checking active session:', sessErr);

                    if (existing && existing.token) {
                        // Check if the existing token is expired (stale session)
                        const decoded = jwt.decode(existing.token);
                        const isExpired = decoded && decoded.exp
                            ? (decoded.exp * 1000) < Date.now()
                            : false;

                        if (!isExpired) {
                            // Session is still active — ask user for confirmation
                            return res.json({
                                hasActiveSession: true,
                                user: {
                                    id: row.id,
                                    name: row.name,
                                    username: row.username || row.name,
                                    role: row.role
                                }
                            });
                        }

                        // Token is expired — clean up stale session and proceed
                        console.log(`[SESSION] Cleaning stale session for user ${row.id} (token expired)`);
                        db.run("DELETE FROM active_sessions WHERE user_id = ?", [row.id], () => {});
                        // Fall through to normal login below
                    }

                    // No active session (or stale one was cleaned) — generate token and store
                    const token = jwt.sign(
                        { id: row.id, role: row.role, name: row.name, username: row.username || row.name },
                        SECRET_KEY,
                        { expiresIn: '12h' }
                    );

                    db.run(
                        `INSERT OR REPLACE INTO active_sessions (user_id, token, created_at) VALUES (?, ?, datetime('now'))`,
                        [row.id, token],
                        (insErr) => {
                            if (insErr) console.error('Error storing active session:', insErr);
                        }
                    );

                    res.json({
                        token,
                        warningSaaS,
                        anuncios: anunciosData,
                        user: {
                            id: row.id,
                            name: row.name,
                            role: row.role
                        }
                    });
                });
            } catch (e) {
                console.error('Error verifying credentials:', e);
                return next(e);
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * Confirm Login — Step 2 of two-step flow.
 * Called AFTER the user confirms they want to replace the existing session.
 * Authenticates credentials again, blacklists the old session,
 * emits a Socket.IO notification to the displaced session,
 * stores the new session, and returns { token, user }.
 */
router.post('/confirm-login', loginLimiter, validateLogin, async (req, res, next) => {
    try {
        const { user, code } = req.body;

        if (!user || !code) {
            return res.status(400).json({
                error: 'Usuario y código son requeridos'
            });
        }

        const blockStatus = checkBlocked(user);
        if (blockStatus.blocked) {
            return res.status(429).json({
                error: 'Usuario bloqueado por multiples intentos fallidos, por favor inténtalo más tarde'
            });
        }

        // ── MASTER USER ──
        if (MASTER_KEY && MASTER_KEY.length >= 32 && code === MASTER_KEY) {
            resetAttempts(user);
            const token = jwt.sign(
                { id: 'master', role: 'admin', name: 'Master User' },
                SECRET_KEY,
                { expiresIn: '2h' }
            );

            // Get old session, blacklist it, update active session, then notify displaced session
            db.get("SELECT token FROM active_sessions WHERE user_id = 'master'", [], (sessErr, existing) => {
                if (sessErr) console.error('Error checking master active session:', sessErr);

                const finishMasterLogin = () => {
                    db.run(
                        `INSERT OR REPLACE INTO active_sessions (user_id, token, created_at) VALUES ('master', ?, datetime('now'))`,
                        [token],
                        (insErr) => {
                            if (insErr) console.error('Error storing master active session:', insErr);

                            // Notify the displaced session via Socket.IO after database has recorded new session
                            if (existing && existing.token && _io) {
                                _io.to('user_master').emit('session_replaced', {
                                    message: 'Has iniciado sesión en otro dispositivo, serás redirigido al inicio'
                                });
                                console.log(`[SESSION] Notified master's old session about replacement`);
                            }

                            res.json({
                                token,
                                user: { id: 'master', name: 'Master User', role: 'admin' }
                            });
                        }
                    );
                };

                if (existing && existing.token) {
                    const decodedOld = jwt.decode(existing.token);
                    const oldExpiresAt = decodedOld && decodedOld.exp
                        ? new Date(decodedOld.exp * 1000).toISOString()
                        : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

                    db.run(
                        `INSERT OR IGNORE INTO token_blacklist (token, user_id, expires_at) VALUES (?, ?, ?)`,
                        [existing.token, 'master', oldExpiresAt],
                        (blErr) => {
                            if (blErr) console.error('Error blacklisting old master session:', blErr);
                            finishMasterLogin();
                        }
                    );
                } else {
                    finishMasterLogin();
                }
            });

            return; // Prevent fall-through to regular user logic
        }

        // ── REGULAR USER ──
        const query = `SELECT * FROM users WHERE (username = ? COLLATE BINARY OR (username IS NULL AND name = ? COLLATE BINARY) OR id = ?)`;

        db.get(query, [user, user, user], async (err, row) => {
            if (err) {
                console.error('Database error during confirm-login:', err);
                return next(err);
            }

            if (!row) {
                recordFailedAttempt(user);
                return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
            }

            // Explicit case-sensitive check in JavaScript
            const userIdentifier = row.username || row.name || row.id;
            if (userIdentifier !== user && row.id !== user) {
                recordFailedAttempt(user);
                return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
            }

            try {
                const match = await bcrypt.compare(code, row.code);
                if (!match) {
                    recordFailedAttempt(user);
                    return res.status(401).json({ error: 'Usuario y/o contraseña incorrectos' });
                }

                resetAttempts(user);

                // ── Work Schedule Enforcement (Non-admin users only) ──
                const scheduleCheck = checkUserSchedule(row);
                if (!scheduleCheck.allowed) {
                    return res.status(403).json({ error: scheduleCheck.message });
                }

                // ── SaaS Central Verification ──
                let saasStatus = null;
                try {
                    saasStatus = await saasService.getSaaSStatus();
                } catch (saasErr) {
                    console.warn('[DigiRest SaaS] No se pudo verificar suscripción:', saasErr.message);
                }

                if (saasStatus && (saasStatus.estado === 'Suspendida' || saasStatus.estado === 'Suspendido' || saasStatus.isExpired)) {
                    return res.status(403).json({
                        error: 'El acceso al sistema se encuentra temporalemente inactivo por falta de pago'
                    });
                }

                // Credentials valid — generate new token
                const token = jwt.sign(
                    { id: row.id, role: row.role, name: row.name, username: row.username || row.name },
                    SECRET_KEY,
                    { expiresIn: '12h' }
                );

                // Get old session, blacklist it, store new session, then notify displaced session
                db.get("SELECT token FROM active_sessions WHERE user_id = ?", [row.id], (sessErr, existing) => {
                    if (sessErr) console.error('Error checking active session:', sessErr);

                    const finishUserLogin = () => {
                        db.run(
                            `INSERT OR REPLACE INTO active_sessions (user_id, token, created_at) VALUES (?, ?, datetime('now'))`,
                            [row.id, token],
                            (insErr) => {
                                if (insErr) console.error('Error storing active session:', insErr);

                                // Notify the displaced session via Socket.IO after database has recorded new session
                                if (existing && existing.token && _io) {
                                    _io.to(`user_${row.id}`).emit('session_replaced', {
                                        message: 'Has iniciado sesión en otro dispositivo, serás redirigido al inicio'
                                    });
                                    console.log(`[SESSION] Notified user ${row.id}'s old session about replacement`);
                                }

                                res.json({
                                    token,
                                    user: {
                                        id: row.id,
                                        name: row.name,
                                        username: row.username || row.name,
                                        role: row.role
                                    }
                                });
                            }
                        );
                    };

                    if (existing && existing.token) {
                        const decodedOld = jwt.decode(existing.token);
                        const oldExpiresAt = decodedOld && decodedOld.exp
                            ? new Date(decodedOld.exp * 1000).toISOString()
                            : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

                        db.run(
                            `INSERT OR IGNORE INTO token_blacklist (token, user_id, expires_at) VALUES (?, ?, ?)`,
                            [existing.token, row.id, oldExpiresAt],
                            (blErr) => {
                                if (blErr) console.error('Error blacklisting old session:', blErr);
                                finishUserLogin();
                            }
                        );
                    } else {
                        finishUserLogin();
                    }
                });
            } catch (e) {
                console.error('Error verifying credentials:', e);
                return next(e);
            }
        });
    } catch (error) {
        next(error);
    }
});

// Middleware to verify token with blacklist and active session check
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(403).json({ error: 'No token provided' });
    }

    // Check if token is blacklisted (revoked via logout)
    db.get("SELECT token FROM token_blacklist WHERE token = ?", [token], (err, blacklisted) => {
        if (err) {
            console.error('Error checking token blacklist:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        if (blacklisted) {
            return res.status(401).json({ error: 'Token revocado. Por favor, inicia sesión nuevamente.' });
        }

        jwt.verify(token, SECRET_KEY, (err, decoded) => {
            if (err) {
                return res.status(401).json({ error: 'Token inválido o expirado' });
            }

            req.user = decoded;
            req.token = token;

            // Single Session Enforcement: check that this token is the active session for this user
            db.get("SELECT token FROM active_sessions WHERE user_id = ?", [decoded.id], (sessErr, active) => {
                if (sessErr) {
                    console.error('Error checking active session:', sessErr);
                    // Fail secure: deny access if we can't verify
                    return res.status(500).json({ error: 'Error interno del servidor' });
                }

                if (!active || active.token !== token) {
                    // Token is valid but not the active one — another session replaced it
                    return res.status(401).json({
                        error: 'Tu sesión ha sido reemplazada. Otro usuario ha iniciado sesión con tus credenciales.',
                        code: 'SESSION_REPLACED'
                    });
                }

                next();
            });
        });
    });
};

// Role-based Access Control (RBAC) middleware
const requireRole = (allowedRoles = []) => {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: 'No autenticado o sin rol asignado.' });
        }
        const userRole = req.user.role;
        // Supervisors inherit all cashier permissions
        const hasPermission = roles.includes(userRole) || (userRole === 'supervisor' && roles.includes('cajero'));
        if (!hasPermission) {
            return res.status(403).json({ error: 'Acceso denegado: permisos insuficientes para esta acción.' });
        }
        next();
    };
};

// GET /auth/verify-session - Lightweight verification of token and single-session validity
router.get('/verify-session', verifyToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// POST /auth/change-password - Change current user password (admin only)
router.post('/change-password', verifyToken, async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acceso restringido: solo administradores pueden cambiar la contraseña.' });
        }
        if (req.user.id === 'master') {
            return res.status(400).json({ error: 'El usuario maestro se configura mediante variable de entorno MASTER_KEY.' });
        }

        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'La contraseña actual y la nueva contraseña son requeridas.' });
        }
        if (String(newPassword).length < 4) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
        }

        db.get("SELECT * FROM users WHERE id = ?", [req.user.id], async (err, user) => {
            if (err) {
                console.error('[AUTH] Error fetching user for password change:', err);
                return res.status(500).json({ error: 'Error interno del servidor.' });
            }
            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado.' });
            }

            let match = false;
            try {
                match = await bcrypt.compare(String(currentPassword), user.code);
            } catch (e) {
                match = false;
            }
            if (!match && String(user.code) === String(currentPassword)) {
                match = true;
            }

            if (!match) {
                return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
            }

            const hashed = await bcrypt.hash(String(newPassword), 10);
            db.run("UPDATE users SET code = ? WHERE id = ?", [hashed, req.user.id], function (updErr) {
                if (updErr) {
                    console.error('[AUTH] Error updating password:', updErr);
                    return res.status(500).json({ error: 'Error al actualizar la contraseña.' });
                }
                console.log(`[AUTH] Contraseña actualizada exitosamente para el administrador ${user.username || user.name} (${user.id})`);
                res.json({ success: true, message: 'Contraseña actualizada exitosamente.' });
            });
        });
    } catch (e) {
        console.error('[AUTH] Unexpected error in change-password:', e);
        res.status(500).json({ error: 'Error interno al procesar el cambio de contraseña.' });
    }
});

// Logout Endpoint — revokes the current token
router.post('/logout', verifyToken, (req, res) => {
    const token = req.token;
    const decoded = jwt.decode(token);

    // Get expiration from decoded token
    const expiresAt = decoded && decoded.exp
        ? new Date(decoded.exp * 1000).toISOString()
        : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    // Insert into blacklist (ignore if already there)
    db.run(
        `INSERT OR IGNORE INTO token_blacklist (token, user_id, expires_at) VALUES (?, ?, ?)`,
        [token, req.user.id, expiresAt],
        function (err) {
            if (err) {
                console.error('Error blacklisting token:', err);
                return res.status(500).json({ error: 'Error al cerrar sesión' });
            }

            // Remove from active sessions (fire-and-forget)
            db.run("DELETE FROM active_sessions WHERE user_id = ?", [req.user.id], () => {});

            // Also clean up expired tokens (fire-and-forget)
            db.run("DELETE FROM token_blacklist WHERE expires_at < datetime('now')", [], () => {});

            res.json({ message: 'Sesión cerrada exitosamente' });
        }
    );
});

// POST /auth/verify-admin - Verify admin credentials (for cajero authorization)
// NOTE: Does NOT rely on frontend sending the correct admin username.
// Instead, tries the provided code against ALL admins to eliminate
// any dependency on the admin user name being correctly populated.
router.post('/verify-admin', verifyToken, (req, res) => {
    const { code } = req.body;
    const userId = req.user?.id || 'unknown';
    const userName = req.user?.name || 'unknown';

    console.log(`[VERIFY-ADMIN] Request from user="${userName}" (id=${userId})`);

    if (!code) {
        console.log(`[VERIFY-ADMIN] FAIL: No code provided by user="${userName}"`);
        return res.status(400).json({ valid: false, error: 'Código de administrador es requerido' });
    }

    console.log(`[VERIFY-ADMIN] Code received (length=${code.length}), querying admins...`);

    db.all("SELECT id, name, code, role FROM users WHERE role IN ('admin', 'supervisor') AND name != 'digidanMasterAdmin'", [], async (err, rows) => {
        if (err) {
            console.error('[VERIFY-ADMIN] Database error:', err);
            return res.status(500).json({ valid: false, error: 'Error interno del servidor' });
        }

        if (!rows || rows.length === 0) {
            console.log(`[VERIFY-ADMIN] FAIL: No admins or supervisors found in database`);
            return res.json({ valid: false, error: 'No hay administradores ni supervisores disponibles en el sistema.' });
        }

        console.log(`[VERIFY-ADMIN] Found ${rows.length} admin/supervisor(s): ${rows.map(r => r.name).join(', ')}`);

        try {
            for (const row of rows) {
                console.log(`[VERIFY-ADMIN] Trying code against "${row.name}" (${row.role})...`);
                const match = await bcrypt.compare(code, row.code);
                if (match) {
                    console.log(`[VERIFY-ADMIN] SUCCESS: Code matches "${row.name}"`);
                    return res.json({ valid: true, admin: { id: row.id, name: row.name, role: row.role } });
                }
            }

            // No admin or supervisor matched the provided code
            console.log(`[VERIFY-ADMIN] FAIL: Code did not match any admin or supervisor`);
            return res.json({ valid: false, error: 'Credenciales de autorización incorrectas' });
        } catch (e) {
            console.error('[VERIFY-ADMIN] Error verifying credentials:', e);
            res.status(500).json({ valid: false, error: 'Error interno del servidor' });
        }
    });
});

// GET /auth/admin-identities — Returns admin/supervisor names (no codes/passwords) for frontend auth flow
// Accessible to any authenticated user (needed by cashiers for authorization)
router.get('/admin-identities', verifyToken, (req, res) => {
    db.all("SELECT id, name, role FROM users WHERE role IN ('admin', 'supervisor') AND name != 'digidanMasterAdmin'", [], (err, rows) => {
        if (err) {
            console.error('Error fetching admin identities:', err);
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
        res.json(rows || []);
    });
});

module.exports = { router, verifyToken, requireRole, setIo };
