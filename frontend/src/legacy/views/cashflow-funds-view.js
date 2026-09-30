/**
 * DigiRest - Cashflow Funds & Accounts View Module
 * Handles financial accounts (cash drawer, bank transfers, dataphones),
 * inter-account fund transfers, balances, and accounts modal interactions.
 */

import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import {
    getAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    toggleAccountActive,
    transferBetweenAccounts
} from '../services/cashflow-service.js';
import { toast, showConfirmModal } from '../components/ui.js';

let _accountsData = [];

export function getAccountsData() {
    return _accountsData;
}

export async function refreshAccountsCache() {
    try {
        _accountsData = await getAccounts();
    } catch (e) {
        console.error('Error cargando cuentas:', e);
        _accountsData = [];
    }
    return _accountsData;
}

/**
 * Returns HTML string for Account & Transfer modals
 */
export function getFundsModalsHTML() {
    return `
        <!-- MODAL: Nueva Cuenta (Fondo) -->
        <div id="cf-modal-account" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-wallet text-[var(--system-primary)]"></i>
                        <span id="cf-modal-account-title">Nueva Cuenta / Fondo</span>
                    </h3>
                    <button type="button" id="cf-close-account-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-account" class="mt-4 space-y-3.5">
                    <input type="hidden" id="cf-acc-id">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Nombre de la Cuenta</label>
                        <input type="text" id="cf-acc-name" placeholder="Ej: Caja Principal, Bancolombia Ahorros" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Método / Tipo</label>
                        <select id="cf-acc-type" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="Efectivo">Efectivo (Caja Física)</option>
                            <option value="Transferencia">Transferencia (Banco / Billetera)</option>
                            <option value="Datáfono">Datáfono (Tarjetas)</option>
                            <option value="Otro">Otro</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Banco / Entidad (Opcional)</label>
                        <input type="text" id="cf-acc-bank" placeholder="Ej: Bancolombia, Nequi, Bold" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Número de Cuenta (Opcional)</label>
                        <input type="text" id="cf-acc-number" placeholder="Ej: 123-456789-00" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div id="cf-acc-initial-container">
                        <label class="block text-xs font-bold text-gray-700 mb-1">Saldo Inicial ($)</label>
                        <input type="number" id="cf-acc-initial" placeholder="0" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Descripción</label>
                        <input type="text" id="cf-acc-desc" placeholder="Detalle sobre el uso de este fondo" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-account-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Guardar Cuenta</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: Transferencia entre Cuentas -->
        <div id="cf-modal-transfer" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-exchange-alt text-[var(--system-primary)]"></i>
                        Transferir entre Cuentas
                    </h3>
                    <button type="button" id="cf-close-transfer-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-transfer" class="mt-4 space-y-3.5">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Cuenta de Origen (Sale)</label>
                        <select id="cf-transfer-from" required class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500 font-semibold"></select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Cuenta de Destino (Entra)</label>
                        <select id="cf-transfer-to" required class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500 font-semibold"></select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Monto a Transferir ($)</label>
                        <input type="number" id="cf-transfer-amount" min="1" step="any" required placeholder="0" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono font-bold outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Notas / Motivo</label>
                        <input type="text" id="cf-transfer-notes" placeholder="Ej: Consignación de caja a banco" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-transfer-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Ejecutar Transferencia</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

/**
 * Loads Sub-tab 2: Cuentas (Fondos)
 */
export async function loadAccountsTab() {
    const area = $('cf-content-area');
    if (!area) return;

    await refreshAccountsCache();

    let totalFunds = _accountsData.reduce((acc, a) => acc + (parseFloat(a.current_balance) || 0), 0);

    area.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div>
                <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                    <i class="fas fa-wallet text-[var(--system-primary)]"></i>
                    Cuentas y Fondos Financieros
                </h3>
                <p class="text-xs text-gray-400">Total en fondos activos: <span class="font-black text-gray-900 font-mono">${formatMoney(totalFunds)}</span></p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="cf-btn-open-transfer" class="bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5">
                    <i class="fas fa-exchange-alt text-[var(--system-primary)]"></i>
                    <span>Transferir Fondos</span>
                </button>
                <button type="button" id="cf-btn-new-account" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                    <i class="fas fa-plus"></i>
                    <span>Nueva Cuenta</span>
                </button>
            </div>
        </div>

        <!-- Tarjetas de Cuentas -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="cf-accounts-cards">
            ${_accountsData.map(acc => {
                let iconName = 'fa-money-bill-wave';
                let badgeColor = 'text-emerald-600 bg-emerald-50';
                if (acc.type === 'Transferencia') {
                    iconName = 'fa-building-columns';
                    badgeColor = 'text-blue-600 bg-blue-50';
                } else if (acc.type === 'Datáfono') {
                    iconName = 'fa-credit-card';
                    badgeColor = 'text-purple-600 bg-purple-50';
                }

                return `
                    <div class="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between hover:border-orange-200 transition-all">
                        <div class="flex items-start justify-between">
                            <div class="flex items-center gap-3">
                                <span class="w-10 h-10 rounded-xl flex items-center justify-center text-base ${badgeColor}">
                                    <i class="fas ${iconName}"></i>
                                </span>
                                <div>
                                    <h4 class="font-bold text-sm text-gray-900 leading-tight">${escapeHtml(acc.name)}</h4>
                                    <span class="text-[11px] text-gray-400">${escapeHtml(acc.bank_name || acc.type)} ${acc.account_number ? '• ' + escapeHtml(acc.account_number) : ''}</span>
                                </div>
                            </div>
                            <div class="table-action-container relative inline-block">
                                <button type="button" class="table-action-trigger w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors">
                                    <i class="fas fa-ellipsis-v"></i>
                                </button>
                                <div class="table-action-menu hidden">
                                    <button type="button" class="action-item" onclick="window._editFinanceAccount(${acc.id})">
                                        <i class="fas fa-pen text-blue-500"></i>
                                        <span>Editar Cuenta</span>
                                    </button>
                                    <button type="button" class="action-item text-amber-600 hover:bg-amber-50" onclick="window._toggleFinanceAccount(${acc.id})">
                                        <i class="fas fa-ban text-amber-500"></i>
                                        <span>${acc.is_active ? 'Desactivar Cuenta' : 'Activar Cuenta'}</span>
                                    </button>
                                    <button type="button" class="action-item text-red-600 hover:bg-red-50" onclick="window._deleteFinanceAccount(${acc.id})">
                                        <i class="fas fa-trash-alt text-red-500"></i>
                                        <span>Eliminar Cuenta</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="mt-4 pt-3 border-t border-gray-100 flex items-baseline justify-between">
                            <span class="text-xs text-gray-400 font-medium">Saldo Actual:</span>
                            <span class="text-xl font-black font-mono ${acc.current_balance >= 0 ? 'text-gray-900' : 'text-red-600'}">
                                ${formatMoney(acc.current_balance)}
                            </span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    $('cf-btn-new-account')?.addEventListener('click', () => openAccountModal());
    $('cf-btn-open-transfer')?.addEventListener('click', () => openTransferModal());
}

