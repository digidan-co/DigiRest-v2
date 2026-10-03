<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { state } from '@/legacy/core/state.js';
import { addToCart, openDisplayDetail, setupClientToppingsModalListeners } from '@/legacy/views/client-view.js';
import { getTopDishes7d } from '@/legacy/services/product-service.js';
import { OfflineDB } from '@/legacy/services/offline-db.js';
import { formatMoney } from '@/legacy/utils/helpers.js';

const searchTerm = ref('');
const expandedCats = ref(new Set());
const offlineQueueCount = ref(0);

const restaurantName = computed(() => state.restaurantData.name || 'Restaurante');
const bannerUrl = computed(() => state.config.banner || '');
const isOpen = computed(() => state.restaurantData.isOpen !== false);
const sn = computed(() => state.restaurantData.socialNetworks || {});

const availableProducts = computed(() => (state.products || []).filter(p => p.available !== 0 && p.available !== false));
const hasPromos = computed(() => availableProducts.value.some(p => p.is_promo));
const hasRecommended = computed(() => availableProducts.value.some(p => p.is_recommended));
const hasTopDishes = computed(() => (state.topDishes7d || []).length > 0);

const promoDishes = computed(() => availableProducts.value.filter(p => p.is_promo));
const recDishes = computed(() => availableProducts.value.filter(p => p.is_recommended));
const topDishes = computed(() => (state.topDishes7d || []).filter(p => p.available !== 0 && p.available !== false).slice(0, 8));

const filteredProducts = computed(() => {
    const search = searchTerm.value.toLowerCase().trim();
    if (!search) return availableProducts.value;
    return availableProducts.value.filter(p =>
        (p.name || '').toLowerCase().includes(search) || (p.desc && p.desc.toLowerCase().includes(search))
    );
});

const groupedProducts = computed(() => {
    const list = filteredProducts.value;
    if (!list || list.length === 0) return [];

    const groupsMap = new Map();
    (state.categories || []).forEach(cat => {
        const name = (cat.name || '').trim();
        if (name && !groupsMap.has(name)) groupsMap.set(name, { id: cat.id || name, name, products: [] });
    });
    list.forEach(p => {
        const catName = (p.category || 'Otros').trim();
        if (!groupsMap.has(catName)) groupsMap.set(catName, { id: catName, name: catName, products: [] });
        groupsMap.get(catName).products.push(p);
    });
    return Array.from(groupsMap.values()).filter(g => g.products.length > 0);
});

const categoryChips = computed(() => {
    const chips = [];
    if (hasPromos.value) chips.push({ id: 'sec-promos', name: '', label: 'Promos', icon: 'fa-fire', cls: 'filter-chip-promo', type: 'featured' });
    if (hasRecommended.value) chips.push({ id: 'sec-recommended', name: '', label: 'Recomendados', icon: 'fa-star', cls: 'filter-chip-rec', type: 'featured' });
    if (hasTopDishes.value) chips.push({ id: 'sec-top', name: '', label: 'Más Pedidos', icon: 'fa-trophy', cls: 'filter-chip-top', type: 'featured' });
    (state.categories || []).forEach(c => {
        const name = (c.name || '').trim();
        if (name) chips.push({ id: 'cat-' + (c.id || name), name, label: name, icon: '', cls: 'filter-chip-default', type: 'category' });
    });
    return chips;
});

function effectivePrice(p) { return (p.is_promo && p.promo_price) ? p.promo_price : p.price; }
function hasDiscount(p) { return p.is_promo && p.promo_price && p.promo_price < p.price; }

function toggleCat(name) {
    const next = new Set(expandedCats.value);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    expandedCats.value = next;
}

