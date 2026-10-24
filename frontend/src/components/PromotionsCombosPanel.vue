<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';
import { compressImageAsBlob } from '@/legacy/utils/image-utils.js';
import {
    getPromotionsCombos,
    savePromotionCombo,
    togglePromotionCombo,
    deletePromotionCombo,
    listenToPromotionsCombos
} from '@/legacy/services/promotions-service.js';

const combos = ref([]);
const loading = ref(false);
const searchTerm = ref('');
const filterType = ref('');
const filterStatus = ref('');
const filterChannel = ref('');

// Modal State
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const saving = ref(false);

// View Modal State
const showViewModal = ref(false);
const viewingCombo = ref(null);
function openViewModal(c) {
    viewingCombo.value = c;
    showViewModal.value = true;
}

// Form State
const form = ref({
    name: '',
    description: '',
    category: 'Combos',
    type: 'FIXED_PRICE',
    combo_price: 0,
    discount_value: 0,
    items_config: [],
    available: 1,
    days_of_week: ['1', '2', '3', '4', '5', '6', '7'],
    start_time: '',
    end_time: '',
    channels: ['Local', 'Domicilio', 'Para Llevar']
});

const selectedImageFile = ref(null);
const imagePreview = ref('');
const productSearch = ref('');

const allProducts = computed(() => state.products || []);

// Filtrar productos para el selector de platos en el combo
const availableProductsForSelection = computed(() => {
    const q = productSearch.value.toLowerCase().trim();
    if (!q) return allProducts.value.slice(0, 15);
    return allProducts.value.filter(p => (p.name || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)).slice(0, 20);
});

// Suma de precios regulares de los platos seleccionados en el formulario
const formBaseItemsSum = computed(() => {
    return form.value.items_config.reduce((sum, item) => {
        const pPrice = parseFloat(item.price) || 0;
        const pQty = parseFloat(item.qty) || 1;
        return sum + (pPrice * pQty);
    }, 0);
});

// Cálculo dinámico del precio final y ahorro en el formulario
const formFinancialSummary = computed(() => {
    const base = formBaseItemsSum.value;
    let finalPrice = base;
    let savings = 0;

    switch (form.value.type) {
        case 'FIXED_PRICE':
            finalPrice = parseFloat(form.value.combo_price) || 0;
            savings = Math.max(0, base - finalPrice);
            break;
        case 'PERCENT_DISCOUNT':
            const pct = Math.min(100, Math.max(0, parseFloat(form.value.discount_value) || 0));
            savings = Math.round(base * (pct / 100));
            finalPrice = Math.max(0, base - savings);
            break;
        case 'FIXED_DISCOUNT':
            savings = Math.min(base, parseFloat(form.value.discount_value) || 0);
            finalPrice = Math.max(0, base - savings);
            break;
        case 'FREE_PRODUCT':
            savings = form.value.items_config.reduce((acc, it) => {
                if (it.is_free) {
                    return acc + ((parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1));
                }
                return acc;
            }, 0);
            finalPrice = Math.max(0, base - savings);
            break;
    }

    return { base, finalPrice, savings };
});

// Combos filtrados para la tabla/tarjetas
const filteredCombos = computed(() => {
    let list = combos.value || [];

    if (filterType.value) {
        list = list.filter(c => c.type === filterType.value);
    }

    if (filterStatus.value !== '') {
        const isAvail = filterStatus.value === '1';
        list = list.filter(c => c.available === isAvail);
    }

    if (filterChannel.value) {
        const target = filterChannel.value.toLowerCase().trim();
        list = list.filter(c => {
            let chs = [];
            if (Array.isArray(c.channels)) chs = c.channels;
            else if (typeof c.channels === 'string') {
                try { chs = JSON.parse(c.channels); } catch (_) {}
            }
            return chs.some(ch => String(ch).toLowerCase().trim() === target);
        });
    }

    const q = searchTerm.value.toLowerCase().trim();
    if (q) {
        list = list.filter(c =>
            (c.name || '').toLowerCase().includes(q) ||
            (c.description || '').toLowerCase().includes(q) ||
            (c.category || '').toLowerCase().includes(q) ||
            (c.items_config || []).some(it => (it.name || '').toLowerCase().includes(q))
        );
    }

    return list;
});

async function loadCombos() {
    loading.value = true;
    try {
        combos.value = await getPromotionsCombos();
    } catch (e) {
        console.error('Error cargando combos:', e);
        toast('Error al cargar promociones y combos', 'error');
    } finally {
        loading.value = false;
    }
}

