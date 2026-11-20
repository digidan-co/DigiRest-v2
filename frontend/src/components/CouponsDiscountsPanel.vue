<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { ApiClient } from '@/legacy/services/api-client.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';
import {
    getCoupons,
    saveCoupon,
    toggleCoupon,
    deleteCoupon,
    getDiscountCampaigns,
    saveDiscountCampaign,
    toggleDiscountCampaign,
    deleteDiscountCampaign
} from '@/legacy/services/coupons-service.js';

const activeSubtab = ref('coupons'); // 'coupons' | 'campaigns'

// ==========================================
// CUPONES DE DESCUENTO
// ==========================================
const coupons = ref([]);
const loadingCoupons = ref(false);
const searchCoupon = ref('');
const filterCouponStatus = ref('');
const filterCouponType = ref('');
const showCouponModal = ref(false);
const isEditingCoupon = ref(false);
const editingCouponId = ref(null);
const savingCoupon = ref(false);

const couponForm = ref({
    code: '',
    description: '',
    discount_type: 'PERCENT',
    discount_value: 10,
    min_order_total: 0,
    max_uses: 0,
    valid_until: '',
    channels: ['Local', 'Domicilio', 'Para Llevar'],
    active: 1
});

function hasAuthToken() {
    return Boolean(ApiClient.getToken() || localStorage.getItem('pos_token'));
}

function canAccessCoupons() {
    let user = state.user;
    if (!user) {
        try {
            user = JSON.parse(localStorage.getItem('pos_user') || 'null');
        } catch (_) {
            user = null;
        }
    }
    const role = (user?.role || '').toLowerCase();
    return Boolean(user && (role === 'admin' || role === 'cajero' || role === 'supervisor'));
}

async function loadCoupons() {
    if (!hasAuthToken() || !canAccessCoupons()) return;
    loadingCoupons.value = true;
    try {
        coupons.value = await getCoupons();
    } catch (e) {
        console.error('Error cargando cupones:', e);
    } finally {
        loadingCoupons.value = false;
    }
}

const filteredCoupons = computed(() => {
    let list = coupons.value || [];
    if (filterCouponType.value) {
        list = list.filter(c => c.discount_type === filterCouponType.value);
    }
    if (filterCouponStatus.value !== '') {
        const isAct = filterCouponStatus.value === '1';
        list = list.filter(c => !!c.active === isAct);
    }
    const q = searchCoupon.value.toLowerCase().trim();
    if (q) {
        list = list.filter(c =>
            (c.code || '').toLowerCase().includes(q) ||
            (c.description || '').toLowerCase().includes(q)
        );
    }
    return list;
});

function openCreateCouponModal() {
    isEditingCoupon.value = false;
    editingCouponId.value = null;
    couponForm.value = {
        code: '',
        description: '',
        discount_type: 'PERCENT',
        discount_value: 10,
        min_order_total: 0,
        max_uses: 0,
        valid_until: '',
        channels: ['Local', 'Domicilio', 'Para Llevar'],
        active: 1
    };
    showCouponModal.value = true;
}

function openEditCouponModal(c) {
    isEditingCoupon.value = true;
    editingCouponId.value = c.id;
    let chs = ['Local', 'Domicilio', 'Para Llevar'];
    if (Array.isArray(c.channels)) chs = c.channels;
    else if (typeof c.channels === 'string') {
        try { chs = JSON.parse(c.channels); } catch (_) {}
    }

    couponForm.value = {
        code: c.code || '',
        description: c.description || '',
        discount_type: c.discount_type || 'PERCENT',
        discount_value: c.discount_value || 0,
        min_order_total: c.min_order_total || 0,
        max_uses: c.max_uses || 0,
        valid_until: c.valid_until ? c.valid_until.slice(0, 10) : '',
        channels: chs,
        active: c.active ? 1 : 0
    };
    showCouponModal.value = true;
}

async function handleSaveCoupon() {
    const cleanCode = (couponForm.value.code || '').trim().toUpperCase();
    if (!cleanCode) {
        toast('El código de cupón es obligatorio', 'error');
        return;
    }
    if (parseFloat(couponForm.value.discount_value) <= 0) {
        toast('El valor de descuento debe ser mayor a 0', 'error');
        return;
    }
    savingCoupon.value = true;
    try {
        await saveCoupon({
            ...couponForm.value,
            code: cleanCode
        }, editingCouponId.value);
        toast(isEditingCoupon.value ? 'Cupón actualizado con éxito' : 'Cupón creado con éxito', 'success');
        showCouponModal.value = false;
        await loadCoupons();
    } catch (e) {
        console.error(e);
        toast(e.message || 'Error guardando cupón', 'error');
    } finally {
        savingCoupon.value = false;
    }
}