function goToChip(chip) {
    if (chip.type === 'category') {
        const next = new Set(expandedCats.value);
        next.add(chip.name);
        expandedCats.value = next;
    }
    nextTick(() => {
        const el = document.getElementById(chip.id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function scrollCarousel(id, direction) {
    const el = document.getElementById(id);
    if (el) {
        const scrollAmount = Math.max(220, Math.floor(el.clientWidth * 0.75));
        el.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    }
}

function openGps() { if (window.openGpsModal) window.openGpsModal(); }
function goTracker() { window.switchView('tracker'); }
function goPanel() {
    const role = state.user?.role;
    if (role === 'admin' || role === 'cajero') window.switchView('admin');
    else if (role === 'chef' || role === 'cocinero') window.switchView('chef');
    else if (role === 'waiter' || role === 'mesero') window.switchView('waiter');
    else if (role === 'delivery' || role === 'repartidor') window.switchView('delivery');
    else window.switchView('client');
}
function toggleLogin() {
    if (state.user) {
        if (window.handleLogoutUser) window.handleLogoutUser();
    } else {
        const m = document.getElementById('login-modal');
        if (m) m.classList.remove('hidden');
    }
}

function handleSelectProduct(id) {
    searchTerm.value = '';
    openDisplayDetail(id);
}

function handleAddProduct(id) {
    searchTerm.value = '';
    addToCart(id);
}

onMounted(async () => {
    setupClientToppingsModalListeners();
    if (!state.topDishes7d || state.topDishes7d.length === 0) {
        try { state.topDishes7d = await getTopDishes7d(); } catch (e) { state.topDishes7d = []; }
    }
    setInterval(async () => {
        try { offlineQueueCount.value = (await OfflineDB.getQueue()).length; } catch (e) {}
    }, 2000);
});
</script>

<template>
    <div id="welcome-banner"
        class="m-4 rounded-3xl p-4 text-white relative overflow-hidden slide-up flex flex-col items-center justify-center text-center bg-gray-900 bg-cover bg-center"
        :style="bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : {}">
        <div class="absolute inset-0 bg-black/60 z-0"></div>

        <div class="absolute top-4 left-4 z-20 flex items-center gap-2">
            <button type="button" @click="openGps" aria-label="Abrir GPS"
                class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 transition-colors backdrop-blur-md flex items-center justify-center border border-white/30 text-white group cursor-pointer"
                title="Ver Dirección">
                <i class="fas fa-map-marker-alt text-xl group-hover:scale-110 transition-transform drop-shadow-md"></i>
            </button>
            <div v-show="offlineQueueCount > 0"
                class="text-xs text-orange-200 font-bold items-center gap-1.5 bg-orange-600/70 backdrop-blur-md border border-orange-400/50 px-2.5 py-1.5 rounded-full transition-all shadow-xs flex"
                title="Pedidos pendientes de sincronización">
                <i class="fas fa-cloud-upload-alt animate-pulse text-xs"></i> <span>{{ offlineQueueCount }}</span>
            </div>
        </div>

        <div class="absolute top-4 right-4 z-20 flex items-center gap-2">
            <button v-show="state.user" type="button" @click="goPanel" aria-label="Volver al panel"
                class="h-10 w-10 sm:w-auto sm:px-3.5 rounded-full bg-[var(--system-primary)] text-[var(--system-secondary)] font-bold text-xs shadow-md transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-1.5 border border-white/20 cursor-pointer"
                title="Volver a mi Panel">
                <i class="fas fa-arrow-left"></i>
                <span class="hidden sm:inline">Panel</span>
            </button>
            <button type="button" @click="toggleLogin" aria-label="Acceso al sistema"
                class="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 transition-colors backdrop-blur-md flex items-center justify-center border border-white/30 text-white group cursor-pointer active:scale-95"
                title="Acceso al Sistema">
                <i class="fas fa-user text-sm group-hover:scale-110 transition-transform drop-shadow-md"></i>
            </button>
        </div>

        <h2 class="sm:text-3xl sm:font-bold md:text-4xl mb-1 md:font-bold relative z-10 mt-6 md:mt-0">Bienvenido
            a <br>
            <span class="font-bold md:text-4xl text-3xl drop-shadow-md">{{ restaurantName }}</span>
        </h2>
        <p class="text-gray-200 text-sm relative z-10 max-w-xs drop-shadow-md mb-2 md:mb-2">Explora nuestro menú
            y ordena tu pedido en segundos.</p>

        <div class="z-20 flex gap-3">
            <a v-show="sn.instagram" :href="sn.instagram" target="_blank"
                class="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20">
                <i class="fab fa-instagram"></i>
            </a>
            <a v-show="sn.facebook" :href="sn.facebook" target="_blank"
                class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20">
                <i class="fab fa-facebook-f"></i>
            </a>
            <a v-show="sn.tiktok" :href="sn.tiktok" target="_blank"
                class="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20">
                <i class="fab fa-tiktok"></i>
            </a>
        </div>

        <div class="relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mt-2 w-fit transition-all duration-500"
            :class="isOpen ? 'bg-green-500 text-white' : 'bg-red-500 text-white'">
            <div class="w-2 h-2 rounded-full bg-white" :class="isOpen ? 'animate-pulse' : ''"></div>
            <span>{{ isOpen ? 'Abierto' : 'Cerrado' }}</span>
        </div>

        <!-- Rastrear Pedido (bottom-right of header) -->
        <button type="button" @click="goTracker" aria-label="Rastrear pedidos"
            class="absolute bottom-4 right-4 z-20 h-10 w-10 sm:w-auto sm:px-3.5 rounded-full bg-white/20 hover:bg-white/40 transition-colors backdrop-blur-md flex items-center justify-center gap-1.5 border border-white/30 text-white group cursor-pointer active:scale-95"
            title="Rastrear Pedido">
            <i class="fas fa-search-location text-sm group-hover:scale-110 transition-transform drop-shadow-md"></i>
            <span class="hidden sm:inline text-xs font-bold">Rastrear</span>
        </button>
    </div>

    <div class="sticky top-0 z-30 backdrop-blur-md bg-gray-50/90 -mx-4 mb-4 transition-all px-4 pt-3 pb-2">
        <div class="relative mb-2">
            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
            <input v-model="searchTerm" type="text" placeholder="Buscar plato..."
                class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--system-primary)] focus:border-transparent transition-all shadow-sm">
        </div>
        <div class="flex gap-2.5 overflow-x-auto py-1 no-scrollbar">
            <button v-for="chip in categoryChips" :key="chip.id" type="button" @click="goToChip(chip)"
                class="filter-btn filter-chip" :class="chip.cls">
                <i v-if="chip.icon" class="fas mr-1 text-xs" :class="chip.icon"></i>{{ chip.label }}
            </button>
        </div>
    </div>

    <!-- Featured Sections -->
    <div v-show="!searchTerm.trim() && (promoDishes.length > 0 || recDishes.length > 0 || topDishes.length > 0)" class="space-y-6 mb-8">
        <div v-if="promoDishes.length > 0" id="sec-promos" class="carousel-container-promos rounded-2xl p-3 sm:p-4 shadow-2xs" style="background-color: #fefce8; border: 1px solid #fef08a;">
            <div class="flex items-center justify-between mb-3 px-1">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center text-sm shadow-xs"><i class="fas fa-fire"></i></span>
                    <div>
                        <h3 class="font-extrabold text-sm text-gray-900 tracking-tight">Promociones Especiales</h3>
                        <p class="text-[10px] text-gray-400">Precios de oferta por tiempo limitado</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" @click="scrollCarousel('promos-carousel', -1)"
                        class="carousel-nav-btn" title="Anterior" aria-label="Deslizar hacia la izquierda">
                        <i class="fas fa-chevron-left text-xs pointer-events-none"></i>
                    </button>
                    <button type="button" @click="scrollCarousel('promos-carousel', 1)"
                        class="carousel-nav-btn" title="Siguiente" aria-label="Deslizar hacia la derecha">
                        <i class="fas fa-chevron-right text-xs pointer-events-none"></i>
                    </button>
                </div>
            </div>
            <div id="promos-carousel" class="flex gap-2.5 overflow-x-auto pb-2 pt-1 scroll-smooth snap-x snap-mandatory no-scrollbar">
                <div v-for="p in promoDishes" :key="p.id"
                    class="client-product-card carousel-product-card snap-start bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group cursor-pointer"
                    @click="handleSelectProduct(p.id)">
                    <div class="aspect-square w-full relative bg-gray-50 overflow-hidden shrink-0">
                        <img :src="p.img || '/img/placeholder-dish.svg'" :alt="'Foto de ' + p.name" loading="lazy" class="display-img-target absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <span v-if="hasDiscount(p)" class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">¡Oferta!</span>
                        <span v-if="p.has_toppings" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-amber-700 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Personalizable con opciones">
                            <i class="fas fa-cookie-bite text-[11px]"></i>
                        </span>
                        <span v-if="p.order_count_7d > 0" class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-black/60 backdrop-blur-md text-white shadow-xs">🔥 {{ p.order_count_7d }} pedidos</span>
                    </div>
                    <div class="p-2 sm:p-2.5 flex flex-col flex-1 justify-between min-h-0">
                        <div>
                            <h4 class="font-bold text-gray-800 text-xs sm:text-sm leading-snug line-clamp-2" :title="p.name">{{ p.name }}</h4>
                        </div>
                        <div class="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1.5 shrink-0">
                            <div>
                                <div v-if="hasDiscount(p)" class="flex items-baseline gap-1.5">
                                    <span class="font-black text-red-600 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                                    <span class="text-[10px] text-gray-400 line-through leading-none">{{ formatMoney(p.price) }}</span>
                                </div>
                                <span v-else class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                            </div>
                            <button type="button" @click.stop="handleAddProduct(p.id)"
                                class="w-full py-2 px-3 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer bg-gray-900 hover:bg-orange-500"
                                :title="p.has_toppings ? 'Personalizar opciones' : 'Añadir al pedido'">
                                <i class="fas fa-plus text-xs pointer-events-none"></i>
                                <span class="text-xs sm:text-sm font-extrabold leading-none">Agregar</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="recDishes.length > 0" id="sec-recommended" class="carousel-container-recommended rounded-2xl p-3 sm:p-4 shadow-2xs" style="background-color: #fff7ed; border: 1px solid #fed7aa;">
            <div class="flex items-center justify-between mb-3 px-1">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center text-sm shadow-xs"><i class="fas fa-star"></i></span>
                    <div>
                        <h3 class="font-extrabold text-sm text-gray-900 tracking-tight">Recomendados de la Casa</h3>
                        <p class="text-[10px] text-gray-400">Las mejores sugerencias del chef</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" @click="scrollCarousel('recommended-carousel', -1)"
                        class="carousel-nav-btn" title="Anterior" aria-label="Deslizar hacia la izquierda">
                        <i class="fas fa-chevron-left text-xs pointer-events-none"></i>
                    </button>
                    <button type="button" @click="scrollCarousel('recommended-carousel', 1)"
                        class="carousel-nav-btn" title="Siguiente" aria-label="Deslizar hacia la derecha">
                        <i class="fas fa-chevron-right text-xs pointer-events-none"></i>
                    </button>
                </div>
            </div>
            <div id="recommended-carousel" class="flex gap-2.5 overflow-x-auto pb-2 pt-1 scroll-smooth snap-x snap-mandatory no-scrollbar">
                <div v-for="p in recDishes" :key="p.id"
                    class="client-product-card carousel-product-card snap-start bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group cursor-pointer"
                    @click="handleSelectProduct(p.id)">
                    <div class="aspect-square w-full relative bg-gray-50 overflow-hidden shrink-0">
                        <img :src="p.img || '/img/placeholder-dish.svg'" :alt="'Foto de ' + p.name" loading="lazy" class="display-img-target absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <span v-if="hasDiscount(p)" class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">¡Oferta!</span>
                        <span v-else class="badge-recommended absolute top-2 left-2 px-2.5 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider text-white shadow-xs flex items-center gap-1" style="background-color: #d97706; color: #ffffff;">
                            <i class="fas fa-star text-[8px] text-amber-200"></i> Recomendado
                        </span>
                        <span v-if="p.has_toppings" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-amber-700 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Personalizable con opciones">
                            <i class="fas fa-cookie-bite text-[11px]"></i>
                        </span>
                        <span v-if="p.order_count_7d > 0" class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-black/60 backdrop-blur-md text-white shadow-xs">🔥 {{ p.order_count_7d }} pedidos</span>
                    </div>
                    <div class="p-2 sm:p-2.5 flex flex-col flex-1 justify-between min-h-0">
                        <div>
                            <h4 class="font-bold text-gray-800 text-xs sm:text-sm leading-snug line-clamp-2" :title="p.name">{{ p.name }}</h4>
                        </div>
                        <div class="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1.5 shrink-0">
                            <div>
                                <div v-if="hasDiscount(p)" class="flex items-baseline gap-1.5">
                                    <span class="font-black text-red-600 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                                    <span class="text-[10px] text-gray-400 line-through leading-none">{{ formatMoney(p.price) }}</span>
                                </div>
                                <span v-else class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                            </div>
                            <button type="button" @click.stop="handleAddProduct(p.id)"
                                class="w-full py-2 px-3 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer bg-gray-900 hover:bg-orange-500"
                                :title="p.has_toppings ? 'Personalizar opciones' : 'Añadir al pedido'">
                                <i class="fas fa-plus text-xs pointer-events-none"></i>
                                <span class="text-xs sm:text-sm font-extrabold leading-none">Agregar</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="topDishes.length > 0" id="sec-top" class="carousel-container-top rounded-2xl p-3 sm:p-4 shadow-2xs" style="background-color: #eff6ff; border: 1px solid #bfdbfe;">
            <div class="flex items-center justify-between mb-3 px-1">
                <div class="flex items-center gap-2.5">
                    <span class="w-8 h-8 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center text-sm shadow-xs"><i class="fas fa-trophy"></i></span>
                    <div>
                        <h3 class="font-extrabold text-sm text-gray-900 tracking-tight">Los Más Pedidos</h3>
                        <p class="text-[10px] text-gray-400">Favoritos de los últimos 7 días</p>
                    </div>
                </div>
                <div class="flex items-center gap-1.5">
                    <button type="button" @click="scrollCarousel('top-carousel', -1)"
                        class="carousel-nav-btn" title="Anterior" aria-label="Deslizar hacia la izquierda">
                        <i class="fas fa-chevron-left text-xs pointer-events-none"></i>
                    </button>
                    <button type="button" @click="scrollCarousel('top-carousel', 1)"
                        class="carousel-nav-btn" title="Siguiente" aria-label="Deslizar hacia la derecha">
                        <i class="fas fa-chevron-right text-xs pointer-events-none"></i>
                    </button>
                </div>
            </div>
            <div id="top-carousel" class="flex gap-2.5 overflow-x-auto pb-2 pt-1 scroll-smooth snap-x snap-mandatory no-scrollbar">
                <div v-for="(p, idx) in topDishes" :key="p.id"
                    class="client-product-card carousel-product-card snap-start bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between group cursor-pointer"
                    @click="handleSelectProduct(p.id)">
                    <div class="aspect-square w-full relative bg-gray-50 overflow-hidden shrink-0">
                        <img :src="p.img || '/img/placeholder-dish.svg'" :alt="'Foto de ' + p.name" loading="lazy" class="display-img-target absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <span v-if="hasDiscount(p)" class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">¡Oferta!</span>
                        <span v-else-if="idx === 0" class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black bg-orange-500 text-white shadow-xs">#{{ idx + 1 }} Más Pedido</span>
                        <span v-if="p.has_toppings" class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-amber-700 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Personalizable con opciones">
                            <i class="fas fa-cookie-bite text-[11px]"></i>
                        </span>
                        <span v-if="p.order_count_7d > 0" class="absolute bottom-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-black/60 backdrop-blur-md text-white shadow-xs">🔥 {{ p.order_count_7d }} pedidos</span>
                    </div>
                    <div class="p-2 sm:p-2.5 flex flex-col flex-1 justify-between min-h-0">
                        <div>
                            <h4 class="font-bold text-gray-800 text-xs sm:text-sm leading-snug line-clamp-2" :title="p.name">{{ p.name }}</h4>
                        </div>
                        <div class="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1.5 shrink-0">
                            <div>
                                <div v-if="hasDiscount(p)" class="flex items-baseline gap-1.5">
                                    <span class="font-black text-red-600 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                                    <span class="text-[10px] text-gray-400 line-through leading-none">{{ formatMoney(p.price) }}</span>
                                </div>
                                <span v-else class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                            </div>
                            <button type="button" @click.stop="handleAddProduct(p.id)"
                                class="w-full py-2 px-3 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer bg-gray-900 hover:bg-orange-500"
                                :title="p.has_toppings ? 'Personalizar opciones' : 'Añadir al pedido'">
                                <i class="fas fa-plus text-xs pointer-events-none"></i>
                                <span class="text-xs sm:text-sm font-extrabold leading-none">Agregar</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Categories accordion -->
    <div v-if="groupedProducts.length > 0" class="space-y-3 pb-16">
        <section v-for="group in groupedProducts" :key="group.id" :id="'cat-' + group.id"
            class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button type="button" @click="toggleCat(group.name)"
                class="w-full flex items-center justify-between p-3.5 hover:bg-gray-50 transition-colors">
                <div class="flex items-center gap-2.5">
                    <span class="w-2.5 h-6 rounded-full bg-[var(--system-primary)] shadow-sm"></span>
                    <h3 class="font-extrabold text-base text-gray-800 tracking-tight">{{ group.name }}</h3>
                </div>
                <div class="flex items-center gap-2.5">
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{{ group.products.length }}</span>
                    <i class="fas fa-chevron-down text-xs text-gray-400 transition-transform duration-200"
                        :class="{ 'rotate-180': expandedCats.has(group.name) }"></i>
                </div>
            </button>
            <div v-show="expandedCats.has(group.name)" class="px-3 pb-3.5">
                <div class="grid grid-cols-2 py-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                    <div v-for="p in group.products" :key="p.id"
                        class="client-product-card cursor-pointer bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden group flex flex-col justify-between"
                        @click="handleSelectProduct(p.id)">
                        <div class="aspect-square w-full bg-gray-50 relative overflow-hidden shrink-0">
                            <img :src="p.img || '/img/placeholder-dish.svg'" :alt="'Foto de ' + p.name" loading="lazy"
                                class="display-img-target absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                            <span v-if="hasDiscount(p)" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">Promo</span>
                            <span v-if="p.has_toppings" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white text-amber-700 shadow-sm flex items-center justify-center border border-gray-100/80 z-10 pointer-events-none" title="Personalizable con opciones">
                                <i class="fas fa-cookie-bite text-[11px]"></i>
                            </span>
                        </div>
                        <div class="p-2 sm:p-2.5 flex flex-col flex-1 justify-between min-h-0">
                            <div>
                                <h3 class="font-bold text-gray-800 text-xs sm:text-sm leading-snug line-clamp-2" :title="p.name">{{ p.name }}</h3>
                            </div>
                            <div class="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1.5 shrink-0">
                                <div>
                                    <div v-if="hasDiscount(p)" class="flex items-baseline gap-1.5">
                                        <span class="font-black text-red-600 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                                        <span class="text-[10px] text-gray-400 line-through leading-none">{{ formatMoney(p.price) }}</span>
                                    </div>
                                    <span v-else class="font-black text-gray-900 text-sm sm:text-base leading-none tracking-tight">{{ formatMoney(effectivePrice(p)) }}</span>
                                </div>
                                <button type="button" @click.stop="handleAddProduct(p.id)"
                                    class="w-full py-2 px-3 text-white rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer bg-gray-900 hover:bg-orange-500"
                                    :title="p.has_toppings ? 'Personalizar opciones' : 'Añadir al pedido'">
                                    <i class="fas fa-plus text-xs pointer-events-none"></i>
                                    <span class="text-xs sm:text-sm font-extrabold leading-none">Agregar</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </div>

    <!-- Empty states -->
    <div v-if="availableProducts.length === 0" class="text-center py-16 px-4 my-6">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 text-2xl mb-3">
            <i class="fas fa-utensils"></i>
        </div>
        <p class="text-gray-700 font-bold text-sm">Sin platos disponibles</p>
    </div>
    <div v-else-if="filteredProducts.length === 0" class="text-center py-16 px-4 my-6">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 text-2xl mb-3">
            <i class="fas fa-search"></i>
        </div>
        <p class="text-gray-700 font-bold text-sm">Sin resultados</p>
        <p class="text-gray-400 text-xs mt-1">No encontramos platos para "{{ searchTerm }}".</p>
    </div>

    <div class="flex justify-center py-6 mt-8 border-t border-gray-100">
        <a href="https://www.digidan.co" target="_blank" rel="noopener noreferrer" class="opacity-60 hover:opacity-100 transition-opacity">
            <img src="/img/ceo.webp" alt="Powered by Digidan.co" style="width: 100px; height: auto;">
        </a>
    </div>
</template>
