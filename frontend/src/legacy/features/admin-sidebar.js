import { $ } from '../utils/helpers.js';
import { ApiClient } from '../services/api-client.js';
import { toast, showConfirmModal } from '../components/ui.js';
import { state } from '../core/state.js';

// State for Calendar
let currentCalendarDate = new Date();
let cachedReservations = [];
let _sidebarInitialized = false;

export function initAdminSidebar() {
    // Show user greeting in sidebar (always refresh on view switch)
    const greeting = document.getElementById('sidebar-user-greeting');
    const nameSpan = document.getElementById('sidebar-user-name');
    const masterPwdBtn = document.getElementById('btn-master-change-pwd');
    const isMasterAdmin = (state.user?.name === 'digidanMasterAdmin' || state.user?.username === 'digidanMasterAdmin' || state.user?.id === 'digidan_master_admin');

    if (greeting && nameSpan) {
        const userName = state.user?.name;
        if (userName) {
            nameSpan.textContent = isMasterAdmin ? `${userName} 🛡️` : userName;
            greeting.classList.remove('hidden');
        } else {
            greeting.classList.add('hidden');
        }
    }

    if (masterPwdBtn) {
        if (isMasterAdmin) {
            masterPwdBtn.classList.remove('hidden');
        } else {
            masterPwdBtn.classList.add('hidden');
        }
    }

    // Guard: prevent binding listeners more than once
    if (_sidebarInitialized) return;
    _sidebarInitialized = true;

    setupListeners();
    setupMasterPasswordListeners();
}

function setupMasterPasswordListeners() {
    const modal = document.getElementById('modal-master-password');
    const btnOpen = document.getElementById('btn-master-change-pwd');
    const btnClose = document.getElementById('btn-close-master-pwd');
    const btnCancel = document.getElementById('btn-cancel-master-pwd');
    const form = document.getElementById('form-master-password');
    const sidebarLogo = document.getElementById('sidebar-logo');

    const openModal = () => {
        const isMaster = (state.user?.name === 'digidanMasterAdmin' || state.user?.username === 'digidanMasterAdmin' || state.user?.id === 'digidan_master_admin');
        if (!isMaster) return;
        if (modal) {
            modal.classList.remove('hidden');
            form?.reset();
            setTimeout(() => document.getElementById('master-current-pwd')?.focus(), 50);
        }
    };

    const closeModal = () => {
        if (modal) modal.classList.add('hidden');
    };

    btnOpen?.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal();
    });

    sidebarLogo?.addEventListener('click', () => {
        const isMaster = (state.user?.name === 'digidanMasterAdmin' || state.user?.username === 'digidanMasterAdmin' || state.user?.id === 'digidan_master_admin');
        if (isMaster) openModal();
    });

    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('master-current-pwd')?.value;
        const newPassword = document.getElementById('master-new-pwd')?.value;
        const confirmPassword = document.getElementById('master-confirm-pwd')?.value;

        if (!currentPassword || !newPassword) {
            return toast('Por favor ingresa todos los campos', 'warning');
        }
        if (newPassword.length < 4) {
            return toast('La nueva contraseña debe tener al menos 4 caracteres', 'warning');
        }
        if (newPassword !== confirmPassword) {
            return toast('Las nuevas contraseñas no coinciden', 'warning');
        }

        const submitBtn = document.getElementById('btn-submit-master-pwd');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
        }

        try {
            const res = await ApiClient.post('/auth/change-password', {
                currentPassword,
                newPassword
            });
            toast(res?.message || 'Contraseña actualizada exitosamente', 'success');
            closeModal();
        } catch (err) {
            console.error('Error changing master password:', err);
            let errMsg = 'Error al actualizar contraseña';
            try {
                const parsed = JSON.parse(err.message);
                if (parsed.error) errMsg = parsed.error;
            } catch {
                if (err.message) errMsg = err.message;
            }
            toast(errMsg, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-check"></i> Actualizar Clave';
            }
        }
    });
}



