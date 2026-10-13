<script setup>
import { ref, computed, onMounted } from 'vue';
import { state } from '@/legacy/core/state.js';
import { formatMoney } from '@/legacy/utils/helpers.js';
import { toast, showConfirmModal } from '@/legacy/components/ui.js';
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

// Modal State
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const saving = ref(false);

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
        channels: Array.isArray(c.channels) ? [...c.channels] : ['Local', 'Domicilio', 'Para Llevar']
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

function onImageChange(e) {
    const file = e.target.files?.[0];
    if (file) {
        selectedImageFile.value = file;
        const reader = new FileReader();
        reader.onload = (ev) => {
            imagePreview.value = ev.target.result;
        };
        reader.readAsDataURL(file);
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
                <div class="relative flex-1 sm:w-64 min-w-[200px]">
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
                    class="p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer"
                >
                    <option value="">Todos los tipos</option>
                    <option value="FIXED_PRICE">Precio Fijo</option>
                    <option value="PERCENT_DISCOUNT">Descuento %</option>
                    <option value="FREE_PRODUCT">2x1 / Cortesía</option>
                    <option value="FIXED_DISCOUNT">Descuento $</option>
                </select>
                <select
                    v-model="filterStatus"
                    class="p-2 border border-gray-200 rounded-xl bg-white outline-none text-xs focus:border-[var(--system-primary)] text-gray-700 cursor-pointer"
                >
                    <option value="">Todos los estados</option>
                    <option value="1">Habilitados</option>
                    <option value="0">Pausados</option>
                </select>
            </div>
            <div class="flex gap-2 w-full sm:w-auto justify-end">
                <button
                    type="button"
                    @click="openCreateModal"
                    class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs"
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

        <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div
                v-for="combo in filteredCombos"
                :key="combo.id"
                class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition-shadow relative"
            >
                <!-- Card Header with image & badges -->
                <div class="p-4 border-b border-gray-50 flex gap-3.5">
                    <img
                        :src="combo.img || '/img/noimage.png'"
                        :alt="combo.name"
                        class="w-18 h-18 rounded-xl object-cover border border-gray-100 shrink-0 bg-gray-50"
                        onerror="this.src='/img/noimage.png'"
                    >
                    <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2 mb-1">
                            <span :class="['px-2 py-0.5 rounded-md text-[10px] font-black border uppercase', getTypeBadge(combo.type).class]">
                                {{ getTypeBadge(combo.type).label }}
                            </span>
                            <!-- Switch disponibilidad -->
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    :checked="combo.available"
                                    @change="onToggle(combo, $event.target.checked)"
                                    class="sr-only peer"
                                >
                                <div class="w-8 h-4.5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>
                        <h4 class="text-sm font-black text-gray-900 truncate leading-tight">{{ combo.name }}</h4>
                        <p v-if="combo.description" class="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{{ combo.description }}</p>
                    </div>
                </div>

                <!-- Products list inside combo -->
                <div class="px-4 py-3 bg-gray-50/50 flex-1">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-2">Platos incluidos:</span>
                    <ul class="space-y-1.5">
                        <li
                            v-for="(it, idx) in (combo.items_config || [])"
                            :key="idx"
                            class="flex items-center justify-between text-xs text-gray-700 bg-white px-2.5 py-1.5 rounded-lg border border-gray-100 shadow-2xs"
                        >
                            <span class="font-bold flex items-center gap-1.5 truncate">
                                <span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-black">{{ it.qty }}x</span>
                                <span class="truncate">{{ it.name }}</span>
                            </span>
                            <span v-if="it.is_free" class="text-[10px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">Cortesía</span>
                            <span v-else class="text-[11px] text-gray-500 font-semibold shrink-0">{{ formatMoney(it.price * (it.qty || 1)) }}</span>
                        </li>
                    </ul>
                </div>

                <!-- Price and Savings Summary Footer -->
                <div class="p-4 border-t border-gray-100 bg-white flex items-center justify-between">
                    <div>
                        <div class="flex items-baseline gap-1.5">
                            <span class="text-base font-black text-gray-900 leading-none">
                                {{ formatMoney(calculateComboSavings(combo).finalPrice) }}
                            </span>
                            <span v-if="calculateComboSavings(combo).savings > 0" class="text-[11px] text-gray-400 line-through font-medium">
                                {{ formatMoney(calculateComboSavings(combo).base) }}
                            </span>
                        </div>
                        <span v-if="calculateComboSavings(combo).savings > 0" class="inline-block mt-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                            Ahorro: -{{ formatMoney(calculateComboSavings(combo).savings) }}
                        </span>
                    </div>

                    <!-- Action buttons -->
                    <div class="flex items-center gap-1.5">
                        <button
                            type="button"
                            @click="openEditModal(combo)"
                            class="p-2 rounded-xl text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Editar combo"
                        >
                            <i class="fas fa-edit text-xs"></i>
                        </button>
                        <button
                            type="button"
                            @click="handleDelete(combo)"
                            class="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Eliminar combo"
                        >
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- MODAL: Crear / Editar Combo -->
        <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs fade-in">
            <div class="bg-white rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
                <!-- Modal Header -->
                <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div class="flex items-center gap-2.5">
                        <div class="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                            <i class="fas fa-tags text-sm"></i>
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
                <form @submit.prevent="handleSave" class="overflow-y-auto p-6 space-y-5 flex-1">
                    <!-- General Details: Name & Category -->
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
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
                                <label v-if="form.type === 'FIXED_PRICE'" class="block text-xs font-bold text-gray-700 mb-1">
                                    Precio Final del Combo ($)
                                </label>
                                <input
                                    v-if="form.type === 'FIXED_PRICE'"
                                    type="number"
                                    v-model.number="form.combo_price"
                                    min="0"
                                    step="500"
                                    placeholder="Ej: 45000"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-emerald-500"
                                >

                                <label v-else-if="form.type === 'PERCENT_DISCOUNT'" class="block text-xs font-bold text-gray-700 mb-1">
                                    Porcentaje de Descuento (%)
                                </label>
                                <input
                                    v-else-if="form.type === 'PERCENT_DISCOUNT'"
                                    type="number"
                                    v-model.number="form.discount_value"
                                    min="1"
                                    max="100"
                                    placeholder="Ej: 15"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-purple-500"
                                >

                                <label v-else-if="form.type === 'FIXED_DISCOUNT'" class="block text-xs font-bold text-gray-700 mb-1">
                                    Valor a Descontar ($)
                                </label>
                                <input
                                    v-else-if="form.type === 'FIXED_DISCOUNT'"
                                    type="number"
                                    v-model.number="form.discount_value"
                                    min="0"
                                    step="500"
                                    placeholder="Ej: 5000"
                                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white font-black text-sm outline-none focus:border-blue-500"
                                >

                                <div v-else-if="form.type === 'FREE_PRODUCT'" class="text-xs text-gray-600">
                                    <i class="fas fa-info-circle text-amber-500 mr-1"></i>
                                    Marca arriba con la casilla <strong>"Gratis"</strong> el plato que se bonificará al 100%.
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
                <div class="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2.5">
                    <button
                        type="button"
                        @click="showModal = false"
                        class="px-4 py-2.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        @click="handleSave"
                        :disabled="saving"
                        class="btn-system-primary px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs disabled:opacity-50"
                    >
                        <i v-if="saving" class="fas fa-spinner fa-spin"></i>
                        <span>{{ isEditing ? 'Guardar Cambios' : 'Crear Combo' }}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
