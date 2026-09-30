/**
 * DigiRest - Cashflow & Financial Overview View Module
 * Main entry point for the "flujocaja" panel.
 * Coordinates subtabs, overview metrics, cash movements, and categories.
 * Delegates accounts/funds to cashflow-funds-view.js and payables/receivables to cashflow-debts-view.js.
 */

import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import {
    getCashflow,
    createCashMovement,
    deleteCashMovement,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory
} from '../services/cashflow-service.js';
import { toast, showConfirmModal } from '../components/ui.js';

// Modular sub-views
import {
    getAccountsData,
    refreshAccountsCache,
    loadAccountsTab,
    openAccountModal,
    openTransferModal,
    updateMovementAccountsDropdown,
    setupAccountsEvents,
    getFundsModalsHTML
} from './cashflow-funds-view.js';

import {
    getPayablesData,
    getReceivablesData,
    loadPayablesTab,
    loadReceivablesTab,
    openPayableModal,
    openReceivableModal,
    openAbonoModal,
    setupDebtsEvents,
    getDebtsModalsHTML
} from './cashflow-debts-view.js';

// Re-exports for complete backward compatibility
export {
    getAccountsData,
    refreshAccountsCache,
    loadAccountsTab,
    openAccountModal,
    openTransferModal
} from './cashflow-funds-view.js';

export {
    getPayablesData,
    getReceivablesData,
    loadPayablesTab,
    loadReceivablesTab,
    openPayableModal,
    openReceivableModal,
    openAbonoModal
} from './cashflow-debts-view.js';

// Estado global de la vista de Flujo de Caja
let _currentSubTab = 'overview'; // 'overview' | 'accounts' | 'payables' | 'receivables' | 'categories'
let _activePeriod = 'month';
let _paymentFilter = 'all';
let _customStartDate = '';
let _customEndDate = '';
let _cfCurrentPage = 1;
const CF_PAGE_SIZE = 15;

let _cashflowData = null;
let _categoriesData = [];

export function getCategoriesData() {
    return _categoriesData;
}

/**
 * Entrada principal invocada al abrir la pestaña "flujocaja"
 */
export async function renderAdminCashflowPage() {
    const container = $('panel-flujocaja');
    if (!container) return;

    if (!container.querySelector('#cf-subnav')) {
        buildCashflowSkeleton(container);
        setupCashflowEvents();
    }

    // Cargar datos según la sub-pestaña activa
    await loadCurrentSubTabData();
}

/**
 * Genera la estructura base y los modales una sola vez
 */
