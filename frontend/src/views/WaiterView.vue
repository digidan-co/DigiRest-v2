<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { listenToWaiterOrders } from '@/legacy/services/order-service.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import {
    openWaiterHistory,
    openWaiterModal,
    openWaiterNotesModal,
    openAddItemModal,
    handleWaiterProofUpload,
    getStatusColor
} from '@/legacy/views/waiter-view.js';

const allWaiterOrders = ref([]);
const myOrders = ref([]);

const userName = computed(() => {
    if (state.user?.name) return state.user.name;
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) return JSON.parse(raw)?.name || 'Mesero';
        } catch (_) {}
    }
    return 'Mesero';
});

const activeOrders = computed(() =>
    myOrders.value.filter(o => o.status !== 'Cobrado' && o.status !== 'Anulado')
);

function itemCheckedQty(i) { return i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0); }
function orderProgress(o) {
    const total = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const checked = (o.items || []).reduce((s, i) => s + itemCheckedQty(i), 0);
    return total > 0 ? Math.round((checked / total) * 100) : 0;
}
function itemStyle(i) { return itemCheckedQty(i) >= i.qty ? 'text-gray-400 line-through' : 'text-gray-600'; }
function iconColor(i) { return itemCheckedQty(i) >= i.qty ? 'text-[var(--system-primary)]' : 'text-orange-400'; }
function displayQty(i) {
    const checkedQty = itemCheckedQty(i);
    const isFully = checkedQty >= i.qty;
    if (i.qty > 1 && checkedQty > 0 && !isFully) return `[${checkedQty}/${i.qty}] `;
    return `${i.qty}x `;
}
function formatTime(o) {
    return new Date(o.timestamp).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
}
function showProof(o) {
    if (window.showImageModal) window.showImageModal(o.proof);
}

function updateMyOrders() {
    let user = state.user;
    if (!user && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) user = JSON.parse(raw);
        } catch (_) {}
    }
    if (!user) {
        myOrders.value = [];
        return;
    }
    const userIdStr = user.id !== undefined && user.id !== null ? String(user.id) : null;
    const userNameStr = user.name ? String(user.name).trim().toLowerCase() : '';

    myOrders.value = allWaiterOrders.value.filter(o => {
        const matchesId = userIdStr && o.waiterId !== undefined && o.waiterId !== null && String(o.waiterId) === userIdStr;
        const matchesName = userNameStr && o.waiterName && String(o.waiterName).trim().toLowerCase() === userNameStr;
        return matchesId || matchesName;
    });
    state.waiterOrders = myOrders.value;
}

watch(() => state.user, () => {
    updateMyOrders();
}, { deep: true, immediate: true });

let unsub = null;
onMounted(() => {
    unsub = listenToWaiterOrders('waiter', (orders) => {
        allWaiterOrders.value = orders || [];
        updateMyOrders();
    });
});
onUnmounted(() => { if (unsub) unsub(); });
</script>

