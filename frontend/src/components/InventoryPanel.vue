<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import {
    getInventorySummary, getSupplies, getRecipes, getInventoryMovements, deleteSupply, deleteRecipe,
    importSuppliesCSV, importRecipesCSV
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

function isOutOfStock(s) { return Number(s?.current_stock ?? 0) <= 0; }
function isLowStock(s) { 
    const curr = Number(s?.current_stock ?? 0);
    const min = Number(s?.min_stock ?? 0);
    return curr > 0 && curr <= min; 
}
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
function editRecipe(r) { if (window.openEditRecipeModal) window.openEditRecipeModal(r.product_id, r.variant_id); }

const stockAlertModalType = ref(null); // 'low' | 'out' | 'alert' | 'all'
const stockAlertSearch = ref('');

const countLowStock = computed(() => supplies.value.filter(isLowStock).length);
const countOutOfStock = computed(() => supplies.value.filter(isOutOfStock).length);
const countAlertStock = computed(() => supplies.value.filter(s => isLowStock(s) || isOutOfStock(s)).length);

const alertSuppliesList = computed(() => {
    if (!stockAlertModalType.value) return [];
    let list = supplies.value;
    if (stockAlertModalType.value === 'low') {
        list = list.filter(isLowStock);
    } else if (stockAlertModalType.value === 'out') {
        list = list.filter(isOutOfStock);
    } else if (stockAlertModalType.value === 'alert') {
        list = list.filter(s => isLowStock(s) || isOutOfStock(s));
    }
    // Si es 'all', no se filtra por estado (muestra todos los insumos)

    if (stockAlertSearch.value && stockAlertSearch.value.trim()) {
        const q = stockAlertSearch.value.toLowerCase().trim();
        list = list.filter(s => s.name?.toLowerCase().includes(q));
    }
    return list;
});

function openStockAlertModal(type) {
    stockAlertModalType.value = type;
    stockAlertSearch.value = '';
}

function closeStockAlertModal() {
    stockAlertModalType.value = null;
    stockAlertSearch.value = '';
}

function adjustSupplyFromAlert(s) {
    closeStockAlertModal();
    adjustSupply(s);
}

function editSupplyFromAlert(s) {
    closeStockAlertModal();
    editSupply(s);
}

const selectedRecipeForView = ref(null);

function viewRecipe(r) {
    selectedRecipeForView.value = r;
}

function closeViewRecipeModal() {
    selectedRecipeForView.value = null;
}

function editRecipeFromView() {
    if (selectedRecipeForView.value) {
        const r = selectedRecipeForView.value;
        closeViewRecipeModal();
        editRecipe(r);
    }
}

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        if (stockAlertModalType.value) {
            closeStockAlertModal();
        } else if (selectedRecipeForView.value) {
            closeViewRecipeModal();
        }
    }
}

function handleAppEscape() {
    if (stockAlertModalType.value) {
        closeStockAlertModal();
    } else if (selectedRecipeForView.value) {
        closeViewRecipeModal();
    }
}

window.viewRecipeDetails = (recipeId) => {
    const found = recipes.value.find(r => String(r.id) === String(recipeId) || String(r.product_id) === String(recipeId));
    if (found) {
        viewRecipe(found);
    }
};

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

const importingSupplies = ref(false);
const importingRecipes = ref(false);

function exportSupplies() {
    window.open('/api/inventory/supplies/export', '_blank');
}

async function onImportSupplies(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
        toast('Por favor selecciona un archivo CSV', 'error');
        return;
    }
    importingSupplies.value = true;
    try {
        const res = await importSuppliesCSV(file);
        toast(res.message || 'Insumos importados correctamente', 'success');
        await loadSupplies();
    } catch (err) {
        console.error(err);
        toast('Error al importar insumos: ' + (err.message || ''), 'error');
    } finally {
        importingSupplies.value = false;
        e.target.value = '';
    }
}

function exportRecipes() {
    window.open('/api/inventory/recipes/export', '_blank');
}

async function onImportRecipes(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
        toast('Por favor selecciona un archivo CSV', 'error');
        return;
    }
    importingRecipes.value = true;
    try {
        const res = await importRecipesCSV(file);
        toast(res.message || 'Recetas importadas correctamente', 'success');
        await loadRecipes();
    } catch (err) {
        console.error(err);
        toast('Error al importar recetas: ' + (err.message || ''), 'error');
    } finally {
        importingRecipes.value = false;
        e.target.value = '';
    }
}

