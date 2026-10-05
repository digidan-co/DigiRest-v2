import { formatMoney, getSafeDate, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';

export const printOrder = (order) => {
    const dateObj = getSafeDate(order.timestamp || order.date);
    const formattedDate = dateObj.toLocaleString('es-CO', { timeZone: 'America/Bogota' });

    // Company Info
    const companyName = escapeHtml(state.restaurantData?.name || state.config?.name) || "MI RESTAURANTE";
    const companyAddress = escapeHtml(state.restaurantData?.address || state.config?.address) || "";
    const companyPhone = escapeHtml(state.restaurantData?.phone || state.config?.phone) || "";

    // Determine Order Type Logic
    const isDeliveryOrPickup = order.type === 'Domicilio' || order.type === 'Recoger';

    // Build Customer/Waiter Info Section
    let infoSection = '';
    if (isDeliveryOrPickup) {
        infoSection = `
            <div class="info-row"><strong>ID Pedido:</strong> #${order.id}</div>
            <div class="info-row"><strong>Tipo:</strong> ${escapeHtml(order.type)}</div>
            <div class="info-row"><strong>Cliente:</strong> ${escapeHtml(order.client || 'Cliente')}</div>
            ${order.phone ? `<div class="info-row"><strong>Teléfono:</strong> ${escapeHtml(order.phone)}</div>` : ''}
            ${order.address ? `<div class="info-row"><strong>Dirección:</strong> ${escapeHtml(order.address)}</div>` : ''}
            ${order.delivery_zone ? `<div class="info-row"><strong>Zona:</strong> ${escapeHtml(order.delivery_zone)}</div>` : ''}
            <div class="info-row"><strong>Método de pago:</strong> ${escapeHtml(order.payment || 'Efectivo')}</div>
        `;
    } else {
        // Local or Waiter
        infoSection = `
            <div class="info-row"><strong>ID Pedido:</strong> #${order.id}</div>
            <div class="info-row"><strong>Tipo:</strong> Pedido Local / Mesa</div>
            <div class="info-row"><strong>Mesa:</strong> ${escapeHtml(order.table || 'N/A')}</div>
            <div class="info-row"><strong>Mesero:</strong> ${escapeHtml(order.waiterName || 'Staff')}</div>
            <div class="info-row"><strong>Método de pago:</strong> ${escapeHtml(order.payment || 'Efectivo')}</div>
        `;
    }

    const itemsHtml = (order.items || []).map(item => {
        const toppingsText = item.toppings_text || (Array.isArray(item.toppings) ? item.toppings.map(t => t.name || t).filter(Boolean).join(', ') : '');
        const notesText = item.notes || item.note || '';

        return `
            <div class="item-row">
                <span class="item-name">${item.qty}x ${escapeHtml(item.name)}</span>
                <span class="item-price">${formatMoney(item.price * item.qty)}</span>
            </div>
            ${toppingsText ? `<div class="item-extra">* Adic: ${escapeHtml(toppingsText)}</div>` : ''}
            ${notesText ? `<div class="item-extra">* Nota: ${escapeHtml(notesText)}</div>` : ''}
        `;
    }).join('');

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Ticket #${order.id}</title>
            <style>
                @page {
                    margin: 0;
                    size: auto;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    color: #000000 !important;
                }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    font-size: 12.5px;
                    line-height: 1.25;
                    font-weight: 600;
                    width: 100%;
                    max-width: 76mm;
                    margin: 0 auto;
                    padding: 3mm 4mm 0 4mm;
                    background: #ffffff;
                    color: #000000 !important;
                }
                .header {
                    text-align: center;
                    margin-bottom: 5px;
                }
                .company-name {
                    font-weight: 900;
                    font-size: 16px;
                    display: block;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 2px;
                }
                .header-sub {
                    font-size: 11.5px;
                    font-weight: 600;
                    line-height: 1.2;
                }
                .divider-dashed {
                    border: 0;
                    border-top: 1.5px dashed #000000;
                    margin: 6px 0;
                }
                .divider-solid {
                    border: 0;
                    border-top: 1.5px solid #000000;
                    margin: 6px 0;
                }
                .info-section {
                    margin-bottom: 4px;
                    font-size: 12px;
                    line-height: 1.3;
                }
                .info-row {
                    margin-bottom: 2px;
                }
                .info-row strong {
                    font-weight: 800;
                }
                .items {
                    margin-bottom: 4px;
                }
                .item-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 3px;
                    font-size: 12.5px;
                }
                .item-name {
                    font-weight: 800;
                    flex: 1;
                    padding-right: 4px;
                }
                .item-price {
                    font-weight: 800;
                    white-space: nowrap;
                }
                .item-extra {
                    font-size: 11px;
                    padding-left: 8px;
                    font-weight: 700;
                    margin-bottom: 2px;
                }
                .totals-section {
                    margin-top: 4px;
                    font-size: 12px;
                    font-weight: 700;
                }
                .total-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 2px;
                }
                .total-main {
                    font-size: 15.5px;
                    font-weight: 900;
                    border-top: 1.5px solid #000000;
                    padding-top: 4px;
                    margin-top: 4px;
                }
                .notes-box {
                    margin: 6px 0;
                    font-size: 12px;
                }
                .notes-title {
                    font-weight: 900;
                    text-transform: uppercase;
                    margin-bottom: 3px;
                }
                .notes-content {
                    border: 1.5px solid #000000;
                    padding: 6px;
                    border-radius: 3px;
                    font-weight: 700;
                    word-break: break-word;
                    white-space: pre-wrap;
                }
                .footer {
                    text-align: center;
                    margin-top: 8px;
                    font-size: 11px;
                    font-weight: 700;
                    line-height: 1.3;
                }
                .cut-spacer {
                    height: 30mm;
                    display: block;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <span class="company-name">${companyName}</span>
                ${companyAddress ? `<div class="header-sub">${companyAddress}</div>` : ''}
                ${companyPhone ? `<div class="header-sub">${companyPhone}</div>` : ''}
                <div class="header-sub">${formattedDate}</div>
            </div>
            
            <hr class="divider-dashed" />

            <div class="info-section">
                ${infoSection}
            </div>

            <hr class="divider-dashed" />

            <div class="items">
                ${itemsHtml}
            </div>

            <hr class="divider-dashed" />

            <div class="totals-section">
                ${parseFloat(order.discount) > 0 ? `<div class="total-row"><span>Descuento:</span><span>-${formatMoney(order.discount)}</span></div>` : ''}
                ${parseFloat(order.tip) > 0 ? `<div class="total-row"><span>Propina:</span><span>+${formatMoney(order.tip)}</span></div>` : ''}
                ${parseFloat(order.delivery_fee) > 0 ? `<div class="total-row"><span>Domicilio:</span><span>+${formatMoney(order.delivery_fee)}</span></div>` : ''}
                <div class="total-row total-main">
                    <span>TOTAL:</span>
                    <span>${formatMoney(order.total)}</span>
                </div>
            </div>

            ${(order.notes && order.notes.trim().length > 0) ? `
            <hr class="divider-dashed" />
            <div class="notes-box">
                <div class="notes-title">OBSERVACIONES / NOTAS:</div>
                <div class="notes-content">${escapeHtml(order.notes.trim())}</div>
            </div>
            ` : ''}

            <hr class="divider-solid" />

            <div class="footer">
                <p style="margin:0 0 3px 0; font-weight:800">¡Gracias por su compra!</p>
                <p style="margin:0; font-size:10px; font-weight:700">DigiRest v2 - by Digidan.co</p>
            </div>

            <!-- Espacio inferior para avance y corte en impresora térmica (feed margin) -->
            <div class="cut-spacer"></div>
        </body>
        </html>
    `;

    // Impresión directa vía iframe oculto con fallback a popup
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error('Error invocando impresión vía iframe:', e);
            const printWindow = window.open('', '', 'width=300,height=600');
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
                printWindow.focus();
                printWindow.print();
            }
        } finally {
            setTimeout(() => {
                iframe.remove();
            }, 3000);
        }
    }, 250);
};
