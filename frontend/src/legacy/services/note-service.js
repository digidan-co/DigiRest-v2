import { ApiClient } from './api-client.js';

export async function getOrderNotes(orderId) {
    return await ApiClient.get(`/orders/${orderId}/notes`);
}

export async function getActiveNotes() {
    return await ApiClient.get(`/notes/all-active`);
}

export async function addOrderNotes(orderId, notes, waiterId) {
    return await ApiClient.post(`/orders/${orderId}/notes`, { notes, waiterId });
}

export async function solveOrderNote(noteId, solved, userId) {
    return await ApiClient.patch(`/notes/${noteId}/solve`, { solved, userId });
}

export async function deleteOrderNote(noteId) {
    return await ApiClient.delete(`/notes/${noteId}`);
}
