<script setup>
import { ref, computed } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { importProductsCSV, importCategoriesCSV } from '@/legacy/services/product-service.js';
import { populateDishFormExtensions } from '@/legacy/features/toppings-manager.js';
import { toast } from '@/legacy/components/ui.js';

const activeSubtab = ref('dishes');
const prodSearch = ref('');
const productsPage = ref(1);
const categoriesPage = ref(1);
const PER_PAGE = 14;
const importingProducts = ref(false);
const importingCategories = ref(false);

const filteredProducts = computed(() => {
    const s = prodSearch.value.toLowerCase().trim();
    const list = state.products || [];
    if (!s) return list;
    return list.filter(p => (p.name || '').toLowerCase().includes(s));
});
const filteredCategories = computed(() => state.categories || []);

const productTotalPages = computed(() => Math.ceil(filteredProducts.value.length / PER_PAGE) || 1);
const categoryTotalPages = computed(() => Math.ceil(filteredCategories.value.length / PER_PAGE) || 1);

const productPageItems = computed(() => {
    const start = (productsPage.value - 1) * PER_PAGE;
    return filteredProducts.value.slice(start, start + PER_PAGE);
});
const categoryPageItems = computed(() => {
    const start = (categoriesPage.value - 1) * PER_PAGE;
    return filteredCategories.value.slice(start, start + PER_PAGE);
});

function isAvailable(p) { return p.available !== 0 && p.available !== false; }
function catName(p) {
    return (state.categories || []).find(c => c.id === p.category || c.name === p.category)?.name || p.category || 'General';
}
function productCount(c) {
    return (state.products || []).filter(p => p.category === c.id || p.category === c.name).length;
}

function onToggleRec(p, checked) { if (window.toggleProductRecommended) window.toggleProductRecommended(p.id, checked); }
function onTogglePromo(p, checked) { if (window.toggleProductPromo) window.toggleProductPromo(p.id, checked); }
function onToggleAvail(p, checked) { if (window.toggleProductAvailability) window.toggleProductAvailability(p.id, checked); }
function editProduct(p) {
    prodSearch.value = '';
    if (window.openEditProductModal) window.openEditProductModal(p.id);
}
function duplicateProduct(p) {
    prodSearch.value = '';
    if (window.openDuplicateProductModal) window.openDuplicateProductModal(p.id);
}
function deleteProduct(p) { if (window.deleteProductRow) window.deleteProductRow(p.id); }
function editCategory(c) { if (window.openEditCategoryModal) window.openEditCategoryModal(c.id, c.name); }
function deleteCategory(c) { if (window.deleteCategoryRow) window.deleteCategoryRow(c.id); }
function viewCategoryProducts(c) { if (window.openCategoryProductsModal) window.openCategoryProductsModal(c.id, c.name); }

function newProduct() {
    const $ = (id) => document.getElementById(id);
    if ($('p-id')) $('p-id').value = '';
    if ($('p-name')) $('p-name').value = '';
    if ($('p-desc')) $('p-desc').value = '';
    if ($('p-price')) $('p-price').value = '';
    const sel = $('p-cat');
    if (sel) sel.innerHTML = (state.categories || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const toggle = $('p-available');
    if (toggle) toggle.checked = true;
    if ($('p-delete-img')) $('p-delete-img').value = '';
    if ($('p-file')) $('p-file').value = '';
    if ($('btn-delete-img')) $('btn-delete-img').classList.add('hidden');
    const imgContainer = $('p-current-img-container');
    if (imgContainer) imgContainer.classList.add('hidden');
    if ($('btn-save-prod')) $('btn-save-prod').innerText = 'Guardar';
    if ($('product-modal')) $('product-modal').classList.remove('hidden');
    populateDishFormExtensions({});
}

function newCategory() {
    const $ = (id) => document.getElementById(id);
    if ($('cat-id')) $('cat-id').value = '';
    const form = $('cat-form');
    if (form) form.reset();
    if ($('btn-save-cat')) $('btn-save-cat').innerText = 'Guardar';
    if ($('cat-modal')) $('cat-modal').classList.remove('hidden');
}

function exportProducts() { window.open('/api/products/export', '_blank'); }
function exportCategories() { window.open('/api/categories/export', '_blank'); }

async function onImportProducts(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) { toast('Por favor selecciona un archivo CSV', 'error'); return; }
    importingProducts.value = true;
    try {
        const res = await importProductsCSV(file);
        toast(res.message || 'Productos importados correctamente', 'success');
    } catch (err) {
        console.error(err);
        toast('Error al importar productos', 'error');
    } finally {
        importingProducts.value = false;
        e.target.value = '';
    }
}
async function onImportCategories(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) { toast('Por favor selecciona un archivo CSV', 'error'); return; }
    importingCategories.value = true;
    try {
        const res = await importCategoriesCSV(file);
        toast(res.message || 'Categorías importadas correctamente', 'success');
    } catch (err) {
        console.error(err);
        toast('Error al importar categorías', 'error');
    } finally {
        importingCategories.value = false;
        e.target.value = '';
    }
}
</script>

