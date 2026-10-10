/**
 * DigiRest - Toppings / Adiciones Management Feature
 * Handles Admin Toppings CRUD, Table rendering, Modal, Real-time Sync,
 * and the Dish Product Modal Toppings Configurator.
 */

import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, showConfirmModal } from '../components/ui.js';
import { getToppings, saveTopping, toggleTopping, deleteTopping, listenToToppings, getSuppliesForToppings } from '../services/toppings-service.js';

let _initialized = false;

/**
 * Initialize toppings feature, listeners, and socket sync
 */
export function initToppingsManager() {
    if (_initialized) return;
    _initialized = true;

    // Listeners for Admin Panel
    const btnNew = $('btn-new-topping');
    if (btnNew) {
        btnNew.addEventListener('click', () => openToppingModal());
    }

    const btnCancel = $('btn-cancel-topping');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => closeToppingModal());
    }

    const form = $('topping-form');
    if (form) {
        form.addEventListener('submit', handleSaveTopping);
    }

    const searchInput = $('topping-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderToppingsTable());
    }

    const groupFilter = $('topping-filter-group');
    if (groupFilter) {
        groupFilter.addEventListener('change', () => renderToppingsTable());
    }

    // Option C: Mode Switch and Supply Select Listeners
    $('t-has-inventory')?.addEventListener('change', (e) => {
        const container = $('t-inventory-fields-container');
        if (e.target.checked) {
            container?.classList.remove('hidden');
        } else {
            container?.classList.add('hidden');
        }
    });
    $('btn-mode-direct')?.addEventListener('click', () => setToppingInventoryMode('direct'));
    $('btn-mode-linked')?.addEventListener('click', () => setToppingInventoryMode('linked_supply'));
    $('t-supply-id')?.addEventListener('change', (e) => {
        const sel = e.target;
        const opt = sel.options[sel.selectedIndex];
        const unit = opt ? opt.dataset.unit : '';
        const hint = $('t-supply-unit-hint');
        if (hint) {
            hint.innerText = unit ? `Consumo en ${unit}` : 'Cant. a descontar';
        }
    });

    // Topping Groups Modal Listeners
    $('btn-manage-topping-groups')?.addEventListener('click', () => openToppingGroupsModal());
    $('btn-open-groups-from-topping')?.addEventListener('click', () => openToppingGroupsModal());
    $('btn-close-topping-groups-modal')?.addEventListener('click', () => closeToppingGroupsModal());
    $('btn-done-topping-groups')?.addEventListener('click', () => closeToppingGroupsModal());
    $('topping-group-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('new-group-name-input');
        const val = input ? input.value.trim() : '';
        if (!val) return;
        saveToppingGroup(val);
        if (input) input.value = '';
        toast(`Grupo "${val}" agregado`, 'success');
        renderToppingGroupsList();
        updateGroupFilterOptions();
        populateToppingModalGroups(val);
    });

    // Dish modal toggles (Toppings & Promo)
    const pHasToppings = $('p-has-toppings');
    const pToppingsContainer = $('p-toppings-config-container');
    if (pHasToppings && pToppingsContainer) {
        pHasToppings.addEventListener('change', (e) => {
            const checked = e.target.checked;
            pToppingsContainer.classList.toggle('hidden', !checked);
            if (checked && (!pToppingsContainer.dataset.rendered || pToppingsContainer.dataset.rendered === 'false')) {
                renderDishToppingsSelector();
            }
        });
    }

    const pIsPromo = $('p-is-promo');
    const pPromoPriceContainer = $('p-promo-price-container');
    if (pIsPromo && pPromoPriceContainer) {
        pIsPromo.addEventListener('change', (e) => {
            pPromoPriceContainer.classList.toggle('hidden', !e.target.checked);
        });
    }

    // Real-time synchronization
    listenToToppings((updatedToppings) => {
        state.toppings = updatedToppings;
        renderToppingsTable();
        updateGroupFilterOptions();
    });
}

/**
 * Fetch toppings from server and render table
 */
export async function loadToppings() {
    try {
        const toppings = await getToppings();
        state.toppings = toppings || [];
        updateGroupFilterOptions();
        renderToppingsTable();
    } catch (err) {
        console.error("Error al cargar toppings:", err);
        toast("Error al cargar toppings", "error");
    }
}

