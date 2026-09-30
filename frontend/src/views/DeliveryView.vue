<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { listenToOrders, updateOrder } from '@/legacy/services/order-service.js';
import { ApiClient } from '@/legacy/services/api-client.js';
import { initSlideButtons, formatMoney } from '@/legacy/utils/helpers.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const orders = ref([]);
const userName = computed(() => state.user?.name || 'Delivery');

function isLocked(o) {
    return !!(o.deliveryDriverId && o.deliveryDriverId != state.user?.id);
}
function showUnlockButton(o) {
    return o.deliveryDriverId == state.user?.id && (o.status === 'En Reparto' || o.status === 'En ruta');
}
function openArchived() {
    if (typeof window.openArchived === 'function') window.openArchived();
}
function filterDelivery(list) {
    return (list || []).filter(o => o.type === 'Domicilio' &&
        (o.status === 'Terminado' || o.status === 'En Reparto' || o.status === 'En ruta'));
}
async function unlockOrder(o) {
    showConfirmModal(
        'Desbloquear Pedido',
        '¿Estás seguro de desbloquear este pedido? Otro repartidor podrá tomarlo.',
        async () => {
            try {
                await updateOrder(o.id, {
                    status: 'Terminado',
                    deliveryDriverId: null,
                    deliveryDriverName: null
                });
                toast('Pedido desbloqueado exitosamente', 'success');
                const all = await ApiClient.get('/orders');
                orders.value = filterDelivery(all);
            } catch (err) {
                console.error(err);
                toast('Error al desbloquear pedido', 'error');
            }
        },
        null,
        'Desbloquear'
    );
}

let unsub = null;
onMounted(() => {
    unsub = listenToOrders('delivery', (list) => { orders.value = list; });
});
onUnmounted(() => { if (unsub) unsub(); });

// Re-init the drag-to-act sliders after each render of the grid.
watch(orders, async () => {
    await nextTick();
    initSlideButtons();
});
</script>

<template>
    <div class="flex justify-between items-center mb-6 sticky z-30 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-gray-200/50 transition-all"
        style="top: calc(4rem + env(safe-area-inset-top, 0px));">
        <div>
            <h2 class="text-2xl font-bold text-gray-800 tracking-tight">Zona de Reparto</h2>
            <p class="text-xs text-blue-600 font-bold"><i class="fas fa-bolt"></i> Conexión Activa<span>- {{ userName }}</span></p>
        </div>
        <div class="flex gap-2">
            <button type="button" @click="openArchived"
                class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                <i class="fas fa-archive mr-1"></i>
            </button>
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
        <div v-for="o in orders" :key="o.id"
            class="bg-white rounded-xl shadow p-2 border"
            :class="isLocked(o) ? 'border-gray-300 opacity-60' : 'border-blue-100'">
            <div class="flex justify-between mb-1">
                <h3 class="font-bold text-sm leading-tight">#{{ o.id }}</h3>
                <div class="flex items-center gap-1">
                    <span class="text-[10px] font-bold text-blue-600">{{ o.status }}</span>
                    <button v-if="showUnlockButton(o)" type="button" @click="unlockOrder(o)"
                        class="unlock-order-btn bg-orange-100 hover:bg-orange-200 text-orange-600 px-2 py-1 rounded text-[9px] font-bold transition-colors flex items-center gap-1"
                        title="Desbloquear pedido">
                        <i class="fas fa-unlock text-[9px]"></i>
                    </button>
                </div>
            </div>

            <div v-if="isLocked(o)" class="bg-orange-50 border border-orange-200 rounded p-2 mb-2">
                <div class="flex items-center gap-2 text-orange-700">
                    <i class="fas fa-lock text-xs"></i>
                    <span class="text-[10px] font-bold">Tomado por {{ o.deliveryDriverName || 'otro repartidor' }}</span>
                </div>
            </div>

            <p class="text-xs font-medium leading-tight">{{ o.client }}</p>

            <div v-if="o.delivery_zone"
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-orange-100/80 text-orange-800 text-[10px] font-bold my-1">
                <i class="fas fa-map-marker-alt text-orange-600"></i>
                <span>{{ o.delivery_zone }}<span v-if="parseFloat(o.delivery_fee) > 0" class="text-orange-950 font-black">({{ formatMoney(o.delivery_fee) }})</span></span>
            </div>

            <p class="text-[10px] text-gray-500 mb-1 leading-tight"><i class="fas fa-location-arrow text-[9px] mr-1 text-gray-400"></i>{{ o.address }}</p>
            <a :href="'https://wa.me/+57' + o.phone" target="_blank" class="text-[10px] text-green-600 mb-2 block"><i class="fab fa-whatsapp"></i> {{ o.phone }}</a>

            <div v-if="o.notes" class="mb-2 bg-yellow-50 text-yellow-700 p-1.5 rounded text-[10px] flex gap-2 items-start leading-tight">
                <i class="fas fa-sticky-note mt-0.5"></i>
                <p>{{ o.notes }}</p>
            </div>

            <div v-if="isLocked(o)" class="bg-gray-200 text-gray-500 h-8 rounded flex items-center justify-center text-xs font-bold">
                <i class="fas fa-ban mr-2"></i> No disponible
            </div>
            <div v-else-if="o.status === 'Terminado'"
                class="slider-container bg-blue-600 h-8" :id="'slider-' + o.id" :data-id="o.id" data-action="En Reparto" data-callback="updateOrderStatus">
                <div class="slider-text text-xs">Iniciar Ruta <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                <div class="slider-thumb w-8 h-8 border-blue-600"><i class="fas fa-motorcycle text-xs"></i></div>
            </div>
            <div v-else
                class="slider-container bg-green-600 h-8" :id="'slider-' + o.id" :data-id="o.id" data-action="Entregado" data-callback="updateOrderStatus">
                <div class="slider-text text-xs">Entregado <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                <div class="slider-thumb w-8 h-8 border-green-600"><i class="fas fa-check text-xs"></i></div>
            </div>
        </div>
    </div>

    <div v-show="orders.length === 0" class="flex flex-col items-center justify-center py-20 opacity-50">
        <i class="fas fa-motorcycle text-6xl text-gray-300 mb-4"></i>
        <p class="text-gray-400 font-medium">No hay entregas pendientes.</p>
    </div>

    <div class="flex justify-center py-6 mt-8 border-t border-gray-100">
        <a href="https://www.digidan.co" target="_blank" rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 transition-opacity">
            <img src="/img/ceo.webp" alt="Powered by Digidan.co" style="width: 100px; height: auto;">
        </a>
    </div>
</template>
