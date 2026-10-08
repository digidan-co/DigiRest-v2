/**
 * DigiRest - Client & Display Menu View Module
 * Redesigned with:
 * - Promociones destacadas (precio de oferta & regular tachado)
 * - Recomendados de la casa (favoritos del chef)
 * - Los más pedidos (estadísticas de los últimos 7 días)
 * - Selector interactivo de toppings / adiciones para el cliente
 * - Vista Display adaptada para monitores / TV sin botones de compra
 */

import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, showModalAlert, setLoading } from '../components/ui.js';
import { createOrder } from '../services/order-service.js';
import { compressProof } from '../utils/image-utils.js';
import { getTopDishes7d } from '../services/product-service.js';

let currentDisplayCategory = 'Todos';
let currentClientCategory = 'Todos';
let _clientSearchTerm = '';
let _displaySearchTerm = '';

/**
 * Ensure 7-day top dishes are loaded into state
 */
async function ensureTopDishesLoaded() {
    if (!state.topDishes7d || state.topDishes7d.length === 0) {
        try {
            state.topDishes7d = await getTopDishes7d();
        } catch (err) {
            console.error("Error cargando platos más pedidos:", err);
            state.topDishes7d = [];
        }
    }
    return state.topDishes7d;
}

// ====================================================================
// DISPLAY VIEW (Monitor / TV Digital Menu Board)
// ====================================================================

export async function renderDisplayView() {
    await ensureTopDishesLoaded();

    const catContainer = $('display-category-filters');
    if (catContainer) {
        const hasPromos = (state.products || []).some(p => p.available && p.is_promo);
        const hasRecommended = (state.products || []).some(p => p.available && p.is_recommended);
        const hasTopDishes = (state.topDishes7d || []).length > 0;

        let catHtml = `<button class="display-filter-btn filter-chip filter-chip-default active" data-cat="Todos">Todos</button>`;

        if (hasPromos) {
            catHtml += `<button class="display-filter-btn filter-chip filter-chip-promo" data-cat="🔥 Promos"><i class="fas fa-fire"></i>Promos</button>`;
        }
        if (hasRecommended) {
            catHtml += `<button class="display-filter-btn filter-chip filter-chip-rec" data-cat="⭐ Recomendados"><i class="fas fa-star"></i>Recomendados</button>`;
        }
        if (hasTopDishes) {
            catHtml += `<button class="display-filter-btn filter-chip filter-chip-top" data-cat="🏆 Más Pedidos"><i class="fas fa-trophy"></i>Más Pedidos</button>`;
        }

        (state.categories || []).forEach(c => {
            catHtml += `<button class="display-filter-btn filter-chip filter-chip-default" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`;
        });

        catContainer.innerHTML = catHtml;

        catContainer.querySelectorAll('.display-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                catContainer.querySelectorAll('.display-filter-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                renderDisplayGrid(target.dataset.cat);
            });
        });
    }

    // Display search listener
    const displaySearchInput = $('display-search');
    if (displaySearchInput && !displaySearchInput.hasAttribute('data-listening')) {
        displaySearchInput.setAttribute('data-listening', 'true');
        displaySearchInput.addEventListener('input', (e) => {
            _displaySearchTerm = e.target.value;
            const activeBtn = document.querySelector('.display-filter-btn.bg-gray-900');
            const cat = activeBtn ? activeBtn.dataset.cat : 'Todos';
            renderDisplayGrid(cat);
        });
    }

    // Sync status to display view header
    updateDisplayStatus();
    updateDisplayStatus2();

    renderDisplayGrid('Todos');
}

