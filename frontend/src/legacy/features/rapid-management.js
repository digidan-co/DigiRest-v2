import { $, formatMoney, getSafeDate, escapeHtml } from '../utils/helpers.js';
import { state } from '../core/state.js';
import { updateOrder } from '../services/order-service.js';
import { showImageModal } from '../components/ui.js';
import { printOrder } from '../services/print-service.js';

let isRendered = false;
let currentGRTab = 'Locales';

const STATUS_FLOWS = {
    'Local': {
        'Pendiente': { next: 'Recibido', label: 'RECIBIR', bgColor: 'bg-[#FFF8BC]' },
        'Recibido': { next: 'En preparación', label: 'A COCINA', bgColor: 'bg-[#FFF8BC]' },
        'En preparación': { next: 'Terminado', label: 'TERMINAR', bgColor: 'bg-sky-100' },
        'Terminado': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' },
        'Entregado': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' }
    },
    'Recoger': {
        'Pendiente': { next: 'Recibido', label: 'RECIBIR', bgColor: 'bg-[#FFF8BC]' },
        'Recibido': { next: 'En preparación', label: 'A COCINA', bgColor: 'bg-[#FFF8BC]' },
        'En preparación': { next: 'Terminado', label: 'TERMINAR', bgColor: 'bg-sky-100' },
        'Terminado': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' },
        'Entregado': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' }
    },
    'Domicilio': {
        'Pendiente': { next: 'Recibido', label: 'RECIBIR', bgColor: 'bg-[#FFF8BC]' },
        'Recibido': { next: 'En preparación', label: 'A COCINA', bgColor: 'bg-[#FFF8BC]' },
        'En preparación': { next: 'Terminado', label: 'TERMINAR', bgColor: 'bg-sky-100' },
        'Terminado': { next: 'En Reparto', label: 'A REPARTO', bgColor: 'bg-amber-100' },
        'En Reparto': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' },
        'En ruta': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' },
        'Entregado': { next: 'Cobrado', label: 'COBRAR', bgColor: 'bg-teal-100' }
    }
};

window.switchGRTab = switchGRTab;

window.renderRapidManagement = renderRapidManagement;

// Listen for global updates to refresh view automatically
window.addEventListener('orders-updated', () => {
    const container = $('rapid-management-view');
    if (container && !container.classList.contains('hidden')) {
        renderRapidManagement();
    }
});

// NOTE: ESC key intentionally disabled for GR mode.
// The user must use the back button in the top-left corner to close it.

window.openGRNotes = (id) => {
    if (window.openViewNotesModal) {
        window.openViewNotesModal(id);
    } else {
        window.dispatchEvent(new CustomEvent('request-open-notes', { detail: { orderId: id } }));
    }
};

window.printOrderFromGR = (orderId, isWaiter) => {
    const orders = [...(state.orders || []), ...(state.waiterOrders || [])];
    const order = orders.find(o => o.id == orderId);
    if (order) {
        printOrder(isWaiter ? { ...order, isWaiterOrder: true } : order);
    }
};

export function initRapidManagement() {
    // Init logic
}

export function openRapidManagement() {
    const container = $('rapid-management-view');
    if (container) {
        container.classList.remove('hidden');
        renderRapidManagement();
    }
}

export function closeRapidManagement() {
    const container = $('rapid-management-view');
    if (container) {
        container.classList.add('hidden');
    }
}

function switchGRTab(tabName) {
    currentGRTab = tabName;

    const btnLocales = $('btn-gr-tab-locales');
    const btnGenerales = $('btn-gr-tab-generales');

    if (tabName === 'Locales') {
        btnLocales.className = "gr-tab-btn active flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer";
        btnGenerales.className = "gr-tab-btn flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer";
    } else {
        btnGenerales.className = "gr-tab-btn active flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer";
        btnLocales.className = "gr-tab-btn flex-1 py-2 rounded-xl text-sm font-bold shadow-xs transition-all cursor-pointer";
    }

    // Toggle FAB visibility based on active tab
    const fabLocal = $('fab-gr-local');
    const fabGeneral = $('fab-gr-general');
    if (fabLocal && fabGeneral) {
        if (tabName === 'Locales') {
            fabLocal.classList.remove('hidden');
            fabGeneral.classList.add('hidden');
        } else {
            fabGeneral.classList.remove('hidden');
            fabLocal.classList.add('hidden');
        }
    }

    // Clear notification badges when user switches to a GR tab
    if (typeof window.clearOrderNotification === 'function') {
        window.clearOrderNotification(tabName === 'Locales' ? 'local' : 'general');
    }

    renderRapidManagement();
}

