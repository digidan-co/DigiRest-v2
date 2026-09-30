// IndexedDB wrapper for offline capabilities

const DB_NAME = 'pos_offline_db';
const DB_VERSION = 2;
const STORE_QUEUE = 'request_queue';
const STORE_CACHE = 'api_cache';
const STORE_OFFLINE_ORDERS = 'offline_orders';

export const OfflineDB = {
    db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => reject(event.target.error);

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store for queued offline requests (POST, PUT, DELETE)
                if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                    db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
                }

                // Store for cached API responses (GET) - as a fallback to sw.js
                // Mostly our SW will handle GET caching, but we might want this for explicit data
                if (!db.objectStoreNames.contains(STORE_CACHE)) {
                    db.createObjectStore(STORE_CACHE, { keyPath: 'url' });
                }

                // Store for locally-saved orders created while offline
                if (!db.objectStoreNames.contains(STORE_OFFLINE_ORDERS)) {
                    db.createObjectStore(STORE_OFFLINE_ORDERS, { keyPath: 'id' });
                }
            };
        });
    },

    async ensureDb() {
        if (!this.db) await this.init();
        return this.db;
    },

    // --- Request Queue Methods --- //

    async enqueueRequest(requestObj) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            // requestObj should have: url, method, headers, body, timestamp
            const request = store.add({
                ...requestObj,
                timestamp: Date.now()
            });

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getQueue() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readonly');
            const store = transaction.objectStore(STORE_QUEUE);
            const request = store.getAll();

            request.onsuccess = () => {
                // sort by timestamp to maintain order
                const queue = request.result || [];
                queue.sort((a, b) => a.timestamp - b.timestamp);
                resolve(queue);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async removeFromQueue(id) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearQueue() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    /** Remove all queued requests matching a URL (e.g., '/orders') */
    async removeFromQueueByUrl(urlPattern) {
        const db = await this.ensureDb();
        const queue = await this.getQueue();
        const toRemove = queue.filter(req => req.url === urlPattern);
        if (toRemove.length === 0) return;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            let completed = 0;
            toRemove.forEach(req => {
                const request = store.delete(req.id);
                request.onsuccess = () => {
                    completed++;
                    if (completed === toRemove.length) resolve();
                };
                request.onerror = (e) => reject(e.target.error);
            });
            if (toRemove.length === 0) resolve();
        });
    },

    /** Update the body of a queued request by its _offlineId */
    async updateQueuedRequestByOfflineId(offlineId, newBody) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            const request = store.getAll();
            request.onsuccess = () => {
                const items = request.result || [];
                const match = items.find(item => item._offlineId === offlineId);
                if (match) {
                    match.body = newBody;
                    const updateReq = store.put(match);
                    updateReq.onsuccess = () => resolve(true);
                    updateReq.onerror = (e) => reject(e.target.error);
                } else {
                    resolve(false); // Not found
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    /** Update any fields of a queued request by its auto-increment ID */
    async updateQueuedRequest(id, updates) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORE_QUEUE);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const item = getReq.result;
                if (!item) { resolve(false); return; }
                const updated = { ...item, ...updates };
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve(true);
                putReq.onerror = (e) => reject(e.target.error);
            };
            getReq.onerror = (e) => reject(e.target.error);
        });
    },

    // --- Offline Orders Methods --- //

    async saveOfflineOrder(order) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_OFFLINE_ORDERS], 'readwrite');
            const store = transaction.objectStore(STORE_OFFLINE_ORDERS);
            const request = store.put(order);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getOfflineOrders() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_OFFLINE_ORDERS], 'readonly');
            const store = transaction.objectStore(STORE_OFFLINE_ORDERS);
            const request = store.getAll();

            request.onsuccess = () => {
                const orders = request.result || [];
                orders.sort((a, b) => (a._createdAt || 0) - (b._createdAt || 0));
                resolve(orders);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async removeOfflineOrder(id) {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_OFFLINE_ORDERS], 'readwrite');
            const store = transaction.objectStore(STORE_OFFLINE_ORDERS);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearOfflineOrders() {
        const db = await this.ensureDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_OFFLINE_ORDERS], 'readwrite');
            const store = transaction.objectStore(STORE_OFFLINE_ORDERS);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
};