export function updateDisplayStatus() {
    const container = $('display-status-container');
    const nameEl = $('display-restaurant-name');

    if (nameEl) {
        nameEl.textContent = state.restaurantData.name || state.config.restaurantName || "Restaurante";
    }

    if (!container) return;
    container.innerHTML = '';

    const isOpen = state.restaurantData.isOpen !== false;
    const statusEl = document.createElement('div');
    statusEl.className = `relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mt-2 w-fit ${isOpen ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
    statusEl.innerHTML = `
        <div class="w-2 h-2 rounded-full bg-white ${isOpen ? 'animate-pulse' : ''}"></div>
        <span>${isOpen ? 'Abierto' : 'Cerrado'}</span>
    `;
    container.appendChild(statusEl);
}

export function updateDisplayStatus2() {
    const container = $('display-status-container-2');
    const nameEl = $('display-restaurant-name-2');

    if (nameEl) {
        nameEl.textContent = state.restaurantData.name || state.config.restaurantName || "Restaurante";
    }

    if (!container) return;
    container.innerHTML = '';

    const isOpen = state.restaurantData.isOpen !== false;
    const statusEl = document.createElement('div');
    statusEl.className = `relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mt-2 w-fit ${isOpen ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`;
    statusEl.innerHTML = `
        <div class="w-2 h-2 rounded-full bg-white ${isOpen ? 'animate-pulse' : ''}"></div>
        <span>${isOpen ? 'Abierto' : 'Cerrado'}</span>
    `;
    container.appendChild(statusEl);
}

export function renderDisplayGrid(category, searchTerm) {
    if (searchTerm !== undefined) _displaySearchTerm = searchTerm;
    currentDisplayCategory = category || 'Todos';

    const featuredContainer = $('display-featured-sections');
    const regularHeader = $('display-regular-header');
    const regularTitle = $('display-regular-title');
    const countBadge = $('display-count-badge');
    const grid = $('display-grid');

    const search = (_displaySearchTerm || '').toLowerCase().trim();
    const isDefaultAll = currentDisplayCategory === 'Todos' && !search;

    const availableProducts = (state.products || []).filter(p => p.available !== 0 && p.available !== false);

    if (isDefaultAll) {
        // 1. Promociones
        const promoDishes = availableProducts.filter(p => p.is_promo);
        const recDishes = availableProducts.filter(p => p.is_recommended);
        const topDishes = (state.topDishes7d || []).filter(p => p.available !== 0 && p.available !== false).slice(0, 8);
        const hasAnyFeatured = promoDishes.length > 0 || recDishes.length > 0 || topDishes.length > 0;

        if (featuredContainer) {
            if (hasAnyFeatured) featuredContainer.classList.remove('hidden');
            else featuredContainer.classList.add('hidden');
        }

        const promoSection = $('display-section-promos');
        const promoSlider = $('display-promos-slider');
        if (promoSection && promoSlider) {
            if (promoDishes.length > 0) {
                promoSection.classList.remove('hidden');
                promoSlider.innerHTML = promoDishes.map(p => createDishCardHtml(p, { isDisplay: true, isPromo: true })).join('');
            } else {
                promoSection.classList.add('hidden');
            }
        }

        // 2. Recomendados
        const recSection = $('display-section-recommended');
        const recSlider = $('display-recommended-slider');
        if (recSection && recSlider) {
            if (recDishes.length > 0) {
                recSection.classList.remove('hidden');
                recSlider.innerHTML = recDishes.map(p => createDishCardHtml(p, { isDisplay: true, isRec: true })).join('');
            } else {
                recSection.classList.add('hidden');
            }
        }

        // 3. Los más pedidos (últimos 7 días)
        const topSection = $('display-section-top-dishes');
        const topSlider = $('display-top-dishes-slider');
        if (topSection && topSlider) {
            if (topDishes.length > 0) {
                topSection.classList.remove('hidden');
                topSlider.innerHTML = topDishes.map((p, idx) => createDishCardHtml(p, { isDisplay: true, isTop: true, rank: idx + 1 })).join('');
            } else {
                topSection.classList.add('hidden');
            }
        }

        if (regularTitle) regularTitle.innerText = "Nuestra Carta Completa";
    } else {
        if (featuredContainer) featuredContainer.classList.add('hidden');

        if (regularTitle) {
            if (search) regularTitle.innerText = `Resultados de búsqueda: "${_displaySearchTerm}"`;
            else if (category === '🔥 Promos') regularTitle.innerText = "🔥 Promociones Especiales";
            else if (category === '⭐ Recomendados') regularTitle.innerText = "⭐ Recomendados de la Casa";
            else if (category === '🏆 Más Pedidos') regularTitle.innerText = "🏆 Los Más Pedidos de la Semana";
            else regularTitle.innerText = category;
        }
    }

    // Filter dishes for regular grid
    let filtered = availableProducts.filter(p => {
        let matchesCategory = true;
        if (currentDisplayCategory === 'Todos') matchesCategory = true;
        else if (currentDisplayCategory === '🔥 Promos') matchesCategory = Boolean(p.is_promo);
        else if (currentDisplayCategory === '⭐ Recomendados') matchesCategory = Boolean(p.is_recommended);
        else if (currentDisplayCategory === '🏆 Más Pedidos') matchesCategory = (state.topDishes7d || []).some(t => t.id === p.id);
        else matchesCategory = p.category === currentDisplayCategory;

        const matchesSearch = !search ||
            (p.name || '').toLowerCase().includes(search) ||
            (p.desc && p.desc.toLowerCase().includes(search));

        return matchesCategory && matchesSearch;
    });

    if (currentDisplayCategory === 'Todos') {
        filtered = filtered.sort((a, b) => {
            if (a.category !== b.category) return a.category.localeCompare(b.category, 'es');
            return a.name.localeCompare(b.name, 'es');
        });
    }

    if (countBadge) countBadge.innerText = `${filtered.length} platos`;

    if (!grid) return;
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 opacity-50 text-gray-500 font-medium">Sin platos disponibles en esta selección.</div>';
        return;
    }

    grid.innerHTML = filtered.map(p => createDishCardHtml(p, { isDisplay: true })).join('');

    // Attach click handler to open detail modal
    document.querySelectorAll('.client-product-card').forEach(card => {
        card.addEventListener('click', () => {
            openDisplayDetail(card.dataset.id, card);
        });
    });
}

export function openDisplayDetail(id, cardElement) {
    const product = (state.products || []).find(p => p.id === id);
    if (!product) return;

    const modal = $('display-detail-modal');
    const modalCard = $('display-detail-card');
    if (!modal || !modalCard) return;

    const imgEl = $('display-img');
    const hasImage = Boolean(product.img && product.img.trim() && product.img !== 'img/placeholder-dish.svg');

    if (imgEl) {
        imgEl.src = product.img || 'img/placeholder-dish.svg';
        if (!hasImage) {
            imgEl.classList.add('opacity-40');
        } else {
            imgEl.classList.remove('opacity-40');
        }
    }

    $('display-title').innerText = product.name;
    $('display-category').innerText = product.category;
    $('display-desc').innerText = product.desc || "Delicioso plato preparado con los mejores ingredientes de la casa.";

    const badgeExtra = $('display-badge-extra');
    if (badgeExtra) {
        if (product.has_variants && product.has_toppings) {
            badgeExtra.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 bg-indigo-100 px-2.5 py-0.5 rounded-full';
            badgeExtra.innerHTML = '<i class="fas fa-layer-group text-[10px] text-indigo-600"></i><i class="fas fa-cookie-bite text-[10px] text-amber-600"></i> Tamaños y Adiciones';
            badgeExtra.classList.remove('hidden');
        } else if (product.has_variants) {
            badgeExtra.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 bg-indigo-100 px-2.5 py-0.5 rounded-full';
            badgeExtra.innerHTML = '<i class="fas fa-layer-group text-[10px] text-indigo-600"></i> Múltiples Tamaños';
            badgeExtra.classList.remove('hidden');
        } else if (product.has_toppings) {
            badgeExtra.className = 'inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full';
            badgeExtra.innerHTML = '<i class="fas fa-cookie-bite text-[10px]"></i> Personalizable';
            badgeExtra.classList.remove('hidden');
        } else if (product.is_promo) {
            badgeExtra.className = 'inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full';
            badgeExtra.innerHTML = '<i class="fas fa-fire text-[10px]"></i> Promoción';
            badgeExtra.classList.remove('hidden');
        } else if (product.is_recommended) {
            badgeExtra.className = 'inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-200 px-2.5 py-0.5 rounded-full';
            badgeExtra.innerHTML = '<i class="fas fa-star text-[10px]"></i> Recomendado';
            badgeExtra.classList.remove('hidden');
        } else {
            badgeExtra.classList.add('hidden');
        }
    }

    const priceContainer = $('display-price');
    if (priceContainer) {
        if (product.has_variants) {
            priceContainer.innerHTML = `
                <div class="flex items-baseline gap-1.5">
                    <span class="text-xs font-bold text-gray-400 uppercase">Desde</span>
                    <span class="text-2xl sm:text-3xl font-extrabold text-gray-900">${formatMoney(product.price)}</span>
                </div>
            `;
        } else if (product.is_promo && product.promo_price) {
            priceContainer.innerHTML = `
                <div class="flex items-baseline gap-2">
                    <span class="text-2xl sm:text-3xl font-extrabold text-red-600">${formatMoney(product.promo_price)}</span>
                    <span class="text-xs sm:text-sm text-gray-400 line-through">${formatMoney(product.price)}</span>
                </div>
            `;
        } else {
            priceContainer.innerText = formatMoney(product.price);
        }
    }

    const closeHandler = () => {
        modalCard.classList.remove('scale-100', 'opacity-100');
        modalCard.classList.add('scale-90', 'opacity-0');
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    // Client ordering button inside detail modal
    const addBtn = $('btn-display-modal-add');
    const addText = $('btn-display-modal-add-text');
    if (addBtn) {
        const isClientView = !$('client-view')?.classList.contains('hidden');
        if (isClientView) {
            addBtn.classList.remove('hidden');
            if (addText) {
                addText.innerText = (product.has_variants || product.has_toppings) ? 'Elegir Opciones' : 'Añadir al Pedido';
            }
            addBtn.onclick = () => {
                closeHandler();
                addToCart(product.id);
            };
        } else {
            addBtn.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');

    modalCard.classList.remove('scale-90', 'opacity-0');
    modalCard.classList.add('scale-100', 'opacity-100');

    const closeBtn = $('btn-close-display');
    if (closeBtn) closeBtn.onclick = closeHandler;
    modal.onclick = (e) => {
        if (e.target === modal) closeHandler();
    };
}

// ====================================================================
// CLIENT ORDERING VIEW
// ====================================================================

export async function renderClientView() {
    setupClientToppingsModalListeners();
    await ensureTopDishesLoaded();

    // Client search listener
    const searchInput = $('menu-search');
    if (searchInput) {
        const newInput = searchInput.cloneNode(true);
        searchInput.parentNode.replaceChild(newInput, searchInput);
        newInput.addEventListener('input', (e) => {
            _clientSearchTerm = e.target.value;
            const activeBtn = document.querySelector('.filter-btn.active');
            const cat = activeBtn ? activeBtn.dataset.cat : 'Todos';
            renderMenuGrid(cat);
        });
    }

    // Category filters container
    const catContainer = $('category-filters');
    if (catContainer) {
        const hasPromos = (state.products || []).some(p => p.available && p.is_promo);
        const hasRecommended = (state.products || []).some(p => p.available && p.is_recommended);
        const hasTopDishes = (state.topDishes7d || []).length > 0;

        let catHtml = `<button class="filter-btn filter-chip filter-chip-default active" data-cat="Todos">Todos</button>`;

        if (hasPromos) {
            catHtml += `<button class="filter-btn filter-chip filter-chip-promo" data-cat="🔥 Promos"><i class="fas fa-fire mr-1 text-xs"></i>Promos</button>`;
        }
        if (hasRecommended) {
            catHtml += `<button class="filter-btn filter-chip filter-chip-rec" data-cat="⭐ Recomendados"><i class="fas fa-star mr-1 text-xs"></i>Recomendados</button>`;
        }
        if (hasTopDishes) {
            catHtml += `<button class="filter-btn filter-chip filter-chip-top" data-cat="🏆 Más Pedidos"><i class="fas fa-trophy mr-1 text-xs"></i>Más Pedidos</button>`;
        }

        (state.categories || []).forEach(c => {
            catHtml += `<button class="filter-btn filter-chip filter-chip-default" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)}</button>`;
        });

        catContainer.innerHTML = catHtml;

        catContainer.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                catContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                renderMenuGrid(target.dataset.cat);
            });
        });
    }

    setupCarouselNavButtons();
    updateClientStatus();
    renderMenuGrid('Todos');

    if (window.updateReturnToPanelButton) {
        window.updateReturnToPanelButton();
    }
}

export function updateClientStatus() {
    // ClientView is managed by Vue SFC (ClientView.vue), which reactively renders the status badge.
    // Remove any legacy injected badge if present to prevent duplicates.
    const statusEl = document.getElementById('client-status-badge');
    if (statusEl) statusEl.remove();

    if (typeof updateDisplayStatus === 'function') {
        updateDisplayStatus();
    }
}
window.updateClientStatus = updateClientStatus;

export function setupCarouselNavButtons() {
    document.querySelectorAll('.carousel-nav-btn').forEach(btn => {
        if (btn.hasAttribute('data-listening')) return;
        btn.setAttribute('data-listening', 'true');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetId = btn.dataset.target;
            const dir = parseInt(btn.dataset.dir || '1', 10);
            const slider = $(targetId);
            if (slider) {
                const scrollStep = Math.max(slider.clientWidth * 0.75, 260);
                slider.scrollBy({ left: dir * scrollStep, behavior: 'smooth' });
            }
        });
    });
}

export function renderMenuGrid(category, searchTerm) {
    if (searchTerm !== undefined) _clientSearchTerm = searchTerm;
    currentClientCategory = category || 'Todos';

    const featuredContainer = $('client-featured-sections');
    const regularHeader = $('menu-regular-header');
    const regularTitle = $('menu-regular-title');
    const countBadge = $('menu-count-badge');
    const grid = $('menu-grid');

    const search = (_clientSearchTerm || '').toLowerCase().trim();
    const isDefaultAll = currentClientCategory === 'Todos' && !search;

    const availableProducts = (state.products || []).filter(p => p.available !== 0 && p.available !== false);

    if (isDefaultAll) {
        // 1. Promociones
        const promoDishes = availableProducts.filter(p => p.is_promo);
        const recDishes = availableProducts.filter(p => p.is_recommended);
        const topDishes = (state.topDishes7d || []).filter(p => p.available !== 0 && p.available !== false).slice(0, 8);
        const hasAnyFeatured = promoDishes.length > 0 || recDishes.length > 0 || topDishes.length > 0;

        if (featuredContainer) {
            if (hasAnyFeatured) featuredContainer.classList.remove('hidden');
            else featuredContainer.classList.add('hidden');
        }

        const promoSection = $('section-promos');
        const promoSlider = $('promos-slider');
        if (promoSection && promoSlider) {
            if (promoDishes.length > 0) {
                promoSection.classList.remove('hidden');
                promoSlider.innerHTML = promoDishes.map(p => createDishSliderCardHtml(p, { isPromo: true })).join('');
            } else {
                promoSection.classList.add('hidden');
            }
        }

        // 2. Recomendados
        const recSection = $('section-recommended');
        const recSlider = $('recommended-slider');
        if (recSection && recSlider) {
            if (recDishes.length > 0) {
                recSection.classList.remove('hidden');
                recSlider.innerHTML = recDishes.map(p => createDishSliderCardHtml(p, { isRec: true })).join('');
            } else {
                recSection.classList.add('hidden');
            }
        }

        // 3. Los más pedidos (últimos 7 días)
        const topSection = $('section-top-dishes');
        const topSlider = $('top-dishes-slider');
        if (topSection && topSlider) {
            if (topDishes.length > 0) {
                topSection.classList.remove('hidden');
                topSlider.innerHTML = topDishes.map((p, idx) => createDishSliderCardHtml(p, { isTop: true, rank: idx + 1 })).join('');
            } else {
                topSection.classList.add('hidden');
            }
        }

        if (regularTitle) regularTitle.innerText = "Nuestra Carta Completa";
    } else {
        if (featuredContainer) featuredContainer.classList.add('hidden');

        if (regularTitle) {
            if (search) regularTitle.innerText = `Resultados para: "${_clientSearchTerm}"`;
            else if (category === '🔥 Promos') regularTitle.innerText = "🔥 Promociones Especiales";
            else if (category === '⭐ Recomendados') regularTitle.innerText = "⭐ Recomendados de la Casa";
            else if (category === '🏆 Más Pedidos') regularTitle.innerText = "🏆 Los Más Pedidos de la Semana";
            else regularTitle.innerText = category;
        }
    }

    // Filter dishes for regular grid
    let filtered = availableProducts.filter(p => {
        let matchesCategory = true;
        if (currentClientCategory === 'Todos') matchesCategory = true;
        else if (currentClientCategory === '🔥 Promos') matchesCategory = Boolean(p.is_promo);
        else if (currentClientCategory === '⭐ Recomendados') matchesCategory = Boolean(p.is_recommended);
        else if (currentClientCategory === '🏆 Más Pedidos') matchesCategory = (state.topDishes7d || []).some(t => t.id === p.id);
        else matchesCategory = p.category === currentClientCategory;

        const matchesSearch = !search ||
            (p.name || '').toLowerCase().includes(search) ||
            (p.desc && p.desc.toLowerCase().includes(search));

        return matchesCategory && matchesSearch;
    });

    if (currentClientCategory === 'Todos') {
        filtered = filtered.sort((a, b) => {
            if (a.category !== b.category) return a.category.localeCompare(b.category, 'es');
            return a.name.localeCompare(b.name, 'es');
        });
    }

    if (countBadge) countBadge.innerText = `${filtered.length} platos`;

    if (!grid) return;
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 opacity-50 text-gray-500 font-medium">Sin platos disponibles.</div>';
        return;
    }

    grid.innerHTML = filtered.map(p => createDishCardHtml(p)).join('');

    setupCarouselNavButtons();

    // Attach listeners
    document.querySelectorAll('.add-cart-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToCart(btn.dataset.id);
        });
    });

    document.querySelectorAll('.client-product-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.add-cart-btn')) return;
            const id = card.dataset.id;
            openDisplayDetail(id, card);
        });
    });
}

/**
 * Creates HTML for horizontal slider cards (Promos, Recomendados, Más Pedidos)
 */
function createDishSliderCardHtml(p, { isPromo = false, isRec = false, isTop = false, rank = 0 } = {}) {
    const effectivePrice = (p.is_promo && p.promo_price) ? p.promo_price : p.price;
    const hasDiscount = p.is_promo && p.promo_price && p.promo_price < p.price;

    return `
        <div class="client-product-card w-40 sm:w-44 md:w-48 shrink-0 snap-start bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group cursor-pointer h-[255px] sm:h-[270px]" data-id="${p.id}">
            <div class="aspect-square w-full relative bg-gray-50 overflow-hidden shrink-0">
                <img src="${p.img || 'img/placeholder-dish.svg'}" alt="Foto de ${escapeHtml(p.name)}" loading="lazy"
                    class="display-img-target w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                
                ${hasDiscount ? `
                    <span class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">
                        ¡Oferta!
                    </span>
                ` : ''}

                ${!hasDiscount && isRec ? `
                    <span class="badge-recommended absolute top-2 left-2 px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider text-white shadow-xs flex items-center gap-1" style="background-color: #d97706; color: #ffffff;">
                        <i class="fas fa-star text-[8px] text-amber-200"></i> Recomendado
                    </span>
                ` : ''}

                ${isTop && rank ? `
                    <span class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black bg-orange-500 text-white shadow-xs">
                        #${rank} Más Pedido
                    </span>
                ` : ''}

                ${(p.has_variants && p.has_toppings) ? `
                    <span class="absolute top-2 right-2 px-1.5 h-6 rounded-full bg-white text-gray-800 shadow-sm flex items-center justify-center gap-1 border border-gray-100/80 z-10 pointer-events-none" title="Tamaños disponibles y personalizable">
                        <i class="fas fa-layer-group text-[10px] text-indigo-600"></i>
                        <i class="fas fa-cookie-bite text-[10px] text-amber-600"></i>
                    </span>
                ` : p.has_variants ? `
                    <span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-indigo-600 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Múltiples tamaños disponibles">
                        <i class="fas fa-layer-group text-[11px]"></i>
                    </span>
                ` : p.has_toppings ? `
                    <span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-amber-700 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Personalizable con opciones">
                        <i class="fas fa-cookie-bite text-[11px]"></i>
                    </span>
                ` : ''}

                ${p.order_count_7d > 0 ? `
                    <span class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-black/60 backdrop-blur-md text-white shadow-xs">
                        🔥 ${p.order_count_7d} pedidos
                    </span>
                ` : ''}
            </div>

            <div class="p-2 sm:p-2.5 flex flex-col flex-1 justify-between min-h-0">
                <div>
                    <h4 class="font-bold text-gray-800 text-xs sm:text-sm leading-snug line-clamp-2" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h4>
                </div>

                <div class="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1.5 shrink-0">
                    <div>
                        ${p.has_variants ? `
                            <div class="flex items-baseline gap-1">
                                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wide leading-none">Desde</span>
                                <span class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                            </div>
                        ` : hasDiscount ? `
                            <div class="flex items-baseline gap-1.5">
                                <span class="font-black text-red-600 text-sm sm:text-base leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                                <span class="text-[10px] text-gray-400 line-through leading-none">${formatMoney(p.price)}</span>
                            </div>
                        ` : `
                            <span class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                        `}
                    </div>
                    <button class="add-cart-btn w-full py-2 px-3 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer bg-gray-900 hover:bg-orange-500" data-id="${p.id}" title="${(p.has_variants || p.has_toppings) ? 'Elegir opciones' : 'Añadir al pedido'}">
                        <i class="fas fa-plus text-xs pointer-events-none"></i>
                        <span class="text-xs sm:text-sm font-extrabold leading-none">Agregar</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Creates HTML for standard dish cards (both for client grid and display grid)
 */
