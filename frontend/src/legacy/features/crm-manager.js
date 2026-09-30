/**
 * DigiRest - Mini CRM Manager Feature
 * Handles Customer Directory, Metrics/KPIs, Customer Profile & Order History.
 */

import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, showConfirmModal } from '../components/ui.js';
import {
    getCustomers,
    getCustomerStats,
    getCustomerProfile,
    updateCustomer,
    syncCustomers,
    listenToCustomers
} from '../services/crm-service.js';

let _initialized = false;
let _currentFilter = 'all';
let _activeCustomerProfile = null;
let _currentCustomerOrders = [];
let _customerOrdersPage = 1;
const CUSTOMER_ORDERS_PAGE_SIZE = 15;
let _crmTablePage = 1;
const CRM_TABLE_PAGE_SIZE = 15;

/**
 * Initialize CRM feature listeners and socket sync
 */
export function initCrmManager() {
    if (_initialized) return;
    const role = (window.state?.user?.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'cajero') return;
    _initialized = true;

    // Search and Filters
    const searchInput = $('crm-search');
    if (searchInput) {
        let debounceTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            _crmTablePage = 1;
            debounceTimer = setTimeout(() => renderCustomersTable(), 250);
        });
    }

    const sortSelect = $('crm-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            _crmTablePage = 1;
            renderCustomersTable();
        });
    }

    // Filter Chips
    const filterBtns = document.querySelectorAll('.crm-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => {
                b.classList.remove('bg-gray-900', 'text-white', 'shadow-xs');
                b.classList.add('bg-white', 'text-gray-600', 'border', 'border-gray-200');
            });
            btn.classList.add('bg-gray-900', 'text-white', 'shadow-xs');
            btn.classList.remove('bg-white', 'text-gray-600', 'border', 'border-gray-200');

            _currentFilter = btn.dataset.filter || 'all';
            _crmTablePage = 1;
            renderCustomersTable();
        });
    });

    // Re-sync CRM from orders button
    const btnSync = $('btn-sync-crm');
    if (btnSync) {
        btnSync.addEventListener('click', handleSyncCrm);
    }

    // Customer Profile Modal Events
    $('btn-close-customer-profile')?.addEventListener('click', closeCustomerProfileModal);
    $('form-customer-notes')?.addEventListener('submit', handleSaveCustomerNotes);

    // Real-time sync via WebSockets
    listenToCustomers((data) => {
        if (data.customers) state.customers = data.customers;
        if (data.stats) state.customerStats = data.stats;
        updateCrmKpis();
        renderCustomersTable();
    });
}

/**
 * Load CRM data and render panel
 */
export async function loadCrmPage() {
    try {
        const [customers, stats] = await Promise.all([
            getCustomers(),
            getCustomerStats()
        ]);

        state.customers = customers || [];
        state.customerStats = stats || {};

        updateCrmKpis();
        renderCustomersTable();
    } catch (err) {
        console.error("Error al cargar módulo CRM:", err);
        toast("Error al cargar clientes CRM", "error");
    }
}

/**
 * Update CRM KPI summary cards
 */
function updateCrmKpis() {
    const stats = state.customerStats || {};
    const totalEl = $('crm-kpi-total');
    const freqEl = $('crm-kpi-frequent');
    const inactEl = $('crm-kpi-inactive');
    const avgEl = $('crm-kpi-avg');

    if (totalEl) totalEl.textContent = (stats.totalCustomers || 0).toLocaleString();
    if (freqEl) freqEl.textContent = (stats.frequentCustomers || 0).toLocaleString();
    if (inactEl) inactEl.textContent = (stats.inactiveCustomers || 0).toLocaleString();
    if (avgEl) avgEl.textContent = formatMoney(stats.avgSpent || 0);
}

/**
 * Render Customers Table based on search, filter, and sort
 */
