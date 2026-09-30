<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { ApiClient } from '@/legacy/services/api-client.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const CIERRES_PER_PAGE = 10;
const allCierres = ref([]);
const filterDate = ref('');
const cierresPage = ref(1);
const selectedIds = ref(new Set());
const loading = ref(false);

const isAdmin = computed(() => state.user?.role === 'admin');

function mergeGastos(resData, gastos) {
    return (resData || []).map(c => {
        let d, m, y;
        if (c.fecha && c.fecha.includes('/')) {
            const parts = c.fecha.split('/');
            if (parts.length === 3) { d = parseInt(parts[0], 10); m = parseInt(parts[1], 10); y = parseInt(parts[2], 10); }
        } else if (c.fecha && c.fecha.includes('-')) {
            const parts = c.fecha.split('-');
            if (parts.length === 3) { y = parseInt(parts[0], 10); m = parseInt(parts[1], 10); d = parseInt(parts[2], 10); }
        }
        if (!d || !m || !y) return c;

        const dayGastos = gastos.filter(g => {
            if (!g.timestamp) return false;
            const gd = new Date(g.timestamp);
            return gd.getDate() === d && (gd.getMonth() + 1) === m && gd.getFullYear() === y;
        });
        const sumGastos = dayGastos.reduce((acc, cur) => acc + (Number(cur.valor) || 0), 0);
        const finalTotalGastos = (c.total_gastos > 0) ? Number(c.total_gastos) : sumGastos;
        let finalTotalGeneral = Number(c.total_general) || 0;
        if (!c.total_gastos && sumGastos > 0) {
            finalTotalGeneral = (Number(c.ingreso_efectivo) || 0) + (Number(c.ingreso_transferencia) || 0) - sumGastos;
        }
        return { ...c, total_gastos: finalTotalGastos, total_general: finalTotalGeneral };
    });
}

const filteredCierres = computed(() => {
    if (!filterDate.value) return allCierres.value;
    const [year, month, day] = filterDate.value.split('-');
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    return allCierres.value.filter(c =>
        c.fecha === `${d}/${m}/${year}` || c.fecha === `${day}/${month}/${year}` || c.fecha === filterDate.value
    );
});

const totalPages = computed(() => Math.ceil(filteredCierres.value.length / CIERRES_PER_PAGE) || 1);

const pageItems = computed(() => {
    const start = (cierresPage.value - 1) * CIERRES_PER_PAGE;
    return filteredCierres.value.slice(start, start + CIERRES_PER_PAGE);
});

async function loadCierres() {
    if (!ApiClient.token && !localStorage.getItem('pos_token')) return;
    loading.value = true;
    try {
        const [res, resGastos] = await Promise.all([
            ApiClient.get('/cierre-caja'),
            ApiClient.get('/gastos-dia')
        ]);
        const gastos = resGastos?.data || [];
        allCierres.value = res?.data ? mergeGastos(res.data, gastos) : [];
        cierresPage.value = 1;
    } catch (e) {
        console.error(e);
    } finally {
        loading.value = false;
    }
}

function isSelected(id) { return selectedIds.value.has(id); }
function toggleSelect(id) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
}
function toggleSelectAll(e) {
    const checked = e.target.checked;
    const next = new Set(checked ? pageItems.value.map(c => c.id) : []);
    selectedIds.value = next;
}
function selectAllChecked() {
    return pageItems.value.length > 0 && pageItems.value.every(c => selectedIds.value.has(c.id));
}

async function deleteSelected() {
    if (selectedIds.value.size === 0) return;
    const confirmed = await new Promise((resolve) => {
        showConfirmModal(
            'Eliminar Cierres',
            `¿Estás seguro de eliminar ${selectedIds.value.size} registro(s) de cierre de caja? Esta acción no se puede deshacer.`,
            () => resolve(true),
            () => resolve(false),
            'Eliminar'
        );
    });
    if (!confirmed) return;
    try {
        const ids = Array.from(selectedIds.value);
        await ApiClient.delete('/cierre-caja/batch', { ids });
        selectedIds.value = new Set();
        toast(`${ids.length} registro(s) eliminado(s) correctamente`, 'success');
        await loadCierres();
    } catch (e) {
        console.error(e);
        toast('Error al eliminar registros: ' + e.message, 'error');
    }
}

function openCloseRegister() {
    const modal = document.getElementById('password-confirm-modal');
    const input = document.getElementById('confirm-password-input');
    if (modal) modal.classList.remove('hidden');
    if (input) { input.value = ''; input.focus(); }
}

onMounted(() => {
    if (ApiClient.token || localStorage.getItem('pos_token')) {
        loadCierres();
    }
});

watch(() => state.user, (u) => {
    if (u && (ApiClient.token || localStorage.getItem('pos_token'))) {
        loadCierres();
    }
});
</script>

