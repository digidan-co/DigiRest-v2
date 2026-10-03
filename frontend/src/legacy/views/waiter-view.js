import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, setLoading, showConfirmModal, showModalAlert } from '../components/ui.js';
import { createWaiterOrder, updateWaiterOrder, addItemsToOrder } from '../services/order-service.js';
import { getProducts, getCategories } from '../services/product-service.js';
import { addOrderNotes, getOrderNotes, deleteOrderNote } from '../services/note-service.js';
import { compressProof } from '../utils/image-utils.js';
import { openClientToppingsModal } from './client-view.js';

let waiterCart = [];
let waiterCurrentCategory = 'all';

// Initialize events once
export function initWaiterEvents() {
    const btnViewCart = document.getElementById('btn-view-waiter-cart');
    if (btnViewCart) {
        // Remove existing listeners to avoid duplicates if init calls multiple times?
        // Better to use a clean implementation or check if listener attached.
        // For simplicity with onclick in HTML or just doing it here safely.
        // We'll trust this is called sparingly or use onclick property.

        // Actually, let's use onclick property to prevent stacking listeners
        btnViewCart.onclick = openWaiterCartReview;
    }

    const btnCloseReview = document.getElementById('btn-close-review');
    if (btnCloseReview) {
        btnCloseReview.onclick = () => {
            $('waiter-review-modal').classList.add('hidden');
        };
    }

    const btnFinalSend = document.getElementById('btn-final-send-order');
    if (btnFinalSend) {
        btnFinalSend.onclick = handleSendWaiterOrder;
    }

    const btnFinalSendReview = document.getElementById('btn-final-send-order-review');
    if (btnFinalSendReview) {
        btnFinalSendReview.onclick = handleSendWaiterOrder;
    }
}

export function renderWaiterCategories() {
    // Categories logic if needed
}

let _waiterSearchQuery = '';

export function setupWaiterSearchListener() {
    const input = document.getElementById('waiter-product-search');
    const clearBtn = document.getElementById('btn-clear-waiter-search');
    if (!input) return;
    if (input.dataset.listenerAttached === 'true') return;
    input.dataset.listenerAttached = 'true';

    input.addEventListener('input', (e) => {
        _waiterSearchQuery = (e.target.value || '').trim().toLowerCase();
        if (clearBtn) clearBtn.classList.toggle('hidden', !_waiterSearchQuery);
        renderWaiterProducts();
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            _waiterSearchQuery = '';
            clearBtn.classList.add('hidden');
            renderWaiterProducts();
            input.focus();
        });
    }
}

