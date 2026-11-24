/**
 * Utilidades para cálculo y validación de Campañas de Descuento (DigiRest)
 * Zona Horaria: America/Bogota (UTC-5)
 */

function getColombiaDateTime() {
    const now = new Date();
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Bogota',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
        const parts = formatter.formatToParts(now);
        const getPart = (type) => parts.find(p => p.type === type)?.value || '';
        const todayStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
        const currentTimeStr = `${getPart('hour')}:${getPart('minute')}`;

        const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short' });
        const dayMap = { 'Mon': '1', 'Tue': '2', 'Wed': '3', 'Thu': '4', 'Fri': '5', 'Sat': '6', 'Sun': '7' };
        const dayOfWeek = dayMap[dayFormatter.format(now)] || '1';

        return { todayStr, currentTimeStr, dayOfWeek };
    } catch (_) {
        // Fallback robusto con desfase UTC-5 si Intl falla
        const d = new Date(now.getTime() - 5 * 3600000);
        const todayStr = d.toISOString().slice(0, 10);
        const hours = String(d.getUTCHours()).padStart(2, '0');
        const mins = String(d.getUTCMinutes()).padStart(2, '0');
        const currentTimeStr = `${hours}:${mins}`;
        const day = d.getUTCDay();
        const dayOfWeek = String(day === 0 ? 7 : day);
        return { todayStr, currentTimeStr, dayOfWeek };
    }
}

function filterActiveCampaigns(campaigns, channel = null) {
    const { todayStr, currentTimeStr, dayOfWeek } = getColombiaDateTime();

    return (Array.isArray(campaigns) ? campaigns : []).filter(c => {
        if (!c || c.active === 0 || c.active === false || c.active === '0') return false;

        const discountPct = parseFloat(c.discount_percent);
        if (isNaN(discountPct) || discountPct <= 0) return false;

        // Filtro fecha inicio y fin
        if (c.start_date && String(c.start_date).trim() && todayStr < String(c.start_date).trim()) return false;
        if (c.end_date && String(c.end_date).trim() && todayStr > String(c.end_date).trim()) return false;

        // Filtro horario
        if (c.start_time && String(c.start_time).trim() && currentTimeStr < String(c.start_time).trim()) return false;
        if (c.end_time && String(c.end_time).trim() && currentTimeStr > String(c.end_time).trim()) return false;

        // Filtro días de la semana
        let days = ['1', '2', '3', '4', '5', '6', '7'];
        try {
            const parsed = typeof c.days_of_week === 'string' ? JSON.parse(c.days_of_week || '[]') : c.days_of_week;
            if (Array.isArray(parsed) && parsed.length > 0) days = parsed.map(String);
        } catch (_) {}
        if (days.length > 0 && !days.includes(String(dayOfWeek))) return false;

        // Filtro canal si se especifica
        if (channel) {
            let chs = ['Local', 'Domicilio', 'Para Llevar'];
            try {
                const parsed = typeof c.channels === 'string' ? JSON.parse(c.channels || '[]') : c.channels;
                if (Array.isArray(parsed) && parsed.length > 0) chs = parsed;
            } catch (_) {}

            const normChannel = String(channel).toLowerCase().trim();
            const hasChannel = chs.some(ch => {
                const normCh = String(ch).toLowerCase().trim();
                if (normCh === normChannel) return true;
                if ((normChannel === 'recoger' || normChannel === 'para llevar') && (normCh === 'para llevar' || normCh === 'recoger')) return true;
                return false;
            });
            if (!hasChannel) return false;
        }

        return true;
    }).map(c => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        discount_percent: parseFloat(c.discount_percent) || 0,
        scope: c.scope || 'ALL',
        category_id: c.category_id || null,
        category_name: c.category_name || null,
        product_ids: typeof c.product_ids === 'string' ? JSON.parse(c.product_ids || '[]') : (c.product_ids || []),
        channels: typeof c.channels === 'string' ? JSON.parse(c.channels || '[]') : (c.channels || ['Local', 'Domicilio', 'Para Llevar'])
    }));
}

function getMatchingCampaignForProduct(product, channel, activeCampaigns) {
    if (!product || !Array.isArray(activeCampaigns) || activeCampaigns.length === 0) return null;

    const normChannel = channel ? String(channel).toLowerCase().trim() : null;

    const matching = activeCampaigns.filter(c => {
        // Verificar canal si se proveyó
        if (normChannel && Array.isArray(c.channels) && c.channels.length > 0) {
            const hasChannel = c.channels.some(ch => {
                const normCh = String(ch).toLowerCase().trim();
                if (normCh === normChannel) return true;
                if ((normChannel === 'recoger' || normChannel === 'para llevar') && (normCh === 'para llevar' || normCh === 'recoger')) return true;
                return false;
            });
            if (!hasChannel) return false;
        }

        // Scope check
        if (c.scope === 'ALL') {
            return true;
        }
        if (c.scope === 'CATEGORY') {
            const pCatId = String(product.category_id || '');
            const cCatId = String(c.category_id || '');
            const pCatName = String(product.category || '').toLowerCase().trim();
            const cCatName = String(c.category_name || '').toLowerCase().trim();
            if (cCatId && pCatId && pCatId === cCatId) return true;
            if (cCatName && pCatName && pCatName === cCatName) return true;
            return false;
        }
        if (c.scope === 'SELECTED_PRODUCTS') {
            const pids = (c.product_ids || []).map(String);
            const pid = String(product.id ?? product.productId ?? '');
            return pids.includes(pid);
        }
        return false;
    });

    if (matching.length === 0) return null;
    // Seleccionar la campaña con mayor porcentaje de descuento
    return matching.sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0))[0];
}

function calculateOrderCampaignDiscount(items, channel, activeCampaigns, productsMap = new Map()) {
    let totalDiscount = 0;
    const campaignNames = new Set();

    if (!Array.isArray(items) || !Array.isArray(activeCampaigns) || activeCampaigns.length === 0) {
        return { totalDiscount: 0, campaignReason: '', appliedCampaigns: [] };
    }

    items.forEach(item => {
        // Ignorar combos completos para no duplicar con descuentos de combos
        if (item.is_combo) return;

        const pid = String(item.productId ?? item.id ?? '');
        const pName = String(item.name || '').trim().toLowerCase();
        const prod = productsMap.get(pid) || productsMap.get(pName) || item;

        const campaign = getMatchingCampaignForProduct(prod, channel, activeCampaigns);
        if (campaign && campaign.discount_percent > 0) {
            const qty = Math.max(1, parseInt(item.qty ?? item.quantity, 10) || 1);
            const unitPrice = Math.max(0, parseFloat(item.price) || parseFloat(prod.price) || 0);
            const itemTotal = unitPrice * qty;
            const savings = Math.round(itemTotal * (campaign.discount_percent / 100));
            if (savings > 0) {
                totalDiscount += savings;
                campaignNames.add(campaign.name);
            }
        }
    });

    return {
        totalDiscount,
        campaignReason: Array.from(campaignNames).join(', '),
        appliedCampaigns: Array.from(campaignNames)
    };
}

module.exports = {
    getColombiaDateTime,
    filterActiveCampaigns,
    getMatchingCampaignForProduct,
    calculateOrderCampaignDiscount
};
