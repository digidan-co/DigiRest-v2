import { $, escapeHtml } from '../utils/helpers.js';

export const showImageModal = (src) => {
    let modal = document.getElementById('image-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'image-modal';
        modal.className = 'fixed inset-0 bg-black/90 z-[100] hidden flex justify-center items-center p-4 backdrop-blur-sm cursor-pointer';
        modal.onclick = () => modal.classList.add('hidden');
        modal.innerHTML = `<img id="image-modal-img" src="" alt="Vista ampliada del comprobante" loading="lazy" class="max-w-full max-h-full rounded-lg shadow-2xl scale-in">`;
        document.body.appendChild(modal);
    }
    modal.querySelector('#image-modal-img').src = src;
    modal.classList.remove('hidden');
};

export const showConfirmModal = (title, msg, onConfirm, onCancel = null, okText = "Eliminar") => {
    let modal = document.getElementById('confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'fixed inset-0 bg-black/60 z-[80] hidden flex justify-center items-center px-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-full max-w-sm rounded-3xl shadow-2xl p-6 slide-up bg-white text-center">
                <div class="text-4xl mb-4"><i class="fas fa-exclamation-triangle text-orange-500"></i></div>
                <h3 id="confirm-modal-title" class="font-bold text-xl text-gray-800 mb-2"></h3>
                <p id="confirm-modal-msg" class="text-sm text-gray-500 mb-6"></p>
                <div class="flex gap-3 justify-center">
                    <button id="confirm-modal-cancel" class="px-6 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">Cancelar</button>
                    <button id="confirm-modal-ok" class="px-6 py-2 rounded-xl bg-gray-900 text-white hover:bg-black transition-colors shadow-lg">Eliminar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#confirm-modal-title');
    const msgEl = modal.querySelector('#confirm-modal-msg');
    const cancelBtn = modal.querySelector('#confirm-modal-cancel');
    const okBtn = modal.querySelector('#confirm-modal-ok');

    titleEl.innerText = title;
    msgEl.innerText = msg;
    okBtn.innerText = okText;

    // Change button color based on action (red for delete, blue/black for others)
    if (okText === 'Eliminar') {
        okBtn.className = "px-6 py-2 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-200";
    } else {
        okBtn.className = "px-6 py-2 rounded-xl bg-gray-900 text-white hover:bg-black transition-colors shadow-lg";
    }

    const newCancel = cancelBtn.cloneNode(true);
    const newOk = okBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    okBtn.parentNode.replaceChild(newOk, okBtn);

    newCancel.onclick = () => {
        modal.classList.add('hidden');
        if (onCancel) onCancel();
    };
    newOk.onclick = () => {
        modal.classList.add('hidden');
        onConfirm();
    };

    modal.classList.remove('hidden');
};

export const showPromptModal = (title, msg, placeholder, onConfirm, options = {}) => {
    const requireAdminAuth = options.requireAdminAuth || false;

    let modal = document.getElementById('prompt-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'prompt-modal';
        modal.className = 'fixed inset-0 bg-black/60 z-[80] hidden flex justify-center items-center px-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div id="prompt-modal-inner" class="glass-panel w-full max-w-sm rounded-3xl shadow-2xl p-6 slide-up bg-white text-center">
                <h3 id="prompt-modal-title" class="font-bold text-xl text-gray-800 mb-2"></h3>
                <p id="prompt-modal-msg" class="text-sm text-gray-500 mb-4"></p>
                <div class="mb-6 text-left">
                    <input type="text" id="prompt-modal-input" class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all shadow-sm" placeholder="">
                    <p id="prompt-modal-error" class="hidden text-xs text-red-500 mt-2 font-medium">¡Debes ingresar un motivo!</p>
                </div>
                <div id="prompt-admin-auth" class="hidden mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                    <p class="text-xs font-bold text-gray-500 uppercase tracking-wider">Autorización de Administrador</p>
                    <input type="hidden" id="prompt-admin-user" value="">
                    <div>
                        <label class="text-[10px] font-bold text-gray-400 uppercase ml-1">Código de Administrador</label>
                        <input type="password" id="prompt-admin-code" class="w-full px-3 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm text-sm" placeholder="Ingresa el código del admin" autocomplete="off">
                    </div>
                    <p id="prompt-admin-error" class="hidden text-xs text-red-500 mt-1 font-medium">Credenciales de administrador incorrectas</p>
                </div>
                <div class="flex gap-3 justify-center">
                    <button id="prompt-modal-cancel" class="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-colors">Cancelar</button>
                    <button id="prompt-modal-ok" class="flex-1 px-4 py-3 rounded-xl bg-red-600 text-white font-bold hover:bg-red-700 shadow-lg shadow-red-200 transition-transform active:scale-95">Anular</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#prompt-modal-title');
    const msgEl = modal.querySelector('#prompt-modal-msg');
    const inputEl = modal.querySelector('#prompt-modal-input');
    const errorEl = modal.querySelector('#prompt-modal-error');
    const cancelBtn = modal.querySelector('#prompt-modal-cancel');
    const okBtn = modal.querySelector('#prompt-modal-ok');
    const adminAuthDiv = modal.querySelector('#prompt-admin-auth');
    const adminUserInput = modal.querySelector('#prompt-admin-user');
    const adminCodeInput = modal.querySelector('#prompt-admin-code');
    const adminErrorEl = modal.querySelector('#prompt-admin-error');

    titleEl.innerText = title;
    msgEl.innerText = msg;
    inputEl.placeholder = placeholder;
    inputEl.value = '';
    errorEl.classList.add('hidden');

    // Toggle admin auth section visibility
    if (requireAdminAuth) {
        adminAuthDiv.classList.remove('hidden');
        adminCodeInput.value = '';
        adminErrorEl.classList.add('hidden');

        // Auto-fetch admin user list and populate hidden field with first admin
        (async () => {
            try {
                const token = localStorage.getItem('pos_token') || '';
                const res = await fetch('/api/auth/admin-identities', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const admins = await res.json();
                if (Array.isArray(admins) && admins.length > 0) {
                    adminUserInput.value = admins[0].name;
                } else {
                    // Fallback: prompt to enter manually if no admin found
                    adminUserInput.value = '';
                }
            } catch (e) {
                console.error('Error fetching admin identities:', e);
                adminUserInput.value = '';
            }
        })();
    } else {
        adminAuthDiv.classList.add('hidden');
    }

    const newCancel = cancelBtn.cloneNode(true);
    const newOk = okBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    okBtn.parentNode.replaceChild(newOk, okBtn);

    newCancel.onclick = () => {
        modal.classList.add('hidden');
    };

    newOk.onclick = async () => {
        // Validate reason input
        if (!inputEl.value.trim()) {
            errorEl.classList.remove('hidden');
            inputEl.classList.add('border-red-500', 'bg-red-50');
            return;
        }
        errorEl.classList.add('hidden');
        inputEl.classList.remove('border-red-500', 'bg-red-50');

        // If admin auth required, verify credentials first
        if (requireAdminAuth) {
            const adminCode = adminCodeInput.value.trim();

            if (!adminCode) {
                adminErrorEl.textContent = 'Debes ingresar el código de administrador';
                adminErrorEl.classList.remove('hidden');
                return;
            }

            // Disable button and show loading
            newOk.disabled = true;
            newOk.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';

            try {
                const response = await fetch('/api/auth/verify-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('pos_token') || '') },
                    body: JSON.stringify({ code: adminCode })
                });
                const data = await response.json();

                if (!data.valid) {
                    adminErrorEl.textContent = 'Credenciales de administrador incorrectas';
                    adminErrorEl.classList.remove('hidden');
                    newOk.disabled = false;
                    newOk.innerHTML = 'Anular';
                    adminCodeInput.value = '';
                    adminCodeInput.focus();
                    return;
                }

                adminErrorEl.classList.add('hidden');
            } catch (err) {
                adminErrorEl.textContent = 'Error al verificar administrador. Intenta de nuevo.';
                adminErrorEl.classList.remove('hidden');
                newOk.disabled = false;
                newOk.innerHTML = 'Anular';
                return;
            }
        }

        modal.classList.add('hidden');
        onConfirm(inputEl.value.trim());
    };

    inputEl.oninput = () => {
        errorEl.classList.add('hidden');
        inputEl.classList.remove('border-red-500', 'bg-red-50');
    };

    // Clear admin errors on input
    if (adminUserInput) {
        adminUserInput.oninput = () => adminErrorEl.classList.add('hidden');
    }
    if (adminCodeInput) {
        adminCodeInput.oninput = () => adminErrorEl.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
        if (requireAdminAuth) {
            adminCodeInput.focus();
        } else {
            inputEl.focus();
        }
    }, 100);
};

let toastTimeout; // Store timeout ID to clear it

export const toast = (msg, type = 'info') => {
    const t = $('toast');
    if (!t) return; // Guard if toast element doesn't exist yet
    const tMsg = $('toast-msg');
    tMsg.innerText = msg;

    // Reset classes
    // Mobile: top-0, w-full, rounded-none, text-xs. Desktop: top-5, w-auto, rounded-xl
    t.className = "fixed top-0 left-0 w-full md:w-auto md:top-5 md:left-1/2 md:-translate-x-1/2 bg-gray-900 text-white text-xs font-bold px-6 py-4 md:py-3 rounded-none md:rounded-xl shadow-2xl z-[100] transition-all duration-300 transform -translate-y-full opacity-0 flex items-center justify-center md:justify-start gap-3 pointer-events-none";

    // Clear any pending timeout from previous toasts
    if (toastTimeout) clearTimeout(toastTimeout);

    if (type === 'error') t.classList.add('bg-red-600');
    if (type === 'success') t.classList.add('bg-[#1e2122]', 'text-[var(--system-primary)]', 'border', 'border-[var(--system-primary)]/40');

    // Show
    requestAnimationFrame(() => {
        t.classList.remove('opacity-0', '-translate-y-full', 'pointer-events-none');
    });

    // Hide after 3s with proper cleanup
    toastTimeout = setTimeout(() => {
        t.classList.add('opacity-0', '-translate-y-full', 'pointer-events-none');
        // Additional cleanup to ensure visibility:hidden after animation
        setTimeout(() => {
            if (t.classList.contains('opacity-0')) {
                t.style.visibility = 'hidden';
            }
        }, 300); // Match transition duration
    }, 3000);

    // Ensure it's visible when showing
    t.style.visibility = 'visible';
};

export function showModalAlert(title, msg, type = 'info') {
    let modal = document.getElementById('generic-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'generic-modal';
        modal.className = 'fixed inset-0 bg-black/60 z-[60] hidden flex justify-center items-center px-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel z w-full max-w-sm rounded-3xl shadow-2xl p-6 slide-up bg-white text-center">
                <div id="generic-modal-icon" class="text-4xl mb-4"></div>
                <h3 id="generic-modal-title" class="font-bold text-xl text-gray-800 mb-2"></h3>
                <p id="generic-modal-msg" class="text-sm text-gray-500 mb-6"></p>
                <button onclick="document.getElementById('generic-modal').classList.add('hidden')" 
                    class="bg-gray-900 text-white px-6 py-2 rounded-xl hover:scale-105 transition-transform">Entendido</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const icon = modal.querySelector('#generic-modal-icon');
    const titleEl = modal.querySelector('#generic-modal-title');
    const msgEl = modal.querySelector('#generic-modal-msg');

    titleEl.innerText = title;
    msgEl.innerText = msg;

    if (type === 'error') icon.innerHTML = '<i class="fas fa-exclamation-circle text-red-500"></i>';
    else if (type === 'success') icon.innerHTML = '<i class="fas fa-check-circle text-[var(--system-primary)]"></i>';
    else icon.innerHTML = '<i class="fas fa-info-circle text-blue-500"></i>';

    modal.classList.remove('hidden');
}

export function setLoading(btnId, isLoading, text) {
    const btn = $(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalText = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
        btn.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
        btn.disabled = false;
        btn.innerText = btn.dataset.originalText || text;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
    }
}

/**
/**
 * Show order notification banner on the bottom right side
 * Background with system primary color, text/icon with system secondary, no shadow.
 * Appears smoothly from right, stays in view, then disappears smoothly.
 * @param {string} orderId - The ID of the new order
 */
export function showOrderNotification(orderId) {
    // Remove any previous banner to prevent duplicates
    const oldBanner = document.getElementById('incoming-order-banner');
    if (oldBanner) oldBanner.remove();

    // Ensure any active top toast is cancelled and hidden immediately
    if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
    }
    const topToast = document.getElementById('toast');
    if (topToast) {
        topToast.classList.add('opacity-0', '-translate-y-full', 'pointer-events-none');
        topToast.style.visibility = 'hidden';
    }

    const notif = document.createElement('div');
    notif.id = 'incoming-order-banner';
    notif.className = 'order-incoming-banner w-[92%] sm:w-auto max-w-sm sm:max-w-md rounded-2xl px-5 py-4 flex items-center justify-between gap-4 pointer-events-auto';
    // Exact position: bottom-right separated 1rem from viewport edges
    notif.style.position = 'fixed';
    notif.style.bottom = '1rem';
    notif.style.right = '1rem';
    notif.style.top = 'auto';
    notif.style.left = 'auto';
    notif.style.zIndex = '99999';
    notif.style.margin = '0';
    notif.style.boxShadow = 'none';
    notif.style.border = 'none';
    notif.style.transform = 'translateX(130%)';
    notif.style.opacity = '0';
    notif.style.transition = 'transform 1.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 1.2s ease-out';

    notif.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background-color: color-mix(in srgb, var(--system-secondary, #1e2122) 15%, transparent); color: var(--system-secondary, #1e2122);">
                <i class="fas fa-bell text-lg"></i>
            </div>
            <div class="min-w-0" style="color: var(--system-secondary, #1e2122);">
                <div class="font-bold text-sm leading-tight truncate">¡Nuevo Pedido Entrante!</div>
                <div class="text-xs font-semibold mt-0.5 truncate opacity-90">Pedido #${escapeHtml(String(orderId))}</div>
            </div>
        </div>
        <button type="button" id="btn-close-order-banner" 
            class="px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 active:scale-95 cursor-pointer"
            style="background-color: color-mix(in srgb, var(--system-secondary, #1e2122) 15%, transparent); color: var(--system-secondary, #1e2122);">
            Cerrar
        </button>
    `;

    document.body.appendChild(notif);

    // Animación suave de entrada deslizándose desde la derecha
    requestAnimationFrame(() => {
        notif.style.transform = 'translateX(0)';
        notif.style.opacity = '1';
    });

    let timer;
    const dismiss = () => {
        if (timer) clearTimeout(timer);
        // Animación suave de salida deslizándose hacia la derecha
        notif.style.transition = 'transform 1.2s cubic-bezier(0.7, 0, 0.84, 0), opacity 1.2s ease-in';
        notif.style.transform = 'translateX(130%)';
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 1250);
    };

    const closeBtn = notif.querySelector('#btn-close-order-banner');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    // Permanece visible 4.5 segundos antes de comenzar su animación de salida suave
    timer = setTimeout(dismiss, 5700);
}
