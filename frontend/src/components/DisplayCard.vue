<script setup>
import { formatMoney } from '@/legacy/utils/helpers.js';

const props = defineProps({
    p: Object,
    isPromo: Boolean,
    isRec: Boolean,
    isTop: Boolean,
    rank: Number
});
const emit = defineEmits(['open']);

function effectivePrice(x) { return (x.is_promo && x.promo_price) ? x.promo_price : x.price; }
function hasDiscount(x) { return x.is_promo && x.promo_price && x.promo_price < x.price; }
</script>

<template>
    <div class="client-product-card cursor-pointer bg-white p-3 sm:p-3.5 rounded-2xl shadow-xs border border-gray-100 flex items-center sm:items-stretch gap-3 hover:shadow-md transition-all group overflow-hidden relative"
        @click="emit('open')">
        <div class="hidden sm:block sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-xl overflow-hidden shrink-0 bg-gray-50 relative">
            <img :src="p.img || '/img/placeholder-dish.svg'" :alt="'Foto de ' + p.name" loading="lazy"
                class="display-img-target w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
            <span v-if="hasDiscount(p)" class="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider bg-red-600 text-white shadow-xs">Promo</span>
            <span v-else-if="isRec || p.is_recommended" class="badge-recommended absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider text-white shadow-xs flex items-center gap-0.5" style="background-color: #d97706; color: #ffffff;"><i class="fas fa-star text-[7px] text-amber-200"></i> Top</span>
            <span v-if="isTop && rank" class="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-black bg-orange-500 text-white shadow-xs">#{{ rank }}</span>
        </div>
        <div class="flex-1 flex flex-row sm:flex-col justify-between items-center sm:items-stretch h-full min-w-0 gap-2 sm:gap-0 sm:py-0.5">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 mb-0.5">
                    <span class="text-[9px] font-bold text-orange-500 uppercase tracking-wider truncate">{{ p.category }}</span>
                    <span v-if="hasDiscount(p)" class="sm:hidden px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-red-100 text-red-700">Promo</span>
                    <span v-if="p.has_variants && p.has_toppings" class="sm:hidden text-[8px] font-bold text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded">Tamaños + Extras</span>
                    <span v-else-if="p.has_variants" class="sm:hidden text-[8px] font-bold text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded">Tamaños</span>
                    <span v-else-if="p.has_toppings" class="sm:hidden text-[8px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">Toppings</span>
                </div>
                <h3 class="font-bold text-gray-800 text-sm leading-tight truncate sm:whitespace-normal sm:line-clamp-1">{{ p.name }}</h3>
                <p class="hidden sm:block text-[10px] text-gray-400 leading-tight line-clamp-2 mt-0.5">{{ p.desc || '' }}</p>
                <div v-if="p.has_variants && p.has_toppings" class="hidden sm:block mt-1">
                    <span class="inline-flex items-center text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60"><i class="fas fa-layer-group mr-1 text-[8px]"></i><i class="fas fa-cookie-bite mr-1 text-[8px] text-amber-600"></i>Tamaños y Adiciones</span>
                </div>
                <div v-else-if="p.has_variants" class="hidden sm:block mt-1">
                    <span class="inline-flex items-center text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60"><i class="fas fa-layer-group mr-1 text-[8px]"></i>Múltiples Tamaños</span>
                </div>
                <div v-else-if="p.has_toppings" class="hidden sm:block mt-1">
                    <span class="inline-flex items-center text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60"><i class="fas fa-cookie-bite mr-1 text-[8px]"></i>Personalizable</span>
                </div>
            </div>
            <div class="flex sm:justify-between items-center gap-2.5 sm:gap-0 sm:mt-2 sm:pt-1 sm:border-t sm:border-gray-50 shrink-0">
                <div class="text-right sm:text-left">
                    <div v-if="hasDiscount(p)" class="flex flex-col sm:flex-row sm:items-baseline sm:gap-1.5">
                        <span class="font-extrabold text-red-600 text-sm leading-none">{{ p.has_variants ? 'Desde ' : '' }}{{ formatMoney(effectivePrice(p)) }}</span>
                        <span class="text-[9px] text-gray-400 line-through leading-none">{{ formatMoney(p.price) }}</span>
                    </div>
                    <span v-else class="font-extrabold text-gray-900 text-sm leading-none">{{ p.has_variants ? 'Desde ' : '' }}{{ formatMoney(effectivePrice(p)) }}</span>
                </div>
                <div class="w-6 h-6"></div>
            </div>
        </div>
    </div>
</template>
