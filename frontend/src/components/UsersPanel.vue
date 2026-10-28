<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { getUsers, updateUserFinanceAccounts } from '@/legacy/services/auth-service.js';
import { getAccounts } from '@/legacy/services/cashflow-service.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { toast } from '@/legacy/components/ui.js';
import { formatScheduleSummary, openUserScheduleModal, setUserScheduleUsersCache } from '@/legacy/features/user-schedule.js';

const users = ref([]);
const loading = ref(false);

// Estado para el modal de asignación de cuentas de fondos
const showAccountsModal = ref(false);
const currentUserForAccounts = ref(null);
const availableAccounts = ref([]);
const selectedAccountIds = ref([]);
const loadingAccounts = ref(false);
const savingAccounts = ref(false);

const roleLabels = {
    admin: 'bg-purple-100 text-purple-700',
    supervisor: 'bg-indigo-100 text-indigo-700',
    cajero: 'bg-teal-100 text-teal-700',
    chef: 'bg-orange-100 text-orange-700',
    delivery: 'bg-blue-100 text-blue-700',
    mesero: 'bg-green-100 text-green-700',
};
const roleUpper = { admin: 'ADMIN', supervisor: 'SUPERVISOR', cajero: 'CAJERO', chef: 'CHEF', delivery: 'REPARTIDOR', mesero: 'MESERO' };

const visibleUsers = computed(() => users.value.filter(u => u.name !== 'digidanMasterAdmin' && u.id !== 'digidan_master_admin'));

function roleClass(u) { return roleLabels[u?.role] || 'bg-gray-100 text-gray-700'; }
function roleLabel(u) { return roleUpper[u?.role] || (u?.role || '').toUpperCase(); }
function displayName(u) { return u?.name || u?.user || 'Sin Nombre'; }
function displayUsername(u) { return u?.username || u?.user || u?.name || 'Sin Usuario'; }

function canAccessUsers() {
    const user = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
    return user && user.role === 'admin';
}

function isFinanceRole(role) {
    return role === 'cajero' || role === 'supervisor';
}

function parseAllowedAccounts(u) {
    if (!u || !u.allowed_finance_accounts) return [];
    try {
        const parsed = typeof u.allowed_finance_accounts === 'string'
            ? JSON.parse(u.allowed_finance_accounts)
            : u.allowed_finance_accounts;
        return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
        return [];
    }
}

function getAccountsSummary(u) {
    const list = parseAllowedAccounts(u);
    if (list.length === 0) {
        return {
            text: 'Sin fondos (Bloqueado)',
            badgeClass: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
            icon: 'fa-lock'
        };
    }
    return {
        text: `${list.length} ${list.length === 1 ? 'fondo' : 'fondos'}`,
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100',
        icon: 'fa-wallet'
    };
}

async function openAccountsModal(u) {
    currentUserForAccounts.value = u;
    selectedAccountIds.value = [...parseAllowedAccounts(u)];
    showAccountsModal.value = true;
    loadingAccounts.value = true;
    try {
        const accounts = await getAccounts();
        availableAccounts.value = accounts || [];
    } catch (err) {
        console.error('Error cargando cuentas financieras:', err);
        toast('Error al cargar cuentas financieras', 'error');
    } finally {
        loadingAccounts.value = false;
    }
}

function closeAccountsModal() {
    showAccountsModal.value = false;
    currentUserForAccounts.value = null;
}

function toggleAccountSelection(accId) {
    const id = Number(accId);
    const idx = selectedAccountIds.value.indexOf(id);
    if (idx > -1) {
        selectedAccountIds.value.splice(idx, 1);
    } else {
        selectedAccountIds.value.push(id);
    }
}

function selectAllAccounts() {
    selectedAccountIds.value = availableAccounts.value.map(a => Number(a.id));
}

function deselectAllAccounts() {
    selectedAccountIds.value = [];
}

