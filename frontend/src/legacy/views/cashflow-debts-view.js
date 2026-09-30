/**
 * DigiRest - Cashflow Debts View Module
 * Handles Accounts Payable (CxP - Suppliers/Creditors),
 * Accounts Receivable (CxC - Clients/Debtors), and Abonos / Debt Amortization.
 */

import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import {
    getPayables,
    createPayable,
    payPayable,
    deletePayable,
    getReceivables,
    createReceivable,
    collectReceivable,
    deleteReceivable
} from '../services/cashflow-service.js';
import { toast, showConfirmModal } from '../components/ui.js';
import { updateAbonoAccountsDropdown } from './cashflow-funds-view.js';

let _payablesData = [];
let _receivablesData = [];

export function getPayablesData() {
    return _payablesData;
}

export function getReceivablesData() {
    return _receivablesData;
}

/**
 * Returns HTML string for CxP, CxC, and Abono modals
 */
export function getDebtsModalsHTML() {
    return `
        <!-- MODAL: Nueva Cuenta Por Pagar (CxP) -->
        <div id="cf-modal-payable" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-file-invoice text-red-500"></i>
                        <span>Nueva Cuenta Por Pagar (CxP)</span>
                    </h3>
                    <button type="button" id="cf-close-payable-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-payable" class="mt-4 space-y-3.5">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Proveedor / Acreedor</label>
                        <input type="text" id="cf-payable-supplier" placeholder="Nombre de la empresa o persona" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Concepto / Detalle de la Deuda</label>
                        <input type="text" id="cf-payable-concept" placeholder="Ej: Compra carne, Factura energía, etc." required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">N° Factura / Ref</label>
                            <input type="text" id="cf-payable-invoice" placeholder="FAC-1020" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">Monto Total ($)</label>
                            <input type="number" id="cf-payable-amount" min="1" step="any" placeholder="0" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono font-bold outline-none focus:border-orange-500">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Fecha Límite de Pago</label>
                        <input type="date" id="cf-payable-due" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Categoría</label>
                        <select id="cf-payable-cat" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="">Selecciona categoría...</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Notas / Observaciones</label>
                        <input type="text" id="cf-payable-notes" placeholder="Condiciones o notas de pago" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-payable-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Registrar CxP</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: Nueva Cuenta Por Cobrar (CxC) -->
        <div id="cf-modal-receivable" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-hand-holding-dollar text-emerald-500"></i>
                        <span>Nueva Cuenta Por Cobrar (CxC)</span>
                    </h3>
                    <button type="button" id="cf-close-receivable-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-receivable" class="mt-4 space-y-3.5">
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Cliente / Deudor</label>
                        <input type="text" id="cf-receivable-client" placeholder="Nombre del cliente o entidad" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Concepto / Detalle del Cobro</label>
                        <input type="text" id="cf-receivable-concept" placeholder="Ej: Evento especial, Pedido corporativo, etc." required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">N° Pedido / Ref</label>
                            <input type="text" id="cf-receivable-invoice" placeholder="REC-401" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-700 mb-1">Monto Total ($)</label>
                            <input type="number" id="cf-receivable-amount" min="1" step="any" placeholder="0" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs font-mono font-bold outline-none focus:border-orange-500">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Fecha Límite de Cobro</label>
                        <input type="date" id="cf-receivable-due" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Categoría</label>
                        <select id="cf-receivable-cat" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="">Selecciona categoría...</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Notas / Observaciones</label>
                        <input type="text" id="cf-receivable-notes" placeholder="Condiciones o acuerdos de cobro" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>
                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-receivable-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Registrar CxC</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- MODAL: Registrar Abono / Pago (CxP o CxC) -->
        <div id="cf-modal-abono" class="hidden fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div class="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 fade-in">
                <div class="flex items-center justify-between pb-3 border-b border-gray-100">
                    <h3 class="font-bold text-lg text-gray-900 flex items-center gap-2">
                        <i class="fas fa-coins text-[var(--system-primary)]"></i>
                        <span id="cf-modal-abono-title">Registrar Pago / Abono</span>
                    </h3>
                    <button type="button" id="cf-close-abono-modal" class="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <form id="cf-form-abono" class="mt-4 space-y-3.5">
                    <input type="hidden" id="cf-abono-type">
                    <input type="hidden" id="cf-abono-id">

                    <!-- Info Card -->
                    <div class="bg-gray-50 p-3.5 rounded-2xl border border-gray-200/80 text-xs space-y-1">
                        <div class="flex justify-between">
                            <span class="text-gray-500" id="cf-abono-entity-label">Entidad:</span>
                            <span class="font-bold text-gray-800" id="cf-abono-entity-val">...</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-500">Concepto:</span>
                            <span class="font-medium text-gray-700" id="cf-abono-concept-val">...</span>
                        </div>
                        <div class="flex justify-between pt-1 border-t border-gray-200">
                            <span class="font-bold text-gray-700">Saldo Pendiente:</span>
                            <span class="font-black text-sm text-red-600 font-mono" id="cf-abono-pending-val">$0</span>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Monto a Abonar / Cancelar ($)</label>
                        <input type="number" id="cf-abono-amount" min="1" step="any" placeholder="0" required class="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono font-bold outline-none focus:border-orange-500">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Método de Pago</label>
                        <select id="cf-abono-method" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500 font-semibold">
                            <option value="Efectivo">Efectivo</option>
                            <option value="Transferencia">Transferencia</option>
                            <option value="Datáfono">Datáfono</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Cuenta de Fondos</label>
                        <select id="cf-abono-account" class="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs outline-none focus:border-orange-500">
                            <option value="">Selecciona cuenta vinculada...</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-700 mb-1">Notas / Justificación</label>
                        <input type="text" id="cf-abono-notes" placeholder="Ej: Pago parcial por transferencia" class="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-orange-500">
                    </div>

                    <div class="pt-3 flex justify-end gap-2 border-t border-gray-100">
                        <button type="button" id="cf-cancel-abono-btn" class="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-xs font-bold">Cancelar</button>
                        <button type="submit" id="cf-submit-abono-btn" class="px-5 py-2 rounded-xl btn-system-primary text-xs font-bold shadow-md transition-all cursor-pointer">Confirmar Abono</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

/**
 * Loads Sub-tab 3: Cuentas Por Pagar (CxP)
 */
export async function loadPayablesTab(categoriesData = []) {
    const area = $('cf-content-area');
    if (!area) return;

    try {
        _payablesData = await getPayables();
    } catch (e) {
        _payablesData = [];
    }

    const totalPending = _payablesData
        .filter(p => p.status !== 'Pagado' && p.status !== 'Anulado')
        .reduce((sum, p) => sum + (parseFloat(p.balance_pending) || 0), 0);

    const expiredCount = _payablesData.filter(p => p.status === 'Vencido').length;
    const paidCount = _payablesData.filter(p => p.status === 'Pagado').length;

    area.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div>
                <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                    <i class="fas fa-file-invoice text-red-500"></i>
                    Cuentas Por Pagar (Proveedores / Acreedores)
                </h3>
                <p class="text-xs text-gray-400">Total deuda pendiente: <span class="font-black text-red-600 font-mono">${formatMoney(totalPending)}</span></p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="cf-btn-new-payable" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                    <i class="fas fa-plus"></i>
                    <span>Nueva Cuenta Por Pagar</span>
                </button>
            </div>
        </div>

        <!-- 3 KPIs Rápidos de CxP -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Pendiente</span>
                <div class="text-2xl font-black text-red-600 font-mono mt-1">${formatMoney(totalPending)}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Cuentas Vencidas</span>
                <div class="text-2xl font-black text-amber-600 font-mono mt-1">${expiredCount}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Totalmente Pagadas</span>
                <div class="text-2xl font-black text-emerald-600 font-mono mt-1">${paidCount}</div>
            </div>
        </div>

        <!-- Tabla de CxP -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                            <th class="p-3.5">Proveedor / Acreedor</th>
                            <th class="p-3.5">Concepto / Ref</th>
                            <th class="p-3.5 text-center">Vencimiento</th>
                            <th class="p-3.5 text-right font-mono">Monto Total</th>
                            <th class="p-3.5 text-right font-mono">Saldo Pendiente</th>
                            <th class="p-3.5 text-center">Estado</th>
                            <th class="p-3.5 text-center w-16">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        ${_payablesData.length === 0 ? '<tr><td colspan="7" class="text-center py-8 text-gray-400">No hay cuentas por pagar registradas.</td></tr>' : _payablesData.map(p => {
                            let statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Pendiente</span>';
                            if (p.status === 'Pagado') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Pagado</span>';
                            else if (p.status === 'Vencido') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Vencido</span>';

                            return `
                                <tr class="hover:bg-gray-50/70">
                                    <td class="p-3.5 font-bold text-gray-900">${escapeHtml(p.supplier_name)}</td>
                                    <td class="p-3.5">
                                        <div class="font-semibold text-gray-800">${escapeHtml(p.concept)}</div>
                                        <div class="text-[10px] text-gray-400">${p.invoice_number ? 'Factura: ' + escapeHtml(p.invoice_number) : ''}</div>
                                    </td>
                                    <td class="p-3.5 text-center font-mono text-[11px] text-gray-600">${p.due_date}</td>
                                    <td class="p-3.5 text-right font-mono text-gray-700">${formatMoney(p.original_amount)}</td>
                                    <td class="p-3.5 text-right font-mono font-bold text-red-600">${formatMoney(p.balance_pending)}</td>
                                    <td class="p-3.5 text-center">${statusBadge}</td>
                                    <td class="p-3.5 text-center">
                                        <div class="table-action-container relative inline-block">
                                            <button type="button" class="table-action-trigger w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center">
                                                <i class="fas fa-ellipsis-v"></i>
                                            </button>
                                            <div class="table-action-menu hidden">
                                                ${p.status !== 'Pagado' ? `
                                                    <button type="button" class="action-item text-emerald-600 hover:bg-emerald-50" onclick="window._openAbonoModal('PAYABLE', ${p.id}, '${escapeHtml(p.supplier_name)}', '${escapeHtml(p.concept)}', ${p.balance_pending})">
                                                        <i class="fas fa-coins text-emerald-500"></i>
                                                        <span>Registrar Pago / Abono</span>
                                                    </button>
                                                ` : ''}
                                                <button type="button" class="action-item text-red-600 hover:bg-red-50" onclick="window._deleteFinancePayable(${p.id})">
                                                    <i class="fas fa-trash-alt text-red-500"></i>
                                                    <span>Eliminar Registro</span>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    $('cf-btn-new-payable')?.addEventListener('click', () => openPayableModal(categoriesData));
}

