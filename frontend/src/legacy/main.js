import { state } from './core/state.js';

import { $, getSafeDate, formatMoney, escapeHtml } from './utils/helpers.js';
import { ApiClient } from './services/api-client.js';
import { OfflineDB } from './services/offline-db.js';
import { toast, showModalAlert, showConfirmModal, showImageModal } from './components/ui.js';
import { initAuthorizationsHandler } from './features/authorizations-handler.js';

// Make globally accessible for offline listeners
window.ApiClient = ApiClient;
window.OfflineDB = OfflineDB;

// ====================================================================
// GLOBAL ERROR HANDLERS — structured logging for proactive detection
// ====================================================================

/**
 * Log uncaught exceptions to the server for proactive error tracking.
 * Logs error details to console as structured JSON for easy filtering.
 */
window.onerror = function (message, source, lineno, colno, error) {
    const user = state.user ? { id: state.user.id, role: state.user.role } : null;
    console.error(
        `[UNCAUGHT_ERROR] ${new Date().toISOString()}` +
        ` | ${message}` +
        (source ? ` | ${source}:${lineno}:${colno}` : '') +
        (user ? ` | user=${user.id} role=${user.role}` : '') +
        (error?.stack ? ` | stack=${error.stack.replace(/\n/g, ' ↵ ')}` : '')
    );
    // Prevent default browser error dialog
    return true;
};

/**
 * Log unhandled promise rejections.
 * These are common with async/await when catch blocks are missing.
 */
window.addEventListener('unhandledrejection', function (event) {
    const user = state.user ? { id: state.user.id, role: state.user.role } : null;
    const reason = event.reason;
    const message = reason?.message || reason || 'Unknown rejection';
    const stack = reason?.stack ? reason.stack.replace(/\n/g, ' ↵ ') : '';
    console.error(
        `[UNHANDLED_REJECTION] ${new Date().toISOString()}` +
        ` | ${message}` +
        (user ? ` | user=${user.id} role=${user.role}` : '') +
        (stack ? ` | stack=${stack}` : '')
    );
});

// Default WhatsApp templates — using String.fromCodePoint for emoji compatibility
const DEFAULT_WA_TEMPLATES = {
    recibido: `Hola! tu pedido ha sido recibido y pronto entrará a cocina. ${String.fromCodePoint(0x1F929)}`,
    preparacion: `Psst! Tu pedido ha entrado a la cocina...! ${String.fromCodePoint(0x1F468, 0x1F3FC, 0x200D, 0x1F373)}`,
    terminado_recoger: `Enhorabuena, hemos terminado tu pedido. Puedes venir por él. ${String.fromCodePoint(0x1F371)}`,
    terminado_domicilio: `Enhorabuena, hemos terminado tu pedido, pronto lo tendrás en tus manos. ${String.fromCodePoint(0x1F4E6)}`,
    reparto: `Está atento, ya tu pedido fue recogido por nuestro domiciliario, prepara tu paladar... ${String.fromCodePoint(0x1F60B)}`,
    entregado: `Boya! has recibido tu pedido con éxito. Disfruta al máximo cada uno de nuestros sabores. ${String.fromCodePoint(0x2705)}`,
    anulado: `Tu pedido ha sido anulado... ${String.fromCodePoint(0x1F614)}`
};

// Services
import { listenToOrders, listenToWaiterOrders, getOrder } from './services/order-service.js';
import { loginUser, logoutUser, confirmLogin, saveUser, deleteUser as serviceDeleteUser, getUsers } from './services/auth-service.js';
import { saveProduct, deleteProduct, saveCategory, deleteCategory, getProducts, getCategories, listenToProducts } from './services/product-service.js';
import { compressImage, compressImageAsBlob, compressProof, compressBanner } from './utils/image-utils.js';
import { setLoading } from './components/ui.js';

// Views
import { updateCartUI, renderCartList, handleSendOrder, addToCart, updateCheckoutTotals, renderClientView } from './views/client-view.js';
window.renderClientView = renderClientView;
import { handleUpdateChefStatus, handleUpdateWaiterOrderStatus } from './views/chef-view.js';
import { handleUpdateOrderStatus } from './views/delivery-view.js';
import { handleSearchOrder, updateTracker } from './views/tracker-view.js';
import { openWaiterModal, handleSendWaiterOrder, addToWaiterCart, openWaiterHistory } from './views/waiter-view.js';
import { setupCloseRegisterListeners } from './features/close-register.js';
import { initAdminSidebar } from './features/admin-sidebar.js';
import { formatScheduleSummary, openUserScheduleModal, closeUserScheduleModal, setupUserScheduleListeners, setUserScheduleUsersCache } from './features/user-schedule.js';
import { SYSTEM_THEMES, applySystemTheme, updateThemePresetUI, renderThemePresets, selectThemePreset, setModuleContrast, initThemeListeners } from './features/theme-manager.js';
import { updateQuotaWidget, setupAdminListeners } from './views/admin-view.js';
import { setupInventoryListeners } from './views/inventory-view.js';
import { renderAdminCashflowPage } from './views/cashflow-view.js';
import { initToppingsManager, resetDishToppingsConfig, getDishToppingsConfig } from './features/toppings-manager.js';
import { initDeliveryZonesManager, populateClientDeliveryZones } from './features/delivery-zones-manager.js';
import { getDeliveryZones } from './services/delivery-service.js';
import { initCrmManager } from './features/crm-manager.js';
import { initPaymentModal, openPaymentModal, closePaymentModal } from './features/payment-modal.js';
import { getAccounts } from './services/cashflow-service.js';

// Expose globals for HTML inline events (Legacy support)
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.initPaymentModal = initPaymentModal;
window.showImageModal = showImageModal;
window.showConfirmModal = showConfirmModal;
window.updateChefStatus = handleUpdateChefStatus;
window.updateWaiterOrderStatus = handleUpdateWaiterOrderStatus;
window.updateOrderStatus = handleUpdateOrderStatus;
window.addToWaiterCart = addToWaiterCart;
window.openWaiterModal = openWaiterModal;
window.closeWaiterModal = () => {
    const modal = $('waiter-order-modal');
    if (modal) modal.classList.add('hidden');
    if (typeof window.resetWaiterOrderForm === 'function') {
        window.resetWaiterOrderForm();
    }
    if (state.user && (state.user.role === 'admin' || state.user.role === 'cajero')) {
        const adminView = $('admin-view');
        const grView = $('rapid-management-view');
        const isGrOpen = grView && !grView.classList.contains('hidden');
        if (!isGrOpen && adminView && adminView.classList.contains('hidden')) {
            window.switchView('admin');
        }
    }
};
window.updateWaiterCartQty = (index, change) => { }; // Not needed but kept for safety

let currentEditingOrder = null;

window.openOrderEditModal = async (id, isWaiter, bypassAuth = false) => {
    // Check if cashier requires authorization in strict mode
    const isCajero = state.user?.role === 'cajero';
    const requireEditAuth = isCajero && state.restaurantData?.cajeroCanEdit === false;

    if (requireEditAuth && !bypassAuth) {
        if (window.showAuthorizationModal) {
            window.showAuthorizationModal({
                title: 'Autorización para Editar Pedido',
                msg: `La edición directa de pedidos está restringida. Para editar el pedido #${id}, ingresa el PIN de un Administrador / Supervisor o solicita autorización remota.`,
                orderId: id,
                type: 'edit',
                onAuthorized: () => {
                    window.openOrderEditModal(id, isWaiter, true);
                }
            });
            return;
        }
    }

    try {
        let order = await getOrder(id);
        if (order) {
            // Adapt older fields if needed
            order.isWaiterOrder = false; // Unified in backend
        }

        if (!order) return toast("Pedido no encontrado", "error");

        currentEditingOrder = JSON.parse(JSON.stringify(order)); // Deep copy
        if (bypassAuth) currentEditingOrder._authorized = true;

        // Populate Form
        const clientField = $('oe-client');
        const phoneField = $('oe-phone');
        const addressField = $('oe-address');
        const tableField = $('oe-table');
        const notesField = $('oe-notes');
        const typeField = $('oe-type');
        const payField = $('oe-pay');
        const statusField = $('oe-status');
        const tableContainer = $('oe-table-container');

        // Reset visibility
        tableContainer.classList.add('hidden');
        addressField.parentElement.classList.add('hidden');

        if (isWaiter) {
            // Local Order (Waiter) - Now show editable customer fields for printing/legal requirements
            clientField.value = order.client || "Cliente Final";
            clientField.disabled = false; // Allow editing for legal/printing purposes
            $('oe-label-client').innerText = "Cliente";

            phoneField.value = order.phone || "3000000000";
            phoneField.required = false; // Not required but editable
            phoneField.parentElement.classList.remove('hidden'); // Show phone field

            addressField.value = order.address || "Cll 00 00 00";
            addressField.parentElement.classList.remove('hidden'); //  Show address field for customer data

            tableField.value = order.table || "";
            tableContainer.classList.remove('hidden');

            typeField.innerHTML = '<option value="Local">Local</option>';
            typeField.value = "Local";
            typeField.disabled = true;

            payField.value = order.payment || "Efectivo";
            statusField.value = order.status || "Pendiente";

            // Hide proof by default for local orders (usually cash)
            $('oe-proof-container').classList.add('hidden');
            $('oe-no-proof').classList.add('hidden');
            $('oe-current-proof').classList.add('hidden');
            
            // Set the proof source anyway so toggleEditFields can reveal it if it's a Transferencia
            if (order.proof) {
                console.log("Cargando comprobante en modal (Local):", order.proof.substring(0, 50) + "...");
                $('oe-current-proof').src = order.proof;
            }

        } else {
            // Delivery Order (Client)
            clientField.value = order.client || "";
            clientField.disabled = false;
            $('oe-label-client').innerText = "Cliente";

            phoneField.value = order.phone || "";
            phoneField.required = true; // Required for delivery
            phoneField.parentElement.classList.remove('hidden');

            addressField.value = order.address || "";

            tableField.value = "";

            typeField.innerHTML = `
                <option value="Recoger">Para Recoger</option>
                <option value="Domicilio">A Domicilio</option>
            `;
            typeField.value = order.type || "Domicilio";
            typeField.disabled = false;

            payField.value = order.payment || "Efectivo";
            statusField.value = order.status || "Pendiente";

            // Handle Proof
            if (order.proof) {
                console.log("Cargando comprobante en modal:", order.proof.substring(0, 50) + "...");
                $('oe-current-proof').src = order.proof;
                $('oe-current-proof').classList.remove('hidden');
                $('oe-no-proof').classList.add('hidden');
            } else {
                $('oe-current-proof').classList.add('hidden');
                $('oe-no-proof').classList.remove('hidden');
            }
        }

        $('oe-notes').value = order.notes || "";
        $('oe-tip').value = order.tip || 0;
        $('oe-discount').value = order.discount || 0;
        $('oe-discount-reason').value = order.discount_reason || "";
        
        // Disable reason input if discount is 0 on load
        $('oe-discount-reason').disabled = parseFloat(order.discount || 0) <= 0;

        // Populate accounts for destination routing
        try {
            const accounts = await getAccounts({ active: true }) || [];
            const populateSel = (selectEl, defaultVal) => {
                if (!selectEl) return;
                selectEl.innerHTML = '<option value="">(Cuenta predeterminada / Ninguna)</option>' +
                    accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${a.type || 'General'})</option>`).join('');
                if (defaultVal) selectEl.value = String(defaultVal);
            };

            populateSel($('oe-account'), order.account_id);
            populateSel($('oe-mixed-cash-account'), order.cash_account_id);
            populateSel($('oe-mixed-transfer-account'), order.transfer_account_id);
        } catch (accErr) {
            console.warn("Could not load accounts for edit modal:", accErr);
        }

        // Set mixed values if payment is Mixto
        if ($('oe-mixed-cash')) $('oe-mixed-cash').value = order.cash_amount || '';
        if ($('oe-mixed-transfer')) $('oe-mixed-transfer').value = order.transfer_amount || '';

        // Auto balancing between mixed cash and transfer
        if ($('oe-mixed-cash') && $('oe-mixed-transfer')) {
            $('oe-mixed-cash').oninput = () => {
                const total = (currentEditingOrder?.items?.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty)), 0) || 0)
                    + (parseFloat($('oe-tip').value) || 0) - (parseFloat($('oe-discount').value) || 0);
                let cash = parseFloat($('oe-mixed-cash').value);
                if (isNaN(cash) || cash < 0) cash = 0;
                if (cash > total) cash = total;
                $('oe-mixed-transfer').value = Math.max(0, total - cash);
            };
            $('oe-mixed-transfer').oninput = () => {
                const total = (currentEditingOrder?.items?.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty)), 0) || 0)
                    + (parseFloat($('oe-tip').value) || 0) - (parseFloat($('oe-discount').value) || 0);
                let trans = parseFloat($('oe-mixed-transfer').value);
                if (isNaN(trans) || trans < 0) trans = 0;
                if (trans > total) trans = total;
                $('oe-mixed-cash').value = Math.max(0, total - trans);
            };
        }

        // Toggle fields based on data
        toggleEditFields();

        // Render Items
        renderEditItems();

        // Add event listener to toggle discount reason natively when discount changes
        $('oe-discount').oninput = (e) => {
            const val = parseFloat(e.target.value) || 0;
            const reasonInput = $('oe-discount-reason');
            if (val > 0) {
                reasonInput.disabled = false;
                reasonInput.required = true;
            } else {
                reasonInput.disabled = true;
                reasonInput.required = false;
                reasonInput.value = "";
            }
            renderEditItems();
        };

        $('oe-tip').oninput = () => renderEditItems();

        // Populate Add Product Select
        const sel = $('oe-add-product');
        sel.innerHTML = '<option value="">Agregar producto...</option>' +
            state.products.map(p => `<option value="${p.id}">${p.name} - $${p.price}</option>`).join('');

        $('order-edit-modal').classList.remove('hidden');

    } catch (e) {
        console.error(e);
        toast("Error abriendo pedido", "error");
    }
};

/**
 * Open edit modal for an offline order (stored in IndexedDB).
 * Populates the same edit form used for online orders but marks
 * currentEditingOrder._offline so the save handler saves locally.
 */
window.openOfflineOrderEditModal = (id) => {
    let order = state.orders.find(o => o.id === id);
    if (!order && state.waiterOrders) {
        order = state.waiterOrders.find(o => o.id === id);
    }
    if (!order) return toast("Pedido no encontrado", "error");

    currentEditingOrder = JSON.parse(JSON.stringify(order));
    currentEditingOrder._offline = true; // Mark so save handler knows to save locally

    // Populate form fields (same structure as openOrderEditModal for General orders)
    const clientField = $('oe-client');
    const phoneField = $('oe-phone');
    const addressField = $('oe-address');
    const tableField = $('oe-table');
    const notesField = $('oe-notes');
    const typeField = $('oe-type');
    const payField = $('oe-pay');
    const statusField = $('oe-status');
    const tableContainer = $('oe-table-container');

    tableContainer.classList.add('hidden');
    addressField.parentElement.classList.remove('hidden');
    phoneField.parentElement.classList.remove('hidden');

    clientField.value = order.client || "";
    clientField.disabled = false;
    $('oe-label-client').innerText = "Cliente";

    phoneField.value = order.phone || "";
    phoneField.required = true;

    addressField.value = order.address || "";
    tableField.value = "";

    typeField.innerHTML = `
        <option value="Recoger">Para Recoger</option>
        <option value="Domicilio">A Domicilio</option>
    `;
    typeField.value = order.type || "Domicilio";
    typeField.disabled = false;

    payField.value = order.payment || "Efectivo";
    statusField.value = order.status || "Pendiente";

    // Handle Proof
    if (order.proof) {
        console.log("Cargando comprobante en modal offline:", order.proof.substring(0, 50) + "...");
        $('oe-current-proof').src = order.proof;
        $('oe-current-proof').classList.remove('hidden');
        $('oe-no-proof').classList.add('hidden');
    } else {
        $('oe-current-proof').classList.add('hidden');
        $('oe-no-proof').classList.remove('hidden');
    }

    notesField.value = order.notes || "";
    $('oe-tip').value = order.tip || 0;
    $('oe-discount').value = order.discount || 0;
    $('oe-discount-reason').value = order.discount_reason || "";
    $('oe-discount-reason').disabled = parseFloat(order.discount || 0) <= 0;

    toggleEditFields();
    renderEditItems();

    $('oe-discount').oninput = (e) => {
        const val = parseFloat(e.target.value) || 0;
        const reasonInput = $('oe-discount-reason');
        if (val > 0) {
            reasonInput.disabled = false;
            reasonInput.required = true;
        } else {
            reasonInput.disabled = true;
            reasonInput.required = false;
            reasonInput.value = "";
        }
        renderEditItems();
    };

    $('oe-tip').oninput = () => renderEditItems();

    const sel = $('oe-add-product');
    sel.innerHTML = '<option value="">Agregar producto...</option>' +
        state.products.map(p => `<option value="${p.id}">${p.name} - $${p.price}</option>`).join('');

    $('order-edit-modal').classList.remove('hidden');
};

// Admin Globals
window.editUser = (id, name, username, role) => {
    $('user-id').value = id;
    $('user-name').value = name || '';
    $('user-username').value = username || '';
    $('user-code').value = ''; // Always clear password field
    $('user-code').placeholder = "Dejar en blanco para mantener clave actual";
    $('user-role').value = role;
    $('user-modal').classList.remove('hidden');
};

window.deleteUser = (id) => {
    showConfirmModal("Eliminar Usuario", "¿Estás seguro? Esta acción no se puede deshacer.", async () => {
        try {
            await serviceDeleteUser(id);
            toast("Usuario eliminado", "success");
            if (window.reloadUsersPanel) {
                await window.reloadUsersPanel();
            }
            window.dispatchEvent(new CustomEvent('users-refresh'));
            loadAdminUsers();
        } catch (e) {
            console.error(e);
            showModalAlert("Error", "No se pudo eliminar el usuario", "error");
        }
    });
};

let _adminUsersCache = [];

// Admin Logic Helpers
async function loadAdminUsers() {
    const tbody = $('admin-users-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-400">Cargando usuarios...</td></tr>';
    try {
        const users = await getUsers();
        _adminUsersCache = users || [];
        setUserScheduleUsersCache(_adminUsersCache);
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-400">No hay usuarios registrados.</td></tr>';
            return;
        }
        tbody.innerHTML = users
            .filter(u => u.name !== 'digidanMasterAdmin' && u.id !== 'digidan_master_admin')
            .map(u => {
            const roleLabels = {
                'admin': '<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold">ADMIN</span>',
                'cajero': '<span class="bg-teal-100 text-teal-700 px-2 py-0.5 rounded text-[10px] font-bold">CAJERO</span>',
                'chef': '<span class="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold">CHEF</span>',
                'delivery': '<span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">REPARTIDOR</span>',
                'mesero': '<span class="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold">MESERO</span>'
            };
            const displayName = escapeHtml(u.name || u.user || 'Sin Nombre');
            const displayUsername = escapeHtml(u.username || u.user || u.name || 'Sin Usuario');

            let scheduleCell = '';
            if (u.role === 'admin') {
                scheduleCell = '<span class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full"><i class="fas fa-shield-alt text-[10px]"></i> Admin (Libre)</span>';
            } else {
                scheduleCell = `
                    <div class="inline-flex items-center gap-2.5">
                        <button type="button" onclick="openUserScheduleModal('${u.id}')" class="w-7 h-7 rounded-lg bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center transition-all hover:opacity-90 shrink-0 cursor-pointer shadow-xs" title="Asignar Jornada Laboral">
                            <i class="fas fa-business-time text-[var(--system-secondary)] text-xs"></i>
                        </button>
                        ${formatScheduleSummary(u.work_schedule)}
                    </div>
                `;
            }

            return `
                <tr class="hover:bg-gray-50 transition-colors group">
                    <td class="p-3 font-semibold text-gray-800 text-xs">${displayName}</td>
                    <td class="p-3 font-mono text-xs text-gray-600">${displayUsername}</td>
                    <td class="p-3">${roleLabels[u.role] || u.role}</td>
                    <td class="p-3 font-mono text-gray-400 text-xs">••••••••</td>
                    <td class="p-3">${scheduleCell}</td>
                    <td class="p-3 text-right">
                        <div class="relative inline-block text-left table-action-container">
                            <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                                <i class="fas fa-ellipsis-v text-xs"></i>
                            </button>
                            <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                                <button type="button" onclick="editUser('${u.id}', '${escapeHtml(u.name || '')}', '${escapeHtml(u.username || u.user || u.name || '')}', '${u.role}')" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                                    <i class="fas fa-edit w-4 text-center"></i> <span>Editar</span>
                                </button>
                                ${u.role !== 'admin' ? `
                                <button type="button" onclick="openUserScheduleModal('${u.id}')" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors">
                                    <i class="fas fa-clock w-4 text-center text-amber-500"></i> <span>Horario y Jornada</span>
                                </button>
                                ` : ''}
                                <button type="button" onclick="deleteUser('${u.id}')" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors">
                                    <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-400">Error cargando usuarios.</td></tr>';
    }
}

function loadAdminConfig() {
    if ($('conf-name')) $('conf-name').value = state.restaurantData.name || state.config.nombreRestaurante || "";
    if ($('conf-slogan')) $('conf-slogan').value = state.restaurantData.slogan || state.config.sloganRestaurante || "";
    if ($('conf-phone')) $('conf-phone').value = state.restaurantData.phone || "";
    if ($('conf-address')) $('conf-address').value = state.restaurantData.address || "";
    if ($('conf-welcome')) $('conf-welcome').value = state.restaurantData.welcome || "";

    // Sync AI automation toggle
    if (window.syncAiAutomationToggle) window.syncAiAutomationToggle();

    // Cargar Redes Sociales
    const sn = state.restaurantData.socialNetworks || {};
    if ($('conf-social-instagram')) $('conf-social-instagram').value = sn.instagram || '';
    if ($('conf-social-facebook')) $('conf-social-facebook').value = sn.facebook || '';
    if ($('conf-social-tiktok')) $('conf-social-tiktok').value = sn.tiktok || '';

    // Cargar mensajes WhatsApp
    let waTemplates = state.whatsappTemplates || {};
    // Merge with defaults to ensure all keys exist
    waTemplates = { ...DEFAULT_WA_TEMPLATES, ...waTemplates };
    state.whatsappTemplates = waTemplates;
    const waFieldMap = {
        'conf-wa-recibido': 'recibido',
        'conf-wa-preparacion': 'preparacion',
        'conf-wa-terminado-recoger': 'terminado_recoger',
        'conf-wa-terminado-domicilio': 'terminado_domicilio',
        'conf-wa-reparto': 'reparto',
        'conf-wa-entregado': 'entregado',
        'conf-wa-anulado': 'anulado'
    };
    Object.entries(waFieldMap).forEach(([elId, key]) => {
        const el = $(elId);
        if (el) el.value = waTemplates[key] || '';
    });

    // Cargar Horarios
    const hours = state.restaurantData.businessHours || {};
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
        const dayConfig = hours[day] || { active: true, open: '17:00', close: '23:00' };
        if ($(`conf-hours-${day}-active`)) $(`conf-hours-${day}-active`).checked = dayConfig.active;
        if ($(`conf-hours-${day}-open`)) $(`conf-hours-${day}-open`).value = dayConfig.open || '';
        if ($(`conf-hours-${day}-close`)) $(`conf-hours-${day}-close`).value = dayConfig.close || '';
    });

    // Sync Open/Closed Switch
    const switchEl = $('conf-is-open');
    if (switchEl) {
        // Default to true if undefined
        switchEl.checked = state.config.isOpen !== false;
    }

    // Sync Cajero Permissions Switches (Default to true if undefined)
    const canCancelEl = $('conf-cajero-can-cancel');
    if (canCancelEl) {
        canCancelEl.checked = state.restaurantData.cajeroCanCancel !== false;
    }
    const canEditEl = $('conf-cajero-can-edit');
    if (canEditEl) {
        canEditEl.checked = state.restaurantData.cajeroCanEdit !== false;
    }

    const acc = state.accountData || {};
    if ($('conf-bank-name')) $('conf-bank-name').value = acc.typeAcount || "";
    if ($('conf-bank-holder')) $('conf-bank-holder').value = acc.name || "";
    if ($('conf-bank-number')) $('conf-bank-number').value = acc.number || "";
    renderConfBankAccounts();

    if (state.config.logo) {
        $('conf-logo-preview').src = state.config.logo;
        $('conf-logo-preview').classList.remove('hidden');
        $('conf-logo-placeholder').classList.add('hidden');
    }

    if (state.config.banner) {
        $('conf-banner-preview').src = state.config.banner;
        $('conf-banner-preview').classList.remove('hidden');
        $('conf-banner-placeholder').classList.add('hidden');
        const deleteBtn = $('btn-delete-banner');
        if (deleteBtn) deleteBtn.classList.remove('hidden');
    } else {
        $('conf-banner-preview').classList.add('hidden');
        $('conf-banner-placeholder').classList.remove('hidden');
        const deleteBtn = $('btn-delete-banner');
        if (deleteBtn) deleteBtn.classList.add('hidden');
    }

    const primaryColor = state.config.primaryColor || localStorage.getItem('digirest_primary_color') || "#f5b55f";
    const contrastColor = state.config.contrastColor || localStorage.getItem('digirest_contrast_color') || "#64010e";
    const sidebarColor = state.config.sidebarColor || localStorage.getItem('digirest_sidebar_color') || "#052244";
    const themeId = state.config.themeId || localStorage.getItem('digirest_theme_id') || "amber";
    applySystemTheme(primaryColor, contrastColor, themeId);
    applySidebarTheme(sidebarColor, primaryColor);
    initThemeListeners();
}