async function onToggle(combo, checked) {
    try {
        await togglePromotionCombo(combo.id);
        combo.available = checked;
        toast(`Combo ${checked ? 'habilitado' : 'deshabilitado'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error al cambiar disponibilidad', 'error');
    }
}

function openCreateModal() {
    isEditing.value = false;
    editingId.value = null;
    selectedImageFile.value = null;
    imagePreview.value = '';
    productSearch.value = '';

    form.value = {
        name: '',
        description: '',
        category: 'Combos',
        type: 'FIXED_PRICE',
        combo_price: 0,
        discount_value: 0,
        items_config: [],
        available: 1,
        days_of_week: ['1', '2', '3', '4', '5', '6', '7'],
        start_time: '',
        end_time: '',
        channels: ['Local', 'Domicilio', 'Para Llevar']
    };

    showModal.value = true;
}

function openEditModal(c) {
    isEditing.value = true;
    editingId.value = c.id;
    selectedImageFile.value = null;
    imagePreview.value = c.img || '';
    productSearch.value = '';

    let parsedChannels = ['Local', 'Domicilio', 'Para Llevar'];
    if (Array.isArray(c.channels)) {
        parsedChannels = [...c.channels];
    } else if (typeof c.channels === 'string') {
        try {
            const p = JSON.parse(c.channels);
            if (Array.isArray(p)) parsedChannels = p;
        } catch (_) {}
    }

    form.value = {
        name: c.name,
        description: c.description || '',
        category: c.category || 'Combos',
        type: c.type || 'FIXED_PRICE',
        combo_price: c.combo_price || 0,
        discount_value: c.discount_value || 0,
        items_config: JSON.parse(JSON.stringify(c.items_config || [])),
        available: c.available ? 1 : 0,
        days_of_week: Array.isArray(c.days_of_week) ? [...c.days_of_week] : ['1', '2', '3', '4', '5', '6', '7'],
        start_time: c.start_time || '',
        end_time: c.end_time || '',
        channels: parsedChannels
    };

    showModal.value = true;
}

function addProductToCombo(prod) {
    const exists = form.value.items_config.find(it => it.product_id === prod.id);
    if (exists) {
        exists.qty = (exists.qty || 1) + 1;
    } else {
        form.value.items_config.push({
            product_id: prod.id,
            name: prod.name,
            price: parseFloat(prod.price) || 0,
            qty: 1,
            is_free: false,
            img: prod.img || '/img/noimage.png'
        });
    }
}

function removeProductFromCombo(index) {
    form.value.items_config.splice(index, 1);
}

async function onImageChange(e) {
    const file = e.target.files?.[0];
    if (file) {
        try {
            const compressed = await compressImageAsBlob(file);
            selectedImageFile.value = compressed;
            const reader = new FileReader();
            reader.onload = (ev) => {
                imagePreview.value = ev.target.result;
            };
            reader.readAsDataURL(compressed);
        } catch (err) {
            console.warn('Compresión en cliente no disponible o fallida, usando archivo original:', err);
            selectedImageFile.value = file;
            const reader = new FileReader();
            reader.onload = (ev) => {
                imagePreview.value = ev.target.result;
            };
            reader.readAsDataURL(file);
        }
    }
}

async function handleSave() {
    if (!form.value.name.trim()) {
        toast('Por favor ingresa un nombre para el combo', 'warning');
        return;
    }

    if (form.value.items_config.length === 0) {
        toast('Debes agregar al menos un plato a la promoción o combo', 'warning');
        return;
    }

    if (!form.value.channels || form.value.channels.length === 0) {
        toast('Debes seleccionar al menos un canal de venta para el combo', 'warning');
        return;
    }

    saving.value = true;
    try {
        const formData = new FormData();
        formData.append('name', form.value.name.trim());
        formData.append('description', form.value.description.trim());
        formData.append('category', form.value.category.trim() || 'Combos');
        formData.append('type', form.value.type);
        formData.append('combo_price', form.value.combo_price || 0);
        formData.append('discount_value', form.value.discount_value || 0);
        formData.append('items_config', JSON.stringify(form.value.items_config));
        formData.append('available', form.value.available ? 1 : 0);
        formData.append('days_of_week', JSON.stringify(form.value.days_of_week));
        formData.append('start_time', form.value.start_time || '');
        formData.append('end_time', form.value.end_time || '');
        formData.append('channels', JSON.stringify(form.value.channels));

        if (selectedImageFile.value) {
            formData.append('image', selectedImageFile.value);
        } else if (imagePreview.value) {
            formData.append('img', imagePreview.value);
        }

        await savePromotionCombo(formData, editingId.value);
        toast(`Combo ${isEditing.value ? 'actualizado' : 'creado'} exitosamente`, 'success');
        showModal.value = false;
        await loadCombos();
    } catch (err) {
        console.error('Error guardando combo:', err);
        toast('Error al guardar promoción o combo', 'error');
    } finally {
        saving.value = false;
    }
}

function handleDelete(combo) {
    showConfirmModal('Eliminar Combo', `¿Estás seguro de eliminar el combo "${combo.name}"? Esta acción no se puede deshacer.`, async () => {
        try {
            await deletePromotionCombo(combo.id);
            combos.value = combos.value.filter(c => c.id !== combo.id);
            toast('Combo eliminado exitosamente', 'success');
        } catch (e) {
            console.error('Error eliminando combo:', e);
            toast('Error al eliminar combo', 'error');
        }
    });
}

function calculateComboSavings(combo) {
    const base = (combo.items_config || []).reduce((sum, it) => sum + ((parseFloat(it.price) || 0) * (parseFloat(it.qty) || 1)), 0);
    let finalPrice = base;

    if (combo.type === 'FIXED_PRICE') {
        finalPrice = combo.combo_price;
    } else if (combo.type === 'PERCENT_DISCOUNT') {
        finalPrice = base * (1 - (combo.discount_value / 100));
    } else if (combo.type === 'FIXED_DISCOUNT') {
        finalPrice = Math.max(0, base - combo.discount_value);
    } else if (combo.type === 'FREE_PRODUCT') {
        const freeSum = (combo.items_config || []).filter(i => i.is_free).reduce((s, i) => s + ((parseFloat(i.price) || 0) * (parseFloat(i.qty) || 1)), 0);
        finalPrice = Math.max(0, base - freeSum);
    }

    const savings = Math.max(0, Math.round(base - finalPrice));
    return { base, finalPrice, savings };
}

function getTypeBadge(type) {
    switch (type) {
        case 'FIXED_PRICE':
            return { label: 'Precio Fijo', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
        case 'PERCENT_DISCOUNT':
            return { label: 'Descuento %', class: 'bg-purple-50 text-purple-700 border-purple-200' };
        case 'FREE_PRODUCT':
            return { label: '2x1 / Cortesía', class: 'bg-amber-50 text-amber-700 border-amber-200' };
        case 'FIXED_DISCOUNT':
            return { label: 'Descuento $', class: 'bg-blue-50 text-blue-700 border-blue-200' };
        default:
            return { label: 'Combo', class: 'bg-gray-50 text-gray-700 border-gray-200' };
    }
}

function getChannelBadge(channel) {
    const ch = String(channel || '').toLowerCase().trim();
    if (ch.includes('local') || ch.includes('mesa')) {
        return { label: 'Local (Mesa)', icon: 'fas fa-chair text-blue-600', class: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
    if (ch.includes('domicilio')) {
        return { label: 'Domicilio', icon: 'fas fa-motorcycle text-orange-600', class: 'bg-orange-50 text-orange-700 border-orange-200' };
    }
    if (ch.includes('llevar') || ch.includes('recoger')) {
        return { label: 'Para Llevar', icon: 'fas fa-shopping-bag text-purple-600', class: 'bg-purple-50 text-purple-700 border-purple-200' };
    }
    return { label: channel, icon: 'fas fa-tag text-gray-500', class: 'bg-gray-50 text-gray-700 border-gray-200' };
}

onMounted(() => {
    loadCombos();
    listenToPromotionsCombos((updatedList) => {
        combos.value = updatedList;
    });
});
</script>

<template>
    <div class="space-y-4">
        <!-- Top Toolbar: Controls, Search, Filter & New Button -->
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <div class="flex flex-1 flex-wrap items-center gap-2.5 w-full sm:w-auto">
                <div class="relative w-full sm:w-64 sm:flex-initial">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                    <input
                        type="text"
                        v-model="searchTerm"
                        placeholder="Buscar promoción o combo..."
                        class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl outline-none focus:border-[var(--system-primary)] focus:ring-2 focus:ring-amber-100 transition-all text-xs"
                    >
                </div>
                <select
                    v-model="filterType"
                    class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[130px]"
                >
                    <option value="">Todos los tipos</option>
                    <option value="FIXED_PRICE">Precio Fijo</option>
                    <option value="PERCENT_DISCOUNT">Descuento %</option>
                    <option value="FREE_PRODUCT">2x1 / Cortesía</option>
                    <option value="FIXED_DISCOUNT">Descuento $</option>
                </select>
                <select
                    v-model="filterStatus"
                    class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[120px]"
                >
                    <option value="">Todos los estados</option>
                    <option value="1">Habilitados</option>
                    <option value="0">Pausados</option>
                </select>
                <select
                    v-model="filterChannel"
                    class="flex-1 sm:flex-initial p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer min-w-[120px]"
                >
                    <option value="">Todos los canales</option>
                    <option value="Local">Local (Mesa)</option>
                    <option value="Domicilio">Domicilio</option>
                    <option value="Para Llevar">Para Llevar / Recoger</option>
                </select>
            </div>
            <div class="flex gap-2 w-full sm:w-auto justify-end">
                <button
                    type="button"
                    @click="openCreateModal"
                    class="w-full sm:w-auto btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"
                >
                    <i class="fas fa-plus"></i>
                    <span>Nuevo Combo o Promoción</span>
                </button>
            </div>
        </div>

        <!-- Combos Cards Grid -->
        <div v-if="loading" class="text-center py-12 bg-white rounded-2xl border border-gray-100">
            <i class="fas fa-spinner fa-spin text-2xl text-[var(--system-primary)] mb-2"></i>
            <p class="text-xs text-gray-500 font-medium">Cargando promociones y combos...</p>
        </div>

        <div v-else-if="filteredCombos.length === 0" class="text-center py-16 bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <div class="w-16 h-16 mx-auto mb-3 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 text-2xl border border-amber-100">
                <i class="fas fa-tags"></i>
            </div>
            <h3 class="text-base font-bold text-gray-800 mb-1">No hay promociones o combos registrados</h3>
            <p class="text-xs text-gray-500 max-w-md mx-auto mb-5">
                Crea paquetes preestablecidos con precios especiales, descuentos porcentuales o 2x1 para aumentar las ventas de tu restaurante.
            </p>
            <button
                type="button"
                @click="openCreateModal"
                class="btn-system-primary px-5 mt-2 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-sm"
            >
                <i class="fas fa-plus"></i> Crear Primer Combo
            </button>
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <div
                v-for="combo in filteredCombos"
                :key="combo.id"
                class="bg-white rounded-xl border border-gray-100 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between p-3 relative group cursor-pointer"
                @click="openViewModal(combo)"
            >
                <div class="mb-2">
                    <!-- Header: Imagen compacta + Modalidad + Switch -->
                    <div class="flex gap-2.5 items-start">
                        <img
                            :src="combo.img || '/img/noimage.png'"
                            :alt="combo.name"
                            class="w-14 h-14 rounded-lg object-cover border border-gray-100 shrink-0 bg-gray-50 shadow-2xs"
                            onerror="this.src='/img/noimage.png'"
                        >
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-1 mb-1">
                                <span :class="['px-1.5 py-0.2 rounded text-[9px] font-black border uppercase tracking-wider truncate', getTypeBadge(combo.type).class]">
                                    {{ getTypeBadge(combo.type).label }}
                                </span>
                                <!-- Switch disponibilidad -->
                                <label @click.stop class="relative inline-flex items-center cursor-pointer shrink-0" title="Activar/Desactivar disponibilidad">
                                    <input
                                        type="checkbox"
                                        :checked="combo.available"
                                        @change="onToggle(combo, $event.target.checked)"
                                        class="sr-only"
                                    >
                                    <div
                                        class="w-9 h-5 rounded-full transition-colors duration-200 ease-in-out p-0.5 flex items-center shadow-inner relative"
                                        :style="combo.available ? 'background-color: var(--system-primary, #f5b55f) !important;' : 'background-color: #e5e7eb;'"
                                    >
                                        <div
                                            class="w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-200 ease-in-out"
                                            :style="combo.available ? 'transform: translateX(16px);' : 'transform: translateX(0px);'"
                                        ></div>
                                    </div>
                                </label>
                            </div>
                            <h4 class="text-sm font-black text-gray-900 truncate leading-snug" :title="combo.name">
                                {{ combo.name }}
                            </h4>
                            <p class="text-[10px] text-gray-500 line-clamp-1 mt-0.5" :title="combo.description || 'Sin descripción'">{{ combo.description || 'Sin descripción' }}</p>
                        </div>
                    </div>

                    <!-- Canales de Venta -->
                    <div class="flex flex-wrap items-center gap-1 mt-2 mb-2">
                        <span
                            v-for="ch in (combo.channels || [])"
                            :key="ch"
                            :class="['inline-flex items-center gap-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded border', getChannelBadge(ch).class]"
                        >
                            <i :class="getChannelBadge(ch).icon" class="text-[8px]"></i>
                            <span>{{ getChannelBadge(ch).label }}</span>
                        </span>
                        <span v-if="!combo.channels || combo.channels.length === 0" class="text-[10px] text-red-500 font-bold bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                            Sin canales
                        </span>
                    </div>
                </div>

                <!-- Footer: Precio y Barra de Acciones (Ver, Editar, Eliminar) -->
                <div class="mt-2.5 pt-2 border-t border-gray-50 flex items-center justify-between gap-1">
                    <div>
                        <div class="flex items-baseline gap-1">
                            <span class="text-sm font-black text-gray-900 leading-none">
                                {{ formatMoney(calculateComboSavings(combo).finalPrice) }}
                            </span>
                            <span v-if="calculateComboSavings(combo).savings > 0" class="text-[10px] text-gray-400 line-through font-medium">
                                {{ formatMoney(calculateComboSavings(combo).base) }}
                            </span>
                        </div>
                    </div>

                    <!-- Barra de Acciones -->
                    <div class="flex items-center gap-0.5 shrink-0">
                        <button
                            type="button"
                            @click.stop="openViewModal(combo)"
                            class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                            title="Ver platos y detalle del combo"
                        >
                            <i class="fas fa-eye text-xs"></i>
                        </button>
                        <button
                            type="button"
                            @click.stop="openEditModal(combo)"
                            class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Editar combo"
                        >
                            <i class="fas fa-edit text-xs"></i>
                        </button>
                        <button
                            type="button"
                            @click.stop="handleDelete(combo)"
                            class="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Eliminar combo"
                        >
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- MODAL: Crear / Editar Combo -->
        <Teleport to="body">
            <div v-if="showModal" class="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs fade-in overflow-y-auto" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
                <div class="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full max-h-[90vh] sm:max-h-[92vh] max-h-[90dvh] flex flex-col overflow-hidden my-auto">
                    <!-- Modal Header -->
                    <div class="p-2 sm:px-6 py-2 sm:py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 shrink-0">
                        <div class="flex items-center p-4 gap-2.5">
                            <div class="w-10 h-10 rounded-2xl flex items-center justify-center text-base shrink-0 shadow-xs" style="background-color: var(--system-primary, #f5b55f); color: var(--system-secondary, #1e2122);">
                                <i class="fas fa-tags" style="color: var(--system-secondary, #1e2122);"></i>
                            </div>
                            <div>
                                <h3 class="text-sm sm:text-base font-black text-gray-900 leading-tight">
                                    {{ isEditing ? 'Editar Promoción o Combo' : 'Crear Promoción o Combo' }}
                                </h3>
                                <p class="text-[11px] text-gray-500">Configura platos incluidos y modalidad de cobro</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            @click="showModal = false"
                            class="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <i class="fas fa-times text-sm"></i>
                        </button>
                    </div>

                    <!-- Modal Body (Scrollable) -->
                    <form @submit.prevent="handleSave" class="overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5 flex-1 min-h-0 overscroll-contain">
                    <!-- General Details: Name & Category -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div class="sm:col-span-2 space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Nombre del Combo *</label>
                            <input
                                type="text"
                                v-model="form.name"
                                required
                                placeholder="Ej: Combo Pareja, Super 2x1..."
                                class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-semibold"
                            >
                        </div>
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Categoría</label>
                            <input
                                type="text"
                                v-model="form.category"
                                placeholder="Combos"
                                class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs font-semibold"
                            >
                        </div>
                    </div>

                    <!-- Description & Image -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start mb-2">
                        <div class="sm:col-span-2 space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Descripción o Beneficio</label>
                            <textarea
                                v-model="form.description"
                                rows="2"
                                placeholder="Ej: Incluye 2 hamburguesas artesanales, papas grandes y gaseosa 1L"
                                class="w-full px-3.5 py-2 rounded-xl border border-gray-200 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 text-xs"
                            ></textarea>
                        </div>
                        <div class="space-y-1">
                            <label class="text-[11px] font-bold text-gray-700 uppercase">Foto del Combo</label>
                            <div class="flex items-center gap-2">
                                <img
                                    :src="imagePreview || '/img/noimage.png'"
                                    class="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0 bg-gray-50"
                                >
                                <label class="flex-1 px-3 py-2 border border-gray-200 hover:bg-gray-50 rounded-xl text-center text-xs font-bold text-gray-600 cursor-pointer transition-colors truncate">
                                    <i class="fas fa-camera mr-1"></i> Subir
                                    <input type="file" accept="image/*" class="hidden" @change="onImageChange">
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- PLATOS PREESTABLECIDOS (Items selector & builder) -->
                    <div class="bg-gray-50/80 p-4 rounded-2xl border border-gray-100 space-y-3">
                        <div class="flex items-center justify-between">
                            <label class="text-xs font-black text-gray-800 uppercase flex items-center gap-1.5">
                                <i class="fas fa-utensils text-amber-500"></i>
                                <span>Platos Incluidos en el Paquete</span>
                            </label>
                            <span class="text-[11px] font-bold text-gray-500">
                                Suma regular: <strong class="text-gray-900">{{ formatMoney(formBaseItemsSum) }}</strong>
                            </span>
                        </div>

                        <!-- Selector buscador de platos del restaurante -->
                        <div class="relative">
                            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                            <input
                                type="text"
                                v-model="productSearch"
                                placeholder="Escribe para buscar y agregar platos al combo..."
                                class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl bg-white outline-none focus:border-amber-500 text-xs"
                            >
                            <!-- Dropdown de resultados rápidos si hay búsqueda o foco -->
                            <div v-if="productSearch.trim().length > 0" class="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-50">
                                <div
                                    v-for="p in availableProductsForSelection"
                                    :key="p.id"
                                    @click="addProductToCombo(p)"
                                    class="p-2.5 hover:bg-amber-50/60 flex items-center justify-between cursor-pointer transition-colors"
                                >
                                    <div class="flex items-center gap-2 min-w-0">
                                        <img :src="p.img || '/img/noimage.png'" class="w-7 h-7 rounded-lg object-cover">
                                        <span class="text-xs font-bold text-gray-800 truncate">{{ p.name }}</span>
                                        <span class="text-[10px] text-gray-400">({{ p.category }})</span>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs font-black text-gray-900">{{ formatMoney(p.price) }}</span>
                                        <button type="button" class="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-lg">
                                            + Agregar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Lista de platos agregados al combo -->
                        <div v-if="form.items_config.length === 0" class="text-center py-6 border-2 border-dashed border-gray-200 rounded-xl bg-white">
                            <i class="fas fa-shopping-basket text-gray-300 text-xl mb-1"></i>
                            <p class="text-xs text-gray-400 font-medium">Aún no has agregado ningún plato a este combo</p>
                        </div>

                        <div v-else class="space-y-1.5">
                            <div
                                v-for="(it, idx) in form.items_config"
                                :key="idx"
                                class="flex items-center justify-between gap-2 p-2 bg-white rounded-xl border border-gray-100 shadow-2xs"
                            >
                                <div class="flex items-center gap-2 min-w-0 flex-1">
                                    <span class="text-xs font-bold text-gray-800 truncate">{{ it.name }}</span>
                                    <span class="text-[11px] text-gray-400 font-medium">({{ formatMoney(it.price) }} c/u)</span>
                                </div>

                                <div class="flex items-center gap-2.5 shrink-0">
                                    <!-- Cantidad -->
                                    <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                                        <button
                                            type="button"
                                            @click="it.qty = Math.max(1, (it.qty || 1) - 1)"
                                            class="w-5 h-5 rounded flex items-center justify-center text-gray-600 hover:bg-white text-xs font-bold"
                                        >-</button>
                                        <span class="w-6 text-center text-xs font-black text-gray-800">{{ it.qty }}</span>
                                        <button
                                            type="button"
                                            @click="it.qty = (it.qty || 1) + 1"
                                            class="w-5 h-5 rounded flex items-center justify-center text-gray-600 hover:bg-white text-xs font-bold"
                                        >+</button>
                                    </div>

                                    <!-- Toggle Cortesía / $0 -->
                                    <label class="flex items-center gap-1 text-[11px] font-bold text-gray-600 cursor-pointer select-none">
                                        <input type="checkbox" v-model="it.is_free" class="rounded text-amber-500 focus:ring-0">
                                        <span>Gratis</span>
                                    </label>

                                    <!-- Eliminar plato del combo -->
                                    <button
                                        type="button"
                                        @click="removeProductFromCombo(idx)"
                                        class="text-red-400 hover:text-red-600 p-1 transition-colors"
                                    >
                                        <i class="fas fa-trash-alt text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- MODALIDAD DE COBRO Y BENEFICIO -->
                    <div class="space-y-3">
                        <label class="text-[11px] font-black text-gray-700 uppercase">Modalidad de Cobro / Beneficio</label>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <button
                                type="button"
                                @click="form.type = 'FIXED_PRICE'"
                                :class="[
                                    'p-2.5 rounded-xl border text-left transition-all',
                                    form.type === 'FIXED_PRICE'
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold ring-2 ring-emerald-200'
                                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                ]"
                            >
                                <span class="block text-xs font-black">Precio Fijo</span>
                                <span class="block text-[10px] opacity-75">Cobro cerrado</span>
                            </button>

                            <button
                                type="button"
                                @click="form.type = 'PERCENT_DISCOUNT'"
                                :class="[
                                    'p-2.5 rounded-xl border text-left transition-all',
                                    form.type === 'PERCENT_DISCOUNT'
                                        ? 'border-purple-500 bg-purple-50 text-purple-800 font-bold ring-2 ring-purple-200'
                                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                ]"
                            >
                                <span class="block text-xs font-black">Descuento %</span>
                                <span class="block text-[10px] opacity-75">Porcentaje OFF</span>
                            </button>

                            <button
                                type="button"
                                @click="form.type = 'FREE_PRODUCT'"
                                :class="[
                                    'p-2.5 rounded-xl border text-left transition-all',
                                    form.type === 'FREE_PRODUCT'
                                        ? 'border-amber-500 bg-amber-50 text-amber-800 font-bold ring-2 ring-amber-200'
                                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                ]"
                            >
                                <span class="block text-xs font-black">2x1 / Cortesía</span>
                                <span class="block text-[10px] opacity-75">Plato bonificado</span>
                            </button>

                            <button
                                type="button"
                                @click="form.type = 'FIXED_DISCOUNT'"
                                :class="[
                                    'p-2.5 rounded-xl border text-left transition-all',
                                    form.type === 'FIXED_DISCOUNT'
                                        ? 'border-blue-500 bg-blue-50 text-blue-800 font-bold ring-2 ring-blue-200'
                                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                                ]"
                            >
                                <span class="block text-xs font-black">Descuento $</span>
                                <span class="block text-[10px] opacity-75">Monto fijo en $</span>
                            </button>
                        </div>

                        <!-- Dynamic Inputs according to type -->
                        <div class="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div class="w-full sm:w-1/2">
                                <!-- Precio Fijo -->
                                <div v-if="form.type === 'FIXED_PRICE'" class="space-y-1">
                                    <label class="block text-xs font-bold text-gray-700">
                                        Precio Final del Combo ($)
                                    </label>
                                    <input
                                        type="number"
                                        v-model.number="form.combo_price"
                                        min="0"
                                        step="500"
                                        placeholder="Ej: 45000"
                                        class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-emerald-500"
                                    >
                                </div>

                                <!-- Descuento % Porcentual -->
                                <div v-else-if="form.type === 'PERCENT_DISCOUNT'" class="space-y-1">
                                    <label class="block text-xs font-bold text-gray-700">
                                        Porcentaje de Descuento (%)
                                    </label>
                                    <div class="relative">
                                        <input
                                            type="number"
                                            v-model.number="form.discount_value"
                                            min="1"
                                            max="100"
                                            placeholder="Ej: 15"
                                            class="w-full px-3.5 py-2.5 pr-8 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-purple-500"
                                        >
                                        <span class="absolute right-3 top-1/2 -translate-y-1/2 font-black text-xs text-purple-600">%</span>
                                    </div>
                                </div>

                                <!-- Descuento $ Monto Fijo -->
                                <div v-else-if="form.type === 'FIXED_DISCOUNT'" class="space-y-1">
                                    <label class="block text-xs font-bold text-gray-700">
                                        Valor a Descontar ($)
                                    </label>
                                    <input
                                        type="number"
                                        v-model.number="form.discount_value"
                                        min="0"
                                        step="500"
                                        placeholder="Ej: 5000"
                                        class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-blue-500"
                                    >
                                </div>

                                <!-- Plato Cortesía / 2x1 -->
                                <div v-else-if="form.type === 'FREE_PRODUCT'" class="text-xs text-gray-600 space-y-1">
                                    <span class="font-bold text-gray-700 block">Plato de Cortesía:</span>
                                    <p class="text-[11px] text-gray-500">
                                        <i class="fas fa-info-circle text-amber-500 mr-1"></i>
                                        Marca en la lista de arriba la casilla <strong>"Gratis"</strong> en el plato que se bonificará al 100%.
                                    </p>
                                </div>
                            </div>

                            <!-- Live Calculation Pill -->
                            <div class="w-full sm:w-1/2 bg-white p-3 rounded-xl border border-gray-200/80 shadow-2xs space-y-1">
                                <div class="flex justify-between text-xs text-gray-500">
                                    <span>Suma regular:</span>
                                    <span>{{ formatMoney(formFinancialSummary.base) }}</span>
                                </div>
                                <div class="flex justify-between text-xs font-bold text-emerald-600">
                                    <span>Ahorro cliente:</span>
                                    <span>-{{ formatMoney(formFinancialSummary.savings) }}</span>
                                </div>
                                <div class="flex justify-between text-sm font-black text-gray-900 pt-1 border-t border-gray-100">
                                    <span>Total a Cobrar:</span>
                                    <span>{{ formatMoney(formFinancialSummary.finalPrice) }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Canales de Venta -->
                    <div class="space-y-1.5">
                        <label class="text-[11px] font-bold text-gray-700 uppercase">Canales de Venta Aplicables</label>
                        <div class="flex flex-wrap gap-4 text-xs font-semibold text-gray-700">
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" value="Local" v-model="form.channels" class="rounded text-amber-500">
                                <span>Local (Mesa)</span>
                            </label>
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" value="Domicilio" v-model="form.channels" class="rounded text-amber-500">
                                <span>Domicilio</span>
                            </label>
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" value="Para Llevar" v-model="form.channels" class="rounded text-amber-500">
                                <span>Para Llevar / Recoger</span>
                            </label>
                        </div>
                    </div>
                </form>

                <!-- Modal Footer -->
                <div class="p-2 sm:px-6 py-3.5 sm:py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2.5 shrink-0">
                    <button
                        type="button"
                        @click="showModal = false"
                        class="px-4 py-2.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        @click="handleSave"
                        :disabled="saving"
                        class="btn-system-primary px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs disabled:opacity-50 cursor-pointer"
                    >
                        <i v-if="saving" class="fas fa-spinner fa-spin"></i>
                        <span>{{ isEditing ? 'Guardar Cambios' : 'Crear Combo' }}</span>
                    </button>
                </div>
            </div>
        </div>
        </Teleport>

        <!-- MODAL: Ver Detalle del Combo -->
        <Teleport to="body">
        <div
            v-if="showViewModal && viewingCombo"
            class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in overflow-y-auto"
            @click.self="showViewModal = false"
        >
            <div class="bg-white rounded-2xl w-full max-w-md max-h-[85vh] max-h-[85dvh] shadow-2xl overflow-hidden flex flex-col border border-gray-100 animate-scale-up my-auto">
                <!-- Modal Header -->
                <div class="p-4 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                    <div class="flex items-center gap-2.5">
                        <div class="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-xs font-black shrink-0"
                             style="background-color: var(--system-primary, #f5b55f); color: var(--system-secondary, #1e2122);">
                            <i class="fas fa-tags" style="color: var(--system-secondary, #1e2122) !important;"></i>
                        </div>
                        <div>
                            <h3 class="font-black text-sm text-gray-900 tracking-tight leading-tight flex items-center gap-1.5">
                                <i class="fas fa-tags text-xs shrink-0" style="color: var(--system-primary, #f5b55f) !important;"></i>
                                <span>{{ viewingCombo.name }}</span>
                            </h3>
                            <span :class="['px-1.5 py-0.2 rounded text-[9px] font-black border uppercase tracking-wider inline-block mt-0.5', getTypeBadge(viewingCombo.type).class]">
                                {{ getTypeBadge(viewingCombo.type).label }}
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        @click="showViewModal = false"
                        class="w-7 h-7 rounded-full bg-white/80 hover:bg-white text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center cursor-pointer shadow-2xs"
                    >
                        <i class="fas fa-times text-xs"></i>
                    </button>
                </div>

                <!-- Modal Body -->
                <div class="p-4 overflow-y-auto space-y-4 subtle-scrollbar flex-1 min-h-0 overscroll-contain">
                    <div class="flex gap-3 items-center">
                        <img
                            :src="viewingCombo.img || '/img/noimage.png'"
                            :alt="viewingCombo.name"
                            class="w-16 h-16 rounded-xl object-cover border border-gray-100 shrink-0 bg-gray-50 shadow-2xs"
                            onerror="this.src='/img/noimage.png'"
                        >
                        <div class="min-w-0 flex-1">
                            <p class="text-xs text-gray-600 leading-relaxed">{{ viewingCombo.description || 'Sin descripción detallada.' }}</p>
                            <!-- Canales -->
                            <div class="flex flex-wrap items-center gap-1 mt-2">
                                <span
                                    v-for="ch in (viewingCombo.channels || [])"
                                    :key="ch"
                                    :class="['inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border', getChannelBadge(ch).class]"
                                >
                                    <i :class="getChannelBadge(ch).icon"></i>
                                    <span>{{ getChannelBadge(ch).label }}</span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Platos Incluidos -->
                    <div class="bg-gray-50/80 rounded-xl p-3 border border-gray-100">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-2">Platos incluidos en la promoción:</span>
                        <ul class="space-y-1.5">
                            <li
                                v-for="(it, idx) in (viewingCombo.items_config || [])"
                                :key="idx"
                                class="flex items-center justify-between text-xs text-gray-800 bg-white px-3 py-2 rounded-lg border border-gray-100 shadow-2xs"
                            >
                                <span class="font-bold flex items-center gap-2 truncate">
                                    <span class="text-[10px] bg-amber-100 text-amber-900 px-1.5 py-0.2 rounded font-black">{{ it.qty }}x</span>
                                    <span class="truncate">{{ it.name }}</span>
                                </span>
                                <span v-if="it.is_free" class="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase">Cortesía</span>
                                <span v-else class="text-xs text-gray-600 font-semibold shrink-0">{{ formatMoney(it.price * (it.qty || 1)) }}</span>
                            </li>
                        </ul>
                    </div>

                    <!-- Resumen Financiero -->
                    <div class="bg-amber-50/60 rounded-xl p-3 border border-amber-200/60 space-y-1 text-xs">
                        <div class="flex justify-between text-gray-600">
                            <span>Suma precio regular de platos:</span>
                            <span class="font-bold">{{ formatMoney(calculateComboSavings(viewingCombo).base) }}</span>
                        </div>
                        <div v-if="calculateComboSavings(viewingCombo).savings > 0" class="flex justify-between text-emerald-600 font-bold">
                            <span>Ahorro del cliente:</span>
                            <span>-{{ formatMoney(calculateComboSavings(viewingCombo).savings) }}</span>
                        </div>
                        <div class="flex justify-between text-sm font-black text-gray-900 pt-1 border-t border-amber-200/80">
                            <span>Precio Final a Cobrar:</span>
                            <span class="text-amber-800">{{ formatMoney(calculateComboSavings(viewingCombo).finalPrice) }}</span>
                        </div>
                    </div>
                </div>

                <!-- Modal Footer -->
                <div class="p-3 bg-gray-50/50 border-t border-gray-100 flex justify-end gap-2 shrink-0">
                    <button
                        type="button"
                        @click="showViewModal = false; openEditModal(viewingCombo)"
                        class="px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    <button
                        type="button"
                        @click="showViewModal = false"
                        class="px-4 py-2 rounded-xl text-xs font-bold bg-gray-200 hover:bg-gray-300 text-gray-700 transition-colors cursor-pointer"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
        </Teleport>
    </div>
</template>