<template>
    <!-- Sub-Tabs -->
    <div class="flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex-wrap gap-3">
        <div class="inline-flex bg-gray-100/90 p-1 rounded-xl text-xs font-semibold gap-1.5">
            <button type="button" @click="activeSubtab = 'dishes'; productsPage = 1"
                class="px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
                :class="activeSubtab === 'dishes' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'">
                <i class="fas fa-utensils"></i><span>Gestión de Platos</span>
            </button>
            <button type="button" @click="activeSubtab = 'categories'; categoriesPage = 1"
                class="px-3.5 py-1.5 rounded-lg transition-all text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                :class="activeSubtab === 'categories' ? 'btn-system-primary' : 'text-gray-600 hover:text-gray-900 hover:bg-white'">
                <i class="fas fa-tags text-xs"></i><span>Gestión de Categorías</span>
            </button>
        </div>
    </div>

    <!-- Dishes -->
    <div v-show="activeSubtab === 'dishes'" class="space-y-4">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
            <div class="relative w-full sm:w-64">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                <input v-model="prodSearch" type="text" placeholder="Buscar plato..."
                    class="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all text-sm">
            </div>
            <div class="flex gap-2 w-full sm:w-auto">
                <button type="button" @click="exportProducts" class="btn-import-export px-4 py-2.5 rounded-xl shadow-xs flex items-center gap-2 transition-transform hover:scale-105 justify-center text-xs cursor-pointer font-bold"><i class="fas fa-file-export"></i> Exportar</button>
                <button type="button" @click="$refs.prodFile.click()" class="btn-import-export px-4 py-2.5 rounded-xl shadow-xs flex items-center gap-2 transition-transform hover:scale-105 justify-center text-xs cursor-pointer font-bold">
                    <i v-if="importingProducts" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-file-import"></i> Importar
                </button>
                <input ref="prodFile" type="file" class="hidden" accept=".csv" @change="onImportProducts">
                <button type="button" @click="newProduct" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"><i class="fas fa-plus"></i> Nuevo Plato</button>
            </div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                        <th class="p-4">Plato y Categoría</th>
                        <th class="p-4">Precio</th>
                        <th class="p-4 text-center">Toppings / Variantes</th>
                        <th class="p-4 text-center">Recomendado</th>
                        <th class="p-4 text-center">Promoción</th>
                        <th class="p-4 text-center">Disponibilidad</th>
                        <th class="p-4 text-center">Acción</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-if="productPageItems.length === 0">
                        <td colspan="7" class="p-4 text-center text-gray-400">No hay platos.</td>
                    </tr>
                    <tr v-for="p in productPageItems" :key="p.id" class="border-b border-gray-50">
                        <td class="p-2 flex items-center gap-3">
                            <img :src="p.img || '/img/icon.png'" :alt="'Miniatura de ' + p.name" loading="lazy" class="w-9 h-9 rounded-lg bg-gray-100 object-cover shrink-0">
                            <div class="min-w-0">
                                <div class="font-bold text-gray-800 text-xs sm:text-sm truncate">{{ p.name }}</div>
                                <div class="text-[11px] text-gray-500 flex items-center gap-1 font-medium mt-0.5"><i class="fas fa-tag text-[9px] text-gray-400"></i> {{ catName(p) }}</div>
                            </div>
                        </td>
                        <td class="p-2 text-sm font-bold">
                            <div v-if="p.has_variants">
                                <span class="text-[10px] text-gray-400 font-bold block uppercase leading-none">Desde</span>
                                <span>{{ formatMoney(p.price) }}</span>
                            </div>
                            <span v-else>{{ formatMoney(p.price) }}</span>
                        </td>
                        <td class="p-2 text-center">
                            <span v-if="p.has_variants && p.has_toppings" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200" title="Tamaños y Adiciones">
                                <i class="fas fa-layer-group text-[8px]"></i> + <i class="fas fa-cookie-bite text-[8px]"></i>
                            </span>
                            <span v-else-if="p.has_variants" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200" title="Tamaños disponibles">
                                <i class="fas fa-layer-group text-[8px]"></i> Tamaños
                            </span>
                            <span v-else-if="p.has_toppings" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200" title="Adiciones">
                                <i class="fas fa-cookie-bite text-[8px]"></i> Toppings
                            </span>
                            <span v-else class="text-gray-300 text-xs">—</span>
                        </td>
                        <td class="p-2 text-center">
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="Boolean(p.is_recommended)" @change="onToggleRec(p, $event.target.checked)">
                                <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                            </label>
                        </td>
                        <td class="p-2 text-center">
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="Boolean(p.is_promo)" @change="onTogglePromo(p, $event.target.checked)">
                                <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                            </label>
                            <div v-if="p.is_promo && p.promo_price" class="text-[10px] font-bold text-red-500 mt-0.5"><span v-if="p.has_variants" class="text-[9px] text-gray-400 font-normal">Desde </span>{{ formatMoney(p.promo_price) }}</div>
                        </td>
                        <td class="p-2 text-center">
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" :checked="isAvailable(p)" @change="onToggleAvail(p, $event.target.checked)">
                                <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                            </label>
                        </td>
                        <td class="p-2 text-center align-middle">
                            <div class="relative inline-block text-left table-action-container">
                                <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                                <div class="table-action-menu hidden absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                    <button type="button" @click="editProduct(p)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar Plato</span></button>
                                    <button type="button" @click="duplicateProduct(p)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors"><i class="fas fa-copy w-4 text-center"></i> <span>Duplicar</span></button>
                                    <button type="button" @click="deleteProduct(p)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span></button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="flex justify-between items-center mt-4">
            <button type="button" @click="productsPage = Math.max(1, productsPage - 1)" :disabled="productsPage === 1" class="px-4 py-2 text-xs text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><i class="fas fa-chevron-left mr-1"></i> Anterior</button>
            <span class="text-xs text-gray-400">Página {{ productsPage }} de {{ productTotalPages }}</span>
            <button type="button" @click="productsPage = Math.min(productTotalPages, productsPage + 1)" :disabled="productsPage >= productTotalPages" class="px-4 py-2 text-xs text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Siguiente <i class="fas fa-chevron-right ml-1"></i></button>
        </div>
    </div>

    <!-- Categories -->
    <div v-show="activeSubtab === 'categories'" class="space-y-4">
        <div class="flex justify-end mb-4 gap-2">
            <button type="button" @click="exportCategories" class="btn-import-export px-4 py-2.5 rounded-xl shadow-xs flex items-center gap-2 transition-transform hover:scale-105 text-xs cursor-pointer font-bold"><i class="fas fa-file-export"></i> Exportar</button>
            <button type="button" @click="$refs.catFile.click()" class="btn-import-export px-4 py-2.5 rounded-xl shadow-xs flex items-center gap-2 transition-transform hover:scale-105 text-xs cursor-pointer font-bold">
                <i v-if="importingCategories" class="fas fa-spinner fa-spin"></i><i v-else class="fas fa-file-import"></i> Importar
            </button>
            <input ref="catFile" type="file" class="hidden" accept=".csv" @change="onImportCategories">
            <button type="button" @click="newCategory" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"><i class="fas fa-folder-plus"></i> Nueva Categoría</button>
        </div>
        <div class="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                    <tr><th class="p-4">Nombre</th><th class="p-4 text-center">Productos</th><th class="p-4 text-center">Acción</th></tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-if="categoryPageItems.length === 0">
                        <td colspan="3" class="py-2 px-4 text-center text-gray-400">No hay categorías.</td>
                    </tr>
                    <tr v-for="c in categoryPageItems" :key="c.id" class="border-b border-gray-50">
                        <td class="py-2 px-4">{{ c.name }}</td>
                        <td class="py-2 px-4 text-center">
                            <span class="text-sm font-semibold text-gray-600">{{ productCount(c) }}</span>
                            <button type="button" aria-label="Ver productos" class="ml-1.5 text-blue-500 hover:text-blue-700 transition-colors text-xs" :disabled="productCount(c) === 0" :style="productCount(c) === 0 ? 'opacity:0.3;cursor:not-allowed' : ''" @click="viewCategoryProducts(c)"><i class="fas fa-list"></i></button>
                        </td>
                        <td class="py-2 px-4 text-center">
                            <div class="relative inline-block text-left table-action-container">
                                <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                                <div class="table-action-menu hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                    <button type="button" @click="editCategory(c)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar</span></button>
                                    <button type="button" @click="deleteCategory(c)" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span></button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="flex justify-between items-center mt-4">
            <button type="button" @click="categoriesPage = Math.max(1, categoriesPage - 1)" :disabled="categoriesPage === 1" class="px-4 py-2 text-xs text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><i class="fas fa-chevron-left mr-1"></i> Anterior</button>
            <span class="text-xs text-gray-400">Página {{ categoriesPage }} de {{ categoryTotalPages }}</span>
            <button type="button" @click="categoriesPage = Math.min(categoryTotalPages, categoriesPage + 1)" :disabled="categoriesPage >= categoryTotalPages" class="px-4 py-2 text-xs text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">Siguiente <i class="fas fa-chevron-right ml-1"></i></button>
        </div>
    </div>
</template>
