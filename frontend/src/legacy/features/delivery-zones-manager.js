/**
 * DigiRest - Delivery Zones Management Feature (Fase 4)
 * Handles Admin Delivery Zones CRUD, Table rendering, Modal, Real-time Sync,
 * and Client Checkout Delivery Zone integration.
 */

import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { toast, showConfirmModal } from '../components/ui.js';
import { getDeliveryZones, saveDeliveryZone, toggleDeliveryZone, deleteDeliveryZone, listenToDeliveryZones } from '../services/delivery-service.js';

let _initialized = false;

/**
 * Initialize delivery zones feature, listeners, and socket sync
 */
export function initDeliveryZonesManager() {
    if (_initialized) return;
    _initialized = true;

    // Listeners for Admin Panel
    const btnNew = $('btn-new-delivery-zone');
    if (btnNew) {
        btnNew.addEventListener('click', () => openDeliveryZoneModal());
    }

    const btnCancel = $('btn-cancel-delivery-zone');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => closeDeliveryZoneModal());
    }

    const form = $('delivery-zone-form');
    if (form) {
        form.addEventListener('submit', handleSaveDeliveryZone);
    }

    const searchInput = $('delivery-zone-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderDeliveryZonesTable());
    }

    // Real-time synchronization
    listenToDeliveryZones((updatedZones) => {
        state.deliveryZones = updatedZones || [];
        renderDeliveryZonesTable();
        populateClientDeliveryZones();
    });
}

/**
 * Fetch delivery zones from server and render table
 */
export async function loadDeliveryZones() {
    try {
        const zones = await getDeliveryZones();
        state.deliveryZones = zones || [];
        renderDeliveryZonesTable();
        populateClientDeliveryZones();
    } catch (err) {
        console.error("Error al cargar zonas de domicilio:", err);
        toast("Error al cargar zonas de domicilio", "error");
    }
}

/**
 * Render the Admin Delivery Zones table with search filter
 */
