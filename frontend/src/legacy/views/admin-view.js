import { state } from '../core/state.js';
import { ApiClient } from '../services/api-client.js';
import { $, formatMoney, getStatusBadge, getSafeDate, escapeHtml } from '../utils/helpers.js';
import { deleteOrder, deleteWaiterOrder, manualCleanup, getHistoryOrders, removeOfflineOrder } from '../services/order-service.js';
import { OfflineDB } from '../services/offline-db.js';
import { deleteProduct, deleteCategory, getProducts, getCategories, importCategoriesCSV, importProductsCSV } from '../services/product-service.js';
import { deleteUser, getUsers } from '../services/auth-service.js';
import { toast, showConfirmModal, showModalAlert, showImageModal, showPromptModal } from '../components/ui.js';
import { printOrder } from '../services/print-service.js';
import { getOrderNotes, addOrderNotes, solveOrderNote, deleteOrderNote, getActiveNotes } from '../services/note-service.js';
import { updateOrder } from '../services/order-service.js';
import { getGastos, createGasto, updateGasto, deleteGasto } from '../services/gasto-service.js';
import { initProductsSubtabs, renderAdminProductsPage, renderAdminCategoriesPage, setupDishesCSVListeners } from './admin-dishes-view.js';
import { openReportWindow, updateQuotaWidget, calculateApproxSize, openMaximizedView } from './admin-reports-view.js';

export { initProductsSubtabs, renderAdminProductsPage, renderAdminCategoriesPage } from './admin-dishes-view.js';
export { openReportWindow, updateQuotaWidget, calculateApproxSize, openMaximizedView } from './admin-reports-view.js';

// ----- WhatsApp Message Helpers -----
const DEFAULT_WA_TEMPLATES = {
    recibido: `Hola! tu pedido ha sido recibido y pronto entrará a cocina. ${String.fromCodePoint(0x1F929)}`,
    preparacion: `Psst! Tu pedido ha entrado a la cocina...! ${String.fromCodePoint(0x1F468, 0x1F3FC, 0x200D, 0x1F373)}`,
    terminado_recoger: `Enhorabuena, hemos terminado tu pedido. Puedes venir por él. ${String.fromCodePoint(0x1F371)}`,
    terminado_domicilio: `Enhorabuena, hemos terminado tu pedido, pronto lo tendrás en tus manos. ${String.fromCodePoint(0x1F4E6)}`,
    reparto: `Está atento, ya tu pedido fue recogido por nuestro domiciliario, prepara tu paladar... ${String.fromCodePoint(0x1F60B)}`,
    entregado: `Boya! has recibido tu pedido con éxito. Disfruta al máximo cada uno de nuestros sabores. ${String.fromCodePoint(0x2705)}`,
    anulado: `Tu pedido ha sido anulado... ${String.fromCodePoint(0x1F614)}`
};

function getWhatsAppMessage(order) {
    const templates = state.whatsappTemplates || {};
    const status = order.status;
    const type = order.type;

    let message = '';
    switch (status) {
        case 'Recibido':
            message = templates.recibido || DEFAULT_WA_TEMPLATES.recibido;
            break;
        case 'En preparación':
            message = templates.preparacion || DEFAULT_WA_TEMPLATES.preparacion;
            break;
        case 'Terminado':
            if (type === 'Recoger' || type === 'Local') {
                message = templates.terminado_recoger || DEFAULT_WA_TEMPLATES.terminado_recoger;
            } else {
                message = templates.terminado_domicilio || DEFAULT_WA_TEMPLATES.terminado_domicilio;
            }
            break;
        case 'En Reparto':
            message = templates.reparto || DEFAULT_WA_TEMPLATES.reparto;
            break;
        case 'Entregado':
            message = templates.entregado || DEFAULT_WA_TEMPLATES.entregado;
            break;
        case 'Anulado':
            message = templates.anulado || DEFAULT_WA_TEMPLATES.anulado;
            break;
        default:
            message = 'Hola! tenemos una actualización de tu pedido.';
    }
    return message;
}

window.openWhatsApp = (orderId) => {
    const allOrders = [...(state.orders || []), ...(state.waiterOrders || [])];
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return toast('Pedido no encontrado', 'error');

    const phone = order.phone || order.clientPhone;
    if (!phone) return toast('El pedido no tiene número telefónico', 'error');

    const message = getWhatsAppMessage(order);
    const encoded = encodeURIComponent(message);
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    // Use api.whatsapp.com for better compatibility (matching client-view.js pattern)
    window.open(`https://api.whatsapp.com/send?phone=+57${cleanPhone}&text=${encoded}`, '_blank');
};
// ----- End WhatsApp Helpers -----

// Cancel function
window.promptCancelOrder = (id, modalToHide = null) => {
    const isCajero = state.user?.role === 'cajero';
    // Cashiers are restricted only if cajeroCanCancel is explicitly set to false (Strict Mode)
    // Default is true (flexible mode: cashier cancels with reason, no PIN required)
    const requireAdminAuth = isCajero && state.restaurantData?.cajeroCanCancel === false;

    showPromptModal(
        'Anular Pedido',
        'Por favor, ingresa el motivo de la anulación:',
        'Ej: El cliente canceló la orden...',
        async (reason) => {
            try {
                await updateOrder(id, { status: 'Anulado', cancelReason: reason, adminVerified: true });
                toast("Pedido anulado con éxito", "success");
                if (modalToHide) {
                    modalToHide.classList.add('hidden');
                }
            } catch (err) {
                console.error("Error anulando pedido:", err);
                toast(err.message || "Error al anular", "error");
            }
        },
        { requireAdminAuth, orderId: id, type: 'cancel' }
    );
};


// Optimization UI logic moved to setup function
// Globals
let currentOrderNotesId = null;
window.currentOrderNotesId = null;
let adminOrderSearchTerm = '';
let adminActiveTab = 'general'; // 'general' or 'local'

// Notification counters for new order badges on General/Local tabs
let _newGeneralOrdersCount = 0;
let _newLocalOrdersCount = 0;
// Track recent order IDs to prevent double counting from duplicate socket events
// (the socket receives new_order from both 'admin' and 'tracker' rooms)
const _recentOrderIds = new Set();

/**
 * Updates the notification badges on the order tab buttons.
 * Shows/hides the red dot with pulse animation and the counter.
 */
function updateOrderNotificationBadges() {
    const generalBadges = document.querySelectorAll('.order-notification-badge[data-tab="general"]');
    const localBadges = document.querySelectorAll('.order-notification-badge[data-tab="local"]');

    generalBadges.forEach(badge => {
        if (_newGeneralOrdersCount > 0) {
            badge.textContent = _newGeneralOrdersCount > 1 ? _newGeneralOrdersCount : '';
            badge.classList.remove('hidden');
        } else {
            badge.textContent = '';
            badge.classList.add('hidden');
        }
    });

    localBadges.forEach(badge => {
        if (_newLocalOrdersCount > 0) {
            badge.textContent = _newLocalOrdersCount > 1 ? _newLocalOrdersCount : '';
            badge.classList.remove('hidden');
        } else {
            badge.textContent = '';
            badge.classList.add('hidden');
        }
    });
}

/**
 * Clear notification counter for a specific tab.
 * Exposed globally so rapid-management.js (Modo GR) can clear badges on tab switch.
 * @param {'local'|'general'} tabName
 */
window.clearOrderNotification = (tabName) => {
    if (tabName === 'local') {
        _newLocalOrdersCount = 0;
        updateOrderNotificationBadges();
    } else if (tabName === 'general') {
        _newGeneralOrdersCount = 0;
        updateOrderNotificationBadges();
    }
};

