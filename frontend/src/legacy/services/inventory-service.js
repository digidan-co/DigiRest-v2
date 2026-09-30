import { ApiClient } from './api-client.js';

export async function getInventorySummary() {
    return ApiClient.get('/inventory/summary');
}

export async function getSupplies() {
    return ApiClient.get('/inventory/supplies');
}

export async function createSupply(supply) {
    return ApiClient.post('/inventory/supplies', supply);
}

export async function updateSupply(id, supply) {
    return ApiClient.put(`/inventory/supplies/${id}`, supply);
}

export async function adjustSupplyStock(id, data) {
    return ApiClient.post(`/inventory/supplies/${id}/adjust`, data);
}

export async function deleteSupply(id) {
    return ApiClient.delete(`/inventory/supplies/${id}`);
}

export async function getRecipes() {
    return ApiClient.get('/inventory/recipes');
}

export async function getRecipeByProduct(productId) {
    return ApiClient.get(`/inventory/recipes/product/${productId}`);
}

export async function saveRecipe(recipe) {
    return ApiClient.post('/inventory/recipes', recipe);
}

export async function deleteRecipe(id) {
    return ApiClient.delete(`/inventory/recipes/${id}`);
}

export async function getInventoryMovements(limit = 100) {
    return ApiClient.get(`/inventory/movements?limit=${limit}`);
}
