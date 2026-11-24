<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { getDeliveryZones, toggleDeliveryZone, deleteDeliveryZone, listenToDeliveryZones, importDeliveryZonesCSV, exportDeliveryZonesCSV } from '@/legacy/services/delivery-service.js';
import { openDeliveryZoneModal, populateClientDeliveryZones } from '@/legacy/features/delivery-zones-manager.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';
import { ApiClient } from '@/legacy/services/api-client.js';

const currentDeliveryModel = computed(() => state.restaurantData?.deliveryFeeModel || 'driver');

async function setDeliveryModel(model) {
    if (currentDeliveryModel.value === model) return;
    try {
        const newData = { ...state.restaurantData, deliveryFeeModel: model };
        await ApiClient.post('/config', { key: 'dataRestaurant', value: newData });
        state.restaurantData.deliveryFeeModel = model;
        toast(model === 'driver' ? 'Modelo configurado: Domiciliarios Tercerizados' : 'Modelo configurado: Domiciliarios Propios', 'success');
    } catch (err) {
        console.error(err);
        toast('Error guardando configuración', 'error');
    }
}

const searchTerm = ref('');
const openMenuId = ref(null);
const importingZones = ref(false);
const fileZonesRef = ref(null);

function exportZones() {
    exportDeliveryZonesCSV();
}

async function onImportZones(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
        toast('Por favor selecciona un archivo CSV', 'error');
        return;
    }
    importingZones.value = true;
    try {
        const res = await importDeliveryZonesCSV(file);
        toast(res.message || 'Zonas de domicilio importadas correctamente', 'success');
        await load();
        populateClientDeliveryZones();
    } catch (err) {
        console.error(err);
        toast('Error al importar zonas: ' + (err.message || ''), 'error');
    } finally {
        importingZones.value = false;
        e.target.value = '';
    }
}

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

function toggleMenu(id) {
    openMenuId.value = openMenuId.value === id ? null : id;
}

function closeMenu() {
    openMenuId.value = null;
}

function handleEdit(z) {
    closeMenu();
    openDeliveryZoneModal(z);
}

function newZone() {
    closeMenu();
    openDeliveryZoneModal();
}