const DEFAULT_TOPPING_GROUPS = ['Salsas', 'Quesos', 'Proteínas', 'Vegetales', 'Acompañamientos', 'Bebidas', 'Dulces / Postres'];

export function getToppingGroups() {
    let custom = [];
    try {
        const stored = localStorage.getItem('digirest_topping_groups');
        if (stored) custom = JSON.parse(stored);
    } catch (e) {
        console.error('Error reading topping groups:', e);
    }
    if (!Array.isArray(custom) || custom.length === 0) {
        custom = [...DEFAULT_TOPPING_GROUPS];
    }
    // Combine with any group_name from existing toppings
    const existingToppingGroups = (state.toppings || []).map(t => t.group_name).filter(Boolean);
    const combined = Array.from(new Set([...custom, ...existingToppingGroups])).sort((a, b) => a.localeCompare(b, 'es'));
    return combined;
}

export function saveToppingGroup(groupName) {
    if (!groupName || !groupName.trim()) return;
    const name = groupName.trim();
    const groups = getToppingGroups();
    if (!groups.includes(name)) {
        groups.push(name);
        groups.sort((a, b) => a.localeCompare(b, 'es'));
        try {
            localStorage.setItem('digirest_topping_groups', JSON.stringify(groups));
        } catch (e) {}
    }
}

export function deleteToppingGroup(groupName) {
    if (!groupName) return false;
    const inUseCount = (state.toppings || []).filter(t => t.group_name === groupName).length;
    if (inUseCount > 0) {
        toast(`No se puede eliminar "${groupName}" porque tiene ${inUseCount} topping(s) asignados`, 'warning');
        return false;
    }
    let groups = getToppingGroups().filter(g => g !== groupName);
    try {
        localStorage.setItem('digirest_topping_groups', JSON.stringify(groups));
    } catch (e) {}
    toast(`Grupo "${groupName}" eliminado`, 'success');
    renderToppingGroupsList();
    updateGroupFilterOptions();
    populateToppingModalGroups();
    return true;
}

export function populateToppingModalGroups(selectedGroup = '') {
    const select = $('t-group');
    if (!select) return;

    const groups = getToppingGroups();
    let html = `<option value="" disabled ${!selectedGroup ? 'selected' : ''}>Selecciona un grupo...</option>`;
    groups.forEach(g => {
        const isSel = g === selectedGroup ? 'selected' : '';
        html += `<option value="${escapeHtml(g)}" ${isSel}>${escapeHtml(g)}</option>`;
    });
    select.innerHTML = html;
    if (selectedGroup && groups.includes(selectedGroup)) {
        select.value = selectedGroup;
    }
}

export function openToppingGroupsModal() {
    renderToppingGroupsList();
    $('topping-groups-modal')?.classList.remove('hidden');
    setTimeout(() => $('new-group-name-input')?.focus(), 100);
}

export function closeToppingGroupsModal() {
    $('topping-groups-modal')?.classList.add('hidden');
    const currentSelected = $('t-group')?.value;
    populateToppingModalGroups(currentSelected);
}

