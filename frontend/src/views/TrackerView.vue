<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { listenToOrders } from '@/legacy/services/order-service.js';
import { getDateMillis } from '@/legacy/utils/helpers.js';

const orders = ref([]);

const filtered = computed(() => {
    const now = Date.now();
    return orders.value.filter(o => {
        if (o.status === 'Anulado') return false;
        if (['Terminado', 'Entregado', 'Cobrado'].includes(o.status)) {
            if (o.type === 'Domicilio' && o.status === 'Terminado') return true;
            const statusTime = getDateMillis(o.statusTimestamp || o.timestamp || o.date);
            if (now - statusTime > 5 * 60 * 1000) return false;
        }
        return true;
    });
});

function getStatusTheme(status) {
    switch (status) {
        case 'Pendiente':
            return {
                cardBg: 'bg-white border-gray-200 hover:border-gray-300',
                icon: 'far fa-clock text-gray-500',
                iconBg: 'bg-gray-100 text-gray-500',
                badge: 'bg-gray-100 text-gray-700',
                pulse: false
            };
        case 'Recibido':
            return {
                cardBg: 'bg-amber-50/60 border-amber-200/90 hover:border-amber-300',
                icon: 'fas fa-concierge-bell text-amber-600',
                iconBg: 'bg-amber-100 text-amber-600',
                badge: 'bg-amber-100 text-amber-900',
                pulse: true
            };
        case 'En preparación':
            return {
                cardBg: 'bg-orange-50/60 border-orange-200/90 hover:border-orange-300',
                icon: 'fas fa-fire text-orange-600',
                iconBg: 'bg-orange-100 text-orange-600',
                badge: 'bg-orange-100 text-orange-900',
                pulse: true
            };
        case 'Terminado':
            return {
                cardBg: 'bg-emerald-50/60 border-emerald-200/90 hover:border-emerald-300',
                icon: 'fas fa-check-circle text-emerald-600',
                iconBg: 'bg-emerald-100 text-emerald-600',
                badge: 'bg-emerald-100 text-emerald-900 font-extrabold',
                pulse: true
            };
        case 'En Reparto':
            return {
                cardBg: 'bg-blue-50/60 border-blue-200/90 hover:border-blue-300',
                icon: 'fas fa-motorcycle text-blue-600',
                iconBg: 'bg-blue-100 text-blue-600',
                badge: 'bg-blue-100 text-blue-900',
                pulse: true
            };
        case 'Entregado':
            return {
                cardBg: 'bg-green-50/60 border-green-200/90 hover:border-green-300',
                icon: 'fas fa-box-open text-green-600',
                iconBg: 'bg-green-100 text-green-600',
                badge: 'bg-green-100 text-green-900',
                pulse: false
            };
        case 'Cobrado':
            return {
                cardBg: 'bg-teal-50/60 border-teal-200/90 hover:border-teal-300',
                icon: 'fas fa-check-double text-teal-600',
                iconBg: 'bg-teal-100 text-teal-600',
                badge: 'bg-teal-100 text-teal-900',
                pulse: false
            };
        default:
            return {
                cardBg: 'bg-white border-gray-200',
                icon: 'fas fa-receipt text-gray-500',
                iconBg: 'bg-gray-100 text-gray-500',
                badge: 'bg-gray-100 text-gray-700',
                pulse: false
            };
    }
}

let unsub = null;
onMounted(() => {
    unsub = listenToOrders('tracker', (list) => {
        orders.value = list;
        state.orders = list; // keep legacy search in sync
    });
});
onUnmounted(() => { if (unsub) unsub(); });
</script>

<template>
    <div v-if="filtered.length === 0" class="col-span-full text-center py-16 px-4 bg-white/60 rounded-3xl border border-dashed border-gray-200">
        <div class="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
            <i class="fas fa-spinner fa-spin text-xl"></i>
        </div>
        <p class="text-gray-700 font-bold text-sm">Escuchando pedidos...</p>
        <p class="text-gray-400 text-xs mt-1">Los pedidos activos se mostrarán aquí en tiempo real.</p>
    </div>
    
    <div v-for="o in filtered" :key="o.id"
        class="p-2.5 sm:p-3 rounded-2xl border shadow-2xs hover:shadow-md transition-all duration-200 flex items-center gap-2.5 sm:gap-3 relative group select-none hover:-translate-y-0.5"
        :class="getStatusTheme(o.status).cardBg">
        
        <!-- Fila 1 y 2: Icono animado -->
        <div class="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0"
            :class="getStatusTheme(o.status).iconBg">
            <span v-if="getStatusTheme(o.status).pulse"
                class="absolute inset-0 rounded-xl bg-current opacity-25 animate-ping"></span>
            <i class="text-lg sm:text-xl relative z-10 transition-transform group-hover:scale-110"
                :class="getStatusTheme(o.status).icon"></i>
        </div>

        <!-- Filas de información a la derecha -->
        <div class="flex-1 min-w-0 flex flex-col justify-center">
            <!-- Fila 1: ID Pedido (y mesa si aplica) -->
            <div class="flex items-center justify-between gap-1 leading-tight">
                <span class="text-sm sm:text-base font-extrabold text-gray-900 tracking-tight">#{{ o.id }}</span>
                <span v-if="o.table" class="text-[10px] font-semibold text-gray-500 truncate">Mesa {{ o.table }}</span>
            </div>

            <!-- Fila 2: Estado Pedido -->
            <div class="mt-1">
                <span class="inline-block px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-bold uppercase tracking-wider truncate shadow-2xs"
                    :class="getStatusTheme(o.status).badge">
                    {{ o.status }}
                </span>
            </div>
        </div>
    </div>
</template>
