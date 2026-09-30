import { formatMoney, getSafeDate, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';

export const printOrder = (order) => {
    const printWindow = window.open('', '', 'width=300,height=600');
    if (!printWindow) {
        alert("Por favor permite ventanas emergentes para imprimir.");
        return;
    }

    const dateObj = getSafeDate(order.timestamp || order.date);
    const formattedDate = dateObj.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    // Company Info
    const companyName = escapeHtml(state.restaurantData.name) || "MI RESTAURANTE";
    const companyAddress = escapeHtml(state.restaurantData.address) || "Dirección";
    const companyPhone = escapeHtml(state.restaurantData.phone) || "Teléfono";

    // Determine Order Type Logic
    const isDeliveryOrPickup = order.type === 'Domicilio' || order.type === 'Recoger';

    // Build Customer/Waiter Info Section
    let infoSection = '';
    if (isDeliveryOrPickup) {
        infoSection = `
            <div class="info-row">ID Pedido: ${order.id}</div>
            <div class="info-row">Cliente: ${escapeHtml(order.client || 'Cliente')}</div>
            <div class="info-row">Teléfono: ${escapeHtml(order.phone || 'N/A')}</div>
            <div class="info-row">Dirección: ${escapeHtml(order.address || 'N/A')}</div>
            ${order.delivery_zone ? `<div class="info-row">Sector / Zona: ${escapeHtml(order.delivery_zone)}</div>` : ''}
            <div class="info-row">Método de pago: ${escapeHtml(order.payment || 'Efectivo')}</div>
        `;
    } else {
        // Local or Waiter
        infoSection = `
            <div class="info-row">Mesero: ${escapeHtml(order.waiterName || 'Sin Asignar')}</div>
            <div class="info-row">Mesa: ${escapeHtml(order.table || 'N/A')} - ID: ${order.id}</div>
            <div class="info-row">Método de pago: ${escapeHtml(order.payment || 'Efectivo')}</div>
        `;
    }

    const itemsHtml = (order.items || []).map(item => {
        const toppingsText = item.toppings_text || (Array.isArray(item.toppings) ? item.toppings.map(t => t.name).join(', ') : '');
        const notesText = item.notes || item.note || '';

        return `
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                <span style="font-weight: bold;">${item.qty} x ${escapeHtml(item.name)}</span>
                <span>${formatMoney(item.price * item.qty)}</span>
            </div>
            ${toppingsText ? `<div style="font-size: 11px; padding-left: 12px; color: #333; margin-bottom: 2px;">* Adic: ${escapeHtml(toppingsText)}</div>` : ''}
            ${notesText ? `<div style="font-size: 11px; padding-left: 12px; font-style: italic; color: #555; margin-bottom: 2px;">* Nota: ${escapeHtml(notesText)}</div>` : ''}
        `;
    }).join('');

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket #${order.id}</title>
            <style>
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 100%;
                    max-width: 80mm;
                    margin: 0 auto;
                    padding: 5px;
                    font-size: 14px;
                    color: #000;
                    box-sizing: border-box;
                }
                .header {
                    text-align: center;
                    margin-bottom: 5px;
                }
                .company-name {
                    font-weight: bold;
                    font-size: 16px;
                    display: block;
                }
                .divider {
                    border-top: 1px dashed #000;
                    margin: 5px 0;
                }
                .info-section {
                    margin-bottom: 5px;
                }
                .info-row {
                    margin-bottom: 2px;
                }
                .items {
                    margin-bottom: 5px;
                }
                .total-section {
                    text-align: right;
                    font-weight: bold;
                    font-size: 16px;
                    margin-top: 5px;
                }
                .footer {
                    text-align: center;
                    margin-top: 10px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <span class="company-name">${companyName}</span>
                <div>${companyAddress}</div>
                <div>${companyPhone}</div>
                <div>${formattedDate}</div>
            </div>
            
            <div class="divider"></div>

            <div class="info-section">
                ${infoSection}
            </div>

            <div class="divider"></div>

            <div class="items">
                ${itemsHtml}
            </div>

            <div class="divider"></div>

            ${parseFloat(order.discount) > 0 ? `<div style="text-align: right; margin-top: 5px;">Descuento: -${formatMoney(order.discount)}</div>` : ''}
            ${parseFloat(order.tip) > 0 ? `<div style="text-align: right; margin-top: 5px;">Propina: +${formatMoney(order.tip)}</div>` : ''}
            ${parseFloat(order.delivery_fee) > 0 ? `<div style="text-align: right; margin-top: 5px;">Domicilio: +${formatMoney(order.delivery_fee)}</div>` : ''}

            <div class="total-section">
                TOTAL: ${formatMoney(order.total)}
            </div>

            ${(order.notes && order.notes.trim().length > 0) ? `
            <div class="divider"></div>
            <div style="margin: 6px 0; font-size: 13px;">
                <div style="font-weight: bold; text-transform: uppercase; margin-bottom: 2px;">OBSERVACIONES / NOTAS:</div>
                <div style="background-color: #f3f4f6; padding: 6px; border-radius: 4px; border: 1px dashed #999; word-break: break-word; white-space: pre-wrap;">${escapeHtml(order.notes.trim())}</div>
            </div>
            ` : ''}

            <div class="footer">
                <p class="text-sm mb-0 pb-0">¡Gracias por su compra!</p>
                <p class="text-sm mt-0 pt-0">DigiRest v2 - by Digidan.co</p>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(function() { window.close(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
};