<template>
    <div class="flex justify-between items-center mb-6 sticky z-30 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-gray-200/50 transition-all"
        style="top: calc(4rem + env(safe-area-inset-top, 0px));">
        <div>
            <h2 class="text-2xl font-bold text-gray-800 tracking-tight">Panel de Mesero</h2>
            <p class="text-xs text-green-600 font-bold">Hola, {{ userName }}</p>
        </div>
        <div class="flex gap-2">
            <button type="button" @click="openWaiterHistory"
                class="bg-blue-100 text-blue-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-200 transition-colors shadow-sm">
                <i class="fas fa-history mr-1"></i> Historial Hoy
            </button>
            <button type="button" @click="openWaiterModal"
                class="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-black transition-colors shadow-lg">
                <i class="fas fa-plus mr-1"></i> Nuevo Pedido
            </button>
        </div>
    </div>

    <div class="mb-4">
        <h3 class="font-bold text-gray-700 mb-2">Mis Pedidos Activos</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-3 sm:gap-4">
            <div v-for="o in activeOrders" :key="o.id"
                class="p-4 rounded-xl border shadow-sm hover:shadow-md transition-all flex flex-col h-full"
                :class="o._offline ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-100'">
                <div class="mb-3 border-b border-gray-50 pb-2">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-base font-bold text-gray-500">#{{ o.id }}</span>
                        <div class="flex gap-2 items-center">
                            <button type="button" @click.stop="openWaiterNotesModal(o.id)"
                                class="w-7 h-7 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors relative bell-ring-container">
                                <div v-if="o.unsolved_notes_count > 0" class="bell-pulse-ring"></div>
                                <i class="fas fa-bell relative z-10" :class="o.unsolved_notes_count > 0 ? 'animate-jump-spin' : ''"></i>
                            </button>
                            <span class="text-[14px] font-bold px-2 py-0.5 rounded" :class="getStatusColor(o.status)">{{ o.status }}</span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center">
                        <div class="text-lg font-bold text-gray-800">Mesa {{ o.table || o.tableNum || '?' }}</div>
                        <div class="text-xs text-gray-400"><i class="far fa-clock mr-1"></i>{{ formatTime(o) }}</div>
                    </div>
                </div>

                <div class="mb-3">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-[var(--system-primary)] to-[#e09e45] h-full transition-all duration-300" :style="{ width: orderProgress(o) + '%' }"></div>
                        </div>
                        <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">{{ orderProgress(o) }}%</span>
                    </div>
                </div>

                <div class="space-y-1 mb-4 flex-1">
                    <div v-for="(i, idx) in o.items" :key="idx" class="flex flex-col text-sm transition-all mb-1" :class="itemStyle(i)">
                        <div class="flex justify-between">
                            <span>
                                <i v-if="itemCheckedQty(i) > 0" class="fas fa-check-circle text-xs mr-1" :class="iconColor(i)" :title="itemCheckedQty(i) + '/' + i.qty + ' listos'"></i>
                                {{ displayQty(i) }}{{ i.name }}
                            </span>
                        </div>
                        <span v-if="i.toppings_text" class="text-[10px] text-amber-800 font-semibold pl-2 leading-tight">+ {{ i.toppings_text }}</span>
                        <span v-if="i.notes" class="text-[10px] text-gray-500 italic pl-2 leading-tight"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>{{ i.notes }}</span>
                    </div>
                </div>

                <div class="flex items-center justify-between pt-2 border-t border-gray-50 mt-auto">
                    <div class="flex flex-col">
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-gray-900 text-xl">{{ formatMoney(o.total) }}</span>
                            <div v-if="o.payment === 'Transferencia' && o.proof && o.proof !== 'null'"
                                class="relative group w-8 h-8 rounded border border-gray-200 overflow-hidden cursor-pointer shadow-sm" title="Ver comprobante" @click="showProof(o)">
                                <img :src="o.proof" class="w-full h-full object-cover" alt="Comprobante" loading="lazy" />
                                <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center transition-all">
                                    <i class="fas fa-search-plus text-white text-[10px]"></i>
                                </div>
                            </div>
                        </div>
                        <button v-if="o.payment === 'Transferencia' && (!o.proof || o.proof === 'null')" type="button"
                            class="mt-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 transition-colors"
                            @click="handleWaiterProofUpload(o.id)">
                            <i class="fas fa-upload mr-1"></i> Subir Comprobante
                        </button>
                    </div>
                    <button type="button"
                        class="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center hover:bg-blue-200 transition-colors shadow-sm active:scale-95"
                        :data-id="o.id" title="Agregar Plato" @click.stop="openAddItemModal(o.id)">
                        <i class="fas fa-plus text-xl"></i>
                    </button>
                </div>
            </div>
        </div>
        <div v-show="activeOrders.length === 0" class="flex flex-col items-center justify-center py-10 opacity-50">
            <i class="fas fa-clipboard-list text-4xl text-gray-300 mb-2"></i>
            <p class="text-gray-400 text-sm">No tienes pedidos activos.</p>
        </div>
    </div>
</template>
