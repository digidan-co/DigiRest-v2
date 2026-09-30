<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { getToppings, toggleTopping, deleteTopping } from '@/legacy/services/toppings-service.js';
import { openToppingModal, openToppingGroupsModal, getToppingGroups } from '@/legacy/features/toppings-manager.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';

const searchTerm = ref('');
const filterGroup = ref('');

const groups = computed(() => getToppingGroups());

const filteredToppings = computed(() => {
    let items = state.toppings || [];
    if (filterGroup.value) items = items.filter(t => t.group_name === filterGroup.value);
    const q = searchTerm.value.toLowerCase().trim();
    if (q) items = items.filter(t => (t.name || '').toLowerCase().includes(q) || (t.group_name || '').toLowerCase().includes(q));
    return items;
});

function isAvailable(t) { return t.available !== 0 && t.available !== false; }

async function load() {
    try { state.toppings = await getToppings(); } catch (e) { console.error(e); }
}

async function onToggleAvail(t, checked) {
    try {
        await toggleTopping(t.id);
        t.available = checked ? 1 : 0;
        toast(`Topping ${checked ? 'habilitado' : 'deshabilitado'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error al cambiar disponibilidad', 'error');
    }
}

function editTopping(t) { openToppingModal(t); }
function newTopping() { openToppingModal(null); }
function manageGroups() { openToppingGroupsModal(); }

function deleteToppingItem(t) {
    showConfirmModal('Eliminar Topping', '¿Deseas eliminar este topping / adición? Los platos que lo incluyan ya no lo mostrarán.', async () => {
        try {
            await deleteTopping(t.id);
            state.toppings = (state.toppings || []).filter(x => x.id !== t.id);
            toast('Topping eliminado', 'success');
        } catch (err) {
            console.error(err);
            toast('Error al eliminar topping', 'error');
        }
    });
}

onMounted(load);
</script>

<template>
    <!-- Controls -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex flex-1 items-center gap-3 w-full sm:w-auto">
            <div class="relative flex-1 sm:w-64">
                <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input v-model="searchTerm" type="text" placeholder="Buscar topping / adición..."
                    class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs">
            </div>
            <select v-model="filterGroup" class="p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)]">
                <option value="">Todos los grupos</option>
                <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
            </select>
        </div>
        <div class="flex gap-2 w-full sm:w-auto justify-end">
            <button type="button" @click="manageGroups"
                class="px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all active:scale-95 cursor-pointer shadow-xs">
                <i class="fas fa-layer-group text-amber-600"></i><span>Gestionar Grupos</span>
            </button>
            <button type="button" @click="newTopping"
                class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                <i class="fas fa-plus"></i> Nuevo Topping
            </button>
        </div>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
        <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                    <th class="p-4">Nombre</th>
                    <th class="p-4">Grupo / Tipo</th>
                    <th class="p-4">Precio Sugerido / Base</th>
                    <th class="p-4 text-center">Stock (Porciones)</th>
                    <th class="p-4 text-center">Disponible</th>
                    <th class="p-4 text-center">Acciones</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
                <tr v-for="t in filteredToppings" :key="t.id" class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td class="p-4 font-semibold text-gray-800 text-xs">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full" :class="isAvailable(t) ? 'bg-green-500' : 'bg-gray-300'"></span>
                            <span>{{ t.name }}</span>
                        </div>
                    </td>
                    <td class="p-4 text-xs">
                        <span class="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium">{{ t.group_name || 'General' }}</span>
                    </td>
                    <td class="p-4 text-xs font-bold text-gray-800">
                        <span v-if="t.price > 0">{{ formatMoney(t.price) }}</span>
                        <span v-else class="text-green-600 font-bold">Gratis / $0</span>
                    </td>
                    <td class="p-4 text-center text-xs">
                        <div class="flex flex-col items-center">
                            <span class="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-full text-[11px]"
                                :class="(t.current_stock || 0) <= 0 ? 'bg-red-50 text-red-700 border border-red-200' : ((t.current_stock || 0) <= (t.min_stock || 5) ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')">
                                <i class="fas" :class="(t.current_stock || 0) <= 0 ? 'fa-exclamation-circle text-red-500' : ((t.current_stock || 0) <= (t.min_stock || 5) ? 'fa-exclamation-triangle text-amber-500' : 'fa-box text-emerald-500')"></i>
                                {{ t.current_stock !== undefined ? t.current_stock : 0 }} porc.
                            </span>
                            <span v-if="t.inventory_mode === 'linked_supply'"
                                class="text-[9px] text-blue-600 font-bold mt-0.5 flex items-center gap-0.5"
                                :title="'Descuenta de ' + (t.linked_supply_name || 'Insumo') + ' (' + (t.supply_quantity || 1) + ' ' + (t.linked_supply_unit || '') + '/porc)'">
                                <i class="fas fa-link text-[8px]"></i> {{ t.linked_supply_name || 'Insumo' }}
                            </span>
                            <span v-else class="text-[9px] text-gray-400 font-medium mt-0.5">Propio</span>
                        </div>
                    </td>
                    <td class="p-4 text-center">
                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" class="sr-only peer" :checked="isAvailable(t)" @change="onToggleAvail(t, $event.target.checked)">
                            <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                        </label>
                    </td>
                    <td class="p-4 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" @click="editTopping(t)" class="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer" title="Editar"><i class="fas fa-edit text-xs"></i></button>
                            <button type="button" @click="deleteToppingItem(t)" class="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors cursor-pointer" title="Eliminar"><i class="fas fa-trash-alt text-xs"></i></button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- Empty State -->
    <div v-show="filteredToppings.length === 0" class="text-center py-12 bg-white rounded-2xl border border-gray-100">
        <i class="fas fa-cookie-bite text-4xl text-gray-300 mb-3"></i>
        <p class="text-sm font-semibold text-gray-600">No hay toppings o adiciones registradas</p>
        <p class="text-xs text-gray-400 mt-1">Crea el primer topping pulsando "Nuevo Topping"</p>
    </div>
</template>
