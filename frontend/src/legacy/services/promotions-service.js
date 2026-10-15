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

export function calculateComboPricing(combo) {
    if (!combo) return { basePrice: 0, finalPrice: 0, savings: 0 };
    const items = Array.isArray(combo.items_config) ? combo.items_config : [];
    const sumBase = items.reduce((sum, it) => {
        const p = parseFloat(it.price) || 0;
        const q = parseFloat(it.qty) || 1;
        return sum + (p * q);
    }, 0);

    let finalPrice = sumBase;
    let savings = 0;

    if (combo.type === 'FIXED_PRICE') {
        finalPrice = parseFloat(combo.combo_price) || 0;
        savings = Math.max(0, sumBase - finalPrice);
    } else if (combo.type === 'PERCENT_DISCOUNT' || combo.type === 'PERCENTAGE_DISCOUNT') {
        const pct = (parseFloat(combo.discount_value) || 0) / 100;
        savings = sumBase * pct;
        finalPrice = Math.max(0, sumBase - savings);
    } else if (combo.type === 'FIXED_DISCOUNT') {
        savings = Math.min(sumBase, parseFloat(combo.discount_value) || 0);
        finalPrice = Math.max(0, sumBase - savings);
    } else if (combo.type === 'FREE_PRODUCT' || combo.type === 'N_PLUS_M' || combo.type === 'NXM') {
        savings = items.reduce((sum, it) => it.is_free ? sum + ((parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1)) : sum, 0);
        finalPrice = Math.max(0, sumBase - savings);
    }
    return {
        basePrice: sumBase,
        finalPrice: Math.round(finalPrice),
        savings: Math.round(savings)
    };
}