async function saveUserAccounts() {
    if (!currentUserForAccounts.value) return;
    savingAccounts.value = true;
    try {
        const targetId = currentUserForAccounts.value.id;
        const newIds = [...selectedAccountIds.value];
        await updateUserFinanceAccounts(targetId, newIds);

        // Actualizar en el estado local reactivo
        const jsonStr = JSON.stringify(newIds);
        const found = users.value.find(u => u.id === targetId);
        if (found) {
            found.allowed_finance_accounts = jsonStr;
        }
        if (currentUserForAccounts.value) {
            currentUserForAccounts.value.allowed_finance_accounts = jsonStr;
        }

        toast('Permisos de fondos actualizados correctamente', 'success');
        closeAccountsModal();
    } catch (err) {
        console.error('Error guardando permisos de fondos:', err);
        toast(err.message || 'Error al guardar permisos de fondos', 'error');
    } finally {
        savingAccounts.value = false;
    }
}

async function load() {
    if (!localStorage.getItem('pos_token') || !canAccessUsers()) return;
    loading.value = true;
    try {
        const list = await getUsers();
        users.value = list || [];
        setUserScheduleUsersCache(users.value);
    } catch (e) { console.error('Error al cargar usuarios:', e); }
    finally { loading.value = false; }
}

function editUser(u) { 
    if (window.editUser) {
        window.editUser(u.id, u.name || '', u.username || u.user || u.name || '', u.role); 
    }
}

function deleteUser(u) { 
    if (window.deleteUser) {
        window.deleteUser(u.id); 
    }
}

function openSchedule(u) { 
    // Pass user object directly so modal opens immediately without relying on cache search
    openUserScheduleModal(u); 
}

function newUser() {
    const $ = (id) => document.getElementById(id);
    if ($('user-modal-title')) $('user-modal-title').textContent = 'Nuevo Usuario';
    // Clear user-id hidden field so it creates a new user instead of overwriting a previous one
    if ($('user-id')) $('user-id').value = '';
    if ($('u-id')) $('u-id').value = '';
    const form = $('user-form');
    if (form) form.reset();
    if ($('user-name')) $('user-name').value = '';
    if ($('user-username')) $('user-username').value = '';
    if ($('user-code')) {
        $('user-code').value = '';
        $('user-code').required = true;
        $('user-code').placeholder = "Contraseña (letras, números y símbolos)";
    }
    if ($('btn-save-user')) $('btn-save-user').innerText = 'Crear Usuario';
    if ($('user-modal')) $('user-modal').classList.remove('hidden');
}

function handleEscapeKey(e) {
    if (e.key === 'Escape' && showAccountsModal.value) {
        closeAccountsModal();
        e.stopPropagation();
    }
}

function handleAppEscape(e) {
    if (showAccountsModal.value) {
        closeAccountsModal();
        if (e && e.preventDefault) e.preventDefault();
    }
}

onMounted(() => {
    window.reloadUsersPanel = load;
    window.addEventListener('users-refresh', load);
    window.addEventListener('keydown', handleEscapeKey);
    window.addEventListener('app:escape', handleAppEscape);
    if (window.socket) {
        window.socket.on('users_updated', load);
    }
    if (localStorage.getItem('pos_token') && canAccessUsers()) {
        load();
    }
});

