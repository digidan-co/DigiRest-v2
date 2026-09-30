<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import {
    getInventorySummary, getSupplies, getRecipes, getInventoryMovements, deleteSupply, deleteRecipe
} from '@/legacy/services/inventory-service.js';
import { toast, showConfirmModal, showModalAlert } from '@/legacy/components/ui.js';

const activeSubtab = ref('stock');
const supplies = ref([]);
const recipes = ref([]);
const movements = ref([]);
const suppliesSearch = ref('');
const kardexSearch = ref('');
const kardexFilter = ref('ALL');
const kardexPage = ref(1);
const KARDEX_PAGE_SIZE = 15;

const summary = ref({ total_supplies: 0, low_stock: 0, out_of_stock: 0, total_value: 0 });

const filteredSupplies = computed(() => {
    const term = suppliesSearch.value.toLowerCase().trim();
    if (!term) return supplies.value;
    return supplies.value.filter(s => (s.name || '').toLowerCase().includes(term));
});

const filteredMovements = computed(() => {
    let list = movements.value;
    if (kardexFilter.value && kardexFilter.value !== 'ALL') {
        list = list.filter(m => {
            if (kardexFilter.value === 'AJUSTE_MANUAL') {
                return m.type === 'AJUSTE_MANUAL' || m.type === 'AJUSTE' || m.type === 'AJUSTE_STOCK';
            }
            return m.type === kardexFilter.value;
        });
    }
    const term = kardexSearch.value.toLowerCase().trim();
    if (term) {
        list = list.filter(m => {
            return (m.supply_name || '').toLowerCase().includes(term) ||
                (m.notes || '').toLowerCase().includes(term) ||
                (m.order_id || '').toLowerCase().includes(term) ||
                (m.user_name || '').toLowerCase().includes(term);
        });
    }
    return list;
});

const kardexTotalPages = computed(() => Math.max(1, Math.ceil(filteredMovements.value.length / KARDEX_PAGE_SIZE)));
const kardexPageItems = computed(() => {
    const start = (kardexPage.value - 1) * KARDEX_PAGE_SIZE;
    return filteredMovements.value.slice(start, start + KARDEX_PAGE_SIZE);
});

function isOutOfStock(s) { return s.current_stock <= 0; }
function isLowStock(s) { return !isOutOfStock(s) && s.current_stock <= s.min_stock; }
function supplyStatusClass(s) {
    if (isOutOfStock(s)) return 'bg-red-100 text-red-700';
    if (isLowStock(s)) return 'bg-amber-100 text-amber-700';
    return 'bg-green-100 text-green-700';
}
function supplyStatusLabel(s) {
    if (isOutOfStock(s)) return 'Agotado';
    if (isLowStock(s)) return 'Stock Bajo';
    return 'Óptimo';
}
function stockColorClass(s) {
    if (isOutOfStock(s)) return 'text-red-600 font-bold';
    if (isLowStock(s)) return 'text-amber-600 font-bold';
    return 'text-gray-800';
}
function recipePctClass(r) {
    const p = r.food_cost_pct || 0;
    if (p > 40) return 'bg-red-100 text-red-800 font-bold';
    if (p > 32) return 'bg-amber-100 text-amber-800 font-semibold';
    return 'bg-emerald-100 text-emerald-800';
}
function movementBadge(m) {
    if (m.type === 'DESCUENTO_PEDIDO') return { cls: 'bg-orange-100 text-orange-800', icon: 'fa-arrow-up', label: 'Salida Venta' };
    if (m.type === 'ENTRADA_COMPRA') return { cls: 'bg-emerald-100 text-emerald-800', icon: 'fa-arrow-down', label: 'Entrada Compra' };
    if (m.type === 'MERMA') return { cls: 'bg-red-100 text-red-800', icon: 'fa-trash-alt', label: 'Merma' };
    if (m.type === 'REINTEGRO_ANULACION') return { cls: 'bg-purple-100 text-purple-800', icon: 'fa-undo', label: 'Reintegro Anulación' };
    if (m.type === 'AJUSTE_MANUAL' || m.type === 'AJUSTE') return { cls: 'bg-blue-100 text-blue-800', icon: 'fa-sliders-h', label: 'Ajuste Manual' };
    return { cls: 'bg-blue-100 text-blue-800', icon: 'fa-sliders-h', label: m.type };
}
function fmtDate(d) { return new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }); }

