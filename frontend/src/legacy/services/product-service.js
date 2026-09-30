import { ApiClient } from './api-client.js';

export async function getProducts() {
    return await ApiClient.get('/products');
}

export async function saveProduct(data, id = null) {
    const formData = new FormData();

    // Append all text data
    for (const key in data) {
        if (key === 'img') continue; // Handle image separately
        formData.append(key, data[key]);
    }
    if (id) formData.append('id', id);

    // Handle Image
    if (data.img instanceof File || data.img instanceof Blob) {
        formData.append('image', data.img, data.img.name || 'image.jpg');
    } else if (typeof data.img === 'string') {
        formData.append('img', data.img); // Keep existing URL or base64 if backend supports it
    }

    return await ApiClient.post('/products', formData);
}

export async function deleteProduct(id) {
    return await ApiClient.delete(`/products/${id}`);
}

export async function getCategories() {
    return await ApiClient.get('/categories');
}

export async function saveCategory(data, id = null) {
    return await ApiClient.post('/categories', { id, ...data });
}

// Socket listening
export function listenToProducts(callback) {
    const socket = window.socket || io();

    const onUpdate = async () => {
        try {
            const [prods, cats] = await Promise.all([getProducts(), getCategories()]);
            callback(prods, cats);
        } catch (error) {
            console.error("Error updating products from socket event:", error);
            setTimeout(onUpdate, 5000); // Retry after 5 seconds
        }
    };

    socket.on('products_updated', onUpdate);
    socket.on('categories_updated', onUpdate);

    return () => {
        socket.off('products_updated', onUpdate);
        socket.off('categories_updated', onUpdate);
    };
}

export async function deleteCategory(id) {
    return await ApiClient.delete(`/categories/${id}`);
}

export async function importCategoriesCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    return await ApiClient.post('/categories/import', formData);
}

export async function importProductsCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    return await ApiClient.post('/products/import', formData);
}

export async function toggleProductRecommended(id) {
    return await ApiClient.patch(`/products/${id}/toggle-recommended`);
}

export async function toggleProductPromo(id) {
    return await ApiClient.patch(`/products/${id}/toggle-promo`);
}

export async function getTopDishes7d() {
    return await ApiClient.get('/products/top-dishes-7d');
}


