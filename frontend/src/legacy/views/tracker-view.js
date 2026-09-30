import { $, getStatusBadge, getDateMillis, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';


let trackerGeneral = [];
let trackerLocal = [];

export function updateTracker(orders, source) {
    if (source === 'general') trackerGeneral = orders;
    if (source === 'local') trackerLocal = orders;

    // Merge and sort
    const all = [...trackerGeneral, ...trackerLocal].sort((a, b) => {
        const dateA = getDateMillis(a.timestamp || a.date);
        const dateB = getDateMillis(b.timestamp || b.date);
        return dateB - dateA; // Newest first
    });

    renderTrackerList(all);
}

export function renderTrackerList(orders) {
    const list = $('status-list');
    const now = Date.now();

    const filtered = orders.filter(o => {
        if (o.status === 'Anulado') return false;

        // 5 Minutes logic for Terminado, Entregado, Cobrado
        if (['Terminado', 'Entregado', 'Cobrado'].includes(o.status)) {
            // EXCEPTION: Domicilio orders should remain visible indefinitely while waiting to be picked up.
            if (o.type === 'Domicilio' && o.status === 'Terminado') {
                return true;
            }

            const statusTime = getDateMillis(o.statusTimestamp || o.timestamp || o.date);
            // 5 mins * 60 secs * 1000 ms
            if (now - statusTime > 5 * 60 * 1000) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="text-center py-10 opacity-50">
                <i class="fas fa-spinner fa-spin text-3xl text-gray-300 mb-2"></i>
                <p class="text-gray-400 text-sm">Escuchando pedidos...</p>
            </div>
        `;
        return;
    }

    list.innerHTML = filtered.map(o => {
        let borderColor = 'border-gray-200';
        if (o.status === 'Pendiente') borderColor = 'border-gray-400';
        if (o.status === 'Recibido') borderColor = 'border-yellow-400';
        if (o.status === 'En preparación') borderColor = 'border-orange-500';
        if (o.status === 'Terminado') borderColor = 'border-green-500';
        if (o.status === 'En Reparto') borderColor = 'border-blue-500';
        if (o.status === 'Entregado') borderColor = 'border-green-600';

        return `
        <div class="bg-white rounded-xl shadow-sm border-b-4 ${borderColor} p-4 flex justify-between items-center transition-all hover:shadow-md">
            <div>
                <span class="text-lg text-gray-800 font-bold">#${o.id}</span>
            </div>
            <div class="text-right">
                 ${getStatusBadge(o.status)}
            </div>
        </div>
    `}).join('');
}

export async function handleSearchOrder(silent = false) {
    const input = $('search-order-id').value.trim().toUpperCase();
    if (!input) return;

    const resContainer = $('search-result');

    if (!silent) {
        resContainer.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-indigo-500"></i> Buscando...</div>';
        resContainer.classList.remove('hidden');
    }

    try {
        let orderData = null;
        let orderId = null;

        const loadedOrder = [...state.orders, ...(state.waiterOrders || [])].find(o => o.id === input || o.id.endsWith(input));
        if (loadedOrder) {
            orderData = loadedOrder;
            orderId = loadedOrder.id;
        } else {
            // Search API if not found locally
            try {
                const res = await fetch(`/api/orders/${input}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.id) {
                        orderData = data;
                        orderId = data.id;
                    }
                }
            } catch (err) {
                console.error("API Search failed", err);
            }
        }

        if (orderData) {
            let borderColor = 'border-gray-200';
            if (orderData.status === 'Pendiente') borderColor = 'border-gray-400';
            if (orderData.status === 'Recibido') borderColor = 'border-yellow-400';
            if (orderData.status === 'En preparación') borderColor = 'border-orange-500';
            if (orderData.status === 'Terminado') borderColor = 'border-green-500';
            if (orderData.status === 'En Reparto') borderColor = 'border-blue-500';
            if (orderData.status === 'Entregado') borderColor = 'border-green-600';

            resContainer.innerHTML = `
                <div class="bg-gray-50 rounded-xl border-b-4 ${borderColor} p-4 text-center animate-pulse-fade">
                    <div class="text-xs text-gray-400 mb-1">Resultado:</div>
                    <h4 class="font-bold text-xl text-gray-800 mb-2">#${escapeHtml(orderId)}</h4>
                    <div class="mb-2">${getStatusBadge(orderData.status)}</div>
                </div>
            `;
            resContainer.classList.remove('hidden');
            // Success - Update URL
            const url = new URL(window.location);
            url.searchParams.set('view', 'tracker');
            url.searchParams.set('track', orderId);
            window.history.pushState({}, '', url);
            state.currentTrackId = orderId;

        } else {
            resContainer.innerHTML = `
                <div class="text-center py-4 text-gray-400">
                    <i class="fas fa-search mb-2 text-xl"></i>
                    <p>No encontramos un pedido con ese ID.</p>
                </div>
            `;
            resContainer.classList.remove('hidden');
            // Clear track param if not found
            const url = new URL(window.location);
            url.searchParams.set('view', 'tracker');
            url.searchParams.delete('track');
            window.history.pushState({}, '', url);
        }

    } catch (e) {
        console.error(e);
        resContainer.innerHTML = '<div class="text-center text-red-400">Error al buscar.</div>';
    }
}