async function loadSupplies() {
    if (!localStorage.getItem('pos_token')) return;
    try {
        const [sum, list] = await Promise.all([
            getInventorySummary().catch(() => null),
            getSupplies().catch(() => [])
        ]);
        if (sum) summary.value = sum;
        supplies.value = list || [];
        if (window._setSuppliesCache) window._setSuppliesCache(supplies.value);
    } catch (err) {
        console.error(err);
    }
}
async function loadRecipes() {
    try { recipes.value = await getRecipes(); } catch (err) { console.error(err); }
}
async function loadKardex() {
    try {
        movements.value = await getInventoryMovements(1000);
        kardexPage.value = 1;
    } catch (err) { console.error(err); }
}

function switchSubtab(tab) {
    activeSubtab.value = tab;
    if (tab === 'kardex') loadKardex();
    else if (tab === 'recipes') loadRecipes();
}

function editSupply(s) { if (window.openEditSupplyModal) window.openEditSupplyModal(s.id); }
function adjustSupply(s) { if (window.openAdjustSupplyModal) window.openAdjustSupplyModal(s.id); }
function editRecipe(r) { if (window.openEditRecipeModal) window.openEditRecipeModal(r.product_id); }

function deleteSupplyItem(s) {
    showConfirmModal('Eliminar Insumo', `¿Estás seguro de eliminar el insumo "${s.name}"? Solo podrá eliminarse si no forma parte de ninguna receta.`, async () => {
        try {
            await deleteSupply(s.id);
            toast('Insumo eliminado', 'success');
            await loadSupplies();
        } catch (err) {
            showModalAlert('No se puede eliminar', err.message || 'Error eliminando insumo', 'error');
        }
    });
}
function deleteRecipeItem(r) {
    showConfirmModal('Eliminar Receta', `¿Estás seguro de eliminar la receta de "${r.product_name || r.name}"? El plato dejará de descontar insumos al venderse.`, async () => {
        try {
            await deleteRecipe(r.id);
            toast('Receta eliminada', 'success');
            await loadRecipes();
        } catch (err) {
            showModalAlert('Error', err.message || 'Error eliminando receta', 'error');
        }
    });
}

function newSupply() {
    const $ = (id) => document.getElementById(id);
    if ($('supply-modal-title')) $('supply-modal-title').textContent = 'Nuevo Insumo / Alimento';
    if ($('s-id')) $('s-id').value = '';
    if ($('s-name')) $('s-name').value = '';
    if ($('s-unit')) $('s-unit').value = 'g';
    if ($('s-cost')) $('s-cost').value = '';
    if ($('s-stock')) $('s-stock').value = '0';
    if ($('s-min')) $('s-min').value = '5';
    const c = $('s-stock-container');
    if (c) c.classList.remove('hidden');
    if ($('supply-modal')) $('supply-modal').classList.remove('hidden');
}
function newRecipe() { if (window.openEditRecipeModal) window.openEditRecipeModal(); }

onMounted(() => {
    if (localStorage.getItem('pos_token')) {
        loadSupplies();
    }
});

watch(() => state.user, (u) => {
    if (u && localStorage.getItem('pos_token')) {
        loadSupplies();
    }
});
</script>

