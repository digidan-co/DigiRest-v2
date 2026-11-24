/**
 * Utilidades de cálculo y validación de Campañas de Descuento (Frontend)
 */

export function getMatchingCampaignForProduct(product, channel = null, activeCampaigns = []) {
    if (!product || !Array.isArray(activeCampaigns) || activeCampaigns.length === 0) return null;

    const normChannel = channel ? String(channel).toLowerCase().trim() : null;

    const matching = activeCampaigns.filter(c => {
        if (!c || c.active === 0 || c.active === false || c.active === '0') return false;

        const discountPct = parseFloat(c.discount_percent);
        if (isNaN(discountPct) || discountPct <= 0) return false;

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
    return matching.sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0))[0];
}

export function calculateProductCampaignPrice(product, campaign) {
    const baseRegular = parseFloat(product.price) || 0;
    const basePrice = (product.is_promo && parseFloat(product.promo_price) > 0)
        ? parseFloat(product.promo_price)
        : baseRegular;

    if (!campaign || !campaign.discount_percent || campaign.discount_percent <= 0) {
        return {
            finalPrice: basePrice,
            discountAmount: 0,
            discountPercent: 0,
            basePrice
        };
    }

    const discountPercent = parseFloat(campaign.discount_percent);
    const discountAmount = Math.round(basePrice * (discountPercent / 100));
    const finalPrice = Math.max(0, basePrice - discountAmount);

    return {
        finalPrice,
        discountAmount,
        discountPercent,
        basePrice,
        campaignName: campaign.name
    };
}

export function calculateOrderCampaignDiscount(cartItems, channel, activeCampaigns, productsList = []) {
    let totalDiscount = 0;
    const campaignNames = new Set();

    if (!Array.isArray(cartItems) || !Array.isArray(activeCampaigns) || activeCampaigns.length === 0) {
        return { totalDiscount: 0, campaignReason: '', appliedCampaigns: [] };
    }

    cartItems.forEach(item => {
        if (item.is_combo) return;

        const pid = String(item.productId ?? item.id ?? '');
        const pName = String(item.name || '').trim().toLowerCase();
        const prod = (productsList || []).find(p => String(p.id) === pid || String(p.name || '').trim().toLowerCase() === pName) || item;

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