function setupListeners() {
    // Toggles
    $('btn-sb-notes')?.addEventListener('click', () => {
        // Switch from History to Active Notes (Global)
        if (window.openGlobalNotesModal) {
            window.openGlobalNotesModal();
        } else {
            console.error("openGlobalNotesModal not found");
        }
    });


    $('btn-filter-archived-notes')?.addEventListener('click', () => {
        const date = $('archived-notes-date')?.value;
        if (!date) return toast('Selecciona una fecha', 'warning');
        loadArchivedNotes(date);
    });

    // Allow pressing Enter on date input to filter
    $('archived-notes-date')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const date = e.target.value;
            if (date) loadArchivedNotes(date);
        }
    });

    $('btn-sb-tasks')?.addEventListener('click', () => {
        loadTasks();
        openModal('modal-tasks');
    });

    $('btn-sb-reservations')?.addEventListener('click', () => {
        currentCalendarDate = new Date(); // Reset to today
        loadReservations(); // This will also render calendar
        openModal('modal-reservations');
    });

    // Rapid Management Mode
    $('btn-sb-gr')?.addEventListener('click', async () => {
        try {
            const module = await import('./rapid-management.js');
            if (module && module.openRapidManagement) {
                module.openRapidManagement();
            }
        } catch (e) {
            console.error("Failed to load Rapid Management module", e);
        }
    });

    // Calendar Navigation
    $('prev-month')?.addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        renderCalendar();
    });

    $('next-month')?.addEventListener('click', () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        renderCalendar();
    });

    // FAB Button
    $('btn-add-reservation-fab')?.addEventListener('click', () => {
        // Pre-fill date with currently selected month/year if possible, or just open
        openModal('modal-add-reservation');
    });

    // Close Btns
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            this.closest('.fixed').classList.add('hidden');
        });
    });

    // --- Tasks Logic ---
    $('btn-add-task')?.addEventListener('click', async () => {
        const desc = $('new-task-desc').value;
        const date = $('new-task-date').value;
        if (!desc) return toast("Escribe una tarea", "warning");

        try {
            await ApiClient.post('/admin/tasks', { description: desc, due_date: date });
            $('new-task-desc').value = '';
            loadTasks();
            toast("Tarea agregada", "success");
        } catch (e) { console.error(e); }
    });

    // --- Reservations Logic ---
    $('btn-add-reservation-open')?.addEventListener('click', () => {
        openModal('modal-add-reservation');
    });

    $('btn-cancel-reservation')?.addEventListener('click', () => {
        $('modal-add-reservation').classList.add('hidden');
    });

    $('form-reservation')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        try {
            await ApiClient.post('/admin/reservations', data);
            $('modal-add-reservation').classList.add('hidden');
            e.target.reset();
            loadReservations();
            toast("Reserva guardada", "success");
        } catch (err) {
            console.error(err);
            toast("Error guardando reserva", "error");
        }
    });

    // --- Edit Reservation listeners ---
    $('btn-cancel-edit-reservation')?.addEventListener('click', () => {
        $('modal-edit-reservation').classList.add('hidden');
    });

    $('form-edit-reservation')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = $('edit-reservation-id').value;
        const data = {
            client_name: $('edit-rv-client').value,
            phone: $('edit-rv-phone').value,
            table_num: $('edit-rv-table').value,
            pax: $('edit-rv-pax').value,
            reservation_date: $('edit-rv-date').value,
            observation: $('edit-rv-observation').value,
        };

        try {
            await ApiClient.put(`/admin/reservations/${id}`, data);
            // Update local cache
            const idx = cachedReservations.findIndex(r => r.id == id);
            if (idx !== -1) {
                cachedReservations[idx] = { ...cachedReservations[idx], ...data };
            }
            $('modal-edit-reservation').classList.add('hidden');
            renderReservationsList();
            renderCalendar();
            toast('Reserva actualizada', 'success');
        } catch (err) {
            console.error(err);
            toast('Error guardando cambios', 'error');
        }
    });

    // Close on outside click for sidebar modals
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('fixed') && e.target.classList.contains('z-[60]') && e.target.id !== 'admin-sidebar') {
            e.target.classList.add('hidden');
        }
    });

    // Close on ESC key for sidebar modals
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.fixed.z-\\[60\\]').forEach(modal => {
                if (modal.id !== 'admin-sidebar' && !modal.classList.contains('hidden')) {
                    modal.classList.add('hidden');
                }
            });
        }
    });

    // Real-time Updates for Notes History
    if (window.socket) {
        const refreshHistoryIfOpen = () => {
            const modal = $('modal-notes-history');
            if (modal && !modal.classList.contains('hidden')) {
                loadNotesHistory();
            }
        };

        window.socket.on('order_note_updated', refreshHistoryIfOpen);
        window.socket.on('new_order_note', refreshHistoryIfOpen);
        // Also refresh on new order if it might have notes (though usually separated)
        // But for "Historial de Anotaciones", we want everything.
        window.socket.on('new_order', (data) => {
            // New orders might have initial notes
            refreshHistoryIfOpen();
        });
        window.socket.on('order_deleted', refreshHistoryIfOpen);
    }
}

