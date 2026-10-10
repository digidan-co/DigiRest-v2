<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { state } from '@/legacy/core/state.js';
import { changePassword } from '@/legacy/services/auth-service.js';
import { toast } from '@/legacy/components/ui.js';

const activeTab = ref('dashboard');
const collapsedSections = ref(new Set());

const sections = [
    { name: 'Operación', tabs: [
        { tab: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
        { tab: 'orders', icon: 'fa-receipt', label: 'Pedidos' },
        { tab: 'reservations', icon: 'fa-calendar-check', label: 'Reservas' },
        { tab: 'delivery-zones', icon: 'fa-motorcycle', label: 'Zonas de Domicilio' },
        { tab: 'crm', icon: 'fa-users', label: 'Clientes' },
    ]},
    { name: 'Menú & Carta', tabs: [
        { tab: 'products', icon: 'fa-utensils', label: 'Platos y Categorías' },
        { tab: 'supplies', icon: 'fa-boxes-stacked', label: 'Insumos y Recetas' },
        { tab: 'toppings', icon: 'fa-cookie-bite', label: 'Toppings / Adiciones' },
    ]},
    { name: 'Caja & Finanzas', tabs: [
        { tab: 'flujocaja', icon: 'fa-chart-line', label: 'Flujo Monetario' },
        { tab: 'cierrecaja', icon: 'fa-file-invoice-dollar', label: 'Arqueos y Cierres' },
    ]},
    { name: 'Sistema', tabs: [
        { tab: 'users', icon: 'fa-users', label: 'Usuarios' },
        { tab: 'config', icon: 'fa-cog', label: 'Configuración' },
    ]},
];

const forbiddenForCajero = ['products', 'categories', 'users', 'config', 'supplies', 'recipes', 'toppings', 'delivery-zones'];

const userName = computed(() => state.user?.name || '');
const businessName = computed(() => state.restaurantData.name || state.config.nombreRestaurante || 'Cargando...');
const businessSlogan = computed(() => state.restaurantData.slogan || state.config.sloganRestaurante || '...');
const logoUrl = computed(() => state.config.logo || '/img/icon.png');

const visibleSections = computed(() => {
    return sections.map(s => ({
        ...s,
        tabs: s.tabs.filter(t => !(state.user?.role === 'cajero' && forbiddenForCajero.includes(t.tab)))
    })).filter(s => s.tabs.length > 0);
});

function isForbidden(tab) {
    return state.user?.role === 'cajero' && forbiddenForCajero.includes(tab);
}

function toggleSection(name) {
    const next = new Set(collapsedSections.value);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    collapsedSections.value = next;
}

function switchTab(tab, event) {
    if (event) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        if (event.currentTarget && typeof event.currentTarget.blur === 'function') {
            event.currentTarget.blur();
        }
    }
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    activeTab.value = tab;
    localStorage.setItem('adminActiveTab', tab);

    // Instant scroll reset without animation or frame delay
    const mainContainer = document.getElementById('main-container');
    const resetAllScrolls = () => {
        if (mainContainer) mainContainer.scrollTop = 0;
        window.scrollTo(0, 0);
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    };

    resetAllScrolls();

    // Switch panels directly (reveal target, hide others simultaneously)
    const targetPanel = document.getElementById('panel-' + tab);
    document.querySelectorAll('.admin-panel').forEach(p => {
        if (p === targetPanel) {
            p.classList.remove('hidden');
        } else {
            p.classList.add('hidden');
        }
    });

    resetAllScrolls();

    // Close sidebar on mobile after selection
    const sidebar = document.getElementById('admin-sidebar');
    if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('-translate-x-full') && window.toggleAdminSidebar) {
        window.toggleAdminSidebar();
    }

    if (tab === 'flujocaja') {
        if (window.renderAdminCashflowPage) window.renderAdminCashflowPage();
    } else if (tab === 'reservations') {
        if (window._reloadReservations) window._reloadReservations();
    } else if (tab === 'config') {
        if (window.loadAdminConfig) window.loadAdminConfig();
    }

    resetAllScrolls();

    nextTick(() => {
        resetAllScrolls();
        requestAnimationFrame(() => {
            resetAllScrolls();
            setTimeout(resetAllScrolls, 50);
        });
    });
}