<template>
    <!-- Cerrar Caja (Acción rápida) -->
    <div class="flex items-center justify-between bg-red-50 p-4 rounded-xl border border-red-100 shadow-sm">
        <div>
            <h4 class="font-bold text-red-800">Cierre de Caja (Fin del Día)</h4>
            <p class="text-xs text-red-400">Finaliza el día, exporta reporte y cierra el restaurante.</p>
        </div>
        <button type="button" @click="openCloseRegister" aria-label="Cerrar caja"
            class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md transition-colors flex items-center gap-2">
            <i class="fas fa-file-invoice-dollar"></i> Cerrar Caja
        </button>
    </div>

    <!-- Historial de Cierres -->
    <div class="w-full bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div>
                <h3 class="font-bold text-lg text-gray-800"><i class="fas fa-history text-blue-500 mr-2"></i> Historial de Cierres</h3>
                <p class="text-xs text-gray-500">Listado de todos los cierres diarios</p>
            </div>
            <div class="flex items-center gap-3 w-full sm:w-auto">
                <div class="relative w-full sm:w-auto">
                    <input type="date" v-model="filterDate"
                        class="w-full text-sm py-2 px-3 border border-gray-200 rounded-lg outline-none text-gray-600 focus:border-blue-500 transition-colors">
                </div>
                <button type="button" @click="deleteSelected" v-show="isAdmin" :disabled="selectedIds.size === 0"
                    class="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors whitespace-nowrap"
                    :class="selectedIds.size === 0 ? 'opacity-50 cursor-not-allowed' : ''"
                    title="Eliminar registros seleccionados">
                    <i class="fas fa-trash-alt mr-1"></i> <span>{{ selectedIds.size > 0 ? `Eliminar (${selectedIds.size})` : 'Eliminar' }}</span>
                </button>
                <button type="button" @click="loadCierres"
                    class="bg-gray-50 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors whitespace-nowrap">
                    <i class="fas fa-sync-alt mr-1"></i> Actualizar
                </button>
            </div>
        </div>

        <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden overflow-x-auto">
            <table class="w-full text-left text-sm whitespace-nowrap">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                        <th class="p-4 w-10 text-center">
                            <input v-if="isAdmin" type="checkbox" :checked="selectAllChecked()" @change="toggleSelectAll"
                                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" title="Seleccionar todo">
                        </th>
                        <th class="p-4">Fecha / Hora</th>
                        <th class="p-4">Pedidos / Platos</th>
                        <th class="p-4 text-red-500">Anulados</th>
                        <th class="p-4 text-green-600">Efectivo</th>
                        <th class="p-4 text-blue-600">Transf</th>
                        <th class="p-4 text-red-400">Gastos</th>
                        <th class="p-4 text-gray-900 border-l border-gray-200">Total</th>
                        <th class="p-4 text-center">Usuario</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-if="loading">
                        <td colspan="9" class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando historial...</td>
                    </tr>
                    <tr v-else-if="pageItems.length === 0">
                        <td colspan="9" class="text-center py-6 text-gray-400">No hay cierres registrados.</td>
                    </tr>
                    <tr v-for="c in pageItems" :key="c.id" class="hover:bg-gray-50 transition-colors">
                        <td class="p-4 text-center">
                            <input v-if="isAdmin" type="checkbox" :checked="isSelected(c.id)" @change="toggleSelect(c.id)"
                                class="rounded border-gray-300 text-red-500 focus:ring-red-500 cursor-pointer">
                            <span v-else class="text-gray-300 text-xs">-</span>
                        </td>
                        <td class="p-4 font-bold text-gray-800">{{ c.fecha }} <span class="text-xs text-gray-400 ml-1">{{ c.hora }}</span></td>
                        <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">{{ c.cantidad_pedidos }} ped.</span> <span class="text-xs text-gray-500 ml-1">/ {{ c.cantidad_platos }} platos</span></td>
                        <td class="p-4 text-red-500 font-bold">{{ c.total_anulados }} uds</td>
                        <td class="p-4 text-green-600 font-bold">{{ formatMoney(c.ingreso_efectivo) }}</td>
                        <td class="p-4 text-blue-600 font-bold">{{ formatMoney(c.ingreso_transferencia) }}</td>
                        <td class="p-4 text-red-500 font-bold">{{ formatMoney(c.total_gastos || 0) }}</td>
                        <td class="p-4 text-gray-900 font-black border-l border-gray-100">{{ formatMoney(c.total_general) }}</td>
                        <td class="p-4 text-center text-gray-500 text-xs">{{ c.usuario || '' }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="flex justify-between items-center mt-4">
            <span class="text-xs text-gray-500 font-medium">Página {{ cierresPage }} de {{ totalPages }}</span>
            <div class="flex gap-2">
                <button type="button" @click="cierresPage = Math.max(1, cierresPage - 1)" :disabled="cierresPage === 1"
                    class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors">Anterior</button>
                <button type="button" @click="cierresPage = Math.min(totalPages, cierresPage + 1)" :disabled="cierresPage >= totalPages"
                    class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors">Siguiente</button>
            </div>
        </div>
    </div>
</template>