export function renderConfBankAccounts() {
    const container = $('conf-banks-container');
    if (!container) return;
    container.innerHTML = '';

    if (!Array.isArray(state.bankAccounts) || state.bankAccounts.length === 0) {
        state.bankAccounts = [{ bank: '', holder: '', number: '', type: 'Ahorros' }];
    }

    state.bankAccounts.forEach((acc, index) => {
        const row = document.createElement('div');
        row.className = 'conf-bank-row bg-gray-50/80 p-3 rounded-xl border border-gray-200/80 space-y-2.5';
        row.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold text-gray-700 flex items-center gap-1.5">
                    <i class="fas fa-university text-blue-600"></i> Cuenta #${index + 1}
                </span>
                ${state.bankAccounts.length > 1 ? `
                    <button type="button" class="btn-delete-conf-bank text-red-500 hover:text-red-700 text-xs p-1 rounded-lg hover:bg-red-50 transition-colors cursor-pointer" data-index="${index}" title="Eliminar cuenta">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                ` : ''}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div>
                    <label class="text-[9px] font-bold text-gray-400 uppercase ml-1 block mb-0.5">Banco / Entidad</label>
                    <input type="text" class="conf-bank-name w-full p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-xs bg-white" placeholder="Ej: Bancolombia, Nequi" value="${acc.bank || ''}">
                </div>
                <div>
                    <label class="text-[9px] font-bold text-gray-400 uppercase ml-1 block mb-0.5">Tipo de Cuenta</label>
                    <input type="text" class="conf-bank-type w-full p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-xs bg-white" placeholder="Ahorros / Celular / Cte" value="${acc.type || 'Ahorros'}">
                </div>
                <div>
                    <label class="text-[9px] font-bold text-gray-400 uppercase ml-1 block mb-0.5">Titular</label>
                    <input type="text" class="conf-bank-holder w-full p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-xs bg-white" placeholder="Nombre completo" value="${acc.holder || ''}">
                </div>
                <div>
                    <label class="text-[9px] font-bold text-gray-400 uppercase ml-1 block mb-0.5">Número de Cuenta</label>
                    <input type="text" class="conf-bank-number w-full p-2 border border-gray-200 rounded-lg outline-none focus:border-blue-500 text-xs bg-white" placeholder="000-000-0000" value="${acc.number || ''}">
                </div>
            </div>
        `;
        container.appendChild(row);
    });

    container.querySelectorAll('.btn-delete-conf-bank').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            if (state.bankAccounts.length > 1) {
                syncBankAccountsFromDOM();
                state.bankAccounts.splice(idx, 1);
                renderConfBankAccounts();
            }
        });
    });
}

export function syncBankAccountsFromDOM() {
    const rows = Array.from(document.querySelectorAll('#conf-banks-container .conf-bank-row'));
    if (rows.length === 0) return;
    state.bankAccounts = rows.map(r => ({
        bank: r.querySelector('.conf-bank-name')?.value.trim() || '',
        type: r.querySelector('.conf-bank-type')?.value.trim() || 'Ahorros',
        holder: r.querySelector('.conf-bank-holder')?.value.trim() || '',
        number: r.querySelector('.conf-bank-number')?.value.trim() || ''
    }));
}

$('btn-add-conf-bank')?.addEventListener('click', () => {
    syncBankAccountsFromDOM();
    state.bankAccounts.push({ bank: '', type: 'Ahorros', holder: '', number: '' });
    renderConfBankAccounts();
});

// ... (Rest of init logic)

let _initGuard = false;
/** Flag to prevent session_replaced handler from clearing the token
 *  when the event is triggered by our OWN confirm-login action.
 *  The server broadcasts session_replaced to ALL sockets in user_{id},
 *  including the socket that initiated the confirm-login. */
let _isSelfConfirming = false;

async function init() {
    if (_initGuard) {
        console.warn("init() already called — skipping duplicate initialization");
        return;
    }
    _initGuard = true;

    const safetyTimeout = setTimeout(() => {
        console.warn("Init timed out, forcing load.");
        $('app-loader').classList.add('hidden');
    }, 10000);

    try {

        // ====================================================================
        // INITIALIZE SOCKET.IO (Global)
        // Must be done BEFORE loading views/listeners
        // Prioritize WebSocket for single persistent connection (avoids HTTP 400 session ID unknown)
        // ====================================================================
        const socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity,
            timeout: 20000,
            forceNew: false,
            upgrade: true
        });
        window.socket = socket; // Expose globally immediately

        // Authenticate socket to join role-specific rooms
        socket.on('connect', () => {
            authenticateSocket();
            initAuthorizationsHandler(socket);
        });

        // Confirm authentication
        socket.on('authenticated', () => {
            socket.authenticated = true;
        });

        // Listen for session_replaced event (displaced by another login)
        socket.on('session_replaced', (data) => {
            // When the user is confirming their own login via confirm-login,
            // the server emits session_replaced to ALL sockets in user_{id},
            // including THIS socket. Ignore the event in that case.
            if (_isSelfConfirming) {
                console.log('[SESSION] Ignoring self-initiated session_replaced event');
                return;
            }
            const msg = (data && data.message) || 'Has iniciado sesión en otro dispositivo, serás redirigido al inicio';
            showModalAlert('Sesión Reemplazada', msg, 'warning');
            // Force logout: clear local session
            ApiClient.setToken(null);
            localStorage.removeItem('pos_token');
            localStorage.removeItem('pos_user');
            state.user = null;
            // Redirect to client view after a brief delay
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        });

        // Function to authenticate socket (Also called after login)
        window.authenticateSocket = function () {
            const token = localStorage.getItem('pos_token') || (window.ApiClient && ApiClient.getToken ? ApiClient.getToken() : null);
            if (state.user && state.user.role) {
                socket.emit('authenticate', {
                    token: token,
                    role: state.user.role,
                    userId: state.user.id
                });
            }
            if (!$('status-view').classList.contains('hidden') || !$('client-view').classList.contains('hidden')) {
                // Anyone viewing tracker needs the tracker room updates.
                socket.emit('join_room', 'tracker');
            }
        };

        // Try to authenticate immediately if user session exists (handled later in init but good to have ready)
        // We will call authenticateSocket() again after verifying session below if needed.

        // Global Note Sound Listener (for Chef/Waiter/etc)
        // Admin has its own listener in admin-view.js
        socket.on('new_order_note', () => {
            const role = state.user?.role;
            // Play sound for Chef and Waiter
            if (role === 'chef' || role === 'cocinero' || role === 'waiter' || role === 'mesero') {
                if (window.playNoteSound) window.playNoteSound();
            }
        });

        // Real-time Inventory & Recipe listeners
        socket.on('inventory_updated', () => {
            if (!$('panel-supplies')?.classList.contains('hidden')) {
                renderAdminSuppliesPage();
            }
        });
        socket.on('recipe_saved', () => {
            if (!$('panel-recipes')?.classList.contains('hidden')) {
                renderAdminRecipesPage();
            }
        });
        socket.on('recipe_deleted', () => {
            if (!$('panel-recipes')?.classList.contains('hidden')) {
                renderAdminRecipesPage();
            }
        });

        // Initialize Admin Listeners explicitely
        setupAdminListeners();
        setupInventoryListeners();
        setupCloseRegisterListeners();
        initToppingsManager();
        initDeliveryZonesManager();
        initCrmManager();
        initPaymentModal();

        // ====================================================================
        // ROLE-BASED PWA APP BADGE (via Socket.IO)
        // Badge increments when app is backgrounded and a relevant event fires.
        // No notification permission needed — setAppBadge works on Android without it.
        // ====================================================================
        const badgeForRole = (allowedRoles, orderId = null) => {
            const role = state.user?.role;
            if (!role) return;
            const r = role.toLowerCase();
            if (allowedRoles.some(ar => r === ar)) {
                if (window.incrementAppBadge) window.incrementAppBadge();
            }
        };

        socket.on('new_order', () => {
            // Chef and admin should be notified of new orders
            badgeForRole(['admin', 'chef', 'cocinero']);
        });

        socket.on('order_updated', (data) => {
            const role = state.user?.role?.toLowerCase();
            if (!role) return;
            // Waiter: badge if their own order was updated
            if ((role === 'waiter' || role === 'mesero') && data && data.waiterId == state.user?.id) {
                if (window.incrementAppBadge) window.incrementAppBadge();
            }
            // Delivery: badge if order moves to 'En Reparto'
            if ((role === 'delivery' || role === 'repartidor') && data && data.status === 'En Reparto') {
                if (window.incrementAppBadge) window.incrementAppBadge();
            }
        });

        socket.on('new_order_note', (data) => {
            const role = state.user?.role?.toLowerCase();
            if (!role) return;
            // Waiter: badge on notes in their orders
            if (role === 'waiter' || role === 'mesero') {
                if (window.incrementAppBadge) window.incrementAppBadge();
            }
        });

        // Load Config (Parallel)
        try {
            const [restData, accData, imgData, bannerData, colorData, primaryColorData, contrastColorData, themeIdData, bgAsideData, bankAccountsData] = await Promise.all([
                ApiClient.get('/config/dataRestaurant').catch(() => ({})),
                ApiClient.get('/config/AcountMoney').catch(() => ({})),
                ApiClient.get('/config/imgRestaurantDefault').catch(() => ({})),
                ApiClient.get('/config/imgBannerDefault').catch(() => ({})),
                ApiClient.get('/config/uiNameColor').catch(() => (null)),
                ApiClient.get('/config/uiPrimaryColor').catch(() => (null)),
                ApiClient.get('/config/uiContrastColor').catch(() => (null)),
                ApiClient.get('/config/uiThemeId').catch(() => (null)),
                ApiClient.get('/config/uiBgAside').catch(() => (null)),
                ApiClient.get('/config/bankAccounts').catch(() => (null))
            ]);

            state.restaurantData = restData || {};
            state.config.nombreRestaurante = state.restaurantData.name;
            state.config.sloganRestaurante = state.restaurantData.slogan;
            state.config.isOpen = state.restaurantData.isOpen;

            state.accountData = accData || {};
            if (Array.isArray(bankAccountsData) && bankAccountsData.length > 0) {
                state.bankAccounts = bankAccountsData;
            } else if (accData && (accData.typeAcount || accData.name || accData.number)) {
                state.bankAccounts = [{
                    bank: accData.typeAcount || '',
                    holder: accData.name || '',
                    number: accData.number || '',
                    type: 'Ahorros'
                }];
            } else {
                state.bankAccounts = [];
            }
            if (imgData && (imgData.url || imgData.Base64)) {
                state.config.logo = imgData.url || imgData.Base64;
            }
            if (bannerData && (bannerData.url || bannerData.Base64)) {
                state.config.banner = bannerData.url || bannerData.Base64;
            }

            // Unified Theme and Colors Initialization
            const savedPrimary = primaryColorData || colorData || localStorage.getItem('digirest_primary_color') || '#f5b55f';
            const savedContrast = contrastColorData || localStorage.getItem('digirest_contrast_color') || '#64010e';
            const savedSidebar = bgAsideData || localStorage.getItem('digirest_sidebar_color') || '#052244';
            const savedThemeId = themeIdData || localStorage.getItem('digirest_theme_id') || 'amber';

            state.config.primaryColor = savedPrimary;
            state.config.nameColor = savedPrimary;
            state.config.contrastColor = savedContrast;
            state.config.sidebarColor = savedSidebar;
            state.config.themeId = savedThemeId;

            localStorage.setItem('digirest_primary_color', savedPrimary);
            localStorage.setItem('digirest_contrast_color', savedContrast);
            localStorage.setItem('digirest_sidebar_color', savedSidebar);
            localStorage.setItem('digirest_theme_id', savedThemeId);

            applySystemTheme(savedPrimary, savedContrast, savedThemeId);
            applySidebarTheme(savedSidebar, savedPrimary);
        } catch (err) { console.warn("Error loading config:", err); }

        applyConfig();

        // Load Categories safely (resilient to offline and startup delays)
        try {
            state.categories = (await getCategories()) || [];
        } catch (catErr) {
            console.warn("Advertencia cargando categorías en inicio:", catErr);
            state.categories = [];
        }

        // Load Products safely (resilient to offline and startup delays)
        try {
            state.products = (await getProducts()) || [];
        } catch (prodErr) {
            console.warn("Advertencia cargando productos en inicio:", prodErr);
            state.products = [];
        }
        // Load Delivery Zones
        try {
            state.deliveryZones = await getDeliveryZones();
            populateClientDeliveryZones();
        } catch (e) {
            console.warn("Error preloading delivery zones:", e);
        }

        // Checkbox Persistence
        const savedChecks = localStorage.getItem('pos_checks');
        if (savedChecks) state.checkedItems = new Set(JSON.parse(savedChecks));

        // Helper to actively verify if restored session is still valid
        const verifyActiveSession = async () => {
            const token = localStorage.getItem('pos_token') || (window.ApiClient && ApiClient.getToken ? ApiClient.getToken() : null);
            if (!token || !state.user) return;
            try {
                // ApiClient.get automatically invokes handleSessionReplaced on 401 SESSION_REPLACED
                await ApiClient.get('/auth/verify-session');
            } catch (err) {
                // If network is offline or other non-auth error, ApiClient doesn't kick out.
                // handleSessionReplaced takes care of 401 SESSION_REPLACED specifically.
            }
        };

        // Session
        const savedUser = localStorage.getItem('pos_user');
        if (savedUser) {
            state.user = JSON.parse(savedUser);
            // Authenticate socket immediately with restored session
            if (window.authenticateSocket) window.authenticateSocket();

            const lastView = localStorage.getItem('pos_last_view');
            const defaultView = getDefaultViewForRole(state.user.role);
            switchView(lastView && lastView === defaultView ? lastView : defaultView);

            // Proactively verify session with backend
            verifyActiveSession();
        } else {
            renderClientView();
        }

        // Re-verify session when tab/browser foregrounds or unlocks
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && state.user) {
                verifyActiveSession();
            }
        });
        window.addEventListener('focus', () => {
            if (state.user) {
                verifyActiveSession();
            }
        });

        // Inactivity
        document.addEventListener('mousemove', resetActivity);
        document.addEventListener('click', resetActivity);
        document.addEventListener('keydown', resetActivity);
        setInterval(checkInactivity, 60000);

        // Listen for Realtime Product Updates
        listenToProducts((newProds, newCats) => {
            state.products = newProds;
            state.categories = newCats;

            // Re-render current view if applicable
            if (!$('client-view').classList.contains('hidden')) {
                renderClientView();
            }
            if (!$('waiter-view').classList.contains('hidden')) {
                renderWaiterProducts();
            }
            if (!$('admin-view').classList.contains('hidden')) {
                const activeTab = localStorage.getItem('adminActiveTab');
                if (activeTab === 'categories') {
                    renderAdminCategoriesPage();
                } else if (activeTab === 'gastos') {
                    renderAdminGastosPage();
                } else if (activeTab === 'products') {
                    renderAdminProductsPage();
                } else {
                    renderAdminProductsPage(); // default background refresh
                }
            }
        });

        // Listen for Realtime User Updates
        socket.on('users_updated', () => {
            if (window.reloadUsersPanel) {
                window.reloadUsersPanel();
            }
            window.dispatchEvent(new CustomEvent('users-refresh'));
            if (!$('admin-view').classList.contains('hidden')) {
                loadAdminUsers();
            }
        });

        // Global Listener for Instant Waiter Updates (Force Refresh)
        const refreshWaiterOrders = (data) => {
            // If waiter view is active
            if (!$('waiter-view').classList.contains('hidden')) {
                ApiClient.get('/orders').then(orders => {
                    // Filter for THIS waiter
                    // Ensure we handle string vs number ID
                    const myOrders = orders.filter(o => o.type === 'Local' && o.waiterId == state.user.id);
                    state.waiterOrders = myOrders;
                    renderWaiterActiveOrders(myOrders);
                }).catch(err => console.error("Error auto-refreshing waiter orders:", err));
            }
        };

        // Listen for Configuration Updates (Realtime)
        // Socket initialized at the start of init()

        socket.on('config_updated', (data) => {

            if (data.key === 'dataRestaurant') {
                state.restaurantData = data.value;
                state.config.nombreRestaurante = data.value.name;
                state.config.sloganRestaurante = data.value.slogan;
                state.config.isOpen = data.value.isOpen;

                applyConfig(); // Updates Navbar title/logo
                // Vue ClientView renders the restaurant status badge reactively (no legacy call).
            } else if (data.key === 'imgRestaurantDefault') {
                state.config.logo = data.value.Base64 || data.value.url;
                applyConfig();
            } else if (data.key === 'imgBannerDefault') {
                state.config.banner = data.value.Base64 || data.value.url;
                applyConfig();
            } else if (data.key === 'uiPrimaryColor' || data.key === 'uiNameColor') {
                state.config.primaryColor = data.value;
                state.config.nameColor = data.value;
                localStorage.setItem('digirest_primary_color', data.value);
                applySystemTheme(data.value, state.config.contrastColor, state.config.themeId);
            } else if (data.key === 'uiContrastColor') {
                state.config.contrastColor = data.value;
                localStorage.setItem('digirest_contrast_color', data.value);
                applySystemTheme(state.config.primaryColor, data.value, state.config.themeId);
            } else if (data.key === 'uiBgAside') {
                state.config.sidebarColor = data.value;
                localStorage.setItem('digirest_sidebar_color', data.value);
                applySidebarTheme(data.value, state.config.primaryColor);
            } else if (data.key === 'uiThemeId') {
                state.config.themeId = data.value;
                localStorage.setItem('digirest_theme_id', data.value);
                updateThemePresetUI(data.value, state.config.primaryColor);
            }
        });

        // URL Parameter Handling (Deep Linking)
        const urlParams = new URLSearchParams(window.location.search);
        const trackId = urlParams.get('track');
        const viewParam = urlParams.get('view');

        if (trackId) {
            // Preserve ID so switchView doesn't clear it from URL
            state.currentTrackId = trackId;

            // Force tracker view
            window.switchView('tracker');

            // Open modal and set value (Listener in updateTracker will trigger search once data loads)
            const searchModal = $('tracker-search-modal');
            const searchInput = $('search-order-id');

            if (searchModal && searchInput) {
                searchModal.classList.remove('hidden');
                searchInput.value = trackId;
                // Note: We don't call handleSearchOrder here directly because state.orders might be empty.
                // The listenToOrders callback we modified earlier will handle it.
            }
        } else if (viewParam === 'tracker') {
            window.switchView('tracker');
        } else if (viewParam === 'display') {
            window.switchView('display');
        }

        // --- PWA: iOS Foreground Refresh Data ---
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                console.log("PWA: App foregrounded. Requesting latest data...");
                // Clear the app badge on supported platforms
                if (navigator.clearAppBadge) {
                    navigator.clearAppBadge().catch(e => console.log('Badge clear error:', e));
                }
                if (typeof unreadBadgeCount !== 'undefined') unreadBadgeCount = 0;

                // Force a data reload based on the currently open view
                if (!$('admin-view').classList.contains('hidden') && window.reloadAdminData) {
                    window.reloadAdminData();
                } else if (!$('waiter-view').classList.contains('hidden')) {
                    ApiClient.get('/orders').then(orders => {
                        const myOrders = orders.filter(o => o.type === 'Local' && o.waiterId == state.user.id);
                        state.waiterOrders = myOrders;
                        if (window.renderWaiterActiveOrders) window.renderWaiterActiveOrders(myOrders);
                    }).catch(err => console.error("Foreground refresh error:", err));
                } else if (!$('chef-view').classList.contains('hidden')) {
                    window.switchView('chef');
                } else if (!$('delivery-view').classList.contains('hidden')) {
                    window.switchView('delivery');
                } else if (!$('client-view').classList.contains('hidden') && window.renderClientView) {
                    Promise.all([
                        ApiClient.get('/config/dataRestaurant').catch(() => ({})),
                        ApiClient.get('/products').catch(() => ([]))
                    ]).then(([restData, prods]) => {
                        if (restData && Object.keys(restData).length > 0) {
                            state.restaurantData = restData;
                            state.config.nombreRestaurante = restData.name;
                            state.config.sloganRestaurante = restData.slogan;
                            state.config.isOpen = restData.isOpen;
                            // Vue ClientView renders the status badge reactively.
                        }
                        if (prods && prods.length > 0) {
                            state.products = prods;
                        }
                        window.renderClientView();
                    }).catch(err => console.error("Foreground refresh error (client):", err));
                } else if (!$('status-view').classList.contains('hidden') && window.updateTracker) {
                    window.switchView('tracker');
                }
            }
        });

    } catch (e) {
        console.error("Error inicializando:", e);
        showModalAlert("Error de Conexión", "No se pudo conectar con el servidor.", "error");
    } finally {
        clearTimeout(safetyTimeout);
        $('app-loader').classList.add('hidden');
    }
}

// Auth Listener (Manual Check)
function checkAuthStatus() {
    if (!ApiClient.token) {
        if (state.user) {
            state.user = null;
            localStorage.removeItem('pos_user');
            updateOnlineIndicator();
            window.switchView('client');
            document.querySelectorAll('[id$="-modal"]').forEach(m => m.classList.add('hidden'));
        }
    }
}
// Run check periodically or rely on API failure?
// For now, rely on init and manual actions.

function applyConfig() {
    const title = state.restaurantData.name || state.config.nombreRestaurante || "Mi Restaurante";
    document.title = `DigiRest - ${title}`;
    const navTitle = $('nav-title');
    if (navTitle) navTitle.innerText = title;
    const navSlogan = $('nav-slogan');
    if (navSlogan) navSlogan.innerText = state.restaurantData.slogan || state.config.sloganRestaurante || "...";

    let logoToUse = 'img/icon.png';
    const navLogo = $('nav-logo');
    const defaultLogoIcon = $('default-logo-icon');

    if (state.config.logo) {
        logoToUse = state.config.logo;
        if (navLogo) {
            navLogo.src = state.config.logo;
            navLogo.classList.remove('hidden');
        }
        if (defaultLogoIcon) {
            defaultLogoIcon.classList.add('hidden');
        }

        // Dynamic Favicon
        const favicon = document.getElementById('app-favicon');
        if (favicon) favicon.href = state.config.logo;
    } else {
        if (navLogo) {
            navLogo.classList.add('hidden');
        }
        if (defaultLogoIcon) {
            defaultLogoIcon.classList.remove('hidden');
        }
    }

    // Dynamic Favicon & iOS Icon & Login Logo
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = logoToUse;

    const loginLogo = $('login-logo');
    if (loginLogo) loginLogo.src = logoToUse;

    // Sidebar brand (image, name and slogan)
    const sidebarLogo = $('sidebar-logo');
    if (sidebarLogo) sidebarLogo.src = logoToUse;
    const sidebarName = $('sidebar-business-name');
    if (sidebarName) sidebarName.innerText = title;
    const sidebarSlogan = $('sidebar-business-slogan');
    if (sidebarSlogan) sidebarSlogan.innerText = state.restaurantData.slogan || state.config.sloganRestaurante || "...";

    // Apply Banner Background
    const bannerUrl = state.config.banner || ''; // Empty string removes the inline style, falling back to bg-gray-900 class
    const welcomeBanner = $('welcome-banner');
    const displayWelcome = $('display-welcome');
    if (welcomeBanner) welcomeBanner.style.backgroundImage = bannerUrl ? `url(${bannerUrl})` : '';
    if (displayWelcome) displayWelcome.style.backgroundImage = bannerUrl ? `url(${bannerUrl})` : '';

    // Apply Unified Brand & System Theme
    const primaryColor = state.config.primaryColor || localStorage.getItem('digirest_primary_color') || '#f5b55f';
    const contrastColor = state.config.contrastColor || localStorage.getItem('digirest_contrast_color') || '#64010e';
    const themeId = state.config.themeId || localStorage.getItem('digirest_theme_id') || 'amber';
    applySystemTheme(primaryColor, contrastColor, themeId);

    // Apply Social Networks
    const sn = state.restaurantData.socialNetworks || {};
    [1, 2].forEach(n => {
        ['instagram', 'facebook', 'tiktok'].forEach(network => {
            const btn = $(`sn-${network}-${n}`);
            if (btn) {
                if (sn[network]) {
                    btn.href = sn[network];
                    btn.classList.remove('hidden');
                } else {
                    btn.href = '#';
                    btn.classList.add('hidden');
                }
            }
        });
    });

    // Apply GPS Address
    const gpsAddress = $('gps-address');
    if (gpsAddress) {
        gpsAddress.innerText = state.restaurantData.address || "Dirección no configurada.";
    }
    const btnMaps = $('btn-maps-route');
    if (btnMaps) {
        if (state.restaurantData.address) {
            btnMaps.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(state.restaurantData.address)}`;
            btnMaps.classList.remove('hidden');
        } else {
            btnMaps.href = '#';
            btnMaps.classList.add('hidden');
        }
    }

    // Check Business Hours on load for client view
    if (state.restaurantData.isOpen === false) {
        if (!state.user || state.user.role === 'client' || !state.user.role) { // Show to guests or normal clients
            checkAndShowBusinessHours();
        }
    }

    alignSidebarSticky();

    // Note: The manifest.json is now dynamically served by the Node.js backend
    // to ensure Android/Chrome correctly parses it during the A2HS (Add to Home Screen) event.
}