function buildCashflowSkeleton(container) {
    container.innerHTML = `
        <div class="space-y-6 fade-in">
            <!-- Header Bar & Sub-Navigation -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 class="text-xl md:text-2xl font-black text-[#333333] tracking-tight flex items-center gap-2.5">
                        <span class="w-10 h-10 rounded-xl bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center text-lg shadow-sm">
                            <i class="fas fa-coins"></i>
                        </span>
                        Flujo Monetario & Finanzas
                    </h2>
                </div>

                <!-- Sub-Tabs Navigation -->
                <div class="inline-flex bg-gray-200/80 p-1 gap-2 rounded-xl text-xs font-semibold overflow-x-auto custom-scroll" id="cf-subnav">
                    <button type="button" data-subtab="overview" class="cf-subtab-btn active px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1.5 whitespace-nowrap">
                        <i class="fas fa-chart-line"></i>
                        <span>Flujo General</span>
                    </button>
                    <button type="button" data-subtab="accounts" class="cf-subtab-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap">
                        <i class="fas fa-wallet"></i>
                        <span>Cuentas (Fondos)</span>
                    </button>
                    <button type="button" data-subtab="payables" class="cf-subtab-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap">
                        <i class="fas fa-file-invoice-dollar"></i>
                        <span>Cuentas Por Pagar (CxP)</span>
                    </button>
                    <button type="button" data-subtab="receivables" class="cf-subtab-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap">
                        <i class="fas fa-hand-holding-dollar"></i>
                        <span>Cuentas Por Cobrar (CxC)</span>
                    </button>
                    <button type="button" data-subtab="categories" class="cf-subtab-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap">
                        <i class="fas fa-tags"></i>
                        <span>Categorías</span>
                    </button>
                </div>
            </div>

            <!-- CONTENEDOR DE SUB-PESTAÑAS -->
            <div id="cf-content-area" class="space-y-6">
                <!-- Se inyecta dinámicamente según sub-pestaña activa -->
            </div>
        </div>
    `;

    // Los modales se inyectan en document.body para evitar confinamiento de z-index
    let modalsContainer = document.getElementById('cf-modals-container');
    if (!modalsContainer) {
        modalsContainer = document.createElement('div');
        modalsContainer.id = 'cf-modals-container';
        document.body.appendChild(modalsContainer);
    }
    modalsContainer.innerHTML = `
        <!-- MODAL: Nuevo Movimiento de Caja -->
        <div id="cf-modal-movement" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-4 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-exchange-alt text-[var(--system-primary)]"></i>
                        Registrar Movimiento de Caja
                    </h3>
                    <button type="button" id="cf-close-modal-btn" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>

                <form id="cf-form-movement" class="mt-4 space-y-4">
                    <!-- Selector Tipo: Ingreso / Egreso -->
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1.5">Tipo de Movimiento</label>
                        <div class="grid grid-cols-2 gap-3">
                            <label class="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-gray-200 cursor-pointer has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 text-xs font-bold transition-all">
                                <input type="radio" name="movement_type" value="INCOME" checked class="text-emerald-600 focus:ring-emerald-500">
                                <span class="text-emerald-700"><i class="fas fa-arrow-down mr-1"></i>Ingreso / Entrada</span>
                            </label>
                            <label class="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-gray-200 cursor-pointer has-[:checked]:border-red-500 has-[:checked]:bg-red-50 text-xs font-bold transition-all">
                                <input type="radio" name="movement_type" value="EXPENSE" class="text-red-600 focus:ring-red-500">
                                <span class="text-red-700"><i class="fas fa-arrow-up mr-1"></i>Egreso / Salida</span>
                            </label>
                        </div>
                    </div>

                    <!-- Categoría de Movimiento -->
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <label class="text-xs font-bold text-gray-700">Categoría</label>
                            <button type="button" id="cf-btn-quick-category" class="text-[11px] text-[#005dbd] hover:underline font-semibold">
                                + Nueva Categoría
                            </button>
                        </div>
                        <select id="cf-input-category" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="">Selecciona una categoría...</option>
                        </select>
                    </div>

                    <!-- Concepto -->
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Concepto / Motivo</label>
                        <input type="text" id="cf-input-concept" placeholder="Ej: Compra de insumos de aseo, Pago flete" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>

                    <!-- Monto & Método de Pago -->
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">Monto ($)</label>
                            <input type="number" id="cf-input-amount" min="1" step="any" placeholder="0" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono font-bold outline-none focus:border-orange-500">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">Método de Pago</label>
                            <select id="cf-input-method" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500 font-semibold">
                                <option value="Efectivo">Efectivo</option>
                                <option value="Transferencia">Transferencia</option>
                                <option value="Datáfono">Datáfono</option>
                            </select>
                        </div>
                    </div>

                    <!-- Cuenta Bancaria / Fondo Vinculado -->
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Cuenta de Fondos</label>
                        <select id="cf-input-account" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="">Sin cuentas asociadas</option>
                        </select>
                    </div>

                    <!-- Notas adicionales -->
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Notas / Justificación (Opcional)</label>
                        <textarea id="cf-input-notes" rows="2" placeholder="Detalles u observaciones..." class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500"></textarea>
                    </div>

                    <!-- Botones de Acción -->
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-btn-cancel-modal" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-bold transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" id="cf-btn-save-movement" class="btn-system-primary px-5 py-2 rounded-xl text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer">
                            Guardar Movimiento
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: Nueva Categoría -->
        <div id="cf-modal-category" class="hidden fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-tags text-[var(--system-primary)]"></i>
                        <span id="cf-modal-category-title">Nueva Categoría</span>
                    </h3>
                    <button type="button" id="cf-close-category-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-category" class="mt-4 space-y-3.5">
                    <input type="hidden" id="cf-cat-id">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre de la Categoría</label>
                        <input type="text" id="cf-cat-name" placeholder="Ej: Servicios Públicos, Nómina, Publicidad" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div id="cf-cat-type-container">
                        <label class="block text-xs font-bold text-gray-700 mb-1">Tipo</label>
                        <select id="cf-cat-type" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="EXPENSE">Gasto / Egreso</option>
                            <option value="INCOME">Ingreso / Entrada</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Descripción (Opcional)</label>
                        <input type="text" id="cf-cat-desc" placeholder="Breve descripción del fin de esta categoría" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-category-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Guardar Categoría</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Modales de Cuentas y Fondos -->
        ${getFundsModalsHTML()}

        <!-- Modales de CxP, CxC y Abonos -->
        ${getDebtsModalsHTML()}
    `;
}

/**
 * Escucha eventos generales de la vista y botones de pestañas
 */
function setupCashflowEvents() {
    // Sub-pestañas
    document.querySelectorAll('.cf-subtab-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const subtab = e.currentTarget.dataset.subtab;
            if (subtab === _currentSubTab) return;

            document.querySelectorAll('.cf-subtab-btn').forEach(b => {
                b.classList.remove('active');
            });
            e.currentTarget.classList.add('active');

            _currentSubTab = subtab;
            await loadCurrentSubTabData();
        });
    });

    // Modales: Cerrar con backdrop y botones para movimientos y categorías
    $('cf-close-modal-btn')?.addEventListener('click', () => $('cf-modal-movement')?.classList.add('hidden'));
    $('cf-btn-cancel-modal')?.addEventListener('click', () => $('cf-modal-movement')?.classList.add('hidden'));
    $('cf-close-category-modal')?.addEventListener('click', () => $('cf-modal-category')?.classList.add('hidden'));
    $('cf-cancel-category-btn')?.addEventListener('click', () => $('cf-modal-category')?.classList.add('hidden'));

    // Actualizar dinámicamente cuentas y categorías en el modal de nuevo movimiento
    document.querySelectorAll('input[name="movement_type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateMovementCategoriesDropdown();
        });
    });

    $('cf-input-method')?.addEventListener('change', () => {
        updateMovementAccountsDropdown();
    });

    // Quick add category from movement modal
    $('cf-btn-quick-category')?.addEventListener('click', () => {
        const type = document.querySelector('input[name="movement_type"]:checked')?.value || 'INCOME';
        openCategoryModal(null, type);
    });

    // Envío del formulario de Nuevo Movimiento
    $('cf-form-movement')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.querySelector('input[name="movement_type"]:checked')?.value || 'INCOME';
        const concept = $('cf-input-concept')?.value?.trim();
        const amount = parseFloat($('cf-input-amount')?.value);
        const payment_method = $('cf-input-method')?.value || 'Efectivo';
        const category_id = $('cf-input-category')?.value ? parseInt($('cf-input-category').value, 10) : null;
        const account_id = $('cf-input-account')?.value ? parseInt($('cf-input-account').value, 10) : null;
        const notes = $('cf-input-notes')?.value?.trim();

        if (!concept || isNaN(amount) || amount <= 0) {
            return toast('Por favor ingresa un concepto y monto válido', 'warning');
        }

        try {
            await createCashMovement({
                type,
                concept,
                payment_method,
                amount,
                category_id,
                account_id,
                notes
            });
            toast('Movimiento registrado con éxito', 'success');
            $('cf-modal-movement')?.classList.add('hidden');
            $('cf-form-movement')?.reset();
            await loadCurrentSubTabData();
        } catch (err) {
            console.error('Error al guardar movimiento:', err);
            toast('Error al registrar movimiento', 'error');
        }
    });

    // Formulario de Categoría
    $('cf-form-category')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('cf-cat-id')?.value;
        const name = $('cf-cat-name')?.value?.trim();
        const type = $('cf-cat-type')?.value;
        const description = $('cf-cat-desc')?.value?.trim();

        if (!name) return toast('El nombre de la categoría es obligatorio', 'warning');

        try {
            if (id) {
                await updateCategory(id, { name, description });
                toast('Categoría actualizada con éxito', 'success');
            } else {
                await createCategory({ name, type, description });
                toast('Categoría creada con éxito', 'success');
            }
            $('cf-modal-category')?.classList.add('hidden');
            await refreshCategoriesCache();
            if (_currentSubTab === 'categories') {
                await loadCategoriesTab();
            } else {
                updateMovementCategoriesDropdown();
            }
        } catch (err) {
            console.error('Error guardando categoría:', err);
            toast('Error al guardar categoría', 'error');
        }
    });

    // Listeners modulares de cuentas y deudas
    setupAccountsEvents();
    setupDebtsEvents();
}

