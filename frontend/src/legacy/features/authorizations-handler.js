import { state } from '../core/state.js';
import { toast } from '../components/ui.js';
import { ApiClient } from '../services/api-client.js';

let isListening = false;
let currentPendingModal = null;
const pendingQueue = [];

/**
 * Initializes the real-time authorization listener for Admins and Supervisors.
 */
export function initAuthorizationsHandler(socket) {
    if (!socket || isListening) return;
    isListening = true;

    // Listen for real-time requests from cashiers
    socket.on('authorization:requested', (data) => {
        const user = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
        if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) return;

        console.log('[AUTHORIZATIONS] Incoming request:', data);
        queueOrShowAuthModal(data);
    });

    // Check for any pending requests on startup for admin/supervisor
    checkPendingAuthorizations();
}

/**
 * Fetches pending requests on page load or user change.
 */
export async function checkPendingAuthorizations() {
    const user = state.user || JSON.parse(localStorage.getItem('pos_user') || 'null');
    if (!user || (user.role !== 'admin' && user.role !== 'supervisor')) return;
    const token = localStorage.getItem('pos_token');
    if (!token) return;

    try {
        const res = await fetch('/api/authorizations/pending', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) {
                list.forEach(item => {
                    if (!pendingQueue.some(q => q.id === item.id)) {
                        queueOrShowAuthModal(item);
                    }
                });
            }
        }
    } catch (e) {
        console.error('[AUTHORIZATIONS] Error checking pending requests:', e);
    }
}

function queueOrShowAuthModal(data) {
    // Avoid duplicates in queue
    if (pendingQueue.some(item => item.id === data.id)) return;
    pendingQueue.push(data);

    if (!currentPendingModal) {
        showNextPendingModal();
    }
}

function showNextPendingModal() {
    if (pendingQueue.length === 0) {
        if (currentPendingModal) {
            currentPendingModal.remove();
            currentPendingModal = null;
        }
        return;
    }

    const data = pendingQueue[0];
    renderAuthModal(data);
}

function renderAuthModal(data) {
    // Play alert sound
    try {
        const audio = document.getElementById('notificationSound');
        if (audio) audio.play().catch(() => {});
    } catch (e) {}

    if (currentPendingModal) {
        currentPendingModal.remove();
        currentPendingModal = null;
    }

    const isCancel = data.type === 'cancel';
    const typeLabel = isCancel ? 'Anulación de Pedido' : 'Edición de Pedido';
    const badgeColor = isCancel ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-100 text-blue-700 border-blue-200';
    const actionIcon = isCancel ? 'fa-ban' : 'fa-edit';
    const formattedTotal = Number(data.total || 0).toLocaleString();

    const modal = document.createElement('div');
    modal.id = 'incoming-auth-modal';
    modal.className = 'fixed inset-0 bg-black/60 z-[95] flex justify-center items-center px-4 backdrop-blur-sm animate-fade-in';
    modal.innerHTML = `
        <div class="glass-panel w-full max-w-md rounded-3xl shadow-2xl p-6 bg-white border border-gray-100 slide-up text-left">
            <div class="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg shadow-sm">
                        <i class="fas fa-bell animate-bounce"></i>
                    </span>
                    <div>
                        <h3 class="font-bold text-gray-800 text-base">Solicitud de Autorización</h3>
                        <p class="text-xs text-gray-400">Un cajero solicita tu permiso en tiempo real</p>
                    </div>
                </div>
                <span class="text-[11px] font-bold px-2.5 py-1 rounded-full border ${badgeColor} flex items-center gap-1.5">
                    <i class="fas ${actionIcon}"></i> ${typeLabel}
                </span>
            </div>

            <div class="bg-gray-50/80 rounded-2xl p-4 border border-gray-200/70 space-y-2.5 mb-5">
                <div class="flex justify-between items-center text-xs">
                    <span class="text-gray-500 font-medium">Pedido:</span>
                    <span class="font-bold text-gray-800">#${data.orderId} ${data.tableNum ? `(Mesa ${data.tableNum})` : ''}</span>
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-gray-500 font-medium">Cliente:</span>
                    <span class="font-semibold text-gray-700">${data.client || 'Cliente General'}</span>
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-gray-500 font-medium">Valor total:</span>
                    <span class="font-bold text-gray-900 text-sm">$${formattedTotal}</span>
                </div>
                <div class="flex justify-between items-center text-xs">
                    <span class="text-gray-500 font-medium">Cajero solicitante:</span>
                    <span class="font-bold text-indigo-600">${data.requestedByName || 'Cajero'}</span>
                </div>
                <div class="pt-2 border-t border-gray-200/60">
                    <span class="text-[11px] text-gray-400 font-bold block mb-1">MOTIVO INDICADO:</span>
                    <p class="text-xs text-gray-800 font-medium bg-white p-2.5 rounded-xl border border-gray-200/80 italic">
                        "${data.reason || 'Sin motivo especificado'}"
                    </p>
                </div>
            </div>

            <div class="flex items-center gap-3">
                <button type="button" id="btn-auth-reject"
                    class="flex-1 py-3 px-4 bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-700 rounded-xl font-bold text-xs transition-all border border-gray-200 hover:border-red-200 flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                    <i class="fas fa-times"></i> Rechazar
                </button>
                <button type="button" id="btn-auth-approve"
                    class="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                    <i class="fas fa-check"></i> Aprobar Ahora
                </button>
            </div>
            ${pendingQueue.length > 1 ? `
                <p class="text-[10px] text-center text-gray-400 mt-3 font-medium">
                    +${pendingQueue.length - 1} solicitud(es) adicional(es) pendiente(s)
                </p>
            ` : ''}
        </div>
    `;

    document.body.appendChild(modal);
    currentPendingModal = modal;

    const btnApprove = modal.querySelector('#btn-auth-approve');
    const btnReject = modal.querySelector('#btn-auth-reject');

    btnApprove.onclick = async () => {
        btnApprove.disabled = true;
        btnApprove.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aprobando...';
        await resolveRequest(data.id, 'approve');
    };

    btnReject.onclick = async () => {
        btnReject.disabled = true;
        btnReject.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rechazando...';
        await resolveRequest(data.id, 'reject');
    };
}

async function resolveRequest(authId, action) {
    const token = localStorage.getItem('pos_token') || '';
    try {
        const res = await fetch(`/api/authorizations/${authId}/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ action })
        });
        const result = await res.json();

        if (res.ok) {
            toast(action === 'approve' ? 'Solicitud aprobada con éxito' : 'Solicitud rechazada', action === 'approve' ? 'success' : 'info');
        } else {
            toast(result.error || 'Error al procesar solicitud', 'error');
        }
    } catch (e) {
        console.error('[AUTHORIZATIONS] Error resolving request:', e);
        toast('Error de conexión al resolver la solicitud', 'error');
    } finally {
        // Remove from queue and show next if any
        const idx = pendingQueue.findIndex(item => item.id === authId);
        if (idx !== -1) pendingQueue.splice(idx, 1);
        showNextPendingModal();
    }
}
