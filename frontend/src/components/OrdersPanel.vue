<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { printOrder } from '@/legacy/services/print-service.js';
import { removeOfflineOrder, listenToOrders, listenToWaiterOrders } from '@/legacy/services/order-service.js';
import { OfflineDB } from '@/legacy/services/offline-db.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const searchTerm = ref('');
const activeTab = ref('general');
const generalPage = ref(1);
const waiterPage = ref(1);
const PER_PAGE = 15;

let unsubGeneral = null;
let unsubWaiter = null;

onMounted(() => {
    unsubGeneral = listenToOrders('admin', (orders) => {
        state.orders = orders;
    });
    unsubWaiter = listenToWaiterOrders('admin', (orders) => {
        state.waiterOrders = orders;
    });
});

onUnmounted(() => {
    if (unsubGeneral) unsubGeneral();
    if (unsubWaiter) unsubWaiter();
});

const generalOrders = computed(() => (state.orders || []).filter(o => String(o.type || '').toLowerCase() !== 'local'));
const waiterOrders = computed(() => (state.waiterOrders || []).filter(o => String(o.type || '').toLowerCase() === 'local'));

function statusBadgeClass(status) {
    if (status === 'Pendiente') return 'bg-white text-gray-600 border border-gray-200';
    if (status === 'Recibido') return 'bg-yellow-100 text-yellow-700';
    if (status === 'En preparación') return 'bg-orange-100 text-orange-700';
    if (status === 'Terminado') return 'bg-green-100 text-green-700';
    if (status === 'En Reparto') return 'bg-blue-100 text-blue-700';
    if (status === 'Entregado') return 'bg-green-200 text-green-800';
    if (status === 'Cobrado') return 'bg-teal-100 text-teal-700';
    if (status === 'Anulado') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
}

function priorityScore(status) {
    const map = {
        'Pendiente': 1, 'Recibido': 2, 'En preparación': 3, 'Terminado': 4,
        'En Reparto': 5, 'Entregado': 6, 'Cobrado': 7, 'Anulado': 8
    };
    return map[status] || 99;
}

