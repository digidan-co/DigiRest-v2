/**
 * DigiRest - Dish Variants / Portions Management Feature
 * Handles Admin Dish Variants Configurator (Sizes, Portions, Multi-pricing)
 * and synchronization with product base price and promotional prices.
 */

import { $ } from '../utils/helpers.js';
import { showPromptModal, toast } from '../components/ui.js';

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
    const pIsPromo = $('p-is-promo');
    const btnPercent = $('btn-apply-percent-variants');

    if (pHasVariants && container) {
        pHasVariants.addEventListener('change', (e) => {
            const checked = e.target.checked;
            container.classList.toggle('hidden', !checked);

            if (checked) {
                const list = $('p-variants-list');
                if (list && list.children.length === 0) {
                    addVariantRow('', '');
                }
                updateVariantsPromoVisibility();
                syncBasePriceFromVariants();
            }
        });
    }

    if (pIsPromo) {
        pIsPromo.addEventListener('change', () => {
            updateVariantsPromoVisibility();
            syncBasePriceFromVariants();
        });
    }

    if (btnAdd) {
        btnAdd.addEventListener('click', (e) => {
            e.preventDefault();
            addVariantRow('', '', '');
            const list = $('p-variants-list');
            if (list && list.lastElementChild) {
                const nameInput = list.lastElementChild.querySelector('.v-row-name');
                if (nameInput) nameInput.focus();
            }
        });
    }

    if (btnPercent) {
        btnPercent.addEventListener('click', (e) => {
            e.preventDefault();
            const promptFn = (typeof showPromptModal === 'function') ? showPromptModal : window.showPromptModal;
            if (!promptFn) return;

            promptFn(
                'Descuento en Tamaños',
                'Ingresa el porcentaje de descuento a aplicar sobre el precio de cada tamaño:',
                'Ej: 20',
                (val) => {
                    const pct = parseFloat(val);
                    const list = $('p-variants-list');
                    if (!list) return;
                    const rows = list.querySelectorAll('.variant-row');
                    let appliedCount = 0;
                    rows.forEach(row => {
                        const priceVal = parseFloat(row.querySelector('.v-row-price')?.value);
                        const promoInp = row.querySelector('.v-row-promo');
                        if (promoInp && !isNaN(priceVal) && priceVal > 0) {
                            const discounted = Math.round((priceVal * (1 - pct / 100)) / 100) * 100;
                            promoInp.value = discounted;
                            appliedCount++;
                        }
                    });
                    syncBasePriceFromVariants();
                    const toastFn = (typeof toast === 'function') ? toast : window.toast;
                    if (toastFn) {
                        toastFn(`Descuento del ${pct}% aplicado a ${appliedCount} tamaño(s)`, 'success');
                    }
                },
                {
                    inputType: 'number',
                    defaultValue: '20',
                    okText: 'Aplicar Descuento',
                    okClass: 'btn-system-primary text-white font-bold shadow-md transition-transform active:scale-95',
                    validate: (val) => {
                        const n = parseFloat(val);
                        if (isNaN(n) || n <= 0 || n >= 100) {
                            return 'Por favor ingresa un porcentaje válido entre 1 y 99';
                        }
                        return null;
                    }
                }
            );
        });
    }
}

/**
 * Toggle visibility of promo inputs in each variant row and header
 */
export function updateVariantsPromoVisibility() {
    const pIsPromo = $('p-is-promo');
    const isPromo = pIsPromo ? pIsPromo.checked : false;
    const list = $('p-variants-list');
    const btnPercent = $('btn-apply-percent-variants');
    const promoHint = $('p-variants-promo-hint');
    const promoVariantsNote = $('p-promo-variants-note');
    const pHasVariants = $('p-has-variants');
    const hasVariants = pHasVariants ? pHasVariants.checked : false;

    if (btnPercent) {
        btnPercent.classList.toggle('hidden', !isPromo);
    }
    if (promoHint) {
        promoHint.classList.toggle('hidden', !isPromo);
    }
    if (promoVariantsNote) {
        promoVariantsNote.classList.toggle('hidden', !(isPromo && hasVariants));
    }

    if (list) {
        const promoWraps = list.querySelectorAll('.v-row-promo-wrap');
        promoWraps.forEach(wrap => {
            wrap.classList.toggle('hidden', !isPromo);
        });
    }
}

/**
 * Add a single variant row to the repeater list
 */
