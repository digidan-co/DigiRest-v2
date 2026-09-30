import { ApiClient } from './api-client.js';

export async function getGastos(date) {
    const q = date ? `?date=${date}` : '';
    return ApiClient.get(`/gastos-dia${q}`);
}

export async function createGasto(gasto) {
    return ApiClient.post('/gastos-dia', gasto);
}

export async function updateGasto(id, gasto) {
    return ApiClient.put(`/gastos-dia/${id}`, gasto);
}

export async function deleteGasto(id) {
    return ApiClient.delete(`/gastos-dia/${id}`);
}
