/**
 * Utilitario de conversión de unidades de medida para DigiRest v2
 * Soporta conversiones de peso (Masa), volumen (Líquidos) y unidades estándar.
 */

const UNIT_MAP = {
    // Masa / Peso (Base: gramos 'g')
    'g': 'g',
    'gr': 'g',
    'gramo': 'g',
    'gramos': 'g',
    'kg': 'kg',
    'kilo': 'kg',
    'kilos': 'kg',
    'kilogramo': 'kg',
    'kilogramos': 'kg',
    'mg': 'mg',
    'miligramo': 'mg',
    'miligramos': 'mg',
    'lb': 'lb',
    'lbs': 'lb',
    'libra': 'lb',
    'libras': 'lb',
    'oz': 'oz',
    'onza': 'oz',
    'onzas': 'oz',

    // Volumen / Líquidos (Base: mililitros 'ml')
    'ml': 'ml',
    'mililitro': 'ml',
    'mililitros': 'ml',
    'cc': 'ml',
    'l': 'l',
    'lt': 'l',
    'litro': 'l',
    'litros': 'l',
    'fl_oz': 'fl_oz',
    'oz fl': 'fl_oz',
    'fl oz': 'fl_oz',
    'onza liquida': 'fl_oz',
    'gal': 'gal',
    'galon': 'gal',
    'galones': 'gal',

    // Discretos
    'und': 'und',
    'unid': 'und',
    'unidad': 'und',
    'unidades': 'und',
    'pza': 'und',
    'pieza': 'und',
    'piezas': 'und',
    'porcion': 'und',
    'porciones': 'und'
};

const MASS_TO_GRAMS = {
    'g': 1,
    'kg': 1000,
    'mg': 0.001,
    'lb': 500, // 500g estándar gastronómico comercial en LatAm/Colombia
    'oz': 28.35
};

const VOL_TO_ML = {
    'ml': 1,
    'l': 1000,
    'fl_oz': 29.57,
    'gal': 3785.41
};

/**
 * Normaliza la cadena de texto de unidad a su identificador canónico.
 */
function normalizeUnit(unitStr) {
    if (!unitStr || typeof unitStr !== 'string') return 'und';
    const clean = unitStr.trim().toLowerCase();
    return UNIT_MAP[clean] || clean;
}

/**
 * Convierte una cantidad de una unidad de medida a otra.
 * @param {number} quantity - Cantidad numérica
 * @param {string} fromUnit - Unidad de origen (ej: 'g', '100g')
 * @param {string} toUnit - Unidad de destino (ej: 'kg')
 * @returns {number} Cantidad convertida (redondeada a 4 decimales para evitar floating point issues)
 */
function convertUnit(quantity, fromUnit, toUnit) {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty === 0) return 0;

    const fromNorm = normalizeUnit(fromUnit);
    const toNorm = normalizeUnit(toUnit);

    if (fromNorm === toNorm) {
        return qty;
    }

    // Conversión de masa / peso
    if (MASS_TO_GRAMS[fromNorm] && MASS_TO_GRAMS[toNorm]) {
        const inGrams = qty * MASS_TO_GRAMS[fromNorm];
        const converted = inGrams / MASS_TO_GRAMS[toNorm];
        return Math.round(converted * 10000) / 10000;
    }

    // Conversión de volumen / líquidos
    if (VOL_TO_ML[fromNorm] && VOL_TO_ML[toNorm]) {
        const inMl = qty * VOL_TO_ML[fromNorm];
        const converted = inMl / VOL_TO_ML[toNorm];
        return Math.round(converted * 10000) / 10000;
    }

    // Si no son directamente convertibles (ej: 'und' vs 'kg'), retornar cantidad original
    return qty;
}

/**
 * Retorna las unidades compatibles según la unidad base del insumo.
 */
function getCompatibleUnits(unitStr) {
    const norm = normalizeUnit(unitStr);
    if (MASS_TO_GRAMS[norm]) {
        return [
            { id: 'g', label: 'Gramos (g)' },
            { id: 'kg', label: 'Kilogramos (kg)' },
            { id: 'lb', label: 'Libras (lb - 500g)' },
            { id: 'oz', label: 'Onzas (oz - 28.3g)' }
        ];
    }
    if (VOL_TO_ML[norm]) {
        return [
            { id: 'ml', label: 'Mililitros (ml)' },
            { id: 'l', label: 'Litros (L)' },
            { id: 'fl_oz', label: 'Onzas líq. (fl oz)' }
        ];
    }
    return [
        { id: norm || 'und', label: norm ? norm.toUpperCase() : 'Unidad (und)' }
    ];
}

module.exports = {
    normalizeUnit,
    convertUnit,
    getCompatibleUnits,
    MASS_TO_GRAMS,
    VOL_TO_ML
};