// Align the sticky sidebar's pinned position with its natural resting position
// inside #main-container (16px / md:pt-4) so it doesn't jump when switching
// between scrollable and non-scrollable modules.
function alignSidebarSticky() {
    const wrapper = $('admin-sidebar-wrapper');
    if (!wrapper) return;
    if (window.innerWidth >= 768) {
        wrapper.style.top = '12px';
        wrapper.style.marginTop = '0px';
    } else {
        wrapper.style.top = '';
        wrapper.style.marginTop = '';
    }
}

window.openGpsModal = () => {
    $('gps-modal').classList.remove('hidden');
};

function formatHour12(timeStr) {
    if (!timeStr || timeStr === '--:--') return timeStr || '--:--';
    const parts = timeStr.split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const period = h >= 12 ? 'p. m.' : 'a. m.';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${period}`;
}

function checkAndShowBusinessHours() {
    const hoursList = $('hours-list');
    const hours = state.restaurantData.businessHours || {};

    let html = '';
    const daysMap = { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };

    for (const [key, label] of Object.entries(daysMap)) {
        const h = hours[key];
        if (h && h.active) {
            html += `<div class="flex justify-between py-2"><span class="font-bold text-gray-700">${label}</span><span class="text-gray-600">${formatHour12(h.open)} a ${formatHour12(h.close)}</span></div>`;
        } else {
            html += `<div class="flex justify-between py-2"><span class="font-bold text-gray-700">${label}</span><span class="text-red-400 font-medium">Cerrado</span></div>`;
        }
    }

    if (hoursList) {
        if (html === '') {
            html = '<div class="text-center text-gray-500 py-2">No configurado</div>';
        }
        hoursList.innerHTML = html;
    }

    $('hours-modal').classList.remove('hidden');
}

/**
 * Filter admin sidebar tabs based on user role.
 * Cajero cannot see Products, Categories, Users, or Config tabs.
 */
function filterAdminTabsForRole() {
    const role = state.user?.role;
    const forbiddenTabs = ['products', 'categories', 'users', 'config', 'supplies', 'recipes', 'toppings', 'delivery-zones'];

    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        const tab = btn.getAttribute('data-tab');
        if (role === 'cajero' && forbiddenTabs.includes(tab)) {
            btn.style.display = 'none';
        } else {
            btn.style.display = '';
        }
    });

    // Hide section container if all its buttons are hidden
    document.querySelectorAll('.admin-nav-section').forEach(sec => {
        const visibleBtns = Array.from(sec.querySelectorAll('.admin-tab-btn')).filter(b => b.style.display !== 'none');
        sec.style.display = visibleBtns.length === 0 ? 'none' : '';
    });
}

// Track unsubscribe functions for socket listeners to prevent stacking
let _unsubOrders = null;
let _unsubWaiterOrders = null;

// Exposed for the Vue AdminSidebar (tab switching) to call internal renderers.
window.loadAdminUsers = loadAdminUsers;
window.loadAdminConfig = loadAdminConfig;
window.loadCierreCajaHistory = loadCierreCajaHistory;

// Navigation
window.switchView = (viewName) => {
    // Clean up previous socket listeners before registering new ones
    if (typeof _unsubOrders === 'function') { _unsubOrders(); _unsubOrders = null; }
    if (typeof _unsubWaiterOrders === 'function') { _unsubWaiterOrders(); _unsubWaiterOrders = null; }

    // Toggle body class for display view specific styles (hiding nav, etc)
    if (viewName === 'display') {
        document.body.classList.add('view-display');
    } else {
        document.body.classList.remove('view-display');
    }

    ['client-view', 'status-view', 'chef-view', 'delivery-view', 'admin-view', 'waiter-view', 'display-view'].forEach(v => {
        const el = $(v);
        if (el) el.classList.add('hidden');
    });
    $('cart-float')?.classList.add('hidden');
    $('admin-sidebar-container')?.classList.add('hidden');

    if (viewName === 'client') {
        $('client-view').classList.remove('hidden');
        $('main-container').classList.remove('bg-gray-50', 'bg-white');
        // Vue ClientView owns the menu rendering (categories, featured, grid).
        updateCartUI();
    } else if (viewName === 'admin') {
        $('admin-view').classList.remove('hidden');
        initAdminSidebar();
        $('admin-sidebar-container')?.classList.remove('hidden');
        alignSidebarSticky();

        // Disparar chequeo de anuncios y novedades SaaS para el admin
        window.dispatchEvent(new CustomEvent('saas-check-anuncios'));

        // Tab filtering by role and tab restore are now handled by the Vue AdminSidebar.

        // Update admin name in header
        const adminNick = $('admin-nick');
        if (adminNick && state.user) adminNick.innerText = state.user.name || 'Admin';
        _unsubOrders = listenToOrders('admin', async (orders) => {
            let allOrders = [...orders];
            // Merge offline orders (created while offline) with deduplication
            // This handles both:
            //   - Socket events (orders is server-only, needs offline merge)
            //   - onSyncComplete (orders already includes offline orders merged by listenToOrders)
            try {
                const { getOfflineOrders } = await import('./services/order-service.js');
                const offlineOrders = await getOfflineOrders();
                if (offlineOrders.length > 0) {
                    // Merge: offline first, server second — deduplicate by ID (first wins)
                    const seen = new Set();
                    allOrders = [];
                    for (const order of [...offlineOrders, ...orders]) {
                        if (!seen.has(order.id)) {
                            seen.add(order.id);
                            allOrders.push(order);
                        }
                    }
                }
            } catch (e) {
                console.error("Error loading offline orders:", e);
            }
            state.orders = allOrders;
            // Vue OrdersPanel + DashboardPanel render reactively from state.
        });
        _unsubWaiterOrders = listenToWaiterOrders('admin', (orders) => {
            state.waiterOrders = orders;
            // Vue OrdersPanel + DashboardPanel render reactively from state.
        });

        // Explicitly reload admin data (works offline — loads from IndexedDB first)
        if (window.reloadAdminData) {
            window.reloadAdminData();
        }
    } else if (viewName === 'chef') {
        $('chef-view').classList.remove('hidden');
    } else if (viewName === 'delivery') {
        $('delivery-view').classList.remove('hidden');
    } else if (viewName === 'waiter') {
        $('waiter-view').classList.remove('hidden');
    } else if (viewName === 'status' || viewName === 'tracker') {
        $('status-view').classList.remove('hidden');

        // Join tracker room to receive public updates
        if (window.socket) window.socket.emit('join_room', 'tracker');

        // Vue TrackerView owns the order subscription and list rendering.
        // It also keeps state.orders in sync for the search modal (legacy).

        // Show Back to Dashboard button if user is logged in
        if (state.user) {
            const btnBack = $('btn-back-dashboard');
            if (btnBack) {
                btnBack.classList.remove('hidden');
                btnBack.onclick = () => {
                    const role = state.user.role;
                    if (role === 'admin' || role === 'cajero') window.switchView('admin');
                    else if (role === 'chef' || role === 'cocinero') window.switchView('chef');
                    else if (role === 'waiter' || role === 'mesero') window.switchView('waiter');
                    else if (role === 'delivery' || role === 'repartidor') window.switchView('delivery');
                    else window.switchView('client');
                };
            }
        } else {
            if ($('btn-back-dashboard')) $('btn-back-dashboard').classList.add('hidden');
        }
    } else if (viewName === 'display') {
        $('display-view').classList.remove('hidden');

        // Show floating tracker button in display view
        const trackerBtn = $('btn-tracker-search');
        if (trackerBtn) trackerBtn.classList.remove('hidden');
    } else {
        // Ensure floating tracker is hidden in other views
        const trackerBtn = $('btn-tracker-search');
        if (trackerBtn) trackerBtn.classList.add('hidden');
    }

    // Update return to panel button visibility after view switch
    if (typeof updateReturnToPanelButton === 'function') {
        updateReturnToPanelButton();
    }

    if (state.user) localStorage.setItem('pos_last_view', viewName);
    updateOnlineIndicator();

    // Update URL for sharing/navigating
    const url = new URL(window.location);
    if (viewName === 'client') {
        url.searchParams.delete('view');
        url.searchParams.delete('track');
    } else if (viewName === 'status' || viewName === 'tracker') {
        url.searchParams.set('view', 'tracker');
        // Do not clear track param if it's already there? 
        // Actually, if switching to generic tracker view via menu, maybe clear track param unless it was just set.
        if (!state.currentTrackId) {
            url.searchParams.delete('track');
        }
    } else {
        url.searchParams.set('view', viewName);
        url.searchParams.delete('track');
    }
    window.history.pushState({}, '', url);
};

// Global Reload Function for Real-Time Updates (called by admin-view.js)
window.reloadAdminData = async () => {
    if (state.user && (state.user.role === 'admin' || state.user.role === 'cajero')) {
        // 1. Always load offline orders first (works even when offline)
        let offlineOrdersList = [];
        try {
            const { getOfflineOrders } = await import('./services/order-service.js');
            offlineOrdersList = await getOfflineOrders();
        } catch (e) {
            console.error("Error loading offline orders:", e);
        }
        const offlineIds = new Set(offlineOrdersList.map(o => o.id));

        // 2. Try to fetch from server with forceNetwork to bypass service worker cache
        let serverOrders = [];
        try {
            const orders = await ApiClient.get('/orders?all=true', true);
            serverOrders = orders;
        } catch (e) {
            // Offline — preserve previously loaded server orders from state
            // Filter out any offline IDs to avoid duplicates
            serverOrders = (state.orders || []).filter(o => !offlineIds.has(o.id));
        }

        // Merge: offline orders first, then server orders — deduplicate by ID
        const seen = new Set();
        const allOrders = [];
        for (const order of [...offlineOrdersList, ...serverOrders]) {
            if (!seen.has(order.id)) {
                seen.add(order.id);
                allOrders.push(order);
            }
        }

        state.orders = allOrders;
        if (typeof renderAdminOrdersTable === 'function') {
            renderAdminOrdersTable(allOrders);
        }
        // Update stats
        if (typeof updateDashboardStats === 'function') {
            updateDashboardStats(state.orders || [], state.waiterOrders || []);
        }
        // Notify other views (GR)
        window.dispatchEvent(new CustomEvent('orders-updated'));

        // 3. Reload Waiter Orders (Local) — merge offline + server orders
        let localFromServer = [];
        try {
            const waiterOrders = await ApiClient.get('/orders?all=true', true);
            localFromServer = waiterOrders.filter(o => o.type === 'Local');
        } catch (e) {
            // Offline — preserve previous server waiter orders from state
            localFromServer = (state.waiterOrders || []).filter(o => !o._offline && o.type === 'Local');
        }
        // Filter offline orders that are Local type, merge with server orders
        const offlineWaiterOrders = offlineOrdersList.filter(o => o.type === 'Local');
        // Merge: offline first, then server (server has authoritative version, wins on dedup)
        const seenWaiter = new Set();
        const mergedWaiterOrders = [];
        for (const order of [...offlineWaiterOrders, ...localFromServer]) {
            if (!seenWaiter.has(order.id)) {
                seenWaiter.add(order.id);
                mergedWaiterOrders.push(order);
            }
        }
        state.waiterOrders = mergedWaiterOrders;
        if (typeof renderAdminWaiterOrders === 'function') {
            renderAdminWaiterOrders(mergedWaiterOrders);
        }
        if (typeof updateDashboardStats === 'function') {
            updateDashboardStats(state.orders || [], state.waiterOrders || []);
        }
    }
};

// Also alias loadAdminOrders for backward compatibility if older code calls it
window.loadAdminOrders = window.reloadAdminData;

function getDefaultViewForRole(role) {
    if (!role) return 'client';
    const r = role.toLowerCase();
    if (r === 'admin' || r === 'cajero') return 'admin';
    if (r === 'chef' || r === 'cocinero') return 'chef';
    if (r === 'delivery' || r === 'repartidor') return 'delivery';
    if (r === 'waiter' || r === 'mesero') return 'waiter';
    return 'client';
}

function updateOnlineIndicator() {
    const user = state.user;
    const btn = $('btn-login-trigger');
    const btnText = $('login-btn-text');

    if (user) {
        if (btnText) btnText.innerText = "Salir";
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) icon.className = "fas fa-sign-out-alt";
            btn.title = `Cerrar Sesión (${user.name || user.username || user.role})`;
            btn.classList.add('text-red-300', 'bg-red-500/30', 'border-red-400/50');
            btn.classList.remove('text-white', 'bg-white/20', 'border-white/30');
        }
    } else {
        if (btnText) btnText.innerText = "Ingresar";
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) icon.className = "fas fa-user";
            btn.title = "Acceso al Sistema";
            btn.classList.remove('text-red-300', 'bg-red-500/30', 'border-red-400/50');
            btn.classList.add('text-white', 'bg-white/20', 'border-white/30');
        }
    }
}

function updateReturnToPanelButton() {
    const user = state.user;
    const btn = $('btn-return-to-panel');

    if (!btn) return;

    // Only show button in client view, hide in all other views
    const clientView = $('client-view');
    const isInClientView = clientView && !clientView.classList.contains('hidden');

    if (user && isInClientView) {
        btn.classList.remove('hidden');
        btn.onclick = (e) => {
            if (e) e.preventDefault();
            switch (user.role) {
                case 'admin':
                case 'cajero':
                    window.switchView('admin');
                    break;
                case 'chef':
                case 'cocinero':
                    window.switchView('chef');
                    break;
                case 'delivery':
                case 'repartidor':
                    window.switchView('delivery');
                    break;
                case 'waiter':
                case 'mesero':
                    window.switchView('waiter');
                    break;
                default:
                    window.switchView('client');
            }
        };
    } else {
        btn.classList.add('hidden');
    }
}

// Expose the function globally so it can be called from client-view
window.updateReturnToPanelButton = updateReturnToPanelButton;

// Sound and Notification Badging Logic
// Check for AudioContext support (optional, but good for some browsers)
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const notificationSound = new Audio('noti.mp3');
const noteSound = new Audio('note_snd.mp3');

let unreadBadgeCount = 0;

function incrementAppBadge() {
    // Only increment badge if the app is hidden/background
    if (document.visibilityState === 'hidden') {
        unreadBadgeCount++;
        if (navigator.setAppBadge) {
            navigator.setAppBadge(unreadBadgeCount).catch((e) => console.log('Badge error:', e));
        }
    }
}

function clearAppBadge() {
    unreadBadgeCount = 0;
    if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch((e) => console.log('Badge clear error:', e));
    }
}

// Clear badges when coming back to the app
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        clearAppBadge();
    }
});

function playNotificationSound() {
    // User interaction usually required for audio
    notificationSound.play().catch(e => console.log("Audio play failed (interaction needed)", e));
    incrementAppBadge();
}

function playNoteSound() {
    noteSound.play().catch(e => console.log("Note audio play failed (interaction needed)", e));
    incrementAppBadge();
}

// Expose globally
window.playNotificationSound = playNotificationSound;
window.playNoteSound = playNoteSound;
window.incrementAppBadge = incrementAppBadge;

function resetActivity() {
    state.lastActivity = Date.now();
}

async function checkInactivity() {
    if (state.user && $('client-view').classList.contains('hidden') && Date.now() - state.lastActivity > 30 * 60 * 1000) {
        // Notify backend to clear the session, avoiding the "session already active" bug on next login
        await logoutUser();
        
        state.user = null;
        localStorage.removeItem('pos_user');
        document.querySelectorAll('[id$="-modal"]').forEach(m => m.classList.add('hidden'));

        // Cleanup Admin Sidebar
        document.getElementById('admin-sidebar-container')?.remove();
        document.getElementById('admin-features-modals')?.remove();

        window.switchView('client');
        showModalAlert("Sesión Cerrada", "Tu sesión ha expirado por inactividad.", "info");
    }
}

// Global Shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('[id$="-modal"]:not(.hidden)');
        openModals.forEach(m => m.classList.add('hidden'));
    }
});

// Event Listeners
$('nav-brand-btn')?.addEventListener('click', () => window.switchView('client'));
$('btn-back-menu')?.addEventListener('click', () => window.switchView('client'));
$('btn-tracker')?.addEventListener('click', () => window.switchView('tracker'));

window.handleLogoutUser = () => {
    showConfirmModal(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas salir?",
        async () => {
            // Call backend to blacklist token, then clear local session
            await logoutUser();
            state.user = null;

            // Cleanup Admin Sidebar
            document.getElementById('admin-sidebar-container')?.remove();
            document.getElementById('admin-features-modals')?.remove();

            applyConfig();
            updateOnlineIndicator();
            window.switchView('client');
            toast("Sesión cerrada", "info");
        },
        null,
        "Aceptar"
    );
};

$('btn-sidebar-logout')?.addEventListener('click', window.handleLogoutUser);

$('btn-login-trigger')?.addEventListener('click', () => {
    if (state.user) {
        window.handleLogoutUser();
    } else {
        $('login-modal')?.classList.remove('hidden');
    }
});

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('login-user').value;
    const code = $('login-code').value;
    const loginBtn = $('login-form').querySelector('button[type="submit"]');
    const originalText = loginBtn ? loginBtn.innerHTML : 'Iniciar Sesión';

    try {
        // Disable button to prevent double-submit
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<div class="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mx-auto"></div>';
        }

        const response = await loginUser(user, code);

        // ── CASE 1: Active session exists — ask user for confirmation ──
        if (response && response.hasActiveSession && response.user) {
            showConfirmModal(
                "Sesión Activa",
                `Tienes una sesión iniciada en otro dispositivo. ¿Deseas cerrarla e iniciar sesión en este?`,
                async () => {
                    // User accepted — call confirm-login to force-replace the session
                    // Set flag BEFORE confirmLogin() so the session_replaced socket event
                    // (which the server broadcasts to ALL sockets in user_{id}, including this one)
                    // does NOT clear our freshly-set token.
                    _isSelfConfirming = true;
                    try {
                        const confirmUser = await confirmLogin(user, code);
                        if (confirmUser) {
                            // Proceed with normal login flow
                            $('login-modal').classList.add('hidden');
                            $('login-form').reset();
                            proceedAfterLogin(confirmUser);
                        } else {
                            toast("Error al iniciar sesión", "error");
                        }
                    } catch (err) {
                        console.error(err);
                        toast("Error de conexión", "error");
                    } finally {
                        _isSelfConfirming = false;
                    }
                },
                null, // onCancel — do nothing, modal just closes
                "Cerrar e Iniciar Sesión"
            );
            return;
        }

        // ── CASE 2: Successful login (token received) ──
        if (response && response.token && response.user) {
            const userData = response.user;

            // ── SaaS: Guardar aviso de vencimiento (1 vez al día, solo admin) ──
            if (response.warningSaaS && userData.role === 'admin') {
                const today = new Date().toISOString().split('T')[0];
                const lastDate = localStorage.getItem('_lastWarningSaaSDate_digirest');
                if (lastDate !== today) {
                    sessionStorage.setItem('_warningSaaS_digirest', JSON.stringify(response.warningSaaS));
                    localStorage.setItem('_lastWarningSaaSDate_digirest', today);
                }
            }

            // ── SaaS: Guardar anuncios activos (1 vez al día, solo admin) ──
            if (Array.isArray(response.anuncios) && response.anuncios.length > 0 && userData.role === 'admin') {
                sessionStorage.setItem('_anuncios_digirest', JSON.stringify(response.anuncios));
            }

            $('login-modal').classList.add('hidden');
            $('login-form').reset();
            proceedAfterLogin(userData);
            window.dispatchEvent(new CustomEvent('saas-refresh', {
                detail: { user: userData, anuncios: response.anuncios, warningSaaS: response.warningSaaS }
            }));
            return;
        }


        // ── CASE 3: Unexpected response ──
        toast("¡Ups! Verifica bien los datos ingresados ⚠️", "error");

    } catch (error) {
        console.error(error);
        toast("Error de conexión", "error");
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalText;
        }
    }
});

/**
 * Proceed after successful login: show splash, init app, switch to role view.
 * @param {Object} userData - The user object { id, name, role }
 */
function proceedAfterLogin(userData) {
    if (!userData) return;

    // Reset inactivity timer so the newly logged-in session doesn't get immediately
    // invalidated by a stale lastActivity timestamp from a prior session
    state.lastActivity = Date.now();

    // Show Welcome Splash
    const splash = $('welcome-splash');
    const welcomeName = $('welcome-user-name');
    if (splash && welcomeName) {
        welcomeName.innerText = userData.name;
        splash.classList.remove('hidden');

        // Initialize App IMMEDIATELY behind the splash
        state.user = userData;
        localStorage.setItem('pos_user', JSON.stringify(userData));
        init(userData);
        updateOnlineIndicator();

        // Authenticate socket with user role and switch to role-based view
        if (window.authenticateSocket) window.authenticateSocket();
        const defaultView = getDefaultViewForRole(userData.role);
        window.switchView(defaultView);

        // Request Notification Permission for PWA Badging (iOS requirement)
        if (window.requestNotificationPermission) {
            window.requestNotificationPermission();
        }

        // Wait 2 seconds, then fade out
        setTimeout(() => {
            splash.classList.add('opacity-0');
            setTimeout(() => {
                splash.classList.add('hidden');
                splash.classList.remove('opacity-0');
            }, 700);
        }, 2000);
    } else {
        // Fallback if splash missing
        state.user = userData;
        localStorage.setItem('pos_user', JSON.stringify(userData));
        init(userData);
        updateOnlineIndicator();

        // Authenticate socket with user role and switch to role-based view
        if (window.authenticateSocket) window.authenticateSocket();
        const defaultView = getDefaultViewForRole(userData.role);
        window.switchView(defaultView);
    }
}

// Checkout Button Validator helper
window.validateCheckoutButton = () => {
    const btnSend = $('btn-send-wa');

    if (!btnSend) return;

    // Never disable the button, just validate inside handleSendOrder
    btnSend.disabled = false;
    btnSend.classList.remove('opacity-50', 'cursor-not-allowed');
    btnSend.classList.add('hover:bg-[#1e2122]', 'active:scale-95');
};

$('btn-cancel-login').addEventListener('click', () => $('login-modal').classList.add('hidden'));

// Cart
$('btn-open-cart').addEventListener('click', () => {
    populateClientDeliveryZones();
    renderCartList();
    $('cart-modal').classList.remove('hidden');
    // Step 1: show dish list + "Continuar"; hide checkout form
    $('cart-items-list').classList.remove('hidden');
    $('checkout-section').classList.add('hidden');
    $('btn-go-checkout').classList.remove('hidden');
    $('msg-send-wa').classList.add('hidden');
    $('btn-send-wa').classList.add('hidden');
    updateCheckoutTotals();
    window.validateCheckoutButton();
});
$('btn-close-cart').addEventListener('click', () => $('cart-modal').classList.add('hidden'));
$('btn-send-wa').addEventListener('click', handleSendOrder);

// Step 2: continue to delivery data (collapse the dish list)
$('btn-go-checkout').addEventListener('click', () => {
    $('cart-items-list').classList.add('hidden');
    $('checkout-section').classList.remove('hidden');
    $('btn-go-checkout').classList.add('hidden');
    $('msg-send-wa').classList.remove('hidden');
    $('btn-send-wa').classList.remove('hidden');
    updateCheckoutTotals();
    window.validateCheckoutButton();
});

// Back to cart (step 1)
$('btn-back-to-cart').addEventListener('click', () => {
    $('cart-items-list').classList.remove('hidden');
    $('checkout-section').classList.add('hidden');
    $('btn-go-checkout').classList.remove('hidden');
    $('msg-send-wa').classList.add('hidden');
    $('btn-send-wa').classList.add('hidden');
});

// Payment Proof Compression
$('c-proof').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const msg = $('proof-msg');

    if (file) {
        msg.innerText = "Comprimiendo...";
        msg.classList.remove('hidden', 'text-green-500', 'text-red-500');
        msg.classList.add('text-orange-500');

        try {
            const compressedBlob = await compressProof(file);
            // Create a new File object with WebP extension and mime type
            const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
            const compressedFile = new File([compressedBlob], newName, {
                type: 'image/webp',
                lastModified: Date.now()
            });

            state.tempProofFile = compressedFile;
            window.validateCheckoutButton();

            msg.innerText = "Imagen lista y optimizada";
            msg.classList.remove('text-orange-500');
            msg.classList.add('text-[#f5b55f]', 'font-bold');
        } catch (err) {
            console.error("Compression failed:", err);
            msg.innerText = "Error al comprimir (se usará original)";
            msg.classList.remove('text-orange-500');
            msg.classList.add('text-red-500');
            state.tempProofFile = file; // Fallback
        }
    } else {
        state.tempProofFile = null;
        msg.classList.add('hidden');
        window.validateCheckoutButton();
    }
});

// Search
$('btn-tracker-search').addEventListener('click', () => {
    $('tracker-search-modal').classList.remove('hidden');
    $('search-order-id').focus();
});
$('btn-close-search').addEventListener('click', () => {
    $('tracker-search-modal').classList.add('hidden');
    $('search-result').classList.add('hidden');
    $('search-order-id').value = '';
});
$('btn-do-search').addEventListener('click', handleSearchOrder);

// Waiter
const btnNewOrderWaiter = $('btn-new-order-waiter');
if (btnNewOrderWaiter) {
    btnNewOrderWaiter.addEventListener('click', openWaiterModal);
}
// $('btn-send-waiter-order').addEventListener('click', handleSendWaiterOrder); // Moved to waiter-view.js
$('btn-waiter-history')?.addEventListener('click', openWaiterHistory);
$('btn-close-waiter-history')?.addEventListener('click', () => $('waiter-history-modal').classList.add('hidden'));

// Admin Form Listeners
$('btn-new-product').addEventListener('click', () => {
    $('p-id').value = '';
    $('prod-form').reset();
    resetDishToppingsConfig();
    const btnDelImg = $('btn-delete-img');
    const delInput = $('p-delete-img');
    const imgContainer = $('p-current-img-container');

    if (btnDelImg) btnDelImg.classList.add('hidden');
    if (delInput) delInput.value = '';
    if (imgContainer) imgContainer.classList.add('hidden');

    $('btn-save-prod').innerText = "Guardar";
    const sel = $('p-cat');
    sel.innerHTML = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    $('product-modal').classList.remove('hidden');
});
$('btn-cancel-prod').addEventListener('click', () => $('product-modal').classList.add('hidden'));
const btnCloseProd = $('btn-close-prod');
if (btnCloseProd) btnCloseProd.addEventListener('click', () => $('product-modal').classList.add('hidden'));

$('prod-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading('btn-save-prod', true, "Guardando...");
    try {
        const file = $('p-file').files[0];
        const id = $('p-id').value;

        const hasToppings = $('p-has-toppings')?.checked ? 1 : 0;
        const toppingsConfig = hasToppings ? JSON.stringify(getDishToppingsConfig()) : '[]';
        const isRecommended = $('p-is-recommended')?.checked ? 1 : 0;
        const isPromo = $('p-is-promo')?.checked ? 1 : 0;
        const promoPrice = isPromo ? (Number($('p-promo-price')?.value) || 0) : 0;

        const data = {
            name: $('p-name').value,
            desc: $('p-desc').value,
            category: $('p-cat').value,
            price: Number($('p-price').value),
            available: $('p-available').checked,
            has_toppings: hasToppings,
            toppings_config: toppingsConfig,
            is_recommended: isRecommended,
            is_promo: isPromo,
            promo_price: promoPrice
        };

        const delInput = $('p-delete-img');
        if (delInput && delInput.value === 'true') {
            data.img = '/img/noimage.png';
        }

        if (file) {
            $('upload-msg').innerText = "Comprimiendo imagen...";
            $('upload-msg').classList.remove('hidden');
            data.img = await compressImageAsBlob(file);
        }
        // No default image handling needed anymore
        // If editing and no file, data.img remains undefined preventing overwrite

        await saveProduct(data, id);
        toast(id ? "Producto actualizado" : "Producto guardado");

        $('product-modal').classList.add('hidden');
        state.products = await getProducts();
        renderAdminProductsPage();
        updateQuotaWidget();
    } catch (e) {
        console.error(e);
        showModalAlert("Error", "Error guardando producto: " + e.message, "error");
    } finally {
        setLoading('btn-save-prod', false);
        $('upload-msg').classList.add('hidden');
    }
});

$('btn-new-category').addEventListener('click', () => {
    $('cat-id').value = '';
    $('cat-form').reset();
    $('btn-save-cat').innerText = "Guardar";
    $('cat-modal').classList.remove('hidden');
});
$('btn-cancel-cat').addEventListener('click', () => $('cat-modal').classList.add('hidden'));

$('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading('btn-save-cat', true, "Guardando...");
    const name = $('cat-name').value;
    const id = $('cat-id').value;
    try {
        await saveCategory({ name }, id);
        toast(id ? "Categoría actualizada" : "Categoría guardada");
        $('cat-modal').classList.add('hidden');
        state.categories = await getCategories();
        renderAdminCategoriesPage();
        updateQuotaWidget();
    } catch (e) {
        console.error(e);
        showModalAlert("Error", "Error guardando categoría", "error");
    } finally {
        setLoading('btn-save-cat', false);
    }
});

$('btn-add-user')?.addEventListener('click', () => {
    $('user-form').reset();
    $('user-id').value = '';
    $('user-code').required = true;
    $('user-code').placeholder = "Contraseña (letras, números y símbolos)";
    $('user-modal').classList.remove('hidden');
});

$('btn-toggle-user-code')?.addEventListener('click', () => {
    const input = $('user-code');
    const icon = $('btn-toggle-user-code')?.querySelector('i');
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
});

$('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading('btn-save-user', true, "Guardando...");
    try {
        const id = $('user-id').value;
        const newName = $('user-name').value.trim();
        const newUsername = $('user-username').value.trim();
        const newCode = $('user-code').value;

        if (!id && !newCode) {
            setLoading('btn-save-user', false);
            return showModalAlert("Contraseña Requerida", "Debes ingresar una contraseña o código para el nuevo usuario.", "warning");
        }

        // Anti-duplicate validation by username (exact case-sensitive check)
        const currentUsers = await getUsers();
        const exists = currentUsers.find(u => {
            if (u.id === id) return false;
            const uUser = u.username || u.user || u.name;
            return uUser && uUser === newUsername;
        });

        if (exists) {
            setLoading('btn-save-user', false);
            return showModalAlert("Usuario Duplicado", "Ya existe un usuario con este nombre de usuario. Por favor, elige otro.", "warning");
        }

        const data = {
            name: newName,
            username: newUsername,
            code: newCode,
            role: $('user-role').value
        };
        await saveUser(data, id);
        toast(id ? "Usuario actualizado" : "Usuario creado", "success");
        $('user-modal').classList.add('hidden');
        if (window.reloadUsersPanel) {
            await window.reloadUsersPanel();
        }
        window.dispatchEvent(new CustomEvent('users-refresh'));
        loadAdminUsers();
    } catch (err) {
        console.error(err);
        showModalAlert("Error", "No se pudo guardar el usuario: " + (err.message || "Error desconocido"), "error");
    } finally {
        setLoading('btn-save-user', false);
    }
});

// Restaurant Status Switch Listener
$('conf-is-open')?.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent immediate toggle
    const newState = e.target.checked;

    showConfirmModal(
        newState ? "Abrir Restaurante" : "Cerrar Restaurante",
        newState
            ? "¿Estás seguro de que deseas ABRIR el restaurante? Se habilitará la recepción de pedidos."
            : "¿Estás seguro de que deseas CERRAR el restaurante? Se bloqueará la recepción de nuevos pedidos.",
        async () => {
            // On Confirm
            // On Confirm
            try {
                // Update via API
                // We need to send the FULL object because our simple SQL upsert replaces the JSON value.
                // Ideally, backend should support PATCH, but for safety in this simple system, we assume we update 'dataRestaurant'.
                const newData = { ...state.restaurantData, isOpen: newState };

                await ApiClient.post('/config', {
                    key: 'dataRestaurant',
                    value: newData
                });

                // Update Local State
                state.restaurantData.isOpen = newState;
                state.config.isOpen = newState;
                e.target.checked = newState; // Manually toggle visual state
                toast(newState ? "Restaurante Abierto" : "Restaurante Cerrado", "success");
            } catch (err) {
                console.error(err);
                toast("Error actualizando estado", "error");
            }
        },
        () => {
            // On Cancel
            e.target.checked = !newState; // Revert (redundant due to preventDefault but safe)
        },
        "Aceptar"
    );
});

$('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Block cajero from saving config — only admins can modify these settings
    if (state.user?.role === 'cajero') {
        showModalAlert(
            "Acceso denegado",
            "Solo los administradores pueden guardar cambios de configuración.",
            "warning"
        );
        return;
    }

    setLoading('btn-save-config', true, "Guardando...");
    try {
        const sn = {
            instagram: $('conf-social-instagram') ? $('conf-social-instagram').value : '',
            facebook: $('conf-social-facebook') ? $('conf-social-facebook').value : '',
            tiktok: $('conf-social-tiktok') ? $('conf-social-tiktok').value : ''
        };

        const hours = {};
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
            if ($(`conf-hours-${day}-active`)) {
                hours[day] = {
                    active: $(`conf-hours-${day}-active`).checked,
                    open: $(`conf-hours-${day}-open`).value,
                    close: $(`conf-hours-${day}-close`).value
                };
            }
        });

        const data = {
            name: $('conf-name') ? $('conf-name').value : '',
            slogan: $('conf-slogan') ? $('conf-slogan').value : '',
            phone: $('conf-phone') ? $('conf-phone').value : '',
            address: $('conf-address') ? $('conf-address').value : '',
            welcome: $('conf-welcome') ? $('conf-welcome').value : (state.restaurantData.welcome || ''),
            isOpen: $('conf-is-open') ? $('conf-is-open').checked : (state.config.isOpen !== false),
            cajeroCanCancel: $('conf-cajero-can-cancel') ? $('conf-cajero-can-cancel').checked : true,
            cajeroCanEdit: $('conf-cajero-can-edit') ? $('conf-cajero-can-edit').checked : true,
            socialNetworks: sn,
            businessHours: hours
        };

        // Save Restaurant Data
        await ApiClient.post('/config', { key: 'dataRestaurant', value: data });
        state.restaurantData = data;
        state.config.nombreRestaurante = data.name;
        state.config.sloganRestaurante = data.slogan;

        // Save Bank Accounts
        syncBankAccountsFromDOM();
        const activeBanks = (state.bankAccounts || []).filter(b => b.bank || b.number || b.holder);
        await ApiClient.post('/config', { key: 'bankAccounts', value: activeBanks });
        state.bankAccounts = activeBanks;

        // Keep primary AcountMoney synced for backwards compatibility
        const primaryBank = activeBanks[0] || { bank: '', holder: '', number: '' };
        const accData = {
            typeAcount: primaryBank.bank,
            name: primaryBank.holder,
            number: primaryBank.number
        };
        await ApiClient.post('/config', { key: 'AcountMoney', value: accData });
        state.accountData = accData;

        // Save Logo if Present
        const file = $('conf-logo').files[0];
        if (file) {
            const dataUrl = await compressImage(file);
            // Limit checks handled in compressImage or we can trust it
            await ApiClient.post('/config', { key: 'imgRestaurantDefault', value: { Base64: dataUrl } });
            state.config.logo = dataUrl;
        }

        // Save Banner if Present or Deleted
        const bannerFile = $('conf-banner').files[0];
        if (bannerFile) {
            const bannerDataUrl = await compressBanner(bannerFile);
            await ApiClient.post('/config', { key: 'imgBannerDefault', value: { Base64: bannerDataUrl } });
            state.config.banner = bannerDataUrl;
        } else if (state.config.banner === '') {
            await ApiClient.post('/config', { key: 'imgBannerDefault', value: { Base64: '' } });
        }

        // Save Unified System Primary, Contrast, Sidebar Aside and Theme
        const primaryColor = state.config.primaryColor || $('conf-primary-color')?.value || '#f5b55f';
        const contrastColor = state.config.contrastColor || '#64010e';
        const sidebarColor = state.config.sidebarColor || $('conf-sidebar-color')?.value || '#052244';
        const themeId = state.config.themeId || 'custom';

        await Promise.all([
            ApiClient.post('/config', { key: 'uiPrimaryColor', value: primaryColor }),
            ApiClient.post('/config', { key: 'uiNameColor', value: primaryColor }),
            ApiClient.post('/config', { key: 'uiContrastColor', value: contrastColor }),
            ApiClient.post('/config', { key: 'uiBgAside', value: sidebarColor }),
            ApiClient.post('/config', { key: 'uiThemeId', value: themeId })
        ]);

        localStorage.setItem('digirest_primary_color', primaryColor);
        localStorage.setItem('digirest_contrast_color', contrastColor);
        localStorage.setItem('digirest_sidebar_color', sidebarColor);
        localStorage.setItem('digirest_theme_id', themeId);
        state.config.primaryColor = primaryColor;
        state.config.nameColor = primaryColor;
        state.config.contrastColor = contrastColor;
        state.config.sidebarColor = sidebarColor;
        state.config.themeId = themeId;

        // Save WhatsApp Templates
        const waTemplates = {
            recibido: $('conf-wa-recibido')?.value || DEFAULT_WA_TEMPLATES.recibido,
            preparacion: $('conf-wa-preparacion')?.value || DEFAULT_WA_TEMPLATES.preparacion,
            terminado_recoger: $('conf-wa-terminado-recoger')?.value || DEFAULT_WA_TEMPLATES.terminado_recoger,
            terminado_domicilio: $('conf-wa-terminado-domicilio')?.value || DEFAULT_WA_TEMPLATES.terminado_domicilio,
            reparto: $('conf-wa-reparto')?.value || DEFAULT_WA_TEMPLATES.reparto,
            entregado: $('conf-wa-entregado')?.value || DEFAULT_WA_TEMPLATES.entregado,
            anulado: $('conf-wa-anulado')?.value || DEFAULT_WA_TEMPLATES.anulado
        };
        await ApiClient.post('/config', { key: 'whatsappTemplates', value: waTemplates });
        state.whatsappTemplates = waTemplates;

        // Apply visual changes
        applyConfig();
        toast("Configuración guardada", "success");
    } catch (err) {
        console.error(err);
        showModalAlert("Error", "No se pudo guardar la configuración: " + err.message, "error");
    } finally {
        setLoading('btn-save-config', false);
    }
});

// --- USER WORK SCHEDULE LISTENERS ---
setupUserScheduleListeners(loadAdminUsers);

// --- THEME PICKER LISTENERS ---
initThemeListeners();

// --- ADMIN SIDEBAR MOBILE LOGIC ---
const adminSidebar = $('admin-sidebar');
const adminOverlay = $('admin-sidebar-overlay');
const btnAdminMenu = $('btn-admin-menu');
const btnCloseSidebar = $('btn-close-sidebar');

function toggleAdminSidebar() {
    if (!adminSidebar || !adminOverlay) return;
    const adminView = $('admin-view');
    const adminWrapper = $('admin-sidebar-wrapper');
    if (adminSidebar.classList.contains('-translate-x-full')) {
        // Elevate admin-view to override header stacking context
        if (adminView) {
            adminView.classList.add('z-[100]', 'relative');
        }
        if (adminWrapper) {
            adminWrapper.classList.add('z-[70]', 'relative');
        }
        adminSidebar.classList.remove('-translate-x-full');
        // Ensure it has scale 1 / translate 0
        adminSidebar.classList.add('translate-x-0');
        adminOverlay.classList.remove('hidden');
        setTimeout(() => adminOverlay.classList.remove('opacity-0'), 10);
    } else {
        adminSidebar.classList.remove('translate-x-0');
        adminSidebar.classList.add('-translate-x-full');
        adminOverlay.classList.add('opacity-0');
        setTimeout(() => {
            adminOverlay.classList.add('hidden');
            // Remove elevation
            if (adminView) {
                adminView.classList.remove('z-[100]');
            }
            if (adminWrapper) {
                adminWrapper.classList.remove('z-[70]');
            }
        }, 300);
    }
}

if (btnAdminMenu) {
    btnAdminMenu.addEventListener('click', toggleAdminSidebar);
}

btnCloseSidebar?.addEventListener('click', toggleAdminSidebar);
adminOverlay?.addEventListener('click', toggleAdminSidebar);

window.addEventListener('resize', alignSidebarSticky);

// Sidebar Accordion Sections
document.querySelectorAll('.admin-section-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const section = btn.closest('.admin-nav-section');
        if (section) {
            section.classList.toggle('collapsed');
        }
    });
});

// Tab switching is managed exclusively by AdminSidebar.vue

// Universal Table Action Dropdown Click Handler
document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.table-action-trigger');
    if (trigger) {
        e.stopPropagation();
        const container = trigger.closest('.table-action-container') || trigger.parentElement;
        const menu = container.querySelector('.table-action-menu');
        if (menu) {
            const isHidden = menu.classList.contains('hidden');
            // Close all open action menus first
            document.querySelectorAll('.table-action-menu').forEach(m => m.classList.add('hidden'));
            if (isHidden) {
                menu.classList.remove('hidden');
                // Use fixed positioning so it never gets clipped by table overflow-x-auto or overflow-hidden
                menu.style.position = 'fixed';
                menu.style.zIndex = '9999';
                menu.style.width = 'max-content';
                menu.style.maxWidth = '13.5rem';
                menu.style.right = 'auto'; // Prevent stretching caused by CSS right:0
                menu.style.bottom = 'auto';

                const triggerRect = trigger.getBoundingClientRect();
                const menuRect = menu.getBoundingClientRect();
                const menuWidth = menuRect.width || 160;
                const menuHeight = menuRect.height || 100;

                // Horizontal: align right edge with trigger's right edge
                let left = triggerRect.right - menuWidth;
                if (left < 10) left = 10;
                if (left + menuWidth > window.innerWidth - 10) {
                    left = window.innerWidth - menuWidth - 10;
                }
                menu.style.left = `${left}px`;

                // Vertical: check if it fits below
                if (triggerRect.bottom + menuHeight > window.innerHeight - 10) {
                    menu.style.top = `${Math.max(10, triggerRect.top - menuHeight - 4)}px`;
                } else {
                    menu.style.top = `${triggerRect.bottom + 4}px`;
                }
            }
        }
        return;
    }

    // If click inside table-action-menu item, close the menu
    if (e.target.closest('.table-action-menu button, .table-action-menu a')) {
        document.querySelectorAll('.table-action-menu').forEach(m => m.classList.add('hidden'));
        return;
    }

    // If click outside, close all open menus
    if (!e.target.closest('.table-action-menu')) {
        document.querySelectorAll('.table-action-menu').forEach(m => m.classList.add('hidden'));
    }
});

window.addEventListener('scroll', () => {
    document.querySelectorAll('.table-action-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
}, { passive: true });
window.addEventListener('resize', () => {
    document.querySelectorAll('.table-action-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
});

// --- CIERRE DE CAJA LOGIC ---

let allCierres = [];
let cierresPage = 1;
const CIERRES_PER_PAGE = 10;

async function loadCierreCaja() {
    loadCierreCajaHistory();
}

if ($('btn-refresh-cierres')) $('btn-refresh-cierres').onclick = loadCierreCajaHistory;

// Batch delete selected cierres
if ($('btn-delete-selected-cierres')) {
    $('btn-delete-selected-cierres').onclick = async function () {
        const selectedIds = window._selectedCierreIds;
        if (!selectedIds || selectedIds.size === 0) return;

        // showConfirmModal uses callbacks, wrap in Promise for async/await
        const confirmed = await new Promise((resolve) => {
            showConfirmModal(
                'Eliminar Cierres',
                `¿Estás seguro de eliminar ${selectedIds.size} registro(s) de cierre de caja? Esta acción no se puede deshacer.`,
                () => resolve(true),   // onConfirm (3rd param)
                () => resolve(false),  // onCancel (4th param)
                'Eliminar'             // okText (5th param)
            );
        });
        if (!confirmed) return;

        try {
            const ids = Array.from(selectedIds);
            await ApiClient.delete('/cierre-caja/batch', { ids });
            selectedIds.clear();
            toast(`${ids.length} registro(s) eliminado(s) correctamente`, 'success');
            loadCierreCajaHistory();
        } catch (e) {
            console.error(e);
            toast('Error al eliminar registros: ' + e.message, 'error');
        }
    };
}

if ($('filter-cierre-date')) {
    $('filter-cierre-date').onchange = () => {
        cierresPage = 1;
        renderCierresTable();
    };
}

if ($('btn-prev-cierres')) {
    $('btn-prev-cierres').onclick = () => {
        if (cierresPage > 1) {
            cierresPage--;
            renderCierresTable();
        }
    };
}

if ($('btn-next-cierres')) {
    $('btn-next-cierres').onclick = () => {
        cierresPage++;
        renderCierresTable();
    };
}

async function loadCierreCajaHistory() {
    const tbody = $('tbody-cierres-caja');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando historial...</td></tr>';

    try {
        const [res, resGastos] = await Promise.all([
            ApiClient.get('/cierre-caja'),
            ApiClient.get('/gastos-dia') // Load all gastos effectively
        ]);

        const gastos = resGastos?.data || [];
        
        if (res && res.data) {
            allCierres = res.data.map(c => {
                    // Parse date: supports both "YYYY-MM-DD" (ISO) and "DD/MM/YYYY" (legacy)
                    let d, m, y;
                    if (c.fecha && c.fecha.includes('/')) {
                        // Legacy format: DD/MM/YYYY
                        const parts = c.fecha.split('/');
                        if (parts.length === 3) {
                            d = parseInt(parts[0], 10);
                            m = parseInt(parts[1], 10);
                            y = parseInt(parts[2], 10);
                        }
                    } else if (c.fecha && c.fecha.includes('-')) {
                        // ISO format: YYYY-MM-DD
                        const parts = c.fecha.split('-');
                        if (parts.length === 3) {
                            y = parseInt(parts[0], 10);
                            m = parseInt(parts[1], 10);
                            d = parseInt(parts[2], 10);
                        }
                    }
                    
                    if (!d || !m || !y) return c; // Fallback if unparseable
                    
                    // Sum gastos for this specific day
                    const dayGastos = gastos.filter(g => {
                        if (!g.timestamp) return false;
                        // Fix SQLite datetime UTC to Local assumption
                        let t = g.timestamp;
                        if (!t.includes('Z') && !t.includes('T')) {
                            t = t.replace(' ', 'T') + 'Z';
                        }
                        const gd = new Date(t);
                        gd.setHours(gd.getHours() - 5); // Adjust from UTC if SQLite generated it, roughly matches Colombia (-5)
                        
                        // But if JS created the timestamp via Date.now(), it has 'Z'.
                        // Let's just compare Y, M, D ignoring strict timezone if they perfectly match local.
                        const gRealD = new Date(g.timestamp);
                        // Safe approach: we check if date string matches exactly "YYYY-MM-DD" or local.
                        return gRealD.getDate() === d && (gRealD.getMonth() + 1) === m && gRealD.getFullYear() === y;
                    });
                
                const sumGastos = dayGastos.reduce((acc, current) => acc + (Number(current.valor) || 0), 0);
                
                // Si la BD devolvió 0 o null y existían gastos, los actualizamos en la vista:
                const finalTotalGastos = (c.total_gastos > 0) ? Number(c.total_gastos) : sumGastos;
                
                // Recalculamos el Total General para la presentación considerando que si el cierre se guardó con 0 gastos, el total general en DB es mayor al real ajustado.
                let finalTotalGeneral = Number(c.total_general) || 0;
                if (!c.total_gastos && sumGastos > 0) {
                     finalTotalGeneral = (Number(c.ingreso_efectivo) || 0) + (Number(c.ingreso_transferencia) || 0) - sumGastos;
                }
                
                return {
                    ...c,
                    total_gastos: finalTotalGastos,
                    total_general: finalTotalGeneral
                };
            });
            cierresPage = 1;
            renderCierresTable();
        } else {
            allCierres = [];
            renderCierresTable();
        }
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-red-400">Error cargando historial.</td></tr>';
    }
}

function renderCierresTable() {
    const tbody = $('tbody-cierres-caja');
    if (!tbody) return;

    let filtered = allCierres;
    const filterDate = $('filter-cierre-date')?.value;

    if (filterDate) {
        const [year, month, day] = filterDate.split('-');
        const d = parseInt(day, 10);
        const m = parseInt(month, 10);

        filtered = allCierres.filter(c => {
            return c.fecha === `${d}/${m}/${year}` ||
                c.fecha === `${day}/${month}/${year}` ||
                c.fecha === filterDate;
        });
    }

    // Track selected IDs for batch delete
    if (!window._selectedCierreIds) window._selectedCierreIds = new Set();
    const selectedIds = window._selectedCierreIds;

    const isAdmin = state.user && state.user.role === 'admin';

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-gray-400">No hay cierres registrados.</td></tr>';
        if ($('cierres-page-info')) $('cierres-page-info').innerText = 'Página 1';
        if ($('btn-prev-cierres')) $('btn-prev-cierres').disabled = true;
        if ($('btn-next-cierres')) $('btn-next-cierres').disabled = true;
        // Hide delete button when no results
        if ($('btn-delete-selected-cierres')) $('btn-delete-selected-cierres').classList.add('hidden');
        return;
    }

    const totalPages = Math.ceil(filtered.length / CIERRES_PER_PAGE);
    if (cierresPage > totalPages) cierresPage = totalPages;

    const start = (cierresPage - 1) * CIERRES_PER_PAGE;
    const end = start + CIERRES_PER_PAGE;
    const pageItems = filtered.slice(start, end);

    tbody.innerHTML = pageItems.map(c => {
        const id = c.id;
        const checked = selectedIds.has(id) ? 'checked' : '';
        return `
        <tr class="hover:bg-gray-50 transition-colors">
            <td class="p-4 text-center">
                ${isAdmin ? `<input type="checkbox" class="cierre-select rounded border-gray-300 text-red-500 focus:ring-red-500 cursor-pointer" data-id="${id}" ${checked}>`
                          : '<span class="text-gray-300 text-xs">-</span>'}
            </td>
            <td class="p-4 font-bold text-gray-800">${c.fecha} <span class="text-xs text-gray-400 ml-1">${c.hora}</span></td>
            <td class="p-4"><span class="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">${c.cantidad_pedidos} ped.</span> <span class="text-xs text-gray-500 ml-1">/ ${c.cantidad_platos} platos</span></td>
            <td class="p-4 text-red-500 font-bold">${c.total_anulados} uds</td>
            <td class="p-4 text-green-600 font-bold">${formatMoney(c.ingreso_efectivo)}</td>
            <td class="p-4 text-blue-600 font-bold">${formatMoney(c.ingreso_transferencia)}</td>
            <td class="p-4 text-red-500 font-bold">${formatMoney(c.total_gastos || 0)}</td>
            <td class="p-4 text-gray-900 font-black border-l border-gray-100">${formatMoney(c.total_general)}</td>
            <td class="p-4 text-center text-gray-500 text-xs">${escapeHtml(c.usuario || '')}</td>
        </tr>
    `}).join('');

    // Attach checkbox listeners
    document.querySelectorAll('.cierre-select').forEach(cb => {
        cb.addEventListener('change', function () {
            const id = parseInt(this.dataset.id, 10);
            if (this.checked) {
                selectedIds.add(id);
            } else {
                selectedIds.delete(id);
                // Uncheck select-all if any unchecked
                const selectAll = $('select-all-cierres');
                if (selectAll) selectAll.checked = false;
            }
            updateDeleteButton();
        });
    });

    // Select-all logic — use onclick to prevent stacking listeners on each render
    const selectAll = $('select-all-cierres');
    if (selectAll) {
        selectAll.onclick = function () {
            // Toggle based on current state
            const checked = this.checked;
            document.querySelectorAll('.cierre-select').forEach(cb => {
                const id = parseInt(cb.dataset.id, 10);
                cb.checked = checked;
                if (checked) {
                    selectedIds.add(id);
                } else {
                    selectedIds.delete(id);
                }
            });
            updateDeleteButton();
        };
    }

    // Show/hide delete button based on role
    const deleteBtn = $('btn-delete-selected-cierres');
    if (deleteBtn) {
        if (isAdmin) {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }

    // Update delete button state
    function updateDeleteButton() {
        const deleteBtn = $('btn-delete-selected-cierres');
        const countSpan = $('delete-cierres-count');
        if (deleteBtn && countSpan) {
            const count = selectedIds.size;
            if (count > 0) {
                countSpan.textContent = `Eliminar (${count})`;
                deleteBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                deleteBtn.disabled = false;
            } else {
                countSpan.textContent = 'Eliminar';
                deleteBtn.classList.add('opacity-50', 'cursor-not-allowed');
                deleteBtn.disabled = true;
            }
        }
    }
    updateDeleteButton();

    if ($('cierres-page-info')) $('cierres-page-info').innerText = `Página ${cierresPage} de ${totalPages}`;
    if ($('btn-prev-cierres')) $('btn-prev-cierres').disabled = cierresPage === 1;
    if ($('btn-next-cierres')) $('btn-next-cierres').disabled = cierresPage === totalPages;
}


// EDIT ORDER LOGIC
function renderEditItems() {
    const list = $('oe-items-list');
    list.innerHTML = '';
    let total = 0;

    if (!currentEditingOrder || !currentEditingOrder.items) return;

    currentEditingOrder.items.forEach((item, index) => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;

        const div = document.createElement('div');
        div.className = 'flex flex-col md:flex-row md:justify-between md:items-center gap-2 md:gap-3 bg-white p-2 rounded-lg border border-gray-100 shadow-sm';
        div.innerHTML = `
            <div class="flex-1">
                <div class="font-bold text-gray-800 text-sm">${escapeHtml(item.name)}</div>
                <div class="text-xs text-gray-400">${formatMoney(item.price)} c/u</div>
            </div>
            <div class="flex items-center justify-between md:justify-end gap-3">
                <div class="flex items-center bg-gray-50 rounded-lg border border-gray-200">
                    <button type="button" class="w-10 h-6 flex items-center justify-center text-gray-500 hover:text-orange-500 transition-colors" onclick="updateEditItemQty(${index}, -1)">-</button>
                    <span class="w-10 text-center font-bold text-sm text-gray-700">${item.qty}</span>
                    <button type="button" class="w-10 h-6 flex items-center justify-center text-gray-500 hover:text-orange-500 transition-colors" onclick="updateEditItemQty(${index}, 1)">+</button>
                </div>
                <button type="button" class="text-red-400 hover:text-red-600 w-10 h-10 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors" onclick="removeEditItem(${index})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        list.appendChild(div);
    });

    const tip = parseFloat($('oe-tip').value) || 0;
    const desc = parseFloat($('oe-discount').value) || 0;
    const finalTotal = total + tip - desc;

    $('oe-total').innerText = `Total: ${formatMoney(finalTotal)}`;
    currentEditingOrder.total = finalTotal;
}

