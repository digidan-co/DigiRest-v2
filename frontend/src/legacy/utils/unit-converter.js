/**
 * Utilitario de conversión de unidades de medida para el frontend de DigiRest v2
 */

export const UNIT_MAP = {
    'g': 'g', 'gr': 'g', 'gramo': 'g', 'gramos': 'g',
    'kg': 'kg', 'kilo': 'kg', 'kilos': 'kg', 'kilogramo': 'kg', 'kilogramos': 'kg',
    'mg': 'mg', 'miligramo': 'mg', 'miligramos': 'mg',
    'lb': 'lb', 'lbs': 'lb', 'libra': 'lb', 'libras': 'lb',
    'oz': 'oz', 'onza': 'oz', 'onzas': 'oz',
    'ml': 'ml', 'mililitro': 'ml', 'mililitros': 'ml', 'cc': 'ml',
    'l': 'l', 'lt': 'l', 'litro': 'l', 'litros': 'l',
    'fl_oz': 'fl_oz', 'oz fl': 'fl_oz', 'fl oz': 'fl_oz', 'onza liquida': 'fl_oz',
    'gal': 'gal', 'galon': 'gal', 'galones': 'gal',
    'und': 'und', 'unid': 'und', 'unidad': 'und', 'unidades': 'und',
    'pza': 'und', 'pieza': 'und', 'piezas': 'und', 'porcion': 'und', 'porciones': 'und'
};

export const MASS_TO_GRAMS = {
    'g': 1,
    'kg': 1000,
    'mg': 0.001,
    'lb': 500,
    'oz': 28.35
};

export const VOL_TO_ML = {
    'ml': 1,
    'l': 1000,
    'fl_oz': 29.57,
    'gal': 3785.41
};

export function normalizeUnit(unitStr) {
    if (!unitStr || typeof unitStr !== 'string') return 'und';
    const clean = unitStr.trim().toLowerCase();
    return UNIT_MAP[clean] || clean;
}

export function convertUnit(quantity, fromUnit, toUnit) {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty === 0) return 0;

    const fromNorm = normalizeUnit(fromUnit);
    const toNorm = normalizeUnit(toUnit);

    if (fromNorm === toNorm) return qty;

    if (MASS_TO_GRAMS[fromNorm] && MASS_TO_GRAMS[toNorm]) {
        const inGrams = qty * MASS_TO_GRAMS[fromNorm];
        const converted = inGrams / MASS_TO_GRAMS[toNorm];
        return Math.round(converted * 10000) / 10000;
    }

    if (VOL_TO_ML[fromNorm] && VOL_TO_ML[toNorm]) {
        const inMl = qty * VOL_TO_ML[fromNorm];
        const converted = inMl / VOL_TO_ML[toNorm];
        return Math.round(converted * 10000) / 10000;
    }

    return qty;
}

export function formatUnit(unitStr) {
    const norm = normalizeUnit(unitStr);
    const labels = {
        'g': 'g (gramos)',
        'kg': 'kg (kilos)',
        'lb': 'lb (500g)',
        'oz': 'oz (onzas)',
        'mg': 'mg (miligramos)',
        'ml': 'ml (mililitros)',
        'l': 'L (litros)',
        'fl_oz': 'fl oz (onzas)',
        'gal': 'gal (galones)',
        'und': 'und (unidades)'
    };
    return labels[norm] || norm;
}

export function getCompatibleUnits(unitStr) {
    const norm = normalizeUnit(unitStr);
    if (MASS_TO_GRAMS[norm]) {
        return ['g', 'kg', 'lb', 'oz', 'mg'];
    }
    if (VOL_TO_ML[norm]) {
        return ['ml', 'l', 'fl_oz', 'gal'];
    }
    return [norm || 'und'];
}