function openModal(id) {
    const el = $(id);
    if (el) el.classList.remove('hidden');
}

// Exposed globally so other modules (admin-view.js) can trigger it
window.openArchivedNotesModal = (date) => {
    const todayStr = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const dateInput = $('archived-notes-date');
    if (dateInput && !dateInput.value) dateInput.value = todayStr;
    openModal('modal-archived-notes');
    loadArchivedNotes(todayStr);
};

// --- Data Fetchers ---

async function loadArchivedNotes(date) {
    const body = $('archived-notes-body');
    if (!body) return;

    body.innerHTML = `
        <div class="flex items-center justify-center py-10 gap-3 text-gray-400">
            <i class="fas fa-spinner fa-spin text-2xl text-indigo-300"></i>
            <span class="text-sm">Cargando notas del ${date}...</span>
        </div>`;

    try {
        const notes = await ApiClient.get(`/notes/archived?date=${date}`);

        if (!notes || notes.length === 0) {
            body.innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-center">
                    <div class="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
                        <i class="fas fa-inbox text-2xl text-indigo-300"></i>
                    </div>
                    <h4 class="font-bold text-gray-700 mb-1">Sin notas para este día</h4>
                    <p class="text-sm text-gray-400">No se registraron anotaciones el <strong>${date}</strong>.</p>
                </div>`;
            return;
        }

        // Group by order_id
        const groups = {};
        notes.forEach(n => {
            if (!groups[n.order_id]) {
                groups[n.order_id] = { orderId: n.order_id, notes: [] };
            }
            groups[n.order_id].notes.push(n);
        });

        const totalCount = notes.length;
        const resolvedCount = notes.filter(n => n.resolved).length;

        // Summary Header
        body.innerHTML = `
            <div class="flex items-center justify-between mb-4 px-1">
                <div class="text-xs text-gray-500">
                    <span class="font-bold text-gray-700">${totalCount}</span> anotaciones —
                    <span class="text-[var(--system-primary)] font-bold">${resolvedCount} resueltas</span>,
                    <span class="text-yellow-600 font-semibold">${totalCount - resolvedCount} pendientes</span>
                </div>
            </div>`;

        // Render groups
        Object.values(groups).forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'bg-white rounded-xl border border-gray-200 shadow-sm mb-3 overflow-hidden';

            const resolvedInGroup = group.notes.filter(n => n.resolved).length;
            const allResolved = resolvedInGroup === group.notes.length;

            groupEl.innerHTML = `
                <div class="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-gray-800 text-sm">Pedido #${group.orderId}</span>
                        ${allResolved
                    ? '<span class="text-[10px] bg-[var(--system-primary)]/20 text-[var(--system-tertiary)] border border-[var(--system-primary)]/40 px-2 py-0.5 rounded-full font-semibold">Todo resuelto</span>'
                    : `<span class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-semibold">${group.notes.length - resolvedInGroup} pendiente(s)</span>`}
                    </div>
                    <span class="text-[10px] text-gray-400">${group.notes.length} nota(s)</span>
                </div>
                <div class="divide-y divide-gray-50">
                    ${group.notes.map(n => {
                        const dateStr = (n.created_at_fmt || n.created_at || '');
                        const timeStr = dateStr ? new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' }) : '';
                        return `
                        <div class="px-4 py-3 flex items-start gap-3">
                            <div class="flex-1">
                                <p class="text-sm ${n.resolved ? 'line-through text-gray-400' : 'text-gray-700'}">${n.note}</p>
                                <div class="flex items-center gap-2 mt-1 flex-wrap">
                                    <span class="text-[10px] text-gray-400">
                                        <i class="far fa-clock mr-1"></i>${timeStr}
                                    </span>
                                    <span class="text-[10px] text-gray-500">
                                        <i class="fas fa-user mr-1 opacity-60"></i>${n.created_by || n.waiter_name || 'Sistema'}
                                    </span>
                                </div>
                            </div>
                            <div class="flex-shrink-0 mt-0.5">
                                ${n.resolved
                                ? '<span class="inline-flex items-center gap-1 text-[10px] bg-[var(--system-primary)]/20 text-[var(--system-tertiary)] border border-[var(--system-primary)]/40 px-2 py-1 rounded-full font-semibold"><i class="fas fa-check-circle text-[var(--system-primary)]"></i> Resuelto</span>'
                                : '<span class="inline-flex items-center gap-1 text-[10px] bg-yellow-50 text-yellow-700 border border-yellow-200 px-2 py-1 rounded-full font-semibold"><i class="fas fa-clock"></i> Pendiente</span>'}
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;

            body.appendChild(groupEl);
        });

    } catch (e) {
        console.error('Error loading archived notes:', e);
        body.innerHTML = `
            <div class="text-center text-red-400 py-10">
                <i class="fas fa-exclamation-circle text-3xl mb-2 block"></i>
                <p class="text-sm">Error cargando notas archivadas.</p>
            </div>`;
    }
}


async function loadNotesHistory() {
    const tbody = $('notes-history-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4"><i class="fas fa-spinner fa-spin text-blue-500"></i></td></tr>';

    try {
        const notes = await ApiClient.get('/admin/notes-history');
        if (notes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">No hay historial de anotaciones</td></tr>';
            return;
        }

        tbody.innerHTML = notes.map(n => {
            const dateStr = (n.created_at || '').endsWith('Z') ? n.created_at : (n.created_at + 'Z');
            const dateFmt = new Date(dateStr).toLocaleString('es-CO', { timeZone: 'America/Bogota' });

            return `
            <tr class="hover:bg-gray-50 transition">
                <td class="px-6 py-4 whitespace-nowrap text-gray-500">${dateFmt}</td>
                <td class="px-6 py-4 font-medium text-gray-900">#${n.order_id}</td>
                <td class="px-6 py-4 text-gray-700">${n.created_by || n.waiter_name || 'Sistema'}</td>
                <td class="px-6 py-4 text-gray-700">${n.note}</td>
                <td class="px-6 py-4">
                    ${n.resolved
                    ? '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-[var(--system-primary)]/20 text-[var(--system-tertiary)] border border-[var(--system-primary)]/40">Resuelto</span>'
                    : '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">Pendiente</span>'}
                </td>
                <td class="px-6 py-4 text-center">
                    <button onclick="deleteNoteLog(${n.id})" class="text-gray-400 hover:text-red-500 transition" title="Eliminar del historial">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `}).join('');
    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Error cargando historial</td></tr>';
    }
}

window.deleteNoteLog = async (id) => {
    // Custom confirm modal is better, but native confirm is fast for now as per other parts using confirms? 
    // Actually admin-view uses showConfirmModal. Let's reuse it if possible.
    // But `showConfirmModal` expects a callback.
    // Window function limitations.
    // Let's use native confirm for simplicity as it's inside a window generic function, OR import showConfirmModal.
    // It is imported at top.

    // Check if showConfirmModal is available globally or we use the imported one.
    // Since this is a module, I can use the imported `showConfirmModal`.
    // BUT `onclick="deleteNoteLog(...)` executes in global scope.
    // So `deleteNoteLog` needs to call `showConfirmModal` which is in module scope??
    // No, `window.deleteNoteLog` is defined here, so it closes over `showConfirmModal`.
    // It should work.

    showConfirmModal("Eliminar Anotación", "¿Eliminar esta anotación del historial?", async () => {
        try {
            await ApiClient.delete(`/admin/notes-history/${id}`);
            loadNotesHistory();
            toast("Anotación eliminada", "success");
        } catch (e) {
            console.error(e);
            toast("Error al eliminar", "error");
        }
    });
};

export async function loadTasks() {
    const list = $('tasks-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin text-orange-500"></i></div>';

    try {
        const tasks = await ApiClient.get('/admin/tasks');
        if (tasks.length === 0) {
            list.innerHTML = '<div class="text-center text-gray-400 py-4 text-xs">No hay tareas pendientes</div>';
            return;
        }

        list.innerHTML = tasks.map(t => `
            <li class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl group hover:bg-white hover:shadow-sm transition border border-transparent hover:border-orange-100">
                <input type="checkbox" onchange="toggleTask(${t.id}, this.checked)" ${t.status === 'done' ? 'checked' : ''} class="w-4 h-4 text-orange-500 rounded focus:ring-orange-500 cursor-pointer accent-orange-500">
                <span class="flex-1 text-xs md:text-sm ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700 font-medium'}">${t.description}</span>
                ${t.due_date ? `<span class="text-[11px] text-gray-400 whitespace-nowrap"><i class="far fa-clock mr-1 text-orange-400"></i>${new Date(t.due_date).toLocaleDateString()}</span>` : ''}
                <button onclick="deleteTask(${t.id})" class="text-gray-300 hover:text-red-500 opacity-60 group-hover:opacity-100 transition p-1" title="Eliminar tarea"><i class="fas fa-trash-alt text-xs"></i></button>
            </li>
        `).join('');

        // Expose functions globally
        window.toggleTask = async (id, completed) => {
            try {
                await ApiClient.patch(`/admin/tasks/${id}`, { completed });
                loadTasks(); // Reload to sort or update styles
            } catch (e) { console.error(e); }
        };

        window.deleteTask = (id) => {
            showConfirmModal("Borrar Tarea", "¿Estás seguro de eliminar esta tarea?", async () => {
                try {
                    await ApiClient.delete(`/admin/tasks/${id}`);
                    loadTasks();
                    toast("Tarea eliminada", "success");
                } catch (e) { console.error(e); }
            });
        };

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="text-center text-red-400 py-4 text-xs">Error cargando tareas</div>';
    }
}
window.loadTasks = loadTasks;

export async function loadReservations() {
    const list = $('reservations-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin text-emerald-500"></i></div>';

    try {
        // Fetch all (or filter by date range if optimized later)
        cachedReservations = await ApiClient.get('/admin/reservations');
        renderCalendar();
        renderReservationsList();
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="text-center text-red-400 py-4 text-xs">Error cargando reservas</div>';
    }
}
window.loadReservations = loadReservations;
// Sync hooks for the Vue ReservationsPanel (keeps legacy calendar/modals in sync)
window._setCachedReservations = (r) => { cachedReservations = r || []; };
window._refreshReservationsCalendar = () => { renderCalendar(); };

function renderReservationsList() {
    const list = $('reservations-list');
    if (!list) return;

    const sorted = [...cachedReservations].sort((a, b) => new Date(a.reservation_date) - new Date(b.reservation_date));

    if (sorted.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-400 text-xs py-6">No hay reservas registradas</div>';
        return;
    }

    list.innerHTML = sorted.map(r => {
        const dateStr = new Date(r.reservation_date).toLocaleString('es-CO', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        return `
        <div class="p-3.5 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-200 transition-all relative group">
            <!-- Info -->
            <div class="flex justify-between items-start mb-1 pr-7">
                <h4 class="font-bold text-gray-800 text-sm leading-tight">${r.client_name}</h4>
                <span class="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold shrink-0">${r.pax || '?'} pers.</span>
            </div>
            <div class="text-xs text-emerald-600 flex items-center gap-1 mb-0.5">
                <i class="fas fa-clock text-[10px]"></i> ${dateStr}
            </div>
            ${r.table_num ? `<div class="text-[10px] text-gray-500"><i class="fas fa-chair mr-1 text-gray-400"></i>Mesa ${r.table_num}</div>` : ''}
            ${r.observation ? `<div class="text-[10px] text-gray-500 truncate mt-0.5"><i class="fas fa-sticky-note mr-1 text-gray-400"></i>${r.observation}</div>` : ''}

            <!-- 3-Dots Action Dropdown Menu -->
            <div class="absolute top-3 right-3 flex items-center">
                <div class="relative inline-block text-left table-action-container">
                    <button type="button" class="table-action-trigger w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                        <i class="fas fa-ellipsis-v text-xs"></i>
                    </button>
                    <div class="table-action-menu hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                        <button type="button" onclick="viewReservation(${r.id})" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors">
                            <i class="fas fa-eye w-4 text-center"></i> <span>Ver Detalle</span>
                        </button>
                        <button type="button" onclick="editReservation(${r.id})" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-amber-600 hover:bg-amber-50 transition-colors">
                            <i class="fas fa-pen w-4 text-center"></i> <span>Editar</span>
                        </button>
                        <button type="button" onclick="deleteReservation(${r.id})" class="w-full text-left px-3 py-1.5 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors">
                            <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `}).join('');
}

// MUST be window.* — called from inline onclick inside innerHTML (ES6 module scope)
window.viewReservation = (id) => {
    const r = cachedReservations.find(r => r.id === id);
    if (!r) return;

    const fmt = (d) => new Date(d).toLocaleString('es-CO', {
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    $('vr-client-name').textContent = r.client_name;
    $('vr-date').textContent = fmt(r.reservation_date);
    $('vr-pax').textContent = r.pax ? `${r.pax} personas` : '—';
    $('vr-table').textContent = r.table_num || 'No asignada';
    $('vr-phone').textContent = r.phone || 'No registrado';
    $('vr-observation').textContent = r.observation || 'Ninguna';

    openModal('modal-view-reservation');
};

window.editReservation = (id) => {
    const r = cachedReservations.find(r => r.id === id);
    if (!r) return;

    $('edit-reservation-id').value = r.id;
    $('edit-rv-client').value = r.client_name || '';
    $('edit-rv-phone').value = r.phone || '';
    $('edit-rv-table').value = r.table_num || '';
    $('edit-rv-pax').value = r.pax || '';
    $('edit-rv-observation').value = r.observation || '';
    // Format reservation_date as datetime-local value (YYYY-MM-DDTHH:MM)
    const d = new Date(r.reservation_date);
    const pad = (n) => String(n).padStart(2, '0');
    $('edit-rv-date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    openModal('modal-edit-reservation');
};

// MUST be window.* because it's called from inline onclick inside innerHTML
window.deleteReservation = async (id) => {
    if (!id) return;
    showConfirmModal('Eliminar Reserva', '¿Eliminar esta reserva? No se puede deshacer.', async () => {
        try {
            await ApiClient.delete(`/admin/reservations/${id}`);
            // Remove from cache and re-render without a full network request
            cachedReservations = cachedReservations.filter(r => r.id !== id);
            renderReservationsList();
            renderCalendar();
            toast('Reserva eliminada', 'success');
        } catch (e) {
            console.error('Error deleting reservation:', e);
            toast('Error eliminando la reserva', 'error');
        }
    });
};


function renderCalendar() {
    const grid = $('calendar-grid');
    const monthLabel = $('current-month-label');
    if (!grid || !monthLabel) return;

    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth(); // 0-indexed

    // Update Label
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    monthLabel.innerText = `${monthNames[month]} ${year}`;

    // Calendar Logic
    const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = '';

    // Empty cells for previous month days
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="p-2"></div>`;
    }

    // Days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Check for reservations on this day
        // Note: reservation_date is ISO timestamp, need to match YYYY-MM-DD
        const hasReservation = cachedReservations.some(r => r.reservation_date.startsWith(dateStr));
        const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();

        let classes = "h-14 md:h-24 border rounded-lg p-1 flex flex-col justify-between hover:bg-amber-50/50 transition cursor-pointer relative";
        if (isToday) classes += " ring-2 ring-[var(--system-primary)]";
        if (hasReservation) classes += " bg-amber-50/80 hover:bg-amber-100 border-[var(--system-primary)]";
        else classes += " bg-white border-gray-100";

        // Count reservations for badge
        const count = cachedReservations.filter(r => r.reservation_date.startsWith(dateStr)).length;

        html += `
        <div class="${classes}" onclick="window.openNewReservationForDate('${dateStr}')" title="Crear reserva para el ${dateStr}">
            <span class="text-xs font-bold ${isToday ? 'text-[var(--system-primary)] font-black' : 'text-gray-700'}">${day}</span>
            ${count > 0 ? `
            <div class="flex flex-col gap-0.5 mt-1 overflow-hidden">
                <div class="text-[9px] bg-[var(--system-tertiary)] text-[var(--system-primary)] font-bold px-1.5 py-0.5 rounded-full w-fit max-w-full truncate shadow-sm">
                    ${count} Res.
                </div>
            </div>` : ''}
        </div>
        `;
    }

    grid.innerHTML = html;
}

window.openNewReservationForDate = (dateStr) => {
    openModal('modal-add-reservation');
    const dtInput = document.querySelector('#form-reservation input[name="reservation_date"]');
    if (dtInput) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        dtInput.value = `${dateStr}T${hh}:${mm}`;
    }
};

