<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { listenToWaiterOrders, listenToOrders } from '@/legacy/services/order-service.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import {
    openWaiterHistory,
    openWaiterModal,
    openWaiterNotesModal,
    openAddItemModal,
    handleWaiterProofUpload,
    getStatusColor
} from '@/legacy/views/waiter-view.js';

// Reactive state
const rawLocalOrders = ref([]);
const rawGeneralOrders = ref([]);
const activeTab = ref('locales'); // 'locales' | 'generales'

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

// Helper to test if an order belongs to the currently logged in waiter
function isMyOrder(o) {
    let user = state.user;
    if (!user && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) user = JSON.parse(raw);
        } catch (_) {}
    }
    if (!user) return false;
    const userIdStr = user.id !== undefined && user.id !== null ? String(user.id) : null;
    const userNameStr = user.name ? String(user.name).trim().toLowerCase() : '';
    const matchesId = userIdStr && o.waiterId !== undefined && o.waiterId !== null && String(o.waiterId) === userIdStr;
    const matchesName = userNameStr && o.waiterName && String(o.waiterName).trim().toLowerCase() === userNameStr;
    return matchesId || matchesName;
}

// Active orders filter: excludes Cobrado and Anulado in real-time
const activeLocalOrders = computed(() => {
    return rawLocalOrders.value.filter(o =>
        isMyOrder(o) && o.status !== 'Cobrado' && o.status !== 'Anulado'
    );
});

const activeGeneralOrders = computed(() => {
    return rawGeneralOrders.value.filter(o =>
        isMyOrder(o) && o.status !== 'Cobrado' && o.status !== 'Anulado'
    );
});

// Sync state.waiterOrders with my local orders for legacy compatibility
watch([activeLocalOrders, activeGeneralOrders], () => {
    state.waiterOrders = [...activeLocalOrders.value, ...activeGeneralOrders.value];
}, { immediate: true });

function itemCheckedQty(i) {
    return i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0);
}

function orderProgress(o) {
    const total = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const checked = (o.items || []).reduce((s, i) => s + itemCheckedQty(i), 0);
    return total > 0 ? Math.round((checked / total) * 100) : 0;
}

function itemStyle(i) {
    return itemCheckedQty(i) >= (i.qty || 1) ? 'text-gray-400 line-through' : 'text-gray-700';
}

function iconColor(i) {
    return itemCheckedQty(i) >= (i.qty || 1) ? 'text-[var(--system-primary)]' : 'text-orange-400';
}

function displayQty(i) {
    const checkedQty = itemCheckedQty(i);
    const isFully = checkedQty >= (i.qty || 1);
    if ((i.qty || 1) > 1 && checkedQty > 0 && !isFully) return `[${checkedQty}/${i.qty}] `;
    return `${i.qty || 1}x `;
}

function formatTime(o) {
    if (!o.timestamp) return '';
    try {
        return new Date(o.timestamp).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
        return '';
    }
}

function showProof(o) {
    if (window.showImageModal) window.showImageModal(o.proof);
}

function goToMainMenu() {
    if (typeof window.switchView === 'function') {
        window.switchView('client');
    }
}

// Subscriptions
let unsubWaiter = null;
let unsubGeneral = null;

onMounted(() => {
    unsubWaiter = listenToWaiterOrders('waiter', (orders) => {
        rawLocalOrders.value = orders || [];
    });
    unsubGeneral = listenToOrders('waiter', (orders) => {
        rawGeneralOrders.value = orders || [];
    });
});

onUnmounted(() => {
    if (unsubWaiter) unsubWaiter();
    if (unsubGeneral) unsubGeneral();
});
</script>