async function handleToggleCoupon(c) {
    try {
        await toggleCoupon(c.id);
        c.active = c.active ? 0 : 1;
        toast(c.active ? `Cupón ${c.code} habilitado` : `Cupón ${c.code} pausado`, 'info');
    } catch (e) {
        toast('Error cambiando estado del cupón', 'error');
    }
}

async function handleDeleteCoupon(c) {
    const ok = await showConfirmModal({
        title: '¿Eliminar Cupón?',
        message: `¿Estás seguro de eliminar permanentemente el cupón "${c.code}"?`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await deleteCoupon(c.id);
        toast(`Cupón ${c.code} eliminado`, 'success');
        await loadCoupons();
    } catch (e) {
        toast('Error eliminando cupón', 'error');
    }
}

// ==========================================
// CAMPAÑAS DE DESCUENTO
// ==========================================
const campaigns = ref([]);
const loadingCampaigns = ref(false);
const searchCampaign = ref('');
const filterCampaignStatus = ref('');
const showCampaignModal = ref(false);
const isEditingCampaign = ref(false);
const editingCampaignId = ref(null);
const savingCampaign = ref(false);

const campaignForm = ref({
    name: '',
    description: '',
    discount_percent: 15,
    scope: 'ALL',
    category_id: '',
    category_name: '',
    product_ids: [],
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    days_of_week: ['1', '2', '3', '4', '5', '6', '7'],
    channels: ['Local', 'Domicilio', 'Para Llevar'],
    active: 1
});

async function loadCampaigns() {
    if (!hasAuthToken() || !canAccessCoupons()) return;
    loadingCampaigns.value = true;
    try {
        campaigns.value = await getDiscountCampaigns();
    } catch (e) {
        console.error('Error cargando campañas:', e);
    } finally {
        loadingCampaigns.value = false;
    }
}

const filteredCampaigns = computed(() => {
    let list = campaigns.value || [];
    if (filterCampaignStatus.value !== '') {
        const isAct = filterCampaignStatus.value === '1';
        list = list.filter(c => !!c.active === isAct);
    }
    const q = searchCampaign.value.toLowerCase().trim();
    if (q) {
        list = list.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.description || '').toLowerCase().includes(q)
        );
    }
    return list;
});

function openCreateCampaignModal() {
    isEditingCampaign.value = false;
    editingCampaignId.value = null;
    campaignForm.value = {
        name: '',
        description: '',
        discount_percent: 15,
        scope: 'ALL',
        category_id: '',
        category_name: '',
        product_ids: [],
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
        days_of_week: ['1', '2', '3', '4', '5', '6', '7'],
        channels: ['Local', 'Domicilio', 'Para Llevar'],
        active: 1
    };
    showCampaignModal.value = true;
}

function openEditCampaignModal(c) {
    isEditingCampaign.value = true;
    editingCampaignId.value = c.id;
    let chs = ['Local', 'Domicilio', 'Para Llevar'];
    if (Array.isArray(c.channels)) chs = c.channels;
    else if (typeof c.channels === 'string') {
        try { chs = JSON.parse(c.channels); } catch (_) {}
    }
    let pIds = [];
    if (Array.isArray(c.product_ids)) pIds = c.product_ids;
    else if (typeof c.product_ids === 'string') {
        try { pIds = JSON.parse(c.product_ids); } catch (_) {}
    }
    let days = ['1', '2', '3', '4', '5', '6', '7'];
    if (Array.isArray(c.days_of_week)) days = c.days_of_week;
    else if (typeof c.days_of_week === 'string') {
        try { days = JSON.parse(c.days_of_week); } catch (_) {}
    }

    campaignForm.value = {
        name: c.name || '',
        description: c.description || '',
        discount_percent: c.discount_percent || 0,
        scope: c.scope || 'ALL',
        category_id: c.category_id || '',
        category_name: c.category_name || '',
        product_ids: pIds,
        start_date: c.start_date || '',
        end_date: c.end_date || '',
        start_time: c.start_time || '',
        end_time: c.end_time || '',
        days_of_week: days,
        channels: chs,
        active: c.active ? 1 : 0
    };
    showCampaignModal.value = true;
}

