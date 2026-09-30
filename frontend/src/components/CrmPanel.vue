<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { getCustomers, getCustomerStats, syncCustomers } from '@/legacy/services/crm-service.js';
import { openCustomerProfileModal } from '@/legacy/features/crm-manager.js';
import { toast } from '@/legacy/components/ui.js';

const searchTerm = ref('');
const sortVal = ref('last_order');
const currentFilter = ref('all');
const syncing = ref(false);

const filters = [
    { key: 'all', label: 'Todos' },
    { key: 'frequent', label: 'Frecuentes (VIP)' },
    { key: 'inactive', label: 'Inactivos (+15 días)' },
    { key: 'new', label: 'Nuevos' },
];

const stats = computed(() => state.customerStats || {});

const currentPage = ref(1);
const PAGE_SIZE = 15;

const filteredCustomers = computed(() => {
    let list = [...(state.customers || [])];
    if (currentFilter.value === 'frequent') list = list.filter(c => c.total_orders >= 3);
    else if (currentFilter.value === 'inactive') list = list.filter(c => c.days_since_last_order !== null && c.days_since_last_order >= 15);
    else if (currentFilter.value === 'new') list = list.filter(c => c.total_orders === 1);

    const q = searchTerm.value.toLowerCase().trim();
    if (q) {
        list = list.filter(c => {
            return (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q) ||
                (c.address || '').toLowerCase().includes(q) || (c.delivery_zone || '').toLowerCase().includes(q) ||
                (c.notes || '').toLowerCase().includes(q);
        });
    }

    if (sortVal.value === 'orders') list.sort((a, b) => (b.total_orders || 0) - (a.total_orders || 0));
    else if (sortVal.value === 'spent') list.sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
    else if (sortVal.value === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => new Date(b.last_order_at || 0) - new Date(a.last_order_at || 0));
    return list;
});

const totalPages = computed(() => Math.ceil(filteredCustomers.value.length / PAGE_SIZE) || 1);

const paginatedCustomers = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return filteredCustomers.value.slice(start, start + PAGE_SIZE);
});

watch([searchTerm, sortVal, currentFilter], () => {
    currentPage.value = 1;
});

function prevPage() {
    if (currentPage.value > 1) {
        currentPage.value--;
    }
}

function nextPage() {
    if (currentPage.value < totalPages.value) {
        currentPage.value++;
    }
}

function isVip(c) { return (c.total_orders || 0) >= 3; }
function isInactive(c) { return c.days_since_last_order !== null && c.days_since_last_order >= 15; }
function isNew(c) { return c.total_orders === 1; }
function badge(c) {
    if (isVip(c)) return { cls: 'bg-amber-50 text-amber-800 border-amber-200/80', icon: 'fa-crown text-amber-500', label: 'Frecuente (VIP)' };
    if (isInactive(c)) return { cls: 'bg-rose-50 text-rose-700 border-rose-200/80', icon: 'fa-clock', label: 'Inactivo (+15d)' };
    if (isNew(c)) return { cls: 'bg-blue-50 text-blue-700 border-blue-200/80', icon: 'fa-star text-blue-500', label: 'Nuevo' };
    return { cls: 'bg-gray-100 text-gray-700 border-gray-200', icon: 'fa-user', label: 'Regular' };
}
function lastOrder(c) {
    return c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin registro';
}
function daysText(c) {
    if (c.days_since_last_order === null || c.days_since_last_order === undefined) return '';
    return c.days_since_last_order === 0 ? 'Hoy' : `Hace ${c.days_since_last_order} día${c.days_since_last_order === 1 ? '' : 's'}`;
}

function canAccessCrm() {
    const user = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
    return user && (user.role === 'admin' || user.role === 'cajero');
}

async function load() {
    if (!localStorage.getItem('pos_token') || !canAccessCrm()) return;
    try {
        const [customers, s] = await Promise.all([getCustomers(), getCustomerStats()]);
        state.customers = customers || [];
        state.customerStats = s || {};
    } catch (err) { console.error(err); }
}

