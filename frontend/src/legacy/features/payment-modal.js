import { $, formatMoney } from '../utils/helpers.js';
import { state } from '../core/state.js';
import { toast, setLoading, showModalAlert } from '../components/ui.js';
import { getAccounts } from '../services/cashflow-service.js';
import { compressProof } from '../utils/image-utils.js';
import { ApiClient } from '../services/api-client.js';
import { OfflineDB } from '../services/offline-db.js';

let currentOrder = null;
let onPaymentCompleteCallback = null;
let cachedAccounts = [];
let selectedMethod = 'Efectivo';
let transferProofFile = null;
let mixedProofFile = null;
let existingProofUrl = null;
let mixedSplits = [];

export function initPaymentModal() {
    const modal = $('payment-method-modal');
    if (!modal) return;

    // Close buttons
    $('btn-close-pm-modal')?.addEventListener('click', closePaymentModal);
    $('btn-cancel-pm')?.addEventListener('click', closePaymentModal);

    // Method switcher tabs
    const methodTabs = document.querySelectorAll('#pm-method-tabs .pm-method-btn');
    methodTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const method = btn.dataset.method;
            selectPaymentMethod(method);
        });
    });

    // Auto-calculate change in cash section
    const cashReceivedInput = $('pm-cash-received');
    if (cashReceivedInput) {
        cashReceivedInput.addEventListener('input', updateCashChange);
    }

    // Add row in dynamic mixed section
    $('btn-pm-add-row')?.addEventListener('click', () => {
        if (!currentOrder) return;
        const total = parseFloat(currentOrder.total) || 0;
        const assigned = mixedSplits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
        const rem = Math.max(0, total - assigned);

        // Pick next method logically
        const existingMethods = mixedSplits.map(s => s.method);
        let nextMethod = 'Transferencia';
        if (existingMethods.includes('Transferencia') && !existingMethods.includes('Datáfono')) nextMethod = 'Datáfono';
        else if (existingMethods.includes('Transferencia') && existingMethods.includes('Datáfono')) nextMethod = 'Efectivo';
        else if (!existingMethods.includes('Transferencia')) nextMethod = 'Transferencia';

        mixedSplits.push({
            method: nextMethod,
            amount: rem,
            account_id: getDefaultAccountId(nextMethod)
        });

        renderMixedRows();
        updateMixedBalanceStatus();
    });

    // Transfer proof upload
    const transferFileInput = $('pm-transfer-proof-file');
    if (transferFileInput) {
        transferFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const blob = await compressProof(file);
                    transferProofFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", { type: 'image/webp' });
                    previewProof('pm-transfer-proof-preview-container', 'pm-transfer-proof-img', transferProofFile);
                    toast("Comprobante optimizado", "success");
                } catch (err) {
                    console.error("Error comprimiendo comprobante:", err);
                    transferProofFile = file;
                    previewProof('pm-transfer-proof-preview-container', 'pm-transfer-proof-img', file);
                }
            }
        });
    }

    $('btn-remove-transfer-proof')?.addEventListener('click', () => {
        transferProofFile = null;
        if (transferFileInput) transferFileInput.value = '';
        $('pm-transfer-proof-preview-container')?.classList.add('hidden');
    });

    // Mixed proof upload
    const mixedFileInput = $('pm-mixed-proof-file');
    if (mixedFileInput) {
        mixedFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const blob = await compressProof(file);
                    mixedProofFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", { type: 'image/webp' });
                    previewProof('pm-mixed-proof-preview-container', 'pm-mixed-proof-img', mixedProofFile);
                    toast("Comprobante optimizado", "success");
                } catch (err) {
                    console.error("Error comprimiendo comprobante:", err);
                    mixedProofFile = file;
                    previewProof('pm-mixed-proof-preview-container', 'pm-mixed-proof-img', file);
                }
            }
        });
    }

    $('btn-remove-mixed-proof')?.addEventListener('click', () => {
        mixedProofFile = null;
        if (mixedFileInput) mixedFileInput.value = '';
        $('pm-mixed-proof-preview-container')?.classList.add('hidden');
    });

    // Confirm Cobro button
    $('btn-confirm-pm')?.addEventListener('click', handleConfirmCobro);
}