export function renderToppingGroupsList() {
    const container = $('topping-groups-list-container');
    if (!container) return;

    const groups = getToppingGroups();
    if (groups.length === 0) {
        container.innerHTML = `<p class="text-xs text-gray-400 italic text-center py-4">No hay grupos registrados.</p>`;
        return;
    }

    container.innerHTML = groups.map(g => {
        const count = (state.toppings || []).filter(t => t.group_name === g).length;
        return `
            <div class="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-100 hover:bg-gray-100/70 transition-colors">
                <div class="flex items-center gap-2">
                    <i class="fas fa-folder text-amber-500 text-xs"></i>
                    <span class="text-xs font-bold text-gray-800">${escapeHtml(g)}</span>
                    <span class="text-[10px] text-gray-400 bg-white px-2 py-0.5 rounded-md border border-gray-200">${count} topping${count === 1 ? '' : 's'}</span>
                </div>
                <button type="button" class="btn-delete-group text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer" data-group="${escapeHtml(g)}" title="Eliminar grupo">
                    <i class="fas fa-trash-alt text-xs"></i>
                </button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-delete-group').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const g = e.currentTarget.dataset.group;
            showConfirmModal(
                'Eliminar Grupo',
                `¿Estás seguro de eliminar el grupo "${g}"?`,
                () => deleteToppingGroup(g)
            );
        });
    });
}

/**
 * Update the group filter select in the admin panel
 */
function updateGroupFilterOptions() {
    const filter = $('topping-filter-group');
    if (!filter) return;

    const currentVal = filter.value;
    const groups = getToppingGroups();

    let html = '<option value="">Todos los grupos</option>';
    groups.forEach(g => {
        html += `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`;
    });

    filter.innerHTML = html;
    if (groups.includes(currentVal)) {
        filter.value = currentVal;
    }
}

/**
 * Render toppings table in Admin View
 */
export function renderToppingsTable() {
    const tbody = $('admin-toppings-body');
    const emptyState = $('toppings-empty-state');
    if (!tbody) return;

    const query = ($('topping-search')?.value || '').toLowerCase().trim();
    const selectedGroup = $('topping-filter-group')?.value || '';

    let items = state.toppings || [];

    if (selectedGroup) {
        items = items.filter(t => t.group_name === selectedGroup);
    }

    if (query) {
        items = items.filter(t =>
            (t.name || '').toLowerCase().includes(query) ||
            (t.group_name || '').toLowerCase().includes(query)
        );
    }

    if (items.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    let html = '';
    items.forEach(t => {
        const isAvailable = t.available !== 0 && t.available !== false;

        html += `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td class="p-4 font-semibold text-gray-800 text-xs">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-gray-300'}"></span>
                        <span>${escapeHtml(t.name)}</span>
                    </div>
                </td>
                <td class="p-4 text-xs">
                    <span class="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium">
                        ${escapeHtml(t.group_name || 'General')}
                    </span>
                </td>
                <td class="p-4 text-xs font-bold text-gray-800">
                    ${t.price > 0 ? formatMoney(t.price) : '<span class="text-green-600 font-bold">Gratis / $0</span>'}
                </td>
                <td class="p-4 text-center text-xs">
                    <div class="flex flex-col items-center">
                        ${t.inventory_mode === 'none' ? `
                            <span class="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500 border border-gray-200">
                                <i class="fas fa-minus text-[8px] text-gray-400"></i> Sin inventario
                            </span>
                        ` : `
                            <span class="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[11px] ${(t.current_stock || 0) <= 0 ? 'bg-red-50 text-red-700 border border-red-200' : ((t.current_stock || 0) <= (t.min_stock || 5) ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')}">
                                <i class="fas ${(t.current_stock || 0) <= 0 ? 'fa-exclamation-circle text-red-500' : ((t.current_stock || 0) <= (t.min_stock || 5) ? 'fa-exclamation-triangle text-amber-500' : 'fa-box text-emerald-500')}"></i>
                                ${t.current_stock !== undefined ? t.current_stock : 0} porc.
                            </span>
                            ${t.inventory_mode === 'linked_supply' ? `
                                <span class="text-[9px] text-blue-600 font-bold mt-0.5 flex items-center gap-0.5" title="Descuenta de ${escapeHtml(t.linked_supply_name || 'Insumo')} (${t.supply_quantity || 1} ${escapeHtml(t.linked_supply_unit || '')} por porción)">
                                    <i class="fas fa-link text-[8px]"></i> ${escapeHtml(t.linked_supply_name || 'Insumo')}
                                </span>
                            ` : `
                                <span class="text-[9px] text-gray-400 font-medium mt-0.5">Propio</span>
                            `}
                        `}
                    </div>
                </td>
                <td class="p-4 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer topping-avail-toggle" data-id="${t.id}" ${isAvailable ? 'checked' : ''}>
                        <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                    </label>
                </td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" class="edit-topping-btn p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer" data-id="${t.id}" title="Editar">
                            <i class="fas fa-edit text-xs"></i>
                        </button>
                        <button type="button" class="delete-topping-btn p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer" data-id="${t.id}" title="Eliminar">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;

    // Attach listeners
    tbody.querySelectorAll('.topping-avail-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const checked = e.target.checked;
            try {
                await toggleTopping(id);
                const item = (state.toppings || []).find(x => x.id === id);
                if (item) item.available = checked ? 1 : 0;
                toast(`Topping ${checked ? 'habilitado' : 'deshabilitado'}`, 'success');
            } catch (err) {
                console.error(err);
                toast('Error al cambiar disponibilidad', 'error');
                e.target.checked = !checked;
            }
        });
    });

    tbody.querySelectorAll('.edit-topping-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const item = (state.toppings || []).find(x => x.id === id);
            if (item) openToppingModal(item);
        });
    });

    tbody.querySelectorAll('.delete-topping-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            showConfirmModal('Eliminar Topping', '¿Deseas eliminar este topping / adición? Los platos que lo incluyan ya no lo mostrarán.', async () => {
                try {
                    await deleteTopping(id);
                    state.toppings = (state.toppings || []).filter(x => x.id !== id);
                    renderToppingsTable();
                    updateGroupFilterOptions();
                    toast('Topping eliminado', 'success');
                } catch (err) {
                    console.error(err);
                    toast('Error al eliminar topping', 'error');
                }
            });
        });
    });
}

