import { ApiClient } from './api-client.js';
import { OfflineDB } from './offline-db.js';
import { state } from '../core/state.js';

// Shared authenticated socket singleton & room synchronizer
export function authenticateSocket() {
    const sock = window.socket || (typeof io === 'function' ? io() : null);
    if (!sock) return;

    const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('pos_token') : null) || (window.ApiClient && ApiClient.getToken ? ApiClient.getToken() : null);
    let user = state.user;
    if (!user && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) user = JSON.parse(raw);
        } catch (_) {}
    }

    if (user && user.role) {
        sock.emit('authenticate', {
            token: token,
            role: user.role,
            userId: user.id
        });
        // Explicitly join role room and bidirectional aliases
        sock.emit('join_room', user.role);
        if (user.role === 'chef') sock.emit('join_room', 'cocinero');
        if (user.role === 'cocinero') sock.emit('join_room', 'chef');
        if (user.role === 'waiter') sock.emit('join_room', 'mesero');
        if (user.role === 'mesero') sock.emit('join_room', 'waiter');
        if (user.role === 'delivery') sock.emit('join_room', 'repartidor');
        if (user.role === 'repartidor') sock.emit('join_room', 'delivery');
        if (user.id) sock.emit('join_room', `user_${user.id}`);
    }

    // Tracker room is publicly accessible
    sock.emit('join_room', 'tracker');
}
window.authenticateSocket = authenticateSocket;

const getSocket = () => {
    if (!window.socket && typeof io === 'function') {
        window.socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity,
            timeout: 20000,
            forceNew: false,
            upgrade: true
        });
        window.socket.on('connect', () => {
            authenticateSocket();
        });
        window.socket.on('reconnect', () => {
            authenticateSocket();
        });
    }
    if (window.socket && window.socket.connected) {
        authenticateSocket();
    }
    return window.socket || (typeof io === 'function' ? io() : null);
};

// Counter for generating temporary offline order IDs
let _offlineIdCounter = 0;

function generateOfflineId() {
    _offlineIdCounter++;
    return `OFF-${Date.now()}-${_offlineIdCounter}`;
}

export async function createOrder(orderData) {
    // Normalize item IDs: the server expects `id` to be the product UUID, but the
    // cart stores a composite key (productId_timestamp). Fix both general and local orders.
    if (Array.isArray(orderData.items)) {
        orderData.items = orderData.items.map(it => ({
            ...it,
            id: it.productId || String(it.id || '').split('_')[0]
        }));
    }

    // Helper robusto para guardar localmente en IndexedDB ante modo offline o fallo de red
    const handleSaveOffline = async () => {
        let proofData = orderData.proof;
        if (orderData.proof instanceof File) {
            proofData = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(orderData.proof);
            });
        }
        const { proof, ...rest } = orderData;
        const tempId = generateOfflineId();
        const offlineOrder = {
            ...rest,
            proof: proofData,
            id: tempId,
            _offline: true,
            _synced: false,
            _createdAt: Date.now(),
            timestamp: new Date().toISOString(),
            items: typeof orderData.items === 'string' ? orderData.items : JSON.stringify(orderData.items)
        };
        await OfflineDB.saveOfflineOrder(offlineOrder);
        const enqueueBody = { ...rest, proof: proofData };
        await OfflineDB.enqueueRequest({
            url: '/orders',
            method: 'POST',
            body: enqueueBody,
            _offlineId: tempId
        });
        console.log(`💾 [OfflineOrder] Pedido guardado localmente en IndexedDB con ID: ${tempId}`);
        return tempId;
    };

    // Si ya estamos desconectados explícitamente, guardar local sin intentar red
    if (!navigator.onLine) {
        return await handleSaveOffline();
    }

    const hasFile = orderData.proof instanceof File;
    try {
        if (hasFile) {
            const formData = new FormData();
            for (const key in orderData) {
                if (key === 'items') {
                    formData.append('items', JSON.stringify(orderData.items));
                } else if (key === 'proof') {
                    formData.append('proof', orderData.proof);
                } else if (typeof orderData[key] === 'object' && orderData[key] !== null) {
                    formData.append(key, JSON.stringify(orderData[key]));
                } else {
                    formData.append(key, orderData[key]);
                }
            }
            const res = await ApiClient.post('/orders', formData);
            if (res && res.offline) {
                return await handleSaveOffline();
            }
            return res.id;
        } else {
            const res = await ApiClient.post('/orders', orderData);
            if (res && res.offline) {
                return await handleSaveOffline();
            }
            return res.id;
        }
    } catch (err) {
        // Red inestable, timeout o servidor caído (Lie-Fi)
        console.warn('⚠️ Error de red o servidor al enviar pedido. Guardando automáticamente en IndexedDB:', err);
        return await handleSaveOffline();
    }
}

