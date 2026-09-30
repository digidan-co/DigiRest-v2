<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';

const activeTab = ref('dashboard');
const collapsedSections = ref(new Set());

const sections = [
    { name: 'Operación', tabs: [
        { tab: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
        { tab: 'orders', icon: 'fa-receipt', label: 'Pedidos' },
        { tab: 'reservations', icon: 'fa-calendar-check', label: 'Reservas' },
        { tab: 'delivery-zones', icon: 'fa-motorcycle', label: 'Zonas de Domicilio' },
        { tab: 'crm', icon: 'fa-users', label: 'Clientes / CRM' },
    ]},
    { name: 'Menú & Carta', tabs: [
        { tab: 'products', icon: 'fa-utensils', label: 'Platos y Categorías' },
        { tab: 'supplies', icon: 'fa-boxes-stacked', label: 'Insumos y recetas' },
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
    if (event?.currentTarget && typeof event.currentTarget.blur === 'function') {
        event.currentTarget.blur();
    }
    activeTab.value = tab;
    localStorage.setItem('adminActiveTab', tab);

    // Instant scroll reset without animation or frame delay
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
        mainContainer.scrollTop = 0;
    }

    // Switch panels directly (reveal target, hide others simultaneously)
    const targetPanel = document.getElementById('panel-' + tab);
    document.querySelectorAll('.admin-panel').forEach(p => {
        if (p === targetPanel) {
            p.classList.remove('hidden');
        } else {
            p.classList.add('hidden');
        }
    });

    if (mainContainer) {
        mainContainer.scrollTop = 0;
    }

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
}

function logout() {
    if (window.handleLogoutUser) window.handleLogoutUser();
}

function closeSidebar() {
    if (typeof window !== 'undefined' && window.toggleAdminSidebar) {
        window.toggleAdminSidebar();
    }
}

onMounted(() => {
    let saved = localStorage.getItem('adminActiveTab') || 'dashboard';
    if (isForbidden(saved)) saved = 'dashboard';
    switchTab(saved);
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
                <button v-for="t in section.tabs" :key="t.tab" type="button" :data-tab="t.tab" @click="switchTab(t.tab, $event)"
                    class="admin-tab-btn flex-1 md:flex-none text-left px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-2 whitespace-nowrap"
                    :class="activeTab === t.tab ? 'active shadow-md' : 'font-medium group'">
                    <i class="fas w-4 text-center px-1 text-xs" :class="t.icon"></i>
                    <span class="text-xs">{{ t.label }}</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Logout -->
    <div class="mt-auto pt-2 border-t sidebar-divider w-full shrink-0">
        <button type="button" id="btn-sidebar-logout" @click="logout"
            class="btn-sidebar-logout w-full text-left px-2.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-2 active:scale-95 shadow-sm group cursor-pointer">
            <i class="fas fa-sign-out-alt w-4 text-center px-1 text-xs"></i> <span class="text-xs">Cerrar Sesión</span>
        </button>
    </div>
</template>