/**
 * Switch Inventory Mode in Topping Modal
 */
export function setToppingInventoryMode(mode) {
    const hidden = $('t-inventory-mode');
    if (hidden) hidden.value = mode;

    const btnDirect = $('btn-mode-direct');
    const btnLinked = $('btn-mode-linked');
    const contDirect = $('container-mode-direct');
    const contLinked = $('container-mode-linked');

    if (mode === 'linked_supply') {
        btnDirect?.classList.remove('active');
        btnLinked?.classList.add('active');
        contDirect?.classList.add('hidden');
        contLinked?.classList.remove('hidden');
    } else {
        btnLinked?.classList.remove('active');
        btnDirect?.classList.add('active');
        contLinked?.classList.add('hidden');
        contDirect?.classList.remove('hidden');
    }
}

/**
 * Open Modal to Create or Edit Topping
 */
export async function openToppingModal(topping = null) {
    const modal = $('topping-modal');
    if (!modal) return;

    const title = $('topping-modal-title');
    const idInput = $('t-id');
    const nameInput = $('t-name');
    const groupInput = $('t-group');
    const priceInput = $('t-price');
    const availInput = $('t-available');
    const stockInput = $('t-stock');
    const minStockInput = $('t-min-stock');
    const supplySelect = $('t-supply-id');
    const supplyQtyInput = $('t-supply-qty');
    const linkedMinStockInput = $('t-linked-min-stock');
    const hint = $('t-supply-unit-hint');

    const targetGroup = topping ? (topping.group_name || '') : '';
    populateToppingModalGroups(targetGroup);

    // Cargar catálogo de insumos de cocina para el select
    if (supplySelect) {
        try {
            const supplies = await getSuppliesForToppings();
            let optionsHtml = '<option value="">Selecciona un insumo...</option>';
            supplies.forEach(s => {
                const isSel = (topping && topping.supply_id === s.id) ? 'selected' : '';
                optionsHtml += `<option value="${escapeHtml(s.id)}" data-unit="${escapeHtml(s.unit || 'und')}" ${isSel}>${escapeHtml(s.name)} (Stock: ${s.current_stock || 0} ${escapeHtml(s.unit || 'und')})</option>`;
            });
            supplySelect.innerHTML = optionsHtml;
        } catch (e) {
            console.error('Error cargando insumos para topping:', e);
        }
    }

    if (topping) {
        if (title) title.innerText = 'Editar Topping / Adición';
        if (idInput) idInput.value = topping.id;
        if (nameInput) nameInput.value = topping.name || '';
        if (groupInput) groupInput.value = targetGroup;
        if (priceInput) priceInput.value = topping.price !== undefined ? topping.price : 0;
        if (availInput) availInput.checked = topping.available !== 0 && topping.available !== false;

        const hasInvToggle = $('t-has-inventory');
        const invContainer = $('t-inventory-fields-container');
        const hasInventory = topping.inventory_mode && topping.inventory_mode !== 'none';

        if (hasInvToggle) hasInvToggle.checked = hasInventory;
        if (invContainer) {
            if (hasInventory) invContainer.classList.remove('hidden');
            else invContainer.classList.add('hidden');
        }

        const mode = topping.inventory_mode === 'linked_supply' ? 'linked_supply' : 'direct';
        setToppingInventoryMode(mode);

        if (stockInput) stockInput.value = topping.stock !== undefined ? topping.stock : (topping.current_stock || 0);
        if (minStockInput) minStockInput.value = topping.min_stock !== undefined ? topping.min_stock : 5;
        if (supplySelect && topping.supply_id) supplySelect.value = topping.supply_id;
        if (supplyQtyInput) supplyQtyInput.value = topping.supply_quantity || 1;
        if (linkedMinStockInput) linkedMinStockInput.value = topping.min_stock !== undefined ? topping.min_stock : 5;

        // Actualizar hint de unidad
        if (supplySelect && hint) {
            const selOpt = supplySelect.options[supplySelect.selectedIndex];
            hint.innerText = (selOpt && selOpt.dataset.unit) ? `Consumo en ${selOpt.dataset.unit}` : 'Cant. a descontar';
        }
    } else {
        if (title) title.innerText = 'Nuevo Topping / Adición';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (groupInput) groupInput.value = targetGroup || (getToppingGroups()[0] || '');
        if (priceInput) priceInput.value = 0;
        if (availInput) availInput.checked = true;

        const hasInvToggle = $('t-has-inventory');
        const invContainer = $('t-inventory-fields-container');
        if (hasInvToggle) hasInvToggle.checked = false;
        if (invContainer) invContainer.classList.add('hidden');

        setToppingInventoryMode('direct');
        if (stockInput) stockInput.value = 0;
        if (minStockInput) minStockInput.value = 5;
        if (supplySelect) supplySelect.value = '';
        if (supplyQtyInput) supplyQtyInput.value = 1;
        if (linkedMinStockInput) linkedMinStockInput.value = 5;
        if (hint) hint.innerText = 'Cant. a descontar';
    }

    modal.classList.remove('hidden');
    if (nameInput) nameInput.focus();
}

