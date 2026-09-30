<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { ApiClient } from '@/legacy/services/api-client.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { renderSevenDayDashboardCharts, updateQuotaWidget } from '@/legacy/views/admin-view.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const realStats = ref(null);
const tasks = ref([]);
const newTaskDesc = ref('');
const newTaskDate = ref('');
const tasksLoading = ref(false);

const totals = computed(() => realStats.value?.totals || {});
const todayData = computed(() => realStats.value?.today || {});
const starDish = computed(() => realStats.value?.starDishWeekly || null);

const ordersToday = computed(() => Number(todayData.value.today_orders) || 0);
const revenueToday = computed(() => Number(todayData.value.today_revenue) || 0);
const cashToday = computed(() => Number(todayData.value.today_cash) || 0);
const transferToday = computed(() => Number(todayData.value.today_transfer) || 0);

function isTodayOpen() { return state.restaurantData.isOpen !== false; }

async function loadStats() {
    if (!ApiClient.token && !localStorage.getItem('pos_token')) return;
    try {
        const stats = await ApiClient.get('/admin/dashboard/stats', true);
        if (!stats) return;
        realStats.value = stats;
        await nextTick();
        renderSevenDayDashboardCharts(
            (state.orders || []).filter(o => o.type !== 'Local'),
            state.waiterOrders || [],
            stats
        );
        updateQuotaWidget();
    } catch (e) {
        realStats.value = null;
        await nextTick();
        renderSevenDayDashboardCharts(
            (state.orders || []).filter(o => o.type !== 'Local'),
            state.waiterOrders || [],
            null
        );
        updateQuotaWidget();
    }
}

async function loadTasks() {
    if (!ApiClient.token && !localStorage.getItem('pos_token')) return;
    tasksLoading.value = true;
    try {
        const res = await ApiClient.get('/admin/tasks');
        tasks.value = res || [];
    } catch (e) {
        tasks.value = [];
    } finally {
        tasksLoading.value = false;
    }
}

async function addTask() {
    const desc = newTaskDesc.value.trim();
    if (!desc) { toast('Escribe una tarea', 'warning'); return; }
    try {
        await ApiClient.post('/admin/tasks', { description: desc, due_date: newTaskDate.value });
        newTaskDesc.value = '';
        newTaskDate.value = '';
        await loadTasks();
        toast('Tarea agregada', 'success');
    } catch (e) { console.error(e); }
}

async function toggleTask(t, completed) {
    try {
        await ApiClient.patch(`/admin/tasks/${t.id}`, { completed });
        await loadTasks();
    } catch (e) { console.error(e); }
}

function deleteTask(t) {
    showConfirmModal('Borrar Tarea', '¿Estás seguro de eliminar esta tarea?', async () => {
        try {
            await ApiClient.delete(`/admin/tasks/${t.id}`);
            await loadTasks();
            toast('Tarea eliminada', 'success');
        } catch (e) { console.error(e); }
    });
}

function formatDueDate(d) {
    return d ? new Date(d).toLocaleDateString('es-CO') : '';
}

onMounted(() => {
    if (ApiClient.token || localStorage.getItem('pos_token')) {
        loadStats();
        loadTasks();
    }
});

watch(() => state.user, (u) => {
    if (u && (ApiClient.token || localStorage.getItem('pos_token'))) {
        loadStats();
        loadTasks();
    }
});

watch([() => state.orders, () => state.waiterOrders], () => loadStats());
</script>

