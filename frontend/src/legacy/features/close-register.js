import { $, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';
import { toast, showModalAlert, showConfirmModal } from '../components/ui.js';
import { ApiClient } from '../services/api-client.js';

export function setupCloseRegisterListeners() {
    const btnClose = $('btn-close-register');
    const modalPass = $('password-confirm-modal');
    const btnConfirmPass = $('btn-confirm-password-action');
    const inputPass = $('confirm-password-input');

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            // 1. Confirm intention
            modalPass.classList.remove('hidden');
            inputPass.value = '';
            inputPass.focus();
        });
    }

    if (btnConfirmPass) {
        btnConfirmPass.addEventListener('click', async () => {
            const code = inputPass.value;
            if (!code) return toast("Ingresa tu contraseña", "error");

            // 2. Verify Password
            try {
                btnConfirmPass.disabled = true;
                btnConfirmPass.innerText = "Verificando...";

                // We use the auth logic here. Since we are already logged in, we know state.user.name.
                // We verify against backend to be sure.
                const valid = await verifyPassword(state.user.name, code);

                if (valid) {
                    modalPass.classList.add('hidden');
                    // 3. Start Close Process
                    performCloseRegister();
                } else {
                    toast("Contraseña incorrecta", "error");
                }
            } catch (e) {
                console.error(e);
                toast("Error verificando contraseña", "error");
            } finally {
                btnConfirmPass.disabled = false;
                btnConfirmPass.innerText = "Confirmar";
            }
        });
    }

    // Modal Action Listeners
    $('btn-export-daily')?.addEventListener('click', () => {
        window.open('/api/reports/daily-export?t=' + Date.now(), '_blank');
    });

    $('btn-print-daily')?.addEventListener('click', () => {
        printReport();
    });

    $('btn-finalize-day')?.addEventListener('click', async () => {
        const btn = $('btn-finalize-day');
        try {
            btn.innerText = 'Cerrando...';
            btn.disabled = true;

            // Recalculate to get the exact data to save
            const summary = calculateDailyStats();

            const now = new Date();
            // Send fecha in ISO YYYY-MM-DD so server date() works reliably
            const fecha = now.toISOString().split('T')[0];
            const hora = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            // Platos calculation
            const cantPlatos = summary.items.reduce((acc, item) => acc + item.qty, 0);

            const data = {
                fecha: fecha,
                hora: hora,
                cantidad_pedidos: summary.totalOrders,
                cantidad_platos: cantPlatos,
                total_anulados: summary.canceledItemsQty || 0,
                total_propinas: summary.totalTips || 0,
                total_descuentos: summary.totalDiscounts || 0,
                ingreso_efectivo: summary.totalCash,
                ingreso_transferencia: summary.totalTransfer,
                total_general: summary.totalSales,
                usuario: state.user ? state.user.name : 'Admin'
            };

            await ApiClient.post('/cierre-caja', data);

            $('daily-summary-modal').classList.add('hidden');
            $('congrats-modal').classList.remove('hidden');
        } catch (e) {
            console.error('Error saving cierre de caja:', e);
            toast("Error al guardar el cierre en la base de datos", "error");
        } finally {
            btn.innerText = 'Finalizar y Cerrar Sesión';
            btn.disabled = false;
        }
    });

    $('btn-logout-congrats')?.addEventListener('click', () => {
        // Clear session and reload
        localStorage.removeItem('pos_user');
        state.user = null;
        window.location.reload();
    });
}