/**
 * Close Topping Modal
 */
export function closeToppingModal() {
    const modal = $('topping-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Form Submit Handler for Topping
 */
async function handleSaveTopping(e) {
    e.preventDefault();
    const btnSave = $('btn-save-topping');
    if (btnSave) btnSave.disabled = true;

    try {
        const id = $('t-id')?.value || null;
        const hasInventory = $('t-has-inventory')?.checked ?? false;
        const rawMode = $('t-inventory-mode')?.value || 'direct';
        const mode = hasInventory ? rawMode : 'none';

        const data = {
            name: $('t-name')?.value.trim(),
            group_name: $('t-group')?.value.trim() || 'General',
            price: Number($('t-price')?.value) || 0,
            available: $('t-available')?.checked ? 1 : 0,
            inventory_mode: mode
        };

        if (mode === 'linked_supply') {
            data.supply_id = $('t-supply-id')?.value || null;
            data.supply_quantity = Number($('t-supply-qty')?.value) || 1;
            data.min_stock = Number($('t-linked-min-stock')?.value) || 5;

            if (!data.supply_id) {
                toast('Por favor selecciona un insumo de bodega para vincular', 'warning');
                if (btnSave) btnSave.disabled = false;
                return;
            }
        } else if (mode === 'direct') {
            data.stock = Number($('t-stock')?.value) || 0;
            data.min_stock = Number($('t-min-stock')?.value) || 5;
            data.supply_id = null;
            data.supply_quantity = 1;
        } else {
            data.stock = 0;
            data.min_stock = 0;
            data.supply_id = null;
            data.supply_quantity = 1;
        }

        if (!data.name) {
            toast('El nombre es obligatorio', 'warning');
            if (btnSave) btnSave.disabled = false;
            return;
        }

        const res = await saveTopping(data, id);
        toast(id ? 'Topping actualizado' : 'Topping creado con éxito', 'success');

        closeToppingModal();
        await loadToppings();
    } catch (err) {
        console.error("Error guardando topping:", err);
        toast('Error al guardar el topping: ' + err.message, 'error');
    } finally {
        if (btnSave) btnSave.disabled = false;
    }
}

/**
 * Renders the Toppings configurator inside #product-modal
 * @param {Array|string} currentConfig - Existing toppings config (array or JSON string)
 */
export async function renderDishToppingsSelector(currentConfig = null) {
    const container = $('p-toppings-list');
    const badge = $('p-toppings-count-badge');
    const parentContainer = $('p-toppings-config-container');
    if (!container) return;

    if (!state.toppings || state.toppings.length === 0) {
        try {
            state.toppings = await getToppings();
        } catch (e) {
            state.toppings = [];
        }
    }

    let parsedConfig = [];
    if (typeof currentConfig === 'string') {
        try {
            parsedConfig = JSON.parse(currentConfig) || [];
        } catch (e) {
            parsedConfig = [];
        }
    } else if (Array.isArray(currentConfig)) {
        parsedConfig = currentConfig;
    }

    if (!state.toppings || state.toppings.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4 bg-gray-50 rounded-xl border border-gray-100">
                <p class="text-xs text-gray-500">Aún no hay toppings creados en el sistema.</p>
                <p class="text-[10px] text-gray-400 mt-1">Crea toppings en la pestaña "Toppings / Adiciones".</p>
            </div>
        `;
        if (badge) badge.innerText = '0 disponibles';
        if (parentContainer) parentContainer.dataset.rendered = 'true';
        return;
    }

    // Group toppings by group_name
    const groups = {};
    state.toppings.forEach(t => {
        const g = t.group_name || 'General';
        if (!groups[g]) groups[g] = [];
        groups[g].push(t);
    });

    let selectedCount = 0;
    let html = '';

    for (const [groupName, toppings] of Object.entries(groups)) {
        const groupSelectedCount = toppings.filter(t => parsedConfig.some(c => c.id === t.id)).length;
        // Iniciar abierto si tiene seleccionados o si hay pocos grupos
        const isOpen = groupSelectedCount > 0 || Object.keys(groups).length <= 2;

        html += `
            <div class="topping-group-block bg-white rounded-xl border border-gray-200/90 shadow-2xs overflow-hidden transition-all duration-200" data-group-name="${escapeHtml(groupName)}">
                <!-- Header Acordeón -->
                <div class="topping-group-header px-2.5 py-1.5 sm:px-3 sm:py-2 bg-gray-50/90 hover:bg-gray-100 transition-colors flex items-center justify-between cursor-pointer select-none">
                    <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <i class="fas fa-chevron-right text-gray-400 text-[9px] transition-transform duration-200 group-chevron shrink-0 ${isOpen ? 'rotate-90 text-[var(--system-primary)]' : ''}"></i>
                        <span class="font-extrabold text-[11px] sm:text-xs text-gray-800 tracking-wider uppercase truncate">${escapeHtml(groupName)}</span>
                        <span class="topping-group-badge text-[9px] px-1.5 py-0.5 rounded-full font-bold transition-colors shrink-0 ${groupSelectedCount > 0 ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-gray-100 text-gray-500'}">
                            ${groupSelectedCount} / ${toppings.length} activos
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation()">
                        <button type="button" class="btn-select-all-group text-[9px] sm:text-[10px] text-[var(--system-primary)] font-bold hover:underline px-1.5 py-0.5 rounded hover:bg-white cursor-pointer">
                            Marcar grupo
                        </button>
                    </div>
                </div>
                <!-- Cuerpo Acordeón: 2 Columnas -->
                <div class="topping-group-content p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-white ${isOpen ? '' : 'hidden'}">
        `;

        toppings.forEach(t => {
            const configItem = parsedConfig.find(c => c.id === t.id);
            const isChecked = Boolean(configItem);
            if (isChecked) selectedCount++;

            const isRequired = configItem ? Boolean(configItem.is_required) : false;
            const basePrice = Number(t.price || 0);
            const extraPrice = isRequired ? 0 : (configItem && configItem.price !== undefined ? configItem.price : basePrice);

            html += `
                <div class="topping-item-row flex items-center justify-between gap-1.5 p-1.5 sm:p-2 rounded-lg border transition-all text-xs ${isChecked ? 'bg-orange-50/40 border-orange-300 ring-1 ring-orange-200/60 shadow-2xs' : 'bg-white border-gray-200 hover:border-gray-300'}" data-topping-id="${t.id}" data-topping-name="${escapeHtml(t.name)}" data-topping-group="${escapeHtml(t.group_name)}">
                    <label class="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0 select-none">
                        <input type="checkbox" class="t-dish-check w-3.5 h-3.5 accent-[var(--system-primary)] rounded cursor-pointer shrink-0" ${isChecked ? 'checked' : ''}>
                        <span class="truncate font-semibold text-gray-800 text-[11px] sm:text-xs" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    </label>
                    <div class="topping-controls flex items-center gap-1 shrink-0 ${isChecked ? '' : 'opacity-40 pointer-events-none'}">
                        <select class="t-dish-type text-[9px] sm:text-[10px] py-0.5 px-1 border border-gray-200 rounded-md bg-white outline-none cursor-pointer font-medium">
                            <option value="optional" ${!isRequired ? 'selected' : ''}>Opcional</option>
                            <option value="required" ${isRequired ? 'selected' : ''}>Obligatorio</option>
                        </select>
                        <div class="flex items-center gap-0.5">
                            <span class="text-[9px] text-gray-400 font-bold">$</span>
                            <input type="number" step="any" readonly class="t-dish-price w-12 sm:w-14 py-0.5 px-1.5 border border-gray-200 rounded-md text-[10px] sm:text-[11px] font-bold text-center outline-none bg-gray-50 text-gray-700 cursor-not-allowed select-none" value="${extraPrice}" data-base-price="${basePrice}" placeholder="0" ${isRequired ? 'disabled' : ''}>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
    if (badge) badge.innerText = `${selectedCount} seleccionados`;
    if (parentContainer) parentContainer.dataset.rendered = 'true';

    // Hook up row listeners
    container.querySelectorAll('.topping-item-row').forEach(row => {
        const check = row.querySelector('.t-dish-check');
        const controls = row.querySelector('.topping-controls');
        const typeSelect = row.querySelector('.t-dish-type');
        const priceInput = row.querySelector('.t-dish-price');

        check.addEventListener('change', () => {
            const isChecked = check.checked;
            controls.classList.toggle('opacity-40', !isChecked);
            controls.classList.toggle('pointer-events-none', !isChecked);
            row.classList.toggle('bg-orange-50/40', isChecked);
            row.classList.toggle('border-orange-300', isChecked);
            row.classList.toggle('ring-1', isChecked);
            row.classList.toggle('ring-orange-200/60', isChecked);
            row.classList.toggle('shadow-2xs', isChecked);
            row.classList.toggle('bg-white', !isChecked);
            row.classList.toggle('border-gray-200', !isChecked);

            updateGroupBadge(row.closest('.topping-group-block'));
            updateSelectedBadgeCount();
        });

        typeSelect.addEventListener('change', () => {
            if (typeSelect.value === 'required') {
                priceInput.value = 0;
                priceInput.disabled = true;
            } else {
                priceInput.value = priceInput.dataset.basePrice || 0;
                priceInput.disabled = false;
            }
        });
    });

    // Toggle Acordeón al hacer click en el header del grupo
    container.querySelectorAll('.topping-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const block = header.closest('.topping-group-block');
            if (!block) return;
            const content = block.querySelector('.topping-group-content');
            const chevron = block.querySelector('.group-chevron');
            if (content) {
                const isNowHidden = !content.classList.contains('hidden');
                content.classList.toggle('hidden', isNowHidden);
                if (chevron) {
                    chevron.classList.toggle('rotate-90', !isNowHidden);
                    chevron.classList.toggle('text-[var(--system-primary)]', !isNowHidden);
                }
            }
        });
    });

    // "Marcar grupo" button
    container.querySelectorAll('.btn-select-all-group').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const block = e.target.closest('.topping-group-block');
            if (!block) return;
            const checkboxes = block.querySelectorAll('.t-dish-check');
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            checkboxes.forEach(c => {
                c.checked = !allChecked;
                c.dispatchEvent(new Event('change'));
            });

            // Si se marcaron, asegurarse de que el grupo esté visible/abierto
            if (!allChecked) {
                const content = block.querySelector('.topping-group-content');
                const chevron = block.querySelector('.group-chevron');
                if (content && content.classList.contains('hidden')) {
                    content.classList.remove('hidden');
                    if (chevron) {
                        chevron.classList.add('rotate-90', 'text-[var(--system-primary)]');
                    }
                }
            }

            updateGroupBadge(block);
            updateSelectedBadgeCount();
        });
    });

    // Listeners para Expandir todos / Colapsar todos
    const btnExpandAll = $('btn-expand-all-toppings');
    if (btnExpandAll) {
        btnExpandAll.onclick = (e) => {
            e.preventDefault();
            container.querySelectorAll('.topping-group-block').forEach(b => {
                const content = b.querySelector('.topping-group-content');
                const chevron = b.querySelector('.group-chevron');
                if (content) content.classList.remove('hidden');
                if (chevron) chevron.classList.add('rotate-90', 'text-[var(--system-primary)]');
            });
        };
    }

    const btnCollapseAll = $('btn-collapse-all-toppings');
    if (btnCollapseAll) {
        btnCollapseAll.onclick = (e) => {
            e.preventDefault();
            container.querySelectorAll('.topping-group-block').forEach(b => {
                const content = b.querySelector('.topping-group-content');
                const chevron = b.querySelector('.group-chevron');
                if (content) content.classList.add('hidden');
                if (chevron) chevron.classList.remove('rotate-90', 'text-[var(--system-primary)]');
            });
        };
    }
}

