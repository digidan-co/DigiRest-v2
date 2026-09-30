<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { getDeliveryZones, toggleDeliveryZone, deleteDeliveryZone } from '@/legacy/services/delivery-service.js';
import { openDeliveryZoneModal, populateClientDeliveryZones } from '@/legacy/features/delivery-zones-manager.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const searchTerm = ref('');

const filteredZones = computed(() => {
    const term = searchTerm.value.toLowerCase().trim();
    const zones = state.deliveryZones || [];
    if (!term) return zones;
    return zones.filter(z => (z.name || '').toLowerCase().includes(term));
});

function isAvail(z) { return z.available === 1 || z.available === true; }
function estimatedTime(z) { return z.estimated_time || '30-45 min'; }

async function load() {
    try { state.deliveryZones = await getDeliveryZones(); } catch (e) { console.error(e); }
}

async function toggle(z) {
    try {
        const res = await toggleDeliveryZone(z.id);
        z.available = res.available;
        populateClientDeliveryZones();
        toast(`Zona ${z.name} ahora está ${z.available ? 'disponible' : 'inactiva'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error al cambiar disponibilidad', 'error');
    }
}

function edit(z) { openDeliveryZoneModal(z); }
function newZone() { openDeliveryZoneModal(); }

function del(z) {
    showConfirmModal('Eliminar Zona de Domicilio', `¿Estás seguro de que deseas eliminar la zona "${z.name}"? Esta acción no se puede deshacer.`, async () => {
        try {
            await deleteDeliveryZone(z.id);
            state.deliveryZones = (state.deliveryZones || []).filter(x => x.id !== z.id);
            populateClientDeliveryZones();
            toast('Zona eliminada con éxito', 'success');
        } catch (err) {
            console.error(err);
            toast('Error al eliminar: ' + (err.message || 'Error desconocido'), 'error');
        }
    });
}

onMounted(load);
</script>

<template>
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
        <div class="relative flex-1 sm:w-64">
            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input v-model="searchTerm" type="text" placeholder="Buscar zona..."
                class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs">
        </div>
        <button type="button" @click="newZone"
            class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs shrink-0">
            <i class="fas fa-plus"></i> Nueva Zona
        </button>
    </div>

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
        <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                    <th class="p-4">Zona / Sector</th>
                    <th class="p-4">Tarifa de Envío</th>
                    <th class="p-4 text-center">Disponibilidad</th>
                    <th class="p-4 text-center">Acciones</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
                <tr v-for="zone in filteredZones" :key="zone.id" class="hover:bg-gray-50/80 transition-colors border-b border-gray-100 last:border-0">
                    <td class="p-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-orange-600 font-bold text-xs shrink-0"><i class="fas fa-map-marker-alt"></i></div>
                            <div>
                                <div class="font-bold text-gray-800 text-xs">{{ zone.name }}</div>
                                <div class="text-[10px] text-gray-400 flex items-center gap-1.5 mt-0.5"><span><i class="fas fa-clock text-amber-500"></i> {{ estimatedTime(zone) }}</span></div>
                            </div>
                        </div>
                    </td>
                    <td class="p-4">
                        <div class="text-xs font-bold text-gray-900">{{ formatMoney(zone.fee) }}</div>
                        <div class="text-[10px] text-gray-400">Tarifa de envío</div>
                    </td>
                    <td class="p-4 text-center">
                        <button type="button" @click="toggle(zone)" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer transition-all active:scale-95"
                            :class="isAvail(zone) ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-200/80 hover:bg-rose-100'"
                            title="Click para alternar disponibilidad">
                            <span class="w-1.5 h-1.5 rounded-full" :class="isAvail(zone) ? 'bg-emerald-500' : 'bg-rose-500'"></span>
                            <span>{{ isAvail(zone) ? 'Disponible' : 'Inactivo' }}</span>
                        </button>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" @click="edit(zone)" class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer" title="Editar"><i class="fas fa-edit text-xs"></i></button>
                            <button type="button" @click="del(zone)" class="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors cursor-pointer" title="Eliminar"><i class="fas fa-trash-alt text-xs"></i></button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <div v-show="filteredZones.length === 0" class="text-center py-12 bg-white rounded-2xl border border-gray-100">
        <i class="fas fa-map-marker-alt text-4xl text-gray-300 mb-3"></i>
        <p class="text-sm font-semibold text-gray-600">No hay zonas de domicilio registradas</p>
        <p class="text-xs text-gray-400 mt-1">Crea la primera zona pulsando "Nueva Zona"</p>
    </div>
</template>
