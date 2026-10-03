<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { listenToOrders, listenToWaiterOrders, updateOrder, updateWaiterOrder, toggleOrderItem } from '@/legacy/services/order-service.js';
import { initSlideButtons } from '@/legacy/utils/helpers.js';
import { toast, showModalAlert } from '@/legacy/components/ui.js';

const generalOrders = ref([]);
const waiterOrders = ref([]);

const userName = computed(() => state.user?.name || 'Chef');

const visibleGeneral = computed(() =>
    generalOrders.value
        .filter(o => o.status !== 'Pendiente')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
);

function range(n) { return Array.from({ length: n || 0 }, (_, i) => i); }
function itemCheckedQty(i) { return i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0); }
function toppingsText(i) {
    if (Array.isArray(i.toppings) && i.toppings.length > 0) {
        return i.toppings.map(t => t.name || t).filter(Boolean).join(', ');
    }
    if (i.toppings_text) {
        return i.toppings_text.replace(/\s*\(\s*\+?\s*\$?[0-9.,]+\s*\)/gi, '').trim();
    }
    return '';
}
function itemNotes(i) { return i.notes || i.note || ''; }
function orderProgress(o) {
    const total = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const checked = (o.items || []).reduce((s, i) => s + itemCheckedQty(i), 0);
    return total > 0 ? Math.round((checked / total) * 100) : 0;
}
function isPreparing(o) { return o.status === 'En preparación'; }
function statusBadgeClass(o) { return o.status === 'Recibido' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'; }
function sliderClass(o) { return isPreparing(o) ? 'bg-blue-600' : 'bg-orange-500'; }
function sliderThumbClass(o) { return isPreparing(o) ? 'border-blue-600' : 'border-orange-500'; }
function sliderIconClass(o) { return isPreparing(o) ? 'text-blue-600' : 'text-orange-500'; }
function sliderText(o) { return isPreparing(o) ? 'Terminar' : 'Cocinar'; }
function sliderIcon(o) { return isPreparing(o) ? 'fa-check' : 'fa-fire'; }
function nextStatus(o) { return isPreparing(o) ? 'Terminado' : 'En preparación'; }
function displayTime(o) {
    return o.displayDate ? (o.displayDate.split(',')[1] || o.displayDate) : new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }).split(',')[1];
}

function openArchived() {
    if (typeof window.openArchived === 'function') window.openArchived();
}

function isItemComplete(i) {
    const targetQty = i.qty || 1;
    const curQty = i.checkedQty !== undefined ? i.checkedQty : (i.checked ? targetQty : 0);
    return curQty >= targetQty;
}

function isOrderComplete(order) {
    if (!order || !order.items || order.items.length === 0) return true;
    return order.items.every(i => isItemComplete(i));
}

async function toggleBox(o, item, itemIndex, j) {
    if (o.status !== 'En preparación') {
        toast("El pedido debe estar en 'En preparación' para poder marcar platos.", "error");
        return;
    }
    const cur = itemCheckedQty(item);
    const newQty = (j < cur) ? j : j + 1;
    item.checkedQty = newQty;
    item.checked = newQty >= (item.qty || 1);
    try {
        await toggleOrderItem(o.id, itemIndex, undefined, newQty);
    } catch (err) {
        item.checkedQty = cur;
        item.checked = cur >= (item.qty || 1);
        toast("Error al actualizar plato", "error");
    }
}

// Override the legacy globals so the drag-slider callbacks validate against
// the reactive (Vue-owned) order state instead of the legacy caches.
async function handleUpdateChefStatus(id, status) {
    if (status === 'Terminado') {
        const order = visibleGeneral.value.find(o => o.id == id);
        if (order && !isOrderComplete(order)) {
            toast("Todos los platos deben estar preparados para terminar el pedido.", "error");
            return;
        }
    }
    // Optimistic immediate update so the chef sees the change instantly
    const prevOrders = [...generalOrders.value];
    const targetOrder = prevOrders.find(o => o.id == id);
    if (status === 'Terminado') {
        generalOrders.value = generalOrders.value.filter(o => o.id != id);
    } else if (targetOrder) {
        targetOrder.status = status;
    }

    try {
        await updateOrder(id, {
            status,
            ...((status === 'Terminado' || status === 'En preparación') ? { chefName: state.user?.name || 'Chef' } : {})
        });
        toast(status === 'Terminado' ? "Pedido terminado y archivado" : `Estado actualizado: ${status}`, status === 'Terminado' ? 'success' : 'info');
    } catch (e) {
        console.error(e);
        generalOrders.value = prevOrders; // Rollback
        showModalAlert("Error", "Error actualizando pedido", "error");
    }
}

