import { ApiClient } from './api-client.js';

// ==========================================
// CUPONES DE DESCUENTO
// ==========================================

export async function getCoupons() {
    return await ApiClient.get('/coupons');
}

export async function saveCoupon(data, id = null) {
    if (id) {
        return await ApiClient.put(`/coupons/${id}`, data);
    }
    return await ApiClient.post('/coupons', data);
}

export async function toggleCoupon(id) {
    return await ApiClient.patch(`/coupons/${id}/toggle`);
}

export async function deleteCoupon(id) {
    return await ApiClient.delete(`/coupons/${id}`);
}

export async function validateCoupon(code, orderTotal = 0, channel = 'Domicilio') {
    return await ApiClient.post('/coupons/validate', {
        code,
        order_total: orderTotal,
        channel
    });
}

// ==========================================
// CAMPAÑAS DE DESCUENTO
// ==========================================

export async function getDiscountCampaigns() {
    return await ApiClient.get('/discount-campaigns');
}

export async function saveDiscountCampaign(data, id = null) {
    if (id) {
        return await ApiClient.put(`/discount-campaigns/${id}`, data);
    }
    return await ApiClient.post('/discount-campaigns', data);
}

export async function toggleDiscountCampaign(id) {
    return await ApiClient.patch(`/discount-campaigns/${id}/toggle`);
}

export async function deleteDiscountCampaign(id) {
    return await ApiClient.delete(`/discount-campaigns/${id}`);
}

export async function getActiveDiscounts() {
    return await ApiClient.get('/active-discounts');
}