export function setupAdminListeners() {

    const btnOpt = $('btn-open-optimization');
    const modalOpt = $('optimization-modal');
    const btnConfirmOpt = $('btn-confirm-optimize');

    // Config Listeners
    const btnReport = $('btn-open-report');
    const btnHistory = $('btn-history-report');
    const btnGenHistory = $('btn-generate-history');

    if (btnReport) {
        btnReport.addEventListener('click', () => {
            openReportWindow(null); // Null means use current state
        });
    }

    if (btnHistory) {
        btnHistory.addEventListener('click', () => {
            $('history-modal').classList.remove('hidden');
            // Default to today
            const today = new Date().toISOString().split('T')[0];
            $('history-start').value = today;
            $('history-end').value = today;
        });
    }

    if (btnGenHistory) {
        btnGenHistory.addEventListener('click', async () => {
            const start = $('history-start').value;
            const end = $('history-end').value;

            if (!start || !end) return toast("Selecciona ambas fechas", "error");

            try {
                btnGenHistory.disabled = true;
                btnGenHistory.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

                const orders = await getHistoryOrders(start, end);

                $('history-modal').classList.add('hidden');

                if (orders.length === 0) {
                    toast("No se encontraron pedidos en ese rango", "info");
                } else {
                    openReportWindow(orders);
                }

            } catch (e) {
                console.error(e);
                toast("Error generando reporte", "error");
            } finally {
                btnGenHistory.disabled = false;
                btnGenHistory.innerHTML = '<i class="fas fa-file-download mr-1"></i> Generar Reporte';
            }
        });
    }

    if (btnOpt && modalOpt) {
        btnOpt.addEventListener('click', () => {
            modalOpt.classList.remove('hidden');

            // Reset password field and error
            const passwordInput = $('opt-password');
            const passwordError = $('opt-password-error');
            if (passwordInput) passwordInput.value = '';
            if (passwordError) passwordError.classList.add('hidden');

            const inputLoc = $('opt-count-local');
            const inputGen = $('opt-count-general');
            const preview = $('opt-preview-total');

            if (inputLoc && inputGen) {
                inputLoc.value = '0';
                inputGen.value = '0';
                if (preview) preview.innerText = '0';

                const updatePreview = () => {
                    const l = parseInt(inputLoc.value) || 0;
                    const g = parseInt(inputGen.value) || 0;
                    if (preview) preview.innerText = (l + g).toString();
                };

                inputLoc.oninput = updatePreview;
                inputGen.oninput = updatePreview;
            }
        });
    }

    // Clear password error when user starts typing
    const passInput = $('opt-password');
    const passError = $('opt-password-error');
    if (passInput && passError) {
        passInput.addEventListener('input', () => {
            passError.classList.add('hidden');
        });
    }

    if (btnConfirmOpt) {
        btnConfirmOpt.addEventListener('click', async () => {
            if (btnConfirmOpt.disabled) return; // Prevent double clicks

            const inputLoc = $('opt-count-local');
            const inputGen = $('opt-count-general');
            const passwordInput = $('opt-password');
            const passwordError = $('opt-password-error');

            const countLoc = parseInt(inputLoc.value) || 0;
            const countGen = parseInt(inputGen.value) || 0;

            if (countLoc <= 0 && countGen <= 0) {
                return toast("Ingresa al menos una cantidad a eliminar", "error");
            }

            // Verify password
            const password = passwordInput?.value?.trim();
            if (!password) {
                if (passwordError) {
                    passwordError.classList.remove('hidden');
                    passwordError.querySelector('span').textContent = 'Debes ingresar tu contraseña para confirmar.';
                }
                return;
            }

            try {
                btnConfirmOpt.disabled = true;
                btnConfirmOpt.innerText = "Verificando...";

                // Verify the current user's password
                const verifyRes = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user: state.user?.name || '',
                        code: password
                    })
                });

                if (!verifyRes.ok) {
                    if (passwordError) {
                        passwordError.classList.remove('hidden');
                        passwordError.querySelector('span').textContent = 'Contraseña incorrecta. Intenta de nuevo.';
                    }
                    toast("Contraseña incorrecta", "error");
                    btnConfirmOpt.disabled = false;
                    btnConfirmOpt.innerText = "Eliminar";
                    return;
                }

                // Password correct — proceed with cleanup
                btnConfirmOpt.innerText = "Eliminando...";
                if (passwordError) passwordError.classList.add('hidden');
                if (passwordInput) passwordInput.value = '';

                const result = await manualCleanup(countLoc, countGen);

                modalOpt.classList.add('hidden');
                toast(`Limpieza completada. Total: ${result.total} (Locales: ${result.localDeleted}, Generales: ${result.generalDeleted})`, "success");

            } catch (error) {
                console.error(error);
                toast("Error durante la limpieza", "error");
            } finally {
                btnConfirmOpt.disabled = false;
                btnConfirmOpt.innerText = "Eliminar";
            }
        });
    }

    // ====================================================================
    // REALTIME ORDER NOTIFICATIONS (Socket.IO)
    // ====================================================================

    // Audio instance for notification sound
    let notificationAudio = null;

    function playNotificationSound() {
        try {
            if (!notificationAudio) {
                notificationAudio = new Audio('/noti.mp3');
                notificationAudio.volume = 0.7;
            }
            notificationAudio.currentTime = 0;
            notificationAudio.play().catch(err => {
                console.warn('Audio play failed (browser policy):', err);
            });
            // Update the App Badge (PWA functionality)
            if (window.incrementAppBadge) {
                window.incrementAppBadge();
            }
        } catch (e) {
            console.error('Error playing notification sound:', e);
        }
    }

    // Listen for new orders and show notification
    if (window.socket) {
        window.socket.on('new_order', (order) => {
            // Only show notification for admin/cajero/supervisor roles
            if (state.user && (state.user.role === 'admin' || state.user.role === 'cajero' || state.user.role === 'supervisor')) {
                // Import showOrderNotification from ui.js
                import('../components/ui.js').then(module => {
                    if (module.showOrderNotification) {
                        module.showOrderNotification(order.id);
                    }
                });

                // Play notification sound
                playNotificationSound();

            }

            // Reload data to ensure state.orders is up to date
            if (window.reloadAdminData) window.reloadAdminData();

            // Update Rapid Management View if active (reloadAdminData triggers it too via event, but valid to keep)
            if (window.renderRapidManagement) window.renderRapidManagement();
        });

        // Note Events (Consolidated)
        const refreshNotesIfOpen = (data) => {
            if (window.reloadAdminData) window.reloadAdminData();
            const oid = data.orderId || data.id || (data.note && data.note.id_order);

            const modal = document.getElementById('view-notes-modal');
            if (modal && !modal.classList.contains('hidden')) {
                if (isGlobalNotesMode) {
                    fetchAndRenderGlobalNotes();
                } else if (window.currentOrderNotesId && (oid == window.currentOrderNotesId)) {
                    fetchAndRenderNotes(window.currentOrderNotesId);
                }
            }
        };

        // Listen for internal request from Rapid Management
        window.addEventListener('request-open-notes', (e) => {
            const { orderId } = e.detail;
            if (orderId && window.openOrderNotes) {
                window.openOrderNotes(orderId);
            } else {
                console.warn("openOrderNotes function not found or ID missing");
            }
        });

        window.socket.on('new_order_note', (data) => {
            if (state.user && (state.user.role === 'admin' || state.user.role === 'cajero' || state.user.role === 'supervisor')) {
                if (window.playNoteSound) window.playNoteSound();
            }
            refreshNotesIfOpen(data);
        });

        window.socket.on('order_note_updated', refreshNotesIfOpen);
        window.socket.on('order_note_deleted', refreshNotesIfOpen);

        // Socket for Database Optimizations (Cleaned Orders)
        window.socket.on('orders_cleaned', () => {
            if (window.reloadAdminData) window.reloadAdminData();
            if (window.renderRapidManagement) window.renderRapidManagement();
            import('../components/ui.js').then(module => {
                if (module.showToast) module.showToast('Base de datos optimizada', 'info');
            });
        });

        // Socket for Single Order Deletions
        window.socket.on('order_deleted', () => {
            if (window.reloadAdminData) window.reloadAdminData();
            if (window.renderRapidManagement) window.renderRapidManagement();
        });

        // GENERIC ORDER UPDATE (Catch-all for status changes, etc.)
        window.socket.on('order_updated', (order) => {
            // If we are in Admin View, reload table
            if (window.reloadAdminData) window.reloadAdminData();

            // If maximized view is open and matches
            if (order && !$('maximized-modal').classList.contains('hidden')) {
                // Optional: Refresh maximized view
            }

            // Update Rapid Management View if active
            if (window.renderRapidManagement) window.renderRapidManagement();
        });

        // STATUS UPDATE (Specific for status changes)
        window.socket.on('order_status_update', (data) => {
            // If we are in Admin View, reload table
            if (window.reloadAdminData) window.reloadAdminData();

            // Update Rapid Management View if active
            if (window.renderRapidManagement) window.renderRapidManagement();

            // Update Cashflow (Flujo de Caja) if loaded
            if (window._reloadCashflowData) window._reloadCashflowData();
        });
    }

    // ====================================================================
    // Reset Order Counters
    // ====================================================================

    const btnResetCounters = $('btn-reset-counters');
    if (btnResetCounters) {
        btnResetCounters.addEventListener('click', () => {
            // Step 1: Warning confirmation
            showConfirmModal(
                'Restablecer Contadores',
                '⚠️ Esto reiniciará los consecutivos PG y PL a 0. El próximo pedido empezará desde PG1 / PL1. Esta acción no afecta los pedidos existentes pero puede generar IDs duplicados si hay pedidos previos. ¿Continuar?',
                () => {
                    // Step 2: Password re-confirmation
                    showPromptModal(
                        'Confirmar Identidad',
                        'Ingresa tu código de acceso para continuar:',
                        'Tu código...',
                        async (code) => {
                            // Restore input type so other showPromptModal calls are unaffected
                            const inp = document.getElementById('prompt-modal-input');
                            if (inp) inp.type = 'text';
                            try {
                                const res = await fetch('/api/config/reset-counters', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${localStorage.getItem('pos_token')}`
                                    },
                                    body: JSON.stringify({ code })
                                });
                                const data = await res.json();
                                if (!res.ok) throw new Error(data.error || 'Error desconocido');
                                toast('Contadores restablecidos. Próximo pedido: PG1 / PL1', 'success');
                            } catch (err) {
                                toast(err.message || 'Error al restablecer', 'error');
                            }
                        }
                    );
                    // Mask the input as password for security
                    const pwInput = document.getElementById('prompt-modal-input');
                    if (pwInput) pwInput.type = 'password';
                },
                null,
                'Sí, continuar'
            );
        });
    }

    // ====================================================================
    // Database Backup Download & Antifraud Audit Logs
    // ====================================================================
    const btnDownloadBackup = $('btn-download-backup');
    if (btnDownloadBackup) {
        btnDownloadBackup.addEventListener('click', async () => {
            const originalHtml = btnDownloadBackup.innerHTML;
            btnDownloadBackup.disabled = true;
            btnDownloadBackup.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Generando copia segura...</span>`;
            try {
                const token = localStorage.getItem('pos_token');
                const res = await fetch('/api/admin/backups/download', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || 'Error al generar la copia de seguridad');
                }
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const nowStr = new Date().toISOString().split('T')[0];
                a.download = `respaldo_pos_${nowStr}.sqlite`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                toast('Copia de seguridad descargada exitosamente (.sqlite)', 'success');
            } catch (err) {
                console.error('Backup download error:', err);
                toast(err.message || 'Error al descargar la copia de seguridad', 'error');
            } finally {
                btnDownloadBackup.disabled = false;
                btnDownloadBackup.innerHTML = originalHtml;
            }
        });
    }

    const btnOpenAuditLogs = $('btn-open-audit-logs');
    const btnRefreshAuditLogs = $('btn-refresh-audit-logs');

    let _auditLogs = [];
    let _auditPage = 1;
    const AUDIT_PAGE_SIZE = 10;

    function renderAuditPage() {
        const tbody = document.getElementById('audit-logs-body');
        const pageInfo = document.getElementById('audit-logs-page-info');
        const btnPrev = document.getElementById('btn-audit-prev');
        const btnNext = document.getElementById('btn-audit-next');
        if (!tbody) return;

        if (!_auditLogs || _auditLogs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-8 text-center text-gray-400">
                        <i class="fas fa-shield-alt text-2xl mb-2 text-gray-300 block"></i>
                        No hay registros de auditoría aún. Las acciones críticas aparecerán aquí automáticamente.
                    </td>
                </tr>
            `;
            if (pageInfo) pageInfo.textContent = 'Página 1 de 1 (0 registros)';
            if (btnPrev) btnPrev.disabled = true;
            if (btnNext) btnNext.disabled = true;
            return;
        }

        const totalPages = Math.max(1, Math.ceil(_auditLogs.length / AUDIT_PAGE_SIZE));
        if (_auditPage > totalPages) _auditPage = totalPages;
        if (_auditPage < 1) _auditPage = 1;

        const start = (_auditPage - 1) * AUDIT_PAGE_SIZE;
        const pageLogs = _auditLogs.slice(start, start + AUDIT_PAGE_SIZE);

        const badgeMap = {
            'ORDER_CANCELLED': { label: 'Pedido Anulado', bg: 'bg-red-100 text-red-700 border-red-200' },
            'ORDER_DELETED': { label: 'Pedido Eliminado', bg: 'bg-rose-100 text-rose-700 border-rose-200' },
            'ORDERS_CLEANUP': { label: 'Depuración Masiva', bg: 'bg-purple-100 text-purple-700 border-purple-200' },
            'CASH_CLOSING_CREATED': { label: 'Cierre de Caja', bg: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
            'CASH_CLOSINGS_DELETED': { label: 'Cierre Borrado', bg: 'bg-amber-100 text-amber-700 border-amber-200' },
            'COUNTERS_RESET': { label: 'Contadores Reiniciados', bg: 'bg-orange-100 text-orange-700 border-orange-200' },
            'MANUAL_BACKUP_CREATED': { label: 'Copia Creada', bg: 'bg-blue-100 text-blue-700 border-blue-200' },
            'BACKUP_DOWNLOADED': { label: 'Copia Descargada', bg: 'bg-cyan-100 text-cyan-700 border-cyan-200' }
        };

        tbody.innerHTML = pageLogs.map(l => {
            const badge = badgeMap[l.event_type] || { label: l.event_type, bg: 'bg-gray-100 text-gray-700 border-gray-200' };
            const dateObj = new Date(l.timestamp);
            const dateFmt = dateObj.toLocaleString('es-CO', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            let detailText = '';
            const d = l.details || {};
            if (l.event_type === 'ORDER_CANCELLED') {
                detailText = `<b>Pedido ${d.orderId}</b> ($${Number(d.total || 0).toLocaleString('es-CO')}) • Motivo: <i>"${d.cancelReason || 'N/A'}"</i>`;
            } else if (l.event_type === 'ORDER_DELETED') {
                detailText = `<b>Pedido ${d.orderId}</b> ($${Number(d.total || 0).toLocaleString('es-CO')}) de ${d.client || 'Cliente'}`;
            } else if (l.event_type === 'CASH_CLOSING_CREATED') {
                detailText = `Cierre <b>#${d.cierreId}</b> • Total: $${Number(d.totalGeneral || 0).toLocaleString('es-CO')} (Efectivo: $${Number(d.ingresoEfectivo || 0).toLocaleString('es-CO')}, Transf: $${Number(d.ingresoTransferencia || 0).toLocaleString('es-CO')})`;
            } else if (l.event_type === 'CASH_CLOSINGS_DELETED') {
                detailText = d.fecha ? `Cierre del <b>${d.fecha}</b> (${d.totalGeneral ? '$' + Number(d.totalGeneral).toLocaleString('es-CO') : ''}) eliminado por ${d.deletedBy || 'Admin'}` : `Eliminados ${d.deletedCount || 1} cierre(s)`;
            } else if (l.event_type === 'ORDERS_CLEANUP') {
                detailText = `Depuración de ${d.total} pedidos antiguos (${d.localDeleted} locales, ${d.generalDeleted} generales)`;
            } else if (l.event_type === 'COUNTERS_RESET') {
                detailText = `${d.message || 'Contadores restablecidos a 0'}`;
            } else if (d.filename) {
                detailText = `Archivo: <code>${d.filename}</code> ${d.size ? `(${d.size})` : ''}`;
            } else {
                detailText = typeof d === 'string' ? d : JSON.stringify(d);
            }

            const userName = l.user_name || (d.userName || d.user || d.deletedBy) || 'Sistema';
            const userRole = l.user_role || d.role || '';

            return `
                <tr class="hover:bg-gray-50/80 transition-colors">
                    <td class="p-3 font-mono text-[11px] text-gray-600 whitespace-nowrap">${dateFmt}</td>
                    <td class="p-3">
                        <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg}">
                            ${badge.label}
                        </span>
                    </td>
                    <td class="p-3 whitespace-nowrap">
                        <span class="font-bold text-gray-800">${userName}</span>
                        ${userRole ? `<span class="text-[10px] text-gray-400 block capitalize">${userRole}</span>` : ''}
                    </td>
                    <td class="p-3 text-[11px] text-gray-700 leading-relaxed">${detailText}</td>
                </tr>
            `;
        }).join('');

        if (pageInfo) {
            pageInfo.textContent = `Página ${_auditPage} de ${totalPages} (${_auditLogs.length} registros)`;
        }
        if (btnPrev) btnPrev.disabled = (_auditPage <= 1);
        if (btnNext) btnNext.disabled = (_auditPage >= totalPages);
    }

    async function loadAuditLogs() {
        const tbody = document.getElementById('audit-logs-body');
        if (!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="p-8 text-center text-gray-400">
                    <i class="fas fa-spinner fa-spin text-lg mb-2 block"></i> Cargando registros de auditoría...
                </td>
            </tr>
        `;

        try {
            const token = localStorage.getItem('pos_token');
            const res = await fetch('/api/admin/audit-logs?limit=150', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Error al cargar logs');
            const { logs } = await res.json();
            _auditLogs = logs || [];
            _auditPage = 1;
            renderAuditPage();
        } catch (err) {
            console.error('Audit logs load error:', err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-6 text-center text-red-500 font-bold">
                        <i class="fas fa-exclamation-circle mr-1"></i> Error al cargar los registros de auditoría.
                    </td>
                </tr>
            `;
        }
    }

    const btnAuditPrev = document.getElementById('btn-audit-prev');
    const btnAuditNext = document.getElementById('btn-audit-next');
    if (btnAuditPrev) {
        btnAuditPrev.onclick = () => {
            if (_auditPage > 1) {
                _auditPage--;
                renderAuditPage();
            }
        };
    }
    if (btnAuditNext) {
        btnAuditNext.onclick = () => {
            const totalPages = Math.max(1, Math.ceil(_auditLogs.length / AUDIT_PAGE_SIZE));
            if (_auditPage < totalPages) {
                _auditPage++;
                renderAuditPage();
            }
        };
    }

    if (btnOpenAuditLogs) {
        btnOpenAuditLogs.addEventListener('click', () => {
            const modal = document.getElementById('audit-logs-modal');
            if (modal) modal.classList.remove('hidden');
            loadAuditLogs();
        });
    }

    if (btnRefreshAuditLogs) {
        btnRefreshAuditLogs.addEventListener('click', () => {
            loadAuditLogs();
        });
    }

    // ====================================================================
    // CSV Import/Export Listeners (Dishes & Categories)
    // ====================================================================
    setupDishesCSVListeners();

    // ====================================================================
    // New Order Notification Badges (red dot + counter on order tabs)
    // ====================================================================
    // Listen for new_order Socket.IO events to increment notification counters
    const sock = window.socket || null;
    if (sock) {
        sock.on('new_order', (order) => {
            // Only track when user is logged in
            if (!state.user) return;
            if (!order || !order.id || !order.type) return;

            // Deduplicate: the socket joins both 'admin' and 'tracker' rooms,
            // so the same new_order event may arrive twice. Skip duplicates.
            if (_recentOrderIds.has(order.id)) return;
            _recentOrderIds.add(order.id);
            // Clean up after 5 seconds to prevent memory leaks
            setTimeout(() => _recentOrderIds.delete(order.id), 5000);

            if (order.type === 'Local') {
                if (adminActiveTab !== 'local') {
                    _newLocalOrdersCount++;
                    updateOrderNotificationBadges();
                }
            } else {
                if (adminActiveTab !== 'general') {
                    _newGeneralOrdersCount++;
                    updateOrderNotificationBadges();
                }
            }
        });
    }

    // ====================================================================
    // Admin Orders Tab Switching + Search are now handled by the Vue OrdersPanel.
    // (Removed the legacy bindings to avoid clobbering Vue's v-model/listeners.)
    // ====================================================================

    initProductsSubtabs();
} // End setupAdminListeners

export function renderAdminOrdersTable(orders) {
    // Filter only general orders (NOT Local)
    let generalOrders = orders.filter(o => o.type !== 'Local');

    // Apply search filtering by ID or client name
    if (adminOrderSearchTerm) {
        generalOrders = generalOrders.filter(o => {
            const idMatch = String(o.id).toLowerCase().includes(adminOrderSearchTerm);
            const clientMatch = (o.client || '').toLowerCase().includes(adminOrderSearchTerm);
            return idMatch || clientMatch;
        });
    }

    generalOrders.sort((a, b) => {
        // Priority Sort
        const priorityScore = (status) => {
            const map = {
                'Pendiente': 1,
                'Recibido': 2,
                'En preparación': 3,
                'Terminado': 4,
                'En Reparto': 5,
                'Entregado': 6,
                'Cobrado': 7,
                'Anulado': 8
            };
            return map[status] || 99;
        };

        const scoreA = priorityScore(a.status);
        const scoreB = priorityScore(b.status);

        if (scoreA !== scoreB) return scoreA - scoreB;

        // Secondary: Newest first
        const dateA = getSafeDate(a.timestamp).getTime();
        const dateB = getSafeDate(b.timestamp).getTime();
        return dateB - dateA;
    });

    const ADMIN_PER_PAGE = 15;
    const start = (state.adminPage - 1) * ADMIN_PER_PAGE;
    const end = start + ADMIN_PER_PAGE;
    const pageItems = generalOrders.slice(start, end);

    const tbody = $('admin-orders-body');
    if (!tbody) return;

    if (generalOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-gray-400 text-[14px]">No hay pedidos recientes generales.</td></tr>';
        return;
    }

    tbody.innerHTML = pageItems.map(o => {
        let dateObj = getSafeDate(o.timestamp);
        const isOffline = o._offline === true;

        return `
        <tr class="hover:bg-gray-50 transition-colors border-b border-gray-50 ${isOffline ? 'bg-amber-50/40' : ''}">
            <td class="p-2 text-center align-middle max-w-[90px] w-[90px] min-w-[70px]">
                <div class="font-bold text-gray-800 text-[11px] md:text-sm text-center whitespace-nowrap overflow-hidden text-ellipsis" title="#${o.id}">${isOffline ? '<i class="fas fa-cloud-upload-alt text-amber-500 mr-1 text-[10px]" title="Pendiente de sincronizar"></i>' : ''}#${o.id}</div>
                <div class="text-[10px] md:text-xs text-gray-500 font-medium text-center mt-0.5 whitespace-nowrap">
                    ${new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
            </td>
            <td class="p-2 text-center align-middle max-w-[100px] min-w-[70px]">
                <div class="font-medium text-gray-700 text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" title="${escapeHtml(o.client)}">${escapeHtml(o.client)}</div>
                <div class="text-[10px] md:text-xs text-gray-500 whitespace-nowrap">${escapeHtml(o.type)}</div>
            </td>
            <td class="p-2 text-center align-middle">
                <div class="text-xs text-orange-600 font-medium">${o.chefName ? `<i class="fas fa-fire-alt mr-1"></i>${escapeHtml(o.chefName)}` : '<span class="text-gray-300">-</span>'}</div>
                <div class="text-xs text-blue-600 font-medium">${o.deliveryDriverName ? `<i class="fas fa-motorcycle mr-1"></i>${escapeHtml(o.deliveryDriverName)}` : ''}</div>
            </td>
            <td class="p-2 text-center align-middle">
                ${parseFloat(o.tip) > 0 ? `<div class="text-xs text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+${formatMoney(o.tip)}</div>` : ''}
                ${parseFloat(o.discount) > 0 ? `<div class="text-xs text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-${formatMoney(o.discount)}</div>` : ''}
                ${parseFloat(o.tip) <= 0 && parseFloat(o.discount) <= 0 ? '<span class="text-gray-300 text-xs">-</span>' : ''}
            </td>
            <td class="p-2 text-center align-middle">
                <div class="font-bold text-gray-800 text-sm">${formatMoney(o.total)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(o.payment)}</div>
            </td>
            <td class="p-2 text-center align-middle">
                ${o.proof && o.payment !== 'Efectivo' ? `<img src="${o.proof}" alt="Comprobante pequeño" loading="lazy" class="w-8 h-8 object-cover rounded-lg cursor-pointer hover:scale-110 transition-transform shadow-sm border border-gray-200 admin-proof-img mx-auto" data-src="${o.proof}" title="Ver Comprobante">` : '<span class="text-xs text-gray-300">N/A</span>'}
            </td>
            <td class="p-2 text-center align-middle">
                <div class="flex items-center justify-center gap-1">
                    ${getStatusBadge(o.status)}
                    ${o.phone && !isOffline ? `<button onclick="openWhatsApp('${o.id}')" class="text-green-500 hover:text-green-700 p-1 rounded-full hover:bg-green-50 transition-colors" title="Enviar WhatsApp"><i class="fab fa-whatsapp text-[14px]"></i></button>` : ''}
                </div>
            </td>
            <td class="p-2 text-center align-middle">
                <div class="flex items-center justify-center gap-1.5">
                    ${o.unsolved_notes_count > 0 && !isOffline ? `
                    <button aria-label="Ver notas" onclick="openViewNotesModal('${o.id}')" class="relative group p-1.5 rounded-full hover:bg-orange-50 transition-colors text-orange-500" title="Ver Notas">
                        <i class="fas fa-bell animate-jump-spin text-sm"></i>
                        <span class="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                    </button>
                    ` : ''}
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" onclick="showOrderDetails('${o.id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                                <i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalles</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors print-order-btn" data-id="${o.id}">
                                <i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span>
                            </button>
                            ${isOffline ? `
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors edit-offline-btn" data-id="${o.id}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors delete-offline-btn" data-id="${o.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Cancelar Pedido</span>
                            </button>
                            ` : `
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors edit-order-btn" data-id="${o.id}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors delete-order-btn" data-id="${o.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Pedido</span>
                            </button>
                            `}
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `}).join('');

    // Attach listeners
    document.querySelectorAll('.admin-proof-img').forEach(img => {
        img.addEventListener('click', () => showImageModal(img.dataset.src));
    });

    document.querySelectorAll('.print-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = generalOrders.find(o => o.id === btn.dataset.id);
            if (order) printOrder(order);
        });
    });

    document.querySelectorAll('.delete-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            window.promptCancelOrder(btn.dataset.id);
        });
    });

    // Delete offline order locally (cancel before sync)
    document.querySelectorAll('.delete-offline-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            showConfirmModal(
                'Cancelar Pedido Local',
                '¿Estás seguro de cancelar este pedido local? No se enviará al servidor cuando recuperes la conexión.',
                async () => {
                    try {
                        // Remove from offline storage
                        await removeOfflineOrder(id);
                        // Remove ONLY the matching queued POST request for this specific order
                        // Using _offlineId to target the exact order, avoiding data loss of other pending orders
                        const queue = await OfflineDB.getQueue();
                        const matchingEntries = queue.filter(req =>
                            req.url === '/orders' &&
                            req.method === 'POST' &&
                            req._offlineId === id
                        );
                        for (const entry of matchingEntries) {
                            await OfflineDB.removeFromQueue(entry.id);
                        }
                        toast('Pedido local cancelado', 'success');
                        if (window.reloadAdminData) window.reloadAdminData();
                    } catch (e) {
                        console.error("Error cancelando pedido local:", e);
                        toast('Error al cancelar', 'error');
                    }
                },
                null,
                'Sí, cancelar'
            );
        });
    });

    // Edit offline order (opened from local storage)
    document.querySelectorAll('.edit-offline-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.openOfflineOrderEditModal) {
                window.openOfflineOrderEditModal(btn.dataset.id);
            } else {
                console.error("openOfflineOrderEditModal not found");
            }
        });
    });

    document.querySelectorAll('.edit-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.openOrderEditModal) {
                window.openOrderEditModal(btn.dataset.id, false);
            } else {
                console.error("openOrderEditModal not found");
            }
        });
    });

    $('admin-page-indicator').innerText = `Página ${state.adminPage} de ${Math.ceil(generalOrders.length / ADMIN_PER_PAGE) || 1}`;
    $('btn-prev-admin').disabled = state.adminPage === 1;
    $('btn-next-admin').disabled = end >= generalOrders.length;
}

export function renderAdminWaiterOrders(orders) {
    // Filter only local orders
    let localOrders = orders.filter(o => o.type === 'Local');

    // Apply search filtering by ID or client name
    if (adminOrderSearchTerm) {
        localOrders = localOrders.filter(o => {
            const idMatch = String(o.id).toLowerCase().includes(adminOrderSearchTerm);
            const clientMatch = (o.client || '').toLowerCase().includes(adminOrderSearchTerm);
            return idMatch || clientMatch;
        });
    }

    const tbody = $('admin-waiter-orders-body');
    if (!tbody) return;

    if (localOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-gray-400 text-[14px]">No hay pedidos de meseros activos.</td></tr>';
        return;
    }

    // Unified Sort Logic for Waiter Orders too
    localOrders.sort((a, b) => {
        const priorityScore = (status) => {
            const map = {
                'Pendiente': 1,
                'Recibido': 2,
                'En preparación': 3,
                'Terminado': 4,
                'Entregado': 5, // Waiter flow usually jumps here or Cobrado
                'Cobrado': 6,
                'Anulado': 7
            };
            return map[status] || 99;
        };

        const scoreA = priorityScore(a.status);
        const scoreB = priorityScore(b.status);

        if (scoreA !== scoreB) return scoreA - scoreB;

        // Secondary: Table Number if useful, or Date
        // Keeping Table Number sort as secondary might be good, but let's stick to consistent priority then date
        return getSafeDate(b.timestamp).getTime() - getSafeDate(a.timestamp).getTime();
    });

    const PER_PAGE = 15;
    if (!state.adminWaiterPage) state.adminWaiterPage = 1;
    const start = (state.adminWaiterPage - 1) * PER_PAGE;
    const end = start + PER_PAGE;
    const pageItems = localOrders.slice(start, end);

    tbody.innerHTML = pageItems.map(o => `
        <tr class="hover:bg-gray-50 transition-colors ${o._offline ? 'bg-yellow-50' : ''}">
            <td class="p-2 text-center align-middle max-w-[90px] w-[90px] min-w-[70px]">
                <div class="font-bold text-gray-700 text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" title="#${o.id}">#${o.id}</div>
                <div class="text-[10px] md:text-xs text-gray-500 mt-0.5 whitespace-nowrap">
                    ${new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
            </td>
            <td class="p-2 text-center align-middle max-w-[100px] min-w-[70px]">
                <div class="text-gray-900 font-bold text-[11px] md:text-sm whitespace-nowrap overflow-hidden text-ellipsis" title="Mesa ${escapeHtml(o.tableNum || o.table || '-')}">Mesa ${escapeHtml(o.tableNum || o.table || '-')}</div>
            </td>
            <td class="p-2 text-center align-middle">
                <div class="text-gray-900 text-sm font-bold flex items-center justify-center gap-1.5">
                    <i class="fas fa-user-tie text-[var(--system-primary)]"></i>
                    <span>${escapeHtml(o.waiterName || 'Mesero')}</span>
                </div>
                ${o.chefName ? `<div class="text-xs text-orange-600 font-medium mt-0.5"><i class="fas fa-fire-alt mr-1"></i>${escapeHtml(o.chefName)}</div>` : ''}
                ${o.client && o.client !== 'Cliente Final' && o.client !== 'Cliente' ? `<div class="text-[10px] text-gray-400 mt-0.5">${escapeHtml(o.client)}</div>` : ''}
            </td>
            <td class="p-2 text-center align-middle">
                ${parseFloat(o.tip) > 0 ? `<div class="text-xs text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+${formatMoney(o.tip)}</div>` : ''}
                ${parseFloat(o.discount) > 0 ? `<div class="text-xs text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-${formatMoney(o.discount)}</div>` : ''}
                ${parseFloat(o.tip) <= 0 && parseFloat(o.discount) <= 0 ? '<span class="text-gray-300 text-xs">-</span>' : ''}
            </td>
            <td class="p-2 text-center align-middle">
                <div class="font-bold text-gray-900 text-sm">${formatMoney(o.total)}</div>
                <div class="text-xs text-gray-500 font-medium mt-0.5">${escapeHtml(o.payment || 'Efectivo')}</div>
            </td>
            <td class="p-2 text-center align-middle">
                ${o.proof && o.payment !== 'Efectivo' ?
            `<div class="w-12 h-12 mx-auto rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:scale-110 transition-transform" 
                        onclick="showImageModal('${o.proof}')">
                        <img src="${o.proof}" alt="Comprobante detallado" loading="lazy" class="w-full h-full object-cover">
                    </div>` :
            '<span class="text-gray-300 text-xs">N/A</span>'
        }
            </td>
            <td class="p-2 text-center align-middle">
                ${getStatusBadge(o.status)}
            </td>
            <td class="p-2 text-center align-middle">
                <div class="flex items-center justify-center gap-1.5">
                    ${o.unsolved_notes_count > 0 ? `
                    <button aria-label="Ver notas" onclick="window.openViewNotesModal('${o.id}')" class="relative group p-1 w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                        <div class="bell-pulse-ring"></div>
                        <i class="fas fa-bell animate-jump-spin text-sm relative z-10"></i>
                    </button>
                    ` : ''}
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" onclick="showOrderDetails('${o.id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                                <i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalles</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors print-waiter-order-btn" data-id="${o.id}">
                                <i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors edit-waiter-order-btn" data-id="${o.id}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Pedido</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors delete-waiter-order-btn" data-id="${o.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Pedido</span>
                            </button>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `).join('');

    const totalPages = Math.ceil(orders.length / PER_PAGE) || 1;
    const pageIndicator = $('admin-waiter-page-indicator');
    const btnPrev = $('btn-prev-waiter-admin');
    const btnNext = $('btn-next-waiter-admin');

    if (pageIndicator) pageIndicator.innerText = `Página ${state.adminWaiterPage} de ${totalPages}`;
    if (btnPrev) btnPrev.disabled = state.adminWaiterPage === 1;
    if (btnNext) btnNext.disabled = end >= orders.length;

    document.querySelectorAll('.print-waiter-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = localOrders.find(o => o.id === btn.dataset.id);
            if (order) printOrder({ ...order, isWaiterOrder: true });
        });
    });

    document.querySelectorAll('.delete-waiter-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            window.promptCancelOrder(btn.dataset.id);
        });
    });

    document.querySelectorAll('.edit-waiter-order-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.openOrderEditModal) {
                window.openOrderEditModal(btn.dataset.id, true);
            } else {
                console.error("openOrderEditModal not found");
            }
        });
    });
}
// --- Gastos Día (Admin) ---

let gastosPage = 1;
const GASTOS_PER_PAGE = 10;
let allGastos = [];

export function renderAdminGastosPage() {
    const container = $('admin-gastos-body');
    if (!container) return;

    // Header / Form
    container.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
            <h3 class="font-bold text-lg">Gastos del Día</h3>
            <div class="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                <div class="relative w-full sm:w-auto">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                    <input type="text" id="gasto-search-input" placeholder="Buscar destino..." class="w-full sm:w-64 pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-100 outline-none transition-all">
                </div>
                <button id="btn-new-gasto" class="w-full sm:w-auto bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-black transition-colors shrink-0">
                    <i class="fas fa-plus mr-1"></i> Nuevo Gasto
                </button>
            </div>
        </div>
        <div id="gastos-list" class="bg-white rounded-2xl p-0 sm:p-4 shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
            <table class="w-full text-left text-sm whitespace-nowrap">
                <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                        <th class="p-3">Destino</th>
                        <th class="p-3">Descripción</th>
                        <th class="p-3">Valor</th>
                        <th class="p-3">Anotaciones</th>
                        <th class="p-3">Fecha</th>
                        <th class="p-3 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody id="admin-gastos-body-list" class="divide-y divide-gray-50"></tbody>
            </table>
            
            <div class="flex justify-between items-center mt-4 px-3 sm:px-0 pb-3 sm:pb-0">
                <span class="text-xs text-gray-500 font-medium" id="gastos-page-info">Página 1</span>
                <div class="flex gap-2">
                    <button id="btn-prev-gastos" class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors">Anterior</button>
                    <button id="btn-next-gastos" class="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors">Siguiente</button>
                </div>
            </div>
        </div>
    `;

    const renderTable = () => {
        const tbody = $('admin-gastos-body-list');
        if (!tbody) return;

        let filtered = allGastos;
        const searchTerm = $('gasto-search-input')?.value.toLowerCase().trim() || '';

        if (searchTerm) {
            filtered = allGastos.filter(g => g.destino?.toLowerCase().includes(searchTerm));
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400">No hay gastos encontrados.</td></tr>';
            if ($('gastos-page-info')) $('gastos-page-info').innerText = 'Página 1';
            if ($('btn-prev-gastos')) $('btn-prev-gastos').disabled = true;
            if ($('btn-next-gastos')) $('btn-next-gastos').disabled = true;
            return;
        }

        const totalPages = Math.ceil(filtered.length / GASTOS_PER_PAGE);
        if (gastosPage > totalPages) gastosPage = totalPages;

        const start = (gastosPage - 1) * GASTOS_PER_PAGE;
        const end = start + GASTOS_PER_PAGE;
        const pageItems = filtered.slice(start, end);

        tbody.innerHTML = pageItems.map(g => `
            <tr class="hover:bg-gray-50 transition-colors pointer-events-auto">
                <td class="p-3 font-medium text-gray-800">${escapeHtml(g.destino)}</td>
                <td class="p-3 text-gray-600 truncate max-w-[150px]" title="${escapeHtml(g.descripcion || '')}">${escapeHtml(g.descripcion || '')}</td>
                <td class="p-3 font-bold text-red-500">${formatMoney(g.valor || 0)}</td>
                <td class="p-3 text-gray-500 text-xs truncate max-w-[150px]">${escapeHtml(g.anotaciones || '')}</td>
                <td class="p-3 text-gray-500 text-xs">${new Date(g.timestamp).toLocaleString('es-CO')}</td>
                <td class="p-3 text-center">
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors btn-edit-gasto" data-id="${g.id}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors btn-delete-gasto" data-id="${g.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `).join('');

        if ($('gastos-page-info')) $('gastos-page-info').innerText = `Página ${gastosPage} de ${totalPages}`;
        if ($('btn-prev-gastos')) $('btn-prev-gastos').disabled = gastosPage === 1;
        if ($('btn-next-gastos')) $('btn-next-gastos').disabled = gastosPage === totalPages;

        document.querySelectorAll('.btn-edit-gasto').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const gasto = allGastos.find(g => g.id == id);
                if (gasto) {
                    $('g-id').value = gasto.id;
                    $('g-destino').value = gasto.destino;
                    $('g-descripcion').value = gasto.descripcion || '';
                    $('g-valor').value = gasto.valor;
                    $('g-anotaciones').value = gasto.anotaciones || '';
                    $('btn-save-gasto').innerText = 'Actualizar Gasto';
                    $('gasto-modal').classList.remove('hidden');
                }
            });
        });

        document.querySelectorAll('.btn-delete-gasto').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                showConfirmModal("Eliminar Gasto", "¿Estás seguro de eliminar este registro de gasto?", async () => {
                    try {
                        await deleteGasto(id);
                        toast('Gasto eliminado', 'success');
                        load();
                    } catch (e) {
                        console.error(e);
                        toast('Error eliminando gasto', 'error');
                    }
                });
            });
        });
    };

    const load = async () => {
        const tbody = $('admin-gastos-body-list');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>Cargando...</td></tr>';

        try {
            const res = await getGastos();
            allGastos = res.data || [];
            if (allGastos.length === 0) {
                gastosPage = 1;
            }
            renderTable();
        } catch (e) {
            console.error(e);
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-red-400">Error cargando gastos.</td></tr>';
        }
    };

    $('gasto-search-input')?.addEventListener('input', () => {
        gastosPage = 1;
        renderTable();
    });

    $('btn-prev-gastos')?.addEventListener('click', () => {
        if (gastosPage > 1) {
            gastosPage--;
            renderTable();
        }
    });

    $('btn-next-gastos')?.addEventListener('click', () => {
        gastosPage++;
        renderTable();
    });

    const btnNew = $('btn-new-gasto');
    const gastoModal = $('gasto-modal');
    const gastoForm = $('gasto-form');

    if (btnNew && gastoModal && gastoForm) {
        // Remove old listeners by cloning
        const newBtnNew = btnNew.cloneNode(true);
        btnNew.parentNode.replaceChild(newBtnNew, btnNew);

        const newGastoForm = gastoForm.cloneNode(true);
        gastoForm.parentNode.replaceChild(newGastoForm, gastoForm);

        const btnCancel = $('btn-cancel-gasto');
        const newBtnCancel = btnCancel.cloneNode(true);
        btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

        newBtnNew.addEventListener('click', () => {
            $('g-id').value = '';
            $('g-destino').value = 'Compra de Insumos';
            $('g-descripcion').value = '';
            $('g-valor').value = '';
            $('g-anotaciones').value = '';
            $('btn-save-gasto').innerText = 'Guardar Gasto';
            gastoModal.classList.remove('hidden');
            $('g-valor').focus();
        });

        newBtnCancel.addEventListener('click', () => {
            gastoModal.classList.add('hidden');
        });

        newGastoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = $('g-id').value;
            const destino = $('g-destino').value;
            const descripcion = $('g-descripcion').value || '';
            const valor = parseFloat($('g-valor').value || '0');
            const anotaciones = $('g-anotaciones').value || '';

            if (isNaN(valor) || valor <= 0) return toast('Valor inválido', 'error');

            try {
                if (id) {
                    await updateGasto(id, { destino, descripcion, valor, anotaciones });
                    toast('Gasto actualizado', 'success');
                } else {
                    await createGasto({ destino, descripcion, valor, anotaciones });
                    toast('Gasto registrado', 'success');
                }
                gastoModal.classList.add('hidden');
                load();
            } catch (err) {
                console.error(err);
                toast(id ? 'Error actualizando' : 'Error creando', 'error');
            }
        });
    }

    load();
}
export async function updateDashboardStats(allOrders, waiterOrders) {
    // Filter out Local orders from the first argument to avoid double counting
    const generalOrders = (allOrders || []).filter(o => o.type !== 'Local');
    const localOrders = waiterOrders || [];

    // Active Orders count (currently in-flight in memory)
    const activeGeneral = generalOrders.filter(o => !['Terminado', 'Entregado', 'Cobrado', 'Anulado'].includes(o.status));
    const activeWaiter = localOrders.filter(o => !['Cobrado', 'Anulado', 'Entregado'].includes(o.status));

    const activeCountEl = $('active-orders-count');
    if (activeCountEl) {
        activeCountEl.innerText = activeGeneral.length + activeWaiter.length;
    }

    // Helper to safely set text
    const setText = (id, val) => {
        const el = $(id);
        if (el) el.innerText = val;
    };

    // Attempt to fetch real aggregated metrics directly from SQLite backend
    let realStats = null;
    try {
        if (typeof ApiClient !== 'undefined' && ApiClient.get) {
            realStats = await ApiClient.get('/admin/dashboard/stats', true);
        }
    } catch (e) {
        console.warn("Could not fetch /admin/dashboard/stats, falling back to client-side state:", e);
    }

    if (realStats && realStats.totals) {
        // 1. REAL HISTORICAL TOTALS (from SQLite)
        const t = realStats.totals;
        setText('stat-total-global', t.total || 0);
        setText('stat-cash', t.cash_count || 0);
        setText('stat-transfer', t.transfer_count || 0);
        setText('stat-completed', t.completed_count || 0);
        setText('stat-cancelled', t.cancelled_count || 0);
        setText('stat-local', t.local_count || 0);
        setText('stat-delivery', t.delivery_count || 0);
        setText('stat-pickup', t.pickup_count || 0);

        // 2. REAL TODAY'S STATS (from SQLite)
        const todayData = realStats.today || {};
        const todayOrders = Number(todayData.today_orders) || 0;
        const todayRevenue = Number(todayData.today_revenue) || 0;
        const todayCash = Number(todayData.today_cash) || 0;
        const todayTransfer = Number(todayData.today_transfer) || 0;

        setText('stat-orders-today', todayOrders);

        const revenueEl = $('stat-revenue-today');
        if (revenueEl) {
            revenueEl.innerHTML = `
                <div class="flex flex-col text-right">
                    <span class="text-[10px] text-gray-500 font-medium">Efec: <span class="text-gray-700">${formatMoney(todayCash)}</span></span>
                    <span class="text-[10px] text-gray-500 font-medium">Trans: <span class="text-gray-700">${formatMoney(todayTransfer)}</span></span>
                    <span class="text-xl font-bold text-gray-800 mt-0.5">${formatMoney(todayRevenue)}</span>
                </div>
            `;
        }

        const totalSalesTodayEl = $('total-sales-today');
        if (totalSalesTodayEl) {
            totalSalesTodayEl.innerHTML = formatMoney(todayRevenue);
        }

        // 3. REAL TOP SELLERS TODAY
        renderTopSellers(generalOrders, localOrders, realStats.topDishesToday);

        // 4. REAL 7-DAY CHARTS & STAR DISH
        renderSevenDayDashboardCharts(generalOrders, localOrders, realStats);
    } else {
        // FALLBACK: Calculate from client state (if offline or server unreachable)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isToday = (dateStr) => {
            const d = getSafeDate(dateStr);
            return d >= today;
        };

        const validGeneral = generalOrders.filter(o =>
            isToday(o.date || o.timestamp) &&
            (o.status === 'Entregado' || o.status === 'Cobrado')
        );

        const validWaiter = localOrders.filter(o =>
            isToday(o.date || o.timestamp) &&
            o.status === 'Cobrado'
        );

        const totalGeneral = validGeneral.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const totalWaiter = validWaiter.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

        const totalEl = $('total-sales-today');
        if (totalEl) {
            totalEl.innerHTML = formatMoney(totalGeneral + totalWaiter);
        }

        const todayOrdersFallback = generalOrders.filter(o => isToday(o.date || o.timestamp) && o.status !== 'Anulado');
        const todayWaiterOrdersFallback = localOrders.filter(o => isToday(o.date || o.timestamp) && o.status !== 'Anulado');

        setText('stat-orders-today', todayOrdersFallback.length + todayWaiterOrdersFallback.length);

        let cashTotal = 0;
        let transferTotal = 0;
        let revenueTotal = 0;

        const processOrderRevenue = (o) => {
            if (o.status === 'Pendiente' || o.status === 'Anulado') return;
            const amt = Number(o.total) || 0;
            revenueTotal += amt;
            const payment = (o.payment || o.paymentMethod || 'Efectivo');
            if (payment === 'Transferencia') {
                transferTotal += amt;
            } else {
                cashTotal += amt;
            }
        };

        todayOrdersFallback.forEach(processOrderRevenue);
        todayWaiterOrdersFallback.forEach(processOrderRevenue);

        const revenueEl = $('stat-revenue-today');
        if (revenueEl) {
            revenueEl.innerHTML = `
                <div class="flex flex-col text-right">
                    <span class="text-[10px] text-gray-500 font-medium">Efec: <span class="text-gray-700">${formatMoney(cashTotal)}</span></span>
                    <span class="text-[10px] text-gray-500 font-medium">Trans: <span class="text-gray-700">${formatMoney(transferTotal)}</span></span>
                    <span class="text-xl font-bold text-gray-800 mt-0.5">${formatMoney(revenueTotal)}</span>
                </div>
            `;
        }

        const combinedHistory = [...generalOrders, ...localOrders];
        let fallbackStats = {
            total: combinedHistory.length,
            cash: 0,
            transfer: 0,
            completed: 0,
            cancelled: 0,
            local: 0,
            delivery: 0,
            pickup: 0
        };

        combinedHistory.forEach(o => {
            const payment = (o.payment || o.paymentMethod || '').toLowerCase();
            if (payment === 'transferencia') fallbackStats.transfer++;
            else fallbackStats.cash++;

            if (o.status === 'Anulado') fallbackStats.cancelled++;
            else fallbackStats.completed++;

            const type = (o.type || o.deliveryType || (o.waiterId ? 'Local' : 'Local'));
            if (type === 'Domicilio') fallbackStats.delivery++;
            else if (type === 'Recoger' || type === 'Para Recoger') fallbackStats.pickup++;
            else fallbackStats.local++;
        });

        setText('stat-total-global', fallbackStats.total);
        setText('stat-cash', fallbackStats.cash);
        setText('stat-transfer', fallbackStats.transfer);
        setText('stat-completed', fallbackStats.completed);
        setText('stat-cancelled', fallbackStats.cancelled);
        setText('stat-local', fallbackStats.local);
        setText('stat-delivery', fallbackStats.delivery);
        setText('stat-pickup', fallbackStats.pickup);

        renderTopSellers(generalOrders, localOrders);
        renderSevenDayDashboardCharts(generalOrders, localOrders);
    }

    // Update Quota Widget
    updateQuotaWidget();
}