export function addVariantRow(name = '', price = '', promoPrice = '', id = null) {
    const list = $('p-variants-list');
    if (!list) return;

    const rowId = id || `var_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const rowEl = document.createElement('div');
    rowEl.className = 'variant-row flex items-center gap-1.5 p-1.5 bg-white rounded-lg border border-gray-200 shadow-2xs transition-all hover:border-indigo-300';
    rowEl.dataset.id = rowId;

    const numericPrice = (price !== null && price !== undefined && price !== '' && Number(price) > 0) ? Number(price) : '';
    const numericPromo = (promoPrice !== null && promoPrice !== undefined && promoPrice !== '' && Number(promoPrice) > 0) ? Number(promoPrice) : '';
    const isPromoActive = Boolean($('p-is-promo')?.checked);

    rowEl.innerHTML = `
        <div class="flex-1 min-w-0">
            <input type="text" value="${escapeInputAttr(name)}" placeholder="Ej: Mediana, Familiar..." 
                class="v-row-name w-full py-1.5 px-2.5 border border-gray-200 rounded-lg outline-none focus:border-indigo-500 text-xs font-semibold text-gray-800" required>
        </div>
        <div class="w-24 sm:w-28 shrink-0">
            <div class="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-300 transition-all" title="Precio regular">
                <span class="px-1.5 text-xs font-black text-gray-400 select-none bg-gray-50 py-1.5 border-r border-gray-100 shrink-0">$</span>
                <input type="number" 
                    value="${numericPrice}" 
                    placeholder="Regular" 
                    min="0" 
                    step="100"
                    class="v-row-price w-full py-1.5 px-1.5 outline-none text-xs font-bold text-indigo-900 bg-transparent min-w-0" 
                    required>
            </div>
        </div>
        <div class="v-row-promo-wrap w-24 sm:w-28 shrink-0 ${isPromoActive ? '' : 'hidden'}">
            <div class="flex items-center bg-red-50/60 border border-red-200 rounded-lg overflow-hidden focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-300 transition-all" title="Precio promocional de oferta">
                <span class="px-1.5 text-xs select-none bg-red-100/60 py-1.5 border-r border-red-200 shrink-0">🔥</span>
                <input type="number" 
                    value="${numericPromo}" 
                    placeholder="Oferta" 
                    min="0" 
                    step="100"
                    class="v-row-promo w-full py-1.5 px-1.5 outline-none text-xs font-bold text-red-600 bg-transparent min-w-0">
            </div>
        </div>
        <button type="button" class="btn-remove-variant text-gray-400 hover:text-red-500 p-1.5 rounded-md hover:bg-red-50 transition-colors cursor-pointer shrink-0" title="Eliminar tamaño">
            <i class="fas fa-trash-alt text-xs"></i>
        </button>
    `;

    // Row listeners
    const nameInput = rowEl.querySelector('.v-row-name');
    const priceInput = rowEl.querySelector('.v-row-price');
    const promoInput = rowEl.querySelector('.v-row-promo');
    const btnRemove = rowEl.querySelector('.btn-remove-variant');

    priceInput.addEventListener('focus', () => {
        if (priceInput.value === '0') {
            priceInput.value = '';
        }
    });

    if (promoInput) {
        promoInput.addEventListener('focus', () => {
            if (promoInput.value === '0') promoInput.value = '';
        });
        promoInput.addEventListener('input', () => {
            syncBasePriceFromVariants();
        });
    }

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
                addVariantRow(
                    v.name || '',
                    (v.price !== null && v.price !== undefined) ? v.price : '',
                    (v.promo_price !== null && v.promo_price !== undefined) ? v.promo_price : '',
                    v.id || null
                );
            }
        });
    }

    updateVariantsBadge();
    syncBasePriceFromVariants();
    updateVariantsPromoVisibility();
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
 * Automatically sync the product base price (p-price) and base promo price (p-promo-price)
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
    let minPromoPrice = Infinity;
    let hasPromo = false;

    rows.forEach(row => {
        const val = parseFloat(row.querySelector('.v-row-price')?.value);
        if (!isNaN(val) && val > 0 && val < minPrice) {
            minPrice = val;
        }
        const promoVal = parseFloat(row.querySelector('.v-row-promo')?.value);
        if (!isNaN(promoVal) && promoVal > 0) {
            hasPromo = true;
            if (promoVal < minPromoPrice) {
                minPromoPrice = promoVal;
            }
        }
    });

    if (isFinite(minPrice)) {
        pPrice.value = minPrice;
    }

    const pPromoPrice = $('p-promo-price');
    const pIsPromo = $('p-is-promo');
    if (pIsPromo && pIsPromo.checked && pPromoPrice) {
        if (hasPromo && isFinite(minPromoPrice)) {
            pPromoPrice.value = minPromoPrice;
        }
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
        const promoInput = row.querySelector('.v-row-promo')?.value;
        const promoPrice = (promoInput !== undefined && promoInput !== '' && !isNaN(parseFloat(promoInput)) && parseFloat(promoInput) > 0)
            ? parseFloat(promoInput)
            : null;

        if (name) {
            variants.push({
                id,
                name,
                price,
                promo_price: promoPrice
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
    updateVariantsPromoVisibility();
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

    updateVariantsPromoVisibility();
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