window.updateEditItemQty = (index, change) => {
    const item = currentEditingOrder.items[index];
    const newQty = item.qty + change;
    if (newQty > 0) {
        item.qty = newQty;
        renderEditItems();
    }
};

window.removeEditItem = (index) => {
    currentEditingOrder.items.splice(index, 1);
    renderEditItems();
};

$('btn-oe-add').addEventListener('click', () => {
    const select = $('oe-add-product');
    const productId = select.value;
    if (!productId) return;

    const product = state.products.find(p => p.id === productId);
    if (product) {
        // Check if already exists
        const existing = currentEditingOrder.items.find(i => i.name === product.name);
        if (existing) {
            existing.qty++;
        } else {
            currentEditingOrder.items.push({
                name: product.name,
                price: product.price,
                qty: 1
            });
        }
        renderEditItems();
        select.value = "";
    }
});

$('btn-close-oe').addEventListener('click', () => $('order-edit-modal').classList.add('hidden'));
$('btn-cancel-oe').addEventListener('click', () => $('order-edit-modal').classList.add('hidden'));

// Dynamic Fields Logic for Edit Modal
function toggleEditFields() {
    if (!currentEditingOrder) return;

    const type = $('oe-type').value;
    const pay = $('oe-pay').value;
    const isWaiter = currentEditingOrder.isWaiterOrder;

    if (!isWaiter) {
        if (type === 'Domicilio') $('oe-address').parentElement.classList.remove('hidden');
        else $('oe-address').parentElement.classList.add('hidden');
    } else {
        // For waiter orders, show address (customer data now editable)
        $('oe-address').parentElement.classList.remove('hidden');
    }

    const accountContainer = $('oe-account-container');
    const mixedContainer = $('oe-mixed-container');
    const proofContainer = $('oe-proof-container');
    const noProofMsg = $('oe-no-proof');
    const currentProofImg = $('oe-current-proof');

    if (pay === 'Mixto') {
        if (accountContainer) accountContainer.classList.add('hidden');
        if (mixedContainer) mixedContainer.classList.remove('hidden');
        if (proofContainer) proofContainer.classList.remove('hidden');
        if (currentProofImg) {
            if (currentEditingOrder.proof) {
                currentProofImg.classList.remove('hidden');
                if (noProofMsg) noProofMsg.classList.add('hidden');
            } else {
                currentProofImg.classList.add('hidden');
                if (noProofMsg) noProofMsg.classList.remove('hidden');
            }
        }
    } else if (pay === 'Transferencia') {
        if (accountContainer) accountContainer.classList.remove('hidden');
        if (mixedContainer) mixedContainer.classList.add('hidden');
        if (proofContainer) proofContainer.classList.remove('hidden');
        if (currentProofImg) {
            if (currentEditingOrder.proof) {
                currentProofImg.classList.remove('hidden');
                if (noProofMsg) noProofMsg.classList.add('hidden');
            } else {
                currentProofImg.classList.add('hidden');
                if (noProofMsg) noProofMsg.classList.remove('hidden');
            }
        }
    } else {
        // Efectivo, Datáfono, etc.
        if (accountContainer) accountContainer.classList.remove('hidden');
        if (mixedContainer) mixedContainer.classList.add('hidden');
        if (proofContainer) proofContainer.classList.add('hidden');
        if (noProofMsg) noProofMsg.classList.add('hidden');
        if (currentProofImg) {
            if (currentEditingOrder.proof) {
                currentProofImg.classList.remove('hidden');
            } else {
                currentProofImg.classList.add('hidden');
            }
        }
    }
}