function previewProof(containerId, imgId, fileOrUrl) {
    const container = $(containerId);
    const img = $(imgId);
    if (!container || !img) return;

    if (typeof fileOrUrl === 'string') {
        img.src = fileOrUrl;
        container.classList.remove('hidden');
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            container.classList.remove('hidden');
        };
        reader.readAsDataURL(fileOrUrl);
    }
}

export async function openPaymentModal(order, onComplete = null) {
    if (!order) return;
    currentOrder = order;
    onPaymentCompleteCallback = onComplete;
    transferProofFile = null;
    mixedProofFile = null;
    existingProofUrl = order.proof && order.proof !== 'null' && order.proof !== '' ? order.proof : null;

    const modal = $('payment-method-modal');
    if (!modal) return;

    // Header info
    const idBadge = $('pm-order-id-badge');
    if (idBadge) idBadge.textContent = `#${order.id}`;

    const subtitle = $('pm-order-subtitle');
    if (subtitle) {
        if (order.type === 'Local') {
            subtitle.textContent = `Mesa ${order.table || order.tableNum || '?'} • Mesero: ${order.waiterName || 'Staff'}`;
        } else {
            subtitle.textContent = `${order.type} • ${order.client || 'Cliente'}`;
        }
    }

    const totalDisplay = $('pm-order-total-display');
    if (totalDisplay) totalDisplay.textContent = formatMoney(order.total);

    const typeBadge = $('pm-order-type-badge');
    if (typeBadge) typeBadge.textContent = order.type || 'Local';

    const btnText = $('btn-confirm-pm-text');
    if (btnText) btnText.textContent = `Confirmar Cobro (${formatMoney(order.total)})`;

    // Reset inputs
    const cashRec = $('pm-cash-received');
    if (cashRec) cashRec.value = '';
    const cashChg = $('pm-cash-change');
    if (cashChg) cashChg.textContent = '$0';

    const notesInput = $('pm-payment-notes');
    if (notesInput) notesInput.value = '';

    // Load accounts
    await loadAccountsIntoSelects();

    // Default or preselected payment method
    let initialMethod = 'Efectivo';
    if (order.payment === 'Transferencia') initialMethod = 'Transferencia';
    else if (order.payment === 'Datáfono' || order.payment === 'Tarjeta') initialMethod = 'Datáfono';
    else if (order.payment === 'Mixto') initialMethod = 'Mixto';

    // Initialize dynamic mixed payment splits
    const total = parseFloat(order.total) || 0;
    let parsedDetails = null;
    if (order.payment_details) {
        try {
            parsedDetails = typeof order.payment_details === 'string' ? JSON.parse(order.payment_details) : order.payment_details;
        } catch (e) {}
    }

    if (parsedDetails && Array.isArray(parsedDetails.splits) && parsedDetails.splits.length > 0) {
        mixedSplits = parsedDetails.splits.map(s => {
            const m = s.method || 'Efectivo';
            return {
                method: m,
                amount: parseFloat(s.amount) || 0,
                account_id: s.account_id ? parseInt(s.account_id, 10) : getDefaultAccountId(m)
            };
        });
    } else if (order.payment === 'Mixto' && (order.cash_amount > 0 || order.transfer_amount > 0)) {
        mixedSplits = [
            { method: 'Efectivo', amount: parseFloat(order.cash_amount) || 0, account_id: order.cash_account_id || getDefaultAccountId('Efectivo') },
            { method: 'Transferencia', amount: parseFloat(order.transfer_amount) || 0, account_id: order.transfer_account_id || getDefaultAccountId('Transferencia') }
        ];
    } else {
        // Default 2 initial rows: Efectivo + Transferencia
        const half = Math.round(total / 2);
        mixedSplits = [
            { method: 'Efectivo', amount: half, account_id: getDefaultAccountId('Efectivo') },
            { method: 'Transferencia', amount: Math.max(0, total - half), account_id: getDefaultAccountId('Transferencia') }
        ];
    }
    renderMixedRows();
    updateMixedBalanceStatus();

    // Show existing proof if available
    if (existingProofUrl) {
        previewProof('pm-transfer-proof-preview-container', 'pm-transfer-proof-img', existingProofUrl);
        previewProof('pm-mixed-proof-preview-container', 'pm-mixed-proof-img', existingProofUrl);
    } else {
        $('pm-transfer-proof-preview-container')?.classList.add('hidden');
        $('pm-mixed-proof-preview-container')?.classList.add('hidden');
    }

    selectPaymentMethod(initialMethod);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closePaymentModal() {
    const modal = $('payment-method-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    currentOrder = null;
    transferProofFile = null;
    mixedProofFile = null;
    existingProofUrl = null;
}

async function loadAccountsIntoSelects() {
    try {
        cachedAccounts = await getAccounts({ active: true }) || [];
    } catch (e) {
        console.error("Error al cargar cuentas financieras:", e);
        cachedAccounts = [];
    }

    const cashAccounts = cachedAccounts.filter(a => a.type === 'Efectivo');
    const transferAccounts = cachedAccounts.filter(a => a.type === 'Transferencia');
    const cardAccounts = cachedAccounts.filter(a => a.type === 'Datáfono' || a.type === 'Transferencia');

    const renderOptions = (accounts, selectedId, fallbackName) => {
        if (accounts.length === 0) {
            return `<option value="">${fallbackName} (Predeterminada)</option>`;
        }
        return accounts.map(a => {
            const isSel = selectedId && a.id == selectedId ? 'selected' : '';
            const bankExtra = a.bank_name ? ` - ${a.bank_name}` : '';
            return `<option value="${a.id}" ${isSel}>${a.name}${bankExtra}</option>`;
        }).join('');
    };

    // Cash Selects
    const cashSelect = $('pm-cash-account');
    if (cashSelect) cashSelect.innerHTML = renderOptions(cashAccounts, currentOrder?.account_id, 'Caja Principal');

    // Transfer Selects
    const transferSelect = $('pm-transfer-account');
    if (transferSelect) transferSelect.innerHTML = renderOptions(transferAccounts, currentOrder?.account_id, 'Cuenta Bancaria Principal');

    // Card Select
    const cardSelect = $('pm-card-account');
    if (cardSelect) cardSelect.innerHTML = renderOptions(cardAccounts, currentOrder?.account_id, 'Datáfono Principal');
}

function selectPaymentMethod(method) {
    selectedMethod = method;

    // Update Tab Buttons
    document.querySelectorAll('#pm-method-tabs .pm-method-btn').forEach(btn => {
        if (btn.dataset.method === method) {
            btn.classList.add('active', 'border-gray-900', 'bg-gray-900', 'text-white', 'shadow-xs');
            btn.classList.remove('border-gray-200', 'bg-white', 'text-gray-700');
            // Make icon white
            btn.querySelector('i')?.classList.add('text-white');
        } else {
            btn.classList.remove('active', 'border-gray-900', 'bg-gray-900', 'text-white', 'shadow-xs');
            btn.classList.add('border-gray-200', 'bg-white', 'text-gray-700');
            btn.querySelector('i')?.classList.remove('text-white');
        }
    });

    // Hide all sections then reveal chosen
    $('pm-section-efectivo')?.classList.add('hidden');
    $('pm-section-transferencia')?.classList.add('hidden');
    $('pm-section-datafono')?.classList.add('hidden');
    $('pm-section-mixto')?.classList.add('hidden');

    if (method === 'Efectivo') $('pm-section-efectivo')?.classList.remove('hidden');
    else if (method === 'Transferencia') $('pm-section-transferencia')?.classList.remove('hidden');
    else if (method === 'Datáfono') $('pm-section-datafono')?.classList.remove('hidden');
    else if (method === 'Mixto') $('pm-section-mixto')?.classList.remove('hidden');
}

function updateCashChange() {
    if (!currentOrder) return;
    const total = parseFloat(currentOrder.total) || 0;
    const received = parseFloat($('pm-cash-received')?.value) || 0;
    const changeEl = $('pm-cash-change');
    if (!changeEl) return;

    if (received <= 0) {
        changeEl.textContent = '$0';
        changeEl.className = 'text-sm font-black text-gray-400';
    } else if (received >= total) {
        changeEl.textContent = formatMoney(received - total);
        changeEl.className = 'text-sm font-black text-emerald-600';
    } else {
        changeEl.textContent = `Faltan ${formatMoney(total - received)}`;
        changeEl.className = 'text-sm font-black text-amber-600';
    }
}

function getAccountsForMethod(method) {
    if (!cachedAccounts || cachedAccounts.length === 0) return [];
    if (method === 'Efectivo') {
        const list = cachedAccounts.filter(a => a.type === 'Efectivo');
        return list.length > 0 ? list : cachedAccounts;
    } else if (method === 'Transferencia') {
        const list = cachedAccounts.filter(a => a.type === 'Transferencia');
        return list.length > 0 ? list : cachedAccounts;
    } else if (method === 'Datáfono') {
        const list = cachedAccounts.filter(a => a.type === 'Datáfono' || a.type === 'Transferencia');
        return list.length > 0 ? list : cachedAccounts;
    }
    return cachedAccounts;
}

function getDefaultAccountId(method) {
    const list = getAccountsForMethod(method);
    const def = list.find(a => a.is_default) || list[0];
    return def ? def.id : null;
}

function updateMixedProofVisibility() {
    const hasTransfer = mixedSplits.some(s => s.method === 'Transferencia');
    const proofSec = $('pm-mixed-proof-section');
    if (proofSec) {
        if (hasTransfer) proofSec.classList.remove('hidden');
        else proofSec.classList.add('hidden');
    }
}

function updateMixedBalanceStatus() {
    if (!currentOrder) return;
    const total = parseFloat(currentOrder.total) || 0;
    const assigned = mixedSplits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
    const remaining = total - assigned;

    const totalEl = $('pm-mixed-total-val');
    if (totalEl) totalEl.textContent = formatMoney(total);

    const assignedEl = $('pm-mixed-assigned-val');
    if (assignedEl) assignedEl.textContent = formatMoney(assigned);

    const remEl = $('pm-mixed-remaining-val');
    const statusBadge = $('pm-mixed-balance-status');

    if (Math.abs(remaining) < 1) {
        if (remEl) { remEl.textContent = '$0'; remEl.className = 'text-xs font-black text-emerald-600'; }
        if (statusBadge) {
            statusBadge.textContent = '✓ Cuadrado';
            statusBadge.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full';
        }
    } else if (remaining > 0) {
        if (remEl) { remEl.textContent = formatMoney(remaining); remEl.className = 'text-xs font-black text-amber-600'; }
        if (statusBadge) {
            statusBadge.textContent = `Falta ${formatMoney(remaining)}`;
            statusBadge.className = 'text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full';
        }
    } else {
        if (remEl) { remEl.textContent = `+${formatMoney(Math.abs(remaining))}`; remEl.className = 'text-xs font-black text-red-600'; }
        if (statusBadge) {
            statusBadge.textContent = `Sobra ${formatMoney(Math.abs(remaining))}`;
            statusBadge.className = 'text-[10px] font-bold text-red-700 bg-red-100 px-2.5 py-1 rounded-full';
        }
    }

    updateMixedProofVisibility();
}

function renderMixedRows() {
    const container = $('pm-mixed-rows-container');
    if (!container) return;
    container.innerHTML = '';

    mixedSplits.forEach((split, index) => {
        const row = document.createElement('div');
        row.className = 'bg-white p-3 rounded-xl border border-amber-200/70 shadow-2xs space-y-2';

        const accounts = getAccountsForMethod(split.method);
        const accOptions = accounts.map(a => {
            const isSel = split.account_id && a.id == split.account_id ? 'selected' : '';
            const bankExtra = a.bank_name ? ` (${a.bank_name})` : '';
            return `<option value="${a.id}" ${isSel}>${a.name}${bankExtra}</option>`;
        }).join('');

        const canDelete = mixedSplits.length > 1;

        row.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-36 shrink-0">
                    <label class="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Método</label>
                    <select class="pm-split-method w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none focus:bg-white" data-index="${index}">
                        <option value="Efectivo" ${split.method === 'Efectivo' ? 'selected' : ''}>💵 Efectivo</option>
                        <option value="Transferencia" ${split.method === 'Transferencia' ? 'selected' : ''}>📱 Transferencia</option>
                        <option value="Datáfono" ${split.method === 'Datáfono' ? 'selected' : ''}>💳 Datáfono</option>
                    </select>
                </div>
                <div class="flex-1">
                    <label class="text-[9px] font-bold text-gray-400 uppercase block mb-0.5">Valor a Pagar ($)</label>
                    <input type="number" min="0" step="any" class="pm-split-amount w-full p-2 text-right font-black text-xs text-gray-900 border border-gray-200 rounded-lg outline-none focus:border-amber-500 focus:bg-white" placeholder="0" value="${split.amount > 0 ? split.amount : ''}" data-index="${index}">
                </div>
                ${canDelete ? `
                    <div class="pt-3.5">
                        <button type="button" class="btn-remove-pm-split p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer" data-index="${index}" title="Eliminar fila">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
            <div class="flex items-center gap-2 pt-1 border-t border-gray-100">
                <span class="text-[10px] font-bold text-gray-400 whitespace-nowrap"><i class="fas fa-sign-in-alt text-[9px] text-amber-500 mr-1"></i>Cuenta Destino:</span>
                <select class="pm-split-account flex-1 p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none focus:bg-white" data-index="${index}">
                    ${accOptions || '<option value="">Cuenta Predeterminada</option>'}
                </select>
            </div>
        `;

        container.appendChild(row);
    });

    // Wire events
    container.querySelectorAll('.pm-split-method').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            const newMethod = e.target.value;
            mixedSplits[idx].method = newMethod;
            mixedSplits[idx].account_id = getDefaultAccountId(newMethod);
            renderMixedRows();
            updateMixedBalanceStatus();
        });
    });

    container.querySelectorAll('.pm-split-amount').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            let val = parseFloat(e.target.value);
            if (isNaN(val) || val < 0) val = 0;
            mixedSplits[idx].amount = val;
            updateMixedBalanceStatus();
        });
    });

    container.querySelectorAll('.pm-split-account').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            mixedSplits[idx].account_id = e.target.value ? parseInt(e.target.value, 10) : null;
        });
    });

    container.querySelectorAll('.btn-remove-pm-split').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.index, 10);
            if (mixedSplits.length > 1) {
                mixedSplits.splice(idx, 1);
                renderMixedRows();
                updateMixedBalanceStatus();
            }
        });
    });

    updateMixedProofVisibility();
}