/**
 * Carga la sub-pestaña seleccionada
 */
async function loadCurrentSubTabData() {
    syncSubNavButtons();
    await refreshAccountsCache();
    await refreshCategoriesCache();

    if (_currentSubTab === 'overview') {
        await loadOverviewTab();
    } else if (_currentSubTab === 'accounts') {
        await loadAccountsTab();
    } else if (_currentSubTab === 'payables') {
        await loadPayablesTab(_categoriesData);
    } else if (_currentSubTab === 'receivables') {
        await loadReceivablesTab(_categoriesData);
    } else if (_currentSubTab === 'categories') {
        await loadCategoriesTab();
    }
}

function syncSubNavButtons() {
    document.querySelectorAll('.cf-subtab-btn').forEach(b => {
        if (b.dataset.subtab === _currentSubTab) {
            b.className = 'cf-subtab-btn active px-3 py-1.5 rounded-lg transition-all shadow-sm flex items-center gap-1.5 whitespace-nowrap';
        } else {
            b.className = 'cf-subtab-btn px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap';
        }
    });
}

async function refreshCategoriesCache() {
    try {
        _categoriesData = await getCategories();
    } catch (e) {
        _categoriesData = [];
    }
}

// =============================================================================
// SUB-PESTAÑA 1: FLUJO GENERAL (OVERVIEW)
// =============================================================================
async function loadOverviewTab() {
    const area = $('cf-content-area');
    if (!area) return;

    area.innerHTML = `
        <!-- Filtros Rápidos de Fecha & Botón Nuevo Movimiento -->
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <!-- Periodos -->
            <div class="flex flex-wrap items-center gap-2">
                <div class="inline-flex bg-gray-100 p-1 rounded-xl text-xs gap-2 font-bold" id="cf-period-selector">
                    <button type="button" data-period="today" class="cf-period-btn px-3 py-1.5 rounded-lg transition-all">Hoy</button>
                    <button type="button" data-period="week" class="cf-period-btn px-3 py-1.5 rounded-lg transition-all">Esta Semana</button>
                    <button type="button" data-period="month" class="cf-period-btn px-3 py-1.5 rounded-lg transition-all active">Este Mes</button>
                    <button type="button" data-period="custom" class="cf-period-btn px-3 py-1.5 rounded-lg transition-all">Rango</button>
                </div>

                <!-- Custom Range Inputs -->
                <div id="cf-custom-range" class="${ _activePeriod === 'custom' ? '' : 'hidden' } flex items-center gap-2 text-xs">
                    <input type="date" id="cf-start-date" class="px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:border-orange-500 font-mono text-[11px]" value="${_customStartDate}">
                    <span class="text-gray-400">a</span>
                    <input type="date" id="cf-end-date" class="px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:border-orange-500 font-mono text-[11px]" value="${_customEndDate}">
                    <button type="button" id="cf-btn-apply-range" class="px-3 py-1.5 btn-system-primary rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer">
                        Filtrar
                    </button>
                </div>
            </div>

            <!-- Botón Acción Principal -->
            <div class="flex items-center gap-3">
                <button type="button" id="cf-btn-new-movement" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                    <i class="fas fa-plus"></i>
                    <span>Nuevo Movimiento</span>
                </button>
            </div>
        </div>

        <!-- 4 Tarjetas Métricas Principales (KPIs) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Ingresos Totales -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Ingresos Totales</span>
                    <span class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm">
                        <i class="fas fa-arrow-down"></i>
                    </span>
                </div>
                <div>
                    <div id="cf-kpi-incomes" class="text-2xl lg:text-3xl font-black text-emerald-600 font-mono">$0</div>
                    <p class="text-[11px] text-gray-400 mt-1" id="cf-kpi-incomes-sub">Manuales + Ventas</p>
                </div>
            </div>

            <!-- Egresos Totales -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Egresos / Gastos</span>
                    <span class="w-9 h-9 rounded-xl bg-red-50 text-red-500 flex items-center justify-center text-sm">
                        <i class="fas fa-arrow-up"></i>
                    </span>
                </div>
                <div>
                    <div id="cf-kpi-expenses" class="text-2xl lg:text-3xl font-black text-red-500 font-mono">$0</div>
                    <p class="text-[11px] text-gray-400 mt-1" id="cf-kpi-expenses-sub">Salidas registradas</p>
                </div>
            </div>

            <!-- Flujo Neto (Balance) -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Flujo Neto</span>
                    <span class="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-sm">
                        <i class="fas fa-scale-balanced"></i>
                    </span>
                </div>
                <div>
                    <div id="cf-kpi-net" class="text-2xl lg:text-3xl font-black text-gray-900 font-mono">$0</div>
                    <p class="text-[11px] text-gray-400 mt-1">Ingresos menos Egresos</p>
                </div>
            </div>

            <!-- Ventas Automáticas -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Ventas Cobradas</span>
                    <span class="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-sm">
                        <i class="fas fa-cash-register"></i>
                    </span>
                </div>
                <div>
                    <div id="cf-kpi-sales" class="text-2xl lg:text-3xl font-black text-blue-600 font-mono">$0</div>
                    <p class="text-[11px] text-gray-400 mt-1" id="cf-kpi-sales-sub">Cobradas por POS / Meseros</p>
                </div>
            </div>
        </div>

        <!-- Desglose por Método de Pago -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Efectivo -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                    <div class="flex items-center gap-2">
                        <span class="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
                            <i class="fas fa-money-bill-wave"></i>
                        </span>
                        <span class="text-sm font-bold text-gray-800">Caja Efectivo</span>
                    </div>
                    <span id="cf-cash-balance" class="text-sm font-black text-emerald-600 font-mono">$0</span>
                </div>
                <div class="space-y-1 text-xs">
                    <div class="flex justify-between text-gray-600">
                        <span>Ventas Cobradas:</span>
                        <span id="cf-cash-sales" class="font-semibold text-gray-800">$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Entradas Manuales:</span>
                        <span id="cf-cash-in" class="font-semibold text-emerald-600">+$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Gastos / Salidas:</span>
                        <span id="cf-cash-out" class="font-semibold text-red-500">-$0</span>
                    </div>
                </div>
            </div>

            <!-- Transferencias -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                    <div class="flex items-center gap-2">
                        <span class="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                            <i class="fas fa-building-columns"></i>
                        </span>
                        <span class="text-sm font-bold text-gray-800">Transferencias</span>
                    </div>
                    <span id="cf-transf-total" class="text-sm font-black text-blue-600 font-mono">$0</span>
                </div>
                <div class="space-y-1 text-xs">
                    <div class="flex justify-between text-gray-600">
                        <span>Ventas Cobradas:</span>
                        <span id="cf-transf-sales" class="font-semibold text-gray-800">$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Entradas Manuales:</span>
                        <span id="cf-transf-in" class="font-semibold text-emerald-600">+$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Gastos y Salidas:</span>
                        <span id="cf-transf-out" class="font-semibold text-red-500">-$0</span>
                    </div>
                </div>
            </div>

            <!-- Datáfono -->
            <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                    <div class="flex items-center gap-2">
                        <span class="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">
                            <i class="fas fa-credit-card"></i>
                        </span>
                        <span class="text-sm font-bold text-gray-800">Datáfono / Tarjetas</span>
                    </div>
                    <span id="cf-card-total" class="text-sm font-black text-purple-700 font-mono">$0</span>
                </div>
                <div class="space-y-1 text-xs">
                    <div class="flex justify-between text-gray-600">
                        <span>Ventas Cobradas:</span>
                        <span id="cf-card-sales" class="font-semibold text-gray-800">$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Entradas Manuales:</span>
                        <span id="cf-card-in" class="font-semibold text-emerald-600">+$0</span>
                    </div>
                    <div class="flex justify-between text-gray-600">
                        <span>Gastos y Salidas:</span>
                        <span id="cf-card-out" class="font-semibold text-red-500">-$0</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Tabla Unificada de Movimientos -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="p-5 border-b border-gray-100 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div>
                    <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                        <i class="fas fa-list-ul text-[var(--system-primary)]"></i>
                        Movimientos Consolidados del Período
                    </h3>
                    <p class="text-xs text-gray-400 mt-0.5" id="cf-period-subtitle">Cargando...</p>
                </div>

                <div class="flex items-center gap-2">
                    <label class="text-xs text-gray-500 font-medium">Método:</label>
                    <select id="cf-filter-method" class="bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-xl px-3 py-1.5 outline-none focus:border-orange-500">
                        <option value="all">Todos los Métodos</option>
                        <option value="Efectivo">Efectivo</option>
                        <option value="Transferencia">Transferencia</option>
                        <option value="Datáfono">Datáfono</option>
                    </select>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                            <th class="py-2.5 px-3 text-center">Fecha / Hora</th>
                            <th class="py-2.5 px-3 text-center">Tipo</th>
                            <th class="py-2.5 px-3">Categoría / Concepto</th>
                            <th class="py-2.5 px-3 text-center">Método & Fondo</th>
                            <th class="py-2.5 px-3 text-right font-mono">Monto</th>
                            <th class="py-2.5 px-3 text-center">Responsable / Notas</th>
                            <th class="py-2.5 px-3 text-center w-16">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="cf-transactions-body" class="divide-y divide-gray-50">
                        <tr>
                            <td colspan="7" class="text-center py-6 text-gray-400">
                                <i class="fas fa-spinner fa-spin mr-2"></i> Cargando movimientos de flujo monetarios...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div id="cf-pagination-container" class="border-t border-gray-100 px-4 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-500 bg-white"></div>
        </div>
    `;

    setupOverviewEvents();
    await fetchCashflowOverviewData();
}