<template>
    <!-- Sub-Tabs -->
    <div class="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex-wrap gap-3">
        <div class="inline-flex bg-gray-100/90 p-1 rounded-xl text-xs font-semibold gap-1.5">
            <button type="button" @click="switchSubtab('stock')" class="px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'stock' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-boxes-stacked"></i><span>Insumos y Stock</span></button>
            <button type="button" @click="switchSubtab('kardex')" class="px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'kardex' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-history text-xs"></i><span>Kárdex / Movimientos</span></button>
            <button type="button" @click="switchSubtab('recipes')" class="px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'recipes' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-book-open text-xs"></i><span>Recetas de Platos</span></button>
        </div>
        <div v-if="activeSubtab === 'stock'" class="flex items-center gap-2">
            <button type="button" @click="newSupply" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"><i class="fas fa-plus"></i> Nuevo Insumo</button>
        </div>
    </div>

    <!-- STOCK -->
    <div v-show="activeSubtab === 'stock'" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                <div><p class="text-[11px] font-bold text-gray-400 uppercase">Total Insumos</p><h3 class="text-2xl font-black text-gray-800">{{ summary.total_supplies || 0 }}</h3></div>
                <div class="w-10 h-10 rounded-xl bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-lg shadow-sm"><i class="fas fa-boxes-stacked text-[var(--system-secondary)]"></i></div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                <div><p class="text-[11px] font-bold text-gray-400 uppercase">Stock Bajo</p><h3 class="text-2xl font-black text-amber-500">{{ summary.low_stock || 0 }}</h3></div>
                <div class="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center text-lg"><i class="fas fa-exclamation-triangle"></i></div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                <div><p class="text-[11px] font-bold text-gray-400 uppercase">Agotados</p><h3 class="text-2xl font-black text-red-500">{{ summary.out_of_stock || 0 }}</h3></div>
                <div class="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center text-lg"><i class="fas fa-times-circle"></i></div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
                <div><p class="text-[11px] font-bold text-gray-400 uppercase">Valor Inventario</p><h3 class="text-2xl font-black text-emerald-600">{{ formatMoney(summary.total_value || 0) }}</h3></div>
                <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg"><i class="fas fa-dollar-sign"></i></div>
            </div>
        </div>

        <div class="flex flex-col sm:flex-row justify-between gap-3 items-stretch sm:items-center">
            <div class="relative flex-1 max-w-md">
                <i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input v-model="suppliesSearch" type="text" placeholder="Buscar alimento o insumo..." class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:border-orange-500 transition-colors bg-white">
            </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                        <tr>
                            <th class="p-3.5">Insumo</th><th class="p-3.5">Unidad</th><th class="p-3.5 text-right">Stock Actual</th><th class="p-3.5 text-right">Stock Mínimo</th><th class="p-3.5 text-right">Costo Unit.</th><th class="p-3.5 text-right">Valor Total</th><th class="p-3.5 text-center">Estado</th><th class="p-3.5 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        <tr v-if="filteredSupplies.length === 0">
                            <td colspan="8" class="text-center py-10 text-gray-400"><i class="fas fa-boxes-stacked text-3xl mb-2 text-gray-300 block"></i>{{ suppliesSearch ? 'No se encontraron insumos con ese nombre.' : 'Aún no has registrado insumos. Haz clic en "Nuevo Insumo".' }}</td>
                        </tr>
                        <tr v-for="s in filteredSupplies" :key="s.id" class="hover:bg-gray-50/80 transition-colors">
                            <td class="p-3.5 font-bold text-gray-800">{{ s.name }}</td>
                            <td class="p-3.5 text-gray-500 font-medium">{{ s.unit }}</td>
                            <td class="p-3.5 text-right font-mono" :class="stockColorClass(s)">{{ s.current_stock }} <span class="text-[10px] text-gray-400">{{ s.unit }}</span></td>
                            <td class="p-3.5 text-right font-mono text-gray-500">{{ s.min_stock }} <span class="text-[10px] text-gray-400">{{ s.unit }}</span></td>
                            <td class="p-3.5 text-right font-mono text-gray-700">{{ formatMoney(s.cost_per_unit) }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-emerald-600">{{ formatMoney(s.total_cost || 0) }}</td>
                            <td class="p-3.5 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="supplyStatusClass(s)">{{ supplyStatusLabel(s) }}</span></td>
                            <td class="p-3.5 text-center">
                                <div class="relative inline-block text-left table-action-container">
                                    <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                                    <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                        <button type="button" @click="adjustSupply(s)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-arrows-rotate w-4 text-center"></i> <span>Ajustar Stock</span></button>
                                        <button type="button" @click="editSupply(s)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Insumo</span></button>
                                        <button type="button" @click="deleteSupplyItem(s)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Insumo</span></button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- KARDEX -->
    <div v-show="activeSubtab === 'kardex'" class="space-y-4">
        <div class="flex flex-col sm:flex-row justify-between gap-3 items-stretch sm:items-center bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <div class="flex flex-1 flex-col sm:flex-row gap-3 items-stretch sm:items-center max-w-2xl">
                <div class="relative flex-1">
                    <i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                    <input v-model="kardexSearch" type="text" placeholder="Buscar por insumo, notas o usuario..." class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:border-orange-500 transition-colors bg-white">
                </div>
                <div class="w-full sm:w-56">
                    <select v-model="kardexFilter" class="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs outline-none focus:border-orange-500 bg-white font-medium">
                        <option value="ALL">Todos los movimientos</option>
                        <option value="DESCUENTO_PEDIDO">Salidas por Venta</option>
                        <option value="ENTRADA_COMPRA">Entradas por Compra</option>
                        <option value="MERMA">Mermas / Bajas</option>
                        <option value="REINTEGRO_ANULACION">Reintegros por Anulación</option>
                        <option value="AJUSTE_MANUAL">Ajustes Manuales</option>
                    </select>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" @click="loadKardex" class="px-3.5 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"><i class="fas fa-sync-alt text-gray-400"></i> Actualizar</button>
            </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                        <tr>
                            <th class="p-3.5">Fecha / Hora</th><th class="p-3.5">Insumo</th><th class="p-3.5">Tipo Movimiento</th><th class="p-3.5 text-right">Cantidad</th><th class="p-3.5 text-right">Stock Final</th><th class="p-3.5">Detalle / Pedido</th><th class="p-3.5">Usuario</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        <tr v-if="kardexPageItems.length === 0">
                            <td colspan="7" class="text-center py-10 text-gray-400"><i class="fas fa-search text-3xl mb-2 text-gray-300 block"></i>No se encontraron movimientos registrados con los filtros actuales.</td>
                        </tr>
                        <tr v-for="m in kardexPageItems" :key="m.id" class="hover:bg-gray-50/80 transition-colors">
                            <td class="p-3 font-mono text-gray-500 text-xs">{{ fmtDate(m.created_at) }}</td>
                            <td class="p-3 font-bold text-gray-800 text-xs">{{ m.supply_name || 'Insumo' }}</td>
                            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="movementBadge(m).cls"><i class="fas text-[9px] mr-1" :class="movementBadge(m).icon"></i>{{ movementBadge(m).label }}</span></td>
                            <td class="p-3 text-right font-mono text-xs" :class="m.quantity > 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'">{{ m.quantity > 0 ? '+' + m.quantity : m.quantity }}</td>
                            <td class="p-3 text-right font-mono text-gray-600 text-xs font-semibold">{{ m.stock_after ?? '-' }}</td>
                            <td class="p-3 text-gray-600 text-xs max-w-xs truncate">{{ m.notes || m.order_id || '-' }}</td>
                            <td class="p-3 text-gray-500 text-xs font-medium">{{ m.user_name || 'Sistema' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div class="flex flex-col sm:flex-row justify-between items-center bg-white p-3.5 rounded-2xl border border-gray-100 shadow-sm gap-3">
            <span class="text-xs text-gray-500 font-medium">{{ filteredMovements.length === 0 ? 'Mostrando 0 registros' : `Mostrando ${(kardexPage - 1) * KARDEX_PAGE_SIZE + 1} - ${Math.min(kardexPage * KARDEX_PAGE_SIZE, filteredMovements.length)} de ${filteredMovements.length} movimientos` }}</span>
            <div class="flex items-center gap-2">
                <button type="button" @click="kardexPage = Math.max(1, kardexPage - 1)" :disabled="kardexPage <= 1" class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors flex items-center gap-1"><i class="fas fa-chevron-left text-[10px]"></i> Anterior</button>
                <span class="text-xs font-bold px-3 py-1 bg-gray-100 rounded-lg text-gray-700">Página {{ kardexPage }} de {{ kardexTotalPages }}</span>
                <button type="button" @click="kardexPage = Math.min(kardexTotalPages, kardexPage + 1)" :disabled="kardexPage >= kardexTotalPages" class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors flex items-center gap-1">Siguiente <i class="fas fa-chevron-right text-[10px]"></i></button>
            </div>
        </div>
    </div>

    <!-- RECIPES -->
    <div v-show="activeSubtab === 'recipes'" class="space-y-4">
        <div class="bg-white p-4 rounded-2xl border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-lg shrink-0 shadow-sm"><i class="fas fa-utensils text-[var(--system-secondary)]"></i></div>
                <div>
                    <h4 class="font-bold text-gray-800 text-sm">Escandallo y Recetas por Plato</h4>
                    <p class="text-xs text-gray-500">Cada vez que un pedido pase a cocina o sea recibido, sus insumos se descontarán automáticamente según la receta enlazada.</p>
                </div>
            </div>
            <button type="button" @click="newRecipe" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs shrink-0"><i class="fas fa-plus"></i> Crear / Editar Receta</button>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                        <tr>
                            <th class="p-3.5">Plato Vinculado</th><th class="p-3.5">Categoría</th><th class="p-3.5 text-right">Precio Venta</th><th class="p-3.5 text-right">Costo Receta</th><th class="p-3.5 text-right">Margen Bruto</th><th class="p-3.5 text-center">% Food Cost</th><th class="p-3.5">Ingredientes / Insumos</th><th class="p-3.5 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        <tr v-if="recipes.length === 0">
                            <td colspan="8" class="text-center py-10 text-gray-400"><i class="fas fa-book-open text-3xl mb-2 text-gray-300 block"></i>Aún no has creado recetas para tus platos. Haz clic en "Crear / Editar Receta" para empezar.</td>
                        </tr>
                        <tr v-for="r in recipes" :key="r.id" class="hover:bg-gray-50/80 transition-colors">
                            <td class="p-3.5">
                                <div class="font-bold text-gray-900">{{ r.product_name || r.name }}</div>
                                <span v-if="r.yield > 1" class="text-[10px] text-gray-400">Rinde {{ r.yield }} porciones</span>
                            </td>
                            <td class="p-3.5 text-gray-500">{{ r.product_category || 'Sin categoría' }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-gray-800">{{ formatMoney(r.product_price || 0) }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-orange-600">{{ formatMoney(r.total_cost || 0) }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-emerald-600">{{ formatMoney(r.margin || 0) }}</td>
                            <td class="p-3.5 text-center"><span class="px-2 py-0.5 rounded-full text-[11px]" :class="recipePctClass(r)">{{ r.food_cost_pct || 0 }}%</span></td>
                            <td class="p-3.5 max-w-xs">
                                <template v-if="(r.items || []).length > 0">
                                    <span v-for="(i, idx) in r.items" :key="idx" class="inline-block bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-[10px] mr-1 mb-1">{{ i.supply_name }}: {{ i.quantity }} {{ i.supply_unit }}</span>
                                </template>
                                <span v-else class="text-gray-400 italic text-[11px]">Sin ingredientes</span>
                            </td>
                            <td class="p-3.5 text-center">
                                <div class="relative inline-block text-left table-action-container">
                                    <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                                    <div class="table-action-menu hidden absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                        <button type="button" @click="editRecipe(r)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-orange-600 hover:bg-orange-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Receta</span></button>
                                        <button type="button" @click="deleteRecipeItem(r)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Receta</span></button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