<template>
    <div class="space-y-3.5 fade-in">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
            <!-- Orders Today -->
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex justify-between items-start mb-1.5">
                    <div class="w-8 h-8 rounded-lg bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-sm shadow-xs"><i class="fas fa-shopping-bag text-[var(--system-secondary)]"></i></div>
                    <span class="text-[10px] font-bold text-gray-400 uppercase">Hoy</span>
                </div>
                <div>
                    <h3 class="text-2xl font-black text-gray-800">{{ ordersToday }}</h3>
                    <p class="text-[11px] text-gray-500 mt-0.5">Pedidos recibidos</p>
                </div>
            </div>

            <!-- Daily Revenue -->
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex justify-between items-start mb-1.5">
                    <div class="w-8 h-8 rounded-lg bg-green-50 text-green-500 flex items-center justify-center text-sm"><i class="fas fa-dollar-sign"></i></div>
                    <span class="text-[10px] font-bold text-gray-400 uppercase">Ingresos</span>
                </div>
                <div class="flex flex-col text-right">
                    <span class="text-[10px] text-gray-500 font-medium">Efec: <span class="text-gray-700">{{ formatMoney(cashToday) }}</span></span>
                    <span class="text-[10px] text-gray-500 font-medium">Trans: <span class="text-gray-700">{{ formatMoney(transferToday) }}</span></span>
                    <span class="text-xl font-bold text-gray-800 mt-0.5">{{ formatMoney(revenueToday) }}</span>
                </div>
            </div>

            <!-- Global Stats -->
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 relative overflow-hidden">
                <div class="flex justify-between items-center mb-2">
                    <h3 class="font-bold text-gray-700 text-xs uppercase tracking-wide">Total Histórico</h3>
                    <span class="text-lg font-black text-gray-900 bg-gray-100 px-2 py-0.5 rounded-lg">{{ totals.total || 0 }}</span>
                </div>
                <div class="grid grid-cols-3 gap-1.5 text-[9px]">
                    <div class="bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                        <div class="font-bold text-gray-500 mb-0.5 uppercase text-[8px]">Pagos</div>
                        <div class="flex justify-between border-b border-gray-200 pb-0.5 mb-0.5"><span>Efec:</span> <span class="font-bold text-gray-800">{{ totals.cash_count || 0 }}</span></div>
                        <div class="flex justify-between"><span>Trans:</span> <span class="font-bold text-gray-800">{{ totals.transfer_count || 0 }}</span></div>
                    </div>
                    <div class="bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                        <div class="font-bold text-gray-500 mb-0.5 uppercase text-[8px]">Estado</div>
                        <div class="flex justify-between border-b border-gray-200 pb-0.5 mb-0.5"><span>Ok:</span> <span class="font-bold text-green-600">{{ totals.completed_count || 0 }}</span></div>
                        <div class="flex justify-between"><span>Anul:</span> <span class="font-bold text-red-500">{{ totals.cancelled_count || 0 }}</span></div>
                    </div>
                    <div class="bg-gray-50 p-1.5 rounded-lg border border-gray-100">
                        <div class="font-bold text-gray-500 mb-0.5 uppercase text-[8px]">Tipo</div>
                        <div class="flex justify-between border-b border-gray-200 pb-0.5 mb-0.5"><span>Local:</span> <span class="font-bold text-gray-800">{{ totals.local_count || 0 }}</span></div>
                        <div class="flex justify-between border-b border-gray-200 pb-0.5 mb-0.5"><span>Dom:</span> <span class="font-bold text-gray-800">{{ totals.delivery_count || 0 }}</span></div>
                        <div class="flex justify-between"><span>Rec:</span> <span class="font-bold text-gray-800">{{ totals.pickup_count || 0 }}</span></div>
                    </div>
                </div>
            </div>

            <!-- System Health -->
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between relative overflow-hidden">
                <div class="flex justify-between items-center mb-1.5">
                    <h3 class="font-bold text-gray-700 text-xs uppercase tracking-wide flex items-center gap-1.5"><i class="fas fa-database text-blue-500"></i> Sistema</h3>
                </div>
                <div class="space-y-2">
                    <div>
                        <div class="flex justify-between text-[9px] mb-0.5 font-medium text-gray-500"><span>Registros Totales</span><span id="cap-reads-text">0 / 15.000</span></div>
                        <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden"><div id="cap-reads-bar" class="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div></div>
                    </div>
                    <div>
                        <div class="flex justify-between text-[9px] mb-0.5 font-medium text-gray-500"><span>Tamaño en base de datos</span><span id="cap-storage-text">0 KB</span></div>
                        <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden"><div id="cap-storage-bar" class="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div></div>
                    </div>
                    <div class="flex justify-between items-center pt-1.5 border-t border-gray-50 mt-0.5">
                        <div class="text-[8px] text-gray-400 font-medium" id="cap-health-status">Estado: OK</div>
                        <div class="text-[9px] font-bold text-gray-600" id="cap-images-count"><i class="fas fa-images mr-1"></i>0 imgs (0 KB)</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 7-day charts -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3.5">
            <div class="lg:col-span-2 bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col">
                <h3 class="font-bold text-gray-700 text-xs sm:text-sm mb-2 flex items-center gap-1.5"><i class="fas fa-chart-line text-blue-500"></i> Ingresos (Últimos 7 Días)</h3>
                <div class="relative w-full flex-1" style="min-height: 180px; max-height: 200px;">
                    <canvas id="chart-revenue-7d"></canvas>
                </div>
            </div>
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col">
                <h3 class="font-bold text-gray-700 text-xs sm:text-sm mb-2 flex items-center gap-1.5 w-full"><i class="fas fa-users text-purple-500"></i> Mesas Atendidas (7 Días)</h3>
                <div class="relative w-full flex-1 flex justify-center items-center" style="min-height: 180px; max-height: 200px;">
                    <canvas id="chart-waiters-7d"></canvas>
                </div>
            </div>
        </div>

        <!-- Star dish -->
        <div class="mb-3.5">
            <div class="bg-[#333333] border-l-4 border-[var(--system-primary)] p-3.5 sm:p-4 rounded-xl shadow-md text-white flex flex-col sm:flex-row items-center gap-4 relative overflow-hidden transition-transform hover:scale-[1.005]">
                <div class="absolute right-0 top-0 opacity-10 pointer-events-none"><i class="fas fa-trophy text-[90px] -mt-4 -mr-3"></i></div>
                <div class="bg-white/20 p-2.5 rounded-full backdrop-blur-md z-10 shrink-0 shadow-inner"><i class="fas fa-crown text-xl sm:text-2xl text-yellow-300 drop-shadow-md"></i></div>
                <div class="z-10 flex-1 text-center sm:text-left flex flex-col justify-center">
                    <h3 class="text-white/80 text-[11px] font-bold uppercase tracking-wider mb-0.5">El Plato Estrella (Últimos 7 Días)</h3>
                    <h2 class="text-lg sm:text-xl font-black mb-1 drop-shadow-sm tracking-tight">{{ starDish ? starDish.name : 'Sin ventas aún' }}</h2>
                    <div>
                        <span class="text-white font-bold bg-black/30 px-2.5 py-0.5 rounded-full text-xs backdrop-blur-sm border border-white/10">{{ starDish ? starDish.count + (starDish.count > 1 ? ' ventas' : ' venta') : '0 ventas' }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tasks -->
        <div class="bg-white p-3.5 sm:p-4 rounded-xl shadow-sm border border-gray-100 mb-3.5">
            <div class="flex items-center justify-between mb-3">
                <div>
                    <h3 class="font-bold text-sm text-gray-800 flex items-center gap-2">
                        <span class="w-6 h-6 rounded-lg bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-xs shadow-xs"><i class="fas fa-clipboard-check text-[var(--system-secondary)]"></i></span>
                        Lista de Pendientes & Tareas
                    </h3>
                    <p class="text-[11px] text-gray-400 mt-0.5">Control de tareas y recordatorios del restaurante</p>
                </div>
            </div>

            <div class="flex flex-col sm:flex-row gap-2 mb-3">
                <input v-model="newTaskDesc" type="text" placeholder="Escribe una nueva tarea o recordatorio..." class="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-[var(--system-primary)]/50 outline-none">
                <div class="flex gap-2">
                    <input v-model="newTaskDate" type="date" class="border border-gray-200 rounded-xl px-2.5 py-1.5 text-xs text-gray-600 outline-none focus:border-[var(--system-primary)]">
                    <button type="button" @click="addTask" class="btn-system-primary rounded-xl px-3.5 py-1.5 text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 whitespace-nowrap cursor-pointer">
                        <i class="fas fa-plus"></i>
                        <span>Agregar</span>
                    </button>
                </div>
            </div>

            <ul class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                <li v-if="tasksLoading" class="text-center py-4"><i class="fas fa-spinner fa-spin text-orange-500"></i></li>
                <li v-else-if="tasks.length === 0" class="text-center text-gray-400 py-4 text-xs">No hay tareas pendientes</li>
                <li v-for="t in tasks" :key="t.id" class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl group hover:bg-white hover:shadow-sm transition border border-transparent hover:border-orange-100">
                    <input type="checkbox" :checked="t.status === 'done'" @change="toggleTask(t, $event.target.checked)"
                        class="w-4 h-4 text-orange-500 rounded focus:ring-orange-500 cursor-pointer accent-orange-500">
                    <span class="flex-1 text-xs md:text-sm" :class="t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700 font-medium'">{{ t.description }}</span>
                    <span v-if="t.due_date" class="text-[11px] text-gray-400 whitespace-nowrap"><i class="far fa-clock mr-1 text-orange-400"></i>{{ formatDueDate(t.due_date) }}</span>
                    <button type="button" @click="deleteTask(t)" class="text-gray-300 hover:text-red-500 opacity-60 group-hover:opacity-100 transition p-1" title="Eliminar tarea"><i class="fas fa-trash-alt text-xs"></i></button>
                </li>
            </ul>
        </div>
    </div>
</template>
