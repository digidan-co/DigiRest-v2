import { ApiClient } from './api-client.js';

export async function getPromotionsCombos(activeOnly = false, channel = null) {
    const params = new URLSearchParams();
    if (activeOnly) params.append('active_only', 'true');
    if (channel) params.append('channel', channel);
    const query = params.toString() ? `?${params.toString()}` : '';
    return await ApiClient.get(`/promotions-combos${query}`);
}

export async function getPromotionCombo(id) {
    return await ApiClient.get(`/promotions-combos/${id}`);
}

export async function savePromotionCombo(data, id = null) {
    if (id) {
        return await ApiClient.put(`/promotions-combos/${id}`, data);
    }
    return await ApiClient.post('/promotions-combos', data);
}

export async function togglePromotionCombo(id) {
    return await ApiClient.patch(`/promotions-combos/${id}/toggle`);
}

export async function deletePromotionCombo(id) {
    return await ApiClient.delete(`/promotions-combos/${id}`);
}

export function listenToPromotionsCombos(callback) {
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return () => {};

    const onUpdate = async () => {
        try {
            const list = await getPromotionsCombos();
            callback(list);
        } catch (error) {
            console.error("Error updating promotions/combos from socket:", error);
        }
    };

    socket.on('promotions_combos_updated', onUpdate);

    return () => {
        socket.off('promotions_combos_updated', onUpdate);
    };
}
