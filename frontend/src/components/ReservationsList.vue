<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { ApiClient } from '@/legacy/services/api-client.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const reservations = ref([]);

const sorted = computed(() =>
    [...reservations.value].sort((a, b) => new Date(a.reservation_date) - new Date(b.reservation_date))
);

function dateStr(r) {
    return new Date(r.reservation_date).toLocaleString('es-CO', {
        weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

async function load() {
    if (!ApiClient.token && !localStorage.getItem('pos_token')) return;
    try {
        const data = await ApiClient.get('/admin/reservations');
        reservations.value = data || [];
        if (window._setCachedReservations) window._setCachedReservations(reservations.value);
        if (window._refreshReservationsCalendar) window._refreshReservationsCalendar();
    } catch (e) {
        console.error(e);
    }
}

function viewReservation(id) { if (window.viewReservation) window.viewReservation(id); }
function editReservation(id) { if (window.editReservation) window.editReservation(id); }
function deleteReservation(r) {
    showConfirmModal('Eliminar Reserva', '¿Eliminar esta reserva? No se puede deshacer.', async () => {
        try {
            await ApiClient.delete(`/admin/reservations/${r.id}`);
            reservations.value = reservations.value.filter(x => x.id !== r.id);
            if (window._setCachedReservations) window._setCachedReservations(reservations.value);
            if (window._refreshReservationsCalendar) window._refreshReservationsCalendar();
            toast('Reserva eliminada', 'success');
        } catch (e) {
            console.error('Error deleting reservation:', e);
            toast('Error eliminando la reserva', 'error');
        }
    });
}

onMounted(() => {
    window._reloadReservations = load;
    if (ApiClient.token || localStorage.getItem('pos_token')) {
        load();
    }
});

watch(() => state.user, (u) => {
    if (u && (ApiClient.token || localStorage.getItem('pos_token'))) {
        load();
    }
});
</script>

<template>
    <div v-if="sorted.length === 0" class="text-center text-gray-400 text-xs py-6">No hay reservas registradas</div>
    <div v-for="r in sorted" :key="r.id"
        class="p-3.5 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all relative group">
        <div class="flex justify-between items-start mb-1 pr-7">
            <h4 class="font-bold text-gray-800 text-sm leading-tight">{{ r.client_name }}</h4>
            <span class="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold shrink-0">{{ r.pax || '?' }} pers.</span>
        </div>
        <div class="text-xs text-emerald-600 flex items-center gap-1 mb-0.5"><i class="fas fa-clock text-[10px]"></i> {{ dateStr(r) }}</div>
        <div v-if="r.table_num" class="text-[10px] text-gray-500"><i class="fas fa-chair mr-1 text-gray-400"></i>Mesa {{ r.table_num }}</div>
        <div v-if="r.observation" class="text-[10px] text-gray-500 truncate mt-0.5"><i class="fas fa-sticky-note mr-1 text-gray-400"></i>{{ r.observation }}</div>

        <div class="absolute top-3 right-3 flex items-center">
            <div class="relative inline-block text-left table-action-container">
                <button type="button" class="table-action-trigger w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                <div class="table-action-menu hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                    <button type="button" @click="viewReservation(r.id)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalle</span></button>
                    <button type="button" @click="editReservation(r.id)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-amber-600 hover:bg-amber-50 transition-colors"><i class="fas fa-pen w-4 text-center"></i> <span>Editar</span></button>
                    <button type="button" @click="deleteReservation(r)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span></button>
                </div>
            </div>
        </div>
    </div>
</template>