async function handleSaveCampaign() {
    if (!campaignForm.value.name.trim()) {
        toast('El nombre de la campaña es obligatorio', 'error');
        return;
    }
    const pct = parseFloat(campaignForm.value.discount_percent);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
        toast('El porcentaje de descuento debe estar entre 1% y 100%', 'error');
        return;
    }

    if (campaignForm.value.scope === 'CATEGORY' && campaignForm.value.category_id) {
        const cat = (state.categories || []).find(x => String(x.id) === String(campaignForm.value.category_id));
        if (cat) campaignForm.value.category_name = cat.name;
    }

    savingCampaign.value = true;
    try {
        await saveDiscountCampaign(campaignForm.value, editingCampaignId.value);
        toast(isEditingCampaign.value ? 'Campaña actualizada con éxito' : 'Campaña creada con éxito', 'success');
        showCampaignModal.value = false;
        await loadCampaigns();
    } catch (e) {
        console.error(e);
        toast(e.message || 'Error guardando campaña', 'error');
    } finally {
        savingCampaign.value = false;
    }
}

async function handleToggleCampaign(c) {
    try {
        await toggleDiscountCampaign(c.id);
        c.active = c.active ? 0 : 1;
        toast(c.active ? `Campaña ${c.name} activada` : `Campaña ${c.name} pausada`, 'info');
    } catch (e) {
        toast('Error cambiando estado de la campaña', 'error');
    }
}

async function handleDeleteCampaign(c) {
    const ok = await showConfirmModal({
        title: '¿Eliminar Campaña?',
        message: `¿Estás seguro de eliminar permanentemente la campaña "${c.name}"?`,
        confirmText: 'Sí, eliminar',
        cancelText: 'Cancelar',
        type: 'danger'
    });
    if (!ok) return;
    try {
        await deleteDiscountCampaign(c.id);
        toast(`Campaña ${c.name} eliminada`, 'success');
        await loadCampaigns();
    } catch (e) {
        toast('Error eliminando campaña', 'error');
    }
}

function handleEscapeKey(e) {
    if (e.key === 'Escape') {
        if (showCouponModal.value) showCouponModal.value = false;
        if (showCampaignModal.value) showCampaignModal.value = false;
    }
}

onMounted(() => {
    if (hasAuthToken() && canAccessCoupons()) {
        loadCoupons();
        loadCampaigns();
    }
    window._reloadCouponsDiscounts = () => {
        loadCoupons();
        loadCampaigns();
    };

    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (socket) {
        socket.on('coupon_changed', loadCoupons);
        socket.on('campaign_changed', loadCampaigns);
    }
    window.addEventListener('keydown', handleEscapeKey);
});

onUnmounted(() => {
    if (window._reloadCouponsDiscounts) delete window._reloadCouponsDiscounts;
    const socket = window.socket || (typeof io !== 'undefined' ? io() : null);
    if (socket) {
        socket.off('coupon_changed', loadCoupons);
        socket.off('campaign_changed', loadCampaigns);
    }
    window.removeEventListener('keydown', handleEscapeKey);
});

watch(() => state.user, (u) => {
    if (u && hasAuthToken() && canAccessCoupons()) {
        loadCoupons();
        loadCampaigns();
    }
});
</script>

