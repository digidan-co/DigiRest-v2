/**
 * DigiRest - Admin Reports & Storage Quota View Module
 * Handles printable report windows, Excel/CSV generation, SQLite quota stats,
 * and the maximized full-screen orders modal.
 */

import { state } from '../core/state.js';
import { ApiClient } from '../services/api-client.js';
import { $, formatMoney, getStatusBadge, getSafeDate, escapeHtml } from '../utils/helpers.js';
import { toast, showImageModal } from '../components/ui.js';
import { printOrder } from '../services/print-service.js';

/**
 * Opens a dedicated print & export report window with filters for General vs Local orders
 */
export function openReportWindow(customData = null) {
    let general, local;

    if (customData) {
        general = customData.filter(o => o.source === 'General').map(o => ({
            ...o,
            displayClient: o.client || 'Cliente',
            displayId: '#' + (o.id || ''),
            displayDate: getSafeDate(o.timestamp || o.date)
        }));

        local = customData.filter(o => o.source === 'Local').map(o => ({
            ...o,
            displayClient: `Mesa ${o.table} (${o.waiterName || 'Mesero'})`,
            displayId: '#' + (o.id || ''),
            displayDate: getSafeDate(o.timestamp || o.date)
        }));
    } else {
        general = (state.orders || []).map(o => ({
            ...o,
            source: 'General',
            displayClient: o.client || 'Cliente',
            displayId: '#' + (o.id || ''),
            displayDate: getSafeDate(o.timestamp || o.date)
        }));

        local = (state.waiterOrders || []).map(o => ({
            ...o,
            source: 'Local',
            displayClient: `Mesa ${o.table} (${o.waiterName})`,
            displayId: '#' + (o.id || ''),
            displayDate: getSafeDate(o.timestamp || o.date)
        }));
    }

    const allData = [...general, ...local].sort((a, b) => b.displayDate - a.displayDate);

    const win = window.open('', '_blank', 'width=1200,height=800');
    if (!win) {
        toast("Permite las ventanas emergentes para ver el reporte", "error");
        return;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <title>Reporte de Pedidos</title>
        <link rel="stylesheet" href="/css/tailwind.min.css">
        <link rel="stylesheet" href="/css/fontawesome/all.min.css">
        <style>
            @media print {
                .no-print { display: none !important; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ddd; page-break-inside: avoid; }
            }
        </style>
    </head>
    <body class="bg-gray-50 p-6">
        <div class="max-w-[1400px] mx-auto bg-white p-6 rounded-xl shadow-lg">
            <!-- Header -->
            <div class="flex justify-between items-center mb-6 no-print">
                <h1 class="text-2xl font-bold text-gray-800">Reporte de Pedidos</h1>

                <div class="flex gap-4 items-center">
                    <select id="filter-source" class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
                        <option value="all">Todos los Pedidos</option>
                        <option value="General">Solo Generales</option>
                        <option value="Local">Solo Locales</option>
                    </select>

                    <div class="flex gap-2">
                        <button aria-label="Imprimir" onclick="window.print()" class="bg-gray-900 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                            <i class="fas fa-print mr-2"></i>Imprimir / PDF
                        </button>
                        <button aria-label="Exportar a Excel" onclick="exportExcel()" class="bg-gray-900 hover:bg-[var(--system-primary)] hover:text-[#1e2122] text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                            <i class="fas fa-file-excel mr-2"></i>Excel
                        </button>
                        <button aria-label="Exportar a CSV" onclick="exportCSV()" class="bg-gray-900 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                            <i class="fas fa-file-csv mr-2"></i>CSV
                        </button>
                    </div>
                </div>
            </div>

            <div class="mb-4 no-print text-sm text-gray-500">
                Mostrando <span id="count-display" class="font-bold text-gray-800">0</span> registros
            </div>

            <!-- Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse" id="report-table">
                    <thead>
                        <tr class="bg-gray-100 text-gray-600 uppercase text-xs">
                            <th class="p-3 border">Fecha</th>
                            <th class="p-3 border">ID</th>
                            <th class="p-3 border">Origen</th>
                            <th class="p-3 border">Cliente / Mesa</th>
                            <th class="p-3 border">Estado</th>
                            <th class="p-3 border">Método Pago</th>
                            <th class="p-3 border text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody id="table-body" class="text-sm text-gray-700">
                    </tbody>
                </table>
            </div>
        </div>

        <script>
            const rawData = ${JSON.stringify(allData)};
            let currentData = [...rawData];

            const tbody = document.getElementById('table-body');
            const countDisplay = document.getElementById('count-display');
            const filter = document.getElementById('filter-source');

            function formatDate(str) {
                if(!str) return '-';
                return new Date(str).toLocaleString('es-CO');
            }

            function formatMoney(amount) {
                return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount);
            }

            function render() {
                tbody.innerHTML = currentData.map(o => \`
                    <tr class="border-b hover:bg-gray-50">
                        <td class="p-3 border">\${formatDate(o.displayDate)}</td>
                        <td class="p-3 border font-mono font-bold">\${o.displayId}</td>
                        <td class="p-3 border">
                            <span class="px-2 py-1 rounded-full text-xs font-bold \${o.source === 'General' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">
                                \${o.source}
                            </span>
                        </td>
                        <td class="p-3 border">\${o.displayClient}</td>
                        <td class="p-3 border">\${o.status}</td>
                        <td class="p-3 border">\${o.payment || o.paymentMethod || '-'}</td>
                        <td class="p-3 border text-right font-bold">\${formatMoney(o.total)}</td>
                    </tr>
                \`).join('');
                countDisplay.innerText = currentData.length;
            }

            filter.addEventListener('change', (e) => {
                const val = e.target.value;
                if(val === 'all') {
                    currentData = rawData;
                } else {
                    currentData = rawData.filter(x => x.source === val);
                }
                render();
            });

            function exportCSV() {
                let csv = 'Fecha,ID,Origen,Cliente/Mesa,Estado,Pago,Total\\n';
                currentData.forEach(row => {
                    csv += \`"\${formatDate(row.displayDate)}","\${row.displayId}","\${row.source}","\${row.displayClient}","\${row.status}","\${row.payment||''}","\${row.total}"\\n\`;
                });

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'reporte_pedidos.csv';
                link.click();
            }

            function exportExcel() {
                let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel">';
                html += '<head><meta charset="UTF-8"></head><body>';
                html += document.getElementById('report-table').outerHTML;
                html += '</body></html>';

                const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = 'reporte_pedidos.xls';
                link.click();
            }

            render();
        </script>
    </body>
    </html>
    `;

    win.document.write(html);
    win.document.close();
}

/**
 * Updates storage and database capacity indicators on Admin UI
 */
export async function updateQuotaWidget() {
    let stats = null;
    try {
        stats = await ApiClient.get('/admin/system/stats');
    } catch (e) {
        // Continue with fallbacks on transient network issues
    }

    const RECORDS_LIMIT = stats?.records?.limit || 15000;
    const totalRecords = stats?.records?.total ?? ((state.orders || []).length + (state.products || []).length + (state.categories || []).length);
    const dbSizeFormatted = stats?.database?.sizeFormatted ?? '0 KB';
    const dbSizeBytes = stats?.database?.sizeBytes ?? 0;
    const DATA_LIMIT_BYTES = (stats?.images?.limitMB ? stats.images.limitMB : 50) * 1024 * 1024;
    const imgCount = stats?.images?.count ?? 0;
    const imgSizeFormatted = stats?.images?.sizeFormatted ?? '0 KB';

    // Optimization button display
    const btnOpt = $('btn-open-optimization');
    if (btnOpt) {
        if (state.user?.role === 'cajero') {
            btnOpt.style.display = 'none';
        } else {
            btnOpt.style.display = '';
            if (totalRecords >= RECORDS_LIMIT * 0.9) {
                btnOpt.classList.add('animate-bounce', 'text-red-500', 'border-red-500');
                btnOpt.classList.remove('text-gray-400', 'border-gray-200');
            } else {
                btnOpt.classList.remove('animate-bounce', 'text-red-500', 'border-red-500');
                btnOpt.classList.add('text-gray-400', 'border-gray-200');
            }
        }
    }

    // Records bar
    const recordsPct = Math.min((totalRecords / RECORDS_LIMIT) * 100, 100);
    const readsBar = document.getElementById('cap-reads-bar');
    const readsText = document.getElementById('cap-reads-text');

    if (readsBar) {
        readsBar.style.width = `${recordsPct}%`;
        readsBar.className = `h-1.5 rounded-full transition-all duration-500 ${recordsPct > 90 ? 'bg-red-500' : recordsPct > 70 ? 'bg-yellow-500' : 'bg-emerald-500'}`;
    }
    if (readsText) readsText.innerText = `${totalRecords.toLocaleString()} / ${RECORDS_LIMIT.toLocaleString()}`;

    // Database size bar
    const dataPct = Math.min((dbSizeBytes / DATA_LIMIT_BYTES) * 100, 100);
    const storageBar = document.getElementById('cap-storage-bar');
    const storageText = document.getElementById('cap-storage-text');

    if (storageBar) {
        storageBar.style.width = `${dataPct}%`;
        storageBar.className = `h-1.5 rounded-full transition-all duration-500 ${dataPct > 90 ? 'bg-red-500' : dataPct > 70 ? 'bg-yellow-500' : 'bg-blue-500'}`;
    }
    if (storageText) {
        storageText.innerText = dbSizeFormatted;
    }

    // Health Status
    const healthEl = document.getElementById('cap-health-status');
    if (healthEl) {
        if (recordsPct > 90 || dataPct > 90) {
            healthEl.innerHTML = '<span class="text-red-500"><i class="fas fa-exclamation-triangle mr-1"></i>Purga recomendada</span>';
        } else if (recordsPct > 70 || dataPct > 70) {
            healthEl.innerHTML = '<span class="text-yellow-600"><i class="fas fa-info-circle mr-1"></i>Monitorear</span>';
        } else {
            healthEl.innerHTML = '<span class="text-emerald-600"><i class="fas fa-check-circle mr-1"></i>Estado: OK</span>';
        }
    }

    // Images count and weight
    const imgText = document.getElementById('cap-images-count');
    if (imgText) {
        imgText.innerHTML = `<i class="fas fa-images mr-1"></i>${imgCount} imgs (${imgSizeFormatted} / ${stats?.images?.limitMB || 50}MB)`;
    }
}

/**
 * Calculates byte size of a JavaScript object
 */
export function calculateApproxSize(obj) {
    if (!obj) return 0;
    try {
        const str = JSON.stringify(obj);
        return new TextEncoder().encode(str).length;
    } catch (e) {
        return 0;
    }
}

/**
 * Opens full-screen maximized orders view
 */
export function openMaximizedView(type) {
    const modal = $('maximized-modal');
    const title = $('max-modal-title');
    const tbody = $('max-modal-body');

    if (!modal || !tbody) return;

    modal.classList.remove('hidden');

    let sourceData = [];
    if (type === 'Local') {
        title.innerText = "Pedidos Locales (Recientes)";
        sourceData = [...(state.waiterOrders || [])];
    } else {
        title.innerText = "Pedidos Generales (Recientes)";
        sourceData = [...(state.orders || [])].filter(o => o.type !== 'Local');
    }

    const priorityScore = (status) => {
        const map = {
            'Pendiente': 1, 'Recibido': 2, 'En preparación': 3, 'Terminado': 4,
            'En Reparto': 5, 'En reparto': 5, 'Entregado': 6, 'Cobrado': 7, 'Anulado': 8
        };
        return map[status] || 99;
    };

    sourceData.sort((a, b) => {
        const scoreA = priorityScore(a.status);
        const scoreB = priorityScore(b.status);
        if (scoreA !== scoreB) return scoreA - scoreB;
        return getSafeDate(b.date).getTime() - getSafeDate(a.date).getTime();
    });

    const top10 = sourceData.slice(0, 10);

    if (top10.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="p-8 text-center text-gray-400 text-lg">No hay pedidos recientes.</td></tr>';
        return;
    }

    tbody.innerHTML = top10.map(o => {
        const isLocal = type === 'Local';
        const id = isLocal ? o.uid : o.id;
        const idDisplay = `#${o.id}`;
        const mainInfo = isLocal ? `Mesa ${o.table}` : (o.client || 'Cliente');
        const subInfo = isLocal ? (o.waiterName || 'Mesero') : (o.phone || '');
        const dateObj = getSafeDate(o.timestamp || o.date);
        const staff = isLocal ? (o.chefName ? `<i class="fas fa-fire-alt mr-1"></i>${o.chefName}` : '-') : (o.deliveryDriverName ? `<i class="fas fa-motorcycle mr-1"></i>${o.deliveryDriverName}` : '-');

        let menuItemsHtml = `
            <button type="button" onclick="showOrderDetails('${id}')" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                <i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalles</span>
            </button>
        `;

        if (isLocal) {
            if (o.receiptProof) {
                menuItemsHtml += `
                    <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-purple-600 hover:bg-purple-50 transition-colors max-proof-btn" data-src="${o.receiptProof}">
                        <i class="fas fa-image w-4 text-center"></i> <span>Comprobante</span>
                    </button>
                `;
            }
            menuItemsHtml += `
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors max-print-waiter-btn" data-uid="${id}">
                    <i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span>
                </button>
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors max-edit-waiter-btn" data-uid="${id}">
                    <i class="fas fa-edit w-4 text-center"></i> <span>Editar</span>
                </button>
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors max-del-waiter-btn" data-uid="${id}">
                    <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                </button>
            `;
        } else {
            menuItemsHtml += `
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors max-print-btn" data-id="${id}">
                    <i class="fas fa-file-invoice w-4 text-center"></i> <span>Imprimir Ticket</span>
                </button>
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors max-edit-btn" data-id="${id}">
                    <i class="fas fa-edit w-4 text-center"></i> <span>Editar</span>
                </button>
                <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors max-del-btn" data-id="${id}">
                    <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar Pedido</span>
                </button>
            `;
        }

        const buttonsHtml = `
            <div class="relative inline-block text-left table-action-container">
                <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                    <i class="fas fa-ellipsis-v text-xs"></i>
                </button>
                <div class="table-action-menu hidden absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                    ${menuItemsHtml}
                </div>
            </div>
        `;

        return `
            <tr class="hover:bg-blue-50/30 transition-colors border-b border-gray-100">
                <td class="p-4 text-center align-middle">
                    <div class="font-bold text-gray-800 text-lg">${idDisplay}</div>
                    <div class="text-xs text-gray-400">${dateObj.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })}</div>
                </td>
                <td class="p-4 align-middle">
                    <div class="font-bold text-gray-800">${escapeHtml(mainInfo)}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(subInfo)}</div>
                </td>
                <td class="p-4 align-middle">
                     <div class="text-xs text-gray-500">${escapeHtml(o.type || o.deliveryType || 'Local')}</div>
                     <div class="text-xs text-orange-600 font-medium">${staff}</div>
                </td>
                <td class="p-4 text-center align-middle font-bold text-lg text-gray-800">
                    ${formatMoney(o.total)}
                </td>
                <td class="p-4 text-center align-middle">
                    ${getStatusBadge(o.status)}
                </td>
                <td class="p-4 text-center align-middle">
                    <div class="flex gap-1 justify-center items-center">
                        ${o.unsolved_notes_count > 0 ? `
                        <button aria-label="Ver notas" onclick="window.openViewNotesModal('${o.id}')" class="relative group p-1 w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                            <div class="bell-pulse-ring"></div>
                            <i class="fas fa-bell animate-jump-spin relative z-10"></i>
                        </button>
                        ` : ''}
                        ${buttonsHtml}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    tbody.querySelectorAll('.max-proof-btn').forEach(btn => {
        btn.addEventListener('click', () => showImageModal(btn.dataset.src));
    });
    tbody.querySelectorAll('.max-print-waiter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = sourceData.find(o => o.uid === btn.dataset.uid);
            if (order) printOrder({ ...order, isWaiterOrder: true });
        });
    });
    tbody.querySelectorAll('.max-edit-waiter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.openOrderEditModal === 'function') {
                window.openOrderEditModal(btn.dataset.uid, true);
            }
        });
    });
    tbody.querySelectorAll('.max-del-waiter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.promptCancelOrder === 'function') {
                window.promptCancelOrder(btn.dataset.uid, modal);
            }
        });
    });

    tbody.querySelectorAll('.max-print-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const order = sourceData.find(o => o.id === btn.dataset.id);
            if (order) printOrder(order);
        });
    });
    tbody.querySelectorAll('.max-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.openOrderEditModal === 'function') {
                window.openOrderEditModal(btn.dataset.id, false);
            }
        });
    });
    tbody.querySelectorAll('.max-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (typeof window.promptCancelOrder === 'function') {
                window.promptCancelOrder(btn.dataset.id, modal);
            }
        });
    });
}

// Bind to window for HTML inline calls
window.openReportWindow = openReportWindow;
window.updateQuotaWidget = updateQuotaWidget;
window.openMaximizedView = openMaximizedView;