$('oe-type').addEventListener('change', toggleEditFields);
$('oe-pay').addEventListener('change', toggleEditFields);

// Add image compression to edit modal proof upload
$('oe-proof').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            const compressedBlob = await compressProof(file);
            // Convert Blob to File with WebP extension
            const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
            const compressedFile = new File([compressedBlob], newName, {
                type: 'image/webp',
                lastModified: Date.now()
            });
            // Store compressed file for later use
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(compressedFile);
            e.target.files = dataTransfer.files;
            toast("Imagen comprimida correctamente", "success");
        } catch (err) {
            console.error("Error compressing proof:", err);
            toast("Error comprimiendo imagen, usando original", "warning");
        }
    }
});

$('order-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditingOrder) return;

    setLoading('btn-save-oe', true, "Actualizando...");

    try {
        const file = $('oe-proof').files[0];

        // Check if we need to upload a new proof
        const tipVal = parseFloat($('oe-tip').value) || 0;
        const discountVal = parseFloat($('oe-discount').value) || 0;
        const discountReasonVal = $('oe-discount-reason').value || "";
        
        // Base item total calculated from items logic
        const baseItemsTotal = currentEditingOrder.items.reduce((sum, item) => sum + (parseFloat(item.price) * parseInt(item.qty)), 0);
        // Adjusted Total Calculation
        const calculatedTotal = baseItemsTotal + tipVal - discountVal;

        // ── OFFLINE / TEMP ID ORDER SAVE PATH ──
        const isTempId = String(currentEditingOrder.id).startsWith('OFF-');
        const payMethod = $('oe-pay').value;
        const isTransferOrMixed = payMethod === 'Transferencia' || payMethod === 'Mixto';
        const cashAmt = payMethod === 'Mixto' ? (parseFloat($('oe-mixed-cash')?.value) || 0) : (payMethod === 'Efectivo' ? calculatedTotal : 0);
        const transAmt = payMethod === 'Mixto' ? (parseFloat($('oe-mixed-transfer')?.value) || 0) : (payMethod === 'Transferencia' ? calculatedTotal : 0);
        const cashAccId = payMethod === 'Mixto' ? ($('oe-mixed-cash-account')?.value ? parseInt($('oe-mixed-cash-account').value) : null) : (payMethod === 'Efectivo' && $('oe-account')?.value ? parseInt($('oe-account').value) : null);
        const transAccId = payMethod === 'Mixto' ? ($('oe-mixed-transfer-account')?.value ? parseInt($('oe-mixed-transfer-account').value) : null) : (payMethod === 'Transferencia' && $('oe-account')?.value ? parseInt($('oe-account').value) : null);
        const accId = payMethod !== 'Mixto' && $('oe-account')?.value ? parseInt($('oe-account').value) : null;

        // Save locally when: offline, has temp ID, or has _offline flag
        if (currentEditingOrder._offline === true || isTempId || !navigator.onLine) {
            // Build updated order object
            let proofValue = currentEditingOrder.proof;
            if (file && isTransferOrMixed) {
                // Convert file to data URL for offline storage
                proofValue = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            } else if (!isTransferOrMixed) {
                proofValue = undefined; // Remove proof if not transfer/mixed
            }

            const updatedOfflineOrder = {
                ...currentEditingOrder,
                client: $('oe-client').value,
                phone: $('oe-phone').value,
                payment: payMethod,
                status: $('oe-status').value,
                address: $('oe-address').value,
                notes: $('oe-notes').value,
                type: $('oe-type').value,
                table: $('oe-table').value,
                items: currentEditingOrder.items,
                tip: tipVal,
                discount: discountVal,
                discount_reason: discountReasonVal,
                total: calculatedTotal,
                proof: proofValue,
                account_id: accId,
                cash_amount: cashAmt,
                transfer_amount: transAmt,
                cash_account_id: cashAccId,
                transfer_account_id: transAccId,
                _editedAt: Date.now()
            };

            // Stringify items for IndexedDB (consistent with createOrder)
            updatedOfflineOrder.items = JSON.stringify(currentEditingOrder.items);

            // Save to offline_orders store in IndexedDB
            await OfflineDB.saveOfflineOrder(updatedOfflineOrder);

            // Also update the queued POST request body so sync sends updated data.
            // Include waiterId/waiterName to prevent null fields after sync.
            const queueBody = {
                client: $('oe-client').value,
                phone: $('oe-phone').value,
                payment: payMethod,
                address: $('oe-address').value,
                notes: $('oe-notes').value,
                type: $('oe-type').value,
                table: $('oe-table').value,
                items: JSON.stringify(currentEditingOrder.items),
                tip: tipVal,
                discount: discountVal,
                discount_reason: discountReasonVal,
                total: calculatedTotal,
                proof: proofValue,
                status: $('oe-status').value,
                account_id: accId,
                cash_amount: cashAmt,
                transfer_amount: transAmt,
                cash_account_id: cashAccId,
                transfer_account_id: transAccId,
                waiterId: currentEditingOrder.waiterId || null,
                waiterName: currentEditingOrder.waiterName || null,
                chefName: currentEditingOrder.chefName || null,
                deliveryDriverName: currentEditingOrder.deliveryDriverName || null
            };
            const updatedQueued = await OfflineDB.updateQueuedRequestByOfflineId(currentEditingOrder.id, queueBody);
            // If no queued POST was found (e.g., order was already synced), enqueue a PUT instead
            if (!updatedQueued) {
                await OfflineDB.enqueueRequest({
                    url: `/orders/${currentEditingOrder.id}`,
                    method: 'PUT',
                    body: queueBody,
                    _offlineId: currentEditingOrder.id
                });
            }

            // Update in-memory state (items are arrays in state)
            updatedOfflineOrder.items = currentEditingOrder.items;
            const idx = state.orders.findIndex(o => o.id === currentEditingOrder.id);
            if (idx !== -1) {
                state.orders[idx] = updatedOfflineOrder;
            }
            // Also update waiterOrders if present
            const waIdx = state.waiterOrders ? state.waiterOrders.findIndex(o => o.id === currentEditingOrder.id) : -1;
            if (waIdx !== -1) {
                state.waiterOrders[waIdx] = { ...updatedOfflineOrder, items: currentEditingOrder.items };
            }
            if (window.renderRapidManagement) {
                window.renderRapidManagement();
            }

            // Reload admin table to reflect changes instantly
            if (window.reloadAdminData) {
                await window.reloadAdminData();
            }

            toast("Pedido local actualizado", "success");
            $('order-edit-modal').classList.add('hidden');
            setLoading('btn-save-oe', false);
            return;
        }

        // ── ONLINE ORDER SAVE PATH ──
        if (file && isTransferOrMixed) {
            // Use FormData to send file with compressed image
            const formData = new FormData();
            formData.append('proof', file); // compressed file from change listener
            formData.append('client', $('oe-client').value);
            formData.append('phone', $('oe-phone').value);
            formData.append('payment', payMethod);
            formData.append('status', $('oe-status').value);
            formData.append('address', $('oe-address').value);
            formData.append('notes', $('oe-notes').value);
            formData.append('type', $('oe-type').value);
            formData.append('table', $('oe-table').value);
            formData.append('items', JSON.stringify(currentEditingOrder.items));
            formData.append('tip', tipVal);
            formData.append('discount', discountVal);
            formData.append('discount_reason', discountReasonVal);
            formData.append('cash_amount', cashAmt);
            formData.append('transfer_amount', transAmt);
            if (cashAccId) formData.append('cash_account_id', cashAccId);
            if (transAccId) formData.append('transfer_account_id', transAccId);
            if (accId) formData.append('account_id', accId);

            // Include user fields to prevent null after update
            if (currentEditingOrder.waiterId) formData.append('waiterId', currentEditingOrder.waiterId);
            if (currentEditingOrder.waiterName) formData.append('waiterName', currentEditingOrder.waiterName);
            if (currentEditingOrder.chefName) formData.append('chefName', currentEditingOrder.chefName);
            if (currentEditingOrder.deliveryDriverName) formData.append('deliveryDriverName', currentEditingOrder.deliveryDriverName);

            // Recalculate total before sending
            formData.append('total', calculatedTotal);
            if (currentEditingOrder._authorized) {
                formData.append('adminVerified', 'true');
            }

            // ApiClient.put now handles FormData automatically
            await ApiClient.put(`/orders/${currentEditingOrder.id}`, formData);
        } else {
            // No file upload, use regular JSON
            const updatedData = {
                client: $('oe-client').value,
                phone: $('oe-phone').value,
                payment: payMethod,
                status: $('oe-status').value,
                address: $('oe-address').value,
                notes: $('oe-notes').value,
                type: $('oe-type').value,
                table: $('oe-table').value,
                items: currentEditingOrder.items,
                tip: tipVal,
                discount: discountVal,
                discount_reason: discountReasonVal,
                total: calculatedTotal,
                proof: isTransferOrMixed ? undefined : "",
                account_id: accId,
                cash_amount: cashAmt,
                transfer_amount: transAmt,
                cash_account_id: cashAccId,
                transfer_account_id: transAccId,
                // Include user fields to prevent null after update
                waiterId: currentEditingOrder.waiterId || null,
                waiterName: currentEditingOrder.waiterName || null,
                chefName: currentEditingOrder.chefName || null,
                deliveryDriverName: currentEditingOrder.deliveryDriverName || null,
                adminVerified: !!currentEditingOrder._authorized
            };

            await ApiClient.put(`/orders/${currentEditingOrder.id}`, updatedData);
        }

        // Force local state update for instant UI response before server pushes it back
        const updateInArray = (arr) => {
            if (!arr) return;
            const idx = arr.findIndex(o => o.id == currentEditingOrder.id);
            if (idx !== -1) {
                arr[idx].items = currentEditingOrder.items;
                arr[idx].total = calculatedTotal;
                arr[idx].tip = tipVal;
                arr[idx].discount = discountVal;
                arr[idx].discount_reason = discountReasonVal;
                arr[idx].status = $('oe-status').value;
                arr[idx].payment = payMethod;
                arr[idx].client = $('oe-client').value;
                arr[idx].type = $('oe-type').value;
                arr[idx].table = $('oe-table').value;
                arr[idx].notes = $('oe-notes').value;
                arr[idx].account_id = accId;
                arr[idx].cash_amount = cashAmt;
                arr[idx].transfer_amount = transAmt;
                arr[idx].cash_account_id = cashAccId;
                arr[idx].transfer_account_id = transAccId;
            }
        };
        updateInArray(state.orders);
        updateInArray(state.waiterOrders);

        if (window.renderRapidManagement) {
            window.renderRapidManagement();
        }

        // Reload admin data to reflect changes (also works offline via IndexedDB merge)
        if (window.reloadAdminData) {
            await window.reloadAdminData();
        }

        toast("Pedido actualizado correctamente");
        $('order-edit-modal').classList.add('hidden');
    } catch (e) {
        console.error(e);
        showModalAlert("Error", "Error actualizando pedido", "error");
    } finally {
        setLoading('btn-save-oe', false);
    }
});