export function openAccountModal(account = null) {
    $('cf-form-account')?.reset();
    if ($('cf-acc-id')) $('cf-acc-id').value = account ? account.id : '';
    if ($('cf-acc-name')) $('cf-acc-name').value = account ? account.name : '';
    if ($('cf-acc-type')) $('cf-acc-type').value = account ? account.type : 'Efectivo';
    if ($('cf-acc-bank')) $('cf-acc-bank').value = account ? (account.bank_name || '') : '';
    if ($('cf-acc-number')) $('cf-acc-number').value = account ? (account.account_number || '') : '';
    if ($('cf-acc-desc')) $('cf-acc-desc').value = account ? (account.description || '') : '';

    const initialContainer = $('cf-acc-initial-container');
    if (initialContainer) initialContainer.style.display = account ? 'none' : 'block';

    if ($('cf-modal-account-title')) {
        $('cf-modal-account-title').textContent = account ? 'Editar Cuenta' : 'Nueva Cuenta / Fondo';
    }

    $('cf-modal-account')?.classList.remove('hidden');
    $('cf-acc-name')?.focus();
}

export function openTransferModal() {
    $('cf-form-transfer')?.reset();
    const fromSel = $('cf-transfer-from');
    const toSel = $('cf-transfer-to');

    if (fromSel && toSel) {
        const optionsHtml = _accountsData.map(a => `
            <option value="${a.id}">${escapeHtml(a.name)} (${formatMoney(a.current_balance)})</option>
        `).join('');

        fromSel.innerHTML = optionsHtml;
        toSel.innerHTML = optionsHtml;

        if (_accountsData.length > 1) {
            toSel.selectedIndex = 1;
        }
    }

    $('cf-modal-transfer')?.classList.remove('hidden');
}

export function updateMovementAccountsDropdown() {
    const sel = $('cf-input-account');
    if (!sel) return;
    const pm = $('cf-input-method')?.value || 'Efectivo';
    const filtered = _accountsData.filter(a => a.type === pm);

    sel.innerHTML = filtered.length === 0
        ? '<option value="">Sin cuentas asociadas a este método (se registrará global)</option>'
        : '<option value="">Selecciona cuenta vinculada...</option>' + filtered.map(a => `
            <option value="${a.id}">${escapeHtml(a.name)} (Saldo: ${formatMoney(a.current_balance)})</option>
        `).join('');
}