export function renderCustomersTable() {
    const tbody = $('admin-crm-body');
    const emptyState = $('crm-empty-state');
    if (!tbody) return;

    const searchTerm = ($('crm-search')?.value || '').toLowerCase().trim();
    const sortVal = $('crm-sort')?.value || 'last_order';
    let list = [...(state.customers || [])];

    // Filter
    if (_currentFilter === 'frequent') {
        list = list.filter(c => c.total_orders >= 3);
    } else if (_currentFilter === 'inactive') {
        list = list.filter(c => c.days_since_last_order !== null && c.days_since_last_order >= 15);
    } else if (_currentFilter === 'new') {
        list = list.filter(c => c.total_orders === 1);
    }

    // Search
    if (searchTerm) {
        list = list.filter(c => {
            const name = (c.name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const address = (c.address || '').toLowerCase();
            const zone = (c.delivery_zone || '').toLowerCase();
            const notes = (c.notes || '').toLowerCase();
            return name.includes(searchTerm) || phone.includes(searchTerm) || address.includes(searchTerm) || zone.includes(searchTerm) || notes.includes(searchTerm);
        });
    }

    // Sort
    if (sortVal === 'orders') {
        list.sort((a, b) => (b.total_orders || 0) - (a.total_orders || 0));
    } else if (sortVal === 'spent') {
        list.sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0));
    } else if (sortVal === 'name') {
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
        list.sort((a, b) => new Date(b.last_order_at || 0) - new Date(a.last_order_at || 0));
    }

    const crmPag = $('crm-table-pagination');

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        if (crmPag) crmPag.innerHTML = '';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const totalCustomers = list.length;
    const totalPages = Math.ceil(totalCustomers / CRM_TABLE_PAGE_SIZE) || 1;
    if (_crmTablePage < 1) _crmTablePage = 1;
    if (_crmTablePage > totalPages) _crmTablePage = totalPages;

    const start = (_crmTablePage - 1) * CRM_TABLE_PAGE_SIZE;
    const end = Math.min(start + CRM_TABLE_PAGE_SIZE, totalCustomers);
    const paginatedList = list.slice(start, end);

    tbody.innerHTML = paginatedList.map(c => {
        const isVip = (c.total_orders || 0) >= 3;
        const isInactive = c.days_since_last_order !== null && c.days_since_last_order >= 15;
        const isNew = c.total_orders === 1;

        let badgeHtml = '';
        if (isVip) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-800 border border-amber-200/80"><i class="fas fa-crown text-[8px] text-amber-500"></i> Frecuente (VIP)</span>`;
        } else if (isInactive) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200/80"><i class="fas fa-clock text-[8px]"></i> Inactivo (+15d)</span>`;
        } else if (isNew) {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80"><i class="fas fa-star text-[8px] text-blue-500"></i> Nuevo</span>`;
        } else {
            badgeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-700 border border-gray-200">Regular</span>`;
        }

        const formattedLastOrder = c.last_order_at 
            ? new Date(c.last_order_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'Sin registro';

        const daysText = c.days_since_last_order !== null && c.days_since_last_order !== undefined
            ? (c.days_since_last_order === 0 ? 'Hoy' : `Hace ${c.days_since_last_order} día${c.days_since_last_order === 1 ? '' : 's'}`)
            : '';

        const locationText = c.delivery_zone 
            ? `<div class="text-[10px] text-orange-600 font-semibold truncate max-w-[160px]"><i class="fas fa-map-marker-alt text-[9px] mr-1"></i>${escapeHtml(c.delivery_zone)}</div>`
            : (c.address && c.address !== 'N/A' ? `<div class="text-[10px] text-gray-500 truncate max-w-[160px]">${escapeHtml(c.address)}</div>` : '<div class="text-[10px] text-gray-400 italic">Sin dirección</div>');

        return `
            <tr class="hover:bg-gray-50/80 transition-colors border-b border-gray-100 last:border-0" data-phone="${c.phone}">
                <td class="py-1.5 px-3">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-lg ${isVip ? 'bg-amber-100 text-amber-700 border border-amber-300/60' : 'bg-orange-50 text-orange-600 border border-orange-200/60'} flex items-center justify-center font-bold text-[10px] shrink-0 shadow-xs">
                            ${c.name ? c.name.charAt(0).toUpperCase() : 'C'}
                        </div>
                        <div class="min-w-0">
                            <div class="font-bold text-gray-900 text-xs truncate max-w-[170px]">
                                ${escapeHtml(c.name || 'Cliente')}
                            </div>
                            <div class="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                                <a href="https://wa.me/+57${c.phone}" target="_blank" class="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 font-semibold" title="Abrir chat de WhatsApp">
                                    <i class="fab fa-whatsapp"></i> ${c.phone}
                                </a>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="py-1.5 px-3">
                    ${badgeHtml}
                </td>
                <td class="py-1.5 px-3">
                    ${locationText}
                    ${c.notes ? `<div class="text-[9px] text-gray-400 italic truncate max-w-[150px] mt-0.5"><i class="fas fa-sticky-note mr-1 text-[8px]"></i>${escapeHtml(c.notes)}</div>` : ''}
                </td>
                <td class="py-1.5 px-3 text-center">
                    <div class="text-xs font-black text-gray-800">${c.total_orders || 0}</div>
                    <div class="text-[8px] text-gray-400 uppercase font-semibold">Pedidos</div>
                </td>
                <td class="py-1.5 px-3 text-right">
                    <div class="text-xs font-black text-gray-900">${formatMoney(c.total_spent || 0)}</div>
                    <div class="text-[8px] text-gray-400">Total gastado</div>
                </td>
                <td class="py-1.5 px-3">
                    <div class="text-xs font-semibold text-gray-700">${formattedLastOrder}</div>
                    <div class="text-[10px] text-gray-400 font-medium">${daysText}</div>
                </td>
                <td class="py-1.5 px-3 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" class="btn-view-customer-profile px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1 cursor-pointer shadow-2xs" data-phone="${c.phone}" title="Ver Perfil e Historial">
                            <i class="fas fa-user-circle"></i>
                            <span>Perfil</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Pagination for legacy table if container exists
    if (crmPag) {
        if (totalCustomers <= CRM_TABLE_PAGE_SIZE) {
            crmPag.innerHTML = '';
        } else {
            crmPag.innerHTML = `
                <div class="flex items-center justify-between text-xs text-gray-500 py-2">
                    <span>Mostrando ${start + 1} a ${end} de ${totalCustomers} clientes</span>
                    <div class="flex items-center gap-1.5">
                        <button type="button" class="btn-crm-prev px-2.5 py-1 rounded-lg border border-gray-200 font-bold hover:bg-gray-50 disabled:opacity-40" ${_crmTablePage <= 1 ? 'disabled' : ''}>Anterior</button>
                        <span class="px-2.5 py-1 rounded-lg bg-gray-50 font-bold border border-gray-200 text-gray-700">${_crmTablePage} / ${totalPages}</span>
                        <button type="button" class="btn-crm-next px-2.5 py-1 rounded-lg border border-gray-200 font-bold hover:bg-gray-50 disabled:opacity-40" ${_crmTablePage >= totalPages ? 'disabled' : ''}>Siguiente</button>
                    </div>
                </div>
            `;
            crmPag.querySelector('.btn-crm-prev')?.addEventListener('click', () => {
                if (_crmTablePage > 1) { _crmTablePage--; renderCustomersTable(); }
            });
            crmPag.querySelector('.btn-crm-next')?.addEventListener('click', () => {
                if (_crmTablePage < totalPages) { _crmTablePage++; renderCustomersTable(); }
            });
        }
    }

    // Wire buttons
    tbody.querySelectorAll('.btn-view-customer-profile').forEach(btn => {
        btn.addEventListener('click', () => openCustomerProfileModal(btn.dataset.phone));
    });
}

/**
 * Handle re-synchronizing CRM from past orders
 */
async function handleSyncCrm() {
    const btn = $('btn-sync-crm');
    if (btn) btn.disabled = true;

    try {
        toast("Sincronizando clientes con el historial de pedidos...", "info");
        await syncCustomers();
        await loadCrmPage();
        toast("Clientes sincronizados correctamente", "success");
    } catch (err) {
        console.error("Error al sincronizar clientes:", err);
        toast("Error al sincronizar clientes", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

/**
 * Render paginated Customer Orders list in Profile Modal
 * strictly single-row: ID Pedido, Tipo de Pedido, Medio de Pago, Total
 */
function renderCustomerOrdersList() {
    const listEl = $('cp-orders-list');
    const pagEl = $('cp-orders-pagination');
    if (!listEl) return;

    if (!_currentCustomerOrders || _currentCustomerOrders.length === 0) {
        listEl.innerHTML = '<div class="text-center py-8 text-gray-400 text-xs">No hay pedidos registrados para este cliente.</div>';
        if (pagEl) pagEl.innerHTML = '';
        return;
    }

    const total = _currentCustomerOrders.length;
    const totalPages = Math.ceil(total / CUSTOMER_ORDERS_PAGE_SIZE) || 1;
    if (_customerOrdersPage < 1) _customerOrdersPage = 1;
    if (_customerOrdersPage > totalPages) _customerOrdersPage = totalPages;

    const start = (_customerOrdersPage - 1) * CUSTOMER_ORDERS_PAGE_SIZE;
    const end = Math.min(start + CUSTOMER_ORDERS_PAGE_SIZE, total);
    const pageOrders = _currentCustomerOrders.slice(start, end);

    listEl.innerHTML = `
        <div class="overflow-x-auto rounded-2xl border border-gray-100 shadow-2xs">
            <table class="w-full text-left border-collapse text-xs">
                <thead>
                    <tr class="bg-gray-50/90 border-b border-gray-100 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                        <th class="py-2.5 px-3">ID Pedido</th>
                        <th class="py-2.5 px-3">Tipo de Pedido</th>
                        <th class="py-2.5 px-3">Medio de Pago</th>
                        <th class="py-2.5 px-3 text-right">Total</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white">
                    ${pageOrders.map(o => {
                        const rawType = (o.type || 'Domicilio').trim();
                        const isDelivery = rawType.toLowerCase().includes('domicilio');
                        const payment = (o.payment || 'Efectivo').trim();
                        const totalFormatted = formatMoney(o.total || 0);

                        return `
                            <tr class="hover:bg-gray-50/80 transition-colors">
                                <td class="py-2.5 px-3 whitespace-nowrap font-black text-gray-900 text-xs">
                                    #${escapeHtml(String(o.id || ''))}
                                </td>
                                <td class="py-2.5 px-3 whitespace-nowrap">
                                    <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                                        isDelivery 
                                            ? 'bg-orange-50 text-orange-700 border border-orange-200/60' 
                                            : 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                    }">
                                        <i class="${isDelivery ? 'fas fa-motorcycle' : 'fas fa-utensils'} text-[9px]"></i>
                                        ${escapeHtml(rawType)}
                                    </span>
                                </td>
                                <td class="py-2.5 px-3 whitespace-nowrap text-gray-700 font-medium">
                                    <span class="inline-flex items-center gap-1.5 text-[11px]">
                                        <i class="far fa-credit-card text-gray-400 text-[10px]"></i>
                                        ${escapeHtml(payment)}
                                    </span>
                                </td>
                                <td class="py-2.5 px-3 whitespace-nowrap text-right font-black text-gray-900 text-xs">
                                    ${totalFormatted}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (pagEl) {
        if (total <= CUSTOMER_ORDERS_PAGE_SIZE) {
            pagEl.innerHTML = `
                <div class="flex items-center justify-between text-[11px] text-gray-400 px-1 pt-1">
                    <span>${total} pedido${total === 1 ? '' : 's'} registrado${total === 1 ? '' : 's'}</span>
                    <span class="font-medium">Página 1 de 1</span>
                </div>
            `;
        } else {
            pagEl.innerHTML = `
                <div class="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs text-gray-600">
                    <div class="text-[11px] font-medium text-gray-500">
                        Mostrando <span class="font-bold text-gray-900">${start + 1}</span> - <span class="font-bold text-gray-900">${end}</span> de <span class="font-bold text-gray-900">${total}</span> pedidos
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" class="btn-cp-orders-prev px-2.5 py-1 rounded-lg border border-gray-200 font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 active:scale-95 text-gray-700 cursor-pointer text-xs" ${_customerOrdersPage <= 1 ? 'disabled' : ''}>
                            <i class="fas fa-chevron-left text-[9px]"></i> Anterior
                        </button>
                        <span class="px-2.5 py-1 rounded-lg bg-gray-50 text-gray-700 font-bold border border-gray-200 text-[11px]">
                            ${_customerOrdersPage} / ${totalPages}
                        </span>
                        <button type="button" class="btn-cp-orders-next px-2.5 py-1 rounded-lg border border-gray-200 font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 active:scale-95 text-gray-700 cursor-pointer text-xs" ${_customerOrdersPage >= totalPages ? 'disabled' : ''}>
                            Siguiente <i class="fas fa-chevron-right text-[9px]"></i>
                        </button>
                    </div>
                </div>
            `;

            pagEl.querySelector('.btn-cp-orders-prev')?.addEventListener('click', () => {
                if (_customerOrdersPage > 1) {
                    _customerOrdersPage--;
                    renderCustomerOrdersList();
                }
            });

            pagEl.querySelector('.btn-cp-orders-next')?.addEventListener('click', () => {
                if (_customerOrdersPage < totalPages) {
                    _customerOrdersPage++;
                    renderCustomerOrdersList();
                }
            });
        }
    }
}

/**
 * Open Customer Profile Modal with complete order history
 */
export async function openCustomerProfileModal(phone) {
    const modal = $('customer-profile-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    $('cp-name').textContent = 'Cargando...';
    $('cp-phone').textContent = phone;
    $('cp-orders-list').innerHTML = '<div class="text-center py-8 text-gray-400 text-xs"><i class="fas fa-spinner fa-spin text-xl mb-2"></i><br>Cargando historial de pedidos...</div>';
    const pagEl = $('cp-orders-pagination');
    if (pagEl) pagEl.innerHTML = '';

    try {
        const data = await getCustomerProfile(phone);
        const customer = data.customer;
        const orders = data.orders || [];
        _activeCustomerProfile = customer;

        $('cp-name').textContent = customer.name || 'Cliente';
        $('cp-phone').textContent = customer.phone;
        $('cp-total-orders').textContent = customer.total_orders || 0;
        $('cp-total-spent').textContent = formatMoney(customer.total_spent || 0);

        const daysText = customer.days_since_last_order !== null && customer.days_since_last_order !== undefined
            ? `${customer.days_since_last_order} día${customer.days_since_last_order === 1 ? '' : 's'}`
            : '--';
        $('cp-last-order-days').textContent = daysText;

        // Form fields
        $('cp-input-phone').value = customer.phone;
        $('cp-input-name').value = customer.name || '';
        $('cp-input-address').value = customer.address || '';
        $('cp-input-zone').value = customer.delivery_zone || '';
        $('cp-input-notes').value = customer.notes || '';

        // Order history list
        _currentCustomerOrders = orders;
        _customerOrdersPage = 1;
        renderCustomerOrdersList();
    } catch (err) {
        console.error("Error al cargar perfil de cliente:", err);
        toast("Error al cargar datos del cliente", "error");
    }
}

/**
 * Close Customer Profile Modal
 */
export function closeCustomerProfileModal() {
    const modal = $('customer-profile-modal');
    if (modal) modal.classList.add('hidden');
    _activeCustomerProfile = null;
    _currentCustomerOrders = [];
    _customerOrdersPage = 1;
}

/**
 * Save customer notes and address from Profile Modal
 */
async function handleSaveCustomerNotes(e) {
    e.preventDefault();
    if (!_activeCustomerProfile) return;

    const phone = $('cp-input-phone')?.value;
    const name = $('cp-input-name')?.value?.trim();
    const address = $('cp-input-address')?.value?.trim();
    const delivery_zone = $('cp-input-zone')?.value?.trim();
    const notes = $('cp-input-notes')?.value?.trim();

    try {
        await updateCustomer(phone, { name, address, delivery_zone, notes });

        // Update local state
        const cust = (state.customers || []).find(c => c.phone === phone);
        if (cust) {
            if (name) cust.name = name;
            cust.address = address;
            cust.delivery_zone = delivery_zone;
            cust.notes = notes;
        }

        renderCustomersTable();
        toast("Información del cliente actualizada con éxito", "success");
        closeCustomerProfileModal();
    } catch (err) {
        console.error("Error al actualizar cliente:", err);
        toast("Error al guardar: " + (err.message || 'Error desconocido'), "error");
    }
}

// Global exposure so inline onclick attributes and external callers always work
window.closeCustomerProfileModal = closeCustomerProfileModal;
window.openCustomerProfileModal = openCustomerProfileModal;

// Setup modal close listeners immediately without relying on late role init
if (typeof document !== 'undefined') {
    const attachModalListeners = () => {
        const btnClose = document.getElementById('btn-close-customer-profile');
        if (btnClose) {
            btnClose.removeEventListener('click', closeCustomerProfileModal);
            btnClose.addEventListener('click', closeCustomerProfileModal);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachModalListeners);
    } else {
        attachModalListeners();
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('customer-profile-modal');
            if (modal && !modal.classList.contains('hidden')) {
                closeCustomerProfileModal();
            }
        }
    });
}

// AI Features removed
export function openAiGeneratorModal() {}
export function closeAiGeneratorModal() {}
export function openAiConfigModal() {}
export function closeAiConfigModal() {}
export function isAiAutomationEnabled() { return false; }
export function syncAiAutomationToggle() {}
export async function notifyClientOnStatusChange() {}

window.openAiConfigModal = openAiConfigModal;
window.closeAiConfigModal = closeAiConfigModal;
window.syncAiAutomationToggle = syncAiAutomationToggle;
window.toggleAiAutomation = () => {};