function createDishCardHtml(p, { isDisplay = false, isPromo = false, isRec = false, isTop = false, rank = 0 } = {}) {
    const effectivePrice = (p.is_promo && p.promo_price) ? p.promo_price : p.price;
    const hasDiscount = p.is_promo && p.promo_price && p.promo_price < p.price;

    return `
        <div class="client-product-card cursor-pointer bg-white p-3 sm:p-3.5 rounded-2xl shadow-xs border border-gray-100 flex items-center sm:items-stretch gap-3 hover:shadow-md transition-all group overflow-hidden relative" data-id="${p.id}">
            <!-- Desktop/Tablet Thumbnail (Hidden on mobile <sm) -->
            <div class="hidden sm:block sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-xl overflow-hidden shrink-0 bg-gray-50 relative">
                <img src="${p.img || 'img/placeholder-dish.svg'}" alt="Foto de ${escapeHtml(p.name)}" loading="lazy"
                    class="display-img-target w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                
                ${hasDiscount ? `
                    <span class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">
                        Promo
                    </span>
                ` : ''}

                ${!hasDiscount && (p.is_recommended || isRec) ? `
                    <span class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-bold bg-amber-400 text-amber-950 shadow-xs flex items-center gap-0.5">
                        <i class="fas fa-star text-[7px]"></i> Top
                    </span>
                ` : ''}

                ${isTop && rank ? `
                    <span class="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black bg-orange-500 text-white shadow-xs">
                        #${rank}
                    </span>
                ` : ''}
            </div>

            <!-- Main Body (Responsive: Mobile Compact Row vs Desktop Card) -->
            <div class="flex-1 flex flex-row sm:flex-col justify-between items-center sm:items-stretch h-full min-w-0 gap-2 sm:gap-0 sm:py-0.5">
                <!-- Text Details -->
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <span class="text-[9px] font-bold text-orange-500 uppercase tracking-wider truncate">${escapeHtml(p.category)}</span>
                        ${hasDiscount ? `
                            <span class="sm:hidden px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-red-100 text-red-700">
                                Promo
                            </span>
                        ` : ''}
                        ${(p.has_variants && p.has_toppings) ? `
                            <span class="sm:hidden text-[8px] font-bold text-indigo-900 bg-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <i class="fas fa-layer-group text-[7px] text-indigo-600"></i><i class="fas fa-cookie-bite text-[7px] text-amber-600"></i> Opciones
                            </span>
                        ` : p.has_variants ? `
                            <span class="sm:hidden text-[8px] font-bold text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <i class="fas fa-layer-group text-[7px]"></i> Tamaños
                            </span>
                        ` : p.has_toppings ? `
                            <span class="sm:hidden text-[8px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                                Toppings
                            </span>
                        ` : ''}
                    </div>
                    <h3 class="font-bold text-gray-800 text-sm leading-tight truncate sm:whitespace-normal sm:line-clamp-1">${escapeHtml(p.name)}</h3>
                    <!-- Description: Hidden on mobile (<sm), shown on desktop -->
                    <p class="hidden sm:block text-[10px] text-gray-400 leading-tight line-clamp-2 mt-0.5">${escapeHtml(p.desc || '')}</p>
                    ${(p.has_variants && p.has_toppings) ? `
                        <div class="hidden sm:block mt-1">
                            <span class="inline-flex items-center text-[9px] font-semibold text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60 gap-1">
                                <i class="fas fa-layer-group text-[8px] text-indigo-600"></i>
                                <i class="fas fa-cookie-bite text-[8px] text-amber-600"></i>
                                Tamaños y Adiciones
                            </span>
                        </div>
                    ` : p.has_variants ? `
                        <div class="hidden sm:block mt-1">
                            <span class="inline-flex items-center text-[9px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60">
                                <i class="fas fa-layer-group mr-1 text-[8px]"></i>Múltiples Tamaños
                            </span>
                        </div>
                    ` : p.has_toppings ? `
                        <div class="hidden sm:block mt-1">
                            <span class="inline-flex items-center text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60">
                                <i class="fas fa-cookie-bite mr-1 text-[8px]"></i>Personalizable
                            </span>
                        </div>
                    ` : ''}
                </div>

                <!-- Price and Add Button -->
                <div class="flex sm:justify-between items-center gap-2.5 sm:gap-0 sm:mt-2 sm:pt-1 sm:border-t sm:border-gray-50 shrink-0">
                    <div class="text-right sm:text-left">
                        ${p.has_variants ? `
                            <div class="flex items-baseline gap-1">
                                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wide leading-none">Desde</span>
                                <span class="font-black text-gray-900 text-base sm:text-lg leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                            </div>
                        ` : hasDiscount ? `
                            <div class="flex flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
                                <span class="font-black text-red-600 text-base sm:text-lg leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                                <span class="text-[10px] text-gray-400 line-through leading-none">${formatMoney(p.price)}</span>
                            </div>
                        ` : `
                            <span class="font-black text-gray-900 text-base sm:text-lg leading-none tracking-tight">${formatMoney(effectivePrice)}</span>
                        `}
                    </div>
                    ${!isDisplay ? `
                        <button class="add-cart-btn px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold bg-gray-900 hover:bg-orange-500 text-white flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95 cursor-pointer ml-1 sm:ml-0 shrink-0" data-id="${p.id}" title="${(p.has_variants || p.has_toppings) ? 'Elegir opciones' : 'Añadir al pedido'}">
                            <i class="fas fa-plus text-xs pointer-events-none"></i>
                            <span class="leading-none text-xs sm:text-sm font-extrabold">Agregar</span>
                        </button>
                    ` : '<div class="w-6 h-6"></div>'}
                </div>
            </div>
        </div>
    `;
}