function setupOverviewEvents() {
    document.querySelectorAll('.cf-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cf-period-btn').forEach(b => {
                b.classList.remove('active');
            });
            btn.classList.add('active');

            _activePeriod = btn.dataset.period;
            _cfCurrentPage = 1;
            const customRangeEl = $('cf-custom-range');
            if (_activePeriod === 'custom') {
                if (customRangeEl) customRangeEl.classList.remove('hidden');
            } else {
                if (customRangeEl) customRangeEl.classList.add('hidden');
                fetchCashflowOverviewData();
            }
        });
    });

    $('cf-btn-apply-range')?.addEventListener('click', () => {
        _customStartDate = $('cf-start-date')?.value;
        _customEndDate = $('cf-end-date')?.value;
        if (!_customStartDate || !_customEndDate) {
            return toast('Selecciona las fechas de inicio y fin', 'warning');
        }
        _cfCurrentPage = 1;
        fetchCashflowOverviewData();
    });

    $('cf-filter-method')?.addEventListener('change', (e) => {
        _paymentFilter = e.target.value;
        _cfCurrentPage = 1;
        renderTransactionsTable();
    });

    $('cf-btn-new-movement')?.addEventListener('click', () => {
        openMovementModal();
    });
}

/**
 * Consulta el backend con el rango de fechas activo
 */