function renderRapidManagement() {
    const container = $('gr-orders-container');
    const headerDate = $('gr-header-date');
    const headerAdmin = $('gr-header-admin');

    if (headerDate) {
        const now = new Date();
        headerDate.textContent = now.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    if (headerAdmin) {
        headerAdmin.textContent = state.user?.name || 'Administrador';
    }

    if (!container) return;

    // Filter and Sort Orders
    const statusPriority = {
        'Pendiente': 1,
        'Recibido': 2,
        'En preparación': 3,
        'Terminado': 4,
        'En Reparto': 4.5,
        'Entregado': 5,
        'Cobrado': 6
    };

    // Business Day Logic: Shift time back by 2 hours.
    // 01:59 AM today will still show as yesterday's date.
    // 02:00 AM today becomes today's date.
    const getBusinessDateStr = (dateObj) => {
        const d = new Date(dateObj);
        d.setHours(d.getHours() - 2);
        return d.toLocaleDateString('es-CO');
    };

    const todayStr = getBusinessDateStr(new Date());

    const orders = [...(state.orders || []), ...(state.waiterOrders || [])].filter(o => {
        const isValidStatus = o.status !== 'Anulado' && o.status !== 'Eliminado' && o.status !== 'Cancelado';

        // Add fallback to o.date if o.timestamp is missing just in case
        const orderDateStr = getBusinessDateStr(getSafeDate(o.timestamp || o.date));
        const isToday = orderDateStr === todayStr;

        const isTabMatch = currentGRTab === 'Locales' ? o.type === 'Local' : o.type !== 'Local';

        return isValidStatus && isToday && isTabMatch;
    });

    // Remove duplicates since we merged orders and waiterOrders loosely
    const uniqueOrders = Array.from(new Map(orders.map(o => [o.id, o])).values());

    uniqueOrders.sort((a, b) => {
        const pA = statusPriority[a.status] || 99;
        const pB = statusPriority[b.status] || 99;
        if (pA !== pB) return pA - pB;
        return a.id - b.id;
    });

    container.innerHTML = uniqueOrders.map(order => createOrderCard(order)).join('');

    setTimeout(attachSliderListeners, 100);
}

function createOrderCard(order) {
    const isLocal = order.type === 'Local';

    // Client Info
    const clientName = (order.client || order.customerName || 'Cliente General').toUpperCase();
    let secondaryLabel, secondaryValue;

    if (isLocal) {
        secondaryLabel = 'Mesero:';
        secondaryValue = (order.waiterName || 'Staff').toUpperCase();
    } else {
        secondaryLabel = 'Dirección:';
        secondaryValue = order.deliveryAddress || order.address || 'Recoge en Local';
    }

    const sliderConfig = getSliderConfig(order);
    const hasProof = order.payment === 'Transferencia' && order.proof;
    const hasNotes = order.unsolved_notes_count > 0;

    const bellHtml = hasNotes ? `
        <button onclick="window.openGRNotes('${order.id}')" class="relative group p-1 w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container ml-2 mr-2" title="Ver Notas">
            <div class="bell-pulse-ring"></div>
            <i class="fas fa-bell animate-jump-spin relative z-10 text-lg"></i>
        </button>
    ` : `
        <div class="w-8 h-8 flex items-center justify-center text-gray-200 ml-2 mr-2">
            <i class="fas fa-bell text-lg"></i>
        </div>
    `;
    const timeString = new Date(order.timestamp).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
    const isWaiterOrder = isLocal ? 'true' : 'false';

    return `
    <div class="gr-card mx-auto bg-white rounded-[1.2rem] p-2.5 shadow-md relative shrink-0 snap-start border border-gray-100/50 flex mb-4 mr-4 transition-all duration-300" style="width: 320px; height:auto;" id="gr-card-${order.id}">
        
        <!-- Main Content (Left) -->
        <div class="flex-1 flex flex-col justify-between min-w-0 pr-2">
            <!-- Header -->
        <div class="flex items-center justify-between mb-1 bg-gray-50 rounded-[0.8rem] p-1.5 px-3">
            <div class="flex flex-col">
                <span class="text-[9px] text-gray-400 font-bold uppercase tracking-wider leading-none mb-0.5">ID PEDIDO</span>
                <span class="text-xl font-black text-gray-800 leading-none">#${order.id}</span>
            </div>
            
            <div class="flex items-center">
                ${bellHtml}
                
                ${order.phone ? `
                <button onclick="window.openWhatsApp('${order.id}')"
                    class="text-green-500 mr-[10px] hover:text-green-700 p-1 w-8 h-8 flex items-center justify-center rounded-full hover:bg-green-50 transition-colors"
                    title="Enviar WhatsApp">
                    <i class="fab fa-whatsapp text-[14px]"></i>
                </button>
                ` : ''}

               ${hasProof ? `
                <button onclick="window.showImageModal('${order.proof}')"
                    class="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-white hover:bg-gray-800 transition-all shadow-sm">
                    <i class="fas fa-image text-xs"></i>
                </button>
                ` : `
                <div class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-gray-300">
                    <i class="fas fa-image text-xs"></i>
                </div>
                `}
            </div>
        </div>
        
        <!-- Status (Right Aligned per user edit) -->
        <div class="mb-1 mt-1 flex items-center justify-between">
            <span class="text-xs text-gray-400 font-medium pl-1"><i class="far fa-clock"></i> ${timeString}</span>
            <div class="flex items-center justify-end">
                <span class="text-[9px] text-gray-400 font-bold uppercase tracking-wider mr-2">Estado:</span>
                <div class="inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-gray-100 text-gray-600 shadow-sm truncate max-w-[150px]">
                    ${order.status}
                </div>
            </div>
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-0 flex flex-col gap-0.5">
            <!-- Client -->
            <div>
                 <h3 class="text-sm font-black text-gray-900 leading-tight truncate">${clientName}</h3>
            </div>
            
            <!-- Address / Secondary -->
            <div class="flex gap-1 overflow-hidden min-h-[1em] items-start mb-1 px-1">
                <i class="fas fa-map-marker-alt text-[9px] text-gray-400 mt-0.5 shrink-0"></i>
                <p class="text-[9px] font-bold text-gray-600 leading-tight line-clamp-2">${secondaryValue}</p>
            </div>

            <!-- Tips, Discounts & Notes -->
            <div class="flex flex-wrap items-center gap-2 px-1 mb-1 shrink-0 w-full">
                ${parseFloat(order.tip) > 0 || parseFloat(order.discount) > 0 ? `
                <div class="flex items-center gap-2 text-[10px] bg-gray-50/80 px-2 py-1.5 rounded-lg border border-gray-100/80">
                    ${parseFloat(order.tip) > 0 ? `<span class="text-green-600 font-bold" title="Propina"><i class="fas fa-coins mr-1"></i>+${formatMoney(order.tip)}</span>` : ''}
                    ${parseFloat(order.discount) > 0 ? `<span class="text-red-500 font-bold" title="Descuento"><i class="fas fa-tag mr-1"></i>-${formatMoney(order.discount)}</span>` : ''}
                </div>
                ` : ''}
                ${(order.notes && order.notes.trim() !== '') ? `
                <div class="text-[10px] text-gray-500 bg-orange-50/50 px-2 py-1.5 rounded-lg border border-orange-100/50 flex-1 min-w-[100px] truncate italic w-full">
                    <i class="fas fa-sticky-note mr-1 text-orange-400"></i> <span title="${escapeHtml(order.notes)}">${escapeHtml(order.notes)}</span>
                </div>
                ` : ''}
            </div>

            <!-- Bottom Row: Extra Info + Total -->
            <div class="flex items-end justify-between gap-2 overflow-hidden shrink-0 px-1 mt-0.5">
                <!-- Extra Info (Left) -->
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-gray-500 font-medium leading-none flex-1">
                    <div class="flex items-center gap-1">
                         <i class="${isLocal ? 'fas fa-chair' : 'fas fa-motorcycle'} text-gray-400"></i>
                         <span>${order.type}</span>
                    </div>
                    <div class="flex items-center gap-1">
                         <i class="fas fa-money-bill-wave text-gray-400"></i>
                         <span>${order.payment}</span>
                    </div>
                    ${isLocal ? `
                    <div class="flex items-center gap-1 text-gray-600">
                        <i class="fas fa-table text-gray-400 gap-1"></i>
                        <span class="font-bold text-[10px]">Mesa ${order.table || '?'}</span>
                    </div>
                    ` : `
                    <div class="flex items-center gap-1 text-gray-600">
                        <i class="fas fa-user-astronaut text-gray-400"></i>
                        <span class="font-bold text-[10px] truncate max-w-[80px]" title="${order.deliveryDriverName || 'Sin Domiciliario'}">${order.deliveryDriverName || 'Sin Dom...'}</span>
                    </div>
                    `}
                </div>

                <!-- Total (Right) -->
                 <div class="text-right shrink-0">
                    <p class="text-lg font-black text-gray-900 leading-none tracking-tight">${formatMoney(order.total)}</p>
                </div>
            </div>
        </div>

            <!-- Footer: Slider -->
            <div class="mt-1 h-9 shrink-0">
                ${sliderConfig}
            </div>
        </div>

        <!-- Actions Column (Right) -->
        <div class="flex flex-col gap-2 justify-center items-center border-l border-gray-100 pl-2 shrink-0">
            <button onclick="window.showOrderDetails('${order.id}')" class="text-blue-500 hover:text-blue-700 p-2 rounded-full hover:bg-blue-50 transition-colors" title="Ver Detalles">
                <i class="fas fa-eye text-[14px]"></i>
            </button>
            <button onclick="window.printOrderFromGR('${order.id}', ${isWaiterOrder})" class="text-gray-600 hover:text-gray-900 p-2 rounded-full hover:bg-gray-50 transition-colors" title="Imprimir Ticket">
                <i class="fas fa-file-invoice text-[14px]"></i>
            </button>
            <button onclick="if(window.openOrderEditModal) window.openOrderEditModal('${order.id}', ${isWaiterOrder})" class="text-blue-500 hover:text-blue-700 p-2 rounded-full hover:bg-blue-50 transition-colors" title="Editar Pedido">
                <i class="fas fa-edit text-[14px]"></i>
            </button>
            <button onclick="window.promptCancelOrder('${order.id}')" class="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-50 transition-colors" title="Anular Pedido">
                <i class="fas fa-trash-alt text-[14px]"></i>
            </button>
        </div>
    </div>
        `;
}

function getSliderConfig(order) {
    const status = order.status;

    if (status === 'Cobrado') {
        return `
        <div class="w-full h-10 bg-gray-100 rounded-[0.8rem] flex items-center justify-center border border-gray-200">
            <span class="font-bold text-gray-400 uppercase tracking-widest text-[10px]">COBRADO</span>
        </div>`;
    }

    const flow = STATUS_FLOWS[order.type]?.[status];

    if (!flow) {
        // Fallback: unknown status or status outside the flow map → passive badge
        return `
        <div class="w-full h-10 bg-gray-50 rounded-[0.8rem] flex items-center justify-center border border-gray-200">
            <span class="font-bold text-gray-400 uppercase tracking-widest text-[10px]">${status.toUpperCase()}</span>
        </div>`;
    }

    const { next: nextStatus, label, bgColor } = flow;

    return `
        <div class="gr-slider-container relative w-full h-10 ${bgColor} rounded-[0.8rem] flex items-center overflow-hidden cursor-pointer select-none shadow-sm active:scale-[0.99] group"
    data-status="${status}" data-next-status="${nextStatus}" data-loading="false">
         
         <div class="gr-slider-track absolute left-0 top-0 bottom-0 bg-black/5 w-0"></div>

         <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <span class="font-black text-gray-800 uppercase tracking-wide text-[10px] gr-slider-label opacity-80">${label}</span>
         </div>
         
         <!-- Handle -->
         <div class="gr-slider-handle absolute left-1 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center z-10 border border-black/5">
            <i class="fas fa-arrow-right text-gray-900 text-[10px]"></i>
         </div>
         
         <div class="gr-slider-success absolute inset-0 bg-emerald-500 z-20 flex items-center justify-center opacity-0 pointer-events-none transition-opacity duration-300">
            <i class="fas fa-check text-white text-lg"></i>
         </div>
    </div>
        `;
}

function attachSliderListeners() {
    document.querySelectorAll('.gr-slider-container').forEach(slider => {
        // ... (Listener attachment logic is generic, reuse existing)
        const handle = slider.querySelector('.gr-slider-handle');
        const track = slider.querySelector('.gr-slider-track');
        const label = slider.querySelector('.gr-slider-label');
        const success = slider.querySelector('.gr-slider-success');

        let isDragging = false;
        let startX = 0;
        const maxDist = slider.offsetWidth - handle.offsetWidth - 8;

        const onDown = (e) => {
            if (slider.dataset.loading === 'true') return;
            isDragging = true;
            startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            handle.style.transition = 'none';
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const cx = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            let dist = cx - startX;
            dist = Math.max(0, Math.min(dist, maxDist));

            handle.style.transform = `translateX(${dist}px)`;
            track.style.width = `${dist + (handle.offsetWidth / 2)} px`;
            label.style.opacity = 1 - (dist / (maxDist * 0.8));
        };

        const onUp = (e) => {
            if (!isDragging) return;
            isDragging = false;

            const matrix = new WebKitCSSMatrix(window.getComputedStyle(handle).transform);
            const dist = matrix.m41;

            handle.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            track.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

            if (dist > maxDist * 0.85) {
                handle.style.transform = `translateX(${maxDist}px)`;
                success.style.opacity = '1';
                handleStatusChange(slider);
            } else {
                handle.style.transform = `translateX(0)`;
                track.style.width = '0';
                label.style.opacity = '0.8';
            }
        };

        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown);
        window.addEventListener('mousemove', (e) => isDragging && onMove(e));
        window.addEventListener('touchmove', (e) => isDragging && onMove(e));
        window.addEventListener('mouseup', (e) => isDragging && onUp(e));
        window.addEventListener('touchend', (e) => isDragging && onUp(e));
    });
}

