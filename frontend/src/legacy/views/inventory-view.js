import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, showConfirmModal, showModalAlert } from '../components/ui.js';
import {
    getInventorySummary,
    getSupplies,
    createSupply,
    updateSupply,
    adjustSupplyStock,
    deleteSupply,
    getRecipes,
    getRecipeByProduct,
    saveRecipe,
    deleteRecipe,
    getInventoryMovements
} from '../services/inventory-service.js';

let _suppliesCache = [];
let _recipesCache = [];
let _searchSuppliesTerm = '';
let _currentRecipeItems = []; // [{ supply_id, quantity }]

// Estado de Kárdex y Pestañas
let _currentSuppliesSubtab = 'stock'; // 'stock' | 'kardex'
let _kardexMovementsCache = [];
let _kardexSearchTerm = '';
let _kardexTypeFilter = 'ALL';
let _kardexCurrentPage = 1;
const KARDEX_PAGE_SIZE = 15;

// ========================================================
// RENDER: PÁGINA DE INSUMOS
// ========================================================
export async function renderAdminSuppliesPage() {
    try {
        // Cargar resumen KPI y lista de insumos en paralelo
        const [summary, supplies] = await Promise.all([
            getInventorySummary().catch(() => null),
            getSupplies().catch(() => [])
        ]);

        if (summary) {
            if ($('stat-total-supplies')) $('stat-total-supplies').textContent = summary.total_supplies || 0;
            if ($('stat-low-supplies')) $('stat-low-supplies').textContent = summary.low_stock || 0;
            if ($('stat-out-supplies')) $('stat-out-supplies').textContent = summary.out_of_stock || 0;
            if ($('stat-value-supplies')) $('stat-value-supplies').textContent = formatMoney(summary.total_value || 0);
        }

        _suppliesCache = supplies || [];
        renderSuppliesTable();
    } catch (err) {
        console.error('Error cargando insumos:', err);
        toast('Error al cargar insumos', 'error');
    }
}