async function handleUpdateWaiterOrderStatus(orderId, newStatus) {
    if (newStatus === 'Terminado') {
        const order = waiterOrders.value.find(o => o.id == orderId);
        if (order && !isOrderComplete(order)) {
            toast("Todos los platos deben estar preparados para terminar el pedido.", "error");
            return;
        }
    }
    // Optimistic immediate update so the chef sees the change instantly
    const prevOrders = [...waiterOrders.value];
    const targetOrder = prevOrders.find(o => o.id == orderId);
    if (newStatus === 'Terminado') {
        waiterOrders.value = waiterOrders.value.filter(o => o.id != orderId);
    } else if (targetOrder) {
        targetOrder.status = newStatus;
    }

    try {
        await updateWaiterOrder(orderId, {
            status: newStatus,
            ...((newStatus === 'Terminado' || newStatus === 'En preparación') ? { chefName: state.user?.name || 'Chef' } : {})
        });
        toast(`Pedido actualizado a ${newStatus}`, "success");
    } catch (e) {
        console.error(e);
        waiterOrders.value = prevOrders; // Rollback
        toast("Error actualizando pedido", "error");
    }
}
window.updateChefStatus = handleUpdateChefStatus;
window.updateWaiterOrderStatus = handleUpdateWaiterOrderStatus;

let unsubOrders = null;
let unsubWaiter = null;
onMounted(() => {
    unsubOrders = listenToOrders('chef', (list) => { generalOrders.value = list; });
    unsubWaiter = listenToWaiterOrders('chef', (list) => { waiterOrders.value = list; });
});
onUnmounted(() => {
    if (unsubOrders) unsubOrders();
    if (unsubWaiter) unsubWaiter();
});

watch([generalOrders, waiterOrders], async () => {
    await nextTick();
    initSlideButtons();
});
</script>