/**
 * Get all locally-saved offline orders, parsed for display.
 */
export async function getOfflineOrders() {
    try {
        const orders = await OfflineDB.getOfflineOrders();
        return orders.map(o => ({
            ...o,
            items: typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []),
            _offline: true
        }));
    } catch (e) {
        console.error("Error reading offline orders:", e);
        return [];
    }
}

/**
 * Remove an offline order from local storage (after successful sync).
 */
export async function removeOfflineOrder(tempId) {
    await OfflineDB.removeOfflineOrder(tempId);
}

export async function updateOrder(id, data) {
    // If updating status
    if (data.status) {
        // When offline, update locally first so the UI reflects the change immediately
        if (!navigator.onLine) {
            await updateOfflineOrderLocally(id, data);
        }
        
        // CRITICAL FIX: If the order has a temp ID (OFF- prefix), also update the queued POST body
        // so the order is created on the server with the correct status directly during sync.
        // Otherwise, the POST replays with the ORIGINAL status and everything depends on a
        // separate PUT request whose URL rewriting might fail.
        const isTempId = String(id).startsWith('OFF-');
        if (isTempId) {
            try {
                const queue = await OfflineDB.getQueue();
                const postEntry = queue.find(req =>
                    req.url === '/orders' &&
                    req.method === 'POST' &&
                    req._offlineId === id
                );
                if (postEntry && postEntry.body) {
                    // Merge cancel data into POST body so the server creates the order
                    // with 'Anulado' status and cancelReason directly
                    postEntry.body = { ...postEntry.body, ...data };
                    await OfflineDB.updateQueuedRequest(postEntry.id, { body: postEntry.body });
                    console.log(`🔄 Updated POST body for ${id} with:`, data);
                }
            } catch (e) {
                console.error("Error updating queued POST body for cancel:", e);
            }
            
            // If the order still has a temp ID and we're online, skip the PUT request.
            // The server doesn't know about this order yet (POST hasn't been replayed),
            // so the PUT would 404. The POST body update above is sufficient — during sync
            // the order will be created with the correct status directly.
            if (navigator.onLine) {
                console.log(`ℹ️ Skipping PUT for temp ID ${id} — POST body already updated with cancel data`);
                return { offline: false, message: 'Estado actualizado en POST pendiente' };
            }
        }
        
        // Enqueue the API request (ApiClient.put handles offline queue)
        return await ApiClient.put(`/orders/${id}/status`, { ...data });
    }
    // Generic update not fully implemented in backend yet, allowing status only for now
    console.warn("Update order generic not fully supported in backend yet");
}

/**
 * Update an offline order in IndexedDB and local state immediately.
 */
async function updateOfflineOrderLocally(id, data) {
    try {
        // 1. Update in IndexedDB offline_orders store
        const offlineOrders = await OfflineDB.getOfflineOrders();
        const dbIdx = offlineOrders.findIndex(o => o.id == id);
        if (dbIdx >= 0) {
            const updated = { ...offlineOrders[dbIdx], ...data };
            await OfflineDB.saveOfflineOrder(updated);
        }
        
        // 2. Update in local state (state.waiterOrders and state.orders)
        if (state.waiterOrders) {
            const waIdx = state.waiterOrders.findIndex(o => o.id == id);
            if (waIdx >= 0) {
                state.waiterOrders[waIdx] = { ...state.waiterOrders[waIdx], ...data };
            }
        }
        if (state.orders) {
            const oIdx = state.orders.findIndex(o => o.id == id);
            if (oIdx >= 0) {
                state.orders[oIdx] = { ...state.orders[oIdx], ...data };
            }
        }
        
        // 3. Dispatch event so listeners refresh the UI (reuses offline_sync_complete handler)
        window.dispatchEvent(new Event('offline_sync_complete'));
    } catch (e) {
        console.error("Error updating offline order locally:", e);
    }
}

export async function addItemsToOrder(orderId, items) {
    if (!orderId || !items || items.length === 0) return;
    return await ApiClient.post(`/orders/${orderId}/items`, { items });
}

