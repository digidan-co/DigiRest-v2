<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
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

const currentTime = ref('');
const currentDate = ref('');
let clockTimer = null;

function updateClock() {
    const now = new Date();
    // Hora en formato 12 horas sin segunderos
    const timeStr = now.toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const months = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const dateStr = `Hoy es: ${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]}`;

    document.querySelectorAll('.clock-display-time').forEach(el => {
        if (el.innerText !== timeStr) el.innerText = timeStr;
    });
    document.querySelectorAll('.clock-display-date').forEach(el => {
        if (el.innerText !== dateStr) el.innerText = dateStr;
    });
}

const isCashier = computed(() => {
    const role = state.user?.role || '';
    if (role) return role.toLowerCase() === 'cajero';
    try {
        const u = JSON.parse(localStorage.getItem('pos_user') || '{}');
        return (u.role || '').toLowerCase() === 'cajero';
    } catch {
        return false;
    }
});

const totals = computed(() => realStats.value?.totals || {});
const todayData = computed(() => realStats.value?.today || {});

const top5Dishes = computed(() => {
    if (realStats.value?.topDishesWeekly && Array.isArray(realStats.value.topDishesWeekly) && realStats.value.topDishesWeekly.length > 0) {
        return realStats.value.topDishesWeekly.slice(0, 5);
    }
    if (realStats.value?.starDishWeekly) {
        return [realStats.value.starDishWeekly];
    }
    // Fallback local desde pedidos en memoria
    const dishMap = new Map();
    const allOrders = [...(state.orders || []), ...(state.waiterOrders || [])].filter(o => o.status !== 'Anulado');
    const startOf7Days = Date.now() - 7 * 86400000;
    allOrders.forEach(o => {
        const orderTime = new Date(o.date || o.timestamp).getTime();
        if (orderTime >= startOf7Days) {
            let items = [];
            try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch (_) {}
            items.forEach(item => {
                const name = item.name || 'Producto';
                const qty = Number(item.qty || item.quantity) || 1;
                dishMap.set(name, (dishMap.get(name) || 0) + qty);
            });
        }
    });
    return Array.from(dishMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
});

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
    updateClock();
    clockTimer = setInterval(updateClock, 15000);

    if (ApiClient.token || localStorage.getItem('pos_token')) {
        loadStats();
        loadTasks();
    }
});

