<script setup>
import { computed } from 'vue';
import { state } from '@/legacy/core/state.js';
import { useUiStore } from '@/stores/ui.js';

const ui = useUiStore();

const staffRoles = ['mesero', 'waiter', 'chef', 'cocinero', 'delivery', 'repartidor'];
const staffViews = ['waiter', 'chef', 'delivery'];

const currentRole = computed(() => {
    if (state.user?.role) return state.user.role.toLowerCase();
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) return (JSON.parse(raw)?.role || '').toLowerCase();
        } catch (_) {}
    }
    return '';
});

const isVisible = computed(() => {
    return staffRoles.includes(currentRole.value) && staffViews.includes(ui.activeView);
});

const restaurantName = computed(() => {
    return state.restaurantData?.name || state.config?.nombreRestaurante || 'DigiRest';
});

const restaurantLogo = computed(() => {
    return state.config?.logo || state.restaurantData?.logo || '';
});

const roleBadge = computed(() => {
    const role = currentRole.value;
    let name = state.user?.name;
    if (!name && typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem('pos_user');
            if (raw) name = JSON.parse(raw)?.name;
        } catch (_) {}
    }
    name = name || 'Staff';

    if (role === 'chef' || role === 'cocinero') {
        return {
            label: `Chef: ${name}`,
            icon: 'fas fa-fire',
            cls: 'bg-orange-50 text-orange-700 border-orange-200'
        };
    }
    if (role === 'delivery' || role === 'repartidor') {
        return {
            label: `Repartidor: ${name}`,
            icon: 'fas fa-motorcycle',
            cls: 'bg-blue-50 text-blue-700 border-blue-200'
        };
    }
    return {
        label: `Mesero: ${name}`,
        icon: 'fas fa-user-tie',
        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };
});

function handleLogout() {
    if (window.handleLogoutUser) {
        window.handleLogoutUser();
    }
}
</script>

<template>
    <header v-if="isVisible"
        class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-200/80 px-4 sm:px-6 flex items-center justify-between shadow-2xs transition-all w-full"
        style="height: calc(4rem + env(safe-area-inset-top, 0px)); padding-top: env(safe-area-inset-top, 0px);">
        
        <!-- Left: Brand / Restaurant Info -->
        <div class="flex items-center gap-3 min-w-0">
            <div class="w-9 h-9 rounded-xl bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center font-black shadow-xs shrink-0 overflow-hidden">
                <img v-if="restaurantLogo" :src="restaurantLogo" alt="Logo" class="w-full h-full object-cover" />
                <i v-else class="fas fa-utensils text-sm"></i>
            </div>
            <div class="min-w-0 flex flex-col">
                <h1 class="text-sm sm:text-base font-extrabold text-gray-900 leading-tight truncate tracking-tight">
                    {{ restaurantName }}
                </h1>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-bold border" :class="roleBadge.cls">
                        <i :class="roleBadge.icon" class="text-[9px]"></i>
                        <span>{{ roleBadge.label }}</span>
                    </span>
                </div>
            </div>
        </div>

        <!-- Right: Actions -->
        <div class="flex items-center gap-2 shrink-0">
            <button type="button" @click="handleLogout"
                class="flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 border border-red-200/80 transition-all active:scale-95 shadow-2xs cursor-pointer"
                title="Cerrar Sesión">
                <i class="fas fa-sign-out-alt text-xs"></i>
                <span class="hidden sm:inline">Cerrar Sesión</span>
                <span class="sm:hidden">Salir</span>
            </button>
        </div>
    </header>
</template>