async function fetchCashflowOverviewData() {
    let startDate = '', endDate = '';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (_activePeriod === 'today') {
        startDate = toYMD(now);
        endDate = toYMD(now);
    } else if (_activePeriod === 'week') {
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        startDate = toYMD(d);
        endDate = toYMD(now);
    } else if (_activePeriod === 'month') {
        startDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        endDate = toYMD(now);
    } else if (_activePeriod === 'custom' && _customStartDate && _customEndDate) {
        startDate = _customStartDate;
        endDate = _customEndDate;
    }

    try {
        const query = startDate && endDate ? { startDate, endDate } : {};
        _cashflowData = await getCashflow(query);

        const subEl = $('cf-period-subtitle');
        if (subEl) {
            subEl.textContent = startDate === endDate
                ? `Mostrando movimientos de hoy (${startDate})`
                : `Período: ${startDate} al ${endDate}`;
        }

        updateOverviewKPIs();
        renderTransactionsTable();
    } catch (e) {
        console.error('Error cargando flujo monetario:', e);
        toast('Error al consultar datos de flujo monetario', 'error');
    }
}

function updateOverviewKPIs() {
    if (!_cashflowData) return;
    const s = _cashflowData.summary || {};

    const inEl = $('cf-kpi-incomes');
    const outEl = $('cf-kpi-expenses');
    const netEl = $('cf-kpi-net');
    const salesEl = $('cf-kpi-sales');

    const totalIn = Number(s.total_incomes ?? s.total_income ?? 0);
    const totalOut = Number(s.total_expenses ?? s.total_expense ?? 0);
    const totalSales = Number(s.sales_total ?? s.automatic_sales ?? 0);

    if (inEl) inEl.textContent = formatMoney(totalIn);
    if (outEl) outEl.textContent = formatMoney(totalOut);

    const net = s.net_cashflow !== undefined ? Number(s.net_cashflow) : (totalIn - totalOut);
    if (netEl) {
        netEl.textContent = formatMoney(net);
        netEl.className = `text-2xl lg:text-3xl font-black font-mono ${net >= 0 ? 'text-gray-900' : 'text-red-600'}`;
    }

    if (salesEl) salesEl.textContent = formatMoney(totalSales);

    // Desglose por Método
    const pm = s.by_payment_method || {};
    const byP = s.by_payment || {};

    const getPmData = (key) => {
        const fromPm = pm[key] || {};
        const fromByP = byP[key] || {};
        return {
            incomes: fromPm.incomes ?? fromByP.income ?? 0,
            expenses: fromPm.expenses ?? fromByP.expense ?? 0,
            sales: fromPm.sales ?? fromByP.salesIncome ?? 0,
            manual_incomes: fromPm.manual_incomes ?? fromByP.manualIncome ?? 0,
            balance: fromPm.balance ?? fromByP.balance ?? fromByP.net ?? 0
        };
    };

    const cash = getPmData('Efectivo');
    const transf = getPmData('Transferencia');
    const card = getPmData('Datáfono');

    // Efectivo
    if ($('cf-cash-balance')) $('cf-cash-balance').textContent = formatMoney(cash.balance !== undefined ? cash.balance : (cash.incomes - cash.expenses));
    if ($('cf-cash-sales')) $('cf-cash-sales').textContent = formatMoney(cash.sales || 0);
    if ($('cf-cash-in')) $('cf-cash-in').textContent = '+' + formatMoney(cash.manual_incomes || 0);
    if ($('cf-cash-out')) $('cf-cash-out').textContent = '-' + formatMoney(cash.expenses || 0);

    // Transferencia
    if ($('cf-transf-total')) $('cf-transf-total').textContent = formatMoney(transf.balance !== undefined ? transf.balance : (transf.incomes - transf.expenses));
    if ($('cf-transf-sales')) $('cf-transf-sales').textContent = formatMoney(transf.sales || 0);
    if ($('cf-transf-in')) $('cf-transf-in').textContent = '+' + formatMoney(transf.manual_incomes || 0);
    if ($('cf-transf-out')) $('cf-transf-out').textContent = '-' + formatMoney(transf.expenses || 0);

    // Datáfono
    if ($('cf-card-total')) $('cf-card-total').textContent = formatMoney(card.balance !== undefined ? card.balance : (card.incomes - card.expenses));
    if ($('cf-card-sales')) $('cf-card-sales').textContent = formatMoney(card.sales || 0);
    if ($('cf-card-in')) $('cf-card-in').textContent = '+' + formatMoney(card.manual_incomes || 0);
    if ($('cf-card-out')) $('cf-card-out').textContent = '-' + formatMoney(card.expenses || 0);
}