function logout() {
    if (window.handleLogoutUser) window.handleLogoutUser();
}

function closeSidebar() {
    if (typeof window !== 'undefined' && window.toggleAdminSidebar) {
        window.toggleAdminSidebar();
    }
}

// ── Admin Change Password Logic ──
const isAdmin = computed(() => {
    const u = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
    return u?.role === 'admin';
});

const isPasswordModalOpen = ref(false);
const currentPwd = ref('');
const newPwd = ref('');
const confirmPwd = ref('');
const showCurrentPwd = ref(false);
const showNewPwd = ref(false);
const showConfirmPwd = ref(false);
const passwordError = ref('');
const isSubmitting = ref(false);

function openPasswordModal() {
    if (!isAdmin.value) return;
    currentPwd.value = '';
    newPwd.value = '';
    confirmPwd.value = '';
    showCurrentPwd.value = false;
    showNewPwd.value = false;
    showConfirmPwd.value = false;
    passwordError.value = '';
    isPasswordModalOpen.value = true;
    nextTick(() => {
        const input = document.getElementById('admin-modal-current-pwd');
        input?.focus();
    });
}

function closePasswordModal() {
    isPasswordModalOpen.value = false;
    currentPwd.value = '';
    newPwd.value = '';
    confirmPwd.value = '';
    passwordError.value = '';
}

async function submitPasswordChange() {
    passwordError.value = '';

    const current = (currentPwd.value || '').trim();
    const next = (newPwd.value || '').trim();
    const confirm = (confirmPwd.value || '').trim();

    if (!current || !next || !confirm) {
        passwordError.value = 'Por favor completa todos los campos requeridos.';
        return;
    }
    if (next.length < 4) {
        passwordError.value = 'La nueva contraseña debe tener al menos 4 caracteres.';
        return;
    }
    if (next !== confirm) {
        passwordError.value = 'Las nuevas contraseñas no coinciden.';
        return;
    }
    if (current === next) {
        passwordError.value = 'La nueva contraseña debe ser diferente a la contraseña actual.';
        return;
    }

    isSubmitting.value = true;
    try {
        const res = await changePassword(current, next);
        toast(res?.message || 'Contraseña actualizada exitosamente.', 'success');
        closePasswordModal();
    } catch (err) {
        console.error('Error changing password:', err);
        let msg = 'Error al actualizar la contraseña.';
        try {
            const parsed = JSON.parse(err.message);
            if (parsed.error) msg = parsed.error;
        } catch {
            if (err.message) msg = err.message;
        }
        passwordError.value = msg;
        toast(msg, 'error');
    } finally {
        isSubmitting.value = false;
    }
}

function handleKeydown(e) {
    if (e.key === 'Escape' && isPasswordModalOpen.value) {
        closePasswordModal();
    }
}