function renderSuppliesTable() {
    const tbody = $('supplies-table-body');
    if (!tbody) return;

    let filtered = _suppliesCache;
    if (_searchSuppliesTerm.trim()) {
        const term = _searchSuppliesTerm.toLowerCase();
        filtered = filtered.filter(s => s.name.toLowerCase().includes(term));
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-10 text-gray-400">
                    ${_searchSuppliesTerm ? 'No se encontraron insumos con ese nombre.' : 'Aún no has registrado insumos. Haz clic en "Nuevo Insumo".'}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map(s => {
        const isOutOfStock = s.current_stock <= 0;
        const isLowStock = !isOutOfStock && s.current_stock <= s.min_stock;

        let statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">Óptimo</span>`;
        if (isOutOfStock) {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 animate-pulse">Agotado</span>`;
        } else if (isLowStock) {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">Stock Bajo</span>`;
        }

        const stockColor = isOutOfStock ? 'text-red-600 font-bold' : (isLowStock ? 'text-amber-600 font-bold' : 'text-gray-800');

        return `
            <tr class="hover:bg-gray-50/80 transition-colors">
                <td class="p-3.5 font-bold text-gray-800">${escapeHtml(s.name)}</td>
                <td class="p-3.5 text-gray-500 font-medium">${escapeHtml(s.unit)}</td>
                <td class="p-3.5 text-right font-mono ${stockColor}">${s.current_stock} <span class="text-[10px] text-gray-400">${escapeHtml(s.unit)}</span></td>
                <td class="p-3.5 text-right font-mono text-gray-500">${s.min_stock} <span class="text-[10px] text-gray-400">${escapeHtml(s.unit)}</span></td>
                <td class="p-3.5 text-right font-mono text-gray-700">${formatMoney(s.cost_per_unit)}</td>
                <td class="p-3.5 text-right font-mono font-bold text-emerald-600">${formatMoney(s.total_cost || 0)}</td>
                <td class="p-3.5 text-center">${statusBadge}</td>
                <td class="p-3.5 text-center">
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" onclick="window.openAdjustSupplyModal('${s.id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                                <i class="fas fa-arrows-rotate w-4 text-center"></i> <span>Ajustar Stock</span>
                            </button>
                            <button type="button" onclick="window.openEditSupplyModal('${s.id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Insumo</span>
                            </button>
                            <button type="button" onclick="window.deleteSupplyItem('${s.id}', '${escapeHtml(s.name)}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Insumo</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ========================================================
// RENDER: PÁGINA DE RECETAS
// ========================================================
export async function renderAdminRecipesPage() {
    try {
        const recipes = await getRecipes();
        _recipesCache = recipes || [];
        renderRecipesTable();
    } catch (err) {
        console.error('Error cargando recetas:', err);
        toast('Error al cargar recetas', 'error');
    }
}

function renderRecipesTable() {
    const tbody = $('recipes-table-body');
    if (!tbody) return;

    if (_recipesCache.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-10 text-gray-400">
                    <i class="fas fa-book-open text-3xl mb-2 text-gray-300 block"></i>
                    Aún no has creado recetas para tus platos. Haz clic en "Crear / Editar Receta" para empezar.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = _recipesCache.map(r => {
        const items = r.items || [];
        const foodCostPct = r.food_cost_pct || 0;

        let pctBadgeClass = 'bg-emerald-100 text-emerald-800';
        if (foodCostPct > 40) {
            pctBadgeClass = 'bg-red-100 text-red-800 font-bold';
        } else if (foodCostPct > 32) {
            pctBadgeClass = 'bg-amber-100 text-amber-800 font-semibold';
        }

        const ingredientsSummary = items.map(i => 
            `<span class="inline-block bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-[10px] mr-1 mb-1">${escapeHtml(i.supply_name)}: ${i.quantity} ${escapeHtml(i.supply_unit)}</span>`
        ).join('');

        return `
            <tr class="hover:bg-gray-50/80 transition-colors">
                <td class="p-3.5">
                    <div class="font-bold text-gray-900">${escapeHtml(r.product_name || r.name)}</div>
                    ${r.yield > 1 ? `<span class="text-[10px] text-gray-400">Rinde ${r.yield} porciones</span>` : ''}
                </td>
                <td class="p-3.5 text-gray-500">${escapeHtml(r.product_category || 'Sin categoría')}</td>
                <td class="p-3.5 text-right font-mono font-bold text-gray-800">${formatMoney(r.product_price || 0)}</td>
                <td class="p-3.5 text-right font-mono font-bold text-orange-600">${formatMoney(r.total_cost || 0)}</td>
                <td class="p-3.5 text-right font-mono font-bold text-emerald-600">${formatMoney(r.margin || 0)}</td>
                <td class="p-3.5 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[11px] ${pctBadgeClass}">${foodCostPct}%</span>
                </td>
                <td class="p-3.5 max-w-xs">${ingredientsSummary || '<span class="text-gray-400 italic text-[11px]">Sin ingredientes</span>'}</td>
                <td class="p-3.5 text-center">
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" onclick="window.openEditRecipeModal('${r.product_id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-orange-600 hover:bg-orange-50 transition-colors">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Receta</span>
                            </button>
                            <button type="button" onclick="window.deleteRecipeItem('${r.id}', '${escapeHtml(r.product_name || r.name)}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Receta</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ========================================================
// LISTENERS & MODAL MANAGEMENT
// ========================================================
export function setupInventoryListeners() {
    // Buscador de insumos
    const searchInput = $('supplies-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            _searchSuppliesTerm = e.target.value;
            renderSuppliesTable();
        });
    }

    // Botón Nuevo Insumo
    const btnNewSupply = $('btn-new-supply');
    if (btnNewSupply) {
        btnNewSupply.onclick = () => {
            $('supply-modal-title').textContent = 'Nuevo Insumo / Alimento';
            $('s-id').value = '';
            $('s-name').value = '';
            $('s-unit').value = 'g';
            $('s-cost').value = '';
            $('s-stock').value = '0';
            $('s-min').value = '5';
            $('s-stock-container')?.classList.remove('hidden');
            $('supply-modal').classList.remove('hidden');
        };
    }

    // Cancelar modal insumo
    if ($('btn-cancel-supply')) {
        $('btn-cancel-supply').onclick = () => $('supply-modal').classList.add('hidden');
    }

    // Submit form insumo
    const supplyForm = $('supply-form');
    if (supplyForm) {
        supplyForm.onsubmit = async (e) => {
            e.preventDefault();
            const id = $('s-id').value;
            const data = {
                name: $('s-name').value,
                unit: $('s-unit').value,
                cost_per_unit: parseFloat($('s-cost').value) || 0,
                min_stock: parseFloat($('s-min').value) || 0
            };

            try {
                if (id) {
                    await updateSupply(id, data);
                    toast('Insumo actualizado con éxito', 'success');
                } else {
                    data.current_stock = parseFloat($('s-stock').value) || 0;
                    await createSupply(data);
                    toast('Insumo creado con éxito', 'success');
                }
                $('supply-modal').classList.add('hidden');
                renderAdminSuppliesPage();
            } catch (err) {
                showModalAlert('Error', err.message || 'Error guardando insumo', 'error');
            }
        };
    }

    // Cancelar modal ajuste
    if ($('btn-cancel-adjust')) {
        $('btn-cancel-adjust').onclick = () => $('adjust-supply-modal').classList.add('hidden');
    }

    // Submit form ajuste de stock
    const adjustForm = $('adjust-supply-form');
    if (adjustForm) {
        adjustForm.onsubmit = async (e) => {
            e.preventDefault();
            const id = $('adj-supply-id').value;
            const rawAmount = parseFloat($('adj-amount').value);
            const type = $('adj-type').value;
            const notes = $('adj-notes').value;

            if (isNaN(rawAmount) || rawAmount <= 0) {
                return toast('Ingresa una cantidad mayor a cero', 'error');
            }

            // Si es merma, se resta
            const amount = type === 'MERMA' ? -Math.abs(rawAmount) : Math.abs(rawAmount);

            try {
                await adjustSupplyStock(id, { amount, type, notes });
                toast('Stock ajustado exitosamente', 'success');
                $('adjust-supply-modal').classList.add('hidden');
                renderAdminSuppliesPage();
            } catch (err) {
                showModalAlert('Error', err.message || 'Error al ajustar stock', 'error');
            }
        };
    }

    // Botón Nueva Receta
    const btnNewRecipe = $('btn-new-recipe');
    if (btnNewRecipe) {
        btnNewRecipe.onclick = () => window.openEditRecipeModal();
    }

    // Cerrar modal receta
    if ($('btn-close-recipe-modal')) {
        $('btn-close-recipe-modal').onclick = () => $('recipe-modal').classList.add('hidden');
    }
    if ($('btn-cancel-recipe')) {
        $('btn-cancel-recipe').onclick = () => $('recipe-modal').classList.add('hidden');
    }

    // Botón añadir ingrediente a la receta
    const btnAddIng = $('btn-add-recipe-ingredient');
    if (btnAddIng) {
        btnAddIng.onclick = () => addRecipeIngredientRow();
    }

    // Listener de cambio de plato en modal receta para actualizar precio y cálculo
    const prodSelect = $('rec-product-id');
    if (prodSelect) {
        prodSelect.onchange = async (e) => {
            const prodId = e.target.value;
            if (!prodId) return;

            // Revisar si ya tiene receta existente para cargarla
            try {
                const res = await getRecipeByProduct(prodId);
                if (res?.exists && res.recipe) {
                    populateRecipeModal(res.recipe, prodId);
                } else {
                    _currentRecipeItems = [];
                    renderRecipeIngredientsList();
                    recalculateRecipeFinancials();
                }
            } catch (err) {
                console.error('Error buscando receta del plato:', err);
            }
        };
    }

    // Submit form receta
    const recipeForm = $('recipe-form');
    if (recipeForm) {
        recipeForm.onsubmit = async (e) => {
            e.preventDefault();
            const productId = $('rec-product-id').value;
            if (!productId) {
                return toast('Debes seleccionar un plato', 'error');
            }

            // Recolectar ingredientes de las filas del DOM
            const rows = document.querySelectorAll('.recipe-ingredient-row');
            const items = [];
            rows.forEach(row => {
                const supplyId = row.querySelector('.rec-supply-select').value;
                const qty = parseFloat(row.querySelector('.rec-supply-qty').value) || 0;
                if (supplyId && qty > 0) {
                    items.push({ supply_id: supplyId, quantity: qty });
                }
            });

            if (items.length === 0) {
                return toast('Debes añadir al menos un insumo con cantidad mayor a 0', 'error');
            }

            const data = {
                product_id: productId,
                yield: parseInt($('rec-yield').value, 10) || 1,
                instructions: $('rec-instructions').value,
                items
            };

            try {
                await saveRecipe(data);
                toast('Receta guardada exitosamente', 'success');
                $('recipe-modal').classList.add('hidden');
                renderAdminRecipesPage();
            } catch (err) {
                showModalAlert('Error', err.message || 'Error guardando receta', 'error');
            }
        };
    }

    // Sub-pestañas: Insumos vs Kárdex vs Recetas
    const btnTabStock = $('tab-btn-supplies-stock');
    const btnTabKardex = $('tab-btn-supplies-kardex');
    const btnTabRecipes = $('tab-btn-supplies-recipes');
    const viewStock = $('supplies-view-stock');
    const viewKardex = $('supplies-view-kardex');
    const viewRecipes = $('supplies-view-recipes');
    const topActions = $('supplies-top-actions');

    const activeClass = 'px-3.5 py-1.5 rounded-lg transition-all btn-system-primary text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer';
    const inactiveClass = 'px-3.5 py-1.5 rounded-lg transition-all text-gray-600 hover:text-gray-900 hover:bg-white flex items-center gap-1.5 cursor-pointer text-xs font-bold';

    window.switchSuppliesSubtab = (tab) => {
        _currentSuppliesSubtab = tab;
        if (btnTabStock) btnTabStock.className = tab === 'stock' ? activeClass : inactiveClass;
        if (btnTabKardex) btnTabKardex.className = tab === 'kardex' ? activeClass : inactiveClass;
        if (btnTabRecipes) btnTabRecipes.className = tab === 'recipes' ? activeClass : inactiveClass;

        if (viewStock) viewStock.classList.toggle('hidden', tab !== 'stock');
        if (viewKardex) viewKardex.classList.toggle('hidden', tab !== 'kardex');
        if (viewRecipes) viewRecipes.classList.toggle('hidden', tab !== 'recipes');

        if (topActions) topActions.classList.toggle('hidden', tab !== 'stock');

        if (tab === 'kardex') {
            loadAndRenderKardex();
        } else if (tab === 'recipes') {
            if (typeof renderAdminRecipesPage === 'function') {
                renderAdminRecipesPage();
            }
        }
    };

    if (btnTabStock) btnTabStock.onclick = () => window.switchSuppliesSubtab('stock');
    if (btnTabKardex) btnTabKardex.onclick = () => window.switchSuppliesSubtab('kardex');
    if (btnTabRecipes) btnTabRecipes.onclick = () => window.switchSuppliesSubtab('recipes');

    // Filtros de Kárdex
    const kardexSearch = $('kardex-search');
    if (kardexSearch) {
        kardexSearch.addEventListener('input', (e) => {
            _kardexSearchTerm = e.target.value.toLowerCase().trim();
            _kardexCurrentPage = 1;
            renderKardexTable();
        });
    }

    const kardexFilter = $('kardex-type-filter');
    if (kardexFilter) {
        kardexFilter.addEventListener('change', (e) => {
            _kardexTypeFilter = e.target.value;
            _kardexCurrentPage = 1;
            renderKardexTable();
        });
    }

    const btnRefreshKardex = $('btn-refresh-kardex');
    if (btnRefreshKardex) {
        btnRefreshKardex.onclick = () => loadAndRenderKardex();
    }

    // Paginación Kárdex (15 registros por página)
    const btnPrevKardex = $('btn-prev-kardex');
    if (btnPrevKardex) {
        btnPrevKardex.onclick = () => {
            if (_kardexCurrentPage > 1) {
                _kardexCurrentPage--;
                renderKardexTable();
            }
        };
    }

    const btnNextKardex = $('btn-next-kardex');
    if (btnNextKardex) {
        btnNextKardex.onclick = () => {
            _kardexCurrentPage++;
            renderKardexTable();
        };
    }

    // Si hay un botón btn-view-movements, dirigir a la sub-pestaña de kárdex
    const btnMovements = $('btn-view-movements');
    if (btnMovements) {
        btnMovements.onclick = () => window.switchSuppliesSubtab('kardex');
    }
}

// Cargar movimientos desde el backend
async function loadAndRenderKardex() {
    const tbody = $('kardex-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando movimientos del kárdex...</td></tr>`;

    try {
        const movements = await getInventoryMovements(1000);
        _kardexMovementsCache = movements || [];
        _kardexCurrentPage = 1;
        renderKardexTable();
    } catch (err) {
        console.error('Error cargando kárdex:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500">Error al cargar movimientos.</td></tr>`;
    }
}

// Renderizar la tabla de kárdex con paginación de 15 registros y filtros
function renderKardexTable() {
    const tbody = $('kardex-table-body');
    if (!tbody) return;

    let filtered = _kardexMovementsCache;

    // Filtro por tipo de movimiento
    if (_kardexTypeFilter && _kardexTypeFilter !== 'ALL') {
        filtered = filtered.filter(m => {
            if (_kardexTypeFilter === 'AJUSTE_MANUAL') {
                return m.type === 'AJUSTE_MANUAL' || m.type === 'AJUSTE' || m.type === 'AJUSTE_STOCK';
            }
            return m.type === _kardexTypeFilter;
        });
    }

    // Filtro por término de búsqueda
    if (_kardexSearchTerm) {
        filtered = filtered.filter(m => {
            const supply = (m.supply_name || '').toLowerCase();
            const notes = (m.notes || '').toLowerCase();
            const orderId = (m.order_id || '').toLowerCase();
            const user = (m.user_name || '').toLowerCase();
            return supply.includes(_kardexSearchTerm) ||
                   notes.includes(_kardexSearchTerm) ||
                   orderId.includes(_kardexSearchTerm) ||
                   user.includes(_kardexSearchTerm);
        });
    }

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / KARDEX_PAGE_SIZE));

    if (_kardexCurrentPage > totalPages) _kardexCurrentPage = totalPages;
    if (_kardexCurrentPage < 1) _kardexCurrentPage = 1;

    const startIndex = (_kardexCurrentPage - 1) * KARDEX_PAGE_SIZE;
    const endIndex = Math.min(startIndex + KARDEX_PAGE_SIZE, totalRecords);
    const pageData = filtered.slice(startIndex, endIndex);

    // Actualizar elementos de paginación
    const infoEl = $('kardex-records-info');
    if (infoEl) {
        infoEl.textContent = totalRecords === 0
            ? 'Mostrando 0 registros'
            : `Mostrando ${startIndex + 1} - ${endIndex} de ${totalRecords} movimientos`;
    }

    const indicatorEl = $('kardex-page-indicator');
    if (indicatorEl) {
        indicatorEl.textContent = `Página ${_kardexCurrentPage} de ${totalPages}`;
    }

    const btnPrev = $('btn-prev-kardex');
    if (btnPrev) btnPrev.disabled = (_kardexCurrentPage <= 1);

    const btnNext = $('btn-next-kardex');
    if (btnNext) btnNext.disabled = (_kardexCurrentPage >= totalPages);

    if (pageData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-10 text-gray-400">
                    <i class="fas fa-search text-3xl mb-2 text-gray-300 block"></i>
                    No se encontraron movimientos registrados con los filtros actuales.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = pageData.map(m => {
        let typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800"><i class="fas fa-sliders-h text-[9px] mr-1"></i>${escapeHtml(m.type)}</span>`;
        if (m.type === 'DESCUENTO_PEDIDO') {
            typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800"><i class="fas fa-arrow-up text-[9px] mr-1"></i>Salida Venta</span>`;
        } else if (m.type === 'ENTRADA_COMPRA') {
            typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-arrow-down text-[9px] mr-1"></i>Entrada Compra</span>`;
        } else if (m.type === 'MERMA') {
            typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800"><i class="fas fa-trash-alt text-[9px] mr-1"></i>Merma</span>`;
        } else if (m.type === 'REINTEGRO_ANULACION') {
            typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800"><i class="fas fa-undo text-[9px] mr-1"></i>Reintegro Anulación</span>`;
        } else if (m.type === 'AJUSTE_MANUAL' || m.type === 'AJUSTE') {
            typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800"><i class="fas fa-sliders-h text-[9px] mr-1"></i>Ajuste Manual</span>`;
        }

        const qtySign = m.quantity > 0 ? `+${m.quantity}` : `${m.quantity}`;
        const qtyColor = m.quantity > 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold';
        const dateStr = new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

        return `
            <tr class="hover:bg-gray-50/80 transition-colors">
                <td class="p-3 font-mono text-gray-500 text-xs">${dateStr}</td>
                <td class="p-3 font-bold text-gray-800 text-xs">${escapeHtml(m.supply_name || 'Insumo')}</td>
                <td class="p-3">${typeBadge}</td>
                <td class="p-3 text-right font-mono ${qtyColor} text-xs">${qtySign}</td>
                <td class="p-3 text-right font-mono text-gray-600 text-xs font-semibold">${m.stock_after ?? '-'}</td>
                <td class="p-3 text-gray-600 text-xs max-w-xs truncate" title="${escapeHtml(m.notes || m.order_id || '')}">${escapeHtml(m.notes || m.order_id || '-')}</td>
                <td class="p-3 text-gray-500 text-xs font-medium">${escapeHtml(m.user_name || 'Sistema')}</td>
            </tr>
        `;
    }).join('');
}

// ========================================================
// GLOBAL WINDOW HELPERS (Llamados desde HTML en onClick)
// ========================================================
// Keeps the legacy modal helpers in sync with the Vue InventoryPanel data.
window._setSuppliesCache = (s) => { _suppliesCache = s || []; };

window.openEditSupplyModal = (supplyId) => {
    const supply = _suppliesCache.find(s => s.id === supplyId);
    if (!supply) return;

    $('supply-modal-title').textContent = 'Editar Insumo';
    $('s-id').value = supply.id;
    $('s-name').value = supply.name;
    $('s-unit').value = supply.unit;
    $('s-cost').value = supply.cost_per_unit;
    $('s-min').value = supply.min_stock;
    // Ocultar stock actual en edición para forzar el uso del Kárdex/Ajuste
    $('s-stock-container')?.classList.add('hidden');

    $('supply-modal').classList.remove('hidden');
};

window.openAdjustSupplyModal = (supplyId) => {
    const supply = _suppliesCache.find(s => s.id === supplyId);
    if (!supply) return;

    $('adj-supply-id').value = supply.id;
    $('adj-supply-name').textContent = `${supply.name} (Stock actual: ${supply.current_stock} ${supply.unit})`;
    $('adj-amount').value = '';
    $('adj-notes').value = '';
    $('adjust-supply-modal').classList.remove('hidden');
};

window.deleteSupplyItem = (supplyId, supplyName) => {
    showConfirmModal(
        'Eliminar Insumo',
        `¿Estás seguro de eliminar el insumo "${supplyName}"? Solo podrá eliminarse si no forma parte de ninguna receta.`,
        async () => {
            try {
                await deleteSupply(supplyId);
                toast('Insumo eliminado', 'success');
                renderAdminSuppliesPage();
            } catch (err) {
                showModalAlert('No se puede eliminar', err.message || 'Error eliminando insumo', 'error');
            }
        }
    );
};

window.openEditRecipeModal = async (productId = null) => {
    // Cargar los insumos si no están en caché
    if (_suppliesCache.length === 0) {
        _suppliesCache = await getSupplies().catch(() => []);
    }

    // Poblar selector de platos con los productos de state.products
    const prodSelect = $('rec-product-id');
    const products = state.products || [];

    prodSelect.innerHTML = `<option value="">Selecciona un plato...</option>` + products.map(p => 
        `<option value="${p.id}" data-price="${p.price}" ${p.id === productId ? 'selected' : ''}>${escapeHtml(p.name)} (${formatMoney(p.price)})</option>`
    ).join('');

    $('recipe-modal-title').textContent = productId ? 'Editar Receta del Plato' : 'Crear / Editar Receta';
    $('rec-id').value = '';
    $('rec-instructions').value = '';
    $('rec-yield').value = '1';

    if (productId) {
        try {
            const res = await getRecipeByProduct(productId);
            if (res?.exists && res.recipe) {
                populateRecipeModal(res.recipe, productId);
            } else {
                _currentRecipeItems = [];
                renderRecipeIngredientsList();
                recalculateRecipeFinancials();
            }
        } catch (err) {
            console.error(err);
        }
    } else {
        _currentRecipeItems = [];
        renderRecipeIngredientsList();
        recalculateRecipeFinancials();
    }

    $('recipe-modal').classList.remove('hidden');
};

function populateRecipeModal(recipe, productId) {
    $('rec-id').value = recipe.id || '';
    $('rec-product-id').value = productId;
    $('rec-yield').value = recipe.yield || 1;
    $('rec-instructions').value = recipe.instructions || '';

    _currentRecipeItems = (recipe.items || []).map(i => ({
        supply_id: i.supply_id,
        quantity: i.quantity
    }));

    renderRecipeIngredientsList();
    recalculateRecipeFinancials();
}

function addRecipeIngredientRow(supplyId = '', quantity = '') {
    _currentRecipeItems.push({
        supply_id: supplyId,
        quantity: quantity || 1
    });
    renderRecipeIngredientsList();
    recalculateRecipeFinancials();
}

function renderRecipeIngredientsList() {
    const container = $('recipe-ingredients-list');
    if (!container) return;

    if (_currentRecipeItems.length === 0) {
        container.innerHTML = `<p class="text-center py-6 text-gray-400 text-xs">No hay insumos agregados. Haz clic en "Añadir Insumo".</p>`;
        return;
    }

    container.innerHTML = _currentRecipeItems.map((item, index) => {
        const supplyOptions = _suppliesCache.map(s => 
            `<option value="${s.id}" data-unit="${s.unit}" data-cost="${s.cost_per_unit}" ${s.id === item.supply_id ? 'selected' : ''}>
                ${escapeHtml(s.name)} (${formatMoney(s.cost_per_unit)}/${s.unit})
            </option>`
        ).join('');

        const selectedSupply = _suppliesCache.find(s => s.id === item.supply_id);
        const unitLabel = selectedSupply ? selectedSupply.unit : '-';

        return `
            <div class="recipe-ingredient-row flex items-center gap-2 bg-white p-2.5 rounded-xl border border-gray-200/70 shadow-sm" data-index="${index}">
                <div class="flex-1">
                    <select class="rec-supply-select w-full p-2 border border-gray-200 rounded-lg text-xs bg-white outline-none focus:border-orange-500 font-medium">
                        <option value="">Selecciona insumo...</option>
                        ${supplyOptions}
                    </select>
                </div>
                <div class="w-28 flex items-center gap-1">
                    <input type="number" step="any" min="0" value="${item.quantity}" placeholder="Cant."
                        class="rec-supply-qty w-full p-2 border border-gray-200 rounded-lg text-xs text-right font-bold outline-none focus:border-orange-500">
                    <span class="rec-supply-unit text-[10px] font-bold text-gray-400 w-8">${unitLabel}</span>
                </div>
                <button type="button" class="btn-remove-ing text-red-400 hover:text-red-600 p-2 text-sm transition-colors" title="Quitar">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
    }).join('');

    // Attach listeners a las filas
    container.querySelectorAll('.recipe-ingredient-row').forEach(row => {
        const index = parseInt(row.dataset.index, 10);
        const select = row.querySelector('.rec-supply-select');
        const qtyInput = row.querySelector('.rec-supply-qty');
        const removeBtn = row.querySelector('.btn-remove-ing');

        select.addEventListener('change', (e) => {
            const suppId = e.target.value;
            _currentRecipeItems[index].supply_id = suppId;
            const supp = _suppliesCache.find(s => s.id === suppId);
            row.querySelector('.rec-supply-unit').textContent = supp ? supp.unit : '-';
            recalculateRecipeFinancials();
        });

        qtyInput.addEventListener('input', (e) => {
            _currentRecipeItems[index].quantity = parseFloat(e.target.value) || 0;
            recalculateRecipeFinancials();
        });

        removeBtn.addEventListener('click', () => {
            _currentRecipeItems.splice(index, 1);
            renderRecipeIngredientsList();
            recalculateRecipeFinancials();
        });
    });
}

function recalculateRecipeFinancials() {
    let totalCost = 0;

    _currentRecipeItems.forEach(item => {
        const supp = _suppliesCache.find(s => s.id === item.supply_id);
        if (supp && item.quantity > 0) {
            totalCost += (supp.cost_per_unit * item.quantity);
        }
    });

    const prodSelect = $('rec-product-id');
    const selectedOption = prodSelect?.options[prodSelect.selectedIndex];
    const productPrice = selectedOption ? (parseFloat(selectedOption.dataset.price) || 0) : 0;
    const margin = productPrice - totalCost;
    const foodCostPct = productPrice > 0 ? ((totalCost / productPrice) * 100) : 0;

    if ($('rec-summary-cost')) $('rec-summary-cost').textContent = formatMoney(totalCost);
    if ($('rec-summary-price')) $('rec-summary-price').textContent = formatMoney(productPrice);
    if ($('rec-summary-margin')) $('rec-summary-margin').textContent = formatMoney(margin);
    if ($('rec-summary-pct')) $('rec-summary-pct').textContent = `${Math.round(foodCostPct * 10) / 10}%`;
}

window.deleteRecipeItem = (recipeId, recipeName) => {
    showConfirmModal(
        'Eliminar Receta',
        `¿Estás seguro de eliminar la receta de "${recipeName}"? El plato dejará de descontar insumos al venderse.`,
        async () => {
            try {
                await deleteRecipe(recipeId);
                toast('Receta eliminada', 'success');
                renderAdminRecipesPage();
            } catch (err) {
                showModalAlert('Error', err.message || 'Error eliminando receta', 'error');
            }
        }
    );
};