export async function getOrder(id) {
    // Try API first with forceNetwork=true to bypass service worker cache
    // This ensures we get the latest data (especially proof) from the server
    try {
        const result = await ApiClient.get(`/orders/${id}`, true);
        if (result) return result;
    } catch (e) {
        // If offline or not found, try to find order locally
        console.warn("API fetch failed, trying local data:", e.message);
    }
    
    // Fallback: search in local state
    const localOrder = (state.waiterOrders || state.orders || []).find(o => o.id == id);
    if (localOrder) return localOrder;
    
    // Fallback: search in IndexedDB offline orders
    try {
        const offlineOrders = await getOfflineOrders();
        const found = offlineOrders.find(o => o.id == id);
        if (found) return found;
    } catch (dbErr) {
        console.error("Error searching offline orders:", dbErr);
    }
    
    return null;
}

export async function deleteOrder(id) {
    return await ApiClient.delete(`/orders/${id}`);
}

/* 
 * Replaces onSnapshot. 
 * Fetches initial state via API, then listens for socket events.
 */
export function listenToOrders(viewMode, callback) {
    let currentOrders = [];

    // Helper to filter by type based on viewMode
    const applyTypeFilter = (orders) => {
        if (viewMode !== 'tracker' && viewMode !== 'admin') {
            return orders.filter(o => o.type !== 'Local');
        }
        return orders;
    };

    const pushUpdate = () => {
        callback(filterOrders(applyTypeFilter(currentOrders), viewMode));
    };

    // 1. Load initial data
    const endpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
    const forceNetwork = viewMode === 'admin';
    ApiClient.get(endpoint, forceNetwork).then(orders => {
        currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
        pushUpdate();
    }).catch(err => console.error("Error loading orders:", err));

    // 2. Socket.io listeners with instant in-memory sync + background HTTP validation
    const onNewOrder = (order) => {
        if (!order || !order.id) return;
        if (viewMode === 'tracker' || viewMode === 'admin' || order.type !== 'Local') {
            const exists = currentOrders.some(o => o.id == order.id);
            if (!exists) {
                currentOrders.unshift(order);
                pushUpdate();
            }
            const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
            ApiClient.get(fetchEndpoint, true).then(orders => {
                currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
                pushUpdate();
            }).catch(e => console.warn('Background sync warning:', e));
        }
    };

    const onUpdate = (updateData) => {
        if (!updateData || !updateData.id) return;
        const idx = currentOrders.findIndex(o => o.id == updateData.id);
        if (idx !== -1) {
            currentOrders[idx] = { ...currentOrders[idx], ...updateData };
            pushUpdate();
        }
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const onOrderUpdated = (updatedOrder) => {
        if (!updatedOrder || !updatedOrder.id) return;
        const idx = currentOrders.findIndex(o => o.id == updatedOrder.id);
        if (idx !== -1) {
            currentOrders[idx] = { ...currentOrders[idx], ...updatedOrder };
        } else if (viewMode === 'tracker' || viewMode === 'admin' || updatedOrder.type !== 'Local') {
            currentOrders.unshift(updatedOrder);
        }
        pushUpdate();

        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const onOrderDeleted = ({ id }) => {
        if (id) {
            currentOrders = currentOrders.filter(o => o.id != id);
            pushUpdate();
        }
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const sock = getSocket();
    sock.on('new_order', onNewOrder);
    sock.on('order_status_update', onUpdate);
    sock.on('order_updated', onOrderUpdated);
    sock.on('order_deleted', onOrderDeleted);
    sock.on('orders_cleaned', onOrderDeleted);

    // Note events (trigger refresh to update counts)
    const onNoteEvent = () => {
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            currentOrders = Array.isArray(orders) ? orders : (orders?.orders || []);
            pushUpdate();
        }).catch(e => console.warn('Background note sync warning:', e));
    };

    sock.on('new_order_note', onNoteEvent);
    sock.on('order_note_updated', onNoteEvent);
    sock.on('order_note_deleted', onNoteEvent);

    const onSyncComplete = () => {
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        Promise.all([
            ApiClient.get(fetchEndpoint, true).catch(err => {
                console.error("Error fetching orders on sync:", err);
                return (state.orders || []).filter(o => !o._offline);
            }),
            getOfflineOrders()
        ]).then(([serverOrders, offlineOrders]) => {
            const rawServer = Array.isArray(serverOrders) ? serverOrders : (serverOrders?.orders || []);
            let merged = [...(offlineOrders || []), ...rawServer];
            const seen = new Set();
            merged = merged.filter(order => {
                if (seen.has(order.id)) return false;
                seen.add(order.id);
                return true;
            });
            currentOrders = merged;
            pushUpdate();
        });
    };
    window.addEventListener('offline_sync_complete', onSyncComplete);

    // Return unsubscribe function
    return () => {
        const sock = getSocket();
        sock.off('new_order', onNewOrder);
        sock.off('order_status_update', onUpdate);
        sock.off('order_updated', onOrderUpdated);
        sock.off('order_deleted', onOrderDeleted);
        sock.off('orders_cleaned', onOrderDeleted);
        sock.off('new_order_note', onNoteEvent);
        sock.off('order_note_updated', onNoteEvent);
        sock.off('order_note_deleted', onNoteEvent);
        window.removeEventListener('offline_sync_complete', onSyncComplete);
    };
}

function filterOrders(orders, viewMode) {
    if (!orders) return [];
    if (viewMode === 'chef') {
        return orders.filter(o => ['Pendiente', 'Recibido', 'En preparación'].includes(o.status));
    } else if (viewMode === 'delivery') {
        return orders.filter(o => ['Terminado', 'En Reparto'].includes(o.status) && o.type === 'Domicilio');
    } else if (viewMode === 'tracker') {
        return orders.filter(o => {
            if (o.status === 'Anulado' || o.status === 'Cobrado') return false;
            if (o.status === 'Entregado' && o.type !== 'Domicilio') return false;
            return true;
        });
    } else if (viewMode === 'admin') {
        return orders;
    }
    return orders; // Default
}

// Listen to Waiter Orders (Local type only)
export function listenToWaiterOrders(viewMode, callback) {
    let currentWaiterOrders = [];

    const pushUpdate = () => {
        callback(filterOrders(currentWaiterOrders.filter(o => o.type === 'Local'), viewMode));
    };

    // 1. Load initial data - only Local orders (including offline orders)
    const endpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
    const forceNetwork = viewMode === 'admin';
    Promise.all([
        ApiClient.get(endpoint, forceNetwork).catch(err => {
            console.error("Error loading waiter orders from server:", err);
            const prevOrders = (state.waiterOrders || state.orders || []);
            return prevOrders.filter(o => !o._offline);
        }),
        getOfflineOrders()
    ]).then(([serverOrders, offlineOrders]) => {
        const rawServer = Array.isArray(serverOrders) ? serverOrders : (serverOrders?.orders || []);
        const localServerOrders = rawServer.filter(o => o.type === 'Local');
        const localOfflineOrders = (offlineOrders || []).filter(o => o.type === 'Local');
        const seen = new Set();
        const merged = [];
        // Server orders first (authoritative), followed by any pending offline orders
        for (const order of [...localServerOrders, ...localOfflineOrders]) {
            if (!seen.has(order.id)) {
                seen.add(order.id);
                merged.push(order);
            }
        }
        currentWaiterOrders = merged;
        pushUpdate();
    }).catch(err => console.error("Error loading waiter orders:", err));

    // 2. Listen for Socket.io events with instant in-memory sync + background HTTP validation
    const onNewOrder = (order) => {
        if (!order || !order.id) return;
        if (order.type === 'Local') {
            const exists = currentWaiterOrders.some(o => o.id == order.id);
            if (!exists) {
                currentWaiterOrders.unshift(order);
                pushUpdate();
            }
            const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
            ApiClient.get(fetchEndpoint, true).then(orders => {
                const raw = Array.isArray(orders) ? orders : (orders?.orders || []);
                currentWaiterOrders = raw.filter(o => o.type === 'Local');
                pushUpdate();
            }).catch(e => console.warn('Background sync warning:', e));
        }
    };

    const onUpdate = (updateData) => {
        if (!updateData || !updateData.id) return;
        const idx = currentWaiterOrders.findIndex(o => o.id == updateData.id);
        if (idx !== -1) {
            currentWaiterOrders[idx] = { ...currentWaiterOrders[idx], ...updateData };
            pushUpdate();
        }
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            const raw = Array.isArray(orders) ? orders : (orders?.orders || []);
            currentWaiterOrders = raw.filter(o => o.type === 'Local');
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const onOrderUpdated = (updatedOrder) => {
        if (!updatedOrder || !updatedOrder.id) return;
        const idx = currentWaiterOrders.findIndex(o => o.id == updatedOrder.id);
        if (idx !== -1) {
            currentWaiterOrders[idx] = { ...currentWaiterOrders[idx], ...updatedOrder };
            pushUpdate();
        } else if (updatedOrder.type === 'Local') {
            currentWaiterOrders.unshift(updatedOrder);
            pushUpdate();
        }
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            const raw = Array.isArray(orders) ? orders : (orders?.orders || []);
            currentWaiterOrders = raw.filter(o => o.type === 'Local');
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const onOrderDeleted = ({ id }) => {
        if (id) {
            currentWaiterOrders = currentWaiterOrders.filter(o => o.id != id);
            pushUpdate();
        }
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            const raw = Array.isArray(orders) ? orders : (orders?.orders || []);
            currentWaiterOrders = raw.filter(o => o.type === 'Local');
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    const sock = getSocket();
    sock.on('new_order', onNewOrder);
    sock.on('order_status_update', onUpdate);
    sock.on('order_updated', onOrderUpdated);
    sock.on('order_deleted', onOrderDeleted);
    sock.on('orders_cleaned', onOrderDeleted);

    // Note events for waiter orders
    const onNoteEvent = () => {
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        ApiClient.get(fetchEndpoint, true).then(orders => {
            const raw = Array.isArray(orders) ? orders : (orders?.orders || []);
            currentWaiterOrders = raw.filter(o => o.type === 'Local');
            pushUpdate();
        }).catch(e => console.warn('Background sync warning:', e));
    };

    sock.on('new_order_note', onNoteEvent);
    sock.on('order_note_updated', onNoteEvent);
    sock.on('order_note_deleted', onNoteEvent);

    const onSyncComplete = () => {
        const fetchEndpoint = viewMode === 'admin' ? '/orders?all=true' : '/orders';
        Promise.all([
            ApiClient.get(fetchEndpoint, true).catch(err => {
                console.error("Error fetching waiter orders on sync:", err);
                return (state.waiterOrders || state.orders || []).filter(o => !o._offline);
            }),
            getOfflineOrders()
        ]).then(([serverOrders, offlineOrders]) => {
            const rawServer = Array.isArray(serverOrders) ? serverOrders : (serverOrders?.orders || []);
            const localServerOrders = rawServer.filter(o => o.type === 'Local');
            const localOfflineOrders = (offlineOrders || []).filter(o => o.type === 'Local');
            const seen = new Set();
            const merged = [];
            for (const order of [...localServerOrders, ...localOfflineOrders]) {
                if (!seen.has(order.id)) {
                    seen.add(order.id);
                    merged.push(order);
                }
            }
            currentWaiterOrders = merged;
            pushUpdate();
        });
    };
    window.addEventListener('offline_sync_complete', onSyncComplete);

    // Return unsubscribe function
    return () => {
        const sock = getSocket();
        sock.off('new_order', onNewOrder);
        sock.off('order_status_update', onUpdate);
        sock.off('order_updated', onOrderUpdated);
        sock.off('order_deleted', onOrderDeleted);
        sock.off('orders_cleaned', onOrderDeleted);
        sock.off('new_order_note', onNoteEvent);
        sock.off('order_note_updated', onNoteEvent);
        sock.off('order_note_deleted', onNoteEvent);
        window.removeEventListener('offline_sync_complete', onSyncComplete);
    };
}

export async function createWaiterOrder(orderData) {
    return createOrder(orderData);
}

export async function updateWaiterOrder(uid, data) {
    return updateOrder(uid, data);
}

export async function deleteWaiterOrder(uid) {
    return deleteOrder(uid);
}

// Cleanup - Delete oldest N orders by type
export async function manualCleanup(countLocal, countGeneral) {
    try {
        const result = await ApiClient.post('/orders/cleanup', {
            deleteCountLocal: countLocal,
            deleteCountGeneral: countGeneral
        });
        return result;
    } catch (error) {
        console.error("Cleanup error:", error);
        throw error;
    }
}

export async function getHistoryOrders(startDate, endDate) {
    if (!startDate && !endDate) {
        return await ApiClient.get('/orders');
    }

    // Colombia timezone: UTC-5 (300 minutes behind UTC)
    // Timestamps stored in DB are UTC, so we must convert the
    // user-selected Colombia local date to UTC for accurate comparison.
    const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000; // 5 hours in ms

    let start, end;
    if (startDate) {
        const [y, m, d] = startDate.split('-').map(Number);
        // Colombia midnight (00:00:00 COT) = UTC 05:00:00
        start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) + COLOMBIA_OFFSET_MS);
    }
    if (endDate) {
        const [y, m, d] = endDate.split('-').map(Number);
        // Colombia 23:59:59 COT = UTC next-day 04:59:59
        end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) + COLOMBIA_OFFSET_MS);
    }

    // Helper to format date as YYYY-MM-DD HH:mm:ss for SQL (using UTC values
    // since DB stores UTC times)
    const formatDateForSQL = (date) => {
        const pad = (n) => n.toString().padStart(2, '0');
        const y = date.getUTCFullYear();
        const mo = date.getUTCMonth() + 1;
        const d = date.getUTCDate();
        const h = date.getUTCHours();
        const mi = date.getUTCMinutes();
        const s = date.getUTCSeconds();
        return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
    };

    // Buffer Strategy: Request +/- 2 days from backend to cover any edge cases
    const bufferStart = new Date(start.getTime() - 2 * 24 * 60 * 60 * 1000);
    const bufferEnd = new Date(end.getTime() + 2 * 24 * 60 * 60 * 1000);

    const fromParam = formatDateForSQL(bufferStart);
    const toParam = formatDateForSQL(bufferEnd);

    // Fetch wide range
    const query = `?limit=10000&from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}`;

    try {
        const orders = await ApiClient.get(`/orders${query}`);
        console.log(`🔍 [Buffer] Requested from ${fromParam} to ${toParam}`);

        if (!orders || orders.length === 0) {
            console.log('❌ Backend returned 0 orders from buffer');
            return [];
        }

        console.log(`✅ Backend returned ${orders.length} orders. Filtering client-side...`);

        // Filter strictly client-side with safe parsing
        const filtered = orders.filter(o => {
            if (!o.timestamp) return false;

            let orderDate;
            try {
                // The backend appends 'Z' to SQLite timestamps (e.g. "2025-02-25 21:07:33Z")
                // which causes the trailing "Z" on the seconds component (e.g. "33Z")
                // to result in NaN when used in new Date(y, m, d, h, min, "33Z").
                // FIX: strip the 'Z', normalize 'T' separator, then parse with Date.UTC()
                // so that the result is always a UTC-based Date object.
                const raw = o.timestamp
                    .replace('T', ' ')    // normalize "2025-02-25T21:07:33.000Z" → "2025-02-25 21:07:33.000Z"
                    .replace(/Z$/i, '');  // strip trailing Z; timestamps ARE stored as UTC

                // Split on any non-numeric run (handles -, space, :, . for milliseconds)
                const parts = raw.split(/\D+/);

                if (parts.length >= 6) {
                    // Use Date.UTC to interpret as UTC (not browser local time)
                    const utcMs = Date.UTC(
                        parseInt(parts[0]),      // year
                        parseInt(parts[1]) - 1,  // month (0-indexed)
                        parseInt(parts[2]),      // day
                        parseInt(parts[3]),      // hours (UTC)
                        parseInt(parts[4]),      // minutes
                        parseInt(parts[5])       // seconds (parseInt handles any trailing chars)
                    );
                    orderDate = new Date(utcMs);
                } else {
                    // Fallback for unexpected formats
                    orderDate = new Date(o.timestamp);
                }
            } catch (e) {
                console.warn('Date parse error:', o.timestamp);
                return false;
            }

            if (isNaN(orderDate.getTime())) {
                console.warn('Invalid date parsed from timestamp:', o.timestamp);
                return false;
            }

            // Debug sample of parsed dates
            if (Math.random() < 0.05) {
                console.log(`FYI: Parsed "${o.timestamp}" → ${orderDate.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
            }

            // Both orderDate (UTC) and start/end (UTC-corrected) use getTime() → valid UTC comparison
            return orderDate.getTime() >= start.getTime() && orderDate.getTime() <= end.getTime();
        });

        console.log(`✅ Final filtered count: ${filtered.length}`);
        return filtered;

    } catch (e) {
        console.error("History fetch error:", e);
        return [];
    }
}

export async function toggleOrderItem(orderId, itemIndex, checked, checkedQty) {
    const payload = { itemIndex };
    if (checkedQty !== undefined) {
        payload.checkedQty = checkedQty;
    } else {
        payload.checked = checked;
    }
    return await ApiClient.patch(`/orders/${orderId}/toggle-item`, payload);
}