function renderTopSellers(generalOrders, localOrders, serverTop3 = null) {
    const container = $('top-sellers-container');
    if (!container) return;

    let top3 = [];

    if (serverTop3 && Array.isArray(serverTop3) && serverTop3.length > 0) {
        top3 = serverTop3;
    } else {
        // Fallback calculation using current state
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isToday = (dateStr) => {
            if (!dateStr) return false;
            const d = getSafeDate(dateStr);
            d.setHours(d.getHours() - 2);
            return d >= today;
        };

        const validGeneral = (generalOrders || []).filter(o => isToday(o.date || o.timestamp) && o.status !== 'Anulado');
        const validLocal = (localOrders || []).filter(o => isToday(o.date || o.timestamp) && o.status !== 'Anulado');
        const allToday = [...validGeneral, ...validLocal];

        const itemCounts = {};
        allToday.forEach(order => {
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach(item => {
                    const name = item.name || 'Producto';
                    const qty = Number(item.qty || item.quantity) || 1;

                    if (!itemCounts[name]) {
                        itemCounts[name] = {
                            name: name,
                            count: 0,
                            price: item.price
                        };
                    }
                    itemCounts[name].count += qty;
                });
            }
        });

        top3 = Object.values(itemCounts).sort((a, b) => b.count - a.count).slice(0, 3);
    }

    if (top3.length === 0) {
        container.innerHTML = `
            <div class="col-span-3 text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <i class="fas fa-chart-bar text-gray-300 text-4xl mb-2"></i>
                <p class="text-gray-400 text-sm">No hay ventas suficientes hoy.</p>
            </div>
        `;
        return;
    }

    // Render Cards
    container.innerHTML = top3.map((item, index) => {
        const medals = ['text-yellow-400', 'text-gray-400', 'text-orange-400']; // Gold, Silver, Bronze
        const medalIcon = index < 3 ? `<i class="fas fa-medal ${medals[index]} text-lg drop-shadow-sm"></i>` : '';
        const rank = index + 1;

        // Try to find image from state.products if possible (Visual Polish)
        const productInfo = (state.products || []).find(p => p.name === item.name);
        const imgUrl = productInfo && productInfo.img ? productInfo.img : 'img/icon.png';

        return `
            <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 transition-transform hover:scale-[1.02]">
                <div class="relative w-16 h-16 shrink-0">
                    <img src="${imgUrl}" alt="Foto de ${escapeHtml(item.name)}" loading="lazy" class="w-full h-full object-cover rounded-lg bg-gray-50">
                    <div class="absolute -top-2 -left-2 w-6 h-6 bg-gray-900 text-white rounded-full flex items-center justify-center text-xs font-bold border-2 border-white shadow-md">
                        #${rank}
                    </div>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start">
                        <h4 class="font-bold text-gray-800 text-sm truncate pr-2">${escapeHtml(item.name)}</h4>
                        ${medalIcon}
                    </div>
                    <p class="text-xs text-gray-500 mt-0.5">${formatMoney(item.price)} / ud.</p>
                    <div class="mt-2 flex items-center gap-2">
                        <div class="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold">
                            ${item.count} vendidos
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ====================================================================
// 7-DAY DASHBOARD CHARTS
// ====================================================================
let chartRevenue7d = null;
let chartWaiters7d = null;

export function renderSevenDayDashboardCharts(generalOrders, localOrders, serverStats = null) {
    // 1. Setup 7 days dates (aligned with restaurant shift)
    const shiftDateObj = new Date(Date.now() - (5 + 2) * 3600 * 1000);
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(shiftDateObj);
        d.setDate(d.getDate() - (6 - i));
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return {
            isoDate: `${year}-${month}-${day}`,
            label: d.toLocaleString('es-CO', { weekday: 'short', day: 'numeric' }).toUpperCase()
        };
    });

    const dateLabels = last7Days.map(d => d.label);

    // 2. Revenue Data (Line Chart)
    let revenueData = [];
    if (serverStats && serverStats.sevenDaysRevenue) {
        const revMap = new Map();
        serverStats.sevenDaysRevenue.forEach(r => {
            revMap.set(r.day, Number(r.revenue) || 0);
        });
        revenueData = last7Days.map(d => revMap.get(d.isoDate) || 0);
    } else {
        const allOrders = [...(generalOrders || []), ...(localOrders || [])].filter(o => o.status !== 'Anulado');
        const today = new Date();
        today.setHours(23, 59, 59, 999);

        revenueData = last7Days.map((_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - (6 - i));
            const endOfDay = d.getTime();
            const startOfDay = endOfDay - 86399999;

            const dayOrders = allOrders.filter(o => {
                const orderTime = getSafeDate(o.date || o.timestamp).getTime();
                return orderTime >= startOfDay && orderTime <= endOfDay;
            });

            let dayRevenue = 0;
            dayOrders.forEach(o => {
                if (o.status !== 'Pendiente') {
                    dayRevenue += (Number(o.total) || 0);
                }
            });
            return dayRevenue;
        });
    }

    // Render Line Chart
    const ctxRevenue = document.getElementById('chart-revenue-7d');
    if (ctxRevenue && window.Chart) {
        if (chartRevenue7d) chartRevenue7d.destroy();

        // Smooth fade-in without jagged bezier curve jumping
        ctxRevenue.style.transition = 'none';
        ctxRevenue.style.opacity = '0';

        chartRevenue7d = new Chart(ctxRevenue, {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [{
                    label: 'Ingresos',
                    data: revenueData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 3,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#3b82f6',
                    pointHoverBackgroundColor: '#3b82f6',
                    pointHoverBorderColor: '#fff',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return formatMoney(context.raw);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function (value) {
                                return value >= 1000 ? '$' + (value / 1000) + 'k' : '$' + value;
                            }
                        },
                        grid: { borderDash: [5, 5] }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });

        // Trigger smooth fade-in
        requestAnimationFrame(() => {
            ctxRevenue.style.transition = 'opacity 0.6s ease-out';
            ctxRevenue.style.opacity = '1';
        });
    }

    // 3. Waiter Tables Data (Doughnut Chart)
    let waiterLabels = [];
    let waiterData = [];

    if (serverStats && serverStats.sevenDaysWaiters) {
        waiterLabels = serverStats.sevenDaysWaiters.map(w => w.waiter);
        waiterData = serverStats.sevenDaysWaiters.map(w => Number(w.count) || 0);
    } else {
        const waiterMap = new Map();
        const validLocal = (localOrders || []).filter(o => o.status !== 'Anulado');
        const startOf7Days = Date.now() - 7 * 86400000;

        validLocal.forEach(o => {
            const orderTime = getSafeDate(o.date || o.timestamp).getTime();
            if (orderTime >= startOf7Days) {
                const waiter = o.waiterName || 'Sin asignar';
                waiterMap.set(waiter, (waiterMap.get(waiter) || 0) + 1);
            }
        });

        waiterLabels = Array.from(waiterMap.keys());
        waiterData = Array.from(waiterMap.values());
    }

    const waiterPalette = [
        '#3b82f6', // Azul zafiro
        '#10b981', // Verde esmeralda
        '#f59e0b', // Ámbar cálido
        '#8b5cf6', // Violeta intenso
        '#ec4899', // Rosa frambuesa
        '#06b6d4', // Cian turquesa
        '#f97316', // Mandarina suave
        '#64748b'  // Pizarra neutro
    ];

    const ctxWaiters = document.getElementById('chart-waiters-7d');
    if (ctxWaiters && window.Chart) {
        if (chartWaiters7d) chartWaiters7d.destroy();
        ctxWaiters.style.transition = 'none';
        ctxWaiters.style.opacity = '0';
        chartWaiters7d = new Chart(ctxWaiters, {
            type: 'doughnut',
            data: {
                labels: waiterLabels.length > 0 ? waiterLabels : ['Sin datos'],
                datasets: [{
                    data: waiterData.length > 0 ? waiterData : [1],
                    backgroundColor: waiterData.length > 0 ? waiterPalette : ['#f3f4f6'],
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, padding: 20 } },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                if (waiterData.length === 0) return ' Sin datos';
                                return ` ${context.label}: ${context.raw} mesas`;
                            }
                        }
                    }
                }
            }
        });
        requestAnimationFrame(() => {
            ctxWaiters.style.transition = 'opacity 0.6s ease-out';
            ctxWaiters.style.opacity = '1';
        });
    }

    // 4. Top Dish 7 Days (Plato Estrella)
    const dishStats = document.getElementById('weekly-top-dish-name');
    const dishSales = document.getElementById('weekly-top-dish-sales');

    if (dishStats && dishSales) {
        if (serverStats && serverStats.starDishWeekly) {
            dishStats.innerText = serverStats.starDishWeekly.name;
            dishSales.innerText = serverStats.starDishWeekly.count + (serverStats.starDishWeekly.count > 1 ? ' ventas' : ' venta');
        } else if (!serverStats) {
            // Fallback calculation from memory
            const dishMap = new Map();
            const allOrders = [...(generalOrders || []), ...(localOrders || [])].filter(o => o.status !== 'Anulado');
            const startOf7Days = Date.now() - 7 * 86400000;

            allOrders.forEach(o => {
                const orderTime = getSafeDate(o.date || o.timestamp).getTime();
                if (orderTime >= startOf7Days) {
                    let items = [];
                    try { items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []); } catch (e) { }
                    items.forEach(item => {
                        const name = item.name || 'Producto';
                        const qty = Number(item.qty || item.quantity) || 1;
                        dishMap.set(name, (dishMap.get(name) || 0) + qty);
                    });
                }
            });

            if (dishMap.size > 0) {
                const sortedDishes = Array.from(dishMap.entries()).sort((a, b) => b[1] - a[1]);
                const topDish = sortedDishes[0];
                dishStats.innerText = topDish[0];
                dishSales.innerText = topDish[1] + (topDish[1] > 1 ? ' ventas' : ' venta');
            } else {
                dishStats.innerText = 'Sin ventas aún';
                dishSales.innerText = '0 ventas';
            }
        } else {
            dishStats.innerText = 'Sin ventas aún';
            dishSales.innerText = '0 ventas';
        }
    }
}

// ====================================================================
// MODAL DE DETALLES DEL PEDIDO
// ====================================================================
window.showOrderDetails = function (orderIdOrObj) {
    let order;

    if (typeof orderIdOrObj === 'object') {
        order = orderIdOrObj;
    } else {
        const orderId = orderIdOrObj;
        order = state.orders.find(o => o.id === orderId);

        // Check in Waiter Orders if not found in General
        if (!order && state.waiterOrders) {
            order = state.waiterOrders.find(o => o.uid === orderId || o.id === orderId);
        }

        if (!order) {
            console.warn("Order not found for details:", orderId);
            return;
        }
    }

    // Determine Client/Table Info
    let clientName = order.client || order.waiterName || "Cliente Local";
    let clientPhone = order.phone || order.clientPhone || "No registrado";
    let address = order.deliveryAddress || order.address || " - ";

    // Special handling for Local Orders
    if (order.table) {
        // Use stored client info, default to "Cliente Final" if missing
        clientName = order.client || "Cliente Final";
        clientPhone = order.phone || order.clientPhone || "No registrado";
        address = "En Restaurante";
    }

    // Populate Fields
    document.getElementById('od-id').textContent = `ID: ${order.id}`;
    document.getElementById('od-client').textContent = clientName;
    document.getElementById('od-phone').textContent = clientPhone;
    document.getElementById('od-address').textContent = address;

    // Toggle Client Card & Table Info for Local Orders
    const clientCard = document.getElementById('od-client-card');
    const tableRow = document.getElementById('od-table-row');
    const tableVal = document.getElementById('od-table');
    const waiterFooter = document.getElementById('od-waiter-footer');

    // Always hide the "Waiter Order Creation" footer in Details View
    if (waiterFooter) waiterFooter.classList.add('hidden');

    // Always show Client Card (User Request: Restore visibility)
    if (clientCard) clientCard.classList.remove('hidden');

    if (order.table) {
        // Local Order
        if (tableRow) {
            tableRow.classList.remove('hidden');
            tableVal.textContent = order.table;
        }
    } else {
        // General Order
        if (tableRow) tableRow.classList.add('hidden');
    }

    // Date Formatting (Simplified)
    const dateObj = getSafeDate(order.timestamp || order.date);
    document.getElementById('od-date').textContent = dateObj.toLocaleString('es-CO', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    document.getElementById('od-type').textContent = order.type || order.deliveryType || "Local";
    document.getElementById('od-pay').textContent = order.payment || order.paymentMethod || "Efectivo";
    document.getElementById('od-status').innerHTML = getStatusBadge(order.status);

    // Populate Staff Info
    const chefEl = document.getElementById('od-chef');
    const staffEl = document.getElementById('od-staff');

    if (chefEl) {
        chefEl.innerHTML = order.chefName
            ? `<i class="fas fa-fire-alt text-orange-500"></i> ${escapeHtml(order.chefName)}`
            : '<span class="text-gray-300">-</span>';
    }

    if (staffEl) {
        let staffHtml = '<span class="text-gray-300">-</span>';
        if (order.deliveryDriverName) {
            staffHtml = `<i class="fas fa-motorcycle text-blue-500"></i> ${escapeHtml(order.deliveryDriverName)}`;
        } else if (order.waiterName) {
            staffHtml = `<i class="fas fa-user-tie text-purple-500"></i> ${escapeHtml(order.waiterName)}`;
        }
        staffEl.innerHTML = staffHtml;
    }

    // Products
    const tbody = document.getElementById('od-products-body');
    tbody.innerHTML = '';

    // Ensure items exists and handle potential structure differences
    const items = order.items || [];

    items.forEach(item => {
        // Fix for undefined quantity (use item.qty which matches DB)
        const qty = item.qty || item.quantity || 1;

        const toppingsText = item.toppings_text || (Array.isArray(item.toppings) ? item.toppings.map(t => t.name).join(', ') : '');
        const notesText = item.notes || item.note || '';

        tbody.innerHTML += `
            <tr class="border-b border-gray-50 last:border-0">
                <td class="p-2.5 text-gray-500 font-bold w-12 text-center bg-gray-50/30">${qty}</td>
                <td class="p-2.5">
                    <div class="font-bold text-gray-800">${escapeHtml(item.name)}</div>
                    ${item.variant_name ? `<div class="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 inline-flex items-center gap-1 mt-0.5 mr-1"><i class="fas fa-layer-group text-[9px]"></i><span>Tamaño: ${escapeHtml(item.variant_name)}</span></div>` : ''}
                    ${toppingsText ? `<div class="text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/70 inline-flex items-center gap-1 mt-0.5"><i class="fas fa-cookie-bite text-[9px] text-amber-600"></i><span>${escapeHtml(toppingsText)}</span></div>` : ''}
                    ${notesText ? `<div class="text-xs text-orange-600 italic mt-0.5 flex items-center gap-1"><i class="fas fa-comment-alt text-[9px]"></i><span>${escapeHtml(notesText)}</span></div>` : ''}
                </td>
                <td class="p-2.5 text-right text-gray-500 text-xs">${formatMoney(item.price)}</td>
                <td class="p-2.5 text-right font-bold text-gray-700">${formatMoney(item.price * qty)}</td>
            </tr>
        `;
    });

    // Tip & Discount Logic
    const tipVal = parseFloat(order.tip) || 0;
    const discountVal = parseFloat(order.discount) || 0;
    const tipRow = document.getElementById('od-tip-row');
    const discountRow = document.getElementById('od-discount-row');
    const odTip = document.getElementById('od-tip');
    const odDiscount = document.getElementById('od-discount');
    const odReason = document.getElementById('od-discount-reason-text');

    if (tipRow && odTip) {
        if (tipVal > 0) {
            tipRow.classList.remove('hidden');
            odTip.textContent = `+${formatMoney(tipVal)}`;
        } else {
            tipRow.classList.add('hidden');
        }
    }

    if (discountRow && odDiscount) {
        if (discountVal > 0) {
            discountRow.classList.remove('hidden');
            odDiscount.textContent = `-${formatMoney(discountVal)}`;
            if (odReason) odReason.textContent = order.discount_reason ? `(${escapeHtml(order.discount_reason)})` : '';
        } else {
            discountRow.classList.add('hidden');
        }
    }

    // Delivery Fee Logic
    const deliveryFeeVal = parseFloat(order.delivery_fee) || 0;
    const deliveryFeeRow = document.getElementById('od-delivery-fee-row');
    const odDeliveryFee = document.getElementById('od-delivery-fee');
    const odDeliveryZone = document.getElementById('od-delivery-zone-text');

    if (deliveryFeeRow && odDeliveryFee) {
        if (deliveryFeeVal > 0 || (order.type === 'Domicilio' && order.delivery_zone)) {
            deliveryFeeRow.classList.remove('hidden');
            odDeliveryFee.textContent = `+${formatMoney(deliveryFeeVal)}`;
            if (odDeliveryZone) odDeliveryZone.textContent = order.delivery_zone ? `(${escapeHtml(order.delivery_zone)})` : '';
        } else {
            deliveryFeeRow.classList.add('hidden');
        }
    }

    // Fix NaN Total
    // Ensure total is a number. Waiter orders use 'total', General orders use 'total'.
    // The 'order.total' value already includes tips and discounts from the backend calculation.
    const totalVal = Number(order.total) || 0;
    document.getElementById('od-total').textContent = `${formatMoney(totalVal)}`;

    // Notes
    const notesEl = document.getElementById('od-notes');
    notesEl.textContent = order.notes || "Sin observaciones.";

    // Cancel Reason
    const cancelReasonContainer = document.getElementById('od-cancel-reason-container');
    const cancelReasonEl = document.getElementById('od-cancel-reason');
    if (order.status === 'Anulado' && order.cancel_reason) {
        cancelReasonContainer.classList.remove('hidden');
        cancelReasonEl.textContent = order.cancel_reason;
    } else {
        cancelReasonContainer.classList.add('hidden');
        cancelReasonEl.textContent = 'N/A';
    }

    // Proof (Handle paymentProof or proof property)
    const proofContainer = document.getElementById('od-proof-container');
    const proofImg = document.getElementById('od-proof-img');
    const proofUrl = order.proof || order.receiptProof;

    if (proofUrl) {
        proofContainer.classList.remove('hidden');
        proofImg.src = proofUrl;
        window.currentProofUrl = proofUrl;
    } else {
        proofContainer.classList.add('hidden');
    }

    // Show Modal
    document.getElementById('order-details-modal').classList.remove('hidden');
};

// Helper for proof inside details modal
window.openProofModalFromDetails = function () {
    if (window.currentProofUrl) {
        showImageModal(window.currentProofUrl);
    }
};

// Global Listener for ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('order-details-modal').classList.add('hidden');
    }
});

// ==========================================
// VIEW NOTES LOGIC (Admin/Chef)


// ==========================================
// VIEW NOTES LOGIC (Admin/Chef)
// ==========================================
// Exposed to window for onclick
// ==========================================
// VIEW NOTES LOGIC (Admin/Chef)
// ==========================================

// State to track if we are in "Global" mode or "Single Order" mode
let isGlobalNotesMode = false;

// Exposed to window for onclick
window.openViewNotesModal = async (orderId) => {
    isGlobalNotesMode = false;
    window.currentOrderNotesId = orderId; // Track current
    const modal = document.getElementById('view-notes-modal');
    const container = document.getElementById('view-notes-list');
    const subtitle = document.getElementById('notes-subtitle');

    if (!modal || !container) return;

    if (subtitle) subtitle.innerHTML = `Notas del pedido <span class="font-bold">#${orderId}</span>`;

    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-300"></i><p class="text-xs text-gray-400 mt-2">Cargando notas...</p></div>';
    modal.classList.remove('hidden');

    // Wire close buttons
    const btnCloseAction = document.getElementById('btn-close-view-notes-action');
    if (btnCloseAction) btnCloseAction.onclick = () => modal.classList.add('hidden');

    // Wire "Notas Archivadas" shortcut button (sub-function of this modal)
    const btnArchived = document.getElementById('btn-open-archived-from-notes');
    if (btnArchived) {
        if (state.user && state.user.role === 'admin') {
            btnArchived.classList.remove('hidden');
            btnArchived.onclick = () => {
                modal.classList.add('hidden');
                if (window.openArchivedNotesModal) window.openArchivedNotesModal();
            };
        } else {
            btnArchived.classList.add('hidden');
            btnArchived.onclick = null;
        }
    }

    await fetchAndRenderNotes(orderId);
};

window.openGlobalNotesModal = async () => {
    isGlobalNotesMode = true;
    const modal = document.getElementById('view-notes-modal');
    const container = document.getElementById('view-notes-list');
    const subtitle = document.getElementById('notes-subtitle');

    if (!modal || !container) return;

    if (subtitle) subtitle.innerText = "Todas las anotaciones pendientes";

    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-2xl text-gray-300"></i><p class="text-xs text-gray-400 mt-2">Cargando notas...</p></div>';
    modal.classList.remove('hidden');

    const btnCloseAction = document.getElementById('btn-close-view-notes-action');
    if (btnCloseAction) btnCloseAction.onclick = () => modal.classList.add('hidden');

    // Wire "Notas Archivadas" shortcut button (sub-function of this modal)
    const btnArchived = document.getElementById('btn-open-archived-from-notes');
    if (btnArchived) {
        if (state.user && state.user.role === 'admin') {
            btnArchived.classList.remove('hidden');
            btnArchived.onclick = () => {
                modal.classList.add('hidden');
                if (window.openArchivedNotesModal) window.openArchivedNotesModal();
            };
        } else {
            btnArchived.classList.add('hidden');
            btnArchived.onclick = null;
        }
    }

    await fetchAndRenderGlobalNotes();
};

async function fetchAndRenderNotes(orderId) {
    const container = document.getElementById('view-notes-list');
    try {
        const notes = await getOrderNotes(orderId);
        renderNotesList(container, notes);
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400">Error cargando notas</div>';
    }
}

async function fetchAndRenderGlobalNotes() {
    const container = document.getElementById('view-notes-list');
    try {
        let groups = [];
        // Use service function
        const response = await getActiveNotes();
        groups = response || [];

        container.innerHTML = '';
        if (groups.length === 0) {
            // Reset class to flex so the empty state centers correctly (not affected by leftover grid class)
            container.className = "flex flex-col flex-1 items-center justify-center";
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center">
                    <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-3">
                        <i class="fas fa-check text-2xl text-green-500"></i>
                    </div>
                    <h3 class="text-gray-800 font-bold">Todo al día</h3>
                    <p class="text-sm text-gray-400">No hay anotaciones pendientes.</p>
                </div>`;
            return;
        }

        // Grid Layout for Desktop
        container.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-2";

        // Render Groups
        groups.forEach(group => {
            const groupDiv = document.createElement('div');
            // Card style, h-fit to stack nicely
            groupDiv.className = "bg-white rounded-xl border border-gray-200 shadow-sm animate-fade-in-up flex flex-col h-fit";

            // Header: Order ID & Waiter
            const headerHtml = `
                <div class="bg-gray-50 p-3 border-b border-gray-100 flex justify-between items-start rounded-t-xl" onclick="toggleNoteGroup('group-${group.orderId}')">
                    <div class="flex flex-col">
                        <span class="font-bold text-gray-800 text-lg leading-tight">Pedido #${group.orderId}</span>
                        <span class="text-xs text-gray-500 font-medium mt-0.5"><i class="fas fa-user-tie mr-1 opacity-70"></i>${escapeHtml(group.waiter)}</span>
                    </div>
                    
                    <div class="flex items-center gap-2">
                        <div class="text-right">
                             <div class="text-[10px] text-gray-400 font-medium">${group.table !== 'N/A' ? 'Mesa ' + group.table : 'General'}</div>
                             <div class="text-[10px] text-gray-400 truncate max-w-[80px]">${escapeHtml(group.client || '')}</div>
                        </div>
                        <i class="fas fa-chevron-down text-gray-300 transition-transform" id="icon-group-${group.orderId}"></i>
                    </div>
                </div>
            `;

            // Body Wrapper (Accordion Animation)
            const wrapperDiv = document.createElement('div');
            wrapperDiv.id = `group-${group.orderId}`;
            wrapperDiv.className = "grid grid-rows-[0fr] transition-[grid-template-rows] duration-500 ease-out"; // Default collapsed

            // Inner Content
            const innerDiv = document.createElement('div');
            innerDiv.className = "overflow-hidden";

            // Notes List Container
            const notesListDiv = document.createElement('div');
            notesListDiv.className = "p-2 space-y-2";

            renderNotesList(notesListDiv, group.notes, true, false); // readOnly=false: admin puede resolver

            innerDiv.appendChild(notesListDiv);
            wrapperDiv.appendChild(innerDiv);

            groupDiv.innerHTML = headerHtml;
            groupDiv.appendChild(wrapperDiv);
            container.appendChild(groupDiv);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400">Error cargando notas globales</div>';
    }
}

// Global toggle for accordion
window.toggleNoteGroup = (id) => {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon-' + id);
    if (el) {
        // Toggle Open/Close state
        if (el.classList.contains('grid-rows-[0fr]')) {
            el.classList.replace('grid-rows-[0fr]', 'grid-rows-[1fr]');
            if (icon) icon.classList.add('rotate-180');
        } else {
            el.classList.replace('grid-rows-[1fr]', 'grid-rows-[0fr]');
            if (icon) icon.classList.remove('rotate-180');
        }
    }
}

function renderNotesList(container, notes, isEmbedded = false, readOnly = false) {
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400">No hay notas.</div>';
        return;
    }

    // Clear if not appending (usually we clear before calling)
    if (!isEmbedded) container.innerHTML = '';

    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = isEmbedded
            ? "bg-gray-50 p-3 rounded-lg border border-gray-100 flex items-start gap-3"
            : "bg-gray-50 p-3 rounded-xl border border-gray-100 flex items-start gap-3 animate-fade-in mb-2";

        const isSolved = note.solved;
        const checkId = `check-note-${note.id}`;

        // Resolved By info
        let solvedInfo = '';
        if (isSolved) {
            const name = note.solvedByName || 'Usuario';
            const timeStr = note.solvedAt ? new Date(note.solvedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : '';

            // Layout: User | Time (Compact)
            solvedInfo = `<div class="text-[10px] text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded border border-green-200 inline-flex items-center gap-1 mt-1">
                            <i class="fas fa-check-circle text-green-500"></i>
                            <span>Resuelto por: ${escapeHtml(name)}</span>
                            ${timeStr ? `<span class="text-green-600 font-normal border-l border-green-200 pl-1 ml-0.5">${timeStr}</span>` : ''}
                          </div>`;
        }

        const checkboxHtml = readOnly ? '' : `
            <div class="flex flex-col gap-2 pt-1 shrink-0 ml-2">
                 <label class="cursor-pointer relative group" title="${isSolved ? 'Marcar como pendiente' : 'Marcar como resuelto'}">
                    <input type="checkbox" id="${checkId}" class="peer sr-only" ${isSolved ? 'checked' : ''} onchange="handleToggleNote('${note.id}', this.checked)">
                    <div class="w-6 h-6 border-2 border-gray-300 rounded-md peer-checked:bg-[var(--system-primary)] peer-checked:border-[var(--system-primary)] transition-colors flex items-center justify-center hover:border-gray-400">
                        <i class="fas fa-check text-[var(--system-secondary)] text-xs opacity-0 peer-checked:opacity-100 font-black"></i>
                    </div>
                </label>
            </div>`;

        div.innerHTML = `
            <div class="flex-1 min-w-0 flex flex-col justify-center">
                <p class="text-sm text-gray-800 break-words leading-tight ${isSolved ? 'line-through text-gray-400' : ''}" id="text-${note.id}">${escapeHtml(note.content)}</p>
                <div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span class="text-[10px] text-gray-500 flex items-center"><i class="far fa-clock mr-1"></i>${new Date(note.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })} - ${note.waiterName || 'Mesero'}</span>
                    ${solvedInfo}
                </div>
            </div>
            ${checkboxHtml}
        `;
        container.appendChild(div);
    });
}


// Helper to refresh the list without re-opening modal
async function refreshNotesList(orderId) {
    if (isGlobalNotesMode) {
        // Refresh entire global view
        await fetchAndRenderGlobalNotes();
    } else {
        // Refresh specific order
        // Only if currently open order matches (handled by caller logic usually, but here just fetch)
        // If we want to be safe: check if window.currentOrderNotesId == orderId? 
        // Logic moved to `refreshNotesIfOpen` mainly.
        // But `fetchAndRenderNotes` uses valid container check.
        await fetchAndRenderNotes(orderId);
    }
}

window.handleToggleNote = async (noteId, isChecked) => {
    try {
        const textEl = document.getElementById(`text-${noteId}`);
        if (textEl) {
            if (isChecked) textEl.classList.add('line-through', 'text-gray-400');
            else textEl.classList.remove('line-through', 'text-gray-400');
        }

        // Apply optimistic UI update for "Resolved" badge? 
        // Better to wait for socket update to re-render fully correct state including "Resolved By User"
        // But we need to send the request.

        await solveOrderNote(noteId, isChecked, state.user.id);
        toast(isChecked ? 'Nota marcada como resuelta' : 'Nota marcada como pendiente', 'success');

    } catch (e) {
        console.error(e);
        toast('Error actualizando nota', 'error');
        // Revert checkbox if error?
        const check = document.getElementById(`check-note-${noteId}`);
        if (check) check.checked = !isChecked;
    }
}
