import { ApiClient } from './api-client.js';

export async function getToppings() {
    return await ApiClient.get('/toppings');
}

export async function saveTopping(data, id = null) {
    if (id) {
        return await ApiClient.put(`/toppings/${id}`, data);
    }
    return await ApiClient.post('/toppings', data);
}

export async function toggleTopping(id) {
    return await ApiClient.patch(`/toppings/${id}/toggle`);
}

export async function deleteTopping(id) {
    return await ApiClient.delete(`/toppings/${id}`);
}

export async function getSuppliesForToppings() {
    try {
        return await ApiClient.get('/inventory/supplies');
    } catch (e) {
        console.error("Error fetching supplies for toppings:", e);
        return [];
    }
}

export function listenToToppings(callback) {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return () => {};

    const onUpdate = async () => {
        try {
            const toppings = await getToppings();
            callback(toppings);
        } catch (error) {
            console.error("Error updating toppings from socket event:", error);
        }
    };

    socket.on('toppings_updated', onUpdate);

    return () => {
        socket.off('toppings_updated', onUpdate);
    };
}

export async function importToppingsCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    return await ApiClient.post('/toppings/import', formData);
}