function sortOrders(list) {
    return [...list].sort((a, b) => {
        const sa = priorityScore(a.status);
        const sb = priorityScore(b.status);
        if (sa !== sb) return sa - sb;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
}

function matchesSearch(o) {
    const s = searchTerm.value.toLowerCase().trim();
    if (!s) return true;
    return String(o.id).toLowerCase().includes(s) || (o.client || '').toLowerCase().includes(s);
}

const sortedGeneral = computed(() => sortOrders(generalOrders.value.filter(matchesSearch)));
const sortedWaiter = computed(() => sortOrders(waiterOrders.value.filter(matchesSearch)));

const generalPageItems = computed(() => {
    const start = (generalPage.value - 1) * PER_PAGE;
    return sortedGeneral.value.slice(start, start + PER_PAGE);
});
const waiterPageItems = computed(() => {
    const start = (waiterPage.value - 1) * PER_PAGE;
    return sortedWaiter.value.slice(start, start + PER_PAGE);
});

const generalTotalPages = computed(() => Math.ceil(sortedGeneral.value.length / PER_PAGE) || 1);
const waiterTotalPages = computed(() => Math.ceil(sortedWaiter.value.length / PER_PAGE) || 1);

function fmtDate(o) {
    return new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function hasTip(o) { return parseFloat(o.tip) > 0; }
function hasDiscount(o) { return parseFloat(o.discount) > 0; }
function hasProof(o) { return o.proof && o.payment !== 'Efectivo'; }

function openWhatsApp(id) { if (window.openWhatsApp) window.openWhatsApp(id); }
function openNotes(id) { if (window.openViewNotesModal) window.openViewNotesModal(id); }
function showDetails(id) { if (window.showOrderDetails) window.showOrderDetails(id); }
function viewProof(src) { if (window.showImageModal) window.showImageModal(src); }
function print(o, isWaiter) { printOrder(isWaiter ? { ...o, isWaiterOrder: true } : o); }
function cobrar(o) {
    if (window.openPaymentModal) {
        window.openPaymentModal(o, () => {
            if (window.reloadAdminData) window.reloadAdminData();
        });
    }
}
function editOrder(id, isWaiter) { if (window.openOrderEditModal) window.openOrderEditModal(id, isWaiter); }
function editOffline(id) { if (window.openOfflineOrderEditModal) window.openOfflineOrderEditModal(id); }
function deleteOrder(id) { if (window.promptCancelOrder) window.promptCancelOrder(id); }
function newGeneralOrder() { window.switchView('client'); }
function newLocalOrder() { if (window.openWaiterModal) window.openWaiterModal(); }

function cancelOffline(id) {
    showConfirmModal(
        'Cancelar Pedido Local',
        '¿Estás seguro de cancelar este pedido local? No se enviará al servidor cuando recuperes la conexión.',
        async () => {
            try {
                await removeOfflineOrder(id);
                const queue = await OfflineDB.getQueue();
                const matching = queue.filter(req =>
                    req.url === '/orders' && req.method === 'POST' && req._offlineId === id
                );
                for (const entry of matching) {
                    await OfflineDB.removeFromQueue(entry.id);
                }
                toast('Pedido local cancelado', 'success');
                if (window.reloadAdminData) window.reloadAdminData();
            } catch (e) {
                console.error('Error cancelando pedido local:', e);
                toast('Error al cancelar', 'error');
            }
        },
        null,
        'Sí, cancelar'
    );
}
</script>

<template>
    <div class="flex gap-1 bg-white p-1 wrap w-[100%] rounded-2xl shadow-sm border border-gray-100">
        <button class="tab-order-btn px-5 py-2.5 text-sm font-bold rounded-xl w-[100%] transition-all"
            :class="activeTab === 'general' ? 'active' : ''" data-tab="general" @click="activeTab = 'general'; generalPage = 1">
            <i class="fa-solid fa-clipboard-list mr-2"></i>Pedidos Generales
        </button>
        <button class="tab-order-btn w-[100%] px-5 py-2.5 text-sm font-bold rounded-xl transition-all"
            :class="activeTab === 'local' ? 'active' : ''" data-tab="local" @click="activeTab = 'local'; waiterPage = 1">
            <i class="fas fa-user-tie mr-2"></i>Pedidos Locales
        </button>
    </div>

    <div class="relative">
        <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input v-model="searchTerm" type="text" placeholder="Buscar por ID o nombre del cliente..."
            class="w-full pl-10 pr-4 py-3 rounded-2xl border border-gray-200 bg-white shadow-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none text-sm transition-all">
    </div>

    <!-- General Orders -->
    <div v-show="activeTab === 'general'">
        <div class="flex justify-between items-center mb-3">
            <h3 class="font-bold text-gray-700 text-lg">
                <i class="fa-solid fa-clipboard-list mr-2 text-blue-600"></i>Pedidos Generales
            </h3>
            <button type="button" @click="newGeneralOrder"
                class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                <i class="fas fa-plus"></i> Nuevo Pedido
            </button>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
            <table class="w-full text-left border-collapse">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                    <tr class="text-center">
                        <th class="p-4 font-bold text-center">Pedido</th>
                        <th class="p-4 font-bold text-center">Cliente</th>
                        <th class="p-4 font-bold text-center">Chef / Delivery</th>
                        <th class="p-4 font-bold text-center">Propinas / Dtos</th>
                        <th class="p-4 font-bold text-center">Total</th>
                        <th class="p-4 font-bold text-center">Comprobante</th>
                        <th class="p-4 font-bold text-center">Estado</th>
                        <th class="p-4 font-bold text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody class="text-sm divide-y divide-gray-50">
                    <tr v-if="sortedGeneral.length === 0">
                        <td colspan="8" class="text-center py-4 text-gray-400 text-[14px]">No hay pedidos recientes generales.</td>
                    </tr>
                    <tr v-for="o in generalPageItems" :key="o.id"
                        class="hover:bg-gray-50 transition-colors border-b border-gray-50"
                        :class="o._offline ? 'bg-amber-50/40' : ''">
                        <td class="p-2 text-center align-middle max-w-[90px] w-[90px] min-w-[70px]">
                            <div class="font-bold text-gray-800 text-[11px] md:text-sm text-center whitespace-nowrap overflow-hidden text-ellipsis" :title="'#' + o.id">
                                <i v-if="o._offline" class="fas fa-cloud-upload-alt text-amber-500 mr-1 text-[10px]" title="Pendiente de sincronizar"></i>#{{ o.id }}
                            </div>
                            <div class="text-[10px] md:text-xs text-gray-500 font-medium text-center mt-0.5 whitespace-nowrap">{{ fmtDate(o) }}</div>
                        </td>
                        <td class="p-2 text-center align-middle max-w-[100px] min-w-[70px]">
                            <div class="font-medium text-gray-700 text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" :title="o.client">{{ o.client }}</div>
                            <div class="text-[10px] md:text-xs text-gray-500 whitespace-nowrap">{{ o.type }}</div>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div class="text-xs text-orange-600 font-medium"><i v-if="o.chefName" class="fas fa-fire-alt mr-1"></i>{{ o.chefName || '' }}<span v-if="!o.chefName" class="text-gray-300">-</span></div>
                            <div class="text-xs text-blue-600 font-medium"><i v-if="o.deliveryDriverName" class="fas fa-motorcycle mr-1"></i>{{ o.deliveryDriverName || '' }}</div>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div v-if="hasTip(o)" class="text-xs text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+{{ formatMoney(o.tip) }}</div>
                            <div v-if="hasDiscount(o)" class="text-xs text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-{{ formatMoney(o.discount) }}</div>
                            <span v-if="!hasTip(o) && !hasDiscount(o)" class="text-gray-300 text-xs">-</span>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div class="font-bold text-gray-800 text-sm">{{ formatMoney(o.total) }}</div>
                            <div class="text-xs text-gray-500">{{ o.payment }}</div>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <img v-if="hasProof(o)" :src="o.proof" alt="Comprobante pequeño" loading="lazy"
                                class="w-8 h-8 object-cover rounded-lg cursor-pointer hover:scale-110 transition-transform shadow-sm border border-gray-200 mx-auto"
                                @click="viewProof(o.proof)" title="Ver Comprobante">
                            <span v-else class="text-xs text-gray-300">N/A</span>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div class="flex items-center justify-center gap-1">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" :class="statusBadgeClass(o.status)">{{ o.status }}</span>
                                <button v-if="o.phone && !o._offline" type="button" @click="openWhatsApp(o.id)"
                                    class="text-green-500 hover:text-green-700 p-1 rounded-full hover:bg-green-50 transition-colors" title="Enviar WhatsApp">
                                    <i class="fab fa-whatsapp text-[14px]"></i>
                                </button>
                            </div>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div class="flex items-center justify-center gap-1.5">
                                <button v-if="o.unsolved_notes_count > 0 && !o._offline" type="button" @click="openNotes(o.id)"
                                    class="relative group p-1.5 rounded-full hover:bg-orange-50 transition-colors text-orange-500" title="Ver Notas">
                                    <i class="fas fa-bell animate-jump-spin text-sm"></i>
                                    <span class="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                                </button>
                                <div class="relative inline-block text-left table-action-container">
                                    <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                                        <i class="fas fa-ellipsis-v text-xs"></i>
                                    </button>
                                    <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                        <button v-if="o.status !== 'Cobrado' && o.status !== 'Anulado'" type="button" @click="cobrar(o)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-teal-600 hover:bg-teal-50 transition-colors font-bold"><i class="fas fa-cash-register w-4 text-center"></i> <span>Cobrar Pedido</span></button>
                                        <button type="button" @click="showDetails(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalles</span></button>
                                        <button type="button" @click="print(o, false)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors"><i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span></button>
                                        <template v-if="o._offline">
                                            <button type="button" @click="editOffline(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span></button>
                                            <button type="button" @click="cancelOffline(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Cancelar Pedido</span></button>
                                        </template>
                                        <template v-else>
                                            <button type="button" @click="editOrder(o.id, false)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span></button>
                                            <button type="button" @click="deleteOrder(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Pedido</span></button>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="flex justify-between items-center mt-4 pt-2 border-t border-gray-100">
            <button type="button" @click="generalPage = Math.max(1, generalPage - 1)" :disabled="generalPage === 1"
                class="text-gray-500 hover:text-orange-500 disabled:opacity-50 text-xs"><i class="fas fa-chevron-left"></i> Anterior</button>
            <span class="text-xs text-gray-400">Página {{ generalPage }} de {{ generalTotalPages }}</span>
            <button type="button" @click="generalPage = Math.min(generalTotalPages, generalPage + 1)" :disabled="generalPage >= generalTotalPages"
                class="text-gray-500 hover:text-orange-500 disabled:opacity-50 text-xs">Siguiente <i class="fas fa-chevron-right"></i></button>
        </div>
    </div>

    <!-- Local Orders -->
    <div v-show="activeTab === 'local'">
        <div class="flex justify-between items-center mb-3">
            <h3 class="font-bold text-gray-700 text-lg">
                <i class="fas fa-user-tie mr-2 text-blue-600"></i>Pedidos Locales
            </h3>
            <button type="button" @click="newLocalOrder"
                class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                <i class="fas fa-plus"></i> Nuevo Pedido
            </button>
        </div>
        <div class="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                        <tr class="text-center">
                            <th class="p-4 font-bold uppercase text-center">ID</th>
                            <th class="p-4 font-bold uppercase text-center">Mesa</th>
                            <th class="p-4 font-bold uppercase text-center">Mesero</th>
                            <th class="p-4 font-bold uppercase text-center">Propinas / Dtos</th>
                            <th class="p-4 font-bold uppercase text-center">Total</th>
                            <th class="p-4 font-bold uppercase text-center">Comprobante</th>
                            <th class="p-4 font-bold uppercase text-center">Estado</th>
                            <th class="p-4 font-bold uppercase text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        <tr v-if="sortedWaiter.length === 0">
                            <td colspan="8" class="text-center py-4 text-gray-400 text-[14px]">No hay pedidos de meseros activos.</td>
                        </tr>
                        <tr v-for="o in waiterPageItems" :key="o.id"
                            class="hover:bg-gray-50 transition-colors" :class="o._offline ? 'bg-yellow-50' : ''">
                            <td class="p-2 text-center align-middle max-w-[90px] w-[90px] min-w-[70px]">
                                <div class="font-bold text-gray-700 text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" :title="'#' + o.id">#{{ o.id }}</div>
                                <div class="text-[10px] md:text-xs text-gray-500 mt-0.5 whitespace-nowrap">{{ fmtDate(o) }}</div>
                            </td>
                            <td class="p-2 text-center align-middle max-w-[100px] min-w-[70px]">
                                <div class="text-gray-900 font-bold text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" :title="'Mesa ' + (o.tableNum || o.table || '-')">Mesa {{ o.tableNum || o.table || '-' }}</div>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <div class="text-gray-900 text-sm font-bold flex items-center justify-center gap-1.5">
                                    <i class="fas fa-user-tie text-[var(--system-primary)]"></i>
                                    <span>{{ o.waiterName || 'Mesero' }}</span>
                                </div>
                                <div v-if="o.chefName" class="text-xs text-orange-600 font-medium mt-0.5"><i class="fas fa-fire-alt mr-1"></i>{{ o.chefName }}</div>
                                <div v-if="o.client && o.client !== 'Cliente Final' && o.client !== 'Cliente'" class="text-[10px] text-gray-400 mt-0.5">{{ o.client }}</div>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <div v-if="hasTip(o)" class="text-xs text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+{{ formatMoney(o.tip) }}</div>
                                <div v-if="hasDiscount(o)" class="text-xs text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-{{ formatMoney(o.discount) }}</div>
                                <span v-if="!hasTip(o) && !hasDiscount(o)" class="text-gray-300 text-xs">-</span>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <div class="font-bold text-gray-900 text-sm">{{ formatMoney(o.total) }}</div>
                                <div class="text-xs text-gray-500 font-medium mt-0.5">{{ o.payment || 'Efectivo' }}</div>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <div v-if="hasProof(o)" class="w-12 h-12 mx-auto rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:scale-110 transition-transform" @click="viewProof(o.proof)">
                                    <img :src="o.proof" alt="Comprobante detallado" loading="lazy" class="w-full h-full object-cover">
                                </div>
                                <span v-else class="text-gray-300 text-xs">N/A</span>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" :class="statusBadgeClass(o.status)">{{ o.status }}</span>
                            </td>
                            <td class="p-2 text-center align-middle">
                                <div class="flex items-center justify-center gap-1.5">
                                    <button v-if="o.unsolved_notes_count > 0" type="button" @click="openNotes(o.id)"
                                        class="relative group p-1 w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                                        <div class="bell-pulse-ring"></div>
                                        <i class="fas fa-bell animate-jump-spin text-sm relative z-10"></i>
                                    </button>
                                    <div class="relative inline-block text-left table-action-container">
                                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                                            <i class="fas fa-ellipsis-v text-xs"></i>
                                        </button>
                                        <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                            <button v-if="o.status !== 'Cobrado' && o.status !== 'Anulado'" type="button" @click="cobrar(o)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-teal-600 hover:bg-teal-50 transition-colors font-bold"><i class="fas fa-cash-register w-4 text-center"></i> <span>Cobrar Pedido</span></button>
                                            <button type="button" @click="showDetails(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalles</span></button>
                                            <button type="button" @click="print(o, true)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors"><i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span></button>
                                            <button type="button" @click="editOrder(o.id, true)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span></button>
                                            <button type="button" @click="deleteOrder(o.id)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Pedido</span></button>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="flex justify-between items-center mt-4 pt-2 border-t border-gray-100">
            <button type="button" @click="waiterPage = Math.max(1, waiterPage - 1)" :disabled="waiterPage === 1"
                class="text-gray-500 hover:text-orange-500 disabled:opacity-50 text-xs"><i class="fas fa-chevron-left"></i> Anterior</button>
            <span class="text-xs text-gray-400">Página {{ waiterPage }} de {{ waiterTotalPages }}</span>
            <button type="button" @click="waiterPage = Math.min(waiterTotalPages, waiterPage + 1)" :disabled="waiterPage >= waiterTotalPages"
                class="text-gray-500 hover:text-orange-500 disabled:opacity-50 text-xs">Siguiente <i class="fas fa-chevron-right"></i></button>
        </div>
    </div>
</template>
