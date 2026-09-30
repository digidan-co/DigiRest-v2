<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { getUsers } from '@/legacy/services/auth-service.js';
import { formatScheduleSummary, openUserScheduleModal, setUserScheduleUsersCache } from '@/legacy/features/user-schedule.js';

const users = ref([]);
const loading = ref(false);

const roleLabels = {
    admin: 'bg-purple-100 text-purple-700',
    cajero: 'bg-teal-100 text-teal-700',
    chef: 'bg-orange-100 text-orange-700',
    delivery: 'bg-blue-100 text-blue-700',
    mesero: 'bg-green-100 text-green-700',
};
const roleUpper = { admin: 'ADMIN', cajero: 'CAJERO', chef: 'CHEF', delivery: 'REPARTIDOR', mesero: 'MESERO' };

const visibleUsers = computed(() => users.value.filter(u => u.name !== 'digidanMasterAdmin' && u.id !== 'digidan_master_admin'));

function roleClass(u) { return roleLabels[u.role] || 'bg-gray-100 text-gray-700'; }
function roleLabel(u) { return roleUpper[u.role] || (u.role || '').toUpperCase(); }
function displayName(u) { return u.name || u.user || 'Sin Nombre'; }
function displayUsername(u) { return u.username || u.user || u.name || 'Sin Usuario'; }

function canAccessUsers() {
    const user = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
    return user && user.role === 'admin';
}

async function load() {
    if (!localStorage.getItem('pos_token') || !canAccessUsers()) return;
    loading.value = true;
    try {
        const list = await getUsers();
        users.value = list || [];
        setUserScheduleUsersCache(users.value);
    } catch (e) { console.error(e); }
    finally { loading.value = false; }
}

function editUser(u) { if (window.editUser) window.editUser(u.id, u.name || '', u.username || u.user || u.name || '', u.role); }
function deleteUser(u) { if (window.deleteUser) window.deleteUser(u.id); }
function openSchedule(u) { openUserScheduleModal(u.id); }
function newUser() {
    const $ = (id) => document.getElementById(id);
    if ($('user-modal-title')) $('user-modal-title').textContent = 'Nuevo Usuario';
    if ($('u-id')) $('u-id').value = '';
    const form = $('user-form');
    if (form) form.reset();
    if ($('btn-save-user')) $('btn-save-user').innerText = 'Crear Usuario';
    if ($('user-modal')) $('user-modal').classList.remove('hidden');
}

onMounted(() => {
    if (localStorage.getItem('pos_token') && canAccessUsers()) {
        load();
    }
});

watch(() => state.user, (u) => {
    if (u && localStorage.getItem('pos_token') && u.role === 'admin') {
        load();
    }
});
</script>

<template>
    <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div>
                <h3 class="font-bold text-lg text-gray-800">Gestión de Usuarios</h3>
                <p class="text-xs text-gray-500">Administra accesos y roles (Admin, Mesero, Chef, Repartidor)</p>
            </div>
            <button type="button" @click="newUser" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"><i class="fas fa-plus"></i> Nuevo Usuario</button>
        </div>
        <div class="bg-white rounded-2xl border border-gray-100 overflow-hidden overflow-x-auto">
            <table class="w-full text-left text-sm">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                        <th class="p-4">Nombre</th>
                        <th class="p-4">Usuario</th>
                        <th class="p-4">Rol</th>
                        <th class="p-4">Contraseña</th>
                        <th class="p-4">Jornada Laboral</th>
                        <th class="p-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-if="loading"><td colspan="6" class="text-center py-4 text-gray-400">Cargando usuarios...</td></tr>
                    <tr v-else-if="visibleUsers.length === 0"><td colspan="6" class="text-center py-4 text-gray-400">No hay usuarios registrados.</td></tr>
                    <tr v-for="u in visibleUsers" :key="u.id" class="hover:bg-gray-50 transition-colors group">
                        <td class="p-3 font-semibold text-gray-800 text-xs">{{ displayName(u) }}</td>
                        <td class="p-3 font-mono text-xs text-gray-600">{{ displayUsername(u) }}</td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="roleClass(u)">{{ roleLabel(u) }}</span></td>
                        <td class="p-3 font-mono text-gray-400 text-xs">••••••••</td>
                        <td class="p-3">
                            <span v-if="u.role === 'admin'" class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full"><i class="fas fa-shield-alt text-[10px]"></i> Admin (Libre)</span>
                            <div v-else class="inline-flex items-center gap-2.5">
                                <button type="button" @click="openSchedule(u)" class="w-7 h-7 rounded-lg bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center transition-all hover:opacity-90 shrink-0 cursor-pointer shadow-xs" title="Asignar Jornada Laboral"><i class="fas fa-business-time text-[var(--system-secondary)] text-xs"></i></button>
                                <span v-html="formatScheduleSummary(u.work_schedule)"></span>
                            </div>
                        </td>
                        <td class="p-3 text-right">
                            <div class="relative inline-block text-left table-action-container">
                                <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones"><i class="fas fa-ellipsis-v text-xs"></i></button>
                                <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                    <button type="button" @click="editUser(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar</span></button>
                                    <button v-if="u.role !== 'admin'" type="button" @click="openSchedule(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors"><i class="fas fa-clock w-4 text-center text-amber-500"></i> <span>Horario y Jornada</span></button>
                                    <button type="button" @click="deleteUser(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span></button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
