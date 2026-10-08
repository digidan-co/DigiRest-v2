import { state } from '../core/state.js';
import { $, initSlideButtons, escapeHtml } from '../utils/helpers.js';
import { updateOrder, updateWaiterOrder, toggleOrderItem } from '../services/order-service.js';
import { toast, showModalAlert } from '../components/ui.js';
// Timestamp removed

// We need to expose updateChefStatus globally because of the slider callback
// OR we refactor the slider to not use string callbacks.
// For now, let's attach it to window in the main entry or here.
// But modules are strict. I'll export it and attach it in main.js.

// Local cache for validation
let currentChefOrders = [];
let currentChefWaiterOrders = [];

export function renderChefGrid(orders) {
    // Filter out 'Pendiente' orders for Chef in General Orders and sort by oldest first
    const visibleOrders = orders.filter(o => o.status !== 'Pendiente').sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    currentChefOrders = visibleOrders; // Cache filtered orders
    const grid = $('chef-grid');
    if (visibleOrders.length === 0) {
        $('chef-empty').classList.remove('hidden');
        grid.innerHTML = '';
        return;
    }
    $('chef-empty').classList.add('hidden');

    grid.innerHTML = visibleOrders.map(o => {
        // Calculate progress
        // Calculate progress based on total item quantities
        const totalItems = o.items.reduce((sum, i) => sum + (i.qty || 1), 0);
        const checkedItems = o.items.reduce((sum, i) => sum + (i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0)), 0);
        const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

        const itemsHtml = o.items.map((i, index) => {
            const checkedQty = i.checkedQty !== undefined ? i.checkedQty : (i.checked ? i.qty : 0);

            let checkboxesHtml = '';
            for (let j = 0; j < i.qty; j++) {
                const isChecked = j < checkedQty ? 'checked' : '';
                checkboxesHtml += `<input type="checkbox" class="w-6 h-6 rounded-full border-gray-300 text-orange-500 focus:ring-orange-200 cursor-pointer chef-check"
                    data-order-id="${o.id}" data-item-index="${index}" ${isChecked}>`;
            }

            const rawToppingsText = i.toppings_text || (Array.isArray(i.toppings) ? i.toppings.map(t => t.name || t).filter(Boolean).join(', ') : '');
            const toppingsText = rawToppingsText.replace(/\s*\(\s*\+?\s*\$?[0-9.,]+\s*\)/gi, '').trim();
            const itemNotes = i.notes || i.note || '';

            return `
            <div class="flex flex-col py-1.5 border-b border-gray-50 last:border-0 pl-1 pr-1">
                <div class="flex justify-between items-start w-full gap-2">
                    <label class="flex-1 cursor-pointer select-none mt-0.5">
                        <span class="text-sm font-bold ${checkedQty >= i.qty ? 'line-through text-gray-400' : 'text-gray-800'}">${i.qty}x ${escapeHtml(i.name)}${i.variant_name ? ` <span class="inline-flex items-center gap-1 text-[11px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200"><i class="fas fa-layer-group text-[9px]"></i>${escapeHtml(i.variant_name)}</span>` : ''}${checkedByText}</span>
                        ${toppingsText ? `
                            <div class="mt-1 flex flex-wrap gap-1">
                                <span class="inline-flex items-center text-[11px] font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80">
                                    <i class="fas fa-cookie-bite mr-1 text-[9px] text-amber-600"></i>${escapeHtml(toppingsText)}
                                </span>
                            </div>
                        ` : ''}
                        ${itemNotes ? `
                            <div class="mt-1 flex flex-wrap gap-1">
                                <span class="inline-flex items-center text-[11px] font-medium text-orange-800 bg-orange-50 px-2 py-0.5 rounded border border-orange-200/70 italic">
                                    <i class="fas fa-comment-alt mr-1 text-[9px] text-orange-500"></i>${escapeHtml(itemNotes)}
                                </span>
                            </div>
                        ` : ''}
                    </label>
                    <div class="flex gap-1 flex-wrap justify-end max-w-[50%] items-center chef-check-group pt-0.5">
                        ${checkboxesHtml}
                    </div>
                </div>
            </div>
        `}).join('');

        let btnClass = "bg-orange-500 hover:bg-orange-600";
        let thumbBorderClass = "border-orange-500";
        let btnText = "Cocinar";
        let btnIcon = "fa-fire";
        let nextStatus = "En preparación";

        if (o.status === 'En preparación') {
            btnClass = "bg-blue-600 hover:bg-blue-700";
            thumbBorderClass = "border-blue-600";
            btnText = "Terminar";
            btnIcon = "fa-check";
            nextStatus = "Terminado";
        }

        return `
            <div class="bg-white rounded-xl shadow-sm p-0 overflow-hidden border border-gray-200 flex flex-col h-full relative">
                <div class="p-2 bg-gray-50 border-b border-gray-100 flex justify-between items-start animate-pulse-fade">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800 leading-tight">#${o.id}</h3>
                        <p class="text-xs text-gray-500 font-medium leading-tight mt-1">${escapeHtml(o.client)}</p>
                    </div>
                    <div class="text-right flex flex-col items-end">
                         <div class="flex items-center gap-1 mb-1">
                            ${o.unsolved_notes_count > 0 ? `
                            <button onclick="window.openViewNotesModal('${o.id}')" class="relative group p-1 rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                                <div class="bell-pulse-ring"></div>
                                <i class="fas fa-bell animate-jump-spin relative z-10"></i>
                            </button>
                            ` : ''}
                        <span class="inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${o.status === 'Recibido' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}">
                                ${o.status}
                            </span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1 leading-tight"><i class="far fa-clock"></i> ${o.displayDate ? (o.displayDate.split(',')[1] || o.displayDate) : new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }).split(',')[1]}</p>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="px-2 py-1">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-orange-400 to-orange-600 h-full transition-all duration-300" style="width: ${progressPercent}%"></div>
                        </div>
                        <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">${progressPercent}%</span>
                    </div>
                </div>

                <div class="p-2 flex-1 overflow-y-auto max-h-[250px]">
                    ${itemsHtml}
                    ${o.notes ? `<div class="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-gray-600 italic"><i class="fas fa-sticky-note mr-1 text-yellow-500"></i> ${escapeHtml(o.notes)}</div>` : ''}
                </div>

                <div class="p-2 bg-gray-50 border-t border-gray-100">
                    <div class="slider-container ${o.status === 'En preparación' ? 'bg-blue-600' : 'bg-orange-500'} h-8" 
                        id="slider-${o.id}" 
                        data-id="${o.id}" 
                        data-action="${nextStatus}" 
                        data-callback="updateChefStatus">
                        <div class="slider-text text-xs text-white font-bold uppercase tracking-wider">${btnText} <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                        <div class="slider-thumb w-8 h-8 ${o.status === 'En preparación' ? 'border-blue-600' : 'border-orange-500'}">
                            <i class="fas ${btnIcon} ${o.status === 'En preparación' ? 'text-blue-600' : 'text-orange-500'} text-xs"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.chef-check').forEach(chk => {
        chk.addEventListener('change', async (e) => {
            const orderId = e.target.dataset.orderId;
            const itemIndex = parseInt(e.target.dataset.itemIndex, 10);
            const order = currentChefOrders.find(o => o.id == orderId);

            if (order && order.status !== 'En preparación') {
                e.target.checked = !e.target.checked; // Revert
                toast("El pedido debe estar en 'En preparación' para poder marcar platos.", "error");
                return;
            }

            // Calculate new checkedQty by counting checked boxes in this group
            const group = e.target.closest('.chef-check-group');
            const allChecks = group.querySelectorAll('.chef-check');
            let newCheckedQty = 0;
            allChecks.forEach(c => { if (c.checked) newCheckedQty++; });

            try {
                await toggleOrderItem(orderId, itemIndex, undefined, newCheckedQty);
            } catch (err) {
                console.error("Failed to toggle item qty", err);
                e.target.checked = !e.target.checked; // Revert
                toast("Error al actualizar plato", "error");
            }
        });
    });

    initSlideButtons();
}

export function renderChefWaiterOrders(orders) {
    // Sort oldest first
    const sortedOrders = [...orders].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    currentChefWaiterOrders = sortedOrders; // Cache orders
    const container = $('chef-waiter-orders-container');
    const grid = $('chef-waiter-orders-grid');

    if (!container || !grid) return;

    if (orders.length === 0) {
        container.classList.remove('hidden');
        grid.innerHTML = '<div class="col-span-full flex flex-col w-full items-center justify-center py-20 opacity-50"><i class="fas fa-check-circle text-6xl text-gray-300 mb-4"></i><p class="text-gray-400 font-medium">Todo limpio, Chef.</p></div>';
        return;
    }

    container.classList.remove('hidden');

    grid.innerHTML = sortedOrders.map(o => {
        // Calculate progress based on total item quantities
        const totalItems = o.items.reduce((sum, i) => sum + (i.qty || 1), 0);
        const checkedItems = o.items.reduce((sum, i) => sum + (i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0)), 0);
        const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

        const itemsHtml = o.items.map((i, index) => {
            const checkedQty = i.checkedQty !== undefined ? i.checkedQty : (i.checked ? i.qty : 0);

            let checkboxesHtml = '';
            for (let j = 0; j < i.qty; j++) {
                const isChecked = j < checkedQty ? 'checked' : '';
                checkboxesHtml += `<input type="checkbox" class="w-6 h-6 rounded-full border-gray-300 text-orange-500 focus:ring-orange-200 cursor-pointer chef-check"
                    data-order-id="${o.id}" data-item-index="${index}" ${isChecked}>`;
            }

            const rawToppingsText = i.toppings_text || (Array.isArray(i.toppings) ? i.toppings.map(t => t.name || t).filter(Boolean).join(', ') : '');
            const toppingsText = rawToppingsText.replace(/\s*\(\s*\+?\s*\$?[0-9.,]+\s*\)/gi, '').trim();
            const itemNotes = i.notes || i.note || '';

            return `
            <div class="flex flex-col py-1.5 border-b border-gray-50 last:border-0 pl-1 pr-1">
                <div class="flex justify-between items-start w-full gap-2">
                    <label class="flex-1 cursor-pointer select-none mt-0.5">
                        <span class="text-sm font-bold ${checkedQty >= i.qty ? 'line-through text-gray-400' : 'text-gray-800'}">${i.qty}x ${escapeHtml(i.name)}${i.variant_name ? ` <span class="inline-flex items-center gap-1 text-[11px] font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200"><i class="fas fa-layer-group text-[9px]"></i>${escapeHtml(i.variant_name)}</span>` : ''}${checkedByText}</span>
                        ${toppingsText ? `
                            <div class="mt-1 flex flex-wrap gap-1">
                                <span class="inline-flex items-center text-[11px] font-semibold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80">
                                    <i class="fas fa-cookie-bite mr-1 text-[9px] text-amber-600"></i>${escapeHtml(toppingsText)}
                                </span>
                            </div>
                        ` : ''}
                        ${itemNotes ? `
                            <div class="mt-1 flex flex-wrap gap-1">
                                <span class="inline-flex items-center text-[11px] font-medium text-orange-800 bg-orange-50 px-2 py-0.5 rounded border border-orange-200/70 italic">
                                    <i class="fas fa-comment-alt mr-1 text-[9px] text-orange-500"></i>${escapeHtml(itemNotes)}
                                </span>
                            </div>
                        ` : ''}
                    </label>
                    <div class="flex gap-1 flex-wrap justify-end max-w-[50%] items-center chef-check-group pt-0.5">
                        ${checkboxesHtml}
                    </div>
                </div>
            </div>
        `}).join('');

        let btnClass = "bg-orange-500 hover:bg-orange-600";
        let thumbBorderClass = "border-orange-500";
        let btnText = "Cocinar";
        let btnIcon = "fa-fire";
        let nextStatus = "En preparación";

        if (o.status === 'En preparación') {
            btnClass = "bg-blue-600 hover:bg-blue-700";
            thumbBorderClass = "border-blue-600";
            btnText = "Terminar";
            btnIcon = "fa-check";
            nextStatus = "Terminado";
        }

        return `
            <div class="bg-white rounded-xl shadow-sm p-0 overflow-hidden border border-gray-200 flex flex-col h-full relative border-l-4 border-l-blue-500">
                <div class="p-2 bg-gray-50 border-b border-gray-100 flex justify-between items-start animate-pulse-fade">
                    <div>
                        <h3 class="font-bold text-lg text-gray-800 leading-tight">#${o.id}</h3>
                        <p class="text-sm text-gray-500 font-medium leading-tight mt-1">Mesa ${escapeHtml(o.table)} - ${escapeHtml(o.waiterName)}</p>
                    </div>
                    <div class="text-right flex flex-col items-end">
                        <div class="flex items-center gap-1 mb-1">
                            ${o.unsolved_notes_count > 0 ? `
                            <button onclick="window.openViewNotesModal('${o.id}')" class="relative group p-1 rounded-full transition-colors text-orange-500 hover:text-orange-600 bell-ring-container" title="Ver Notas">
                                <div class="bell-pulse-ring"></div>
                                <i class="fas fa-bell animate-jump-spin relative z-10"></i>
                            </button>
                            ` : ''}
                            <span class="inline-block px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${o.status === 'Recibido' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}">
                                ${o.status}
                            </span>
                        </div>
                        <p class="text-xs text-gray-500 mt-1 leading-tight"><i class="far fa-clock"></i> ${o.displayDate ? (o.displayDate.split(',')[1] || o.displayDate) : new Date(o.timestamp).toLocaleString('es-CO', { timeZone: 'America/Bogota' }).split(',')[1]}</p>
                    </div>
                </div>

                <!-- Progress Bar -->
                <div class="px-2 py-1">
                    <div class="flex items-center gap-2 mb-1">
                        <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div class="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-300" style="width: ${progressPercent}%"></div>
                        </div>
                        <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">${progressPercent}%</span>
                    </div>
                </div>

                <div class="p-2 flex-1 overflow-y-auto max-h-[250px]">
                    ${itemsHtml}
                    ${o.notes ? `<div class="mt-2 p-2 bg-yellow-50 border border-yellow-100 rounded text-xs text-gray-600 italic"><i class="fas fa-sticky-note mr-1 text-yellow-500"></i> ${escapeHtml(o.notes)}</div>` : ''}
                </div>

                <div class="p-2 bg-gray-50 border-t border-gray-100">
                    <div class="slider-container ${o.status === 'En preparación' ? 'bg-blue-600' : 'bg-orange-500'} h-8" 
                        id="slider-${o.id}" 
                        data-id="${o.id}" 
                        data-action="${nextStatus}" 
                        data-callback="updateWaiterOrderStatus">
                        <div class="slider-text text-xs text-white font-bold uppercase tracking-wider">${btnText} <i class="fas fa-chevron-right ml-1 opacity-50"></i></div>
                        <div class="slider-thumb w-8 h-8 ${o.status === 'En preparación' ? 'border-blue-600' : 'border-orange-500'}">
                            <i class="fas ${btnIcon} ${o.status === 'En preparación' ? 'text-blue-600' : 'text-orange-500'} text-xs"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');



    document.querySelectorAll('.chef-check').forEach(chk => {
        chk.addEventListener('change', async (e) => {
            const orderId = e.target.dataset.orderId;
            const itemIndex = parseInt(e.target.dataset.itemIndex, 10);
            const order = currentChefWaiterOrders.find(o => o.id == orderId);

            if (order && order.status !== 'En preparación') {
                e.target.checked = !e.target.checked; // Revert
                toast("El pedido debe estar en 'En preparación' para poder marcar platos.", "error");
                return;
            }

            // Calculate new checkedQty
            const group = e.target.closest('.chef-check-group');
            const allChecks = group.querySelectorAll('.chef-check');
            let newCheckedQty = 0;
            allChecks.forEach(c => { if (c.checked) newCheckedQty++; });

            try {
                await toggleOrderItem(orderId, itemIndex, undefined, newCheckedQty);
            } catch (err) {
                console.error("Failed to toggle item qty", err);
                e.target.checked = !e.target.checked;
                toast("Error al actualizar plato", "error");
            }
        });
    });

    initSlideButtons();
}

export async function handleUpdateChefStatus(id, status) {
    if (status === 'Terminado') {
        const order = currentChefOrders.find(o => o.id === id);
        if (order) {
            // Validate using server state
            const allChecked = order.items.every(i => (i.checkedQty !== undefined ? i.checkedQty >= (i.qty || 1) : !!i.checked));
            if (!allChecked) {
                toast("Todos los platos deben estar preparados para terminar el pedido.", "error");
                // Re-render to reset slider
                renderChefGrid(currentChefOrders);
                return;
            }
        }
    }

    const card = document.getElementById(`slider-${id}`)?.closest('.bg-white');
    if (card && (status === 'Terminado')) {
        card.classList.add('fade-out-slow');
        await new Promise(resolve => setTimeout(resolve, 800));
    }

    try {
        await updateOrder(id, {
            status: status,
            // statusTimestamp handled by backend
            ...((status === 'Terminado' || status === 'En preparación') ? { chefName: state.user.name || 'Chef' } : {})
        });
        if (status === 'Terminado') {
            toast("Pedido terminado y archivado");
            // No need to clear local storage items anymore
        } else {
            toast(`Estado actualizado: ${status}`);
        }
    } catch (e) {
        console.error(e);
        showModalAlert("Error", "Error actualizando pedido", "error");
        if (card) card.classList.remove('fade-out-slow');
    }
}

export async function handleUpdateWaiterOrderStatus(orderId, newStatus) {
    if (newStatus === 'Terminado') {
        const order = currentChefWaiterOrders.find(o => o.id === orderId);
        if (order) {
            // Validate using server state
            const allChecked = order.items.every(i => (i.checkedQty !== undefined ? i.checkedQty >= (i.qty || 1) : !!i.checked));
            if (!allChecked) {
                toast("Todos los platos deben estar preparados para terminar el pedido.", "error");
                // Re-render to reset slider
                renderChefWaiterOrders(currentChefWaiterOrders);
                return;
            }
        }
    }

    const card = document.getElementById(`slider-${orderId}`)?.closest('.bg-white');
    if (card && (newStatus === 'Terminado')) {
        card.classList.add('fade-out-slow');
        await new Promise(resolve => setTimeout(resolve, 800));
    }

    try {
        await updateWaiterOrder(orderId, {
            status: newStatus,
            ...((newStatus === 'Terminado' || newStatus === 'En preparación') ? { chefName: state.user.name || 'Chef' } : {})
        });
        toast(`Pedido actualizado a ${newStatus}`, "success");
        if (newStatus === 'Terminado') {
            // No need to clear local storage items anymore
        }
    } catch (e) {
        console.error(e);
        toast("Error actualizando pedido", "error");
        if (card) card.classList.remove('fade-out-slow');
    }
}