export function updateAbonoAccountsDropdown() {
    const sel = $('cf-abono-account');
    if (!sel) return;
    const pm = $('cf-abono-method')?.value || 'Efectivo';
    const filtered = _accountsData.filter(a => a.type === pm);

    sel.innerHTML = filtered.length === 0
        ? '<option value="">Sin cuentas específicas</option>'
        : '<option value="">Selecciona cuenta vinculada...</option>' + filtered.map(a => `
            <option value="${a.id}">${escapeHtml(a.name)} (Saldo: ${formatMoney(a.current_balance)})</option>
        `).join('');
}

export function setupAccountsEvents() {
    // Cerrar modales de cuentas y transferencias
    $('cf-close-account-modal')?.addEventListener('click', () => $('cf-modal-account')?.classList.add('hidden'));
    $('cf-cancel-account-btn')?.addEventListener('click', () => $('cf-modal-account')?.classList.add('hidden'));
    $('cf-close-transfer-modal')?.addEventListener('click', () => $('cf-modal-transfer')?.classList.add('hidden'));
    $('cf-cancel-transfer-btn')?.addEventListener('click', () => $('cf-modal-transfer')?.classList.add('hidden'));

    // Formulario de Cuenta
    $('cf-form-account')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('cf-acc-id')?.value;
        const name = $('cf-acc-name')?.value?.trim();
        const type = $('cf-acc-type')?.value;
        const bank_name = $('cf-acc-bank')?.value?.trim();
        const account_number = $('cf-acc-number')?.value?.trim();
        const initial_balance = parseFloat($('cf-acc-initial')?.value) || 0;
        const description = $('cf-acc-desc')?.value?.trim();

        if (!name) return toast('El nombre es obligatorio', 'warning');

        try {
            if (id) {
                await updateAccount(id, { name, type, bank_name, account_number, description });
                toast('Cuenta actualizada con éxito', 'success');
            } else {
                await createAccount({ name, type, bank_name, account_number, initial_balance, description });
                toast('Cuenta creada con éxito', 'success');
            }
            $('cf-modal-account')?.classList.add('hidden');
            await loadAccountsTab();
        } catch (err) {
            console.error('Error guardando cuenta:', err);
            toast('Error al guardar cuenta', 'error');
        }
    });

    // Formulario de Transferencia
    $('cf-form-transfer')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const from_account_id = $('cf-transfer-from')?.value;
        const to_account_id = $('cf-transfer-to')?.value;
        const amount = parseFloat($('cf-transfer-amount')?.value);
        const notes = $('cf-transfer-notes')?.value?.trim();

        if (!from_account_id || !to_account_id || isNaN(amount) || amount <= 0) {
            return toast('Completa los campos de transferencia', 'warning');
        }
        if (from_account_id === to_account_id) {
            return toast('Las cuentas de origen y destino deben ser distintas', 'warning');
        }

        try {
            await transferBetweenAccounts({ from_account_id, to_account_id, amount, notes });
            toast('Transferencia ejecutada con éxito', 'success');
            $('cf-modal-transfer')?.classList.add('hidden');
            await loadAccountsTab();
        } catch (err) {
            console.error('Error en transferencia:', err);
            toast('Error al ejecutar transferencia', 'error');
        }
    });
}

// Window globals for inline calls
window._editFinanceAccount = (id) => {
    const acc = _accountsData.find(a => a.id === id);
    if (acc) openAccountModal(acc);
};

window._toggleFinanceAccount = (id) => {
    const acc = _accountsData.find(a => a.id === id);
    const isActivating = acc && acc.is_active === 0;
    const actionTitle = isActivating ? 'Activar Cuenta' : 'Desactivar Cuenta';
    const actionDesc = isActivating
        ? '¿Deseas activar esta cuenta nuevamente para transacciones?'
        : '¿Deseas desactivar esta cuenta? No se eliminarán sus registros históricos.';

    showConfirmModal(
        actionTitle,
        actionDesc,
        async () => {
            try {
                const res = await toggleAccountActive(id);
                toast(res?.message || (isActivating ? 'Cuenta activada' : 'Cuenta desactivada'), 'info');
                await loadAccountsTab();
            } catch (err) {
                toast(err.message || 'Error al cambiar estado de la cuenta', 'error');
            }
        },
        null,
        isActivating ? 'Activar' : 'Desactivar'
    );
};

window._deleteFinanceAccount = (id) => {
    showConfirmModal(
        'Eliminar Cuenta Permanentemente',
        '¿Deseas eliminar permanentemente esta cuenta? Esta acción solo se permite si no tiene movimientos ni pagos vinculados.',
        async () => {
            try {
                const res = await deleteAccount(id);
                toast(res?.message || 'Cuenta eliminada con éxito', 'success');
                await loadAccountsTab();
            } catch (err) {
                toast(err.message || 'No se puede eliminar la cuenta porque tiene movimientos asociados', 'error');
            }
        },
        null,
        'Eliminar'
    );
};

window.openAccountModal = openAccountModal;
window.openTransferModal = openTransferModal;
window.loadAccountsTab = loadAccountsTab;