function updateGroupBadge(block) {
    if (!block) return;
    const badge = block.querySelector('.topping-group-badge');
    const total = block.querySelectorAll('.t-dish-check').length;
    const checked = block.querySelectorAll('.t-dish-check:checked').length;
    if (badge) {
        badge.innerText = `${checked} / ${total} activos`;
        if (checked > 0) {
            badge.className = 'topping-group-badge text-[10px] px-2 py-0.5 rounded-full font-bold transition-colors shrink-0 bg-orange-100 text-orange-800 border border-orange-200';
        } else {
            badge.className = 'topping-group-badge text-[10px] px-2 py-0.5 rounded-full font-bold transition-colors shrink-0 bg-gray-100 text-gray-500';
        }
    }
}

function updateSelectedBadgeCount() {
    const container = $('p-toppings-list');
    const badge = $('p-toppings-count-badge');
    if (!container || !badge) return;

    const count = container.querySelectorAll('.t-dish-check:checked').length;
    badge.innerText = `${count} seleccionados`;
}

/**
 * Collect configured toppings from the dish modal
 * @returns {Array} Array of selected topping objects
 */
export function getDishToppingsConfig() {
    const container = $('p-toppings-list');
    if (!container) return [];

    const config = [];
    container.querySelectorAll('.topping-item-row').forEach(row => {
        const check = row.querySelector('.t-dish-check');
        if (check && check.checked) {
            const id = row.dataset.toppingId;
            const name = row.dataset.toppingName;
            const groupName = row.dataset.toppingGroup;
            const type = row.querySelector('.t-dish-type')?.value || 'optional';
            const price = Number(row.querySelector('.t-dish-price')?.value) || 0;

            config.push({
                id,
                name,
                group_name: groupName,
                is_required: type === 'required',
                price: type === 'required' ? 0 : price
            });
        }
    });

    return config;
}