// Archived Orders Logic
let allArchivedOrders = [];
const ARCHIVED_PER_PAGE = 10;

async function loadArchivedOrders() {
    const list = $('archived-list');
    if (!list) return;

    list.innerHTML = '<div class="text-center py-10"><i class="fas fa-spinner fa-spin text-2xl text-gray-300"></i></div>';

    try {
        if (allArchivedOrders.length === 0) {
            // Fetch all orders and filter locally (Phase 3 strategy)
            const allOrders = await ApiClient.get('/orders');

            // Filter for archived statuses
            allArchivedOrders = allOrders.filter(o => {
                const s = o.status;
                return s === 'Terminado' || s === 'En Reparto' || s === 'Entregado' || s === 'Cobrado';
            });

            // Normalize isWaiter for consistency if not present (backend provides waiterId)
            allArchivedOrders = allArchivedOrders.map(o => ({
                ...o,
                isWaiter: !!o.waiterId // Helper flag if needed by display logic
            }));

            allArchivedOrders.sort((a, b) => {
                const dateA = getSafeDate(a.date || a.timestamp);
                const dateB = getSafeDate(b.date || b.timestamp);
                return dateB - dateA;
            });
        }

        if (allArchivedOrders.length === 0) {
            list.innerHTML = '<div class="text-center py-10 text-gray-400">No hay pedidos archivados.</div>';
            return;
        }

        if (!state.archivedPage) state.archivedPage = 1;

        // Filter for delivery role
        let displayOrders = allArchivedOrders;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (state.user && (state.user.role === 'chef' || state.user.role === 'cocinero')) {
            displayOrders = allArchivedOrders.filter(o => {
                const orderDate = getSafeDate(o.timestamp || o.date);
                return orderDate >= today;
            });
        }

        if (state.user && (state.user.role === 'delivery' || state.user.role === 'repartidor')) {

            displayOrders = allArchivedOrders.filter(o => {
                if (o.type !== 'Domicilio') return false;
                if (o.status !== 'Entregado' && o.status !== 'Cobrado') return false;
                // Only show orders delivered by THIS driver (check ID or Name for backward compatibility)
                if (o.deliveryDriverId !== state.user.id && o.deliveryDriverName !== state.user.name) return false;

                const orderDate = getSafeDate(o.date || o.timestamp);
                return orderDate >= today;
            });
        }

        const start = (state.archivedPage - 1) * ARCHIVED_PER_PAGE;
        const end = start + ARCHIVED_PER_PAGE;
        const pageItems = displayOrders.slice(start, end);

        list.innerHTML = pageItems.map(o => `
            <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex justify-between items-center mb-2 cursor-pointer hover:bg-gray-50 transition-colors archived-card" data-id="${o.id}">
                <div>
                    <span class="font-bold text-gray-800">#${o.id}</span>
                    <span class="text-xs text-gray-400 mx-2">|</span>
                    <span class="text-sm text-gray-600">${escapeHtml(o.client || (o.waiterName ? `Mesero: ${o.waiterName}` : 'Cliente'))}</span>
                </div>
                <div class="text-right">
                    <span class="text-xs font-bold px-2 py-1 rounded ${o.status === 'Terminado' ? 'text-green-600 bg-green-50' : (o.status === 'En Reparto' ? 'text-blue-600 bg-blue-50' : 'text-gray-600 bg-gray-50')}">${o.status}</span>
                    <p class="text-[10px] text-gray-400 mt-1">${o.displayDate || getSafeDate(o.timestamp || o.date).toLocaleString()}</p>
                </div>
            </div>
        `).join('');

        // Attach listeners
        list.querySelectorAll('.archived-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const order = allArchivedOrders.find(o => o.id === id);
                if (order && window.showOrderDetails) {
                    window.showOrderDetails(order);
                }
            });
        });

        const btnPrev = $('btn-prev-archived');
        const btnNext = $('btn-next-archived');
        if (btnPrev) btnPrev.disabled = state.archivedPage === 1;
        if (btnNext) btnNext.disabled = end >= displayOrders.length;

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="text-center py-10 text-red-400">Error cargando archivados.</div>';
    }
}