onMounted(() => {
    let saved = localStorage.getItem('adminActiveTab') || 'dashboard';
    if (isForbidden(saved)) saved = 'dashboard';
    switchTab(saved);

    window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
    <!-- Sidebar Header -->
    <div class="mb-1 px-1 relative flex flex-col items-center text-center mt-1 md:mt-0 shrink-0">
        <button type="button" aria-label="Cerrar menú lateral"
            class="sidebar-close-btn md:hidden absolute right-0 top-0 transition-opacity p-2 text-xl cursor-pointer"
            @click="closeSidebar">
            <i class="fas fa-times"></i>
        </button>
        <img :src="logoUrl" alt="Logo del negocio"
            class="w-24 h-24 rounded-full object-cover bg-white/10 border-2 border-[var(--system-primary)]/40 shadow-md mb-2">
        <h2 class="text-sm font-black text-[var(--system-primary)] tracking-tight leading-tight max-w-full truncate px-4">{{ businessName }}</h2>
        <p class="sidebar-slogan text-[10px] font-semibold max-w-full truncate px-4 transition-colors">{{ businessSlogan }}</p>
    </div>

    <!-- User Greeting -->
    <div v-show="userName" class="px-1 mb-1 shrink-0">
        <div class="sidebar-user-card border rounded-xl px-3 py-1.5 text-center">
            <p class="text-xs text-[var(--system-primary)]"><i class="fas fa-user text-[var(--system-primary)] mr-1.5"></i>Hola, <span class="font-bold text-[var(--system-primary)] text-xs">{{ userName }}</span></p>
        </div>
    </div>
    <hr class="sidebar-divider w-full my-1 shrink-0">

    <!-- Middle Navigation -->
    <div class="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-1 w-full min-h-0">
        <div v-for="section in visibleSections" :key="section.name" class="admin-nav-section relative flex flex-col"
            :class="{ collapsed: collapsedSections.has(section.name) }">
            <button type="button" @click="toggleSection(section.name)"
                class="admin-section-toggle flex items-center justify-between px-2 py-1.5 transition-colors w-full text-left cursor-pointer group select-none">
                <div class="flex items-center gap-2">
                    <span class="section-dot w-1.5 h-1.5 rounded-full transition-colors"></span>
                    <span class="text-[10px] font-black uppercase tracking-wider transition-colors">{{ section.name }}</span>
                </div>
                <i class="fas fa-chevron-down text-[9px] section-chevron group-hover:opacity-100 transition-transform duration-200"></i>
            </button>
            <div class="admin-section-content flex flex-col gap-1 ml-2.5 pl-2.5 border-l-2 my-0.5">
                <button v-for="t in section.tabs" :key="t.tab" type="button" :data-tab="t.tab"
                    @mousedown.prevent
                    @click="switchTab(t.tab, $event)"
                    class="admin-tab-btn flex-1 md:flex-none text-left px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-2 whitespace-nowrap"
                    :class="activeTab === t.tab ? 'active shadow-md' : 'font-medium group'">
                    <i class="fas w-4 text-center px-1 text-xs" :class="t.icon"></i>
                    <span class="text-xs">{{ t.label }}</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Bottom Actions: Logout & Change Password (admin only) -->
    <div class="mt-auto pt-2 border-t sidebar-divider w-full shrink-0">
        <div class="flex items-center gap-1.5 w-full">
            <button type="button" id="btn-sidebar-logout" @click="logout"
                class="btn-sidebar-logout flex-1 text-left px-2.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-2 active:scale-95 shadow-sm group cursor-pointer"
                title="Cerrar Sesión">
                <i class="fas fa-sign-out-alt w-4 text-center px-1 text-xs"></i> <span class="text-xs">Cerrar Sesión</span>
            </button>
            <button v-if="isAdmin" type="button" id="btn-sidebar-change-pwd" @click="openPasswordModal"
                class="btn-sidebar-change-pwd px-2.5 py-1.5 rounded-xl font-semibold transition-all flex items-center justify-center active:scale-95 shadow-sm cursor-pointer shrink-0"
                title="Cambiar contraseña de Administrador" aria-label="Cambiar contraseña de Administrador">
                <i class="fas fa-key text-xs"></i>
            </button>
        </div>
    </div>

    <!-- Modal Cambiar Contraseña (Solo Administrador) -->
    <Teleport to="body">
        <div v-if="isPasswordModalOpen"
            class="pwd-modal-overlay"
            @click.self="closePasswordModal">
            <div class="pwd-modal-card"
                role="dialog" aria-modal="true" aria-labelledby="change-pwd-title">
                
                <!-- Encabezado del Modal -->
                <div class="pwd-modal-header">
                    <div class="pwd-modal-header-left">
                        <div class="pwd-header-icon">
                            <i class="fas fa-key"></i>
                        </div>
                        <div>
                            <h3 id="change-pwd-title" class="pwd-modal-title">Cambiar Contraseña</h3>
                            <p class="pwd-modal-subtitle">Actualiza tu clave de acceso de Administrador</p>
                        </div>
                    </div>
                    <button type="button" @click="closePasswordModal"
                        class="pwd-modal-close"
                        title="Cerrar modal" aria-label="Cerrar">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <!-- Mensaje de Error si aplica -->
                <div v-if="passwordError" class="pwd-error-alert">
                    <i class="fas fa-exclamation-circle pwd-error-icon"></i>
                    <span class="pwd-error-text">{{ passwordError }}</span>
                </div>

                <!-- Formulario -->
                <form @submit.prevent="submitPasswordChange" class="pwd-form">
                    <!-- Contraseña Actual -->
                    <div class="pwd-field-group">
                        <label for="admin-modal-current-pwd" class="pwd-label">
                            Contraseña Actual
                        </label>
                        <div class="pwd-input-wrap">
                            <input id="admin-modal-current-pwd" :type="showCurrentPwd ? 'text' : 'password'" v-model="currentPwd" required
                                placeholder="Ingresa tu contraseña actual" autocomplete="current-password"
                                class="pwd-input">
                            <button type="button" @click="showCurrentPwd = !showCurrentPwd"
                                class="pwd-eye-btn"
                                :class="{ 'active': showCurrentPwd }"
                                :title="showCurrentPwd ? 'Ocultar contraseña' : 'Ver contraseña'"
                                :aria-label="showCurrentPwd ? 'Ocultar contraseña actual' : 'Ver contraseña actual'" tabindex="-1">
                                <i :class="showCurrentPwd ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Nueva Contraseña -->
                    <div class="pwd-field-group">
                        <label for="admin-modal-new-pwd" class="pwd-label">
                            Nueva Contraseña
                        </label>
                        <div class="pwd-input-wrap">
                            <input id="admin-modal-new-pwd" :type="showNewPwd ? 'text' : 'password'" v-model="newPwd" required minlength="4"
                                placeholder="Mínimo 4 caracteres" autocomplete="new-password"
                                class="pwd-input">
                            <button type="button" @click="showNewPwd = !showNewPwd"
                                class="pwd-eye-btn"
                                :class="{ 'active': showNewPwd }"
                                :title="showNewPwd ? 'Ocultar contraseña' : 'Ver contraseña'"
                                :aria-label="showNewPwd ? 'Ocultar nueva contraseña' : 'Ver nueva contraseña'" tabindex="-1">
                                <i :class="showNewPwd ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Confirmar Nueva Contraseña -->
                    <div class="pwd-field-group">
                        <label for="admin-modal-confirm-pwd" class="pwd-label">
                            Confirmar Nueva Contraseña
                        </label>
                        <div class="pwd-input-wrap">
                            <input id="admin-modal-confirm-pwd" :type="showConfirmPwd ? 'text' : 'password'" v-model="confirmPwd" required minlength="4"
                                placeholder="Repite la nueva contraseña" autocomplete="new-password"
                                class="pwd-input">
                            <button type="button" @click="showConfirmPwd = !showConfirmPwd"
                                class="pwd-eye-btn"
                                :class="{ 'active': showConfirmPwd }"
                                :title="showConfirmPwd ? 'Ocultar contraseña' : 'Ver contraseña'"
                                :aria-label="showConfirmPwd ? 'Ocultar confirmación' : 'Ver confirmación'" tabindex="-1">
                                <i :class="showConfirmPwd ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Botones de Acción -->
                    <div class="pwd-actions">
                        <button type="button" @click="closePasswordModal" class="pwd-btn-cancel">
                            Cancelar
                        </button>
                        <button type="submit" :disabled="isSubmitting" class="pwd-btn-submit btn-system-primary">
                            <i v-if="isSubmitting" class="fas fa-spinner fa-spin"></i>
                            <i v-else class="fas fa-save"></i>
                            <span>{{ isSubmitting ? 'Guardando...' : 'Guardar' }}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.pwd-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 99999;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1rem;
    box-sizing: border-box;
    user-select: none;
    animation: pwdFadeIn 0.2s ease-out;
}

.pwd-modal-card {
    background-color: #ffffff;
    border-radius: 1.5rem;
    width: 100%;
    max-width: 26rem;
    padding: 1.5rem;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    border: 1px solid #e2e8f0;
    position: relative;
    box-sizing: border-box;
    user-select: text;
    animation: pwdScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.pwd-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 0.875rem;
    margin-bottom: 1.25rem;
}

.pwd-modal-header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.pwd-header-icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 1rem;
    background-color: #fef3c7;
    color: #d97706;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    flex-shrink: 0;
}