// ====================================================================
// CLIENT TOPPINGS CUSTOMIZATION MODAL
// ====================================================================

let _currentCustomizingProduct = null;
let _ctmCustomCallback = null;
let _ctmQty = 1;
let _ctmMandatoryGroups = [];
let _ctmOptionalGroups = [];
let _ctmAllOptionalItems = [];
let _ctmSelectedMandatory = new Map(); // groupName -> toppingId
let _ctmSelectedOptionalIds = new Set(); // Set of toppingId
let _ctmVariants = [];
let _ctmSelectedVariantId = null;

export function setupClientToppingsModalListeners() {
    const btnClose = $('btn-close-ctm');
    if (btnClose) btnClose.onclick = closeClientToppingsModal;

    const modal = $('client-toppings-modal');
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeClientToppingsModal();
        };
    }

    const btnMinus = $('btn-ctm-minus');
    if (btnMinus) {
        btnMinus.onclick = () => {
            if (_ctmQty > 1) {
                _ctmQty--;
                if ($('ctm-qty')) $('ctm-qty').innerText = _ctmQty;
                updateClientToppingsTotal();
            }
        };
    }

    const btnPlus = $('btn-ctm-plus');
    if (btnPlus) {
        btnPlus.onclick = () => {
            _ctmQty++;
            if ($('ctm-qty')) $('ctm-qty').innerText = _ctmQty;
            updateClientToppingsTotal();
        };
    }

    const btnAddCart = $('btn-ctm-add-cart');
    if (btnAddCart) {
        btnAddCart.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleAddCustomizedDishToCart();
        };
    }

    // Sub-modal listeners (Adicionar Toppings)
    const btnCloseCotm = $('btn-close-cotm');
    if (btnCloseCotm) btnCloseCotm.onclick = closeOptionalToppingsModal;

    const modalCotm = $('client-optional-toppings-modal');
    if (modalCotm) {
        modalCotm.onclick = (e) => {
            if (e.target === modalCotm) closeOptionalToppingsModal();
        };
    }

    const btnConfirmCotm = $('btn-confirm-optional-toppings');
    if (btnConfirmCotm) {
        btnConfirmCotm.onclick = () => {
            closeOptionalToppingsModal();
            renderSelectedOptionalChips();
            updateClientToppingsTotal();
        };
    }
}