// Archived Listeners
const openArchived = () => {
    $('chef-archived-modal').classList.remove('hidden');
    state.archivedPage = 1;
    allArchivedOrders = [];
    loadArchivedOrders();
};
window.openArchived = openArchived;

$('btn-chef-archived')?.addEventListener('click', openArchived);
$('btn-delivery-archived')?.addEventListener('click', openArchived);
$('btn-close-archived')?.addEventListener('click', () => $('chef-archived-modal').classList.add('hidden'));

$('btn-prev-archived')?.addEventListener('click', () => {
    if (state.archivedPage > 1) {
        state.archivedPage--;
        loadArchivedOrders();
    }
});

$('btn-next-archived')?.addEventListener('click', () => {
    state.archivedPage++;
    loadArchivedOrders();
});

// Render transfer bank accounts in checkout
export function renderTransferBankDetails() {
    const details = $('transfer-details');
    if (!details) return;

    const banks = Array.isArray(state.bankAccounts) && state.bankAccounts.length > 0 
        ? state.bankAccounts.filter(b => b.bank || b.number) 
        : (state.accountData && (state.accountData.typeAcount || state.accountData.number) 
            ? [{ bank: state.accountData.typeAcount, holder: state.accountData.name, number: state.accountData.number, type: 'Ahorros' }] 
            : []);

    if (banks.length === 0) {
        details.innerHTML = `<p class="text-sky-700 italic text-[11px]">No hay cuentas bancarias configuradas actualmente.</p>`;
        return;
    }

    details.innerHTML = banks.map((b, idx) => `
        <div class="bg-white p-2.5 rounded-xl border border-sky-200/90 shadow-2xs space-y-1">
            <div class="flex items-center justify-between">
                <span class="font-black text-sky-950 text-xs flex items-center gap-1.5">
                    <i class="fas fa-university text-sky-600"></i> ${b.bank || 'Banco'}
                </span>
                <span class="text-[9px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-md uppercase">
                    ${b.type || 'Cuenta'}
                </span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-gray-700 pt-0.5">
                <div>
                    <span class="text-gray-400 text-[9px] block leading-tight">Titular</span>
                    <span class="font-bold">${b.holder || 'Restaurante'}</span>
                </div>
                <div class="text-right">
                    <span class="text-gray-400 text-[9px] block leading-tight">Número</span>
                    <div class="flex items-center gap-1 justify-end">
                        <span class="font-black font-mono text-gray-900 text-xs">${b.number || 'N/A'}</span>
                        ${b.number ? `
                            <button type="button" onclick="navigator.clipboard?.writeText('${b.number}'); toast('Número copiado al portapapeles', 'info')" class="text-sky-600 hover:text-sky-800 p-0.5 text-[11px] cursor-pointer" title="Copiar número">
                                <i class="far fa-copy"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function getClientCartTotal() {
    const cartSubtotal = (state.cart || []).reduce((a, b) => a + (b.price * b.qty), 0);
    const orderType = $('c-type')?.value;
    let deliveryFee = 0;
    if (orderType === 'Domicilio') {
        const zoneId = $('c-zone')?.value;
        const selectedZone = (state.deliveryZones || []).find(z => z.id === zoneId);
        if (selectedZone) deliveryFee = parseFloat(selectedZone.fee) || 0;
    }
    return cartSubtotal + deliveryFee;
}

export function renderClientMixedRows() {
    const container = $('client-mixed-rows');
    if (!container) return;
    container.innerHTML = '';

    const total = getClientCartTotal();

    if (!Array.isArray(state.clientSplits) || state.clientSplits.length === 0) {
        const half = Math.round(total / 2);
        state.clientSplits = [
            { method: 'Efectivo', amount: half },
            { method: 'Transferencia', amount: Math.max(0, total - half) }
        ];
    }

    state.clientSplits.forEach((split, index) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-white p-2 rounded-xl border border-amber-200/80 shadow-2xs';

        const canDelete = state.clientSplits.length > 1;

        row.innerHTML = `
            <div class="w-1/2">
                <select class="client-split-method w-full p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none" data-index="${index}">
                    <option value="Efectivo" ${split.method === 'Efectivo' ? 'selected' : ''}>Efectivo</option>
                    <option value="Transferencia" ${split.method === 'Transferencia' ? 'selected' : ''}>Transferencia</option>
                </select>
            </div>
            <div class="w-1/2 flex items-center gap-1">
                <input type="number" min="0" step="any" class="client-split-amount w-full p-1.5 text-right font-black text-xs text-gray-900 border border-gray-200 rounded-lg outline-none focus:border-amber-500" placeholder="$0" value="${split.amount > 0 ? split.amount : ''}" data-index="${index}">
                ${canDelete ? `
                    <button type="button" class="btn-delete-client-split p-1.5 text-red-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer" data-index="${index}" title="Eliminar fila">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                ` : ''}
            </div>
        `;
        container.appendChild(row);
    });

    container.querySelectorAll('.client-split-method').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            state.clientSplits[idx].method = e.target.value;
            updateClientMixedBalance();
        });
    });

    container.querySelectorAll('.client-split-amount').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            let val = parseFloat(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            state.clientSplits[idx].amount = val;
            updateClientMixedBalance();
        });
    });

    container.querySelectorAll('.btn-delete-client-split').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            if (state.clientSplits.length > 1) {
                state.clientSplits.splice(idx, 1);
                renderClientMixedRows();
                updateClientMixedBalance();
            }
        });
    });

    updateClientMixedBalance();
}