.pwd-modal-title {
    margin: 0;
    font-weight: 800;
    font-size: 1.05rem;
    color: #0f172a;
    line-height: 1.25;
}

.pwd-modal-subtitle {
    margin: 0.15rem 0 0 0;
    font-size: 0.75rem;
    color: #64748b;
}

.pwd-modal-close {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    background-color: #f1f5f9;
    color: #64748b;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    transition: all 0.15s ease;
}

.pwd-modal-close:hover {
    background-color: #e2e8f0;
    color: #0f172a;
}

.pwd-error-alert {
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.pwd-error-icon {
    font-size: 0.875rem;
    flex-shrink: 0;
}

.pwd-error-text {
    flex: 1;
    font-weight: 600;
    line-height: 1.3;
}

.pwd-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.pwd-field-group {
    display: flex;
    flex-direction: column;
}

.pwd-label {
    display: block;
    font-size: 0.6875rem;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.375rem;
}

.pwd-input-wrap {
    position: relative;
    width: 100%;
    display: block;
    box-sizing: border-box;
}

.pwd-input {
    width: 100%;
    height: 2.75rem;
    padding: 0 2.75rem 0 0.875rem;
    border-radius: 0.75rem;
    border: 1.5px solid #cbd5e1;
    background-color: #f8fafc;
    color: #1e293b;
    font-size: 0.875rem;
    transition: all 0.15s ease;
    box-sizing: border-box;
    outline: none;
}

.pwd-input:focus {
    background-color: #ffffff;
    border-color: var(--system-primary, #f59e0b);
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
}

.pwd-input::placeholder {
    color: #94a3b8;
    font-size: 0.8125rem;
}

.pwd-input:-webkit-autofill,
.pwd-input:-webkit-autofill:hover, 
.pwd-input:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0px 1000px #f8fafc inset !important;
    -webkit-text-fill-color: #1e293b !important;
    transition: background-color 5000s ease-in-out 0s;
}

.pwd-eye-btn {
    position: absolute;
    top: 50%;
    right: 0.5rem;
    transform: translateY(-50%);
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #94a3b8;
    border-radius: 0.5rem;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease, background-color 0.15s ease;
    z-index: 5;
}

.pwd-eye-btn:hover {
    color: #334155;
    background-color: rgba(0, 0, 0, 0.05);
}

.pwd-eye-btn.active {
    color: var(--system-primary, #d97706);
}

.pwd-actions {
    display: flex;
    gap: 0.75rem;
    padding-top: 0.5rem;
}

.pwd-btn-cancel {
    flex: 1;
    height: 2.75rem;
    border-radius: 0.75rem;
    background-color: #f1f5f9;
    color: #475569;
    font-weight: 700;
    font-size: 0.8125rem;
    border: 1px solid #e2e8f0;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
}

.pwd-btn-cancel:hover {
    background-color: #e2e8f0;
    color: #0f172a;
}

.pwd-btn-submit {
    flex: 1;
    height: 2.75rem;
    border-radius: 0.75rem;
    background-color: var(--system-primary, #f5b55f) !important;
    color: var(--system-secondary, #1e2122) !important;
    font-weight: 800 !important;
    font-size: 0.8125rem !important;
    border: 1px solid rgba(0, 0, 0, 0.1) !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15) !important;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
}

.pwd-btn-submit:hover:not(:disabled) {
    filter: brightness(1.08) !important;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22) !important;
}

.pwd-btn-submit:active:not(:disabled) {
    transform: translateY(0);
}

.pwd-btn-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.pwd-btn-submit i,
.pwd-btn-submit span {
    color: var(--system-secondary, #1e2122) !important;
}

@keyframes pwdFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes pwdScaleIn {
    from {
        opacity: 0;
        transform: scale(0.95) translateY(8px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}
</style>
