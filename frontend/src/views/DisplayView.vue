<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { openDisplayDetail } from '@/legacy/views/client-view.js';
import { getTopDishes7d } from '@/legacy/services/product-service.js';
import DisplayCard from '@/components/DisplayCard.vue';

const searchTerm = ref('');
const activeCat = ref('Todos');

const restaurantName = computed(() => state.restaurantData.name || 'Restaurante');
const bannerUrl = computed(() => state.config.banner || '');
const isOpen = computed(() => state.restaurantData.isOpen !== false);
const sn = computed(() => state.restaurantData.socialNetworks || {});

const availableProducts = computed(() => (state.products || []).filter(p => p.available !== 0 && p.available !== false));
const hasPromos = computed(() => availableProducts.value.some(p => p.is_promo));
const hasRecommended = computed(() => availableProducts.value.some(p => p.is_recommended));
const hasTopDishes = computed(() => (state.topDishes7d || []).length > 0);

const categoryChips = computed(() => {
    const chips = [{ id: 'Todos', label: 'Todos', icon: '', cls: 'filter-chip-default' }];
    if (hasPromos.value) chips.push({ id: '🔥 Promos', label: 'Promos', icon: 'fa-fire', cls: 'filter-chip-promo' });
    if (hasRecommended.value) chips.push({ id: '⭐ Recomendados', label: 'Recomendados', icon: 'fa-star', cls: 'filter-chip-rec' });
    if (hasTopDishes.value) chips.push({ id: '🏆 Más Pedidos', label: 'Más Pedidos', icon: 'fa-trophy', cls: 'filter-chip-top' });
    (state.categories || []).forEach(c => chips.push({ id: c.name, label: c.name, icon: '', cls: 'filter-chip-default' }));
    return chips;
});

const promoDishes = computed(() => availableProducts.value.filter(p => p.is_promo));
const recDishes = computed(() => availableProducts.value.filter(p => p.is_recommended));
const topDishes = computed(() => (state.topDishes7d || []).filter(p => p.available !== 0 && p.available !== false).slice(0, 8));

const isDefaultAll = computed(() => activeCat.value === 'Todos' && !searchTerm.value.trim());

const regularTitle = computed(() => {
    if (!isDefaultAll.value) {
        const s = searchTerm.value.trim();
        if (s) return `Resultados de búsqueda: "${s}"`;
        if (activeCat.value === '🔥 Promos') return '🔥 Promociones Especiales';
        if (activeCat.value === '⭐ Recomendados') return '⭐ Recomendados de la Casa';
        if (activeCat.value === '🏆 Más Pedidos') return '🏆 Los Más Pedidos de la Semana';
        return activeCat.value;
    }
    return 'Nuestra Carta Completa';
});

const filteredProducts = computed(() => {
    const search = searchTerm.value.toLowerCase().trim();
    let filtered = availableProducts.value.filter(p => {
        let matchesCategory = true;
        if (activeCat.value === 'Todos') matchesCategory = true;
        else if (activeCat.value === '🔥 Promos') matchesCategory = Boolean(p.is_promo);
        else if (activeCat.value === '⭐ Recomendados') matchesCategory = Boolean(p.is_recommended);
        else if (activeCat.value === '🏆 Más Pedidos') matchesCategory = (state.topDishes7d || []).some(t => t.id === p.id);
        else matchesCategory = p.category === activeCat.value;
        const matchesSearch = !search || (p.name || '').toLowerCase().includes(search) || (p.desc && p.desc.toLowerCase().includes(search));
        return matchesCategory && matchesSearch;
    });
    if (activeCat.value === 'Todos') {
        filtered = filtered.sort((a, b) => {
            if (a.category !== b.category) return a.category.localeCompare(b.category, 'es');
            return a.name.localeCompare(b.name, 'es');
        });
    }
    return filtered;
});