export function renderDeliveryZonesTable() {
    const tbody = $('admin-delivery-zones-body');
    const emptyState = $('delivery-zones-empty-state');
    if (!tbody) return;

    const searchTerm = ($('delivery-zone-search')?.value || '').toLowerCase().trim();
    const zones = state.deliveryZones || [];

    const filtered = zones.filter(z => {
        return !searchTerm || (z.name && z.name.toLowerCase().includes(searchTerm));
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = filtered.map(zone => {
        const isAvail = zone.available === 1 || zone.available === true;
        const estimatedTime = zone.estimated_time || '30-45 min';

        return `
            <tr class="hover:bg-gray-50/80 transition-colors border-b border-gray-100 last:border-0" data-id="${zone.id}">
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center text-orange-600 font-bold text-xs shrink-0">
                            <i class="fas fa-map-marker-alt"></i>
                        </div>
                        <div>
                            <div class="font-bold text-gray-800 text-xs">${escapeHtml(zone.name)}</div>
                            <div class="text-[10px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                                <span><i class="fas fa-clock text-amber-500"></i> ${escapeHtml(estimatedTime)}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="p-4">
                    <div class="text-xs font-bold text-gray-900">${formatMoney(zone.fee)}</div>
                    <div class="text-[10px] text-gray-400">Tarifa de envío</div>
                </td>
                <td class="p-4 text-center">
                    <button type="button" class="btn-toggle-dz inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer transition-all active:scale-95 ${
                        isAvail 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100' 
                            : 'bg-rose-50 text-rose-700 border border-rose-200/80 hover:bg-rose-100'
                    }" data-id="${zone.id}" title="Click para alternar disponibilidad">
                        <span class="w-1.5 h-1.5 rounded-full ${isAvail ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
                        <span>${isAvail ? 'Disponible' : 'Inactivo'}</span>
                    </button>
                </td>
                <td class="p-4 text-center">
                    <div class="flex items-center justify-center gap-1.5">
                        <button type="button" class="btn-edit-dz w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors cursor-pointer" data-id="${zone.id}" title="Editar">
                            <i class="fas fa-edit text-xs"></i>
                        </button>
                        <button type="button" class="btn-del-dz w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors cursor-pointer" data-id="${zone.id}" data-name="${escapeHtml(zone.name)}" title="Eliminar">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Wire action buttons
    tbody.querySelectorAll('.btn-toggle-dz').forEach(btn => {
        btn.addEventListener('click', () => handleToggleDeliveryZone(btn.dataset.id));
    });

    tbody.querySelectorAll('.btn-edit-dz').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = (state.deliveryZones || []).find(z => z.id === btn.dataset.id);
            if (zone) openDeliveryZoneModal(zone);
        });
    });

    tbody.querySelectorAll('.btn-del-dz').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteDeliveryZone(btn.dataset.id, btn.dataset.name));
    });
}

/**
 * Open Delivery Zone modal for creating or editing
 */
export function openDeliveryZoneModal(zone = null) {
    const modal = $('delivery-zone-modal');
    const title = $('delivery-zone-modal-title');
    if (!modal) return;

    if (zone) {
        if (title) title.textContent = 'Editar Zona de Domicilio';
        $('dz-id').value = zone.id || '';
        $('dz-name').value = zone.name || '';
        $('dz-fee').value = zone.fee !== undefined ? zone.fee : 0;
        $('dz-time').value = zone.estimated_time || '30-45 min';
        $('dz-available').checked = zone.available === 1 || zone.available === true;
    } else {
        if (title) title.textContent = 'Nueva Zona de Domicilio';
        $('dz-id').value = '';
        $('dz-name').value = '';
        $('dz-fee').value = '3500';
        $('dz-time').value = '30-45 min';
        $('dz-available').checked = true;
    }

    modal.classList.remove('hidden');
    $('dz-name')?.focus();
}

/**
 * Close Delivery Zone modal
 */
export function closeDeliveryZoneModal() {
    const modal = $('delivery-zone-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Handle form submission for creating or updating delivery zone
 */
async function handleSaveDeliveryZone(e) {
    e.preventDefault();

    const id = $('dz-id')?.value || null;
    const name = $('dz-name')?.value?.trim();
    const fee = parseFloat($('dz-fee')?.value || 0);
    const estimated_time = $('dz-time')?.value?.trim() || '30-45 min';
    const available = $('dz-available')?.checked ? 1 : 0;

    if (!name) {
        toast("El nombre del sector o zona es obligatorio", "error");
        return;
    }

    if (isNaN(fee) || fee < 0) {
        toast("La tarifa de domicilio debe ser un valor válido", "error");
        return;
    }

    const payload = {
        name,
        fee,
        estimated_time,
        available
    };

    try {
        const saved = await saveDeliveryZone(payload, id);

        // Optimistic local update
        if (id) {
            const idx = (state.deliveryZones || []).findIndex(z => z.id === id);
            if (idx > -1) state.deliveryZones[idx] = saved;
        } else {
            state.deliveryZones = state.deliveryZones || [];
            state.deliveryZones.push(saved);
        }

        renderDeliveryZonesTable();
        populateClientDeliveryZones();
        closeDeliveryZoneModal();
        toast(id ? "Zona actualizada correctamente" : "Zona creada con éxito", "success");
    } catch (err) {
        console.error("Error al guardar zona de domicilio:", err);
        toast("Error al guardar: " + (err.message || "Error desconocido"), "error");
    }
}

/**
 * Handle toggle availability
 */
async function handleToggleDeliveryZone(id) {
    try {
        const res = await toggleDeliveryZone(id);
        const zone = (state.deliveryZones || []).find(z => z.id === id);
        if (zone) {
            zone.available = res.available;
            renderDeliveryZonesTable();
            populateClientDeliveryZones();
            toast(`Zona ${zone.name} ahora está ${zone.available ? 'disponible' : 'inactiva'}`, "success");
        }
    } catch (err) {
        console.error("Error al cambiar estado de zona:", err);
        toast("Error al cambiar disponibilidad", "error");
    }
}

/**
 * Handle delete delivery zone with confirmation
 */
function handleDeleteDeliveryZone(id, name) {
    showConfirmModal(
        "Eliminar Zona de Domicilio",
        `¿Estás seguro de que deseas eliminar la zona "${name}"? Esta acción no se puede deshacer.`,
        async () => {
            try {
                await deleteDeliveryZone(id);
                state.deliveryZones = (state.deliveryZones || []).filter(z => z.id !== id);
                renderDeliveryZonesTable();
                populateClientDeliveryZones();
                toast("Zona eliminada con éxito", "success");
            } catch (err) {
                console.error("Error al eliminar zona:", err);
                toast("Error al eliminar: " + (err.message || "Error desconocido"), "error");
            }
        }
    );
}

/**
 * Populate client delivery zones in the checkout modal (#c-zone)
 */
export function populateClientDeliveryZones() {
    const select = $('c-zone');
    if (!select) return;

    const availableZones = (state.deliveryZones || []).filter(z => z.available === 1 || z.available === true);
    const currentValue = select.value;

    let html = '<option value="" disabled ' + (!currentValue ? 'selected' : '') + '>Selecciona tu sector / barrio...</option>';
    availableZones.forEach(z => {
        const isSelected = currentValue === z.id ? 'selected' : '';
        html += `<option value="${z.id}" data-fee="${z.fee}" data-time="${escapeHtml(z.estimated_time || '')}" ${isSelected}>${escapeHtml(z.name)} — ${formatMoney(z.fee)}</option>`;
    });

    select.innerHTML = html;
}