<template>
    <div class="flex justify-between items-center mb-6 sticky z-30 bg-gray-50/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-gray-200/50 transition-all"
        style="top: calc(4rem + env(safe-area-inset-top, 0px));">
        <div>
            <h2 class="text-2xl font-bold text-gray-800 tracking-tight">Cocina en Vivo</h2>
            <p class="text-xs text-green-600 font-bold"><i class="fas fa-bolt"></i> Conexión Activa<span>- {{ userName }}</span></p>
        </div>
        <div class="flex gap-2">
            <button type="button" @click="openArchived"
                class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                <i class="fas fa-archive mr-1"></i> Archivados
            </button>
        </div>
    </div>

    <!-- Waiter Orders Section -->
    <div id="chef-waiter-orders-container" class="mb-8">
        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <i class="fas fa-user-tie mr-2 text-blue-600"></i> Pedidos Locales
        </h3>
        <div v-if="waiterOrders.length === 0" class="col-span-full flex flex-col w-full items-center justify-center py-20 opacity-50">
            <i class="fas fa-check-circle text-6xl text-gray-300 mb-4"></i>
            <p class="text-gray-400 font-medium">Todo limpio, Chef.</p>
        </div>
        <div v-else
            class="grid grid-rows-2 grid-flow-col auto-cols-[85vw] overflow-x-auto overflow-y-hidden pb-4 sm:auto-cols-auto sm:grid-rows-none sm:grid-flow-row sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 snap-x snap-mandatory sm:snap-none">
            <div v-for="o in waiterOrders" :key="o.id"
                class="bg-white rounded-xl shadow-sm p-0 overflow-hidden border border-gray-200 flex flex-col h-full relative border-l-4 border-l-blue-500">
                <div class="p-2 bg-gray-50 border-b border-gray-100 flex justify-between items-start animate-pulse-fade">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800 leading-tight">#{{ o.id }}</h3>
                        <p class="text-sm text-gray-500 font-medium leading-tight mt-1">Mesa {{ o.table }} - {{ o.waiterName }}</p>
                    </div>
                    <div class="text-right flex flex-col items-end">
                        <div class="flex items-center gap-1 mb-1">
                            <button v-if="o.unsolved_notes_count > 0" type="button" @click="window.openViewNotesModal(o.id)"
                                class="relative group p-1 rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                                <div class="bell-pulse-ring"></div>
                                <i class="fas fa-bell animate-jump-spin relative z-10"></i>
                            </button>
                            <span class="inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wider" :class="statusBadgeClass(o)">{{ o.status }}</span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1 leading-tight"><i class="far fa-clock"></i> {{ displayTime(o) }}</p>
                    </div>
                </div>

                <div class="px-2 py-1">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-300" :style="{ width: orderProgress(o) + '%' }"></div>
                        </div>
                        <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">{{ orderProgress(o) }}%</span>
                    </div>
                </div>

                <div class="p-2 flex-1 overflow-y-auto max-h-[250px]">
                    <div v-for="(item, itemIndex) in o.items" :key="itemIndex" class="flex flex-col py-1.5 border-b border-gray-50 last:border-0 pl-1 pr-1">
                        <div class="flex justify-between items-start w-full gap-2">
                            <label class="flex-1 cursor-pointer select-none mt-0.5">
                                <span class="text-sm font-bold" :class="itemCheckedQty(item) >= item.qty ? 'line-through text-gray-400' : 'text-gray-800'">{{ item.qty }}x {{ item.name }}</span>
                                <div v-if="toppingsText(item)" class="mt-1 flex flex-wrap gap-1">
                                    <span class="inline-flex items-center text-[11px] font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80">
                                        <i class="fas fa-cookie-bite mr-1 text-[9px] text-amber-600"></i>{{ toppingsText(item) }}
                                    </span>
                                </div>
                                <div v-if="itemNotes(item)" class="mt-1 flex flex-wrap gap-1">
                                    <span class="inline-flex items-center text-[11px] font-medium text-orange-800 bg-orange-50 px-2 py-0.5 rounded border border-orange-200/70 italic">
                                        <i class="fas fa-comment-alt mr-1 text-[9px] text-orange-500"></i>{{ itemNotes(item) }}
                                    </span>
                                </div>
                            </label>
                            <div class="flex gap-1.5 flex-wrap justify-end max-w-[50%] items-center chef-check-group pt-0.5">
                                <button v-for="j in range(item.qty)" :key="j" type="button"
                                    class="w-6 h-6 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-90"
                                    :class="j < itemCheckedQty(item) ? 'bg-orange-500 border-orange-500 text-white shadow-xs' : 'border-gray-300 bg-white hover:border-orange-400 text-transparent'"
                                    :title="j < itemCheckedQty(item) ? 'Completado (clic para desmarcar)' : 'Pendiente (clic para marcar)'"
                                    @click="toggleBox(o, item, itemIndex, j)">
                                    <i class="fas fa-check text-[10px] leading-none" :class="{ 'opacity-0': j >= itemCheckedQty(item) }"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div v-if="o.notes" class="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-gray-600 italic"><i class="fas fa-sticky-note mr-1 text-yellow-500"></i> {{ o.notes }}</div>
                </div>

                <div class="p-2 bg-gray-50 border-t border-gray-100">
                    <div class="slider-container h-8" :class="sliderClass(o)" :key="'waiter-slider-' + o.id + '-' + o.status"
                        :id="'slider-' + o.id" :data-id="o.id" :data-action="nextStatus(o)" data-callback="updateWaiterOrderStatus">
                        <div class="slider-text text-xs text-white font-bold uppercase tracking-wider">{{ sliderText(o) }} <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                        <div class="slider-thumb w-8 h-8" :class="sliderThumbClass(o)">
                            <i class="fas text-xs" :class="sliderIcon(o) + ' ' + sliderIconClass(o)"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- General Orders Section -->
    <div id="chef-general-orders-container" class="mb-8">
        <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <i class="fas fa-motorcycle mr-2 text-orange-600"></i> Pedidos Generales
        </h3>
        <div class="grid grid-rows-2 grid-flow-col auto-cols-[85vw] overflow-x-auto overflow-y-hidden pb-8 sm:auto-cols-auto sm:grid-rows-none sm:grid-flow-row sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 snap-x snap-mandatory sm:snap-none">
            <div v-for="o in visibleGeneral" :key="o.id"
                class="bg-white rounded-xl shadow-sm p-0 overflow-hidden border border-gray-200 flex flex-col h-full relative">
                <div class="p-2 bg-gray-50 border-b border-gray-100 flex justify-between items-start animate-pulse-fade">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800 leading-tight">#{{ o.id }}</h3>
                        <p class="text-xs text-gray-500 font-medium leading-tight mt-1">{{ o.client }}</p>
                    </div>
                    <div class="text-right flex flex-col items-end">
                        <div class="flex items-center gap-1 mb-1">
                            <button v-if="o.unsolved_notes_count > 0" type="button" @click="window.openViewNotesModal(o.id)"
                                class="relative group p-1 rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                                <div class="bell-pulse-ring"></div>
                                <i class="fas fa-bell animate-jump-spin relative z-10"></i>
                            </button>
                            <span class="inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wider" :class="statusBadgeClass(o)">{{ o.status }}</span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1 leading-tight"><i class="far fa-clock"></i> {{ displayTime(o) }}</p>
                    </div>
                </div>

                <div class="px-2 py-1">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-orange-400 to-orange-600 h-full transition-all duration-300" :style="{ width: orderProgress(o) + '%' }"></div>
                        </div>
                        <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">{{ orderProgress(o) }}%</span>
                    </div>
                </div>

                <div class="p-2 flex-1 overflow-y-auto max-h-[250px]">
                    <div v-for="(item, itemIndex) in o.items" :key="itemIndex" class="flex flex-col py-1.5 border-b border-gray-50 last:border-0 pl-1 pr-1">
                        <div class="flex justify-between items-start w-full gap-2">
                            <label class="flex-1 cursor-pointer select-none mt-0.5">
                                <span class="text-sm font-bold" :class="itemCheckedQty(item) >= item.qty ? 'line-through text-gray-400' : 'text-gray-800'">{{ item.qty }}x {{ item.name }}</span>
                                <div v-if="toppingsText(item)" class="mt-1 flex flex-wrap gap-1">
                                    <span class="inline-flex items-center text-[11px] font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80">
                                        <i class="fas fa-cookie-bite mr-1 text-[9px] text-amber-600"></i>{{ toppingsText(item) }}
                                    </span>
                                </div>
                                <div v-if="itemNotes(item)" class="mt-1 flex flex-wrap gap-1">
                                    <span class="inline-flex items-center text-[11px] font-medium text-orange-800 bg-orange-50 px-2 py-0.5 rounded border border-orange-200/70 italic">
                                        <i class="fas fa-comment-alt mr-1 text-[9px] text-orange-500"></i>{{ itemNotes(item) }}
                                    </span>
                                </div>
                            </label>
                            <div class="flex gap-1.5 flex-wrap justify-end max-w-[50%] items-center chef-check-group pt-0.5">
                                <button v-for="j in range(item.qty)" :key="j" type="button"
                                    class="w-6 h-6 rounded-full border flex items-center justify-center transition-all cursor-pointer shadow-2xs active:scale-90"
                                    :class="j < itemCheckedQty(item) ? 'bg-orange-500 border-orange-500 text-white shadow-xs' : 'border-gray-300 bg-white hover:border-orange-400 text-transparent'"
                                    :title="j < itemCheckedQty(item) ? 'Completado (clic para desmarcar)' : 'Pendiente (clic para marcar)'"
                                    @click="toggleBox(o, item, itemIndex, j)">
                                    <i class="fas fa-check text-[10px] leading-none" :class="{ 'opacity-0': j >= itemCheckedQty(item) }"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div v-if="o.notes" class="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-gray-600 italic"><i class="fas fa-sticky-note mr-1 text-yellow-500"></i> {{ o.notes }}</div>
                </div>

                <div class="p-2 bg-gray-50 border-t border-gray-100">
                    <div class="slider-container h-8" :class="sliderClass(o)" :key="'general-slider-' + o.id + '-' + o.status"
                        :id="'slider-' + o.id" :data-id="o.id" :data-action="nextStatus(o)" data-callback="updateChefStatus">
                        <div class="slider-text text-xs text-white font-bold uppercase tracking-wider">{{ sliderText(o) }} <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                        <div class="slider-thumb w-8 h-8" :class="sliderThumbClass(o)">
                            <i class="fas text-xs" :class="sliderIcon(o) + ' ' + sliderIconClass(o)"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div v-show="visibleGeneral.length === 0" class="flex flex-col items-center justify-center py-20 opacity-50">
        <i class="fas fa-check-circle text-6xl text-gray-300 mb-4"></i>
        <p class="text-gray-400 font-medium">Todo limpio, Chef.</p>
    </div>

    <div class="flex justify-center py-6 mt-8 border-t border-gray-100">
        <a href="https://www.digidan.co" target="_blank" rel="noopener noreferrer"
            class="opacity-60 hover:opacity-100 transition-opacity">
            <img src="/img/ceo.webp" alt="Powered by Digidan.co" style="width: 100px; height: auto;">
        </a>
    </div>
</template>