onUnmounted(() => {
    if (clockTimer) clearInterval(clockTimer);
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
        <!-- VISTA CAJERO: Fila Única y Equilibrada de 3 Columnas (Pedidos, Sistema, Mesas Atendidas) -->
        <div v-if="isCashier" class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3.5">
            <!-- 1. Pedidos Hoy -->
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

            <!-- 2. Sistema -->
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
                        <div class="flex justify-between text-[9px] mb-0.5 font-medium text-gray-500"><span>Almacenamiento (Archivos)</span><span id="cap-storage-text">0 MB / 50 MB</span></div>
                        <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden"><div id="cap-storage-bar" class="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div></div>
                    </div>
                    <div class="flex justify-between items-center pt-1.5 border-t border-gray-50 mt-0.5">
                        <div class="text-[8px] text-gray-400 font-medium" id="cap-health-status">Estado: OK</div>
                        <div class="text-[9px] font-bold text-gray-600" id="cap-images-count"><i class="fas fa-images mr-1"></i>0 archivos (0 platos • 0 comp.)</div>
                    </div>
                </div>
            </div>

            <!-- 3. Mesas Atendidas (Equilibrio estético en la misma fila para el Cajero) -->
            <div class="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex justify-between items-center mb-1.5">
                    <h3 class="font-bold text-gray-700 text-xs uppercase tracking-wide flex items-center gap-1.5">
                        <i class="fas fa-users text-purple-500"></i> Mesas Atendidas
                    </h3>
                    <span class="text-[10px] font-bold text-gray-400 uppercase">7 Días</span>
                </div>
                <div class="relative w-full flex-1 flex justify-center items-center" style="min-height: 120px; max-height: 140px;">
                    <canvas id="chart-waiters-7d"></canvas>
                </div>
            </div>
        </div>

        <!-- VISTA ADMIN / OTROS ROLES: Cuadrícula Completa de 4 Columnas -->
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3.5">
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
                        <div class="flex justify-between text-[9px] mb-0.5 font-medium text-gray-500"><span>Almacenamiento (Archivos)</span><span id="cap-storage-text">0 MB / 50 MB</span></div>
                        <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden"><div id="cap-storage-bar" class="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style="width: 0%"></div></div>
                    </div>
                    <div class="flex justify-between items-center pt-1.5 border-t border-gray-50 mt-0.5">
                        <div class="text-[8px] text-gray-400 font-medium" id="cap-health-status">Estado: OK</div>
                        <div class="text-[9px] font-bold text-gray-600" id="cap-images-count"><i class="fas fa-images mr-1"></i>0 archivos (0 platos • 0 comp.)</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 7-day charts (Solo para Administrador / Roles que ven ingresos) -->
        <div v-if="!isCashier" class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3.5">
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

        <!-- Top 5 Platos Más Vendidos de los Últimos 7 Días -->
        <div class="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100 mb-3.5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3.5 pb-2.5 border-b border-gray-100">
                <div>
                    <h3 class="font-bold text-sm sm:text-base text-gray-800 flex items-center gap-2">
                        <span class="w-7 h-7 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-xs shadow-2xs">
                            <i class="fas fa-trophy"></i>
                        </span>
                        <span>Top 5 Platos Más Vendidos (Últimos 7 Días)</span>
                    </h3>
                    <p class="text-[11px] text-gray-400 mt-0.5">Ranking de mayor preferencia comenzando por el más vendido durante esta semana</p>
                </div>
                <span class="inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 self-start sm:self-auto">
                    <i class="fas fa-fire text-amber-500"></i> Últimos 7 Días
                </span>
            </div>

            <div v-if="top5Dishes.length === 0" class="py-8 text-center text-gray-400 text-xs">
                <i class="fas fa-utensils text-2xl text-gray-300 mb-2"></i>
                <p>No se han registrado ventas de platos durante los últimos 7 días.</p>
            </div>

            <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div 
                    v-for="(dish, index) in top5Dishes" 
                    :key="dish.name + index"
                    class="p-3.5 rounded-2xl border transition-all flex flex-col justify-between relative group hover:shadow-xs"
                    :class="[
                        index === 0 ? 'bg-amber-50/50 border-amber-300 shadow-2xs ring-1 ring-amber-300/60' :
                        index === 1 ? 'bg-gray-50/70 border-gray-300' :
                        index === 2 ? 'bg-orange-50/40 border-orange-200' :
                        'bg-white border-gray-200 hover:border-gray-300'
                    ]"
                >
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <span 
                            class="w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center shadow-2xs shrink-0"
                            :class="[
                                index === 0 ? 'bg-amber-500 text-white' :
                                index === 1 ? 'bg-gray-400 text-white' :
                                index === 2 ? 'bg-orange-400 text-white' :
                                'bg-gray-200 text-gray-700'
                            ]"
                        >
                            <i v-if="index === 0" class="fas fa-crown text-[10px]"></i>
                            <span v-else>#{{ index + 1 }}</span>
                        </span>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            :class="[
                                index === 0 ? 'bg-amber-100 text-amber-800' :
                                index === 1 ? 'bg-gray-200 text-gray-700' :
                                index === 2 ? 'bg-orange-100 text-orange-800' :
                                'bg-gray-100 text-gray-600'
                            ]"
                        >
                            {{ dish.count }} {{ dish.count === 1 ? 'venta' : 'ventas' }}
                        </span>
                    </div>
                    <div>
                        <h4 class="font-bold text-xs text-gray-900 leading-snug line-clamp-2" :title="dish.name">
                            {{ dish.name }}
                        </h4>
                        <p class="text-[10px] text-gray-400 mt-1 font-medium">
                            {{ index === 0 ? 'Plato Estrella' : `Puesto #${index + 1} de la semana` }}
                        </p>
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