<template>
    <div class="space-y-4">
        <!-- Header Subtabs: Cupones | Campañas -->
        <div class="flex items-center space-x-1 p-1 bg-gray-100 rounded-xl w-fit">
            <button type="button" @click="activeSubtab = 'coupons'"
                class="px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                :class="activeSubtab === 'coupons' ? 'btn-system-primary shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-white'">
                <i class="fas fa-ticket"></i> Cupones de Descuento
                <span v-if="coupons.length > 0" class="ml-1 text-[10px] px-1.5 py-0.2 rounded-full"
                    :class="activeSubtab === 'coupons' ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-700'">
                    {{ coupons.length }}
                </span>
            </button>
            <button type="button" @click="activeSubtab = 'campaigns'"
                class="px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                :class="activeSubtab === 'campaigns' ? 'btn-system-primary shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-white'">
                <i class="fas fa-bullhorn"></i> Campañas de Descuento
                <span v-if="campaigns.length > 0" class="ml-1 text-[10px] px-1.5 py-0.2 rounded-full"
                    :class="activeSubtab === 'campaigns' ? 'bg-white/30 text-white' : 'bg-gray-200 text-gray-700'">
                    {{ campaigns.length }}
                </span>
            </button>
        </div>

        <!-- SUBTAB 1: CUPONES DE DESCUENTO -->
        <div v-show="activeSubtab === 'coupons'" class="space-y-4">
            <!-- Toolbar Cupones -->
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
                <div class="flex flex-1 flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <div class="relative w-full sm:w-64 sm:flex-initial">
                        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input
                            type="text"
                            v-model="searchCoupon"
                            placeholder="Buscar cupón por código o descripción..."
                            class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs"
                        >
                    </div>
                    <select
                        v-model="filterCouponType"
                        class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[130px]"
                    >
                        <option value="">Todos los tipos</option>
                        <option value="PERCENT">Porcentaje (%)</option>
                        <option value="FIXED">Monto Fijo ($)</option>
                    </select>
                    <select
                        v-model="filterCouponStatus"
                        class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[120px]"
                    >
                        <option value="">Todos los estados</option>
                        <option value="1">Habilitados</option>
                        <option value="0">Pausados</option>
                    </select>
                </div>
                <div class="w-full sm:w-auto flex justify-end">
                    <button
                        type="button"
                        @click="openCreateCouponModal"
                        class="w-full sm:w-auto btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"
                    >
                        <i class="fas fa-plus"></i>
                        <span>Nuevo Cupón</span>
                    </button>
                </div>
            </div>

            <!-- Lista de Cupones -->
            <div v-if="filteredCoupons.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div
                    v-for="c in filteredCoupons"
                    :key="c.id"
                    class="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group"
                    :class="!c.active ? 'opacity-60 bg-gray-50/50' : ''"
                >
                    <!-- Top row: Code badge + Status toggle -->
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex items-center gap-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-xs font-black tracking-wider uppercase bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1">
                                <i class="fas fa-ticket text-amber-600"></i>
                                {{ c.code }}
                            </span>
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold"
                                :class="c.discount_type === 'PERCENT' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'">
                                {{ c.discount_type === 'PERCENT' ? `${c.discount_value}% OFF` : `-$${formatMoney(c.discount_value)}` }}
                            </span>
                        </div>
                        <button
                            type="button"
                            @click="handleToggleCoupon(c)"
                            class="px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer"
                            :class="c.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'"
                        >
                            <i class="fas" :class="c.active ? 'fa-check text-emerald-600' : 'fa-pause text-gray-400'"></i>
                            {{ c.active ? 'Activo' : 'Pausado' }}
                        </button>
                    </div>

                    <!-- Description -->
                    <p class="text-xs text-gray-600 mb-3 min-h-[1.5rem] line-clamp-2">
                        {{ c.description || 'Sin descripción adicional' }}
                    </p>

                    <!-- Details Box -->
                    <div class="bg-gray-50 rounded-xl p-2.5 mb-3 space-y-1.5 text-[11px] text-gray-600 border border-gray-100">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400"><i class="fas fa-coins mr-1 text-[10px]"></i> Mínimo de compra:</span>
                            <span class="font-bold text-gray-800">{{ c.min_order_total > 0 ? formatMoney(c.min_order_total) : 'Sin mínimo' }}</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400"><i class="fas fa-users mr-1 text-[10px]"></i> Usos:</span>
                            <span class="font-bold text-gray-800">
                                {{ c.used_count || 0 }} {{ c.max_uses > 0 ? `/ ${c.max_uses}` : 'usos (Ilimitado)' }}
                            </span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400"><i class="fas fa-calendar-alt mr-1 text-[10px]"></i> Vencimiento:</span>
                            <span class="font-bold" :class="c.valid_until && new Date(c.valid_until) < new Date() ? 'text-red-500' : 'text-gray-800'">
                                {{ c.valid_until ? c.valid_until.slice(0, 10) : 'Sin vencimiento' }}
                            </span>
                        </div>
                    </div>

                    <!-- Channels & Actions -->
                    <div class="flex items-center justify-between pt-2 border-t border-gray-100">
                        <div class="flex flex-wrap gap-1">
                            <span v-for="ch in (Array.isArray(c.channels) ? c.channels : [])" :key="ch"
                                class="text-[9px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600 font-semibold">
                                {{ ch }}
                            </span>
                        </div>
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                @click="openEditCouponModal(c)"
                                class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                title="Editar cupón"
                            >
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button
                                type="button"
                                @click="handleDeleteCoupon(c)"
                                class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                title="Eliminar cupón"
                            >
                                <i class="fas fa-trash-alt text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Empty State Cupones -->
            <div v-else class="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm space-y-3">
                <div class="w-16 h-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto text-2xl">
                    <i class="fas fa-ticket"></i>
                </div>
                <h4 class="font-black text-gray-800 text-sm">No se encontraron cupones</h4>
                <p class="text-xs text-gray-500 max-w-sm mx-auto">
                    Crea cupones de descuento porcentuales o de valor fijo para premiar a tus clientes o usarlos en promociones de temporada.
                </p>
                <button
                    type="button"
                    @click="openCreateCouponModal"
                    class="btn-system-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                    <i class="fas fa-plus"></i> Crear Primer Cupón
                </button>
            </div>
        </div>

        <!-- SUBTAB 2: CAMPAÑAS DE DESCUENTO -->
        <div v-show="activeSubtab === 'campaigns'" class="space-y-4">
            <!-- Toolbar Campañas -->
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
                <div class="flex flex-1 flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <div class="relative w-full sm:w-64 sm:flex-initial">
                        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input
                            type="text"
                            v-model="searchCampaign"
                            placeholder="Buscar campaña..."
                            class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs"
                        >
                    </div>
                    <select
                        v-model="filterCampaignStatus"
                        class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[120px]"
                    >
                        <option value="">Todos los estados</option>
                        <option value="1">Habilitadas</option>
                        <option value="0">Pausadas</option>
                    </select>
                </div>
                <div class="w-full sm:w-auto flex justify-end">
                    <button
                        type="button"
                        @click="openCreateCampaignModal"
                        class="w-full sm:w-auto btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"
                    >
                        <i class="fas fa-plus"></i>
                        <span>Nueva Campaña</span>
                    </button>
                </div>
            </div>

            <!-- Lista de Campañas -->
            <div v-if="filteredCampaigns.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div
                    v-for="cmp in filteredCampaigns"
                    :key="cmp.id"
                    class="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group"
                    :class="!cmp.active ? 'opacity-60 bg-gray-50/50' : ''"
                >
                    <!-- Header -->
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <div class="flex items-center gap-1.5 truncate">
                            <h4 class="font-black text-sm text-gray-800 truncate">{{ cmp.name }}</h4>
                            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 shrink-0">
                                {{ cmp.discount_percent }}% OFF
                            </span>
                        </div>
                        <button
                            type="button"
                            @click="handleToggleCampaign(cmp)"
                            class="px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer shrink-0"
                            :class="cmp.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'"
                        >
                            {{ cmp.active ? 'Activa' : 'Pausada' }}
                        </button>
                    </div>

                    <p class="text-xs text-gray-600 mb-3 min-h-[1.5rem] line-clamp-2">
                        {{ cmp.description || 'Sin descripción adicional' }}
                    </p>

                    <!-- Details -->
                    <div class="bg-gray-50 rounded-xl p-2.5 mb-3 space-y-1.5 text-[11px] text-gray-600 border border-gray-100">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400"><i class="fas fa-bullseye mr-1 text-[10px]"></i> Alcance:</span>
                            <span class="font-bold text-gray-800">
                                {{ cmp.scope === 'ALL' ? 'Todo el Menú' : (cmp.scope === 'CATEGORY' ? `Categoría: ${cmp.category_name || cmp.category_id}` : `${(cmp.product_ids || []).length} Platos Seleccionados`) }}
                            </span>
                        </div>
                        <div class="flex justify-between items-center" v-if="cmp.start_date || cmp.end_date">
                            <span class="text-gray-400"><i class="fas fa-calendar mr-1 text-[10px]"></i> Fechas:</span>
                            <span class="font-bold text-gray-800">{{ cmp.start_date || 'Hoy' }} a {{ cmp.end_date || 'Indefinido' }}</span>
                        </div>
                        <div class="flex justify-between items-center" v-if="cmp.start_time || cmp.end_time">
                            <span class="text-gray-400"><i class="fas fa-clock mr-1 text-[10px]"></i> Horario:</span>
                            <span class="font-bold text-gray-800">{{ cmp.start_time || '00:00' }} - {{ cmp.end_time || '23:59' }}</span>
                        </div>
                    </div>

                    <!-- Footer actions -->
                    <div class="flex items-center justify-between pt-2 border-t border-gray-100">
                        <div class="flex flex-wrap gap-1">
                            <span v-for="ch in (Array.isArray(cmp.channels) ? cmp.channels : [])" :key="ch"
                                class="text-[9px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600 font-semibold">
                                {{ ch }}
                            </span>
                        </div>
                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                @click="openEditCampaignModal(cmp)"
                                class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                title="Editar campaña"
                            >
                                <i class="fas fa-edit text-xs"></i>
                            </button>
                            <button
                                type="button"
                                @click="handleDeleteCampaign(cmp)"
                                class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                title="Eliminar campaña"
                            >
                                <i class="fas fa-trash-alt text-xs"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Empty State Campañas -->
            <div v-else class="bg-white rounded-2xl p-4 text-center border border-gray-100 shadow-sm space-y-3">
                <div class="w-16 h-16 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto text-2xl">
                    <i class="fas fa-bullhorn"></i>
                </div>
                <h4 class="font-black text-gray-800 text-sm">No se encontraron campañas de descuento</h4>
                <p class="text-xs text-gray-500 max-w-sm mx-auto">
                    Crea campañas con porcentaje de descuento automático aplicables a todo el restaurante, a categorías específicas o a platos seleccionados.
                </p>
                <button
                    type="button"
                    @click="openCreateCampaignModal"
                    class="btn-system-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs"
                >
                    <i class="fas fa-plus"></i> Crear Primera Campaña
                </button>
            </div>
        </div>

        <!-- MODAL: Crear / Editar Cupón -->
        <Teleport to="body">
            <div v-if="showCouponModal" class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs fade-in overflow-y-auto" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
                <div class="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
                    <!-- Modal Header -->
                    <div class="p-4 sm:px-6 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
                        <div class="flex items-center gap-2.5">
                            <div class="w-10 h-10 rounded-2xl flex items-center justify-center text-base shrink-0 shadow-xs btn-system-primary">
                                <i class="fas fa-ticket"></i>
                            </div>
                            <div>
                                <h3 class="text-sm sm:text-base font-black text-gray-900 leading-tight">
                                    {{ isEditingCoupon ? 'Editar Cupón de Descuento' : 'Nuevo Cupón de Descuento' }}
                                </h3>
                                <p class="text-[11px] text-gray-500">Configura código, porcentaje o valor y condiciones</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            @click="showCouponModal = false"
                            class="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <i class="fas fa-times text-sm"></i>
                        </button>
                    </div>

                    <!-- Modal Body -->
                    <form @submit.prevent="handleSaveCoupon" class="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1">
                        <!-- Código y Tipo -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Código del Cupón *</label>
                                <input
                                    type="text"
                                    v-model="couponForm.code"
                                    required
                                    placeholder="Ej: BIENVENIDA10"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 uppercase font-black tracking-wider outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Tipo de Descuento *</label>
                                <select
                                    v-model="couponForm.discount_type"
                                    class="w-full px-3 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 text-xs font-semibold bg-white cursor-pointer"
                                >
                                    <option value="PERCENT">Porcentaje (%)</option>
                                    <option value="FIXED">Valor Fijo ($)</option>
                                </select>
                            </div>
                        </div>

                        <!-- Valor y Pedido Mínimo -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">
                                    {{ couponForm.discount_type === 'PERCENT' ? 'Porcentaje de Descuento (%) *' : 'Valor del Descuento ($) *' }}
                                </label>
                                <input
                                    type="number"
                                    v-model.number="couponForm.discount_value"
                                    required
                                    min="0.1"
                                    :max="couponForm.discount_type === 'PERCENT' ? 100 : undefined"
                                    step="any"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-bold"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Pedido Mínimo ($)</label>
                                <input
                                    type="number"
                                    v-model.number="couponForm.min_order_total"
                                    min="0"
                                    placeholder="0 = Sin mínimo"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-semibold"
                                >
                            </div>
                        </div>

                        <!-- Descripción -->
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Descripción o Motivo</label>
                            <input
                                type="text"
                                v-model="couponForm.description"
                                placeholder="Ej: 10% de descuento por primera compra"
                                class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs"
                            >
                        </div>

                        <!-- Límite de Usos y Fecha Expiración -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Límite de Usos</label>
                                <input
                                    type="number"
                                    v-model.number="couponForm.max_uses"
                                    min="0"
                                    placeholder="0 = Ilimitado"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-semibold"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Fecha de Expiración</label>
                                <input
                                    type="date"
                                    v-model="couponForm.valid_until"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-semibold"
                                >
                            </div>
                        </div>

                        <!-- Canales Permitidos -->
                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Canales Permitidos</label>
                            <div class="flex flex-wrap gap-2">
                                <label v-for="ch in ['Local', 'Domicilio', 'Para Llevar']" :key="ch"
                                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none transition-colors"
                                    :class="couponForm.channels.includes(ch) ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold' : 'bg-gray-50 border-gray-200 text-gray-600'">
                                    <input type="checkbox" :value="ch" v-model="couponForm.channels" class="hidden">
                                    <i class="fas" :class="couponForm.channels.includes(ch) ? 'fa-check-square text-amber-600' : 'fa-square text-gray-400'"></i>
                                    {{ ch }}
                                </label>
                            </div>
                        </div>

                        <!-- Toggle Activo -->
                        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <h5 class="text-xs font-bold text-gray-800">Estado del Cupón</h5>
                                <p class="text-[10px] text-gray-500">Si está inactivo, los clientes no podrán aplicarlo</p>
                            </div>
                            <button
                                type="button"
                                @click="couponForm.active = couponForm.active ? 0 : 1"
                                class="px-3 py-1 rounded-full text-xs font-bold border transition-colors cursor-pointer"
                                :class="couponForm.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-200 text-gray-600 border-gray-300'"
                            >
                                {{ couponForm.active ? 'Habilitado' : 'Pausado' }}
                            </button>
                        </div>

                        <!-- Footer -->
                        <div class="p-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 rounded-b-3xl mt-4">
                            <button
                                type="button"
                                @click="showCouponModal = false"
                                class="px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                :disabled="savingCoupon"
                                class="btn-system-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                            >
                                <i v-if="savingCoupon" class="fas fa-spinner fa-spin"></i>
                                <span>{{ isEditingCoupon ? 'Guardar Cambios' : 'Crear Cupón' }}</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </Teleport>

        <!-- MODAL: Crear / Editar Campaña -->
        <Teleport to="body">
            <div v-if="showCampaignModal" class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs fade-in overflow-y-auto" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
                <div class="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
                    <!-- Modal Header -->
                    <div class="p-4 sm:px-6 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
                        <div class="flex items-center gap-2.5">
                            <div class="w-10 h-10 rounded-2xl flex items-center justify-center text-base shrink-0 shadow-xs btn-system-primary">
                                <i class="fas fa-bullhorn"></i>
                            </div>
                            <div>
                                <h3 class="text-sm sm:text-base font-black text-gray-900 leading-tight">
                                    {{ isEditingCampaign ? 'Editar Campaña de Descuento' : 'Nueva Campaña de Descuento' }}
                                </h3>
                                <p class="text-[11px] text-gray-500">Aplica porcentaje a todo el menú, categorías o platos</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            @click="showCampaignModal = false"
                            class="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <i class="fas fa-times text-sm"></i>
                        </button>
                    </div>

                    <!-- Modal Body -->
                    <form @submit.prevent="handleSaveCampaign" class="overflow-y-auto p-4 sm:p-6 space-y-4 flex-1">
                        <!-- Nombre y Porcentaje -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Nombre de la Campaña *</label>
                                <input
                                    type="text"
                                    v-model="campaignForm.name"
                                    required
                                    placeholder="Ej: Black Friday, Happy Hour..."
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 font-bold outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Descuento (%) *</label>
                                <input
                                    type="number"
                                    v-model.number="campaignForm.discount_percent"
                                    required
                                    min="1"
                                    max="100"
                                    step="any"
                                    placeholder="Ej: 20"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-black text-amber-800"
                                >
                            </div>
                        </div>

                        <!-- Alcance (Scope) -->
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Alcance del Descuento *</label>
                            <select
                                v-model="campaignForm.scope"
                                class="w-full px-3 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 text-xs font-semibold bg-white cursor-pointer"
                            >
                                <option value="ALL">Todo el Menú (Todos los platos)</option>
                                <option value="CATEGORY">Por Categoría Específica</option>
                                <option value="SELECTED_PRODUCTS">Platos Específicos Seleccionados</option>
                            </select>
                        </div>

                        <!-- Selector si es CATEGORY -->
                        <div v-if="campaignForm.scope === 'CATEGORY'" class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Selecciona la Categoría *</label>
                            <select
                                v-model="campaignForm.category_id"
                                required
                                class="w-full px-3 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 text-xs font-semibold bg-white cursor-pointer"
                            >
                                <option value="" disabled>Selecciona una categoría...</option>
                                <option v-for="cat in (state.categories || [])" :key="cat.id" :value="cat.id">
                                    {{ cat.name }}
                                </option>
                            </select>
                        </div>

                        <!-- Selector si es SELECTED_PRODUCTS -->
                        <div v-if="campaignForm.scope === 'SELECTED_PRODUCTS'" class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">
                                Selecciona los Platos ({{ (campaignForm.product_ids || []).length }} seleccionados)
                            </label>
                            <div class="max-h-36 overflow-y-auto p-2 border border-gray-200 rounded-xl space-y-1 bg-gray-50/50">
                                <label v-for="prod in (state.products || [])" :key="prod.id"
                                    class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white text-xs cursor-pointer">
                                    <input type="checkbox" :value="String(prod.id)" v-model="campaignForm.product_ids" class="rounded text-amber-500">
                                    <span class="font-medium text-gray-800">{{ prod.name }}</span>
                                    <span class="text-[10px] text-gray-400 ml-auto">{{ formatMoney(prod.price) }}</span>
                                </label>
                            </div>
                        </div>

                        <!-- Rango de Fechas -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Fecha Inicio</label>
                                <input
                                    type="date"
                                    v-model="campaignForm.start_date"
                                    class="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none text-xs"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Fecha Fin</label>
                                <input
                                    type="date"
                                    v-model="campaignForm.end_date"
                                    class="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none text-xs"
                                >
                            </div>
                        </div>

                        <!-- Horario (Happy Hour) -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Hora Inicio</label>
                                <input
                                    type="time"
                                    v-model="campaignForm.start_time"
                                    class="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none text-xs"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] font-bold text-gray-700 uppercase">Hora Fin</label>
                                <input
                                    type="time"
                                    v-model="campaignForm.end_time"
                                    class="w-full px-3 py-2 rounded-xl border border-gray-200 outline-none text-xs"
                                >
                            </div>
                        </div>

                        <!-- Canales Permitidos -->
                        <div class="space-y-1.5">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Canales</label>
                            <div class="flex flex-wrap gap-2">
                                <label v-for="ch in ['Local', 'Domicilio', 'Para Llevar']" :key="ch"
                                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs cursor-pointer select-none transition-colors"
                                    :class="campaignForm.channels.includes(ch) ? 'bg-amber-50 border-amber-300 text-amber-900 font-bold' : 'bg-gray-50 border-gray-200 text-gray-600'">
                                    <input type="checkbox" :value="ch" v-model="campaignForm.channels" class="hidden">
                                    <i class="fas" :class="campaignForm.channels.includes(ch) ? 'fa-check-square text-amber-600' : 'fa-square text-gray-400'"></i>
                                    {{ ch }}
                                </label>
                            </div>
                        </div>

                        <!-- Toggle Activo -->
                        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div>
                                <h5 class="text-xs font-bold text-gray-800">Estado de la Campaña</h5>
                                <p class="text-[10px] text-gray-500">Pausar o activar la aplicación de descuentos</p>
                            </div>
                            <button
                                type="button"
                                @click="campaignForm.active = campaignForm.active ? 0 : 1"
                                class="px-3 py-1 rounded-full text-xs font-bold border transition-colors cursor-pointer"
                                :class="campaignForm.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-200 text-gray-600 border-gray-300'"
                            >
                                {{ campaignForm.active ? 'Habilitada' : 'Pausada' }}
                            </button>
                        </div>

                        <!-- Footer -->
                        <div class="p-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 rounded-b-3xl mt-4">
                            <button
                                type="button"
                                @click="showCampaignModal = false"
                                class="px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                :disabled="savingCampaign"
                                class="btn-system-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                            >
                                <i v-if="savingCampaign" class="fas fa-spinner fa-spin"></i>
                                <span>{{ isEditingCampaign ? 'Guardar Cambios' : 'Crear Campaña' }}</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </Teleport>
    </div>
</template>