window.openOrderCobro = async (orderOrId) => {
    let order = typeof orderOrId === 'object' && orderOrId !== null ? orderOrId : null;
    if (!order) {
        order = (state.orders || []).find(o => o.id == orderOrId) || (state.waiterOrders || []).find(o => o.id == orderOrId);
    }
    if (!order && typeof orderOrId !== 'object') {
        if (window.OfflineDB) {
            try {
                order = await window.OfflineDB.getOfflineOrder(orderOrId);
            } catch (_) {}
        }
    }
    if (!order && typeof orderOrId !== 'object' && navigator.onLine) {
        if (window.ApiClient) {
            try {
                const res = await window.ApiClient.get(`/orders/${orderOrId}`);
                order = res?.order || res;
            } catch (_) {}
        }
    }
    if (order && window.openPaymentModal) {
        window.openPaymentModal(order, () => {
            if (window.renderRapidManagement) window.renderRapidManagement();
            if (window.reloadAdminData) window.reloadAdminData();
        });
    }
};

function handleStatusChange(sliderElement) {
    const card = sliderElement.closest('.gr-card');
    const id = card.id.replace('gr-card-', '');

    // Use data-next-status from getSliderConfig logic
    const nextStatus = sliderElement.dataset.nextStatus;

    if (!nextStatus) {
        console.error("No next status defined");
        resetSlider(sliderElement);
        return;
    }

    if (nextStatus === 'Cobrado') {
        resetSlider(sliderElement);
        if (window.openOrderCobro) {
            window.openOrderCobro(id);
        }
        return;
    }

    sliderElement.dataset.loading = 'true';

    console.log(`GR: Updating #${id} to ${nextStatus}`);

    // Store old status for rollback (use loose equality — IDs may be strings like "PG1")
    const oldOrder = (state.orders || []).find(o => o.id == id);
    const oldWaiterOrder = (state.waiterOrders || []).find(o => o.id == id);
    const oldStatus = (oldOrder || oldWaiterOrder)?.status;

    // Optimistic state update so socket-triggered re-renders see the correct status
    const orderIndex = (state.orders || []).findIndex(o => o.id == id);
    if (orderIndex !== -1) {
        state.orders[orderIndex].status = nextStatus;
    }
    const waiterIndex = (state.waiterOrders || []).findIndex(o => o.id == id);
    if (waiterIndex !== -1) {
        state.waiterOrders[waiterIndex].status = nextStatus;
    }

    // Immediately replace card in DOM (no delay)
    const sourceOrder = orderIndex !== -1 ? state.orders[orderIndex] : (waiterIndex !== -1 ? state.waiterOrders[waiterIndex] : null);
    if (sourceOrder && card && card.parentNode) {
        const newCardHtml = createOrderCard(sourceOrder);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCardHtml;
        const newCardElement = tempDiv.firstElementChild;
        card.parentNode.replaceChild(newCardElement, card);
        const newSlider = newCardElement.querySelector('.gr-slider-container');
        if (newSlider) attachSingleSliderListener(newSlider);
    }

    updateOrder(id, { status: nextStatus })
        .catch(err => {
            console.error(err);
            // Rollback optimistic update
            if (orderIndex !== -1 && oldStatus) {
                state.orders[orderIndex].status = oldStatus;
            }
            if (waiterIndex !== -1 && oldStatus) {
                state.waiterOrders[waiterIndex].status = oldStatus;
            }
            // Re-render to show rolled-back state
            renderRapidManagement();
        });
}

