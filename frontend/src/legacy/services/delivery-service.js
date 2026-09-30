import { ApiClient } from './api-client.js';

export async function getDeliveryZones() {
    return await ApiClient.get('/delivery-zones');
}

export async function saveDeliveryZone(data, id = null) {
    if (id) {
        return await ApiClient.put(`/delivery-zones/${id}`, data);
    }
    return await ApiClient.post('/delivery-zones', data);
}

export async function toggleDeliveryZone(id) {
    return await ApiClient.patch(`/delivery-zones/${id}/toggle`);
}

export async function deleteDeliveryZone(id) {
    return await ApiClient.delete(`/delivery-zones/${id}`);
}

export function listenToDeliveryZones(callback) {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return () => {};

    const onUpdate = async () => {
        try {
            const zones = await getDeliveryZones();
            callback(zones);
        } catch (error) {
            console.error("Error updating delivery zones from socket event:", error);
        }
    };

    socket.on('delivery_zones_updated', onUpdate);

    return () => {
        socket.off('delivery_zones_updated', onUpdate);
    };
}