/**
 * Loads Sub-tab 4: Cuentas Por Cobrar (CxC)
 */
export async function loadReceivablesTab(categoriesData = []) {
    const area = $('cf-content-area');
    if (!area) return;

    try {
        _receivablesData = await getReceivables();
    } catch (e) {
        _receivablesData = [];
    }

    const totalPending = _receivablesData
        .filter(r => r.status !== 'Cobrado' && r.status !== 'Anulado')
        .reduce((sum, r) => sum + (parseFloat(r.balance_pending) || 0), 0);

    const expiredCount = _receivablesData.filter(r => r.status === 'Vencido').length;
    const collectedCount = _receivablesData.filter(r => r.status === 'Cobrado').length;

    area.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
            <div>
                <h3 class="font-bold text-base text-gray-800 flex items-center gap-2">
                    <i class="fas fa-hand-holding-dollar text-emerald-500"></i>
                    Cuentas Por Cobrar (Clientes / Créditos)
                </h3>
                <p class="text-xs text-gray-400">Total pendiente por cobrar: <span class="font-black text-emerald-600 font-mono">${formatMoney(totalPending)}</span></p>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" id="cf-btn-new-receivable" class="btn-system-primary px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-xs">
                    <i class="fas fa-plus"></i>
                    <span>Nueva Cuenta Por Cobrar</span>
                </button>
            </div>
        </div>

        <!-- 3 KPIs Rápidos de CxC -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Total por Cobrar</span>
                <div class="text-2xl font-black text-emerald-600 font-mono mt-1">${formatMoney(totalPending)}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Cobros Vencidos</span>
                <div class="text-2xl font-black text-amber-600 font-mono mt-1">${expiredCount}</div>
            </div>
            <div class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Totalmente Cobradas</span>
                <div class="text-2xl font-black text-blue-600 font-mono mt-1">${collectedCount}</div>
            </div>
        </div>

        <!-- Tabla de CxC -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs whitespace-nowrap">
                    <thead class="bg-gray-50 text-gray-500 uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                            <th class="p-3.5">Cliente / Deudor</th>
                            <th class="p-3.5">Concepto / Ref</th>
                            <th class="p-3.5 text-center">Vencimiento</th>
                            <th class="p-3.5 text-right font-mono">Monto Total</th>
                            <th class="p-3.5 text-right font-mono">Saldo Pendiente</th>
                            <th class="p-3.5 text-center">Estado</th>
                            <th class="p-3.5 text-center w-16">Acciones</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-50">
                        ${_receivablesData.length === 0 ? '<tr><td colspan="7" class="text-center py-8 text-gray-400">No hay cuentas por cobrar registradas.</td></tr>' : _receivablesData.map(r => {
                            let statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Pendiente</span>';
                            if (r.status === 'Cobrado') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">Cobrado</span>';
                            else if (r.status === 'Vencido') statusBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Vencido</span>';

                            return `
                                <tr class="hover:bg-gray-50/70">
                                    <td class="p-3.5 font-bold text-gray-900">${escapeHtml(r.client_name)}</td>
                                    <td class="p-3.5">
                                        <div class="font-semibold text-gray-800">${escapeHtml(r.concept)}</div>
                                        <div class="text-[10px] text-gray-400">${r.invoice_number ? 'Ref: ' + escapeHtml(r.invoice_number) : ''}</div>
                                    </td>
                                    <td class="p-3.5 text-center font-mono text-[11px] text-gray-600">${r.due_date}</td>
                                    <td class="p-3.5 text-right font-mono text-gray-700">${formatMoney(r.original_amount)}</td>
                                    <td class="p-3.5 text-right font-mono font-bold text-emerald-600">${formatMoney(r.balance_pending)}</td>
                                    <td class="p-3.5 text-center">${statusBadge}</td>
                                    <td class="p-3.5 text-center">
                                        <div class="table-action-container relative inline-block">
                                            <button type="button" class="table-action-trigger w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center">
                                                <i class="fas fa-ellipsis-v"></i>
                                            </button>
                                            <div class="table-action-menu hidden">
                                                ${r.status !== 'Cobrado' ? `
                                                    <button type="button" class="action-item text-emerald-600 hover:bg-emerald-50" onclick="window._openAbonoModal('RECEIVABLE', ${r.id}, '${escapeHtml(r.client_name)}', '${escapeHtml(r.concept)}', ${r.balance_pending})">
                                                        <i class="fas fa-coins text-emerald-500"></i>
                                                        <span>Registrar Cobro / Abono</span>
                                                    </button>
                                                ` : ''}
                                                <button type="button" class="action-item text-red-600 hover:bg-red-50" onclick="window._deleteFinanceReceivable(${r.id})">
                                                    <i class="fas fa-trash-alt text-red-500"></i>
                                                    <span>Eliminar Registro</span>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    $('cf-btn-new-receivable')?.addEventListener('click', () => openReceivableModal(categoriesData));
}

export function openPayableModal(categoriesData = []) {
    $('cf-form-payable')?.reset();
    const catSel = $('cf-payable-cat');
    if (catSel) {
        const expensesCats = categoriesData.filter(c => c.type === 'EXPENSE');
        catSel.innerHTML = '<option value="">Selecciona categoría...</option>' + expensesCats.map(c => `
            <option value="${c.id}">${escapeHtml(c.name)}</option>
        `).join('');
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if ($('cf-payable-due')) $('cf-payable-due').value = today;

    $('cf-modal-payable')?.classList.remove('hidden');
    $('cf-payable-supplier')?.focus();
}

export function openReceivableModal(categoriesData = []) {
    $('cf-form-receivable')?.reset();
    const catSel = $('cf-receivable-cat');
    if (catSel) {
        const incomeCats = categoriesData.filter(c => c.type === 'INCOME');
        catSel.innerHTML = '<option value="">Selecciona categoría...</option>' + incomeCats.map(c => `
            <option value="${c.id}">${escapeHtml(c.name)}</option>
        `).join('');
    }
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if ($('cf-receivable-due')) $('cf-receivable-due').value = today;

    $('cf-modal-receivable')?.classList.remove('hidden');
    $('cf-receivable-client')?.focus();
}

export function openAbonoModal(type, id, entity, concept, pending) {
    $('cf-form-abono')?.reset();
    if ($('cf-abono-type')) $('cf-abono-type').value = type;
    if ($('cf-abono-id')) $('cf-abono-id').value = id;
    if ($('cf-abono-amount')) {
        $('cf-abono-amount').value = pending;
        $('cf-abono-amount').max = pending;
    }

    if ($('cf-modal-abono-title')) {
        $('cf-modal-abono-title').textContent = type === 'PAYABLE' ? 'Registrar Pago a Proveedor' : 'Registrar Cobro a Cliente';
    }
    if ($('cf-abono-entity-label')) {
        $('cf-abono-entity-label').textContent = type === 'PAYABLE' ? 'Proveedor / Acreedor:' : 'Cliente / Deudor:';
    }
    if ($('cf-abono-entity-val')) $('cf-abono-entity-val').textContent = entity;
    if ($('cf-abono-concept-val')) $('cf-abono-concept-val').textContent = concept;
    if ($('cf-abono-pending-val')) $('cf-abono-pending-val').textContent = formatMoney(pending);

    updateAbonoAccountsDropdown();
    $('cf-modal-abono')?.classList.remove('hidden');
}

export function setupDebtsEvents() {
    // Cerrar modales CxP, CxC, Abono
    $('cf-close-payable-modal')?.addEventListener('click', () => $('cf-modal-payable')?.classList.add('hidden'));
    $('cf-cancel-payable-btn')?.addEventListener('click', () => $('cf-modal-payable')?.classList.add('hidden'));

    $('cf-close-receivable-modal')?.addEventListener('click', () => $('cf-modal-receivable')?.classList.add('hidden'));
    $('cf-cancel-receivable-btn')?.addEventListener('click', () => $('cf-modal-receivable')?.classList.add('hidden'));

    $('cf-close-abono-modal')?.addEventListener('click', () => $('cf-modal-abono')?.classList.add('hidden'));
    $('cf-cancel-abono-btn')?.addEventListener('click', () => $('cf-modal-abono')?.classList.add('hidden'));

    // Formulario de CxP
    $('cf-form-payable')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const supplier_name = $('cf-payable-supplier')?.value?.trim();
        const concept = $('cf-payable-concept')?.value?.trim();
        const invoice_number = $('cf-payable-invoice')?.value?.trim();
        const original_amount = parseFloat($('cf-payable-amount')?.value);
        const due_date = $('cf-payable-due')?.value;
        const category_id = $('cf-payable-cat')?.value ? parseInt($('cf-payable-cat').value, 10) : null;
        const notes = $('cf-payable-notes')?.value?.trim();

        if (!supplier_name || !concept || isNaN(original_amount) || original_amount <= 0 || !due_date) {
            return toast('Completa los campos obligatorios', 'warning');
        }

        try {
            await createPayable({ supplier_name, concept, invoice_number, original_amount, due_date, category_id, notes });
            toast('Cuenta por pagar registrada', 'success');
            $('cf-modal-payable')?.classList.add('hidden');
            $('cf-form-payable')?.reset();
            await loadPayablesTab();
        } catch (err) {
            console.error('Error creando CxP:', err);
            toast('Error al registrar cuenta por pagar', 'error');
        }
    });

    // Formulario de CxC
    $('cf-form-receivable')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const client_name = $('cf-receivable-client')?.value?.trim();
        const concept = $('cf-receivable-concept')?.value?.trim();
        const invoice_number = $('cf-receivable-invoice')?.value?.trim();
        const original_amount = parseFloat($('cf-receivable-amount')?.value);
        const due_date = $('cf-receivable-due')?.value;
        const category_id = $('cf-receivable-cat')?.value ? parseInt($('cf-receivable-cat').value, 10) : null;
        const notes = $('cf-receivable-notes')?.value?.trim();

        if (!client_name || !concept || isNaN(original_amount) || original_amount <= 0 || !due_date) {
            return toast('Completa los campos obligatorios', 'warning');
        }

        try {
            await createReceivable({ client_name, concept, invoice_number, original_amount, due_date, category_id, notes });
            toast('Cuenta por cobrar registrada', 'success');
            $('cf-modal-receivable')?.classList.add('hidden');
            $('cf-form-receivable')?.reset();
            await loadReceivablesTab();
        } catch (err) {
            console.error('Error creando CxC:', err);
            toast('Error al registrar cuenta por cobrar', 'error');
        }
    });

    // Formulario de Abono / Pago
    $('cf-form-abono')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = $('cf-abono-type')?.value;
        const id = $('cf-abono-id')?.value;
        const amount = parseFloat($('cf-abono-amount')?.value);
        const payment_method = $('cf-abono-method')?.value || 'Efectivo';
        const account_id = $('cf-abono-account')?.value ? parseInt($('cf-abono-account').value, 10) : null;
        const notes = $('cf-abono-notes')?.value?.trim();

        if (isNaN(amount) || amount <= 0) return toast('Monto de abono inválido', 'warning');

        try {
            if (type === 'PAYABLE') {
                await payPayable(id, { amount, payment_method, account_id, notes });
                toast('Pago a proveedor registrado con éxito', 'success');
                $('cf-modal-abono')?.classList.add('hidden');
                await loadPayablesTab();
            } else {
                await collectReceivable(id, { amount, payment_method, account_id, notes });
                toast('Recaudo de cliente registrado con éxito', 'success');
                $('cf-modal-abono')?.classList.add('hidden');
                await loadReceivablesTab();
            }
        } catch (err) {
            console.error('Error al procesar abono:', err);
            toast('Error al procesar abono', 'error');
        }
    });
}

// Window globals for inline calls
window._openAbonoModal = (type, id, entity, concept, pending) => {
    openAbonoModal(type, id, entity, concept, pending);
};

window._deleteFinancePayable = (id) => {
    showConfirmModal(
        'Eliminar Cuenta Por Pagar',
        '¿Deseas eliminar este registro de cuenta por pagar?',
        async () => {
            try {
                await deletePayable(id);
                toast('Registro eliminado', 'info');
                await loadPayablesTab();
            } catch (err) {
                toast('Error al eliminar registro', 'error');
            }
        },
        null,
        'Eliminar'
    );
};

window._deleteFinanceReceivable = (id) => {
    showConfirmModal(
        'Eliminar Cuenta Por Cobrar',
        '¿Deseas eliminar este registro de cuenta por cobrar?',
        async () => {
            try {
                await deleteReceivable(id);
                toast('Registro eliminado', 'info');
                await loadReceivablesTab();
            } catch (err) {
                toast('Error al eliminar registro', 'error');
            }
        },
        null,
        'Eliminar'
    );
};

window.openPayableModal = openPayableModal;
window.openReceivableModal = openReceivableModal;
window.loadPayablesTab = loadPayablesTab;
window.loadReceivablesTab = loadReceivablesTab;