async function verifyPassword(user, code) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, code })
        });
        if (res.ok) {
            const body = await res.json();
            // If the server generated a new token (e.g. expired session was silently replaced),
            // update ApiClient.token so subsequent API calls don't fail with SESSION_REPLACED.
            if (body.token) {
                ApiClient.setToken(body.token);
                localStorage.setItem('pos_token', body.token);
            }
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function performCloseRegister() {
    // 0. Pre-check: verify no pending orders from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allTodayOrders = [...(state.orders || []), ...(state.waiterOrders || [])];
    const pendingOrders = allTodayOrders.filter(o => {
        const orderDate = new Date(o.timestamp || o.date || 0);
        const isToday = orderDate >= today;
        const isPending = o.status !== 'Cobrado' && o.status !== 'Anulado';
        return isToday && isPending;
    });

    if (pendingOrders.length > 0) {
        // Build a summary of pending statuses
        const statusCounts = {};
        pendingOrders.forEach(o => {
            statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
        });
        const statusSummary = Object.entries(statusCounts)
            .map(([s, c]) => `${c} en "${s}"`)
            .join(', ');

        showConfirmModal(
            '⚠️ Pedidos Sin Cobrar',
            `Hay ${pendingOrders.length} pedido(s) del día que aún no están cobrados: ${statusSummary}. El resumen de cierre solo incluirá los pedidos "Cobrado". ¿Deseas cerrar de todas formas?`,
            () => doCloseRegister(), // Proceed
            null,
            'Cerrar de Todas Formas'
        );
        return; // Wait for confirmation
    }

    doCloseRegister();
}

function doCloseRegister() {
    // 1. Close Restaurant (API Call)
    if (state.restaurantData && state.config.isOpen) {
        // Clone data to avoid direct mutation issues before save
        const newData = { ...state.restaurantData, isOpen: false };

        ApiClient.post('/config', {
            key: 'dataRestaurant',
            value: newData
        }).then(() => {
            toast("Restaurante Cerrado", "success");
            // Optimistically update UI
            const chk = $('conf-is-open');
            if (chk) chk.checked = false;
        }).catch(err => {
            console.error(err);
            toast("Error cerrando restaurante", "error");
        });
    }

    // 2. Calculate Stats
    const summary = calculateDailyStats();

    // 2.b Fetch gastos for today and include in summary
    (async () => {
        try {
            const dateIso = new Date().toISOString().split('T')[0];
            const gastosRes = await ApiClient.get(`/gastos-dia?date=${dateIso}`);
            const gastosRows = gastosRes && gastosRes.data ? gastosRes.data : [];
            const totalGastos = gastosRows.reduce((s, g) => s + (parseFloat(g.valor) || 0), 0);
            summary.totalGastos = totalGastos;
            summary.adjustedTotal = (summary.totalSales || 0) - totalGastos;
        } catch (e) {
            console.error('Error fetching gastos for summary:', e);
            summary.totalGastos = 0;
            summary.adjustedTotal = (summary.totalSales || 0);
        } finally {
            // 3. Render Modal with gastos info
            renderSummaryModal(summary);
        }
    })();
}

function calculateDailyStats() {
    // Filter for TODAY's orders that are COMPLETED (Cobrado for Local, Entregado/Cobrado for General)
    // Or just all orders from today that generated revenue?
    // Generally "Cierre de Caja" implies counting money. So "Cobrado" is key.
    // However, for General orders "Entregado" might trigger payment later if COD, but usually we count sales.
    // Let's use the same logic as the Dashboard Widget for consistency.

    // Logic from admin-view.js updateDashboardStats:
    // General: Entregado or Cobrado
    // Local: Cobrado

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isToday = (dateStr) => {
        const d = new Date(dateStr);
        return d >= today;
    };

    const validOrders = state.orders.filter(o => {
        if (!isToday(o.timestamp)) return false;
        if (o.type === 'Local') return o.status === 'Cobrado';
        return o.status === 'Entregado' || o.status === 'Cobrado';
    });

    // Also find canceled orders to count canceled plates
    const canceledOrders = state.orders.filter(o => {
        if (!isToday(o.timestamp)) return false;
        return o.status === 'Anulado';
    });

    let canceledItemsQty = 0;
    canceledOrders.forEach(order => {
        let items = [];
        try {
            items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        } catch (e) { items = []; }
        items.forEach(i => {
            canceledItemsQty += i.qty;
        });
    });

    // Aggregate Items
    const itemMap = new Map();
    let totalSales = 0;
    let totalCash = 0;
    let totalTransfer = 0;
    let totalTips = 0;
    let totalDiscounts = 0;

    const breakdown = {
        local: { count: 0, cash: 0, transfer: 0, total: 0 },
        general: { count: 0, cash: 0, transfer: 0, total: 0 }
    };

    validOrders.forEach(order => {
        totalSales += order.total;
        totalTips += parseFloat(order.tip) || 0;
        totalDiscounts += parseFloat(order.discount) || 0;

        // Payment Method Check (Case Insensitive just in case)
        const payment = (order.payment || 'Efectivo').toLowerCase();
        const isMixed = payment === 'mixto';
        const isTransfer = payment.includes('transferencia') || payment.includes('banco') || payment.includes('nequi') || payment.includes('daviplata');
        
        let cashAmt = 0;
        let transferAmt = 0;

        if (isMixed) {
            cashAmt = parseFloat(order.cash_amount) || 0;
            transferAmt = parseFloat(order.transfer_amount) || Math.max(0, order.total - cashAmt);
        } else if (isTransfer) {
            transferAmt = order.total;
        } else {
            cashAmt = order.total;
        }

        totalCash += cashAmt;
        totalTransfer += transferAmt;

        // Breakdown by type
        const typeGroup = order.type === 'Local' ? 'local' : 'general';
        breakdown[typeGroup].count += 1;
        breakdown[typeGroup].total += order.total;
        breakdown[typeGroup].cash += cashAmt;
        breakdown[typeGroup].transfer += transferAmt;

        // Parse items
        let items = [];
        try {
            items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        } catch (e) { items = []; }

        items.forEach(i => {
            if (itemMap.has(i.name)) {
                const existing = itemMap.get(i.name);
                existing.qty += i.qty;
                existing.total += (i.price * i.qty);
            } else {
                itemMap.set(i.name, {
                    name: i.name,
                    qty: i.qty,
                    total: i.price * i.qty
                });
            }
        });
    });

    // Convert map to array sorted by qty desc
    const itemsArray = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty);

    return {
        totalOrders: validOrders.length,
        totalSales: totalSales,
        totalCash: totalCash,
        totalTransfer: totalTransfer,
        totalTips: totalTips,
        totalDiscounts: totalDiscounts,
        breakdown: breakdown,
        items: itemsArray,
        canceledItemsQty: canceledItemsQty
    };
}