export function openClientToppingsModal(product, { onConfirm = null } = {}) {
    _currentCustomizingProduct = product;
    _ctmCustomCallback = onConfirm;
    _ctmQty = 1;
    _ctmSelectedMandatory = new Map();
    _ctmSelectedOptionalIds = new Set();
    _ctmMandatoryGroups = [];
    _ctmOptionalGroups = [];
    _ctmAllOptionalItems = [];
    _ctmVariants = [];
    _ctmSelectedVariantId = null;

    setupClientToppingsModalListeners();

    const modal = $('client-toppings-modal');
    if (!modal) return;

    if ($('ctm-dish-name')) $('ctm-dish-name').innerText = product.name;
    if ($('ctm-dish-category')) $('ctm-dish-category').innerText = product.category;
    if ($('ctm-dish-img')) $('ctm-dish-img').src = product.img || 'img/placeholder-dish.svg';

    // Parse dish variants (Sizes / Portions)
    if (product.has_variants) {
        if (typeof product.variants_config === 'string') {
            try {
                _ctmVariants = JSON.parse(product.variants_config) || [];
            } catch (e) {
                _ctmVariants = [];
            }
        } else if (Array.isArray(product.variants_config)) {
            _ctmVariants = product.variants_config;
        }
    }

    if (_ctmVariants.length > 0) {
        const def = _ctmVariants.find(v => v.is_default) || _ctmVariants[0];
        _ctmSelectedVariantId = String(def.id || def.name);
    }

    let basePrice = (product.is_promo && product.promo_price) ? product.promo_price : product.price;
    if (_ctmVariants.length > 0) {
        const selVar = _ctmVariants.find(v => String(v.id || v.name) === String(_ctmSelectedVariantId));
        if (selVar) basePrice = selVar.price;
    }
    if ($('ctm-dish-base-price')) $('ctm-dish-base-price').innerText = formatMoney(basePrice);

    const origEl = $('ctm-dish-orig-price');
    if (origEl) {
        if (product.is_promo && product.promo_price && _ctmVariants.length === 0) {
            origEl.innerText = formatMoney(product.price);
            origEl.classList.remove('hidden');
        } else {
            origEl.classList.add('hidden');
        }
    }

    if ($('ctm-qty')) $('ctm-qty').innerText = '1';
    if ($('ctm-dish-notes')) $('ctm-dish-notes').value = '';

    // Parse toppings_config
    let configs = [];
    if (typeof product.toppings_config === 'string') {
        try {
            configs = JSON.parse(product.toppings_config) || [];
        } catch (e) {
            configs = [];
        }
    } else if (Array.isArray(product.toppings_config)) {
        configs = product.toppings_config;
    }

    const container = $('ctm-toppings-container');
    if (!container) return;

    if ((!configs || configs.length === 0) && _ctmVariants.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 bg-white rounded-2xl border border-gray-100">
                <p class="text-xs text-gray-500">Este plato no tiene opciones ni adiciones configuradas actualmente.</p>
            </div>
        `;
        updateClientToppingsTotal();
        modal.classList.remove('hidden');
        return;
    }

    // Separate mandatory vs optional
    const mandMap = new Map();
    const optMap = new Map();
    const allOpt = [];

    configs.forEach((item, idx) => {
        if (!item || typeof item !== 'object' || !item.name) return;
        const id = item.id !== undefined ? String(item.id) : `top_${idx}`;
        const name = String(item.name).trim();
        if (!name) return;
        const groupName = (item.group_name || 'Adiciones').trim();
        const isRequired = item.is_required === true || item.is_required === 1 || item.is_required === '1';
        const price = isRequired ? 0 : (Number(item.price) || 0);

        if (isRequired) {
            if (!mandMap.has(groupName)) {
                mandMap.set(groupName, { name: groupName, items: [] });
            }
            mandMap.get(groupName).items.push({ id, name, group_name: groupName, price: 0, is_required: true });
        } else {
            if (!optMap.has(groupName)) {
                optMap.set(groupName, { name: groupName, items: [] });
            }
            const optItem = { id, name, group_name: groupName, price, is_required: false };
            optMap.get(groupName).items.push(optItem);
            allOpt.push(optItem);
        }
    });

    _ctmMandatoryGroups = Array.from(mandMap.values());
    _ctmOptionalGroups = Array.from(optMap.values());
    _ctmAllOptionalItems = allOpt;

    // Preselect 1st option for each mandatory group
    _ctmMandatoryGroups.forEach(g => {
        if (g.items.length > 0) {
            _ctmSelectedMandatory.set(g.name, String(g.items[0].id));
        }
    });

    renderClientToppingsMain();
    updateClientToppingsTotal();
    modal.classList.remove('hidden');
}

function renderClientToppingsMain() {
    const container = $('ctm-toppings-container');
    if (!container) return;

    let html = '';

    // 0. Variants / Portions Selector (Mandatory if variants exist)
    if (_ctmVariants.length > 0) {
        html += `
            <fieldset class="border-2 border-indigo-200/90 rounded-2xl p-3 sm:p-4 bg-indigo-50/40 shadow-xs mb-3">
                <legend class="px-2.5 py-0.5 text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100 rounded-full border border-indigo-300 shadow-2xs flex items-center gap-1.5">
                    <i class="fas fa-layer-group text-[9px]"></i> Tamaño / Porción (Obligatorio)
                </legend>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
        `;

        _ctmVariants.forEach(v => {
            const vId = String(v.id || v.name);
            const isSelected = (_ctmSelectedVariantId === vId);
            html += `
                <div class="ctm-variant-tile flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none ${isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-950 font-bold ring-2 ring-indigo-400/40 shadow-xs' : 'bg-white border-gray-200 hover:border-indigo-300 text-gray-700'}"
                    data-id="${escapeHtml(vId)}">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="ctm-variant-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-400 bg-white'}">
                            <div class="w-1.5 h-1.5 rounded-full bg-white ${isSelected ? '' : 'hidden'}"></div>
                        </div>
                        <span class="text-xs truncate font-bold leading-tight">${escapeHtml(v.name)}</span>
                    </div>
                    <span class="text-xs font-black text-indigo-700 ml-2 shrink-0">${formatMoney(v.price)}</span>
                </div>
            `;
        });

        html += `
                </div>
            </fieldset>
        `;
    }

    // 1. Mandatory Fieldset (if mandatory toppings exist)
    if (_ctmMandatoryGroups.length > 0) {
        html += `
            <fieldset class="border border-orange-200/90 rounded-2xl p-3 sm:p-4 bg-orange-50/40 shadow-xs mb-3">
                <legend class="px-2.5 py-0.5 text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-orange-700 bg-orange-100 rounded-full border border-orange-300 shadow-2xs">
                    Obligatorios
                </legend>
                <div class="space-y-3.5 mt-1">
        `;

        _ctmMandatoryGroups.forEach(g => {
            const selectedId = _ctmSelectedMandatory.get(g.name);
            html += `
                <div class="ctm-mandatory-group" data-group-name="${escapeHtml(g.name)}">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="font-bold text-xs text-gray-800 tracking-tight">${escapeHtml(g.name)}</span>
                        <span class="text-[9px] font-bold text-orange-600 bg-orange-100/70 border border-orange-200 px-2 py-0.5 rounded-full">Elige 1</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            `;

            g.items.forEach(it => {
                const isSelected = selectedId === String(it.id);
                html += `
                    <div class="ctm-mand-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${isSelected ? 'bg-orange-50 border-orange-500 text-orange-950 font-bold ring-2 ring-orange-400/40 shadow-xs' : 'bg-white border-gray-200 hover:border-orange-300 text-gray-700'}"
                        data-group-name="${escapeHtml(g.name)}"
                        data-id="${it.id}">
                        <div class="ctm-tile-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-400 bg-white'}">
                            <div class="w-1.5 h-1.5 rounded-full bg-white ${isSelected ? '' : 'hidden'}"></div>
                        </div>
                        <span class="text-xs truncate flex-1 leading-tight">${escapeHtml(it.name)}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += `
                </div>
            </fieldset>
        `;
    }

    // 2. Button "Adicionar Toppings" (if optional toppings exist)
    if (_ctmAllOptionalItems.length > 0) {
        html += `
            <div class="space-y-2 mt-2">
                <button type="button" id="btn-open-optional-toppings"
                    class="w-full py-2.5 px-3.5 rounded-2xl border-2 border-dashed border-orange-300 hover:border-orange-500 bg-orange-50/60 hover:bg-orange-100/70 text-orange-900 font-bold text-xs sm:text-sm flex items-center justify-between transition-all cursor-pointer shadow-xs active:scale-98">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs shadow-xs shrink-0"><i class="fas fa-plus"></i></span>
                        <span class="truncate">Adicionar Toppings</span>
                    </div>
                    <span id="ctm-optional-summary-badge" class="text-[10px] sm:text-[11px] font-semibold text-orange-600 bg-white px-2.5 py-0.5 rounded-full border border-orange-200 shadow-2xs shrink-0">
                        ${_ctmSelectedOptionalIds.size > 0 ? `${_ctmSelectedOptionalIds.size} seleccionados` : 'Opcional'}
                    </span>
                </button>
                <div id="ctm-selected-optional-chips" class="flex flex-wrap gap-1.5">
                    <!-- Preview chips -->
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Attach variant tiles listeners
    container.querySelectorAll('.ctm-variant-tile').forEach(tile => {
        tile.addEventListener('click', (e) => {
            e.stopPropagation();
            const vId = String(tile.dataset.id);
            _ctmSelectedVariantId = vId;

            container.querySelectorAll('.ctm-variant-tile').forEach(t => {
                const isSel = (String(t.dataset.id) === vId);
                const radio = t.querySelector('.ctm-variant-radio');
                const dot = radio ? radio.querySelector('div') : null;

                if (isSel) {
                    t.className = 'ctm-variant-tile flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-indigo-50 border-indigo-500 text-indigo-950 font-bold ring-2 ring-indigo-400/40 shadow-xs';
                    if (radio) radio.className = 'ctm-variant-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors border-indigo-600 bg-indigo-600 text-white';
                    if (dot) dot.classList.remove('hidden');
                } else {
                    t.className = 'ctm-variant-tile flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-white border-gray-200 hover:border-indigo-300 text-gray-700';
                    if (radio) radio.className = 'ctm-variant-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors border-gray-400 bg-white';
                    if (dot) dot.classList.add('hidden');
                }
            });

            const selVar = _ctmVariants.find(v => String(v.id || v.name) === vId);
            if (selVar && $('ctm-dish-base-price')) {
                $('ctm-dish-base-price').innerText = formatMoney(selVar.price);
            }

            updateClientToppingsTotal();
        });
    });

    // Attach mandatory tiles listeners
    container.querySelectorAll('.ctm-mand-tile').forEach(tile => {
        tile.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupName = tile.dataset.groupName;
            const itemId = String(tile.dataset.id);
            _ctmSelectedMandatory.set(groupName, itemId);

            // Re-style tiles in this group
            container.querySelectorAll(`.ctm-mand-tile[data-group-name="${groupName}"]`).forEach(t => {
                const tId = String(t.dataset.id);
                const isSel = (tId === itemId);
                const radio = t.querySelector('.ctm-tile-radio');
                const dot = radio ? radio.querySelector('div') : null;

                if (isSel) {
                    t.className = 'ctm-mand-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-orange-50 border-orange-500 text-orange-950 font-bold ring-2 ring-orange-400/40 shadow-xs';
                    if (radio) radio.className = 'ctm-tile-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors border-orange-500 bg-orange-500 text-white';
                    if (dot) dot.classList.remove('hidden');
                } else {
                    t.className = 'ctm-mand-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-white border-gray-200 hover:border-orange-300 text-gray-700';
                    if (radio) radio.className = 'ctm-tile-radio w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors border-gray-400 bg-white';
                    if (dot) dot.classList.add('hidden');
                }
            });

            updateClientToppingsTotal();
        });
    });

    // Attach open optional toppings listener
    const btnOpenOpt = $('btn-open-optional-toppings');
    if (btnOpenOpt) {
        btnOpenOpt.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openOptionalToppingsModal();
        });
    }

    renderSelectedOptionalChips();
}

function renderSelectedOptionalChips() {
    const chipsContainer = $('ctm-selected-optional-chips');
    const badge = $('ctm-optional-summary-badge');
    if (badge) {
        const count = _ctmSelectedOptionalIds.size;
        badge.innerText = count > 0 ? `${count} seleccionados` : 'Opcional';
        badge.className = count > 0
            ? 'text-[10px] sm:text-[11px] font-bold text-white bg-orange-500 px-2.5 py-0.5 rounded-full shadow-2xs shrink-0'
            : 'text-[10px] sm:text-[11px] font-semibold text-orange-600 bg-white px-2.5 py-0.5 rounded-full border border-orange-200 shadow-2xs shrink-0';
    }

    if (!chipsContainer) return;

    if (_ctmSelectedOptionalIds.size === 0) {
        chipsContainer.innerHTML = '';
        return;
    }

    let chipsHtml = '';
    _ctmSelectedOptionalIds.forEach(id => {
        const item = _ctmAllOptionalItems.find(it => String(it.id) === String(id));
        if (item) {
            chipsHtml += `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-orange-100 text-orange-950 border border-orange-200 text-xs font-semibold shadow-2xs">
                    <span class="truncate max-w-[130px]">${escapeHtml(item.name)}</span>
                    ${item.price > 0 ? `<span class="text-[10px] font-extrabold text-orange-600">+${formatMoney(item.price)}</span>` : ''}
                    <button type="button" class="btn-remove-opt-chip text-gray-400 hover:text-red-500 transition-colors ml-0.5 cursor-pointer" data-id="${item.id}" title="Quitar">
                        <i class="fas fa-times-circle text-xs"></i>
                    </button>
                </span>
            `;
        }
    });

    chipsContainer.innerHTML = chipsHtml;

    chipsContainer.querySelectorAll('.btn-remove-opt-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            _ctmSelectedOptionalIds.delete(id);
            renderSelectedOptionalChips();
            updateClientToppingsTotal();
        });
    });
}

function openOptionalToppingsModal() {
    const modal = $('client-optional-toppings-modal');
    const body = $('cotm-body');
    if (!modal || !body) return;

    let bodyHtml = '';
    _ctmOptionalGroups.forEach(g => {
        bodyHtml += `
            <div class="cotm-group-section bg-white p-3 rounded-2xl border border-orange-100 shadow-2xs">
                <div class="flex items-center justify-between border-b border-gray-100 pb-1.5 mb-2">
                    <h4 class="font-extrabold text-xs text-gray-800 uppercase tracking-wide">${escapeHtml(g.name)}</h4>
                    <span class="text-[10px] text-gray-400 font-medium">Múltiple selección</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        `;

        g.items.forEach(it => {
            const isSelected = _ctmSelectedOptionalIds.has(String(it.id));
            bodyHtml += `
                <div class="cotm-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${isSelected ? 'bg-orange-50 border-orange-500 text-orange-950 font-bold ring-2 ring-orange-400/40 shadow-xs' : 'bg-white border-gray-200 hover:border-orange-300 text-gray-700'}"
                    data-id="${it.id}">
                    <div class="cotm-tile-indicator w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-400 bg-white text-transparent'}">
                        <i class="fas fa-check text-[9px] ${isSelected ? '' : 'hidden'}"></i>
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-xs truncate leading-tight">${escapeHtml(it.name)}</span>
                        <span class="text-[10px] font-extrabold text-orange-600 mt-0.5">
                            ${it.price > 0 ? `+ ${formatMoney(it.price)}` : 'Incluido'}
                        </span>
                    </div>
                </div>
            `;
        });

        bodyHtml += `
                </div>
            </div>
        `;
    });

    body.innerHTML = bodyHtml;

    body.querySelectorAll('.cotm-tile').forEach(tile => {
        tile.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = String(tile.dataset.id);
            if (_ctmSelectedOptionalIds.has(id)) {
                _ctmSelectedOptionalIds.delete(id);
                updateCotmTileVisual(tile, false);
            } else {
                _ctmSelectedOptionalIds.add(id);
                updateCotmTileVisual(tile, true);
            }
            updateCotmExtraTotal();
        });
    });

    updateCotmExtraTotal();
    modal.classList.remove('hidden');
}

function updateCotmTileVisual(tile, isSelected) {
    const indicator = tile.querySelector('.cotm-tile-indicator');
    const checkIcon = indicator ? indicator.querySelector('.fa-check') : null;

    if (isSelected) {
        tile.className = 'cotm-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-orange-50 border-orange-500 text-orange-950 font-bold ring-2 ring-orange-400/40 shadow-xs';
        if (indicator) indicator.className = 'cotm-tile-indicator w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors border-orange-500 bg-orange-500 text-white';
        if (checkIcon) checkIcon.classList.remove('hidden');
    } else {
        tile.className = 'cotm-tile flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none bg-white border-gray-200 hover:border-orange-300 text-gray-700';
        if (indicator) indicator.className = 'cotm-tile-indicator w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors border-gray-400 bg-white text-transparent';
        if (checkIcon) checkIcon.classList.add('hidden');
    }
}

function updateCotmExtraTotal() {
    let extra = 0;
    _ctmSelectedOptionalIds.forEach(id => {
        const item = _ctmAllOptionalItems.find(it => String(it.id) === String(id));
        if (item) extra += (Number(item.price) || 0);
    });
    const el = $('cotm-extra-total');
    if (el) el.innerText = formatMoney(extra);
}

function closeOptionalToppingsModal() {
    const modal = $('client-optional-toppings-modal');
    if (modal) modal.classList.add('hidden');
}

export function closeClientToppingsModal() {
    const modal = $('client-toppings-modal');
    if (modal) modal.classList.add('hidden');
    closeOptionalToppingsModal();

    _currentCustomizingProduct = null;
    _ctmCustomCallback = null;
    if (_ctmSelectedMandatory) _ctmSelectedMandatory.clear();
    if (_ctmSelectedOptionalIds) _ctmSelectedOptionalIds.clear();
    _ctmMandatoryGroups = [];
    _ctmOptionalGroups = [];
    _ctmAllOptionalItems = [];
    _ctmVariants = [];
    _ctmSelectedVariantId = null;
}

function updateClientToppingsTotal() {
    if (!_currentCustomizingProduct) return;

    let basePrice = 0;
    if (_ctmVariants.length > 0) {
        const selVar = _ctmVariants.find(v => String(v.id || v.name) === String(_ctmSelectedVariantId));
        basePrice = selVar ? selVar.price : _currentCustomizingProduct.price;
    } else {
        basePrice = (_currentCustomizingProduct.is_promo && _currentCustomizingProduct.promo_price)
            ? _currentCustomizingProduct.promo_price
            : _currentCustomizingProduct.price;
    }

    let toppingsExtra = 0;
    _ctmSelectedOptionalIds.forEach(id => {
        const item = _ctmAllOptionalItems.find(it => String(it.id) === String(id));
        if (item) toppingsExtra += (Number(item.price) || 0);
    });

    const unitPrice = basePrice + toppingsExtra;
    const total = unitPrice * _ctmQty;

    const totalEl = $('ctm-total-price');
    if (totalEl) totalEl.innerText = formatMoney(total);
}

function handleAddCustomizedDishToCart() {
    if (!_currentCustomizingProduct) return;

    const product = _currentCustomizingProduct;

    // 0. Validate variant if dish has variants
    let selectedVariant = null;
    let basePrice = 0;
    if (_ctmVariants.length > 0) {
        if (!_ctmSelectedVariantId) {
            toast('Por favor selecciona un tamaño para el plato', 'warning');
            return;
        }
        selectedVariant = _ctmVariants.find(v => String(v.id || v.name) === String(_ctmSelectedVariantId));
        if (!selectedVariant) {
            toast('Por favor selecciona un tamaño válido', 'warning');
            return;
        }
        basePrice = selectedVariant.price;
    } else {
        basePrice = (product.is_promo && product.promo_price) ? product.promo_price : product.price;
    }

    // 1. Validate mandatory groups
    for (let i = 0; i < _ctmMandatoryGroups.length; i++) {
        const group = _ctmMandatoryGroups[i];
        const selectedId = _ctmSelectedMandatory.get(group.name);
        if (!selectedId) {
            toast(`Por favor selecciona una opción en "${group.name}"`, 'warning');
            return;
        }
    }

    // 2. Gather selected toppings
    const selectedToppings = [];
    let toppingsExtra = 0;

    // Mandatory choices
    _ctmMandatoryGroups.forEach(g => {
        const selectedId = _ctmSelectedMandatory.get(g.name);
        const item = g.items.find(it => String(it.id) === String(selectedId));
        if (item) {
            selectedToppings.push({
                id: item.id,
                name: item.name,
                group_name: g.name,
                price: 0,
                is_required: true
            });
        }
    });

    // Optional choices
    _ctmSelectedOptionalIds.forEach(id => {
        const item = _ctmAllOptionalItems.find(it => String(it.id) === String(id));
        if (item) {
            const price = Number(item.price) || 0;
            toppingsExtra += price;
            selectedToppings.push({
                id: item.id,
                name: item.name,
                group_name: item.group_name,
                price: price,
                is_required: false
            });
        }
    });

    const unitPrice = basePrice + toppingsExtra;
    const notes = ($('ctm-dish-notes')?.value || '').trim();

    let toppingsText = '';
    if (selectedToppings.length > 0) {
        toppingsText = selectedToppings
            .map(t => t.price > 0 ? `${t.name} (+${formatMoney(t.price)})` : t.name)
            .join(', ');
    }

    const cartItem = {
        id: `${product.id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        productId: product.id,
        name: product.name,
        variant: selectedVariant ? { id: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price } : null,
        variant_name: selectedVariant ? selectedVariant.name : null,
        base_price: basePrice,
        price: unitPrice,
        qty: _ctmQty,
        toppings: selectedToppings,
        toppings_text: toppingsText,
        notes: notes
    };

    if (typeof _ctmCustomCallback === 'function') {
        _ctmCustomCallback(cartItem);
    } else {
        state.cart.push(cartItem);
        updateCartUI();
        const displayName = selectedVariant ? `${product.name} (${selectedVariant.name})` : product.name;
        toast(`Añadido: ${displayName} (x${_ctmQty})`, 'success');
    }
    closeClientToppingsModal();
}

// ====================================================================
// CART & ORDERING
// ====================================================================

export function addToCart(id) {
    const prod = (state.products || []).find(p => String(p.id) === String(id));
    if (!prod) {
        console.warn('addToCart: Producto no encontrado para id:', id);
        return;
    }

    if (prod.has_toppings || prod.has_variants) {
        openClientToppingsModal(prod);
        return;
    }

    const price = (prod.is_promo && prod.promo_price) ? prod.promo_price : prod.price;
    const existing = state.cart.find(i => String(i.productId) === String(id) && !i.toppings_text && !i.variant_name && !i.notes);

    if (existing) {
        existing.qty++;
    } else {
        state.cart.push({
            id: `${prod.id}_${Date.now()}`,
            productId: prod.id,
            name: prod.name,
            price: price,
            qty: 1
        });
    }

    updateCartUI();
    toast('Añadido: ' + prod.name, 'success');
}

export function updateCheckoutTotals() {
    const subtotal = state.cart.reduce((a, b) => a + (b.price * b.qty), 0);
    const orderType = $('c-type')?.value;
    const isDomicilio = orderType === 'Domicilio';
    const zoneId = $('c-zone')?.value;
    const selectedZone = (state.deliveryZones || []).find(z => z.id === zoneId);

    const breakdownContainer = $('cart-breakdown-container');
    const subtotalEl = $('cart-subtotal-modal');
    const deliveryRow = $('cart-delivery-row');
    const deliveryLabel = $('cart-delivery-label');
    const deliveryFeeEl = $('cart-delivery-fee');
    const totalEl = $('cart-total-modal');
    const zoneInfo = $('c-zone-info');
    const zoneFeeBadge = $('c-zone-fee-badge');
    const zoneTimeBadge = $('c-zone-time-badge');
    const minOrderAlert = $('c-zone-min-order-alert');
    const minOrderText = $('c-zone-min-order-text');

    let deliveryFee = 0;

    if (isDomicilio) {
        if (selectedZone) {
            deliveryFee = parseFloat(selectedZone.fee) || 0;
            if (zoneInfo) zoneInfo.classList.remove('hidden');
            if (zoneFeeBadge) zoneFeeBadge.textContent = formatMoney(deliveryFee);
            if (zoneTimeBadge) zoneTimeBadge.textContent = selectedZone.estimated_time || '30-45 min';

            if (minOrderAlert) minOrderAlert.classList.add('hidden');
            if (deliveryRow) {
                deliveryRow.classList.remove('hidden');
                if (deliveryLabel) deliveryLabel.innerHTML = `<i class="fas fa-motorcycle text-[10px] mr-1"></i> Domicilio (${escapeHtml(selectedZone.name)}):`;
                if (deliveryFeeEl) deliveryFeeEl.textContent = `+${formatMoney(deliveryFee)}`;
            }
        } else {
            if (zoneInfo) zoneInfo.classList.add('hidden');
            if (deliveryRow) deliveryRow.classList.add('hidden');
        }

        if (breakdownContainer) breakdownContainer.classList.remove('hidden');
    } else {
        if (zoneInfo) zoneInfo.classList.add('hidden');
        if (deliveryRow) deliveryRow.classList.add('hidden');
        if (breakdownContainer && subtotal > 0 && orderType && orderType !== '0') {
            breakdownContainer.classList.remove('hidden');
        } else if (breakdownContainer && !isDomicilio) {
            breakdownContainer.classList.add('hidden');
        }
    }

    if (subtotalEl) subtotalEl.textContent = formatMoney(subtotal);
    const grandTotal = subtotal + deliveryFee;
    if (totalEl) totalEl.textContent = formatMoney(grandTotal);

    if ($('c-pay')?.value === 'Mixto' && typeof window.updateClientMixedBalance === 'function') {
        window.updateClientMixedBalance();
    }
}

export function updateCartUI() {
    const qty = state.cart.reduce((a, b) => a + b.qty, 0);
    const total = state.cart.reduce((a, b) => a + (b.price * b.qty), 0);
    if ($('cart-count')) $('cart-count').innerText = qty;
    if ($('cart-total-float')) $('cart-total-float').innerText = formatMoney(total);
    updateCheckoutTotals();

    if (qty > 0) $('cart-float')?.classList.remove('hidden');
    else $('cart-float')?.classList.add('hidden');
}

export function renderCartList() {
    const list = $('cart-items-list');
    if (!list) return;

    if (state.cart.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 py-10">Carrito vacío</div>';
        updateCheckoutTotals();
        return;
    }

    list.innerHTML = state.cart.map(item => `
        <div class="flex justify-between items-start bg-white p-3 rounded-2xl border border-gray-100 shadow-xs">
            <div class="flex items-start gap-2.5 min-w-0 flex-1">
                <div class="bg-orange-50 text-orange-600 font-bold w-6 h-6 flex items-center justify-center rounded-lg text-xs shrink-0 mt-0.5">${item.qty}</div>
                <div class="min-w-0 flex-1">
                    <p class="font-bold text-xs text-gray-800 leading-tight">${escapeHtml(item.name)}</p>
                    ${item.variant_name ? `<p class="text-[10px] text-indigo-700 font-bold leading-tight mt-0.5"><i class="fas fa-layer-group text-[8px] mr-1"></i>Tamaño: ${escapeHtml(item.variant_name)}</p>` : ''}
                    ${item.toppings_text ? `<p class="text-[10px] text-amber-700 font-medium leading-tight mt-0.5"><i class="fas fa-cookie-bite mr-1 text-[8px]"></i>${escapeHtml(item.toppings_text)}</p>` : ''}
                    ${item.notes ? `<p class="text-[9px] text-gray-400 italic leading-tight mt-0.5">Nota: ${escapeHtml(item.notes)}</p>` : ''}
                    <p class="text-[10px] text-gray-400 font-semibold mt-1">${formatMoney(item.price)} c/u</p>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 ml-2">
                <span class="font-bold text-xs text-gray-900">${formatMoney(item.price * item.qty)}</span>
                <button class="text-gray-300 hover:text-red-500 remove-item-btn p-1 cursor-pointer transition-colors" data-id="${item.id}" aria-label="Eliminar del carrito"><i class="fas fa-trash text-xs"></i></button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.remove-item-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = state.cart.findIndex(i => i.id === btn.dataset.id);
            if (idx > -1) state.cart.splice(idx, 1);
            updateCartUI();
            renderCartList();
        });
    });

    updateCheckoutTotals();
}

export async function handleSendOrder() {
    if (state.config.isOpen === false) {
        return showModalAlert("Error", "Error: El restaurante está cerrado", "error");
    }

    const name = $('c-name').value.trim();
    const phone = $('c-phone').value.trim();
    const paymentMethod = $('c-pay').value;
    const orderType = $('c-type').value;

    if (!name || !phone) {
        return showModalAlert("Datos Incompletos", "Nombre y Teléfono son obligatorios", "error");
    }

    if (name.length < 5) {
        return showModalAlert("Nombre Inválido", "El nombre debe tener al menos 5 caracteres", "error");
    }
    if (!/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/.test(name)) {
        return showModalAlert("Nombre Inválido", "El nombre solo puede contener letras y espacios", "error");
    }

    if (phone.length !== 10) {
        return showModalAlert("Teléfono Inválido", "El teléfono debe tener exactamente 10 dígitos", "error");
    }
    if (!/^\d{10}$/.test(phone)) {
        return showModalAlert("Teléfono Inválido", "El teléfono solo puede contener números", "error");
    }

    if (!paymentMethod || paymentMethod === '' || paymentMethod === '0') {
        return showModalAlert("Método de Pago Requerido", "Debes seleccionar un método de pago", "error");
    }

    if (!orderType || orderType === '' || orderType === '0') {
        return showModalAlert("Tipo de Entrega Requerido", "Debes seleccionar el tipo de entrega", "error");
    }

    const address = $('c-address').value.trim();
    if (orderType === 'Domicilio' && !address) {
        return showModalAlert("Dirección Requerida", "La dirección es obligatoria para pedidos a domicilio", "error");
    }

    let selectedZone = null;
    let deliveryFee = 0;
    let deliveryZoneName = '';
    const cartSubtotal = state.cart.reduce((a, b) => a + (b.price * b.qty), 0);

    if (orderType === 'Domicilio') {
        const zoneId = $('c-zone')?.value;
        selectedZone = (state.deliveryZones || []).find(z => z.id === zoneId);
        if (!selectedZone) {
            return showModalAlert("Sector Requerido", "Por favor selecciona el sector o zona de entrega de tu pedido", "error");
        }
        deliveryFee = parseFloat(selectedZone.fee) || 0;
        deliveryZoneName = selectedZone.name;
    }

    const totalWithDelivery = cartSubtotal + deliveryFee;

    const role = state.user ? state.user.role : null;
    const isStaffOrder = role === 'admin' ||
        role === 'waiter' || role === 'mesero' ||
        role === 'delivery' || role === 'repartidor' ||
        role === 'chef' || role === 'cocinero' ||
        role === 'cajero';

    setLoading('btn-send-wa', true, "Enviando...");
    setLoading('btn-go-checkout', true, "Enviando...");

    let paymentProof = "";
    if (paymentMethod === 'Transferencia') {
        const file = state.tempProofFile || $('c-proof').files[0];
        if (!file) {
            setLoading('btn-go-checkout', false);
            setLoading('btn-send-wa', false);
            return showModalAlert("Comprobante Requerido", "Debes subir el comprobante de pago", "error");
        }
        paymentProof = file;
    } else if (paymentMethod === 'Mixto') {
        const splits = state.clientSplits || [];
        const assigned = splits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
        if (Math.abs(assigned - totalWithDelivery) > 1) {
            setLoading('btn-go-checkout', false);
            setLoading('btn-send-wa', false);
            return showModalAlert(
                "Descuadre en Pago Mixto",
                `El total asignado (${formatMoney(assigned)}) debe ser igual al total del pedido (${formatMoney(totalWithDelivery)}).`,
                "warning"
            );
        }

        const hasTransfer = splits.some(s => s.method === 'Transferencia');
        if (hasTransfer) {
            const file = state.tempProofFile || $('c-proof').files[0];
            if (!file) {
                setLoading('btn-go-checkout', false);
                setLoading('btn-send-wa', false);
                return showModalAlert("Comprobante Requerido", "Al incluir transferencia en tu pago mixto, debes subir el comprobante de pago", "error");
            }
            paymentProof = file;
        }
    }

    const orderData = {
        date: new Date().toISOString(),
        displayDate: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
        client: name,
        phone: phone,
        type: orderType,
        payment: paymentMethod,
        proof: paymentProof,
        notes: $('c-notes').value,
        address: orderType === 'Domicilio' ? $('c-address').value : 'N/A',
        delivery_zone: deliveryZoneName,
        delivery_fee: deliveryFee,
        items: state.cart,
        total: totalWithDelivery,
        status: 'Pendiente'
    };

    if (state.user) {
        orderData.waiterId = state.user.id;
        orderData.waiterName = state.user.name;
    }

    if (paymentMethod === 'Mixto') {
        let sumCash = 0;
        let sumTrans = 0;
        const splitsList = (state.clientSplits || []).map(s => {
            const amt = parseFloat(s.amount) || 0;
            if (s.method === 'Efectivo') sumCash += amt;
            else if (s.method === 'Transferencia') sumTrans += amt;
            return {
                method: s.method,
                amount: amt
            };
        });
        orderData.cash_amount = sumCash;
        orderData.transfer_amount = sumTrans;
        orderData.payment_details = {
            method: 'Mixto',
            splits: splitsList
        };
    }

    try {
        const newId = await createOrder(orderData);

        if (isStaffOrder) {
            state.cart = [];
            updateCartUI();
            $('cart-modal').classList.add('hidden');
            if (role === 'admin') window.switchView('admin');
            else if (role === 'waiter' || role === 'mesero') window.switchView('waiter');
            else if (role === 'delivery' || role === 'repartidor') window.switchView('delivery');
            else if (role === 'chef' || role === 'cocinero') window.switchView('chef');
            else if (role === 'cajero' || role === 'supervisor') window.switchView('admin');

            setLoading('btn-send-wa', false);
            setLoading('btn-go-checkout', false);
            return;
        }

        const flag = String.fromCodePoint(0x1F6A9);
        const dollar = String.fromCodePoint(0x1F4B2);
        const person = String.fromCodePoint(0x1F9D1);
        const pin = String.fromCodePoint(0x1F4CC);
        const roundPin = String.fromCodePoint(0x1F4CD);
        const bag = String.fromCodePoint(0x1F4B0);
        const memo = String.fromCodePoint(0x1F4DD);

        let msg = `${flag} *¡Hola, quisiera hacer el siguiente pedido!* - ID: ${newId}\n`;
        msg += `Estos son mis platos:\n`;
        state.cart.forEach(i => {
            msg += `- ${i.qty}x ${i.name} (${formatMoney(i.price * i.qty)})\n`;
            if (i.variant_name) msg += `   *Tamaño:* ${i.variant_name}\n`;
            if (i.toppings_text) msg += `   *Adiciones:* ${i.toppings_text}\n`;
            if (i.notes) msg += `   *Nota:* ${i.notes}\n`;
        });
        if (orderType === 'Domicilio' && deliveryZoneName) {
            msg += `\nSubtotal: ${formatMoney(cartSubtotal)}\n`;
            msg += `Domicilio (${deliveryZoneName}): ${formatMoney(deliveryFee)}\n`;
        }
        msg += `\n${dollar} *TOTAL: ${formatMoney(totalWithDelivery)}*\n`;
        msg += `${person} Nombre: ${name}\n${pin} Tipo: ${orderData.type}\n`;
        if (orderType === 'Domicilio') {
            msg += `${roundPin} Sector: ${deliveryZoneName}\n${roundPin} Dir: ${orderData.address}\n`;
        }
        if (orderData.payment === 'Mixto' && orderData.payment_details?.splits) {
            const splitSummary = orderData.payment_details.splits.map(s => `${s.method}: ${formatMoney(s.amount)}`).join(' + ');
            msg += `${bag} Método de Pago: Pago Mixto (${splitSummary})\n${memo} Nota: ${orderData.notes}`;
        } else {
            msg += `${bag} Método de Pago: ${orderData.payment}\n${memo} Nota: ${orderData.notes}`;
        }
        if (paymentProof) msg += `\n(Comprobante adjunto en sistema)`;

        const waNumber = state.restaurantData.phone || state.config.whatsapp || '';
        const url = `https://api.whatsapp.com/send?phone=${waNumber}&text=${encodeURIComponent(msg)}`;

        window.location.href = url;

        state.cart = [];
        updateCartUI();
        $('cart-modal').classList.add('hidden');
        resetOrderForm();
    } catch (e) {
        console.error(e);
        showModalAlert("Error", 'Error enviando pedido: ' + e.message, "error");
    } finally {
        setLoading('btn-send-wa', false);
        setLoading('btn-go-checkout', false);
    }
}

function resetOrderForm() {
    $('c-name').value = '';
    $('c-phone').value = '';
    $('c-address').value = '';
    $('c-notes').value = '';
    $('c-type').value = '0';
    $('c-pay').value = '0';
    if ($('c-zone')) $('c-zone').value = '';
    $('c-proof').value = '';
    state.tempProofFile = null;
    $('proof-msg').innerText = '';
    $('proof-msg').classList.add('hidden');
    if (window.validateCheckoutButton) window.validateCheckoutButton();
    state.tempProofFile = null;

    $('transfer-info')?.classList.add('hidden');
    $('client-mixed-container')?.classList.add('hidden');
    state.clientSplits = [];
    $('proof-container')?.classList.add('hidden');
    $('c-address')?.classList.add('hidden');
    $('delivery-zone-container')?.classList.add('hidden');
    $('c-zone-info')?.classList.add('hidden');
    $('cart-breakdown-container')?.classList.add('hidden');
    updateCheckoutTotals();
}