function handleInventorySync() {
    loadSupplies();
    if (activeSubtab.value === 'kardex') loadKardex();
}

function handleRecipesSync() {
    loadRecipes();
}

onMounted(() => {
    if (localStorage.getItem('pos_token')) {
        loadSupplies();
    }

    if (window.socket) {
        window.socket.on('inventory_updated', handleInventorySync);
        window.socket.on('supplies_updated', handleInventorySync);
        window.socket.on('recipe_saved', handleRecipesSync);
        window.socket.on('recipe_deleted', handleRecipesSync);
        window.socket.on('recipe_updated', handleRecipesSync);
    }
    window.addEventListener('inventory-refresh', handleInventorySync);
    window.addEventListener('recipes-refresh', handleRecipesSync);
    window.addEventListener('keydown', handleEscapeKey);
    window.addEventListener('app:escape', handleAppEscape);
});

onUnmounted(() => {
    if (window.socket) {
        window.socket.off('inventory_updated', handleInventorySync);
        window.socket.off('supplies_updated', handleInventorySync);
        window.socket.off('recipe_saved', handleRecipesSync);
        window.socket.off('recipe_deleted', handleRecipesSync);
        window.socket.off('recipe_updated', handleRecipesSync);
    }
    window.removeEventListener('inventory-refresh', handleInventorySync);
    window.removeEventListener('recipes-refresh', handleRecipesSync);
    window.removeEventListener('keydown', handleEscapeKey);
    window.removeEventListener('app:escape', handleAppEscape);
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
        <div class="w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1 custom-scroll">
            <div class="inline-flex bg-gray-100/90 p-1 rounded-xl text-xs font-semibold gap-1.5 flex-nowrap min-w-max">
                <button type="button" @click="switchSubtab('stock')" class="whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'stock' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-boxes-stacked"></i><span>Insumos y Stock</span></button>
                <button type="button" @click="switchSubtab('kardex')" class="whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'kardex' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-history text-xs"></i><span>Kárdex / Movimientos</span></button>
                <button type="button" @click="switchSubtab('recipes')" class="whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer" :class="activeSubtab === 'recipes' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'"><i class="fas fa-book-open text-xs"></i><span>Recetas de Platos</span></button>
            </div>
        </div>
        <div v-if="activeSubtab === 'stock'" class="flex items-center gap-2 flex-wrap">
            <input type="file" ref="fileSuppliesRef" id="file-import-supplies" accept=".csv" class="hidden" @change="onImportSupplies">
            <button type="button" @click="exportSupplies" class="px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Exportar insumos a CSV">
                <i class="fas fa-file-export text-gray-500"></i> Exportar
            </button>
            <button type="button" @click="$refs.fileSuppliesRef?.click()" :disabled="importingSupplies" class="px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Importar insumos desde CSV">
                <i class="fas" :class="importingSupplies ? 'fa-spinner fa-spin' : 'fa-file-import text-gray-500'"></i> Importar
            </button>
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
            <div @click="openStockAlertModal('low')" class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer transition-all hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5 active:scale-95 group select-none" title="Ver insumos con stock bajo">
                <div>
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <p class="text-[11px] font-bold text-gray-400 uppercase">Stock Bajo</p>
                        <span class="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md group-hover:bg-amber-100 transition-colors flex items-center gap-1">Ver <i class="fas fa-arrow-right text-[7px]"></i></span>
                    </div>
                    <h3 class="text-2xl font-black text-amber-500">{{ summary.low_stock || 0 }}</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-lg transition-transform group-hover:scale-105 shadow-2xs">
                    <i class="fas fa-exclamation-triangle text-amber-500" style="color: #f59e0b !important;"></i>
                </div>
            </div>
            <div @click="openStockAlertModal('out')" class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between cursor-pointer transition-all hover:border-red-400 hover:shadow-md hover:-translate-y-0.5 active:scale-95 group select-none" title="Ver insumos agotados">
                <div>
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <p class="text-[11px] font-bold text-gray-400 uppercase">Agotados</p>
                        <span class="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md group-hover:bg-red-100 transition-colors flex items-center gap-1">Ver <i class="fas fa-arrow-right text-[7px]"></i></span>
                    </div>
                    <h3 class="text-2xl font-black text-red-500">{{ summary.out_of_stock || 0 }}</h3>
                </div>
                <div class="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-lg transition-transform group-hover:scale-105 shadow-2xs">
                    <i class="fas fa-times-circle text-red-500" style="color: #ef4444 !important;"></i>
                </div>
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
                            <td colspan="8" class="text-center py-10 text-gray-400">{{ suppliesSearch ? 'No se encontraron insumos con ese nombre.' : 'Aún no has registrado insumos. Haz clic en "Nuevo Insumo".' }}</td>
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
                            <td colspan="7" class="text-center py-10 text-gray-400">No se encontraron movimientos registrados con los filtros actuales.</td>
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
            <div class="flex items-center gap-2 flex-wrap shrink-0">
                <input type="file" ref="fileRecipesRef" id="file-import-recipes" accept=".csv" class="hidden" @change="onImportRecipes">
                <button type="button" @click="exportRecipes" class="px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Exportar recetas a CSV">
                    <i class="fas fa-file-export text-gray-500"></i> Exportar
                </button>
                <button type="button" @click="$refs.fileRecipesRef?.click()" :disabled="importingRecipes" class="px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Importar recetas desde CSV">
                    <i class="fas" :class="importingRecipes ? 'fa-spinner fa-spin' : 'fa-file-import text-gray-500'"></i> Importar
                </button>
                <button type="button" @click="newRecipe" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"><i class="fas fa-plus"></i> Crear / Editar Receta</button>
            </div>
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
                            <td colspan="8" class="text-center py-10 text-gray-400">Aún no has creado recetas para tus platos. Haz clic en "Crear / Editar Receta" para empezar.</td>
                        </tr>
                        <tr v-for="r in recipes" :key="r.id" class="hover:bg-gray-50/80 transition-colors">
                            <td class="p-3.5">
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <span class="font-bold text-gray-900">{{ r.product_name || r.name }}</span>
                                    <span v-if="r.variant_name" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                        <i class="fas fa-layer-group text-[9px] mr-1"></i>{{ r.variant_name }}
                                    </span>
                                </div>
                                <span v-if="r.yield > 1" class="text-[10px] text-gray-400 block mt-0.5">Rinde {{ r.yield }} porciones</span>
                            </td>
                            <td class="p-3.5 text-gray-500">{{ r.product_category || 'Sin categoría' }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-gray-800">{{ formatMoney(r.effective_price ?? r.product_price ?? 0) }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-orange-600">{{ formatMoney(r.total_cost || 0) }}</td>
                            <td class="p-3.5 text-right font-mono font-bold text-emerald-600">{{ formatMoney(r.margin || 0) }}</td>
                            <td class="p-3.5 text-center"><span class="px-2 py-0.5 rounded-full text-[11px]" :class="recipePctClass(r)">{{ r.food_cost_pct || 0 }}%</span></td>
                            <td class="p-3.5 max-w-[280px]">
                                <div v-if="(r.items || []).length > 0" class="flex flex-wrap items-center gap-1 max-h-[46px] overflow-hidden">
                                    <span v-for="(i, idx) in (r.items || []).slice(0, 3)" :key="idx" class="inline-flex items-center bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-[10px] leading-tight shrink-0">
                                        {{ i.supply_name }}: {{ i.quantity }} {{ i.unit || i.recipe_unit || i.supply_unit }}
                                    </span>
                                    <span v-if="(r.items || []).length > 3" 
                                          @click.stop="viewRecipe(r)" 
                                          class="inline-flex items-center bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200/80 rounded px-1.5 py-0.5 text-[10px] font-bold cursor-pointer transition-colors leading-tight shrink-0" 
                                          title="Clic para ver todos los ingredientes">
                                        ... (+{{ r.items.length - 3 }} más)
                                    </span>
                                </div>
                                <span v-else class="text-gray-400 italic text-[11px]">Sin ingredientes</span>
                            </td>
                            <td class="p-3.5 text-center">
                                <div class="relative inline-block text-left table-action-container">
                                    <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Más Acciones">
                                        <i class="fas fa-ellipsis-v text-xs"></i>
                                    </button>
                                    <div class="table-action-menu hidden absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                        <button type="button" @click="viewRecipe(r)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                                            <i class="fas fa-eye w-4 text-center"></i> <span>Ver Receta</span>
                                        </button>
                                        <button type="button" @click="editRecipe(r)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-orange-600 hover:bg-orange-50 transition-colors">
                                            <i class="fas fa-edit w-4 text-center"></i> <span>Editar Receta</span>
                                        </button>
                                        <button type="button" @click="deleteRecipeItem(r)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors">
                                            <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Receta</span>
                                        </button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- MODAL: VER DETALLE COMPLETO DE RECETA (FICHA TÉCNICA) -->
    <Teleport to="body">
        <div v-if="selectedRecipeForView" 
             class="fixed inset-0 top-0 left-0 right-0 bottom-0 w-screen h-screen bg-black/60 z-[100] flex justify-center items-center p-3 sm:p-6 md:p-8 backdrop-blur-xs fade-in overflow-y-auto"
             style="margin: 0;"
             @click.self="closeViewRecipeModal">
            <div class="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] max-h-[90dvh] flex flex-col overflow-hidden border border-gray-100 scale-in my-auto">
                
                <!-- Header -->
                <div class="p-4 sm:px-8 py-4 sm:py-6 bg-gradient-to-r from-orange-50/80 via-white to-amber-50/50 border-b border-gray-100 flex items-center justify-between gap-4 shrink-0">
                    <div class="flex items-center gap-3.5">
                        <div class="w-12 h-12 rounded-2xl bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-xl shadow-sm font-bold shrink-0">
                            <i class="fas fa-book-open"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <h3 class="font-extrabold text-lg sm:text-xl text-gray-900 leading-tight">
                                    {{ selectedRecipeForView.product_name || selectedRecipeForView.name }}
                                </h3>
                                <span v-if="selectedRecipeForView.variant_name" class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                    <i class="fas fa-layer-group text-[9px] mr-1"></i>{{ selectedRecipeForView.variant_name }}
                                </span>
                                <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">
                                    {{ selectedRecipeForView.product_category || 'Sin categoría' }}
                                </span>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">
                                <span class="font-medium text-gray-700">Rendimiento:</span> 
                                {{ selectedRecipeForView.yield > 1 ? selectedRecipeForView.yield + ' porciones' : '1 porción' }}
                            </p>
                        </div>
                    </div>
                    <button type="button" @click="closeViewRecipeModal" class="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer shrink-0">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <!-- Body con más padding y holgura -->
                <div class="p-4 sm:p-8 overflow-y-auto space-y-6 flex-1 min-h-0 custom-scroll overscroll-contain">
                    
                    <!-- KPI Cards de Rentabilidad / Escandallo -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                        <div class="bg-gray-50 p-4 rounded-2xl border border-gray-100 text-center">
                            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Precio Venta</p>
                            <p class="text-base font-extrabold text-gray-900 font-mono">
                                {{ formatMoney(selectedRecipeForView.effective_price ?? selectedRecipeForView.product_price ?? 0) }}
                            </p>
                        </div>
                        <div class="bg-orange-50/70 p-4 rounded-2xl border border-orange-100 text-center">
                            <p class="text-[10px] font-bold text-orange-600 uppercase tracking-wider mb-1">Costo Receta</p>
                            <p class="text-base font-extrabold text-orange-700 font-mono">
                                {{ formatMoney(selectedRecipeForView.total_cost || 0) }}
                            </p>
                        </div>
                        <div class="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-100 text-center">
                            <p class="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1">Margen Bruto</p>
                            <p class="text-base font-extrabold text-emerald-700 font-mono">
                                {{ formatMoney(selectedRecipeForView.margin || 0) }}
                            </p>
                        </div>
                        <div class="bg-blue-50/70 p-4 rounded-2xl border border-blue-100 text-center">
                            <p class="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">% Food Cost</p>
                            <div class="inline-block px-2.5 py-0.5 rounded-full text-xs font-black" :class="recipePctClass(selectedRecipeForView)">
                                {{ selectedRecipeForView.food_cost_pct || 0 }}%
                            </div>
                        </div>
                    </div>

                    <!-- Tabla de Ingredientes e Insumos -->
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="font-bold text-sm text-gray-800 flex items-center gap-2">
                                <i class="fas fa-carrot text-orange-500"></i>
                                Ingredientes e Insumos Requeridos
                                <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                    {{ (selectedRecipeForView.items || []).length }} insumos
                                </span>
                            </h4>
                        </div>

                        <div class="rounded-2xl border border-gray-100 overflow-scroll bg-white shadow-2xs">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-gray-50/90 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                                    <tr>
                                        <th class="py-3 px-4">Insumo</th>
                                        <th class="py-3 px-4 text-right">Cantidad</th>
                                        <th class="py-3 px-4 text-right">Costo Unit.</th>
                                        <th class="py-3 px-4 text-right">Subtotal Costo</th>
                                        <th class="py-3 px-4 text-center">Stock Almacén</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-50">
                                    <tr v-if="(!selectedRecipeForView.items || selectedRecipeForView.items.length === 0)">
                                        <td colspan="5" class="text-center py-6 text-gray-400 italic">No hay ingredientes vinculados a esta receta.</td>
                                    </tr>
                                    <tr v-for="(item, idx) in selectedRecipeForView.items" :key="idx" class="hover:bg-gray-50/60 transition-colors">
                                        <td class="py-3.5 px-4">
                                            <div class="font-bold text-gray-800">{{ item.supply_name }}</div>
                                        </td>
                                        <td class="py-3.5 px-4 text-right font-mono font-semibold text-gray-700">
                                            {{ item.quantity }} <span class="text-[10px] text-gray-400">{{ item.unit || item.recipe_unit || item.supply_unit }}</span>
                                        </td>
                                        <td class="py-3.5 px-4 text-right font-mono text-gray-500">
                                            {{ formatMoney(item.cost_per_unit || 0) }} / {{ item.supply_unit }}
                                        </td>
                                        <td class="py-3.5 px-4 text-right font-mono font-bold text-orange-600">
                                            {{ formatMoney(item.item_cost || 0) }}
                                        </td>
                                        <td class="py-3.5 px-4 text-center font-mono">
                                            <span class="inline-flex items-center gap-1 text-[11px] font-semibold"
                                                  :class="(item.current_stock ?? 0) <= 0 ? 'text-red-500' : ((item.current_stock ?? 0) <= 5 ? 'text-amber-500' : 'text-emerald-600')">
                                                <i class="fas fa-circle text-[6px]"></i>
                                                {{ item.current_stock ?? 0 }} {{ item.supply_unit }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Instrucciones de Preparación / Notas del Chef -->
                    <div>
                        <h4 class="font-bold text-sm text-gray-800 mb-2.5 flex items-center gap-2">
                            <i class="fas fa-clipboard-list text-blue-500"></i>
                            Instrucciones y Procedimiento de Preparación
                        </h4>
                        <div class="p-2 bg-gray-50 rounded-2xl border border-gray-100 text-xs text-gray-700 leading-relaxed whitespace-pre-line">
                            <p v-if="selectedRecipeForView.instructions && selectedRecipeForView.instructions.trim()">
                                {{ selectedRecipeForView.instructions }}
                            </p>
                            <p v-else class="text-gray-400 italic">
                                No se han registrado notas o instrucciones especiales de preparación para este plato. Puedes agregarlas haciendo clic en "Editar Receta".
                            </p>
                        </div>
                    </div>

                </div>

                <!-- Footer -->
                <div class="px-6 sm:px-8 py-4 sm:py-5 bg-gray-50/80 border-t border-gray-100 flex items-center justify-between gap-3 shrink-0">
                    <button type="button" 
                            @click="editRecipeFromView" 
                            class="px-4 py-2.5 rounded-xl text-xs font-bold bg-white hover:bg-orange-50 text-orange-600 border border-orange-200 transition-all flex items-center gap-2 shadow-2xs cursor-pointer">
                        <i class="fas fa-edit"></i> Editar Receta
                    </button>
                    <button type="button" 
                            @click="closeViewRecipeModal" 
                            class="btn-system-primary px-6 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer">
                        Entendido
                    </button>
                </div>

            </div>
        </div>
    </Teleport>

    <!-- Modal de Insumos con Stock Bajo o Agotados -->
    <Teleport to="body">
        <div v-if="stockAlertModalType" 
             id="modal-stock-alerts"
             class="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
             @click.self="closeStockAlertModal">
            <div class="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scale-up">
                
                <!-- Modal Header -->
                <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4"
                     :class="stockAlertModalType === 'low' ? 'bg-amber-50/70' : (stockAlertModalType === 'out' ? 'bg-red-50/70' : (stockAlertModalType === 'alert' ? 'bg-orange-50/70' : 'bg-gray-50/80'))">
                    <div class="flex items-center gap-3.5">
                        <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-lg shadow-xs shrink-0"
                             :style="stockAlertModalType === 'low' ? 'background-color: #fef3c7; color: #d97706;' : (stockAlertModalType === 'out' ? 'background-color: #fee2e2; color: #dc2626;' : (stockAlertModalType === 'alert' ? 'background-color: #ffedd5; color: #ea580c;' : 'background-color: #f3f4f6; color: #374151;'))">
                            <i class="fas" :class="stockAlertModalType === 'low' ? 'fa-triangle-exclamation' : (stockAlertModalType === 'out' ? 'fa-circle-xmark' : (stockAlertModalType === 'alert' ? 'fa-bell' : 'fa-boxes-stacked'))"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="text-base sm:text-lg font-black text-gray-900 tracking-tight">
                                    {{ stockAlertModalType === 'low' ? 'Insumos con Stock Bajo' : (stockAlertModalType === 'out' ? 'Insumos Agotados' : (stockAlertModalType === 'alert' ? 'Insumos en Alerta' : 'Todos los Insumos')) }}
                                </h3>
                                <span class="px-2.5 py-0.5 rounded-full text-xs font-black shadow-xs"
                                      :class="stockAlertModalType === 'low' ? 'bg-amber-200/80 text-amber-900' : (stockAlertModalType === 'out' ? 'bg-red-200/80 text-red-900' : (stockAlertModalType === 'alert' ? 'bg-orange-200/80 text-orange-900' : 'bg-gray-200 text-gray-800'))">
                                    {{ alertSuppliesList.length }} {{ alertSuppliesList.length === 1 ? 'insumo' : 'insumos' }}
                                </span>
                            </div>
                            <p class="text-xs text-gray-500 mt-0.5">
                                {{ stockAlertModalType === 'low' 
                                    ? 'Insumos cuya existencia actual es igual o inferior al stock mínimo configurado.' 
                                    : (stockAlertModalType === 'out' 
                                        ? 'Insumos sin existencia disponible en inventario (Stock = 0).' 
                                        : (stockAlertModalType === 'alert' 
                                            ? 'Listado consolidado de insumos agotados y con stock bajo.' 
                                            : 'Catálogo completo de todos los insumos registrados.')) }}
                            </p>
                        </div>
                    </div>
                    <button type="button" 
                            @click="closeStockAlertModal" 
                            class="w-9 h-9 rounded-xl bg-white/80 hover:bg-white text-gray-400 hover:text-gray-700 transition-all flex items-center justify-center border border-gray-200 shadow-2xs cursor-pointer">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <!-- Tabs & Quick Search in Modal -->
                <div class="px-6 py-3 bg-gray-50 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <!-- Selector de Pestañas / Filtros -->
                    <div class="inline-flex bg-gray-200/80 p-1 rounded-xl text-xs font-bold gap-1 flex-wrap">
                        <button type="button" @click="stockAlertModalType = 'alert'"
                                :class="stockAlertModalType === 'alert' ? 'bg-white text-orange-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'"
                                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5">
                            <i class="fas fa-bell text-[11px]"></i>
                            <span>En Alerta ({{ countAlertStock }})</span>
                        </button>
                        <button type="button" @click="stockAlertModalType = 'low'"
                                :class="stockAlertModalType === 'low' ? 'bg-white text-amber-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'"
                                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5">
                            <i class="fas fa-triangle-exclamation text-[11px]"></i>
                            <span>Stock Bajo ({{ countLowStock }})</span>
                        </button>
                        <button type="button" @click="stockAlertModalType = 'out'"
                                :class="stockAlertModalType === 'out' ? 'bg-white text-red-600 shadow-xs' : 'text-gray-600 hover:text-gray-900'"
                                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5">
                            <i class="fas fa-circle-xmark text-[11px]"></i>
                            <span>Agotados ({{ countOutOfStock }})</span>
                        </button>
                        <button type="button" @click="stockAlertModalType = 'all'"
                                :class="stockAlertModalType === 'all' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-600 hover:text-gray-900'"
                                class="px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5">
                            <i class="fas fa-boxes-stacked text-[11px]"></i>
                            <span>Todos ({{ supplies.length }})</span>
                        </button>
                    </div>

                    <!-- Buscador interno -->
                    <div class="relative flex-1 max-w-xs">
                        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input v-model="stockAlertSearch" 
                               type="text" 
                               placeholder="Buscar en esta lista..." 
                               class="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-xl text-xs outline-none focus:border-orange-500 bg-white transition-colors">
                    </div>
                </div>

                <!-- Table Content -->
                <div class="p-6 overflow-y-auto flex-1 custom-scrollbar">
                    <div v-if="alertSuppliesList.length === 0" class="py-12 text-center">
                        <div class="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center text-2xl mx-auto mb-3">
                            <i class="fas fa-check-circle"></i>
                        </div>
                        <h4 class="text-base font-bold text-gray-800">
                            {{ stockAlertSearch ? 'No se encontraron insumos que coincidan' : (stockAlertModalType === 'low' ? 'No hay insumos con stock bajo' : (stockAlertModalType === 'out' ? 'No hay insumos agotados' : 'No hay insumos en alerta')) }}
                        </h4>
                        <p class="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                            {{ stockAlertSearch ? 'Prueba con otro término de búsqueda.' : 'Todos los insumos se encuentran en niveles adecuados de inventario.' }}
                        </p>
                        <div v-if="!stockAlertSearch && stockAlertModalType !== 'all'" class="mt-4">
                            <button type="button" @click="stockAlertModalType = 'all'" class="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer inline-flex items-center gap-2 shadow-2xs">
                                <i class="fas fa-boxes-stacked text-gray-500"></i> Ver todos los insumos registrados ({{ supplies.length }})
                            </button>
                        </div>
                    </div>

                    <div v-else class="overflow-hidden border border-gray-100 rounded-2xl shadow-2xs">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100">
                                <tr>
                                    <th class="p-3.5">Insumo</th>
                                    <th class="p-3.5">Unidad</th>
                                    <th class="p-3.5 text-right">Stock Actual</th>
                                    <th class="p-3.5 text-right">Stock Mínimo</th>
                                    <th class="p-3.5 text-right">Costo Unit.</th>
                                    <th class="p-3.5 text-center">Estado</th>
                                    <th class="p-3.5 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-50">
                                <tr v-for="s in alertSuppliesList" :key="s.id" class="hover:bg-gray-50/70 transition-colors">
                                    <td class="p-3.5 font-bold text-gray-800">{{ s.name }}</td>
                                    <td class="p-3.5 text-gray-500 font-medium">{{ s.unit }}</td>
                                    <td class="p-3.5 text-right font-mono font-bold" :class="stockColorClass(s)">
                                        {{ s.current_stock }} <span class="text-[10px] text-gray-400 font-normal">{{ s.unit }}</span>
                                    </td>
                                    <td class="p-3.5 text-right font-mono text-gray-500">
                                        {{ s.min_stock }} <span class="text-[10px] text-gray-400 font-normal">{{ s.unit }}</span>
                                    </td>
                                    <td class="p-3.5 text-right font-mono text-gray-700">{{ formatMoney(s.cost_per_unit) }}</td>
                                    <td class="p-3.5 text-center">
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="supplyStatusClass(s)">
                                            {{ supplyStatusLabel(s) }}
                                        </span>
                                    </td>
                                    <td class="p-3.5 text-center">
                                        <div class="flex items-center justify-center gap-1.5">
                                            <button type="button" 
                                                    @click="adjustSupplyFromAlert(s)" 
                                                    class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs" 
                                                    title="Ajustar Stock de este insumo">
                                                <i class="fas fa-arrows-rotate text-[11px]"></i>
                                                <span>Ajustar</span>
                                            </button>
                                            <button type="button" 
                                                    @click="editSupplyFromAlert(s)" 
                                                    class="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs" 
                                                    title="Editar Insumo">
                                                <i class="fas fa-edit text-[11px]"></i>
                                                <span>Editar</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Footer -->
                <div class="px-6 py-4 bg-gray-50/80 border-t border-gray-100 flex items-center justify-end gap-3">
                    <button type="button" 
                            @click="closeStockAlertModal" 
                            class="btn-system-primary px-6 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 shadow-sm cursor-pointer">
                        Cerrar
                    </button>
                </div>

            </div>
        </div>
    </Teleport>
</template>