function renderSummaryModal(data) {
    const list = $('summary-items-body');
    const totalCount = $('summary-total-count');
    const totalSales = $('summary-total-sales');
    const dateLabel = $('summary-date');

    // New fields
    const totalCashEl = $('summary-total-cash');
    const totalTransferEl = $('summary-total-transfer');
    const totalTipEl = $('summary-total-tip');
    const totalDiscountEl = $('summary-total-discount');

    const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });

    dateLabel.innerText = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    totalCount.innerText = data.totalOrders;
    totalSales.innerText = formatter.format(data.totalSales);

    if (totalCashEl) totalCashEl.innerText = formatter.format(data.totalCash);
    if (totalTransferEl) totalTransferEl.innerText = formatter.format(data.totalTransfer);
    if (totalTipEl) totalTipEl.innerText = formatter.format(data.totalTips || 0);
    if (totalDiscountEl) totalDiscountEl.innerText = formatter.format(data.totalDiscounts || 0);

    // Gastos and Adjusted Total
    const totalGastosEl = $('summary-total-gastos');
    const adjustedEl = $('summary-adjusted-total');
    const totalGastosVal = parseFloat(data.totalGastos || 0);
    const adjustedVal = parseFloat(data.adjustedTotal !== undefined ? data.adjustedTotal : ((data.totalSales || 0) - totalGastosVal));
    if (totalGastosEl) totalGastosEl.innerText = formatter.format(totalGastosVal);
    if (adjustedEl) adjustedEl.innerText = formatter.format(adjustedVal);

    list.innerHTML = data.items.map(i => `
        <tr>
            <td class="py-2 text-gray-700">${escapeHtml(i.name)}</td>
            <td class="py-2 text-center text-gray-600 font-bold">${i.qty}</td>
            <td class="py-2 text-right text-gray-800 font-bold">${formatter.format(i.total)}</td>
        </tr>
    `).join('');

    $('daily-summary-modal').classList.remove('hidden');
}

