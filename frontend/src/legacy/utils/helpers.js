export const $ = (id) => document.getElementById(id);
export const formatMoney = (num) => '$' + Number(num).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const getStatusBadge = (status) => {
    let classes = 'bg-gray-100 text-gray-600'; // Default
    if (status === 'Pendiente') classes = 'bg-white text-gray-600 border border-gray-200';
    if (status === 'Recibido') classes = 'bg-yellow-100 text-yellow-700';
    if (status === 'En preparación') classes = 'bg-orange-100 text-orange-700';
    if (status === 'Terminado') classes = 'bg-green-100 text-green-700';
    if (status === 'En Reparto') classes = 'bg-blue-100 text-blue-700';
    if (status === 'Entregado') classes = 'bg-green-200 text-green-800';
    if (status === 'Cobrado') classes = 'bg-teal-100 text-teal-700';
    if (status === 'Anulado') classes = 'bg-red-100 text-red-700';

    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${classes}">${status}</span>`;
};

export const getDateMillis = (date) => {
    if (!date) return 0;
    if (typeof date.toMillis === 'function') return date.toMillis();
    if (date instanceof Date) return date.getTime();
    if (typeof date === 'string') return new Date(date).getTime();
    if (typeof date.seconds === 'number') return date.seconds * 1000;
    return 0;
};

export const getSafeDate = (date) => {
    if (!date) return new Date();
    if (typeof date.toDate === 'function') return date.toDate();
    return new Date(date);
};

export function initSlideButtons() {
    document.querySelectorAll('.slider-container').forEach(slider => {
        // Prevent double initialization
        if (slider.dataset.initialized === 'true') return;
        slider.dataset.initialized = 'true';

        const thumb = slider.querySelector('.slider-thumb');
        const text = slider.querySelector('.slider-text');
        let isDragging = false;
        let startX;
        let currentX;

        const startDrag = (e) => {
            isDragging = true;
            startX = (e.touches ? e.touches[0].clientX : e.clientX);
            thumb.style.transition = 'none';
        };

        const moveDrag = (e) => {
            if (!isDragging) return;
            const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
            const deltaX = clientX - startX;
            const maxDrag = slider.offsetWidth - thumb.offsetWidth - 8;

            currentX = Math.max(0, Math.min(deltaX, maxDrag));
            thumb.style.transform = `translateX(${currentX}px)`;

            const opacity = 1 - (currentX / maxDrag);
            text.style.opacity = opacity;
        };

        const endDrag = () => {
            if (!isDragging) return;
            isDragging = false;
            thumb.style.transition = 'transform 0.3s ease';

            const maxDrag = slider.offsetWidth - thumb.offsetWidth - 8;
            if (currentX > maxDrag * 0.9) {
                thumb.style.transform = `translateX(${maxDrag}px)`;
                const id = slider.dataset.id;
                const action = slider.dataset.action;
                const callbackName = slider.dataset.callback;

                if (callbackName === 'updateChefStatus' && window.updateChefStatus) window.updateChefStatus(id, action);
                if (callbackName === 'updateOrderStatus' && window.updateOrderStatus) window.updateOrderStatus(id, action);
                if (callbackName === 'updateWaiterOrderStatus' && window.updateWaiterOrderStatus) window.updateWaiterOrderStatus(id, action);

            } else {
                thumb.style.transform = 'translateX(0)';
                text.style.opacity = 1;
            }
        };

        thumb.addEventListener('mousedown', startDrag);
        thumb.addEventListener('touchstart', startDrag, { passive: true });

        document.addEventListener('mousemove', moveDrag);
        document.addEventListener('touchmove', moveDrag, { passive: true });

        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);
    });
}

// XSS Prevention
export const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};
