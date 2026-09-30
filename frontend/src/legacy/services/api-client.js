import { OfflineDB } from './offline-db.js';
import { showModalAlert } from '../components/ui.js';
import { state } from '../core/state.js';

// API Client for POS Backend
const API_URL = '/api';

/**
 * Structured error logging helper.
 * Captures request/response details for proactive debugging.
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {any} body - Request body (sanitized for logging)
 * @param {Response} res - Fetch Response object
 * @param {string} bodyText - Error response body as text
 */
function logApiError(method, endpoint, body, res, bodyText) {
    const user = (typeof window !== 'undefined' && window.state && window.state.user)
        ? { id: window.state.user.id, role: window.state.user.role }
        : null;

    // Sanitize body for logging (remove sensitive fields, don't log raw binary)
    let safeBody = body;
    if (body instanceof FormData) {
        safeBody = '[FormData]';
    } else if (typeof body === 'object' && body !== null) {
        safeBody = { ...body };
        // Redact sensitive fields
        if (safeBody.code) safeBody.code = '***';
        if (safeBody.password) safeBody.password = '***';
    }

    console.error(
        `[API_ERROR] ${new Date().toISOString()} | ${method} ${endpoint}` +
        ` | ${res.status} ${res.statusText}` +
        (user ? ` | user=${user.id} role=${user.role}` : '') +
        ` | body=${JSON.stringify(safeBody)}` +
        ` | response=${bodyText}`
    );
}

/**
 * Handle SESSION_REPLACED error: show alert and force logout.
 * Parses the response body to detect the SESSION_REPLACED error code.
 * @param {Response} res - Fetch Response object
 * @param {string} bodyText - Raw response body text
 * @returns {boolean} true if session was replaced (caller should stop processing)
 */
function handleSessionReplaced(res, bodyText) {
    if (res.status === 401) {
        try {
            const parsed = JSON.parse(bodyText);
            if (parsed.code === 'SESSION_REPLACED') {
                console.warn('SESSION_REPLACED: Another login occurred with these credentials.');
                localStorage.removeItem('pos_token');
                localStorage.removeItem('pos_user');
                // Show styled modal before reloading
                showModalAlert(
                    'Sesión Reemplazada',
                    'Tu sesión ha sido reemplazada porque otro usuario inició sesión con tus mismas credenciales. Serás redirigido al inicio.',
                    'warning'
                );
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
                return true;
            }
        } catch (e) {
            // Not JSON, ignore (regular 401 error)
        }
    }
    return false;
}