export function updateClientMixedBalance() {
    const total = getClientCartTotal();
    const assigned = (state.clientSplits || []).reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
    const remaining = total - assigned;

    const totalBadge = $('client-mixed-total-badge');
    if (totalBadge) totalBadge.textContent = formatMoney(total);

    const statusBadge = $('client-mixed-balance-status');
    if (statusBadge) {
        if (Math.abs(remaining) < 1) {
            statusBadge.textContent = '✓ Cuadrado';
            statusBadge.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 mb-1 px-2 py-0.5 rounded-full';
        } else if (remaining > 0) {
            statusBadge.textContent = `Falta: ${formatMoney(remaining)}`;
            statusBadge.className = 'text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full';
        } else {
            statusBadge.textContent = `Sobra: ${formatMoney(Math.abs(remaining))}`;
            statusBadge.className = 'text-[10px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full';
        }
    }

    // Check if any split is Transferencia
    const hasTransfer = (state.clientSplits || []).some(s => s.method === 'Transferencia');
    if (hasTransfer) {
        $('transfer-info')?.classList.remove('hidden');
        $('proof-container')?.classList.remove('hidden');
        renderTransferBankDetails();
    } else {
        $('transfer-info')?.classList.add('hidden');
        $('proof-container')?.classList.add('hidden');
    }
}
window.updateClientMixedBalance = updateClientMixedBalance;

$('btn-client-add-split')?.addEventListener('click', () => {
    const total = getClientCartTotal();
    const assigned = (state.clientSplits || []).reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
    const rem = Math.max(0, total - assigned);

    const existing = (state.clientSplits || []).map(s => s.method);
    const nextMethod = existing.includes('Transferencia') ? 'Efectivo' : 'Transferencia';

    if (!state.clientSplits) state.clientSplits = [];
    state.clientSplits.push({ method: nextMethod, amount: rem });

    renderClientMixedRows();
    updateClientMixedBalance();
});

// Checkout Listeners
$('c-pay')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'Transferencia') {
        $('client-mixed-container')?.classList.add('hidden');
        $('transfer-info')?.classList.remove('hidden');
        $('proof-container')?.classList.remove('hidden');
        renderTransferBankDetails();
    } else if (val === 'Mixto') {
        $('client-mixed-container')?.classList.remove('hidden');
        renderClientMixedRows();
    } else {
        $('client-mixed-container')?.classList.add('hidden');
        $('transfer-info')?.classList.add('hidden');
        $('proof-container')?.classList.add('hidden');

        // Reset proof if switching away from Transferencia
        $('c-proof').value = '';
        state.tempProofFile = null;
        $('proof-msg').innerText = '';
        $('proof-msg').classList.add('hidden');
    }

    window.validateCheckoutButton();
});

$('c-type')?.addEventListener('change', (e) => {
    const isDomicilio = e.target.value === 'Domicilio';
    if (isDomicilio) {
        populateClientDeliveryZones();
        $('c-address')?.classList.remove('hidden');
        $('delivery-zone-container')?.classList.remove('hidden');
    } else {
        $('c-address')?.classList.add('hidden');
        $('delivery-zone-container')?.classList.add('hidden');
    }
    updateCheckoutTotals();
    window.validateCheckoutButton();
});

$('c-zone')?.addEventListener('change', () => {
    updateCheckoutTotals();
    window.validateCheckoutButton();
});

// Admin Orders Pagination
$('btn-prev-admin')?.addEventListener('click', () => {
    if (state.adminPage > 1) {
        state.adminPage--;
        // We need to re-render. Since orders are listened to, we might need to store them or trigger a re-render.
        // renderAdminOrdersTable is called by listenToOrders callback.
        // We can't easily trigger it without the orders data.
        // But wait, listenToOrders in main.js calls renderAdminOrdersTable.
        // We need to store the orders in state to re-render them.
        if (state.orders) renderAdminOrdersTable(state.orders);
    }
});

$('btn-next-admin')?.addEventListener('click', () => {
    state.adminPage++;
    if (state.orders) renderAdminOrdersTable(state.orders);
});

// Admin Waiter Pagination
$('btn-prev-waiter-admin')?.addEventListener('click', () => {
    if (state.adminWaiterPage > 1) {
        state.adminWaiterPage--;
        if (state.waiterOrders) renderAdminWaiterOrders(state.waiterOrders);
    }
});

$('btn-next-waiter-admin')?.addEventListener('click', () => {
    state.adminWaiterPage++;
    if (state.waiterOrders) renderAdminWaiterOrders(state.waiterOrders);
});

// Admin Products Pagination
$('btn-prev-prod')?.addEventListener('click', () => {
    if (state.productsPage > 1) {
        state.productsPage--;
        renderAdminProductsPage();
    }
});

$('btn-next-prod')?.addEventListener('click', () => {
    state.productsPage++;
    renderAdminProductsPage();
});

// Admin Categories Pagination
$('btn-prev-cat')?.addEventListener('click', () => {
    if (state.categoriesPage > 1) {
        state.categoriesPage--;
        renderAdminCategoriesPage();
    }
});

$('btn-next-cat')?.addEventListener('click', () => {
    state.categoriesPage++;
    renderAdminCategoriesPage();
});

// Indicador visual flotante de estado de conexión y operaciones pendientes
function updateGlobalOfflineBanner(isOnline, pendingCount = 0) {
    let banner = document.getElementById('global-offline-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'global-offline-banner';
        document.body.appendChild(banner);
        banner.addEventListener('click', async () => {
            if (window.ApiClient && navigator.onLine) {
                const s = await ApiClient.syncOfflineRequests();
                if (s > 0 && window.toast) toast(`Sincronizadas ${s} operaciones pendientes.`, "success");
            }
        });
    }

    if (!isOnline) {
        banner.className = 'fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg text-xs font-bold bg-amber-500 text-white transition-all duration-300 pointer-events-auto animate-pulse';
        banner.innerHTML = `<i class="fas fa-wifi-slash"></i><span>Modo sin conexión ${pendingCount > 0 ? `(${pendingCount} pedidos locales)` : ''}</span>`;
        banner.style.display = 'flex';
    } else if (pendingCount > 0) {
        banner.className = 'fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg text-xs font-bold bg-blue-600 text-white transition-all duration-300 pointer-events-auto';
        banner.innerHTML = `<i class="fas fa-sync fa-spin"></i><span>Sincronizando ${pendingCount} operaciones...</span>`;
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

// CONNECTION STATUS MONITORING
async function updateConnectionStatus() {
    const online = navigator.onLine;
    const statusContainer = document.getElementById('connection-status');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    let queueCount = 0;
    try {
        if (window.OfflineDB) queueCount = await OfflineDB.getQueueCount();
    } catch (_) {}

    updateGlobalOfflineBanner(online, queueCount);

    if (statusContainer && statusDot && statusText) {
        if (online) {
            statusContainer.className = 'flex items-center gap-1.5 mt-1 px-2 py-1 rounded-md bg-green-100 border border-green-300 transition-all';
            statusDot.className = 'w-2 h-2 rounded-full bg-green-600 transition-colors';
            statusText.textContent = queueCount > 0 ? `En línea (${queueCount} pend.)` : 'En línea';
            statusText.className = 'text-[10px] font-bold text-green-700';

            // Try to sync offline requests
            if (window.ApiClient) {
                try {
                    const synced = await ApiClient.syncOfflineRequests();
                    if (synced > 0) {
                        toast(`Sincronizadas ${synced} operaciones pendientes.`, "success");
                        window.dispatchEvent(new Event('offline_sync_complete'));
                        if (window.OfflineDB) {
                            const remaining = await OfflineDB.getQueueCount();
                            updateGlobalOfflineBanner(true, remaining);
                        }
                    }
                } catch (e) {
                    console.error("Error syncing offline requests", e);
                }
            }
        } else {
            statusContainer.className = 'flex items-center gap-1.5 mt-1 px-2 py-1 rounded-md bg-red-100 border border-red-300 transition-all';
            statusDot.className = 'w-2 h-2 rounded-full bg-red-600 transition-colors animate-pulse';
            statusText.textContent = queueCount > 0 ? `Sin conexión (${queueCount})` : 'Sin conexión';
            statusText.className = 'text-[10px] font-bold text-red-700';
        }
    } else if (online && window.ApiClient) {
        // Even if not in admin view, try to sync if online
        try {
            const synced = await ApiClient.syncOfflineRequests();
            if (synced > 0 && window.toast) {
                toast(`Sincronizadas ${synced} operaciones pendientes.`, "success");
                window.dispatchEvent(new Event('offline_sync_complete'));
            }
            if (window.OfflineDB) {
                const remaining = await OfflineDB.getQueueCount();
                updateGlobalOfflineBanner(true, remaining);
            }
        } catch (e) {
            console.error("Error syncing offline requests", e);
        }
    }
}

// Global UI handler for Banner
window.removeBanner = () => {
    state.config.banner = ''; // Flag to delete on save

    const bannerInput = $('conf-banner');
    if (bannerInput) bannerInput.value = ''; // clear file input

    const preview = $('conf-banner-preview');
    if (preview) {
        preview.classList.add('hidden');
        preview.src = '';
    }

    const placeholder = $('conf-banner-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');

    const deleteBtn = $('btn-delete-banner');
    if (deleteBtn) deleteBtn.classList.add('hidden');
};

// Browser online/offline events
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// Socket connection events
if (window.socket) {
    socket.on('disconnect', () => updateConnectionStatus());
    socket.on('connect', () => updateConnectionStatus());
}

// Init
window.addEventListener('load', init);

// Setup connection monitor after DOM ready
window.addEventListener('DOMContentLoaded', () => {
    updateConnectionStatus();

    // Load restaurant name on login screen (public endpoint, no auth needed)
    fetch('/api/config/dataRestaurant')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            const name = data?.name || null;
            const el = document.getElementById('login-restaurant-name');
            if (el && name) el.textContent = name;
        })
        .catch(() => { /* silent fail on login screen */ });

    // Load banner image on login screen
    fetch('/api/config/imgBannerDefault')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
            const bannerUrl = data?.Base64 || data?.url || null;
            if (bannerUrl) {
                const bg = document.getElementById('login-header-bg');
                const overlay = document.getElementById('login-header-overlay');
                const title = document.getElementById('login-title');
                if (bg) bg.style.backgroundImage = `url(${bannerUrl})`;
                if (overlay) overlay.style.opacity = '1';
                if (title) title.classList.replace('text-gray-800', 'text-white');
            }
        })
        .catch(() => { /* silent fail */ });

    // Check offline queue periodically
    setInterval(async () => {
        if (window.OfflineDB) {
            try {
                const queue = await window.OfflineDB.getQueue();
                const indicator = document.getElementById('offline-queue-indicator');
                const countSpan = document.getElementById('offline-queue-count');
                if (indicator && countSpan) {
                    if (queue.length > 0) {
                        countSpan.textContent = queue.length;
                        indicator.classList.remove('hidden');
                        indicator.classList.add('flex');
                    } else {
                        indicator.classList.add('hidden');
                        indicator.classList.remove('flex');
                    }
                }
            } catch (e) { }
        }
    }, 2000);

    // Order Type Modal Handlers
    $('btn-order-local')?.addEventListener('click', () => {
        $('order-type-modal')?.classList.add('hidden');
        if (window.openWaiterModal) window.openWaiterModal();
    });

    $('btn-order-general')?.addEventListener('click', () => {
        $('order-type-modal')?.classList.add('hidden');
        switchView('client');
    });

    // File input live previews
    $('conf-banner')?.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (evt) {
                $('conf-banner-preview').src = evt.target.result;
                $('conf-banner-preview').classList.remove('hidden');
                $('conf-banner-placeholder').classList.add('hidden');

                const deleteBtn = $('btn-delete-banner');
                if (deleteBtn) deleteBtn.classList.remove('hidden');
            }
            reader.readAsDataURL(file);
        }
    });

    $('conf-logo')?.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (evt) {
                $('conf-logo-preview').src = evt.target.result;
                $('conf-logo-preview').classList.remove('hidden');
                $('conf-logo-placeholder').classList.add('hidden');
            }
            reader.readAsDataURL(file);
        }
    });

    // Initialize Payment Modal
    if (window.initPaymentModal) window.initPaymentModal();
});