const groupedProducts = computed(() => {
    const list = filteredProducts.value;
    if (!list || list.length === 0) return [];

    const map = new Map();
    list.forEach(p => {
        const cat = p.category || 'Otros';
        if (!map.has(cat)) {
            map.set(cat, []);
        }
        map.get(cat).push(p);
    });

    const categoryOrder = (state.categories || []).map(c => c.name);
    const groups = [];

    categoryOrder.forEach(catName => {
        if (map.has(catName)) {
            groups.push({
                category: catName,
                products: map.get(catName)
            });
            map.delete(catName);
        }
    });

    map.forEach((products, category) => {
        groups.push({ category, products });
    });

    return groups;
});

function setCat(cat) { activeCat.value = cat; }
function openGps() { if (window.openGpsModal) window.openGpsModal(); }
function openDetail(id) { openDisplayDetail(id); }

onMounted(async () => {
    if (!state.topDishes7d || state.topDishes7d.length === 0) {
        try { state.topDishes7d = await getTopDishes7d(); } catch (e) { state.topDishes7d = []; }
    }
});
</script>

<template>
    <div id="display-welcome"
        class="mb-8 rounded-3xl p-4 text-white shadow-xl relative overflow-hidden slide-up flex flex-col items-center justify-center text-center bg-gray-900 bg-cover bg-center"
        :style="bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : {}">
        <div class="absolute inset-0 bg-black/60 z-0"></div>
        <button type="button" @click="openGps" aria-label="Abrir GPS"
            class="absolute top-4 left-4 z-20 w-12 h-12 rounded-full bg-white/20 hover:bg-white/40 transition-colors backdrop-blur-md flex items-center justify-center border border-white/30 text-white group"
            title="Ver Dirección">
            <i class="fas fa-map-marker-alt text-2xl group-hover:scale-110 transition-transform drop-shadow-md"></i>
        </button>
        <h2 class="text-4xl font-bold mb-2 relative z-10 drop-shadow-md mt-8 md:mt-2">Bienvenido a <span class="drop-shadow-md">{{ restaurantName }}</span></h2>
        <p class="text-gray-200 text-lg relative z-10 max-w-lg drop-shadow-md mb-2 md:mb-2">Explora nuestro menú.</p>
        <div class="z-20 flex gap-4">
            <a v-show="sn.instagram" :href="sn.instagram" target="_blank" class="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20"><i class="fab fa-instagram text-lg"></i></a>
            <a v-show="sn.facebook" :href="sn.facebook" target="_blank" class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20"><i class="fab fa-facebook-f text-lg"></i></a>
            <a v-show="sn.tiktok" :href="sn.tiktok" target="_blank" class="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg border border-white/20"><i class="fab fa-tiktok text-lg"></i></a>
        </div>
        <div class="mt-2 scale-125 origin-center relative z-10 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider w-fit"
            :class="isOpen ? 'bg-green-500 text-white' : 'bg-red-500 text-white'">
            <div class="w-2 h-2 rounded-full bg-white" :class="isOpen ? 'animate-pulse' : ''"></div>
            <span>{{ isOpen ? 'Abierto' : 'Cerrado' }}</span>
        </div>
    </div>

    <div class="z-30 sticky backdrop-blur-md -mx-6 mb-6 px-6 bg-gray-50/90 transition-colors" style="top: calc(4rem + env(safe-area-inset-top, 0px));">
        <div class="px-2 pt-3 pb-1 relative">
            <i class="fas fa-search absolute left-6 top-6 text-gray-400"></i>
            <input v-model="searchTerm" type="text" placeholder="Buscar plato..."
                class="w-full px-[3rem] py-2.5 rounded-xl border border-gray-200 bg-white/90 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-300 transition-all shadow-sm">
        </div>
        <div class="flex gap-3 overflow-x-auto py-2 pl-2 no-scrollbar">
            <button v-for="cat in categoryChips" :key="cat.id" type="button" @click="setCat(cat.id)"
                class="filter-chip" :class="[cat.cls, { active: activeCat === cat.id }]">
                <i v-if="cat.icon" class="fas" :class="cat.icon"></i>{{ cat.label }}
            </button>
        </div>
    </div>

    <div v-show="isDefaultAll" class="space-y-8 mb-8">
        <div v-if="promoDishes.length > 0">
            <div class="flex items-center justify-between mb-4 px-1">
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center text-lg shadow-sm"><i class="fas fa-fire"></i></span>
                    <div><h3 class="font-extrabold text-xl menu-category-title tracking-tight">Promociones Especiales</h3><p class="text-xs text-gray-400">Precios especiales de oferta</p></div>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-full bg-red-100 text-red-700">¡Imperdible!</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <DisplayCard v-for="p in promoDishes" :key="p.id" :p="p" :is-promo="true" @open="openDetail(p.id)" />
            </div>
        </div>

        <div v-if="recDishes.length > 0">
            <div class="flex items-center justify-between mb-4 px-1">
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center text-lg shadow-sm"><i class="fas fa-star"></i></span>
                    <div><h3 class="font-extrabold text-xl menu-category-title tracking-tight">Recomendados de la Casa</h3><p class="text-xs text-gray-400">Las mejores sugerencias del chef</p></div>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-700">Sugerencia</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <DisplayCard v-for="p in recDishes" :key="p.id" :p="p" :is-rec="true" @open="openDetail(p.id)" />
            </div>
        </div>

        <div v-if="topDishes.length > 0">
            <div class="flex items-center justify-between mb-4 px-1">
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center text-lg shadow-sm"><i class="fas fa-trophy"></i></span>
                    <div><h3 class="font-extrabold text-xl menu-category-title tracking-tight">Los Más Pedidos</h3><p class="text-xs text-gray-400">Favoritos de los últimos 7 días</p></div>
                </div>
                <span class="text-xs font-bold px-3 py-1 rounded-full bg-orange-100 text-orange-700">Tendencia</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <DisplayCard v-for="(p, idx) in topDishes" :key="p.id" :p="p" :is-top="true" :rank="idx + 1" @open="openDetail(p.id)" />
            </div>
        </div>
    </div>

    <!-- Encabezado general si no es Todos o si hay búsqueda activa -->
    <div v-if="!isDefaultAll" class="flex items-center justify-between mb-4 px-1">
        <h3 class="font-extrabold text-xl menu-category-title tracking-tight">{{ regularTitle }}</h3>
        <span class="text-xs font-bold px-3 py-1 rounded-full bg-gray-100 text-gray-600">{{ filteredProducts.length }} platos</span>
    </div>

    <!-- Sin platos disponibles -->
    <div v-if="groupedProducts.length === 0" class="col-span-full text-center py-10 opacity-60 text-gray-400 font-medium">
        Sin platos disponibles en esta selección.
    </div>

    <!-- Lista de platos agrupada por categoría -->
    <div v-else class="space-y-10 pb-20">
        <section v-for="group in groupedProducts" :key="group.category" class="space-y-4">
            <div class="flex items-center justify-between border-b border-gray-200/30 pb-2">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-6 rounded-full bg-[var(--system-primary,#ea580c)] inline-block"></span>
                    <h3 class="font-bold text-xl menu-category-title tracking-tight">{{ group.category }}</h3>
                </div>
                <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {{ group.products.length }} {{ group.products.length === 1 ? 'plato' : 'platos' }}
                </span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                <DisplayCard v-for="p in group.products" :key="p.id" :p="p" @open="openDetail(p.id)" />
            </div>
        </section>
    </div>

    <div class="flex justify-center py-6 mt-8 border-t border-gray-200/20">
        <a href="https://www.digidan.co" target="_blank" rel="noopener noreferrer" class="opacity-60 hover:opacity-100 transition-opacity">
            <img src="/img/ceo.webp" alt="Powered by Digidan.co" style="width: 100px; height: auto;">
        </a>
    </div>
</template>