<template>
    <!-- FILA 1 & 2: Encabezado con Nombre y Botón Historial Hoy -->
    <div class="sticky z-30 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-gray-200/50 transition-all mb-4"
        style="top: calc(4rem + env(safe-area-inset-top, 0px));">
        <div class="flex justify-between items-center max-w-5xl mx-auto">
            <div>
                <h2 class="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-tight">Panel del Mesero</h2>
                <p class="text-xs sm:text-sm text-emerald-600 font-bold flex items-center gap-1.5 mt-0.5">
                    <i class="fas fa-circle text-[7px] animate-pulse"></i>
                    Hola, {{ userName }}
                </p>
            </div>
            <div>
                <button type="button" @click="openWaiterHistory"
                    class="flex items-center gap-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200/90 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold shadow-2xs hover:shadow-xs active:scale-95 transition-all cursor-pointer">
                    <i class="fas fa-history text-blue-500"></i>
                    <span>Historial Hoy</span>
                </button>
            </div>
        </div>
    </div>

    <div class="max-w-5xl mx-auto">
        <!-- Botones de Acción: Nuevo Pedido General y Nuevo Pedido Local en una sola fila -->
        <div class="grid grid-cols-2 gap-2 sm:gap-3" style="margin-bottom: 5px;">
            <!-- 1. Nuevo Pedido General -->
            <button type="button" @click="goToMainMenu"
                class="py-2.5 sm:py-3 px-2 sm:px-4 rounded-xl sm:rounded-2xl text-[11px] min-[380px]:text-xs sm:text-sm font-black text-center transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95 border border-orange-200/90 bg-gradient-to-r from-orange-50 to-amber-50 hover:from-orange-100 hover:to-amber-100 text-orange-950 leading-tight">
                Nuevo Pedido General
            </button>

            <!-- 2. Nuevo Pedido Local -->
            <button type="button" @click="openWaiterModal"
                class="py-2.5 sm:py-3 px-2 sm:px-4 rounded-xl sm:rounded-2xl text-[11px] min-[380px]:text-xs sm:text-sm font-black text-center transition-all cursor-pointer shadow-sm hover:shadow-md active:scale-95 bg-gray-900 hover:bg-black text-white border border-gray-800 leading-tight">
                Nuevo Pedido Local
            </button>
        </div>

        <!-- FILA 3: Pestañas "Pedidos Locales" y "Pedidos Generales" -->
        <div class="flex items-center gap-1.5 p-1 bg-gray-200/80 rounded-2xl mb-2 sm:mb-8 max-w-md mx-auto">
            <button type="button" @click="activeTab = 'locales'"
                class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer"
                :class="activeTab === 'locales' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'">
                <i class="fas fa-utensils text-xs"></i>
                <span>Pedidos Locales</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black transition-colors"
                    :class="activeTab === 'locales' ? 'bg-blue-100 text-blue-800' : 'bg-gray-300 text-gray-700'">
                    {{ activeLocalOrders.length }}
                </span>
            </button>

            <button type="button" @click="activeTab = 'generales'"
                class="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer"
                :class="activeTab === 'generales' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'">
                <i class="fas fa-motorcycle text-xs"></i>
                <span>Pedidos Generales</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black transition-colors"
                    :class="activeTab === 'generales' ? 'bg-orange-100 text-orange-800' : 'bg-gray-300 text-gray-700'">
                    {{ activeGeneralOrders.length }}
                </span>
            </button>
        </div>

        <!-- CONTENIDO: PEDIDOS LOCALES ACTIVOS -->
        <div v-show="activeTab === 'locales'">
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                <div v-for="o in activeLocalOrders" :key="o.id"
                    class="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border shadow-2xs hover:shadow-xs transition-all flex flex-col h-full relative"
                    :class="o._offline ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-200/90'">
                    
                    <div class="mb-2 border-b border-gray-100 pb-1.5">
                        <div class="flex justify-between items-center mb-1">
                            <span class="text-xs sm:text-sm font-black text-gray-500">#{{ o.id }}</span>
                            <div class="flex gap-1.5 items-center">
                                <button type="button" @click.stop="openWaiterNotesModal(o.id)"
                                    class="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors relative bell-ring-container" title="Notas del Pedido">
                                    <div v-if="o.unsolved_notes_count > 0" class="bell-pulse-ring"></div>
                                    <i class="fas fa-bell text-[11px] relative z-10" :class="o.unsolved_notes_count > 0 ? 'animate-jump-spin' : ''"></i>
                                </button>
                                <span class="text-[11px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider" :class="getStatusColor(o.status)">{{ o.status }}</span>
                            </div>
                        </div>
                        <div class="flex justify-between items-center mt-0.5">
                            <div class="text-base sm:text-lg font-black text-gray-900 flex items-center gap-1.5">
                                <i class="fas fa-chair text-blue-600 text-xs sm:text-sm"></i>
                                <span>Mesa {{ o.table || o.tableNum || '?' }}</span>
                            </div>
                            <div class="text-[11px] sm:text-xs text-gray-400 font-medium"><i class="far fa-clock mr-1"></i>{{ formatTime(o) }}</div>
                        </div>
                    </div>

                    <!-- Progreso en cocina -->
                    <div class="mb-2">
                        <div class="flex items-center gap-2 mb-0.5">
                            <div class="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500 ease-out"
                                    :class="orderProgress(o) >= 100 ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-blue-500 to-emerald-500'"
                                    :style="{ width: orderProgress(o) + '%' }"></div>
                            </div>
                            <span class="text-[11px] font-bold text-gray-600 min-w-[32px] text-right">{{ orderProgress(o) }}%</span>
                        </div>
                    </div>

                    <!-- Lista de platos -->
                    <div class="space-y-0.5 mb-2.5 flex-1 overflow-y-auto max-h-[190px]">
                        <div v-for="(i, idx) in o.items" :key="idx" class="flex flex-col text-xs sm:text-[13px] py-0.5 border-b border-gray-50 last:border-0" :class="itemStyle(i)">
                            <div class="flex justify-between items-start">
                                <span>
                                    <i v-if="itemCheckedQty(i) > 0" class="fas fa-check-circle text-xs mr-1" :class="iconColor(i)" :title="itemCheckedQty(i) + '/' + (i.qty || 1) + ' listos'"></i>
                                    {{ displayQty(i) }}{{ i.name }}
                                </span>
                            </div>
                            <span v-if="i.toppings_text" class="text-[10px] text-amber-800 font-semibold pl-2 leading-tight">+ {{ i.toppings_text }}</span>
                            <span v-if="i.notes" class="text-[10px] text-gray-500 italic pl-2 leading-tight"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>{{ i.notes }}</span>
                        </div>
                    </div>

                    <!-- Total y acciones -->
                    <div class="flex items-center justify-between pt-1.5 border-t border-gray-100 mt-auto">
                        <div class="flex flex-col">
                            <div class="flex items-center gap-1.5">
                                <span class="font-black text-gray-900 text-base sm:text-lg">{{ formatMoney(o.total) }}</span>
                                <div v-if="o.payment === 'Transferencia' && o.proof && o.proof !== 'null'"
                                    class="relative group w-7 h-7 rounded-lg border border-gray-200 overflow-hidden cursor-pointer shadow-2xs" title="Ver comprobante" @click="showProof(o)">
                                    <img :src="o.proof" class="w-full h-full object-cover" alt="Comprobante" loading="lazy" />
                                    <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center transition-all">
                                        <i class="fas fa-search-plus text-white text-[10px]"></i>
                                    </div>
                                </div>
                            </div>
                            <button v-if="o.payment === 'Transferencia' && (!o.proof || o.proof === 'null')" type="button"
                                class="mt-0.5 text-[9px] sm:text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md border border-blue-200 hover:bg-blue-100 transition-colors font-semibold"
                                @click="handleWaiterProofUpload(o.id)">
                                <i class="fas fa-upload mr-1"></i> Subir Comprobante
                            </button>
                        </div>
                        <button type="button"
                            class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-all shadow-2xs active:scale-90 cursor-pointer"
                            :data-id="o.id" title="Agregar Plato a la Mesa" @click.stop="openAddItemModal(o.id)">
                            <i class="fas fa-plus text-sm sm:text-base"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div v-show="activeLocalOrders.length === 0" class="flex flex-col items-center justify-center py-16 opacity-60">
                <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                    <i class="fas fa-utensils text-2xl"></i>
                </div>
                <p class="text-gray-600 font-bold text-base">No tienes pedidos locales activos</p>
                <p class="text-gray-400 text-xs mt-0.5">Usa el botón "Nuevo Pedido Local" para iniciar un pedido de mesa.</p>
            </div>
        </div>

        <!-- CONTENIDO: PEDIDOS GENERALES ACTIVOS (Domicilio / Recoger) -->
        <div v-show="activeTab === 'generales'">
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                <div v-for="o in activeGeneralOrders" :key="o.id"
                    class="p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border shadow-2xs hover:shadow-xs transition-all flex flex-col h-full relative"
                    :class="o._offline ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-200/90'">
                    
                    <div class="mb-2 border-b border-gray-100 pb-1.5">
                        <div class="flex justify-between items-center mb-1">
                            <span class="text-xs sm:text-sm font-black text-gray-500">#{{ o.id }}</span>
                            <div class="flex gap-1.5 items-center">
                                <button v-if="o.unsolved_notes_count > 0" type="button" @click.stop="openWaiterNotesModal(o.id)"
                                    class="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors relative bell-ring-container" title="Notas del Pedido">
                                    <div class="bell-pulse-ring"></div>
                                    <i class="fas fa-bell text-[11px] relative z-10 animate-jump-spin"></i>
                                </button>
                                <span class="text-[11px] font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider" :class="getStatusColor(o.status)">{{ o.status }}</span>
                            </div>
                        </div>

                        <div class="flex items-center justify-between mt-0.5">
                            <div class="text-xs sm:text-sm font-extrabold text-gray-900 truncate max-w-[70%]">
                                {{ o.client || 'Cliente General' }}
                            </div>
                            <span class="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-md"
                                :class="o.type === 'Domicilio' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'">
                                <i :class="o.type === 'Domicilio' ? 'fas fa-motorcycle' : 'fas fa-shopping-bag'"></i>
                                {{ o.type }}
                            </span>
                        </div>

                        <!-- Zona de reparto / Dirección -->
                        <div v-if="o.delivery_zone" class="inline-flex items-center gap-1 text-[10px] text-orange-800 font-bold bg-orange-50 px-1.5 py-0.5 rounded mt-0.5">
                            <i class="fas fa-map-marker-alt text-orange-600"></i>
                            <span>{{ o.delivery_zone }}</span>
                        </div>
                        <p v-if="o.address && o.address !== 'N/A'" class="text-[10px] sm:text-[11px] text-gray-500 mt-0.5 truncate">
                            <i class="fas fa-location-arrow text-[9px] mr-1 text-gray-400"></i>{{ o.address }}
                        </p>
                        <a v-if="o.phone && o.phone.length >= 7" :href="'https://wa.me/+57' + o.phone" target="_blank"
                            class="text-[10px] sm:text-[11px] text-green-600 hover:text-green-700 font-bold inline-flex items-center gap-1 mt-0.5">
                            <i class="fab fa-whatsapp"></i> {{ o.phone }}
                        </a>
                    </div>

                    <!-- Progreso en cocina -->
                    <div class="mb-2">
                        <div class="flex items-center gap-2 mb-0.5">
                            <div class="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div class="h-full rounded-full transition-all duration-500 ease-out"
                                    :class="orderProgress(o) >= 100 ? 'bg-gradient-to-r from-emerald-500 to-green-500' : 'bg-gradient-to-r from-orange-500 to-amber-500'"
                                    :style="{ width: orderProgress(o) + '%' }"></div>
                            </div>
                            <span class="text-[11px] font-bold text-gray-600 min-w-[32px] text-right">{{ orderProgress(o) }}%</span>
                        </div>
                    </div>

                    <!-- Lista de platos -->
                    <div class="space-y-0.5 mb-2.5 flex-1 overflow-y-auto max-h-[190px]">
                        <div v-for="(i, idx) in o.items" :key="idx" class="flex flex-col text-xs sm:text-[13px] py-0.5 border-b border-gray-50 last:border-0" :class="itemStyle(i)">
                            <div class="flex justify-between items-start">
                                <span>
                                    <i v-if="itemCheckedQty(i) > 0" class="fas fa-check-circle text-xs mr-1 text-orange-500" :title="itemCheckedQty(i) + '/' + (i.qty || 1) + ' listos'"></i>
                                    {{ displayQty(i) }}{{ i.name }}
                                </span>
                            </div>
                            <span v-if="i.toppings_text" class="text-[10px] text-amber-800 font-semibold pl-2 leading-tight">+ {{ i.toppings_text }}</span>
                            <span v-if="i.notes" class="text-[10px] text-gray-500 italic pl-2 leading-tight"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>{{ i.notes }}</span>
                        </div>
                    </div>

                    <!-- Total y método de pago -->
                    <div class="flex items-center justify-between pt-1.5 border-t border-gray-100 mt-auto">
                        <div class="flex flex-col">
                            <div class="flex items-center gap-1.5">
                                <span class="font-black text-gray-900 text-base sm:text-lg">{{ formatMoney(o.total) }}</span>
                                <div v-if="o.payment === 'Transferencia' && o.proof && o.proof !== 'null'"
                                    class="relative group w-7 h-7 rounded-lg border border-gray-200 overflow-hidden cursor-pointer shadow-2xs" title="Ver comprobante" @click="showProof(o)">
                                    <img :src="o.proof" class="w-full h-full object-cover" alt="Comprobante" loading="lazy" />
                                    <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center transition-all">
                                        <i class="fas fa-search-plus text-white text-[10px]"></i>
                                    </div>
                                </div>
                            </div>
                            <span class="text-[10px] text-gray-500 font-medium">Pago: {{ o.payment || 'Efectivo' }}</span>
                        </div>
                        <div class="text-right text-[11px] sm:text-xs text-gray-400">
                            <i class="far fa-clock mr-1"></i>{{ formatTime(o) }}
                        </div>
                    </div>
                </div>
            </div>

            <div v-show="activeGeneralOrders.length === 0" class="flex flex-col items-center justify-center py-16 opacity-60">
                <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
                    <i class="fas fa-receipt text-2xl"></i>
                </div>
                <p class="text-gray-600 font-bold text-base">No tienes pedidos generales activos</p>
                <p class="text-gray-400 text-xs mt-0.5">Usa el botón "Nuevo Pedido General" para ir al menú principal y pedir.</p>
            </div>
        </div>
    </div>
</template>