async function handleConfirmCobro() {
    if (!currentOrder) return;

    const orderId = currentOrder.id;
    const total = parseFloat(currentOrder.total) || 0;
    const notes = $('pm-payment-notes')?.value?.trim() || '';

    let payload = {
        payment: selectedMethod,
        notes: notes
    };

    let proofToUpload = null;

    if (selectedMethod === 'Efectivo') {
        const accId = $('pm-cash-account')?.value;
        payload.account_id = accId ? parseInt(accId, 10) : null;
        payload.cash_amount = total;
        payload.transfer_amount = 0;
    } else if (selectedMethod === 'Transferencia') {
        const accId = $('pm-transfer-account')?.value;
        payload.account_id = accId ? parseInt(accId, 10) : null;
        payload.transfer_account_id = payload.account_id;
        payload.cash_amount = 0;
        payload.transfer_amount = total;

        proofToUpload = transferProofFile;
        if (!proofToUpload && existingProofUrl) {
            payload.proof = existingProofUrl;
        }
    } else if (selectedMethod === 'Datáfono') {
        const accId = $('pm-card-account')?.value;
        payload.account_id = accId ? parseInt(accId, 10) : null;
        payload.cash_amount = 0;
        payload.transfer_amount = 0;
    } else if (selectedMethod === 'Mixto') {
        const assigned = mixedSplits.reduce((acc, s) => acc + (parseFloat(s.amount) || 0), 0);
        if (Math.abs(assigned - total) > 1) {
            return showModalAlert(
                "Descuadre en Pago Mixto",
                `El total asignado (${formatMoney(assigned)}) debe ser igual al total del pedido (${formatMoney(total)}). Saldo pendiente: ${formatMoney(total - assigned)}.`,
                "warning"
            );
        }

        const hasTransfer = mixedSplits.some(s => s.method === 'Transferencia');
        if (hasTransfer) {
            proofToUpload = mixedProofFile;
            if (!proofToUpload && existingProofUrl) {
                payload.proof = existingProofUrl;
            }
        }

        let cashSum = 0;
        let transSum = 0;
        let primaryCashAcc = null;
        let primaryTransAcc = null;

        mixedSplits.forEach(s => {
            const amt = parseFloat(s.amount) || 0;
            if (s.method === 'Efectivo') {
                cashSum += amt;
                if (!primaryCashAcc && s.account_id) primaryCashAcc = s.account_id;
            } else if (s.method === 'Transferencia') {
                transSum += amt;
                if (!primaryTransAcc && s.account_id) primaryTransAcc = s.account_id;
            }
        });

        payload.cash_amount = cashSum;
        payload.transfer_amount = transSum;
        payload.cash_account_id = primaryCashAcc;
        payload.transfer_account_id = primaryTransAcc;
        payload.payment_details = {
            method: 'Mixto',
            splits: mixedSplits.map(s => ({
                method: s.method,
                amount: parseFloat(s.amount) || 0,
                account_id: s.account_id ? parseInt(s.account_id, 10) : null
            }))
        };
    }

    setLoading('btn-confirm-pm', true, 'Cobrando...');

    try {
        // Handle Offline Mode
        const isOffline = currentOrder._offline || String(orderId).startsWith('OFF-') || !navigator.onLine;

        if (isOffline) {
            let offlineProof = existingProofUrl;
            if (proofToUpload) {
                offlineProof = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(proofToUpload);
                });
            }

            const updatedOrder = {
                ...currentOrder,
                status: 'Cobrado',
                payment: payload.payment,
                account_id: payload.account_id,
                cash_amount: payload.cash_amount,
                transfer_amount: payload.transfer_amount,
                cash_account_id: payload.cash_account_id,
                transfer_account_id: payload.transfer_account_id,
                payment_details: payload.payment_details ? JSON.stringify(payload.payment_details) : null,
                proof: offlineProof
            };

            await OfflineDB.saveOfflineOrder(updatedOrder);

            // Update in-memory state
            const targetList = currentOrder.type === 'Local' ? state.waiterOrders : state.orders;
            if (targetList) {
                const idx = targetList.findIndex(o => o.id == orderId);
                if (idx !== -1) targetList[idx] = updatedOrder;
            }

            toast(`Pedido #${orderId} cobrado localmente`, "success");
            window.dispatchEvent(new Event('offline_sync_complete'));
            closePaymentModal();
            if (typeof onPaymentCompleteCallback === 'function') onPaymentCompleteCallback(updatedOrder);
            return;
        }

        // Online Server Request
        let response;
        if (proofToUpload) {
            const formData = new FormData();
            formData.append('proof', proofToUpload);
            for (const key in payload) {
                if (payload[key] !== null && payload[key] !== undefined) {
                    if (typeof payload[key] === 'object') {
                        formData.append(key, JSON.stringify(payload[key]));
                    } else {
                        formData.append(key, payload[key]);
                    }
                }
            }
            response = await ApiClient.post(`/orders/${orderId}/cobrar`, formData);
        } else {
            response = await ApiClient.post(`/orders/${orderId}/cobrar`, payload);
        }

        toast(`Pedido #${orderId} cobrado exitosamente`, "success");
        closePaymentModal();

        // Update local state optimistic
        const targetList = currentOrder?.type === 'Local' ? state.waiterOrders : state.orders;
        if (targetList) {
            const idx = targetList.findIndex(o => o.id == orderId);
            if (idx !== -1) {
                targetList[idx].status = 'Cobrado';
                targetList[idx].payment = payload.payment;
                if (payload.proof) targetList[idx].proof = payload.proof;
            }
        }

        if (typeof onPaymentCompleteCallback === 'function') {
            onPaymentCompleteCallback(response?.order || currentOrder);
        }

    } catch (e) {
        console.error("Error al cobrar pedido:", e);
        toast(e.message || "Error al cobrar el pedido", "error");
    } finally {
        setLoading('btn-confirm-pm', false);
    }
}

// Global exposure
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.initPaymentModal = initPaymentModal;
