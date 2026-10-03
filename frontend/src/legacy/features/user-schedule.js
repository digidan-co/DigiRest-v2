/**
 * DigiRest - User Schedule Feature Module
 * Manages work shifts, weekly/monthly hours, restriction toggle, and schedule modal.
 */

import { $, escapeHtml } from '../utils/helpers.js';
import { ApiClient } from '../services/api-client.js';
import { toast, showModalAlert } from '../components/ui.js';

let _currentModalShifts = [];
let _usersCache = [];
let _reloadUsersCallback = null;

const DAY_MAP = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };

/**
 * Set the cached users list so the modal can look up user information
 */
export function setUserScheduleUsersCache(users) {
    _usersCache = Array.isArray(users) ? users : [];
}

/**
 * Formats user work schedule for display in admin users table
 */
export function formatScheduleSummary(raw) {
    if (!raw) return '<span class="text-gray-400 text-xs italic">Sin horario asignado</span>';
    let s = raw;
    if (typeof s === 'string') {
        try { s = JSON.parse(s); } catch (e) { return '<span class="text-gray-400 text-xs italic">Sin horario</span>'; }
    }
    if (!s || s.enabled === false) {
        return '<span class="text-gray-400 text-xs italic">Sin restricción</span>';
    }

    let shifts = [];
    if (Array.isArray(s.shifts) && s.shifts.length > 0) {
        shifts = s.shifts;
    } else if (Array.isArray(s.days) && s.days.length > 0) {
        shifts = [{ name: 'Jornada Principal', days: s.days, start_time: s.start_time, end_time: s.end_time }];
    }

    if (shifts.length === 0) {
        return '<span class="text-[var(--system-primary)] text-xs font-semibold">Restricción activa (Sin jornadas)</span>';
    }

    return `
        <div class="flex flex-col gap-1">
            ${shifts.map(shift => {
                const daysStr = (shift.days || []).map(d => DAY_MAP[d] || d).join(', ');
                const hoursStr = (shift.start_time && shift.end_time) ? `${shift.start_time} - ${shift.end_time}` : '';
                return `
                    <div class="flex flex-col leading-tight">
                        <span class="font-bold text-gray-800 text-xs flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-[var(--system-primary)]"></span>
                            <span>${escapeHtml(shift.name || 'Jornada')}:</span>
                            <span class="text-[var(--system-primary)] font-bold">${hoursStr}</span>
                        </span>
                        <span class="text-[10px] text-gray-500 pl-2.5 font-medium">${daysStr}</span>
                    </div>
                `;
            }).join('')}
            ${s.weekly_hours ? `<span class="text-[9px] text-gray-400 pl-2.5">${s.weekly_hours}h/sem</span>` : ''}
        </div>
    `;
}

/**
 * Renders shifts inside the user schedule modal
 */