onUnmounted(() => {
    window.removeEventListener('users-refresh', load);
    window.removeEventListener('keydown', handleEscapeKey);
    window.removeEventListener('app:escape', handleAppEscape);
    if (window.socket) {
        window.socket.off('users_updated', load);
    }
    if (window.reloadUsersPanel === load) {
        window.reloadUsersPanel = null;
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
                <p class="text-xs text-gray-500">Administra accesos, roles, fondos monetarios y jornadas laborales</p>
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
                        <th class="p-4">Fondos de Caja</th>
                        <th class="p-4">Jornada Laboral</th>
                        <th class="p-4 text-right">Acciones</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-if="loading"><td colspan="7" class="text-center py-4 text-gray-400">Cargando usuarios...</td></tr>
                    <tr v-else-if="visibleUsers.length === 0"><td colspan="7" class="text-center py-4 text-gray-400">No hay usuarios registrados.</td></tr>
                    <tr v-for="u in visibleUsers" :key="u.id" class="hover:bg-gray-50 transition-colors group">
                        <td class="p-3 font-semibold text-gray-800 text-xs">{{ displayName(u) }}</td>
                        <td class="p-3 font-mono text-xs text-gray-600">{{ displayUsername(u) }}</td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="roleClass(u)">{{ roleLabel(u) }}</span></td>
                        <td class="p-3 font-mono text-gray-400 text-xs">••••••••</td>
                        <td class="p-3">
                            <span v-if="u.role === 'admin'" class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                                <i class="fas fa-shield-alt text-[10px]"></i> Todos (Admin)
                            </span>
                            <div v-else-if="isFinanceRole(u.role)" class="inline-flex items-center gap-2">
                                <button 
                                    type="button" 
                                    @click="openAccountsModal(u)" 
                                    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border cursor-pointer hover:shadow-xs active:scale-95"
                                    :class="getAccountsSummary(u).badgeClass"
                                    title="Configurar cuentas monetarias permitidas"
                                >
                                    <i class="fas" :class="getAccountsSummary(u).icon"></i>
                                    <span>{{ getAccountsSummary(u).text }}</span>
                                </button>
                            </div>
                            <span v-else class="text-gray-300 text-xs px-2">-</span>
                        </td>
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
                                <div class="table-action-menu hidden absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                    <button type="button" @click="editUser(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors"><i class="fas fa-edit w-4 text-center"></i> <span>Editar</span></button>
                                    <button v-if="isFinanceRole(u.role)" type="button" @click="openAccountsModal(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-teal-700 hover:bg-teal-50 transition-colors"><i class="fas fa-wallet w-4 text-center text-teal-600"></i> <span>Cuentas Permitidas</span></button>
                                    <button v-if="u.role !== 'admin'" type="button" @click="openSchedule(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors"><i class="fas fa-clock w-4 text-center text-amber-500"></i> <span>Horario y Jornada</span></button>
                                    <button type="button" @click="deleteUser(u)" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span></button>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- MODAL: Asignación de Cuentas y Fondos Permitidos -->
        <Teleport to="body">
            <div v-if="showAccountsModal" class="fixed inset-0 z-[110] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
                <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]">
                    <!-- Header -->
                    <div class="flex items-center justify-between pb-4 border-b border-gray-100">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center text-base">
                                <i class="fas fa-wallet"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-base text-gray-900 leading-tight">Cuentas y Fondos Permitidos</h3>
                                <p class="text-xs text-gray-500 mt-0.5">
                                    Usuario: <span class="font-semibold text-gray-800">{{ displayName(currentUserForAccounts) }}</span>
                                    <span class="ml-1.5 px-2 py-0.5 rounded text-[9px] font-bold" :class="roleClass(currentUserForAccounts)">{{ roleLabel(currentUserForAccounts) }}</span>
                                </p>
                            </div>
                        </div>
                        <button type="button" @click="closeAccountsModal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors">
                            <i class="fas fa-times text-xs"></i>
                        </button>
                    </div>

                    <!-- Explicación de privacidad -->
                    <div class="my-4 p-3 bg-amber-50/70 rounded-2xl border border-amber-200/60 flex items-start gap-2.5">
                        <i class="fas fa-shield-alt text-amber-600 mt-0.5 text-xs shrink-0"></i>
                        <p class="text-[11px] text-amber-800 leading-relaxed">
                            Selecciona los fondos a los que este <strong>{{ roleLabel(currentUserForAccounts) }}</strong> tendrá acceso en el Flujo de Caja. Las cuentas no marcadas permanecerán <strong>100% privadas y ocultas</strong> para él.
                        </p>
                    </div>

                    <!-- Acciones rápidas -->
                    <div class="flex items-center justify-between mb-3 px-1 text-xs">
                        <span class="text-gray-500 font-medium">
                            Seleccionadas: <strong class="text-gray-800 font-mono">{{ selectedAccountIds.length }}</strong> de {{ availableAccounts.length }}
                        </span>
                        <div class="flex items-center gap-3">
                            <button type="button" @click="selectAllAccounts" class="text-teal-600 hover:text-teal-700 font-bold hover:underline transition-colors cursor-pointer">Seleccionar todas</button>
                            <span class="text-gray-300">•</span>
                            <button type="button" @click="deselectAllAccounts" class="text-gray-500 hover:text-red-600 font-bold hover:underline transition-colors cursor-pointer">Deseleccionar</button>
                        </div>
                    </div>

                    <!-- Lista de Cuentas -->
                    <div class="flex-1 overflow-y-auto space-y-2 pr-1 my-1">
                        <div v-if="loadingAccounts" class="py-12 text-center text-gray-400 text-xs">
                            <i class="fas fa-spinner fa-spin text-lg text-teal-600 mb-2"></i>
                            <p>Cargando cuentas financieras...</p>
                        </div>
                        <div v-else-if="availableAccounts.length === 0" class="py-8 text-center text-gray-400 text-xs">
                            <i class="fas fa-wallet text-2xl text-gray-300 mb-2"></i>
                            <p>No hay cuentas financieras registradas en el Flujo de Caja.</p>
                        </div>
                        <div 
                            v-else
                            v-for="acc in availableAccounts" 
                            :key="acc.id"
                            @click="toggleAccountSelection(acc.id)"
                            class="flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer select-none"
                            :class="selectedAccountIds.includes(Number(acc.id)) 
                                ? 'border-teal-500 bg-teal-50/50 shadow-xs' 
                                : 'border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50/60 opacity-75'"
                        >
                            <div class="flex items-center gap-3.5 min-w-0">
                                <!-- Checkbox explícito con v-if -->
                                <div 
                                    class="w-6 h-6 rounded-lg flex items-center justify-center border transition-all shrink-0 text-xs shadow-2xs"
                                    :class="selectedAccountIds.includes(Number(acc.id)) 
                                        ? 'bg-teal-600 border-teal-600 text-white' 
                                        : 'border-gray-300 bg-white'"
                                >
                                    <i v-if="selectedAccountIds.includes(Number(acc.id))" class="fas fa-check text-[11px] text-white"></i>
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <h4 class="font-bold text-xs text-gray-900 truncate">{{ acc.name }}</h4>
                                        <span class="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-gray-100 text-gray-600">{{ acc.type }}</span>
                                        <!-- Badge explícito de estado para máxima claridad -->
                                        <span 
                                            v-if="selectedAccountIds.includes(Number(acc.id))" 
                                            class="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-200"
                                        >
                                            <i class="fas fa-eye text-[8px]"></i> Visible para cajero
                                        </span>
                                        <span 
                                            v-else 
                                            class="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                                        >
                                            <i class="fas fa-eye-slash text-[8px]"></i> Oculta y Privada
                                        </span>
                                    </div>
                                    <p class="text-[10px] text-gray-400 truncate mt-0.5">
                                        {{ acc.bank_name || 'Sin entidad' }} {{ acc.account_number ? '• ' + acc.account_number : '' }}
                                    </p>
                                </div>
                            </div>
                            <div class="text-right pl-3 shrink-0">
                                <span class="text-xs font-mono font-bold text-gray-700">
                                    {{ formatMoney(acc.current_balance) }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="pt-4 mt-2 flex items-center justify-end gap-2 border-t border-gray-100">
                        <button 
                            type="button" 
                            @click="closeAccountsModal" 
                            class="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 transition-colors cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="button" 
                            @click="saveUserAccounts" 
                            :disabled="savingAccounts"
                            class="px-5 py-2.5 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
                        >
                            <i v-if="savingAccounts" class="fas fa-spinner fa-spin"></i>
                            <i v-else class="fas fa-check"></i>
                            <span>{{ savingAccounts ? 'Guardando...' : 'Guardar Permisos' }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

