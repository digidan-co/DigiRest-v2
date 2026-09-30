import { $, initSlideButtons, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';
import { updateOrder } from '../services/order-service.js';
import { toast, showModalAlert, showConfirmModal } from '../components/ui.js';
import { ApiClient } from '../services/api-client.js';

export function renderDeliveryGrid(orders) {
    const grid = $('delivery-grid');
    if (orders.length === 0) {
        $('delivery-empty').classList.remove('hidden');
        grid.innerHTML = '';
        return;
    }
    $('delivery-empty').classList.add('hidden');

    grid.innerHTML = orders.map(o => {
        // Check if order is locked by another driver
        const isLocked = o.deliveryDriverId && o.deliveryDriverId != state.user.id;
        const isMyOrder = o.deliveryDriverId == state.user.id;
        const showUnlockButton = isMyOrder && (o.status === 'En Reparto' || o.status === 'En ruta');

        return `
        <div class="bg-white rounded-xl shadow p-2 border ${isLocked ? 'border-gray-300 opacity-60' : 'border-blue-100'}">
             <div class="flex justify-between mb-1">
                <h3 class="font-bold text-sm leading-tight">#${o.id}</h3>
                <div class="flex items-center gap-1">
                    <span class="text-[10px] font-bold text-blue-600">${o.status}</span>
                    ${showUnlockButton ? `
                        <button data-unlock-id="${o.id}" 
                            class="unlock-order-btn bg-orange-100 hover:bg-orange-200 text-orange-600 px-2 py-1 rounded text-[9px] font-bold transition-colors flex items-center gap-1"
                            title="Desbloquear pedido">
                            <i class="fas fa-unlock text-[9px]"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
            ${isLocked ? `
                <div class="bg-orange-50 border border-orange-200 rounded p-2 mb-2">
                    <div class="flex items-center gap-2 text-orange-700">
                        <i class="fas fa-lock text-xs"></i>
                        <span class="text-[10px] font-bold">Tomado por ${escapeHtml(o.deliveryDriverName || 'otro repartidor')}</span>
                    </div>
                </div>
            ` : ''}
            <p class="text-xs font-medium leading-tight">${escapeHtml(o.client)}</p>
            ${o.delivery_zone ? `
                <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-100/80 text-orange-800 text-[10px] font-bold my-1">
                    <i class="fas fa-map-marker-alt text-orange-600"></i>
                    <span>${escapeHtml(o.delivery_zone)}</span>
                    ${parseFloat(o.delivery_fee) > 0 ? `<span class="text-orange-950 font-black">(${formatMoney(o.delivery_fee)})</span>` : ''}
                </div>
            ` : ''}
            <p class="text-[10px] text-gray-500 mb-1 leading-tight"><i class="fas fa-location-arrow text-[9px] mr-1 text-gray-400"></i>${escapeHtml(o.address)}</p>
            <a href="https://wa.me/+57${o.phone}" target="_blank" class="text-[10px] text-green-600 mb-2 block"><i class="fab fa-whatsapp"></i> ${o.phone}</a>
            ${o.notes ? `
                <div class="mb-2 bg-yellow-50 text-yellow-700 p-1.5 rounded text-[10px] flex gap-2 items-start leading-tight">
                    <i class="fas fa-sticky-note mt-0.5"></i>
                    <p>${escapeHtml(o.notes)}</p>
                </div>
            ` : ''}
            ${isLocked ? `
                <div class="bg-gray-200 text-gray-500 h-8 rounded flex items-center justify-center text-xs font-bold">
                    <i class="fas fa-ban mr-2"></i> No disponible
                </div>
            ` : o.status === 'Terminado'
                ? `
            <div class="slider-container bg-blue-600 h-8" id="slider-${o.id}" data-id="${o.id}" data-action="En Reparto" data-callback="updateOrderStatus">
                <div class="slider-text text-xs">Iniciar Ruta <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                <div class="slider-thumb w-8 h-8 border-blue-600"><i class="fas fa-motorcycle text-xs"></i></div>
            </div>
            `
                : `
            <div class="slider-container bg-green-600 h-8" id="slider-${o.id}" data-id="${o.id}" data-action="Entregado" data-callback="updateOrderStatus">
                <div class="slider-text text-xs">Entregado <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                <div class="slider-thumb w-8 h-8 border-green-600"><i class="fas fa-check text-xs"></i></div>
            </div>
            `
            }
        </div>
    `;
    }).join('');

    initSlideButtons();

    // Add event delegation for unlock buttons
    const unlockButtons = document.querySelectorAll('.unlock-order-btn');
    unlockButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            const orderId = btn.getAttribute('data-unlock-id');
            if (!orderId) return;

            showConfirmModal(
                "Desbloquear Pedido",
                "¿Estás seguro de desbloquear este pedido? Otro repartidor podrá tomarlo.",
                async () => {
                    try {
                        // Change status back to Terminado and clear driver assignment
                        await updateOrder(orderId, {
                            status: 'Terminado',
                            deliveryDriverId: null,
                            deliveryDriverName: null
                        });
                        toast("Pedido desbloqueado exitosamente", "success");

                        // Refresh delivery orders to reflect change immediately
                        const orders = await ApiClient.get('/orders');
                        const deliveryOrders = orders.filter(o => o.type === 'Domicilio' &&
                            (o.status === 'Terminado' || o.status === 'En Reparto' || o.status === 'En ruta'));
                        renderDeliveryGrid(deliveryOrders);
                    } catch (err) {
                        console.error(err);
                        toast("Error al desbloquear pedido", "error");
                    }
                },
                null,
                "Desbloquear"
            );
        });
    });
}

export async function handleUpdateOrderStatus(id, status) {
    const card = document.getElementById(`slider-${id}`)?.closest('.bg-white');
    if (card && (status === 'Entregado')) {
        card.classList.add('fade-out-slow');
        await new Promise(resolve => setTimeout(resolve, 800));
    }

    try {
        await updateOrder(id, {
            status: status,
            // statusTimestamp handled by backend
            ...(status === 'En Reparto' ? { deliveryDriverId: state.user.id, deliveryDriverName: state.user.name } : {})
        });
        toast(`Pedido ${status}`, "success");
        const order = (state.orders || []).find(o => o.id == id);
    } catch (e) {
        console.error(e);

        // Handle locked order error
        if (e.response?.status === 409 && e.response?.data?.error === 'ORDER_LOCKED') {
            showModalAlert("Pedido No Disponible", e.response.data.message, "warning");
        } else {
            showModalAlert("Error", "Error actualizando pedido", "error");
        }

        if (card) card.classList.remove('fade-out-slow');
    }
}