async function sync() {
    if (!canAccessCrm()) return;
    syncing.value = true;
    try {
        toast('Sincronizando clientes con el historial de pedidos...', 'info');
        await syncCustomers();
        await load();
        toast('Clientes sincronizados correctamente', 'success');
    } catch (err) {
        console.error(err);
        toast('Error al sincronizar clientes', 'error');
    } finally { syncing.value = false; }
}

function openProfile(phone) { openCustomerProfileModal(phone); }

onMounted(() => {
    if (localStorage.getItem('pos_token') && canAccessCrm()) {
        load();
    }
});

watch(() => state.user, (u) => {
    if (u && localStorage.getItem('pos_token') && (u.role === 'admin' || u.role === 'cajero')) {
        load();
    }
});
</script>

<template>
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div>
            <h3 class="text-sm font-black text-gray-900 flex items-center gap-2"><i class="fas fa-users text-orange-500"></i> Directorio de Clientes & CRM</h3>
            <p class="text-[11px] text-gray-400">Historial de consumo y clientes frecuentes</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
            <button type="button" @click="sync" :disabled="syncing" class="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-xs"><i class="fas fa-sync text-gray-500" :class="syncing ? 'fa-spin' : ''"></i><span>Sincronizar Pedidos</span></button>
        </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0"><i class="fas fa-users"></i></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Total Clientes</div><div class="text-lg font-black text-gray-900 leading-tight">{{ (stats.totalCustomers || 0).toLocaleString() }}</div></div>
        </div>
        <div class="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0"><i class="fas fa-crown"></i></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Frecuentes / VIP</div><div class="text-lg font-black text-amber-600 leading-tight">{{ (stats.frequentCustomers || 0).toLocaleString() }}</div></div>
        </div>
        <div class="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-sm shrink-0"><i class="fas fa-user-clock"></i></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Inactivos (+15d)</div><div class="text-lg font-black text-rose-600 leading-tight">{{ (stats.inactiveCustomers || 0).toLocaleString() }}</div></div>
        </div>
        <div class="bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm shrink-0"><i class="fas fa-wallet"></i></div>
            <div><div class="text-[10px] uppercase font-bold text-gray-400">Gasto Promedio</div><div class="text-lg font-black text-emerald-700 leading-tight">{{ formatMoney(stats.avgSpent || 0) }}</div></div>
        </div>
    </div>

    <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex items-center gap-1.5 overflow-x-auto custom-scroll pb-1 md:pb-0">
            <button v-for="f in filters" :key="f.key" type="button" @click="currentFilter = f.key"
                class="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all shadow-xs"
                :class="currentFilter === f.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'">{{ f.label }}</button>
        </div>
        <div class="flex items-center gap-2">
            <div class="relative flex-1 md:w-64">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input v-model="searchTerm" type="text" placeholder="Buscar por nombre, WhatsApp, zona..." class="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] text-xs">
            </div>
            <select v-model="sortVal" class="p-1.5 border border-gray-200 rounded-xl bg-white outline-none text-xs text-gray-600 focus:border-[var(--system-primary)]">
                <option value="last_order">Más reciente</option>
                <option value="orders">Más pedidos</option>
                <option value="spent">Mayor gasto</option>
                <option value="name">Nombre (A-Z)</option>
            </select>
        </div>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
        <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                    <th class="py-2 px-3">Cliente / WhatsApp</th>
                    <th class="py-2 px-3">Tipo de Cliente</th>
                    <th class="py-2 px-3">Sector / Dirección</th>
                    <th class="py-2 px-3 text-center">Pedidos</th>
                    <th class="py-2 px-3 text-right">Total Gastado</th>
                    <th class="py-2 px-3">Última Compra</th>
                    <th class="py-2 px-3 text-center">Acciones</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
                <tr v-for="c in paginatedCustomers" :key="c.phone" class="hover:bg-gray-50/80 transition-colors border-b border-gray-100 last:border-0">
                    <td class="py-1.5 px-3">
                        <div class="flex items-center gap-2">
                            <div class="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 shadow-xs" :class="isVip(c) ? 'bg-amber-100 text-amber-700 border border-amber-300/60' : 'bg-orange-50 text-orange-600 border border-orange-200/60'">{{ c.name ? c.name.charAt(0).toUpperCase() : 'C' }}</div>
                            <div class="min-w-0">
                                <div class="font-bold text-gray-900 text-xs truncate max-w-[170px]">{{ c.name || 'Cliente' }}</div>
                                <div class="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                                    <a :href="'https://wa.me/+57' + c.phone" target="_blank" class="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-semibold" title="Abrir chat de WhatsApp"><i class="fab fa-whatsapp"></i> {{ c.phone }}</a>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td class="py-1.5 px-3">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border" :class="badge(c).cls"><i class="fas text-[8px]" :class="badge(c).icon"></i> {{ badge(c).label }}</span>
                    </td>
                    <td class="py-1.5 px-3">
                        <div v-if="c.delivery_zone" class="text-[10px] text-orange-600 font-semibold truncate max-w-[160px]"><i class="fas fa-map-marker-alt text-[9px] mr-1"></i>{{ c.delivery_zone }}</div>
                        <div v-else-if="c.address && c.address !== 'N/A'" class="text-[10px] text-gray-500 truncate max-w-[160px]">{{ c.address }}</div>
                        <div v-else class="text-[10px] text-gray-400 italic">Sin dirección</div>
                        <div v-if="c.notes" class="text-[9px] text-gray-400 italic truncate max-w-[150px] mt-0.5"><i class="fas fa-sticky-note mr-1 text-[8px]"></i>{{ c.notes }}</div>
                    </td>
                    <td class="py-1.5 px-3 text-center">
                        <div class="text-xs font-black text-gray-800">{{ c.total_orders || 0 }}</div>
                        <div class="text-[8px] text-gray-400 uppercase font-semibold">Pedidos</div>
                    </td>
                    <td class="py-1.5 px-3 text-right">
                        <div class="text-xs font-black text-gray-900">{{ formatMoney(c.total_spent || 0) }}</div>
                        <div class="text-[8px] text-gray-400">Total gastado</div>
                    </td>
                    <td class="py-1.5 px-3">
                        <div class="text-xs font-semibold text-gray-700">{{ lastOrder(c) }}</div>
                        <div class="text-[10px] text-gray-400 font-medium">{{ daysText(c) }}</div>
                    </td>
                    <td class="py-1.5 px-3 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" @click="openProfile(c.phone)" class="px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer shadow-2xs" title="Ver Perfil e Historial"><i class="fas fa-user-circle"></i><span>Perfil</span></button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- Pagination Controls (15 records per page) -->
    <div v-if="filteredCustomers.length > 0" class="flex flex-col sm:flex-row justify-between items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-xs">
        <div class="text-gray-500 font-medium">
            Mostrando <span class="font-bold text-gray-900">{{ (currentPage - 1) * PAGE_SIZE + 1 }}</span> a <span class="font-bold text-gray-900">{{ Math.min(currentPage * PAGE_SIZE, filteredCustomers.length) }}</span> de <span class="font-bold text-gray-900">{{ filteredCustomers.length }}</span> clientes
        </div>
        <div class="flex items-center gap-2">
            <button type="button" @click="prevPage" :disabled="currentPage === 1"
                class="px-3 py-1.5 rounded-xl border border-gray-200 font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 active:scale-95 text-gray-700">
                <i class="fas fa-chevron-left text-[10px]"></i> Anterior
            </button>
            <span class="px-3 py-1.5 rounded-xl bg-gray-50 text-gray-700 font-bold border border-gray-200">
                Página {{ currentPage }} de {{ totalPages }}
            </span>
            <button type="button" @click="nextPage" :disabled="currentPage >= totalPages"
                class="px-3 py-1.5 rounded-xl border border-gray-200 font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 active:scale-95 text-gray-700">
                Siguiente <i class="fas fa-chevron-right text-[10px]"></i>
            </button>
        </div>
    </div>

    <div v-show="filteredCustomers.length === 0" class="text-center py-12 bg-white rounded-2xl border border-gray-100">
        <i class="fas fa-users-slash text-4xl text-gray-300 mb-3"></i>
        <p class="text-sm font-semibold text-gray-600">No se encontraron clientes</p>
        <p class="text-xs text-gray-400 mt-1">Los clientes se registran automáticamente con cada pedido que ingresa.</p>
    </div>
</template>