async function printReport() {
    // Open window synchronously to avoid popup blockers
    const win = window.open('', '', 'width=350,height=650');
    if (!win) {
        toast("Ventana emergente bloqueada. Habilita los pop-ups para imprimir.", "error");
        return;
    }
    win.document.write('<body style="font-family: monospace; padding: 20px;">Cargando reporte...</body>');

    const data = calculateDailyStats();
    
    // Fetch Gastos
    let gastosRows = [];
    let totalGastos = 0;
    try {
        const dateIso = new Date().toISOString().split('T')[0];
        const gastosRes = await ApiClient.get(`/gastos-dia?date=${dateIso}`);
        gastosRows = gastosRes && gastosRes.data ? gastosRes.data : [];
        totalGastos = gastosRows.reduce((s, g) => s + (parseFloat(g.valor) || 0), 0);
    } catch (e) { console.error('Error fetching gastos for print:', e); }

    const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
    const adjustedTotal = data.totalSales - totalGastos;

    win.document.open();
    win.document.write(`
        <html>
        <head>
            <title>Cierre de Caja</title>
            <style>
                body { font-family: 'Courier New', monospace; font-size: 12px; margin: 0; padding: 10px; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .bold { font-weight: bold; }
                .line { border-bottom: 1px dashed #000; margin: 5px 0; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                td { padding: 2px 0; }
                .section-title { font-weight: bold; margin-top: 10px; text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <h3 style="margin:0">${state.config.name || 'RESTAURANTE'}</h3>
                <p>CIERRE DE CAJA</p>
                <p>${new Date().toLocaleString('es-CO')}</p>
            </div>
            
            <div class="section-title">PLATOS VENDIDOS</div>
            <div class="line"></div>
            <table>
                <tr>
                    <td class="bold">Plato</td>
                    <td class="text-center bold">C</td>
                    <td class="text-right bold">T</td>
                </tr>
                <div class="line"></div>
                ${data.items.map(i => `
                    <tr>
                        <td>${escapeHtml(i.name).substring(0, 16)}</td>
                        <td class="text-center">${i.qty}</td>
                        <td class="text-right">${formatter.format(i.total)}</td>
                    </tr>
                `).join('')}
            </table>

            <div class="section-title">RESUMEN VENTAS</div>
            <div class="line"></div>
            <div style="display:flex; justify-content:space-between">
                <span>TOTAL PEDIDOS:</span>
                <span class="bold">${data.totalOrders}</span>
            </div>
            <div style="display:flex; justify-content:space-between">
                <span>VENTA BRUTA:</span>
                <span class="bold">${formatter.format(data.totalSales)}</span>
            </div>

            <div class="line"></div>
            <div style="display:flex; justify-content:space-between">
                <span>EFECTIVO FINAL:</span>
                <span>${formatter.format(data.totalCash)}</span>
            </div>
            <div style="display:flex; justify-content:space-between">
                <span>TRANSFERENCIA:</span>
                <span>${formatter.format(data.totalTransfer)}</span>
            </div>
            
            <!-- Propinas y Descuentos -->
            ${data.totalTips > 0 ? `
            <div style="display:flex; justify-content:space-between; margin-top: 5px;">
                <span>PROPINAS (+):</span>
                <span>${formatter.format(data.totalTips)}</span>
            </div>` : ''}
            ${data.totalDiscounts > 0 ? `
            <div style="display:flex; justify-content:space-between">
                <span>DESCUENTOS (-):</span>
                <span>${formatter.format(data.totalDiscounts)}</span>
            </div>` : ''}

            <!-- Gastos Día -->
            <div class="section-title">GASTOS DEL DÍA</div>
            <div class="line"></div>
            ${gastosRows.length === 0 ? '<div style="font-size: 10px;">Ningún gasto registrado</div>' : ''}
            ${gastosRows.map(g => `
                <div style="display:flex; justify-content:space-between; font-size: 11px;">
                    <span style="width:70%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        - ${escapeHtml(g.destino)} 
                    </span>
                    <span>${formatter.format(g.valor)}</span>
                </div>
                ${g.descripcion ? `<div style="font-size: 9px; padding-left: 10px; color: #555;">${escapeHtml(g.descripcion).substring(0, 30)}</div>` : ''}
            `).join('')}
            <div class="line"></div>
            <div style="display:flex; justify-content:space-between; color: red;">
                <span class="bold">TOTAL GASTOS:</span>
                <span class="bold">${formatter.format(totalGastos)}</span>
            </div>

            <div class="line" style="margin-top: 15px;"></div>
            <div style="display:flex; justify-content:space-between; font-size: 14px;">
                <span class="bold">TOTAL AJUSTADO:</span>
                <span class="bold">${formatter.format(adjustedTotal)}</span>
            </div>
            <div class="line" style="margin-bottom: 15px;"></div>

            <!-- Desglose por tipo -->
            <div class="section-title">DESGLOSE POR TIPO</div>
            <div class="line"></div>
            
            <table style="font-size: 11px; margin-bottom: 5px;">
                <tr><td colspan="3" class="bold text-center">LOCAL / MESAS (${data.breakdown.local.count} ped)</td></tr>
                <tr>
                    <td>Efectivo:</td>
                    <td class="text-right">${formatter.format(data.breakdown.local.cash)}</td>
                </tr>
                <tr>
                    <td>Transf.:</td>
                    <td class="text-right">${formatter.format(data.breakdown.local.transfer)}</td>
                </tr>
                <tr>
                    <td class="bold">Subtotal:</td>
                    <td class="bold text-right">${formatter.format(data.breakdown.local.total)}</td>
                </tr>
            </table>

            <table style="font-size: 11px;">
                <tr><td colspan="3" class="bold text-center">DOMICILIOS/LLEVAR (${data.breakdown.general.count} ped)</td></tr>
                <tr>
                    <td>Efectivo:</td>
                    <td class="text-right">${formatter.format(data.breakdown.general.cash)}</td>
                </tr>
                <tr>
                    <td>Transf.:</td>
                    <td class="text-right">${formatter.format(data.breakdown.general.transfer)}</td>
                </tr>
                <tr>
                    <td class="bold">Subtotal:</td>
                    <td class="bold text-right">${formatter.format(data.breakdown.general.total)}</td>
                </tr>
            </table>

            <br><br>
            <div class="text-center" style="font-size: 10px;">--- FIN REPORTE ---</div>
            <script>
                // Short timeout to guarantee resources format properly
                setTimeout(() => {
                    window.print();
                    window.close();
                }, 500);
            </script>
        </body>
        </html>
    `);
    win.document.close();
}
