import { ApiClient } from './api-client.js';

// --- Consolidado & Movimientos ---
export async function getCashflow(params = {}) {
    const query = new URLSearchParams();
    if (params.startDate) query.append('startDate', params.startDate);
    if (params.endDate) query.append('endDate', params.endDate);
    if (params.paymentMethod) query.append('paymentMethod', params.paymentMethod);
    if (params.accountId) query.append('accountId', params.accountId);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return ApiClient.get(`/cashflow${queryString}`);
}

export async function createCashMovement(movementData) {
    return ApiClient.post('/cashflow/movement', movementData);
}

export async function deleteCashMovement(id) {
    return ApiClient.delete(`/cashflow/movement/${id}`);
}

// --- Cuentas (Fondos) ---
export async function getAccounts(params = {}) {
    const query = new URLSearchParams();
    if (params.type) query.append('type', params.type);
    if (params.active !== undefined) query.append('active', params.active);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return ApiClient.get(`/cashflow/accounts${queryString}`);
}

export async function createAccount(data) {
    return ApiClient.post('/cashflow/accounts', data);
}

export async function updateAccount(id, data) {
    return ApiClient.put(`/cashflow/accounts/${id}`, data);
}

export async function deleteAccount(id) {
    return ApiClient.delete(`/cashflow/accounts/${id}`);
}

export async function toggleAccountActive(id) {
    return ApiClient.patch(`/cashflow/accounts/${id}/toggle`);
}

export async function transferBetweenAccounts(data) {
    return ApiClient.post('/cashflow/accounts/transfer', data);
}

// --- Categorías ---
export async function getCategories(params = {}) {
    const query = new URLSearchParams();
    if (params.type) query.append('type', params.type);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return ApiClient.get(`/cashflow/categories${queryString}`);
}

export async function createCategory(data) {
    return ApiClient.post('/cashflow/categories', data);
}

export async function updateCategory(id, data) {
    return ApiClient.put(`/cashflow/categories/${id}`, data);
}

export async function deleteCategory(id) {
    return ApiClient.delete(`/cashflow/categories/${id}`);
}

// --- Cuentas Por Pagar (CxP) ---
export async function getPayables(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return ApiClient.get(`/cashflow/payables${queryString}`);
}

export async function createPayable(data) {
    return ApiClient.post('/cashflow/payables', data);
}

export async function payPayable(id, data) {
    return ApiClient.post(`/cashflow/payables/${id}/pay`, data);
}

export async function deletePayable(id) {
    return ApiClient.delete(`/cashflow/payables/${id}`);
}

// --- Cuentas Por Cobrar (CxC) ---
export async function getReceivables(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return ApiClient.get(`/cashflow/receivables${queryString}`);
}

export async function createReceivable(data) {
    return ApiClient.post('/cashflow/receivables', data);
}

export async function collectReceivable(id, data) {
    return ApiClient.post(`/cashflow/receivables/${id}/collect`, data);
}

export async function deleteReceivable(id) {
    return ApiClient.delete(`/cashflow/receivables/${id}`);
}