function renderTransactionsTable() {
    const tbody = $('cf-transactions-body');
    const paginationContainer = $('cf-pagination-container');
    if (!tbody || !_cashflowData) return;

    let items = _cashflowData.transactions || _cashflowData.movements || [];

    // Fallback: unificar pedidos por día y método si vinieran desagrupados
    const groupedItems = [];
    const ordersByDayAndMethod = new Map();

    items.forEach(t => {
        const isIndividualOrder = t.source === 'Pedido Cobrado' && !String(t.id).startsWith('ventas-');
        if (isIndividualOrder) {
            let dayStr = '';
            try {
                const raw = t.timestamp || t.date || '';
                const dt = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
                const bogotaMs = dt.getTime() - 5 * 3600000;
                dayStr = new Date(bogotaMs).toISOString().split('T')[0];
            } catch (e) {
                dayStr = (t.timestamp || t.date || '').substring(0, 10);
            }
            const pm = t.payment_method || 'Efectivo';
            const key = `${dayStr}___${pm}`;

            if (!ordersByDayAndMethod.has(key)) {
                ordersByDayAndMethod.set(key, {
                    id: `ventas-${dayStr}-${pm}`,
                    type: 'INCOME',
                    category: 'Ventas del Día',
                    category_name: 'Ventas del Día',
                    source: 'Pedido Cobrado',
                    created_by: 'Sistema',
                    payment_method: pm,
                    account_name: t.account_name,
                    amount: 0,
                    orderCount: 0,
                    timestamp: t.timestamp || t.date,
                    date: t.date || t.timestamp,
                    orderIds: [],
                    isManual: false
                });
            }
            const grp = ordersByDayAndMethod.get(key);
            grp.amount += (Number(t.amount) || 0);
            grp.orderCount += 1;
            grp.orderIds.push(t.id);
            if (new Date(t.timestamp || t.date) > new Date(grp.timestamp)) {
                grp.timestamp = t.timestamp || t.date;
                grp.date = t.date || t.timestamp;
            }
        } else {
            groupedItems.push(t);
        }
    });

    if (ordersByDayAndMethod.size > 0) {
        ordersByDayAndMethod.forEach(g => {
            const isSingle = g.orderCount === 1;
            const ordersSummary = g.orderIds.length <= 4
                ? g.orderIds.map(id => `#${id}`).join(', ')
                : `${g.orderIds.slice(0, 3).map(id => `#${id}`).join(', ')} y ${g.orderIds.length - 3} más`;
            g.concept = `Ventas del Día (${g.orderCount} ${isSingle ? 'pedido' : 'pedidos'})`;
            g.notes = `${g.orderCount} ${isSingle ? 'pedido completado' : 'pedidos completados'} (${ordersSummary})`;
            groupedItems.push(g);
        });
        groupedItems.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
        items = groupedItems;
    }

    if (_paymentFilter !== 'all') {
        items = items.filter(t => t.payment_method === _paymentFilter);
    }

    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / CF_PAGE_SIZE));
    if (_cfCurrentPage > totalPages) _cfCurrentPage = totalPages;
    if (_cfCurrentPage < 1) _cfCurrentPage = 1;

    if (totalItems === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-6 text-gray-400 font-medium text-xs">
                    No se encontraron transacciones en el período o método seleccionado.
                </td>
            </tr>
        `;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const startIdx = (_cfCurrentPage - 1) * CF_PAGE_SIZE;
    const endIdx = Math.min(startIdx + CF_PAGE_SIZE, totalItems);
    const pagedItems = items.slice(startIdx, endIdx);

    tbody.innerHTML = pagedItems.map(tx => {
        const isIncome = tx.type === 'INCOME';
        const typeBadge = isIncome
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Ingreso</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Egreso</span>';

        const amountColor = isIncome ? 'text-emerald-600 font-bold' : 'text-red-500 font-bold';
        const sign = isIncome ? '+' : '-';

        let pmBadgeClass = 'bg-gray-100 text-gray-700';
        if (tx.payment_method === 'Efectivo') pmBadgeClass = 'bg-emerald-50 text-emerald-700';
        else if (tx.payment_method === 'Transferencia') pmBadgeClass = 'bg-blue-50 text-blue-700';
        else if (tx.payment_method === 'Datáfono') pmBadgeClass = 'bg-purple-50 text-purple-700';

        const isManualMovement = tx.isManual === true || (tx.id && !String(tx.id).startsWith('ventas-') && !String(tx.id).startsWith('order-') && !String(tx.id).startsWith('PG') && !String(tx.id).startsWith('PL') && !String(tx.id).startsWith('gasto-'));
        const dateVal = tx.date || tx.timestamp;
        const catName = tx.category_name || tx.category || (isIncome ? 'Venta / Operacional' : 'Gasto General');
        const author = tx.created_by || tx.source || (tx.user_name || 'Sistema');

        return `
            <tr class="hover:bg-gray-50/70 transition-colors">
                <td class="py-2 px-3 text-center font-mono text-[11px] text-gray-500">${formatDateTime(dateVal)}</td>
                <td class="py-2 px-3 text-center">${typeBadge}</td>
                <td class="py-2 px-3">
                    <div class="font-bold text-gray-900 text-xs leading-snug">${escapeHtml(tx.concept || 'Sin concepto')}</div>
                    <div class="text-[10px] text-gray-400 leading-tight">${escapeHtml(catName)}</div>
                </td>
                <td class="py-2 px-3 text-center">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${pmBadgeClass}">
                        ${escapeHtml(tx.payment_method || 'Efectivo')}
                    </span>
                    ${tx.account_name ? `<div class="text-[9px] text-gray-400 mt-0.5 leading-none">${escapeHtml(tx.account_name)}</div>` : ''}
                </td>
                <td class="py-2 px-3 text-right font-mono text-xs ${amountColor}">
                    ${sign}${formatMoney(tx.amount)}
                </td>
                <td class="py-2 px-3 text-center">
                    <div class="text-xs text-gray-700 leading-tight">${escapeHtml(author)}</div>
                    ${tx.notes ? `<div class="text-[9px] text-gray-400 truncate max-w-xs mx-auto leading-tight" title="${escapeHtml(tx.notes)}">${escapeHtml(tx.notes)}</div>` : ''}
                </td>
                <td class="py-2 px-3 text-center">
                    ${isManualMovement ? `
                        <button type="button" class="w-6 h-6 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 inline-flex items-center justify-center transition-colors" title="Eliminar Movimiento" onclick="window._deleteCashMovement('${tx.id}')">
                            <i class="fas fa-trash-alt text-[11px]"></i>
                        </button>
                    ` : '<span class="text-gray-300">-</span>'}
                </td>
            </tr>
        `;
    }).join('');

    // Controles de paginación
    if (paginationContainer) {
        paginationContainer.innerHTML = `
            <div class="text-xs text-gray-500">
                Mostrando <span class="font-bold text-gray-800">${startIdx + 1}</span> a <span class="font-bold text-gray-800">${endIdx}</span> de <span class="font-bold text-gray-800">${totalItems}</span> movimientos
            </div>
            <div class="flex items-center gap-1.5">
                <button type="button" id="cf-page-prev" 
                    class="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium transition-colors ${ _cfCurrentPage <= 1 ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400' : 'bg-white hover:bg-gray-100 text-gray-700 cursor-pointer shadow-xs active:scale-95' }"
                    ${ _cfCurrentPage <= 1 ? 'disabled' : '' }>
                    <i class="fas fa-chevron-left mr-1"></i> Anterior
                </button>
                <span class="px-2.5 py-1 text-xs font-bold text-gray-700 bg-gray-100 rounded-lg">
                    ${_cfCurrentPage} / ${totalPages}
                </span>
                <button type="button" id="cf-page-next" 
                    class="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium transition-colors ${ _cfCurrentPage >= totalPages ? 'opacity-40 cursor-not-allowed bg-gray-50 text-gray-400' : 'bg-white hover:bg-gray-100 text-gray-700 cursor-pointer shadow-xs active:scale-95' }"
                    ${ _cfCurrentPage >= totalPages ? 'disabled' : '' }>
                    Siguiente <i class="fas fa-chevron-right ml-1"></i>
                </button>
            </div>
        `;

        $('cf-page-prev')?.addEventListener('click', () => {
            if (_cfCurrentPage > 1) {
                _cfCurrentPage--;
                renderTransactionsTable();
            }
        });
        $('cf-page-next')?.addEventListener('click', () => {
            if (_cfCurrentPage < totalPages) {
                _cfCurrentPage++;
                renderTransactionsTable();
            }
        });
    }
}

// =============================================================================
// SUB-PESTAÑA 5: CATEGORÍAS
// =============================================================================
async function loadCategoriesTab() {
    const area = $('cf-content-area');
    if (!area) return;

    await refreshCategoriesCache();

    const incomes = _categoriesData.filter(c => c.type === 'INCOME');
    const expenses = _categoriesData.filter(c => c.type === 'EXPENSE');

    area.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div>
                <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                    <i class="fas fa-tags text-[var(--system-primary)]"></i>
                    Categorías de Ingresos y Egresos
                </h3>
                <p class="text-xs text-gray-400">Organiza tus conceptos contables y centros de costo</p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="cf-btn-new-category" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                    <i class="fas fa-plus"></i>
                    <span>Nueva Categoría</span>
                </button>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Categorías de Ingresos -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="p-4 bg-emerald-50/60 border-b border-gray-100 flex items-center justify-between">
                    <h4 class="font-bold text-sm text-emerald-800 flex items-center gap-2">
                        <i class="fas fa-arrow-down text-emerald-600"></i>
                        Categorías de Ingreso (${incomes.length})
                    </h4>
                </div>
                <div class="divide-y divide-gray-50">
                    ${incomes.length === 0 ? '<div class="p-5 text-center text-xs text-gray-400">No hay categorías de ingreso registradas.</div>' : incomes.map(c => `
                        <div class="p-4 flex items-center justify-between hover:bg-gray-50/80 transition-colors">
                            <div>
                                <h5 class="font-bold text-xs text-gray-900">${escapeHtml(c.name)}</h5>
                                ${c.description ? `<p class="text-[11px] text-gray-400 mt-0.5">${escapeHtml(c.description)}</p>` : ''}
                            </div>
                            <div class="flex items-center gap-1">
                                <button type="button" class="w-7 h-7 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center transition-colors" onclick="window._editFinanceCategory(${c.id}, '${escapeHtml(c.name)}', '${escapeHtml(c.description || '')}')">
                                    <i class="fas fa-pen text-xs"></i>
                                </button>
                                <button type="button" class="w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors" onclick="window._deleteFinanceCategory(${c.id})">
                                    <i class="fas fa-trash-alt text-xs"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Categorías de Egresos / Gastos -->
            <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="p-4 bg-red-50/60 border-b border-gray-100 flex items-center justify-between">
                    <h4 class="font-bold text-sm text-red-800 flex items-center gap-2">
                        <i class="fas fa-arrow-up text-red-600"></i>
                        Categorías de Egreso / Gasto (${expenses.length})
                    </h4>
                </div>
                <div class="divide-y divide-gray-50">
                    ${expenses.length === 0 ? '<div class="p-5 text-center text-xs text-gray-400">No hay categorías de egreso registradas.</div>' : expenses.map(c => `
                        <div class="p-4 flex items-center justify-between hover:bg-gray-50/80 transition-colors">
                            <div>
                                <h5 class="font-bold text-xs text-gray-900">${escapeHtml(c.name)}</h5>
                                ${c.description ? `<p class="text-[11px] text-gray-400 mt-0.5">${escapeHtml(c.description)}</p>` : ''}
                            </div>
                            <div class="flex items-center gap-1">
                                <button type="button" class="w-7 h-7 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center transition-colors" onclick="window._editFinanceCategory(${c.id}, '${escapeHtml(c.name)}', '${escapeHtml(c.description || '')}')">
                                    <i class="fas fa-pen text-xs"></i>
                                </button>
                                <button type="button" class="w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors" onclick="window._deleteFinanceCategory(${c.id})">
                                    <i class="fas fa-trash-alt text-xs"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    $('cf-btn-new-category')?.addEventListener('click', () => openCategoryModal());
}

// =============================================================================
// MODALES HELPERS Y APERTURAS
// =============================================================================
function openMovementModal() {
    $('cf-form-movement')?.reset();
    updateMovementCategoriesDropdown();
    updateMovementAccountsDropdown();
    $('cf-modal-movement')?.classList.remove('hidden');
    $('cf-input-concept')?.focus();
}

function updateMovementCategoriesDropdown() {
    const sel = $('cf-input-category');
    if (!sel) return;
    const type = document.querySelector('input[name="movement_type"]:checked')?.value || 'INCOME';
    const filtered = _categoriesData.filter(c => c.type === type);

    sel.innerHTML = '<option value="">Selecciona una categoría...</option>' + filtered.map(c => `
        <option value="${c.id}">${escapeHtml(c.name)}</option>
    `).join('');
}

function openCategoryModal(catId = null, preselectedType = 'INCOME') {
    $('cf-form-category')?.reset();
    if ($('cf-cat-id')) $('cf-cat-id').value = catId || '';

    const typeContainer = $('cf-cat-type-container');
    if (catId) {
        if (typeContainer) typeContainer.style.display = 'none';
        if ($('cf-modal-category-title')) $('cf-modal-category-title').textContent = 'Editar Categoría';
    } else {
        if (typeContainer) typeContainer.style.display = 'block';
        if ($('cf-cat-type')) $('cf-cat-type').value = preselectedType;
        if ($('cf-modal-category-title')) $('cf-modal-category-title').textContent = 'Nueva Categoría';
    }

    $('cf-modal-category')?.classList.remove('hidden');
    $('cf-cat-name')?.focus();
}

// =============================================================================
// WINDOW GLOBALS PARA ACCIONES DE TABLAS
// =============================================================================
window._editFinanceCategory = (id, name, desc) => {
    openCategoryModal(id);
    if ($('cf-cat-name')) $('cf-cat-name').value = name;
    if ($('cf-cat-desc')) $('cf-cat-desc').value = desc;
};

window._deleteFinanceCategory = (id) => {
    showConfirmModal(
        'Eliminar Categoría',
        '¿Deseas eliminar esta categoría? Solo se puede eliminar si no tiene movimientos ni registros vinculados.',
        async () => {
            try {
                const res = await deleteCategory(id);
                toast(res?.message || 'Categoría eliminada con éxito', 'success');
                await loadCategoriesTab();
            } catch (err) {
                toast(err.message || 'No se puede eliminar la categoría porque tiene movimientos asociados', 'error');
            }
        },
        null,
        'Eliminar'
    );
};

window._deleteCashMovement = (id) => {
    showConfirmModal(
        'Eliminar Movimiento',
        '¿Deseas eliminar este movimiento manual de caja?',
        async () => {
            try {
                await deleteCashMovement(id);
                toast('Movimiento eliminado', 'info');
                await fetchCashflowOverviewData();
            } catch (err) {
                toast('Error al eliminar movimiento', 'error');
            }
        },
        null,
        'Eliminar'
    );
};

window._reloadCashflowData = () => {
    const cfPanel = $('panel-flujocaja');
    if (!cfPanel || cfPanel.classList.contains('hidden')) return;
    if (_currentSubTab === 'overview') fetchCashflowOverviewData();
    else if (_currentSubTab === 'accounts') loadAccountsTab();
    else if (_currentSubTab === 'payables') loadPayablesTab(_categoriesData);
    else if (_currentSubTab === 'receivables') loadReceivablesTab(_categoriesData);
    else if (_currentSubTab === 'categories') loadCategoriesTab();
};

function formatDateTime(dtStr) {
    if (!dtStr) return '-';
    try {
        const cleanStr = String(dtStr).includes('T') ? String(dtStr) : (String(dtStr).replace(' ', 'T') + (String(dtStr).endsWith('Z') ? '' : 'Z'));
        const d = new Date(cleanStr);
        if (isNaN(d.getTime())) return dtStr;
        return d.toLocaleDateString('es-CO', {
            timeZone: 'America/Bogota',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dtStr;
    }
}

window.renderAdminCashflowPage = renderAdminCashflowPage;
