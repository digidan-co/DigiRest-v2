/**
 * DigiRest - Dish Variants / Portions Management Feature
 * Handles Admin Dish Variants Configurator (Sizes, Portions, Multi-pricing)
 * and synchronization with product base price.
 */

import { $ } from '../utils/helpers.js';

let _initialized = false;

/**
 * Initialize dish variants form listeners
 */
export function initVariantsManager() {
    if (_initialized) return;
    _initialized = true;

    const pHasVariants = $('p-has-variants');
    const container = $('p-variants-config-container');
    const btnAdd = $('btn-add-variant-row');

    if (pHasVariants && container) {
        pHasVariants.addEventListener('change', (e) => {
            const checked = e.target.checked;
            container.classList.toggle('hidden', !checked);

            if (checked) {
                const list = $('p-variants-list');
                if (list && list.children.length === 0) {
                    addVariantRow('', '');
                }
                syncBasePriceFromVariants();
            }
        });
    }

    if (btnAdd) {
        btnAdd.addEventListener('click', (e) => {
            e.preventDefault();
            addVariantRow('', '');
            const list = $('p-variants-list');
            if (list && list.lastElementChild) {
                const nameInput = list.lastElementChild.querySelector('.v-row-name');
                if (nameInput) nameInput.focus();
            }
        });
    }
}

/**
 * Add a single variant row to the repeater list
 */
export function addVariantRow(name = '', price = '', id = null) {
    const list = $('p-variants-list');
    if (!list) return;

    const rowId = id || `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rowEl = document.createElement('div');
    rowEl.className = 'variant-row flex items-center gap-1.5 p-1.5 bg-white rounded-lg border border-gray-200 shadow-2xs transition-all hover:border-indigo-300';
    rowEl.dataset.id = rowId;

    const numericPrice = (price !== null && price !== undefined && price !== '' && Number(price) > 0) ? Number(price) : '';

    rowEl.innerHTML = `
        <div class="flex-1 min-w-0">
            <input type="text" value="${escapeInputAttr(name)}" placeholder="Ej: Mediana, Familiar..." 
                class="v-row-name w-full py-1.5 px-2.5 border border-gray-200 rounded-lg outline-none focus:border-indigo-500 text-xs font-semibold text-gray-800" required>
        </div>
        <div class="w-28 sm:w-36 shrink-0">
            <div class="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-300 transition-all">
                <span class="px-2 text-xs font-black text-gray-400 select-none bg-gray-50 py-1.5 border-r border-gray-100 shrink-0">$</span>
                <input type="number" 
                    value="${numericPrice}" 
                    placeholder="0" 
                    min="0" 
                    step="100"
                    class="v-row-price w-full py-1.5 px-2 outline-none text-xs font-bold text-indigo-900 bg-transparent min-w-0" 
                    required>
            </div>
        </div>
        <button type="button" class="btn-remove-variant text-gray-400 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors cursor-pointer shrink-0" title="Eliminar tamaño">
            <i class="fas fa-trash-alt text-xs"></i>
        </button>
    `;

    // Row listeners
    const nameInput = rowEl.querySelector('.v-row-name');
    const priceInput = rowEl.querySelector('.v-row-price');
    const btnRemove = rowEl.querySelector('.btn-remove-variant');

    priceInput.addEventListener('focus', () => {
        if (priceInput.value === '0') {
            priceInput.value = '';
        }
    });

    priceInput.addEventListener('input', () => {
        syncBasePriceFromVariants();
        updateVariantsBadge();
    });

    nameInput.addEventListener('input', () => {
        updateVariantsBadge();
    });

    btnRemove.addEventListener('click', () => {
        rowEl.remove();
        syncBasePriceFromVariants();
        updateVariantsBadge();
    });

    list.appendChild(rowEl);
    updateVariantsBadge();
    syncBasePriceFromVariants();
}

/**
 * Render complete array of variants in product modal
 */
export function renderDishVariantsList(variants = []) {
    const list = $('p-variants-list');
    if (!list) return;
    list.innerHTML = '';

    if (Array.isArray(variants) && variants.length > 0) {
        variants.forEach(v => {
            if (v && typeof v === 'object') {
                addVariantRow(v.name || '', (v.price !== null && v.price !== undefined) ? v.price : '', v.id || null);
            }
        });
    }

    updateVariantsBadge();
    syncBasePriceFromVariants();
}

/**
 * Update badge displaying number of defined variants
 */
export function updateVariantsBadge() {
    const list = $('p-variants-list');
    const badge = $('p-variants-count-badge');
    if (!list || !badge) return;

    const count = list.querySelectorAll('.variant-row').length;
    badge.innerText = `${count} ${count === 1 ? 'tamaño' : 'tamaños'}`;
    badge.className = count > 0 
        ? 'text-[9px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold'
        : 'text-[9px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold';
}

/**
 * Automatically sync the product base price (p-price) with the lowest variant price
 */
export function syncBasePriceFromVariants() {
    const pHasVariants = $('p-has-variants');
    if (!pHasVariants || !pHasVariants.checked) return;

    const list = $('p-variants-list');
    const pPrice = $('p-price');
    if (!list || !pPrice) return;

    const rows = list.querySelectorAll('.variant-row');
    if (rows.length === 0) return;

    let minPrice = Infinity;
    rows.forEach(row => {
        const val = parseFloat(row.querySelector('.v-row-price')?.value);
        if (!isNaN(val) && val > 0 && val < minPrice) {
            minPrice = val;
        }
    });

    if (isFinite(minPrice)) {
        pPrice.value = minPrice;
    }
}

/**
 * Collect current variants config from DOM
 */
export function getDishVariantsConfig() {
    const list = $('p-variants-list');
    if (!list) return [];

    const variants = [];
    const rows = list.querySelectorAll('.variant-row');

    rows.forEach((row, idx) => {
        const id = row.dataset.id || `var_${idx}_${Date.now()}`;
        const name = (row.querySelector('.v-row-name')?.value || '').trim();
        const price = parseFloat(row.querySelector('.v-row-price')?.value) || 0;

        if (name) {
            variants.push({
                id,
                name,
                price
            });
        }
    });

    return variants;
}

/**
 * Reset dish variants configuration fields in product modal
 */
export function resetDishVariantsConfig() {
    const pHasVariants = $('p-has-variants');
    const container = $('p-variants-config-container');
    const list = $('p-variants-list');

    if (pHasVariants) pHasVariants.checked = false;
    if (container) container.classList.add('hidden');
    if (list) list.innerHTML = '';
    updateVariantsBadge();
}

/**
 * Populate dish variants when editing or duplicating a product
 */
export function populateDishVariantsExtensions(product) {
    if (!product) return;

    const pHasVariants = $('p-has-variants');
    const container = $('p-variants-config-container');

    const hasVariants = product.has_variants === 1 || product.has_variants === true || product.has_variants === '1';
    if (pHasVariants) pHasVariants.checked = hasVariants;
    if (container) container.classList.toggle('hidden', !hasVariants);

    if (hasVariants) {
        let variants = [];
        if (typeof product.variants_config === 'string') {
            try {
                variants = JSON.parse(product.variants_config) || [];
            } catch (e) {
                variants = [];
            }
        } else if (Array.isArray(product.variants_config)) {
            variants = product.variants_config;
        }

        renderDishVariantsList(variants);
    } else {
        const list = $('p-variants-list');
        if (list) list.innerHTML = '';
        updateVariantsBadge();
    }
}

function escapeInputAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