export function renderModalShifts() {
    const list = $('sched-shifts-list');
    const countBadge = $('sched-shifts-count');
    if (!list) return;

    if (countBadge) {
        countBadge.innerText = `${_currentModalShifts.length} ${_currentModalShifts.length === 1 ? 'jornada' : 'jornadas'}`;
    }

    if (_currentModalShifts.length === 0) {
        list.innerHTML = `
            <div class="text-center py-4 px-3 bg-white rounded-xl border border-dashed border-gray-200 text-gray-400 text-xs">
                <i class="fas fa-calendar-times text-base mb-1 text-gray-300"></i>
                <p class="font-medium">No hay jornadas configuradas aún.</p>
                <p class="text-[10px] text-gray-400 mt-0.5">Usa el formulario de abajo para agregar la primera jornada.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = _currentModalShifts.map((shift) => {
        const daysStr = (shift.days || []).map(d => DAY_MAP[d] || d).join(', ');
        return `
            <div class="flex items-center justify-between p-2.5 rounded-xl border border-gray-200 bg-white hover:border-[var(--system-primary)]/50 transition-all shadow-2xs">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-7 h-7 rounded-lg bg-[var(--system-primary)] text-[var(--system-secondary)] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                        <i class="fas fa-clock text-[11px] text-[var(--system-secondary)]"></i>
                    </span>
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <h5 class="font-bold text-xs text-gray-800 truncate">${escapeHtml(shift.name || 'Jornada')}</h5>
                        </div>
                        <p class="text-[11px] text-gray-500 font-medium truncate">
                            <span class="text-blue-600 font-bold">${daysStr || 'Sin días'}</span> • <span class="font-mono text-gray-700">${shift.start_time} - ${shift.end_time}</span>
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0 ml-2">
                    <button type="button" onclick="editModalShift('${shift.id}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer" title="Editar jornada">
                        <i class="fas fa-edit text-xs"></i>
                    </button>
                    <button type="button" onclick="deleteModalShift('${shift.id}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors cursor-pointer" title="Eliminar jornada">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Resets the shift sub-form inside the modal
 */
export function clearShiftForm() {
    if ($('sched-shift-id')) $('sched-shift-id').value = '';
    if ($('sched-shift-name')) $('sched-shift-name').value = '';
    if ($('sched-start-time')) $('sched-start-time').value = '08:00';
    if ($('sched-end-time')) $('sched-end-time').value = '18:00';
    document.querySelectorAll('.sched-day-pill').forEach(btn => btn.classList.remove('active'));
    if ($('sched-shift-title')) $('sched-shift-title').innerHTML = '<i class="fas fa-plus-circle text-[var(--system-primary)]"></i> <span>Agregar Nueva Jornada</span>';
    if ($('btn-add-shift-text')) $('btn-add-shift-text').innerText = 'Guardar Jornada en la lista';
    if ($('btn-cancel-edit-shift')) $('btn-cancel-edit-shift').classList.add('hidden');
}

/**
 * Pre-populates shift form for editing
 */
export function editModalShift(shiftId) {
    const shift = _currentModalShifts.find(s => s.id === shiftId);
    if (!shift) return;

    if ($('sched-shift-id')) $('sched-shift-id').value = shift.id;
    if ($('sched-shift-name')) $('sched-shift-name').value = shift.name || '';
    if ($('sched-start-time')) $('sched-start-time').value = shift.start_time || '08:00';
    if ($('sched-end-time')) $('sched-end-time').value = shift.end_time || '18:00';

    const days = shift.days || [];
    document.querySelectorAll('.sched-day-pill').forEach(btn => {
        const d = parseInt(btn.dataset.day, 10);
        btn.classList.toggle('active', days.includes(d));
    });

    if ($('sched-shift-title')) $('sched-shift-title').innerHTML = '<i class="fas fa-edit text-[var(--system-primary)]"></i> <span>Editar Jornada</span>';
    if ($('btn-add-shift-text')) $('btn-add-shift-text').innerText = 'Actualizar Jornada';
    if ($('btn-cancel-edit-shift')) $('btn-cancel-edit-shift').classList.remove('hidden');
}

/**
 * Removes a shift from list
 */
export function deleteModalShift(shiftId) {
    _currentModalShifts = _currentModalShifts.filter(s => s.id !== shiftId);
    renderModalShifts();
    if ($('sched-shift-id') && $('sched-shift-id').value === shiftId) {
        clearShiftForm();
    }
}

/**
 * Opens user schedule configuration modal
 */
export function openUserScheduleModal(userOrId) {
    let user = null;
    if (userOrId && typeof userOrId === 'object') {
        user = userOrId;
    } else {
        const pool = (_usersCache && _usersCache.length ? _usersCache : (window._adminUsersCache || []));
        user = pool.find(u => String(u.id) === String(userOrId));
    }

    if (!user) {
        console.warn('⚠️ Usuario no encontrado para modal de jornada laboral:', userOrId);
        return;
    }

    if ($('sched-user-id')) $('sched-user-id').value = user.id;
    const roleMap = {
        'admin': 'Administrador',
        'supervisor': 'Supervisor',
        'cajero': 'Cajero',
        'chef': 'Chef / Cocinero',
        'delivery': 'Repartidor',
        'mesero': 'Mesero'
    };
    if ($('schedule-user-info')) {
        $('schedule-user-info').innerText = `${user.name || user.username} • Rol: ${roleMap[user.role] || user.role}`;
    }

    let schedule = null;
    if (user.work_schedule) {
        try {
            schedule = typeof user.work_schedule === 'string' ? JSON.parse(user.work_schedule) : user.work_schedule;
        } catch (e) {
            console.error('Error parsing user work_schedule:', e);
        }
    }

    const enabled = schedule ? !!schedule.enabled : false;
    if ($('sched-enabled')) $('sched-enabled').checked = enabled;

    // Load shifts list
    if (schedule && Array.isArray(schedule.shifts) && schedule.shifts.length > 0) {
        _currentModalShifts = schedule.shifts.map((s, idx) => ({ ...s, id: s.id || `shift_${Date.now()}_${idx}` }));
    } else if (schedule && Array.isArray(schedule.days) && schedule.days.length > 0) {
        _currentModalShifts = [{
            id: `shift_${Date.now()}_0`,
            name: 'Jornada Principal',
            days: schedule.days,
            start_time: schedule.start_time || '08:00',
            end_time: schedule.end_time || '18:00'
        }];
    } else {
        _currentModalShifts = [];
    }

    renderModalShifts();
    clearShiftForm();


    const modal = $('modal-user-schedule');
    if (modal) modal.classList.remove('hidden');
}

/**
 * Closes user schedule modal
 */
export function closeUserScheduleModal() {
    const modal = $('modal-user-schedule');
    if (modal) modal.classList.add('hidden');
    clearShiftForm();
}

/**
 * Setup listeners for the schedule modal buttons, form submission, and day pills
 */
export function setupUserScheduleListeners(reloadUsersCallback) {
    if (reloadUsersCallback) {
        _reloadUsersCallback = reloadUsersCallback;
    }

    // Close & Cancel buttons
    if ($('btn-close-schedule-modal')) {
        $('btn-close-schedule-modal').onclick = closeUserScheduleModal;
    }
    if ($('btn-cancel-schedule')) {
        $('btn-cancel-schedule').onclick = closeUserScheduleModal;
    }

    // Toggle day pills
    document.addEventListener('click', (e) => {
        const dayBtn = e.target.closest('.sched-day-pill');
        if (dayBtn) {
            dayBtn.classList.toggle('active');
        }
    });

    // Add or update shift in local list
    if ($('btn-add-shift')) {
        $('btn-add-shift').onclick = () => {
            const name = ($('sched-shift-name')?.value || '').trim();
            if (!name) {
                showModalAlert("Atención", "Por favor ingresa un nombre para identificar la jornada (ej: Principal Hector, Fin de semana Hector)", "warning");
                $('sched-shift-name')?.focus();
                return;
            }

            const selectedDays = Array.from(document.querySelectorAll('.sched-day-pill.active'))
                .map(b => parseInt(b.dataset.day, 10));

            if (selectedDays.length === 0) {
                showModalAlert("Atención", "Por favor selecciona al menos un día laboral para esta jornada.", "warning");
                return;
            }

            const startTime = $('sched-start-time')?.value;
            const endTime = $('sched-end-time')?.value;
            if (!startTime || !endTime) {
                showModalAlert("Atención", "Por favor ingresa la hora de inicio y de fin.", "warning");
                return;
            }

            const editingId = $('sched-shift-id')?.value;
            if (editingId) {
                const target = _currentModalShifts.find(s => s.id === editingId);
                if (target) {
                    target.name = name;
                    target.days = selectedDays;
                    target.start_time = startTime;
                    target.end_time = endTime;
                }
                toast(`Jornada "${name}" actualizada`, "success");
            } else {
                _currentModalShifts.push({
                    id: `shift_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                    name,
                    days: selectedDays,
                    start_time: startTime,
                    end_time: endTime
                });
                toast(`Jornada "${name}" agregada a la lista`, "success");
            }

            renderModalShifts();
            clearShiftForm();
        };
    }

    // Cancel editing
    if ($('btn-cancel-edit-shift')) {
        $('btn-cancel-edit-shift').onclick = clearShiftForm;
    }

    // Submit schedule form to server
    if ($('form-user-schedule')) {
        $('form-user-schedule').onsubmit = async (e) => {
            e.preventDefault();
            const userId = $('sched-user-id')?.value;
            if (!userId) return;

            const enabled = $('sched-enabled')?.checked;

            // Auto-add shift if user typed a name and selected days but didn't click "+ Guardar Jornada"
            const pendingName = ($('sched-shift-name')?.value || '').trim();
            const pendingDays = Array.from(document.querySelectorAll('.sched-day-pill.active')).map(b => parseInt(b.dataset.day, 10));
            if (pendingName && pendingDays.length > 0) {
                const editingId = $('sched-shift-id')?.value;
                if (editingId) {
                    const target = _currentModalShifts.find(s => s.id === editingId);
                    if (target) {
                        target.name = pendingName;
                        target.days = pendingDays;
                        target.start_time = $('sched-start-time')?.value || '08:00';
                        target.end_time = $('sched-end-time')?.value || '18:00';
                    }
                } else {
                    _currentModalShifts.push({
                        id: `shift_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        name: pendingName,
                        days: pendingDays,
                        start_time: $('sched-start-time')?.value || '08:00',
                        end_time: $('sched-end-time')?.value || '18:00'
                    });
                }
            }

            if (enabled && _currentModalShifts.length === 0) {
                showModalAlert("Atención", "Has activado el Control de Acceso por Horario, pero no has agregado ninguna jornada laboral. Agrega al menos una jornada.", "warning");
                return;
            }

            const schedulePayload = {
                enabled,
                shifts: _currentModalShifts
            };

            try {
                await ApiClient.post(`/users/${userId}/schedule`, { schedule: schedulePayload });
                toast("Horario laboral y jornadas guardados correctamente", "success");
                closeUserScheduleModal();
                if (window.reloadUsersPanel) {
                    window.reloadUsersPanel();
                }
                window.dispatchEvent(new CustomEvent('users-refresh'));
                if (_reloadUsersCallback) {
                    _reloadUsersCallback();
                }
            } catch (err) {
                console.error(err);
                showModalAlert("Error", "No se pudo guardar el horario laboral: " + (err.message || 'Error desconocido'), "error");
            }
        };
    }
}

// Bind to window for HTML inline calls (onclick="...")
window.openUserScheduleModal = openUserScheduleModal;
window.closeUserScheduleModal = closeUserScheduleModal;
window.editModalShift = editModalShift;
window.deleteModalShift = deleteModalShift;
window.formatScheduleSummary = formatScheduleSummary;