export function renderWaiterProducts() {
    const grid = $('w-products-grid');
    if (!grid) return;
    setupWaiterSearchListener();

    // Switch container to flex column for accordion stacking, removing grid layout
    grid.className = "flex flex-col gap-3 pb-32";
    grid.innerHTML = '';

    // Filter available products (strict 0 or false check)
    let availableProducts = state.products.filter(p => p.available !== 0 && p.available !== false);

    if (_waiterSearchQuery) {
        availableProducts = availableProducts.filter(p =>
            (p.name || '').toLowerCase().includes(_waiterSearchQuery) ||
            (p.category || '').toLowerCase().includes(_waiterSearchQuery) ||
            (p.desc || '').toLowerCase().includes(_waiterSearchQuery)
        );
    }

    if (availableProducts.length === 0) {
        grid.innerHTML = `<div class="text-center py-10 opacity-60 text-xs text-gray-500"><i class="fas fa-search mb-2 text-lg block"></i>${_waiterSearchQuery ? `No encontramos platos para "${escapeHtml(_waiterSearchQuery)}".` : 'Sin platos disponibles.'}</div>`;
        return;
    }

    let html = '';

    state.categories.forEach((cat, index) => {
        const catProducts = availableProducts.filter(p => p.category === cat.name);

        if (catProducts.length > 0) {
            const isOpen = _waiterSearchQuery ? 'open' : (index === 0 ? 'open' : '');
            html += `
                <details class="group w-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" name="waiter-accordion" ${isOpen}>
                    <summary class="flex justify-between items-center p-3 cursor-pointer list-none bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors select-none">
                        <div class="flex items-center gap-3">
                            <span class="w-1.5 h-6 bg-orange-500 rounded-full"></span>
                            <span class="font-bold text-gray-800 text-sm uppercase tracking-wider">
                                ${escapeHtml(cat.name)}
                            </span>
                            <span class="text-[10px] font-bold text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full">
                                ${catProducts.length}
                            </span>
                        </div>
                        <i class="fas fa-chevron-down text-gray-400 transition-transform duration-200 group-open:rotate-180"></i>
                    </summary>
                    
                    <div class="p-2 bg-white border-t border-gray-100">
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                             ${catProducts.map(p => `
                                <div class="waiter-prod-card bg-white border border-gray-100 p-1.5 rounded-lg shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-center items-center h-[74px] active:scale-95 transition-transform duration-75 relative overflow-hidden group/card" data-id="${p.id}">
                                    <div class="absolute inset-0 bg-orange-50 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none"></div>
                                    ${p.has_toppings ? `<span class="w-5 h-5 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] border border-amber-200 shadow-2xs z-20 pointer-events-none" style="position: absolute; top: 4px; right: 4px;" title="Personalizable"><i class="fas fa-cookie-bite"></i></span>` : ''}
                                    <h4 class="font-bold text-gray-700 text-[13px] leading-[15px] text-center mb-1 relative z-10 w-full line-clamp-2 px-1">${escapeHtml(p.name)}</h4>
                                    <span class="font-bold text-orange-600 text-[13px] relative z-10">${formatMoney((p.is_promo && p.promo_price) ? p.promo_price : p.price)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </details>
            `;
        }
    });

    grid.innerHTML = html;

    document.querySelectorAll('.waiter-prod-card').forEach(card => {
        card.addEventListener('click', () => addToWaiterCart(card.dataset.id));
    });
}

export function addToWaiterCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    // Reset search so all categories are displayed again
    const searchInput = $('waiter-product-search');
    if (searchInput && (searchInput.value || _waiterSearchQuery)) {
        searchInput.value = '';
        _waiterSearchQuery = '';
        const clearBtn = $('btn-clear-waiter-search');
        if (clearBtn) clearBtn.classList.add('hidden');
        renderWaiterProducts();
    }

    if (product.has_toppings) {
        openClientToppingsModal(product, {
            onConfirm: (customizedItem) => {
                waiterCart.push(customizedItem);
                updateFloatingCartButton();
                toast(`${product.name} con adiciones agregado`, 'success');
                if (!$('waiter-review-modal')?.classList.contains('hidden')) {
                    renderReviewCartList();
                }
            }
        });
        return;
    }

    const price = (product.is_promo && product.promo_price) ? product.promo_price : product.price;
    const existing = waiterCart.find(i => i.id === productId && !i.toppings_text && !i.notes);
    if (existing) {
        existing.qty++;
    } else {
        waiterCart.push({ ...product, price: price, qty: 1 });
    }

    updateFloatingCartButton();
    toast(`${product.name} agregado`, 'success');
}

function updateFloatingCartButton() {
    const badge = $('w-cart-count-badge');
    const totalEl = $('w-fab-total');

    // Calculate total qty and price
    const totalQty = waiterCart.reduce((acc, item) => acc + item.qty, 0);
    const totalPrice = waiterCart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    if (badge) {
        badge.innerText = totalQty;
        if (totalQty > 0) {
            badge.classList.remove('hidden');
            badge.classList.add('flex');
        } else {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
    }

    if (totalEl) {
        totalEl.innerText = formatMoney(totalPrice);
    }
}

export function openWaiterCartReview() {
    if (waiterCart.length === 0) {
        return toast("El carrito está vacío", "info");
    }

    renderReviewCartList();
    $('waiter-review-modal').classList.remove('hidden');
}

function formatToppingsListHtml(item) {
    if (Array.isArray(item.toppings) && item.toppings.length > 0) {
        return `
            <div class="mt-1.5 bg-amber-50/90 border border-amber-200/80 rounded-lg p-2 text-xs">
                <span class="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1 mb-1">
                    <i class="fas fa-cookie-bite text-amber-600"></i> Toppings / Adiciones:
                </span>
                <ul class="space-y-0.5 pl-3 list-disc text-amber-900 font-medium">
                    ${item.toppings.map(t => `
                        <li>
                            <span>${escapeHtml(t.name)}</span>
                            ${t.price > 0 ? `<span class="text-[10px] text-amber-700 font-bold ml-1">(+${formatMoney(t.price)})</span>` : ''}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    if (item.toppings_text) {
        const listItems = item.toppings_text.split(',').map(s => s.trim()).filter(Boolean);
        return `
            <div class="mt-1.5 bg-amber-50/90 border border-amber-200/80 rounded-lg p-2 text-xs">
                <span class="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1 mb-1">
                    <i class="fas fa-cookie-bite text-amber-600"></i> Toppings / Adiciones:
                </span>
                <ul class="space-y-0.5 pl-3 list-disc text-amber-900 font-medium">
                    ${listItems.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    return '';
}

function renderReviewCartList() {
    const list = $('w-review-list');
    const totalEl = $('w-cart-total'); // Corrected ID to match index.html

    if (!list) return;

    let total = 0;

    list.innerHTML = waiterCart.map((item, index) => {
        total += item.price * item.qty;
        return `
            <div class="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-gray-100 shadow-sm">
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-gray-800 text-xs leading-tight mb-0.5">${escapeHtml(item.name)}</h4>
                    ${formatToppingsListHtml(item)}
                    ${item.notes ? `<p class="text-[10px] text-gray-500 italic block mt-1"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>${escapeHtml(item.notes)}</p>` : ''}
                    <span class="text-[10px] text-gray-500 font-bold block mt-1">${formatMoney(item.price)} c/u</span>
                </div>
                
                <div class="flex items-center bg-gray-100 rounded-md p-0.5 shrink-0 self-center">
                    <button class="w-8 h-8 bg-white rounded shadow-sm text-gray-600 hover:text-red-500 font-bold text-base flex items-center justify-center active:scale-95 transition-transform" 
                        onclick="updateWaiterCartQty(${index}, -1)">
                        -
                    </button>
                    <span class="w-8 text-center font-bold text-gray-800 text-sm">${item.qty}</span>
                    <button class="w-8 h-8 bg-white rounded shadow-sm text-gray-600 hover:text-[var(--system-primary)] font-bold text-base flex items-center justify-center active:scale-95 transition-transform" 
                        onclick="updateWaiterCartQty(${index}, 1)">
                        +
                    </button>
                </div>
                
                <div class="w-16 text-right shrink-0 self-center">
                    <span class="font-bold text-gray-900 text-xs">${formatMoney(item.price * item.qty)}</span>
                </div>
            </div>
        `;
    }).join('');

    if (totalEl) totalEl.innerText = formatMoney(total);

    // Explicitly expose function again to ensure it's available
    window.updateWaiterCartQty = (idx, change) => {
        const item = waiterCart[idx];
        if (item) {
            item.qty += change;
            if (item.qty <= 0) {
                waiterCart.splice(idx, 1);
            }
        }

        updateFloatingCartButton();
        if (waiterCart.length === 0) {
            $('waiter-review-modal').classList.add('hidden');
        } else {
            renderReviewCartList();
        }
    };
}

export function renderWaiterActiveOrders(orders) {
    const grid = $('waiter-orders-grid');
    const empty = $('waiter-empty');

    if (!grid || !empty) return;

    const activeOrders = orders.filter(o => o.status !== 'Cobrado' && o.status !== 'Anulado');

    if (activeOrders.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = activeOrders.map(o => {
        // Calculate progress based on quantities instead of pure items
        const totalItems = o.items.reduce((sum, i) => sum + (i.qty || 1), 0);
        const checkedItems = o.items.reduce((sum, i) => sum + (i.checkedQty !== undefined ? i.checkedQty : (i.checked ? (i.qty || 1) : 0)), 0);
        const progressPercent = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

        return `
        <div class="${o._offline ? 'bg-amber-50/60' : 'bg-white'} p-4 rounded-xl border ${o._offline ? 'border-amber-200' : 'border-gray-100'} shadow-sm hover:shadow-md transition-all flex flex-col h-full">
            <div class="mb-3 border-b border-gray-50 pb-2">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-base font-bold text-gray-500">#${o.id}</span>
                    <div class="flex gap-2 items-center">
                         <!-- Add Item Button -->
                         <!-- Add Item Button Removed from here -->
                         <button class="w-7 h-7 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center hover:bg-orange-200 transition-colors btn-waiter-notes relative bell-ring-container" data-id="${o.id}">
                            ${o.unsolved_notes_count > 0 ? '<div class="bell-pulse-ring"></div>' : ''}
                            <i class="fas fa-bell relative z-10 ${o.unsolved_notes_count > 0 ? 'animate-jump-spin' : ''}"></i>
                        </button>
                        <span class="text-[14px] font-bold px-2 py-0.5 rounded ${getStatusColor(o.status)}">${o.status}</span>
                    </div>
                </div>
                <div class="flex justify-between items-center">
                    <div class="text-lg font-bold text-gray-800">${(o.table || o.tableNum) && (o.table || o.tableNum) !== '?' && o.type !== 'General' && o.type !== 'Domicilio' && o.type !== 'Recoger' ? `Mesa ${o.table || o.tableNum}` : 'Pedido General'}</div>
                    <div class="text-xs text-gray-400"><i class="far fa-clock mr-1"></i>${new Date(o.timestamp).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
            </div>

            <!-- Progress Bar -->
            <div class="mb-3">
                <div class="flex items-center gap-2 mb-1">
                    <div class="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div class="bg-gradient-to-r from-[var(--system-primary)] to-[#e09e45] h-full transition-all duration-300" style="width: ${progressPercent}%"></div>
                    </div>
                    <span class="text-xs font-bold text-gray-600 min-w-[35px] text-right">${progressPercent}%</span>
                </div>
            </div>
            
            <div class="space-y-1 mb-4 flex-1">
                ${o.items.map(i => {
            const checkedQty = i.checkedQty !== undefined ? i.checkedQty : (i.checked ? i.qty : 0);
            const isFullyChecked = checkedQty >= i.qty;
            const itemStyle = isFullyChecked ? 'text-gray-400 line-through' : 'text-gray-600';
            const iconColor = isFullyChecked ? 'text-[var(--system-primary)]' : 'text-orange-400';
            const checkedIcon = checkedQty > 0 ? `<i class="fas fa-check-circle ${iconColor} text-xs mr-1" title="${checkedQty}/${i.qty} listos"></i>` : '';
            const displayQty = (i.qty > 1 && checkedQty > 0 && !isFullyChecked) ? `[${checkedQty}/${i.qty}] ` : `${i.qty}x `;

            return `
                    <div class="flex flex-col text-sm ${itemStyle} transition-all mb-1">
                        <div class="flex justify-between">
                            <span>${checkedIcon}${displayQty}${escapeHtml(i.name)}</span>
                        </div>
                        ${i.toppings_text ? `<span class="text-[10px] text-amber-800 font-semibold pl-2 leading-tight">+ ${escapeHtml(i.toppings_text)}</span>` : ''}
                        ${i.notes ? `<span class="text-[10px] text-gray-500 italic pl-2 leading-tight"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>${escapeHtml(i.notes)}</span>` : ''}
                    </div>
                `;
        }).join('')}
            </div>
            
            <div class="flex items-center justify-between pt-2 border-t border-gray-50 mt-auto">
                <div class="flex flex-col">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-gray-900 text-xl">${formatMoney(o.total)}</span>
                        ${o.payment === 'Transferencia' && o.proof && o.proof !== 'null' ? `
                            <div class="relative group w-8 h-8 rounded border border-gray-200 overflow-hidden cursor-pointer shadow-sm" onclick="window.showImageModal \u0026\u0026 window.showImageModal('${o.proof}')" title="Ver comprobante">
                                <img src="${o.proof}" class="w-full h-full object-cover" alt="Comprobante" loading="lazy" />
                                <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center transition-all">
                                    <i class="fas fa-search-plus text-white text-[10px]"></i>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    ${o.payment === 'Transferencia' && (!o.proof || o.proof === 'null') ? `
                        <button class="mt-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 transition-colors btn-waiter-upload-proof" data-id="${o.id}">
                            <i class="fas fa-upload mr-1"></i> Subir Comprobante
                        </button>
                    ` : ''}
                </div>
                <button class="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center hover:bg-blue-200 transition-colors btn-waiter-add-item shadow-sm active:scale-95" data-id="${o.id}" title="Agregar Plato">
                    <i class="fas fa-plus text-xl"></i>
                </button>
            </div>
        </div>
    `;
    }).join('');

    // Attach listeners for notes
    if (grid) {
        grid.querySelectorAll('.btn-waiter-notes').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                openWaiterNotesModal(btn.dataset.id);
            };
        });

        // Listener for Add Item
        grid.querySelectorAll('.btn-waiter-add-item').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                openAddItemModal(btn.dataset.id);
            };
        });

        // Listener for Upload Proof
        grid.querySelectorAll('.btn-waiter-upload-proof').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                handleWaiterProofUpload(btn.dataset.id);
            };
        });
    }

}

export function handleWaiterProofUpload(orderId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async (e) => {
        const file = e.target.files[0];
        document.body.removeChild(input); // Cleanup
        if (!file) return;

        const order = state.orders.find(o => o.id == orderId) || (state.waiterOrders || []).find(o => o.id == orderId);
        if (!order) return showModalAlert("Error", "Pedido no encontrado", "error");

        try {
            setLoading(null, true, "Subiendo comprobante...");
            const compressedBlob = await compressProof(file);

            // ── OFFLINE / TEMP ID PATH: save proof locally ──
            const isTempId = String(orderId).startsWith('OFF-');
            if (isTempId || order._offline === true || !navigator.onLine) {
                // Convert compressed blob to data URL for offline storage
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(compressedBlob);
                });

                // Update the order in memory
                if (state.waiterOrders) {
                    const idx = state.waiterOrders.findIndex(o => o.id == orderId);
                    if (idx !== -1) {
                        state.waiterOrders[idx].proof = dataUrl;
                        state.waiterOrders[idx].payment = 'Transferencia';
                    }
                }
                if (state.orders) {
                    const idx = state.orders.findIndex(o => o.id == orderId);
                    if (idx !== -1) {
                        state.orders[idx].proof = dataUrl;
                        state.orders[idx].payment = 'Transferencia';
                    }
                }

                // Update in IndexedDB offline_orders store
                try {
                    const { OfflineDB } = await import('../services/offline-db.js');
                    const offlineOrders = await OfflineDB.getOfflineOrders();
                    const dbIdx = offlineOrders.findIndex(o => o.id == orderId);
                    if (dbIdx !== -1) {
                        offlineOrders[dbIdx].proof = dataUrl;
                        offlineOrders[dbIdx].payment = 'Transferencia';
                        await OfflineDB.saveOfflineOrder(offlineOrders[dbIdx]);
                    }

                    // Also update the queued POST body to include the proof data URL
                    const updated = await OfflineDB.updateQueuedRequestByOfflineId(orderId, {
                        ...offlineOrders[dbIdx],
                        proof: dataUrl,
                        payment: 'Transferencia'
                    });
                    console.log("📦 Updated queued POST body with proof:", updated);
                } catch (dbErr) {
                    console.error("Error saving proof to offline DB:", dbErr);
                }

                // Trigger re-render
                window.dispatchEvent(new Event('offline_sync_complete'));

                toast("Comprobante guardado localmente. Se sincronizará al conectar.", "success");
                setLoading(null, false);
                return;
            }

            // ── ONLINE PATH WITH REAL ID: send via API ──
            const formData = new FormData();
            formData.append('proof', compressedBlob, `proof_${orderId}.jpg`);

            formData.append('client', order.client);
            formData.append('phone', order.phone || 'N/A');
            formData.append('address', order.address || 'Local');
            formData.append('notes', order.notes || '');
            formData.append('type', order.type);
            formData.append('payment', order.payment);
            formData.append('status', order.status);
            formData.append('table', order.tableNum || order.table);
            formData.append('total', order.total || 0);
            formData.append('items', typeof order.items === 'string' ? order.items : JSON.stringify(order.items));

            const { ApiClient } = await import('../services/api-client.js');
            await ApiClient.put(`/orders/${orderId}`, formData);

            toast("Comprobante subido exitosamente", "success");
        } catch (err) {
            console.error(err);
            showModalAlert("Error", "Error subiendo comprobante", "error");
        } finally {
            setLoading(null, false);
        }
    };

    // Also cleanup if user cancels file dialog (won't catch all cases but helps)
    input.oncancel = () => {
        if (document.body.contains(input)) document.body.removeChild(input);
    };

    input.click();
}

export function resetWaiterOrderForm() {
    waiterCart = [];
    updateFloatingCartButton();

    const tableInput = $('w-table-num');
    if (tableInput) tableInput.value = '';

    const tableInputReview = $('w-table-num-review');
    if (tableInputReview) tableInputReview.value = '';

    const notesInput = $('w-order-notes');
    if (notesInput) notesInput.value = '';

    const notesInputReview = $('w-order-notes-review');
    if (notesInputReview) notesInputReview.value = '';

    const searchInput = $('waiter-product-search');
    if (searchInput) searchInput.value = '';
    _waiterSearchQuery = '';

    const clearBtn = $('btn-clear-waiter-search');
    if (clearBtn) clearBtn.classList.add('hidden');

    renderWaiterProducts();
}
window.resetWaiterOrderForm = resetWaiterOrderForm;

export async function openWaiterModal() {
    console.log('🔵 openWaiterModal called');

    resetWaiterOrderForm();

    const modal = $('waiter-order-modal');

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    //Fetch fresh products and categories from server before rendering
    try {
        const freshProducts = await getProducts();
        const freshCategories = await getCategories();

        state.products = freshProducts;
        state.categories = freshCategories;
    } catch (err) {
        console.error('❌ Error loading products/categories:', err);
    }

    renderWaiterProducts();

    // Ensure events are init (idempotent)
    initWaiterEvents();

    // Listen to note events for open modal refresh
    if (!window.waiterNoteListenersAttached) {
        // Shared logic to check if we should update waiter modal
        const shouldUpdateWaiterModal = (oid) => {
            return (state.user && state.user.role === 'mesero') &&
                currentWaiterOrderId &&
                (oid == currentWaiterOrderId) &&
                !$('waiter-notes-modal').classList.contains('hidden');
        };

        window.socket.on('new_order_note', (data) => {
            if (shouldUpdateWaiterModal(data.orderId)) {
                openWaiterNotesModal(currentWaiterOrderId);
            }
            // Always update active orders list if function exists (bell icon update)
            if (window.renderWaiterActiveOrders && state.user && state.user.role === 'mesero') {
                window.renderWaiterActiveOrders();
            }
        });

        window.socket.on('order_note_updated', (data) => {
            const oid = data.orderId || data.id || (data.note && data.note.id_order);
            if (shouldUpdateWaiterModal(oid)) {
                openWaiterNotesModal(currentWaiterOrderId);
            }
            if (window.renderWaiterActiveOrders && state.user && state.user.role === 'mesero') {
                window.renderWaiterActiveOrders();
            }
        });

        window.socket.on('order_note_deleted', (data) => {
            const oid = data.orderId || data.id || (data.note && data.note.id_order);
            if (shouldUpdateWaiterModal(oid)) {
                openWaiterNotesModal(currentWaiterOrderId);
            }
            if (window.renderWaiterActiveOrders && state.user && state.user.role === 'mesero') {
                window.renderWaiterActiveOrders();
            }
        });
        window.waiterNoteListenersAttached = true;
    }
}

export async function handleSendWaiterOrder() {
    if (waiterCart.length === 0) return toast("El carrito está vacío", "error");

    const tableInput = $('w-table-num');
    const tableInputReview = $('w-table-num-review');

    // Get value from whichever input is visible or has value
    let tableNum = tableInput ? tableInput.value.trim() : '';
    if (!tableNum && tableInputReview) {
        tableNum = tableInputReview.value.trim();
    }

    // Enhanced table number validation
    if (!tableNum) {
        toast("Falta el número de mesa", "error");
        if (tableInput) tableInput.focus();
        return;
    }

    if (tableNum.length > 3) {
        toast("Número de mesa inválido (máximo 3 caracteres)", "error");
        if (tableInput) tableInput.focus();
        return;
    }

    // Check if restaurant is open
    if (state.config.isOpen === false) {
        toast("Error: El restaurante está cerrado", "error");
        return;
    }

    setLoading('btn-final-send-order', true, "Enviando...");
    setLoading('btn-final-send-order-review', true, "Enviando...");

    try {
        if (!state.user || !state.user.id) {
            toast("Error: Usuario no identificado", "error");
            return;
        }

        // ID generated by backend or let backend handle it
        const orderId = null; // Will be returned by createWaiterOrder

        const notesInput = $('w-order-notes');

        const orderData = {
            id: orderId,
            table: tableNum,
            items: waiterCart,
            total: waiterCart.reduce((sum, item) => sum + (item.price * item.qty), 0),
            status: 'Recibido',
            waiterId: state.user.id,
            waiterName: state.user.name,
            notes: (notesInput ? notesInput.value.trim() : '') || ($('w-order-notes-review') ? $('w-order-notes-review').value.trim() : ''),
            date: new Date().toISOString(),
            displayDate: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
            type: 'Local',
            payment: 'Efectivo', // Default for local orders
            // Cliente Final data for legal/printing requirements
            client: "Cliente Final",
            phone: "3000000000",
            address: "Cll 00 00 00"
        };

        const newId = await createWaiterOrder(orderData);

        $('waiter-review-modal').classList.add('hidden');
        $('waiter-order-modal').classList.add('hidden');
        resetWaiterOrderForm();

        toast(`Pedido #${newId || ''} creado con éxito`, "success");

        // Immediately trigger refresh of active waiter orders (both online and offline)
        window.dispatchEvent(new Event('offline_sync_complete'));

    } catch (e) {
        console.error("Error in handleSendWaiterOrder:", e);
        toast("Error al enviar pedido: " + e.message, "error");
    } finally {
        setLoading('btn-final-send-order', false);
        setLoading('btn-final-send-order-review', false, "Confirmar Pedido"); // Reset text manually or through helper if supported
    }
}

export function getStatusColor(status) {
    switch (status) {
        case 'Pendiente': return 'bg-gray-100 text-gray-600';
        case 'Recibido': return 'bg-yellow-100 text-yellow-700';
        case 'En preparación': return 'bg-orange-100 text-orange-700';
        case 'Terminado': return 'bg-[#f5b55f]/20 text-[#1e2122] border border-[#f5b55f]/40 font-bold';
        case 'En Reparto': return 'bg-blue-100 text-blue-700';
        case 'Entregado': return 'bg-[#1e2122] text-[#f5b55f] font-bold';
        case 'Cobrado': return 'bg-[#f5b55f] text-[#1e2122] font-black shadow-sm';
        case 'Anulado': return 'bg-red-100 text-red-700';
        default: return 'bg-gray-100 text-gray-600';
    }
}

export async function openWaiterHistory() {
    const modal = $('waiter-history-modal');
    const list = $('waiter-history-list');
    const totalEl = $('waiter-history-total');

    if (!modal || !list) return;

    modal.classList.remove('hidden');
    list.innerHTML = '<div class="text-center py-10"><i class="fas fa-spinner fa-spin text-2xl text-gray-300"></i></div>';

    try {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const orders = await import('../services/order-service.js').then(m => m.getHistoryOrders());
        // Filter locally for now
        // TODO: Backend filter
        /*
        const snapshot = await getDocs(q);
        const orders = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.waiterId === state.user.id) {
                orders.push({ id: doc.id, ...data });
            }
        });
        */

        // Filter orders for this waiter only and only 'Cobrado' items
        const curUser = state.user || (typeof localStorage !== 'undefined' && localStorage.getItem('pos_user') ? JSON.parse(localStorage.getItem('pos_user')) : null);
        const curUserId = curUser?.id !== undefined && curUser?.id !== null ? String(curUser.id) : null;
        const curUserName = curUser?.name ? String(curUser.name).trim().toLowerCase() : '';

        const filteredOrders = orders.filter(o => {
            const matchesId = curUserId && o.waiterId !== undefined && o.waiterId !== null && String(o.waiterId) === curUserId;
            const matchesName = curUserName && o.waiterName && String(o.waiterName).trim().toLowerCase() === curUserName;
            return (matchesId || matchesName) && o.status === 'Cobrado';
        });

        if (filteredOrders.length === 0) {
            list.innerHTML = '<div class="text-center py-10 text-gray-400">No tienes pedidos hoy.</div>';
            totalEl.innerText = "$0";
            return;
        }

        let total = 0;

        list.innerHTML = filteredOrders.map(o => {
            total += o.total;
            const hasTable = (o.table || o.tableNum) && (o.table || o.tableNum) !== '?' && o.type !== 'General' && o.type !== 'Domicilio' && o.type !== 'Recoger';
            const tableLabel = hasTable ? `Mesa ${escapeHtml(o.table || o.tableNum)}` : 'Pedido General';
            return `
            <div class="bg-white p-3 rounded-xl border border-gray-100 shadow-sm mb-2">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                        <i class="${hasTable ? 'fas fa-chair text-blue-500' : 'fas fa-shopping-bag text-orange-500'} text-xs"></i>
                        ${tableLabel}
                    </span>
                    <span class="text-xs font-bold px-2 py-1 rounded ${getStatusColor(o.status)}">${escapeHtml(o.status)}</span>
                </div>
                <div class="space-y-1">
                    ${o.items.map(i => `
                        <div class="flex flex-col text-xs text-gray-600 mb-1">
                            <div class="flex justify-between">
                                <span>${i.qty}x ${escapeHtml(i.name)}</span>
                                <span class="font-medium">${formatMoney(i.price * i.qty)}</span>
                            </div>
                            ${i.toppings_text ? `<span class="text-[10px] text-amber-800 font-semibold pl-2 leading-tight">+ ${escapeHtml(i.toppings_text)}</span>` : ''}
                            ${i.notes ? `<span class="text-[10px] text-gray-500 italic pl-2 leading-tight"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>${escapeHtml(i.notes)}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
                <div class="mt-2 pt-2 border-t border-gray-50 flex justify-between items-center">
                    <span class="text-[10px] text-gray-400">${o.displayDate || ''}</span>
                    <span class="font-bold text-gray-900 text-sm">${formatMoney(o.total)}</span>
                </div>
            </div >
            `;
        }).join('');

        totalEl.innerText = formatMoney(total);

    } catch (e) {
        console.error("Error loading waiter history:", e);
        list.innerHTML = '<div class="text-center py-10 text-red-400">Error cargando historial.</div>';
    }
}

// ==========================================
// WAITER NOTES LOGIC
// ==========================================

let currentWaiterOrderId = null;

export async function openWaiterNotesModal(orderId) {
    currentWaiterOrderId = orderId;
    const modal = $('waiter-notes-modal');
    const container = $('waiter-notes-list');

    if (!modal || !container) return;

    container.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-gray-300"></i></div>';
    modal.classList.remove('hidden');

    // Init events only once if not done
    if (!modal.dataset.init) {
        $('btn-close-waiter-notes').onclick = () => modal.classList.add('hidden');
        $('btn-add-note-input').onclick = addNoteInput;
        $('btn-save-notes').onclick = handleSaveNotes;
        modal.dataset.init = 'true';
    }

    try {
        const notes = await getOrderNotes(orderId);
        container.innerHTML = ''; // Clear loader

        // Render existing notes first (read-only or deletable?)
        // Requirement: "el input debe tener un boton de (-) para eliminar la anotacion"
        // Also "creará un input nuevo... por si el mesero quiere hacer más de una anotación".
        // Use case seems to allow adding new ones. What about existing ones?
        // Prompt says: "se debe abrir un mini modal con la anotación... y justo al lado un check que tacha el texto... a su vez en la vista del mesero... la anotación realizada debe verse tachada"
        // So existing notes should be shown.
        // Prompt also says: "el input debe tener un boton de (-) para eliminar la anotación por si el mesero se arrepintio... estos cambios deben verse reflejados".

        if (notes && notes.length > 0) {
            notes.forEach(note => {
                renderNoteItem(container, note);
            });
        }

        // Always add one empty input if none exist? Or just let them add?
        // Let's add one empty input by default if list is empty, or just let them click "+".
        // Requirement: "debajo de cada input, debe haber un boton con un "plus" (+) ..."
        // I'll make the "+" button global at bottom as per mock, but logic handles multiple inputs.

        if (notes.length === 0) {
            addNoteInput();
        }

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-center text-red-400 text-xs">Error cargando notas</div>';
    }
}

function renderNoteItem(container, note = null) {
    const div = document.createElement('div');
    div.className = "flex gap-2 items-start animate-fade-in";

    // If note exists and is solved, it's strictly read-only or maybe deletable?
    // "la anotación realizada debe verse tachada"
    const isSolved = note && note.solved;
    const value = note ? note.content : '';
    const noteId = note ? note.id : '';

    let solvedInfoStr = '';
    if (isSolved) {
        const name = note.solvedByName || 'Usuario';
        const timeStr = note.solvedAt ? new Date(note.solvedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : '';
        solvedInfoStr = `
            <div class="text-[10px] text-[var(--system-tertiary)] font-bold bg-[var(--system-primary)]/20 px-2 py-0.5 rounded border border-[var(--system-primary)]/40 inline-flex items-center gap-1 w-fit mt-1 ml-1">
                <i class="fas fa-check-circle text-[var(--system-primary)]"></i>
                <span>Resuelto por: ${escapeHtml(name)}</span>
                ${timeStr ? `<span class="text-[var(--system-tertiary)] font-normal border-l border-[var(--system-primary)]/40 pl-1 ml-0.5">${timeStr}</span>` : ''}
            </div>
        `;
    }

    div.innerHTML = `
        <div class="flex-1 flex flex-col relative w-full">
            <div class="relative w-full">
                <input type="text" 
                    class="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-orange-500 text-sm transition-all ${isSolved ? 'line-through text-gray-400 bg-gray-100' : 'text-gray-700'}"
                    placeholder="Escribe una nota..."
                    value="${escapeHtml(value)}"
                    ${isSolved || noteId ? 'readonly' : ''}
                    data-note-id="${noteId}"
                >
                ${isSolved ? '<i class="fas fa-check-circle text-[var(--system-primary)] absolute right-3 top-3.5"></i>' : ''}
            </div>
            ${solvedInfoStr}
        </div>
        ${!noteId ? `<button type="button" class="w-11 h-11 flex shrink-0 items-center justify-center bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-colors delete-note-btn" title="Cancelar anotación">
            <i class="fas fa-minus"></i>
        </button>` : ''}
        `;

    // Handle Delete (only for new unsaved inputs, existing notes cannot be deleted by waiter)
    const btnDelete = div.querySelector('.delete-note-btn');
    if (btnDelete) {
        btnDelete.onclick = () => {
            // New input (no ID): just remove the input field
            div.remove();
        };
    }

    container.appendChild(div);
}

function addNoteInput() {
    const container = $('waiter-notes-list');
    renderNoteItem(container);
    // Focus last input
    const inputs = container.querySelectorAll('input');
    if (inputs.length) inputs[inputs.length - 1].focus();
}

async function handleSaveNotes() {
    if (!currentWaiterOrderId) return;

    const container = $('waiter-notes-list');
    const inputs = container.querySelectorAll('input');

    const newNotes = [];

    inputs.forEach(input => {
        const val = input.value.trim();
        const id = input.dataset.noteId;

        // Only interested in NEW notes (no ID) that have content
        if (!id && val) {
            newNotes.push(val);
        }
    });

    if (newNotes.length === 0) {
        // Nothing new to save
        $('waiter-notes-modal').classList.add('hidden');
        return;
    }

    setLoading('btn-save-notes', true, 'Guardando...');

    try {
        await addOrderNotes(currentWaiterOrderId, newNotes, state.user.id);
        toast('Notas guardadas', 'success');
        $('waiter-notes-modal').classList.add('hidden');

        // Refresh orders to update bell icon count? 
        // Socket "new_order_note" event might trigger refresh?
        // Waiter view listens to order updates. Backend emits 'new_order_note'.
        // We probably need to listen to 'new_order_note' in waiter-view or main service?
        // For now, let's strictly rely on socket update which we haven't implemented listener for in waiter-view yet.
        // But invalidating/refreshing orders here is safe.
        // We can manually refresh:
        // socket.emit('order_updated', ...)? No, we just fetch.
        // Actually, let's just close. The bell update relies on `renderWaiterActiveOrders` which runs on socket updates.
        // Backend `POST / notes` emits `new_order_note`. We need to handle that event to refresh order list.

    } catch (e) {
        console.error(e);
        toast('Error guardando notas', 'error');
    } finally {
        setLoading('btn-save-notes', false);
    }
}

// ==========================================
// ADD ITEM LOGIC
// ==========================================

let itemsToAdd = [];
let currentAddOrderId = null;

export function openAddItemModal(orderId) {
    currentAddOrderId = orderId;
    itemsToAdd = [];

    const modal = $('waiter-add-item-modal');
    $('wai-order-id').innerText = orderId;

    if (!modal) return;

    modal.classList.remove('hidden');

    // Init logic if not (button listener)
    if (!modal.dataset.init) {
        $('btn-wai-send').onclick = handleSendAddedItems;

        // Search Listener
        const searchInput = $('wai-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderWaiProducts(e.target.value.trim());
            });
        }

        modal.dataset.init = 'true';
    }

    // Reset search
    const searchInput = $('wai-search');
    if (searchInput) searchInput.value = '';

    renderWaiProducts();
    updateWaiCart();
}

function renderWaiProducts(searchTerm = '') {
    const grid = $('wai-products-grid');
    if (!grid) return;

    grid.innerHTML = '';

    let availableProducts = state.products.filter(p => p.available !== 0 && p.available !== false);

    // Filter by search term
    if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        availableProducts = availableProducts.filter(p =>
            p.name.toLowerCase().includes(lowerTerm)
        );
    }

    if (availableProducts.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 opacity-50 text-xs">No se encontraron platos.</div>';
        return;
    }

    // Simple grid for now, or reuse accordion logic?
    // Let's use simple grid grouped by category titles for speed

    let html = '';

    state.categories.forEach(cat => {
        const catProducts = availableProducts.filter(p => p.category === cat.name);
        if (catProducts.length > 0) {
            html += `
                <div class="col-span-full mt-2 mb-1">
                    <h5 class="font-bold text-gray-500 text-xs uppercase tracking-wider border-b border-gray-100 pb-1">${cat.name}</h5>
                </div>
            `;

            html += catProducts.map(p => `
                <div class="wai-prod-card bg-white border border-gray-100 p-2 rounded-xl shadow-sm hover:shadow-md cursor-pointer flex flex-col items-center text-center active:scale-95 transition-all h-24 justify-center relative overflow-hidden group" data-id="${p.id}">
                    ${p.has_toppings ? `<span class="w-5 h-5 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] border border-amber-200 shadow-2xs z-20 pointer-events-none" style="position: absolute; top: 4px; right: 4px;" title="Personalizable"><i class="fas fa-cookie-bite"></i></span>` : ''}
                    <h4 class="font-bold text-gray-700 text-xs leading-tight line-clamp-2 w-full mb-1">${escapeHtml(p.name)}</h4>
                    <span class="font-bold text-orange-600 text-xs">${formatMoney((p.is_promo && p.promo_price) ? p.promo_price : p.price)}</span>
                </div>
            `).join('');
        }
    });

    grid.innerHTML = html;

    grid.querySelectorAll('.wai-prod-card').forEach(card => {
        card.onclick = () => addToWaiCart(card.dataset.id);
    });
}

function addToWaiCart(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    // Reset search so all categories are displayed again
    const searchInput = $('wai-search');
    if (searchInput && searchInput.value) {
        searchInput.value = '';
        renderWaiProducts('');
    }

    if (product.has_toppings) {
        openClientToppingsModal(product, {
            onConfirm: (customizedItem) => {
                itemsToAdd.push(customizedItem);
                updateWaiCart();
                toast(`${product.name} con adiciones agregado`, 'success');
            }
        });
        return;
    }

    const price = (product.is_promo && product.promo_price) ? product.promo_price : product.price;
    const existing = itemsToAdd.find(i => i.id === productId && !i.toppings_text && !i.notes);
    if (existing) {
        existing.qty++;
    } else {
        itemsToAdd.push({ ...product, price: price, qty: 1 });
    }
    updateWaiCart();
    toast(`${product.name} agregado`, 'success');
}

function updateWaiCart() {
    const list = $('wai-cart-list');
    const totalEl = $('wai-total');

    if (!list) return;

    if (itemsToAdd.length === 0) {
        list.innerHTML = '<div class="text-center py-10 opacity-50 text-xs flex flex-col items-center"><i class="fas fa-shopping-basket text-4xl text-gray-200 mb-2"></i>Selecciona platos</div>';
        if (totalEl) totalEl.innerText = "$0";
        return;
    }

    let total = 0;

    list.innerHTML = itemsToAdd.map((item, index) => {
        total += item.price * item.qty;
        return `
            <div class="flex items-start gap-2 bg-white p-2 rounded-lg border border-gray-100 shadow-sm mb-2 animate-fade-in-right">
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-gray-800 text-xs leading-tight mb-0.5">${escapeHtml(item.name)}</h4>
                    ${formatToppingsListHtml(item)}
                    ${item.notes ? `<p class="text-[10px] text-gray-500 italic block mt-1"><i class="fas fa-comment-alt mr-1 text-[8px]"></i>${escapeHtml(item.notes)}</p>` : ''}
                    <span class="text-[10px] text-gray-500 font-bold block mt-1">${formatMoney(item.price)} c/u</span>
                </div>
                
                <div class="flex items-center bg-gray-100 rounded-md p-0.5">
                    <button class="w-6 h-6 bg-white rounded shadow-sm text-gray-600 hover:text-red-500 font-bold text-sm flex items-center justify-center active:scale-95 transition-transform" 
                        onclick="updateWaiQty(${index}, -1)">
                        -
                    </button>
                    <span class="w-6 text-center font-bold text-gray-800 text-xs">${item.qty}</span>
                    <button class="w-6 h-6 bg-white rounded shadow-sm text-gray-600 hover:text-[var(--system-primary)] font-bold text-sm flex items-center justify-center active:scale-95 transition-transform" 
                        onclick="updateWaiQty(${index}, 1)">
                        +
                    </button>
                </div>
                
                <div class="w-14 text-right">
                    <span class="font-bold text-gray-900 text-xs">${formatMoney(item.price * item.qty)}</span>
                </div>
            </div>
        `;
    }).join('');

    if (totalEl) totalEl.innerText = formatMoney(total);

    // Expose update function
    window.updateWaiQty = (idx, change) => {
        const item = itemsToAdd[idx];
        if (item) {
            item.qty += change;
            if (item.qty <= 0) {
                itemsToAdd.splice(idx, 1);
            }
        }
        updateWaiCart();
    };
}

async function handleSendAddedItems() {
    if (state.config.isOpen === false) {
        toast("Error: El restaurante está cerrado", "error");
        return;
    }

    if (itemsToAdd.length === 0) {
        return toast("Selecciona al menos un plato", "warning");
    }

    if (!currentAddOrderId) return;

    setLoading('btn-wai-send', true, 'Enviando...');

    try {
        await addItemsToOrder(currentAddOrderId, itemsToAdd);
        toast("Items agregados correctamente", "success");
        $('waiter-add-item-modal').classList.add('hidden');
        itemsToAdd = [];
    } catch (e) {
        console.error(e);
        const errorMsg = e.message || "Error al agregar items";
        toast(errorMsg, "error");
    } finally {
        setLoading('btn-wai-send', false, '<i class="fas fa-plus-circle"></i> Agregar al Pedido');
    }
}
