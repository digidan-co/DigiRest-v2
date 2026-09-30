import { ApiClient } from './api-client.js';

export async function getCustomers(params = {}) {
    const query = new URLSearchParams(params).toString();
    const endpoint = query ? `/customers?${query}` : '/customers';
    return await ApiClient.get(endpoint);
}

export async function getCustomerStats() {
    return await ApiClient.get('/customers/stats');
}

export async function getCustomerProfile(phone) {
    return await ApiClient.get(`/customers/${encodeURIComponent(phone)}`);
}

export async function updateCustomer(phone, data) {
    return await ApiClient.put(`/customers/${encodeURIComponent(phone)}`, data);
}

export async function syncCustomers() {
    return await ApiClient.post('/customers/sync');
}


export function listenToCustomers(callback) {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return () => {};

    const onUpdate = async () => {
        // Only admins have permissions for /customers endpoints
        const role = (window.state?.user?.role || '').toLowerCase();
        if (role !== 'admin') return;

        try {
            const [customers, stats] = await Promise.all([
                getCustomers(),
                getCustomerStats()
            ]);
            callback({ customers, stats });
        } catch (error) {
            console.error("Error updating customers from socket event:", error);
        }
    };

    socket.on('customers_updated', onUpdate);

    return () => {
        socket.off('customers_updated', onUpdate);
    };
}