function handleDelete(z) {
    closeMenu();
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

let unlisten = null;

onMounted(() => {
    load();
    unlisten = listenToDeliveryZones((updatedZones) => {
        state.deliveryZones = updatedZones || [];
    });
    document.addEventListener('click', closeMenu);
});

onUnmounted(() => {
    if (unlisten) unlisten();
    document.removeEventListener('click', closeMenu);
});
</script>

<template>
    <!-- Banner de Modelo de Recaudo de Domicilios -->
    <div class="bg-gradient-to-r from-orange-50 to-amber-50/50 p-4 rounded-2xl border border-orange-200/80 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div class="flex items-start gap-3">
            <span class="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <i class="fas fa-hand-holding-usd text-xs"></i>
            </span>
            <div>
                <div class="flex items-center gap-2">
                    <h4 class="font-extrabold text-xs text-gray-900">Modelo Contable de Recaudo por Domicilio</h4>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        :class="currentDeliveryModel === 'driver' ? 'bg-orange-100 text-orange-800 border border-orange-300' : 'bg-blue-100 text-blue-800 border border-blue-300'">
                        {{ currentDeliveryModel === 'driver' ? 'Tercerizado / Repartidores' : 'Propio / Nómina' }}
                    </span>
                </div>
                <p class="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
                    {{ currentDeliveryModel === 'driver' 
                        ? 'El cobro del domicilio pertenece al repartidor independiente. En el cierre de caja se liquida registrando un egreso formal para que la caja física cuadre exacta.'
                        : 'El cobro del domicilio ingresa como venta y beneficio operativo directo del restaurante para cubrir costos fijos o nómina.' }}
                </p>
            </div>
        </div>
        <div class="flex items-center bg-white p-1 rounded-xl border border-orange-200 shadow-2xs shrink-0 self-end sm:self-center">
            <button type="button" @click="setDeliveryModel('driver')"
                class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                :class="currentDeliveryModel === 'driver' ? 'bg-orange-500 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'">
                Tercerizado
            </button>
            <button type="button" @click="setDeliveryModel('restaurant')"
                class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer"
                :class="currentDeliveryModel === 'restaurant' ? 'bg-blue-600 text-white shadow-xs' : 'text-gray-600 hover:text-gray-900'">
                Propio
            </button>
        </div>
    </div>

    <!-- Header / Barra de controles -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div>
            <h3 class="text-sm font-black text-gray-900 flex items-center gap-2">
                <i class="fas fa-motorcycle text-orange-500"></i> Zonas de Domicilio
            </h3>
            <p class="text-[11px] text-gray-400">Configuración de sectores, tarifas de envío y tiempos estimados</p>
        </div>
        <div class="flex items-center gap-2.5 w-full sm:w-auto">
            <div class="relative flex-1 sm:w-64">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input
                    v-model="searchTerm"
                    type="text"
                    placeholder="Buscar zona o sector..."
                    class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs"
                >
            </div>
            <input type="file" ref="fileZonesRef" accept=".csv" class="hidden" @change="onImportZones">
            <button type="button" @click="exportZones"
                class="px-3.5 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Exportar zonas a CSV">
                <i class="fas fa-file-export text-gray-500"></i> Exportar
            </button>
            <button type="button" @click="fileZonesRef?.click()" :disabled="importingZones"
                class="px-3.5 py-2 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs" title="Importar zonas desde CSV">
                <i class="fas" :class="importingZones ? 'fa-spinner fa-spin' : 'fa-file-import text-gray-500'"></i> Importar
            </button>
            <button
                type="button"
                @click="newZone"
                class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs shrink-0"
            >
                <i class="fas fa-plus"></i>
                <span>Nueva Zona</span>
            </button>
        </div>
    </div>

    <!-- Cards en Vertical (Grid) -->
    <div v-if="filteredZones.length > 0" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div
            v-for="zone in filteredZones"
            :key="zone.id"
            class="bg-white rounded-2xl p-5 border shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative group"
            :class="isAvail(zone) ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40'"
        >
            <div>
                <!-- 1. ZONA (con icono de 3 puntos en la parte superior derecha) -->
                <div class="flex items-start justify-between gap-2 mb-2">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                        <div class="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-orange-600 font-bold text-xs shrink-0 shadow-2xs">
                            <i class="fas fa-map-marker-alt"></i>
                        </div>
                        <div class="min-w-0 flex-1">
                            <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block leading-none mb-1">Zona</span>
                            <h4 class="font-bold text-gray-800 text-sm leading-snug truncate" :title="zone.name">
                                {{ zone.name }}
                            </h4>
                        </div>
                    </div>

                    <!-- Menú de 3 puntos (Superior Derecha) -->
                    <div class="relative shrink-0">
                        <button
                            type="button"
                            @click.stop="toggleMenu(zone.id)"
                            class="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                            title="Opciones"
                            aria-label="Menú de opciones"
                        >
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>

                        <!-- Dropdown de Acciones -->
                        <div
                            v-if="openMenuId === zone.id"
                            class="absolute right-0 top-9 w-36 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 z-30 divide-y divide-gray-50"
                            @click.stop
                        >
                            <div class="py-0.5">
                                <button
                                    type="button"
                                    @click="handleEdit(zone)"
                                    class="w-full px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer transition-colors"
                                >
                                    <i class="fas fa-pen text-gray-400 text-xs w-4"></i>
                                    <span>Editar</span>
                                </button>
                            </div>
                            <div class="py-0.5">
                                <button
                                    type="button"
                                    @click="handleDelete(zone)"
                                    class="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer transition-colors"
                                >
                                    <i class="fas fa-trash-alt text-rose-500 text-xs w-4"></i>
                                    <span>Eliminar</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. TARIFA (Grande) -->
                <div class="dz-tariff-box py-3 px-3.5 bg-gray-50/90 rounded-xl border border-gray-100">
                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Tarifa</span>
                    <div class="text-2xl font-black text-gray-900 tracking-tight leading-none">
                        {{ formatMoney(zone.fee) }}
                    </div>
                </div>

                <!-- 3. TIEMPO -->
                <div class="dz-time-row flex items-center gap-2 text-xs text-gray-600 font-medium">
                    <span class="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-[11px] shrink-0">
                        <i class="fas fa-clock"></i>
                    </span>
                    <div>
                        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider block leading-none mb-0.5">Tiempo Estimado</span>
                        <span class="text-xs font-semibold text-gray-700">{{ estimatedTime(zone) }}</span>
                    </div>
                </div>
            </div>

            <!-- 4. DISPONIBILIDAD -->
            <div class="pt-3 border-t border-gray-100 flex items-center justify-between">
                <span class="text-xs text-gray-500 font-medium">Disponibilidad</span>
                <button
                    type="button"
                    @click="toggle(zone)"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all active:scale-95 shadow-2xs select-none"
                    :class="isAvail(zone)
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100'
                        : 'bg-rose-50 text-rose-700 border border-rose-200/80 hover:bg-rose-100'"
                    :title="isAvail(zone) ? 'Haz click para desactivar' : 'Haz click para activar'"
                >
                    <span class="w-2 h-2 rounded-full" :class="isAvail(zone) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'"></span>
                    <span>{{ isAvail(zone) ? 'Disponible' : 'Inactivo' }}</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Empty State -->
    <div v-else class="text-center p-4 bg-white rounded-2xl border border-gray-100">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-orange-50 text-orange-400 flex items-center justify-center text-2xl mb-3 shadow-xs">
            <i class="fas fa-motorcycle"></i>
        </div>
        <p class="text-sm font-bold text-gray-700">No hay zonas de domicilio registradas</p>
        <p class="text-xs text-gray-400 mt-1">
            {{ searchTerm ? 'No se encontraron zonas que coincidan con la búsqueda.' : 'Crea tu primera zona pulsando "Nueva Zona"' }}
        </p>
    </div>
</template>

<style scoped>
.dz-tariff-box {
    margin-top: 1rem !important;
    margin-bottom: 1rem !important;
}
.dz-time-row {
    margin-bottom: 1rem !important;
}
</style>