function attachSingleSliderListener(slider) {
    const handle = slider.querySelector('.gr-slider-handle');
    const track = slider.querySelector('.gr-slider-track');
    const label = slider.querySelector('.gr-slider-label');
    const success = slider.querySelector('.gr-slider-success');

    let isDragging = false;
    let startX = 0;
    const maxDist = slider.offsetWidth - handle.offsetWidth - 8;

    const onDown = (e) => {
        if (slider.dataset.loading === 'true') return;
        isDragging = true;
        startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        handle.style.transition = 'none';
    };

    const onMove = (e) => {
        if (!isDragging) return;
        const cx = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        let dist = cx - startX;
        dist = Math.max(0, Math.min(dist, maxDist));

        handle.style.transform = `translateX(${dist}px)`;
        track.style.width = `${dist + (handle.offsetWidth / 2)} px`;
        label.style.opacity = 1 - (dist / (maxDist * 0.8));
    };

    const onUp = (e) => {
        if (!isDragging) return;
        isDragging = false;

        const matrix = new WebKitCSSMatrix(window.getComputedStyle(handle).transform);
        const dist = matrix.m41;

        handle.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        track.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

        if (dist > maxDist * 0.85) {
            handle.style.transform = `translateX(${maxDist}px)`;
            success.style.opacity = '1';
            handleStatusChange(slider);
        } else {
            handle.style.transform = `translateX(0)`;
            track.style.width = '0';
            label.style.opacity = '0.8';
        }
    };

    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown);
    window.addEventListener('mousemove', (e) => isDragging && onMove(e));
    window.addEventListener('touchmove', (e) => isDragging && onMove(e));
    window.addEventListener('mouseup', (e) => isDragging && onUp(e));
    window.addEventListener('touchend', (e) => isDragging && onUp(e));
}

function resetSlider(slider) {
    slider.dataset.loading = 'false';
    const handle = slider.querySelector('.gr-slider-handle');
    const track = slider.querySelector('.gr-slider-track');
    const label = slider.querySelector('.gr-slider-label');
    const success = slider.querySelector('.gr-slider-success');

    if (handle) handle.style.transform = `translateX(0)`;
    if (track) track.style.width = '0';
    if (label) label.style.opacity = '0.8';
    if (success) success.style.opacity = '0';
}