/**
 * Reset dish toppings configuration fields in product modal
 */
export function resetDishToppingsConfig() {
    const pHasToppings = $('p-has-toppings');
    const pToppingsContainer = $('p-toppings-config-container');
    const pIsRecommended = $('p-is-recommended');
    const pIsPromo = $('p-is-promo');
    const pPromoPriceContainer = $('p-promo-price-container');
    const pPromoPrice = $('p-promo-price');

    if (pHasToppings) pHasToppings.checked = false;
    if (pToppingsContainer) {
        pToppingsContainer.classList.add('hidden');
        pToppingsContainer.dataset.rendered = 'false';
    }
    if (pIsRecommended) pIsRecommended.checked = false;
    if (pIsPromo) pIsPromo.checked = false;
    if (pPromoPriceContainer) pPromoPriceContainer.classList.add('hidden');
    if (pPromoPrice) pPromoPrice.value = '';

    const container = $('p-toppings-list');
    if (container) container.innerHTML = '';
}

/**
 * Populate dish toppings & promo configurations when editing a product
 */
export async function populateDishFormExtensions(product) {
    if (!product) return;

    const pHasToppings = $('p-has-toppings');
    const pToppingsContainer = $('p-toppings-config-container');
    const pIsRecommended = $('p-is-recommended');
    const pIsPromo = $('p-is-promo');
    const pPromoPriceContainer = $('p-promo-price-container');
    const pPromoPrice = $('p-promo-price');

    const hasToppings = product.has_toppings === 1 || product.has_toppings === true;
    if (pHasToppings) pHasToppings.checked = hasToppings;
    if (pToppingsContainer) pToppingsContainer.classList.toggle('hidden', !hasToppings);

    if (hasToppings) {
        await renderDishToppingsSelector(product.toppings_config);
    } else {
        if (pToppingsContainer) pToppingsContainer.dataset.rendered = 'false';
        const container = $('p-toppings-list');
        if (container) container.innerHTML = '';
    }

    const isRec = product.is_recommended === 1 || product.is_recommended === true;
    if (pIsRecommended) pIsRecommended.checked = isRec;

    const isPromo = product.is_promo === 1 || product.is_promo === true;
    if (pIsPromo) pIsPromo.checked = isPromo;
    if (pPromoPriceContainer) pPromoPriceContainer.classList.toggle('hidden', !isPromo);
    if (pPromoPrice) pPromoPrice.value = product.promo_price || '';
}