export const ApiClient = {
    token: (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_token') : null),

    getToken() {
        if (!this.token && typeof localStorage !== 'undefined') {
            this.token = localStorage.getItem('pos_token') || null;
        }
        return this.token;
    },

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const currentToken = this.getToken();
        if (currentToken) {
            headers['Authorization'] = `Bearer ${currentToken}`;
        }
        return headers;
    },

    setToken(token) {
        this.token = token;
        if (token) localStorage.setItem('pos_token', token);
        else localStorage.removeItem('pos_token');
    },

    async handleResponse(res, method = 'GET', endpoint = '', body = undefined) {
        if (!res.ok) {
            const bodyText = await res.text();
            logApiError(method, endpoint, body, res, bodyText);
            // Check if session was replaced by another login
            if (handleSessionReplaced(res, bodyText)) {
                throw new Error("Sesión reemplazada");
            }
            if (res.status === 401) {
                // Token expired or invalid (not SESSION_REPLACED)
                console.warn("Session expired. Logging out...");
                localStorage.removeItem('pos_token');
                localStorage.removeItem('pos_user');
                window.location.reload(); // Reload to reset state to login
                throw new Error("Sesión expirada");
            }
            throw new Error(bodyText);
        }
        return res.json();
    },

    async get(endpoint, forceNetwork = false) {
        const currentToken = this.getToken();
        const isProtectedEndpoint = endpoint.startsWith('/admin') ||
            endpoint.startsWith('/cierre-caja') ||
            endpoint.startsWith('/gastos-dia') ||
            endpoint.startsWith('/inventory') ||
            endpoint.startsWith('/customers') ||
            endpoint.startsWith('/users');

        if (isProtectedEndpoint && !currentToken) {
            return null;
        }

        // GET requests follow Stale-While-Revalidate through sw.js by default
        // If forceNetwork is true (e.g., from a Socket.io event), append a timestamp to bypass cache
        let url = `${API_URL}${endpoint}`;
        if (forceNetwork) {
            const separator = url.includes('?') ? '&' : '?';
            url += `${separator}_t=${Date.now()}`;
        }

        const res = await fetch(url, { headers: this.getHeaders() });
        const data = await this.handleResponse(res, 'GET', endpoint);

        // Handle paginated response from /orders endpoint
        if (endpoint.startsWith('/orders') && data.orders && Array.isArray(data.orders)) {
            return data.orders;
        }

        return data;
    },

    async post(endpoint, body) {
        const isFormData = body instanceof FormData;

        if (!navigator.onLine) {
            if (isFormData) throw new Error("No se pueden subir archivos sin conexión.");
            await OfflineDB.enqueueRequest({ url: endpoint, method: 'POST', body });
            return { offline: true, message: 'Operación guardada localmente. Se sincronizará al conectar.' };
        }

        const headers = this.getHeaders();
        if (isFormData) delete headers['Content-Type']; // Let browser set boundary

        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers,
            body: isFormData ? body : JSON.stringify(body)
        });
        if (!res.ok) {
            const bodyText = await res.text();
            logApiError('POST', endpoint, body, res, bodyText);
            if (handleSessionReplaced(res, bodyText)) {
                throw new Error("Sesión reemplazada");
            }
            throw new Error(bodyText);
        }
        return res.json();
    },

    async put(endpoint, body) {
        const isFormData = body instanceof FormData;

        if (!navigator.onLine) {
            if (isFormData) throw new Error("No se pueden subir archivos sin conexión.");
            await OfflineDB.enqueueRequest({ url: endpoint, method: 'PUT', body });
            return { offline: true, message: 'Operación guardada localmente.' };
        }

        const headers = this.getHeaders();
        if (isFormData) delete headers['Content-Type']; // Let browser set boundary

        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'PUT',
            headers,
            body: isFormData ? body : JSON.stringify(body)
        });
        if (!res.ok) {
            const bodyText = await res.text();
            logApiError('PUT', endpoint, body, res, bodyText);
            if (handleSessionReplaced(res, bodyText)) {
                throw new Error("Sesión reemplazada");
            }
            throw new Error(bodyText);
        }
        return res.json();
    },

    async patch(endpoint, body) {
        if (!navigator.onLine) {
            await OfflineDB.enqueueRequest({ url: endpoint, method: 'PATCH', body });
            return { offline: true, message: 'Operación guardada localmente.' };
        }

        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'PATCH',
            headers: this.getHeaders(),
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const bodyText = await res.text();
            logApiError('PATCH', endpoint, body, res, bodyText);
            if (handleSessionReplaced(res, bodyText)) {
                throw new Error("Sesión reemplazada");
            }
            throw new Error(bodyText);
        }
        return res.json();
    },

    async delete(endpoint, body = undefined) {
        if (!navigator.onLine) {
            await OfflineDB.enqueueRequest({ url: endpoint, method: 'DELETE', body });
            return { offline: true, message: 'Operación guardada localmente.' };
        }

        const fetchOptions = {
            method: 'DELETE',
            headers: this.getHeaders()
        };
        if (body !== undefined) {
            fetchOptions.body = JSON.stringify(body);
        }

        const res = await fetch(`${API_URL}${endpoint}`, fetchOptions);
        if (!res.ok) {
            const bodyText = await res.text();
            logApiError('DELETE', endpoint, body, res, bodyText);
            if (handleSessionReplaced(res, bodyText)) {
                throw new Error("Sesión reemplazada");
            }
            throw new Error(bodyText);
        }
        return res.json();
    },

    async syncOfflineRequests() {
        const queue = await OfflineDB.getQueue();
        if (queue.length === 0) return 0;

        let syncedCount = 0;
        for (const req of queue) {
            try {
                const headers = this.getHeaders();
                let fetchOptions;

                // Special handling: if this is a POST or PUT /orders with a data URL proof,
                // convert to FormData so the server processes the image as a real file via multer
                const hasDataUrlProof = req.url.startsWith('/orders') && (req.method === 'POST' || req.method === 'PUT')
                    && req.body && typeof req.body.proof === 'string'
                    && req.body.proof.startsWith('data:');

                if (hasDataUrlProof) {
                    const formData = new FormData();
                    // Convert data URL to Blob for file upload
                    const dataUrl = req.body.proof;
                    const [header, base64Data] = dataUrl.split(',');
                    const mimeMatch = header.match(/data:([^;]+)/);
                    const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
                    const byteChars = atob(base64Data);
                    const byteArray = new Uint8Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                        byteArray[i] = byteChars.charCodeAt(i);
                    }
                    const ext = mime.split('/')[1] || 'webp';
                    const blob = new Blob([byteArray], { type: mime });
                    formData.append('proof', blob, `offline_proof.${ext}`);

                    // Append all other fields (except proof which is now a file)
                    for (const [key, value] of Object.entries(req.body)) {
                        if (key === 'proof') continue;
                        if (value === null || value === undefined) continue;
                        if (typeof value === 'object') {
                            formData.append(key, JSON.stringify(value));
                        } else {
                            formData.append(key, value);
                        }
                    }

                    // For FormData, do NOT set Content-Type — browser will set multipart boundary
                    const formHeaders = { ...headers };
                    delete formHeaders['Content-Type'];
                    fetchOptions = {
                        method: req.method,
                        headers: formHeaders,
                        body: formData
                    };
                    console.log(`📸 Syncing offline order with proof as FormData file upload`);
                } else {
                    fetchOptions = {
                        method: req.method,
                        headers
                    };
                    if (req.body) fetchOptions.body = JSON.stringify(req.body);
                }

                const res = await fetch(`${API_URL}${req.url}`, fetchOptions);
                if (res.ok) {
                    await OfflineDB.removeFromQueue(req.id);
                    syncedCount++;

                    // If this was a POST to /orders, clean up the synced offline order
                    // AND rewrite any queued PUT/DELETE URLs that reference the old temp ID
                    if (req.url === '/orders' && req.method === 'POST') {
                        try {
                            const { getOfflineOrders, removeOfflineOrder } = await import('./order-service.js');
                            const offlineOrders = await getOfflineOrders();
                            // Prefer matching by _offlineId if available
                            let matched = null;
                            if (req._offlineId) {
                                matched = offlineOrders.find(o => o.id === req._offlineId);
                            }
                            if (!matched) {
                                const body = req.body || {};
                                // Fallback: match by client name + total
                                matched = offlineOrders.find(o =>
                                    o.client === body.client &&
                                    Math.abs(parseFloat(o.total) - parseFloat(body.total)) < 0.01
                                );
                            }
                            if (matched) {
                                await removeOfflineOrder(matched.id);
                            }

                            // ── URL REWRITING: update any queued PUT/DELETE that reference the old temp ID ──
                            const oldId = req._offlineId;
                            if (oldId) {
                                // Get the real server ID from the response
                                const responseData = await res.clone().json();
                                const realId = responseData && responseData.id;
                                if (realId && realId !== oldId) {
                                    // Get remaining queue (after removing this POST request)
                                    const remainingQueue = await OfflineDB.getQueue();
                                    for (const queued of remainingQueue) {
                                        if (queued.url && queued.url.includes(oldId)) {
                                            const oldUrl = queued.url;
                                            queued.url = queued.url.replace(oldId, realId);
                                            console.log(`🔄 Rewriting queued ${queued.method} URL: ${oldUrl} → ${queued.url}`);
                                            await OfflineDB.updateQueuedRequest(queued.id, { url: queued.url });
                                        }
                                    }

                                    // ── STATE UPDATE: replace temp ID with real ID in memory ──
                                    // This prevents the edit modal from re-entering offline path
                                    const updateStateArray = (arr) => {
                                        if (!arr) return;
                                        const idx = arr.findIndex(o => o.id == oldId);
                                        if (idx !== -1) {
                                            arr[idx].id = realId;
                                            delete arr[idx]._offline;
                                            console.log(`🔄 Updated state: replaced ${oldId} → ${realId}`);
                                        }
                                    };
                                    updateStateArray(state.orders);
                                    updateStateArray(state.waiterOrders);
                                }
                            }
                        } catch (e) {
                            console.error("Error cleaning up offline orders after POST sync:", e);
                        }
                    } else if (req.method === 'PUT' && req.url && req.url.includes('/orders/')) {
                        // ── CLEANUP for synced PUT/DELETE on orders ──
                        // Remove stale entries from IndexedDB offline_orders store
                        // that were created by updateOfflineOrderLocally() during offline edits.
                        // Extract the order ID from the URL (e.g., /orders/PG-1 or /orders/PG-1/status)
                        try {
                            const urlParts = req.url.split('/');
                            // URL format: /orders/:id or /orders/:id/*
                            // Parts: ['', 'orders', ':id', ...]
                            const orderIdx = urlParts.indexOf('orders');
                            const orderId = orderIdx !== -1 && urlParts[orderIdx + 1] ? urlParts[orderIdx + 1] : null;
                            if (orderId && !orderId.startsWith('OFF-')) {
                                const { getOfflineOrders, removeOfflineOrder } = await import('./order-service.js');
                                const offlineOrders = await getOfflineOrders();
                                const staleOrder = offlineOrders.find(o => o.id === orderId);
                                if (staleOrder) {
                                    await removeOfflineOrder(orderId);
                                    console.log(`🧹 Cleaned up stale offline order after ${req.method} sync: ${orderId}`);
                                }
                            }
                        } catch (e) {
                            console.error("Error cleaning up offline orders after PUT sync:", e);
                        }
                    }
                } else if (res.status === 401 || res.status === 400 || res.status === 404) {
                    // Si el error es un bad request o no autorizado, removerlo de la cola para no bloquear
                    console.error("Failed offline request permanently:", req);
                    await OfflineDB.removeFromQueue(req.id);
                }
            } catch (error) {
                console.error("Retrying offline request failed. Still offline?", error);
                break; // Stop syncing if we hit a network error again
            }
        }
        return syncedCount;
    }
};
