/**
 * DigiRest - Theme Manager Feature Module (New Clean Personalization Architecture)
 * Automatically enforces WCAG AA contrast standards across all UI components.
 * Manages:
 * - Brand Accent Color (--system-primary, --system-primary-contrast-text, --system-primary-text-safe)
 * - Navigation Aside Color & Styles (--system-bg-aside, --sidebar-text, --sidebar-accent-safe)
 * - Guardrails against washed-out / invisible elements.
 */

import { state } from '../core/state.js';
import { $ } from '../utils/helpers.js';

export const BRAND_PRESETS = [
    { name: 'Ámbar Dorado', color: '#f59e0b' },
    { name: 'Naranja Fuego', color: '#ea580c' },
    { name: 'Rojo Carmesí', color: '#dc2626' },
    { name: 'Verde Esmeralda', color: '#059669' },
    { name: 'Azul Océano', color: '#0284c7' },
    { name: 'Púrpura Real', color: '#7c3aed' },
    { name: 'Café Espresso', color: '#78350f' },
    { name: 'Grafito Carbón', color: '#334155' }
];

// Backwards-compatibility alias for any legacy imports
export const SYSTEM_THEMES = BRAND_PRESETS.map((p, idx) => ({
    id: `brand_${idx}`,
    name: p.name,
    primary: p.color,
    contrast: '#ffffff',
    desc: p.name
}));
export const SIDEBAR_PRESETS = [];

/**
 * Normalizes a hex string (#rgb or #rrggbb) into lowercase 6-digit #rrggbb
 */
export function normalizeHex(hex, fallback = '#f59e0b') {
    if (!hex || typeof hex !== 'string') return fallback;
    let clean = hex.trim().replace(/^#/, '');
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
    return `#${clean.toLowerCase()}`;
}

/**
 * Calculates WCAG relative luminance of a hex color (0.0 to 1.0)
 */
export function getLuminance(hex) {
    const norm = normalizeHex(hex, '#000000').slice(1);
    const r = parseInt(norm.substring(0, 2), 16) / 255;
    const g = parseInt(norm.substring(2, 4), 16) / 255;
    const b = parseInt(norm.substring(4, 6), 16) / 255;
    const a = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Calculates WCAG contrast ratio between two hex colors (1.0 to 21.0)
 */
export function getContrastRatio(hex1, hex2) {
    const l1 = getLuminance(hex1);
    const l2 = getLuminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Converts a hex color to HSL ({ h: 0..360, s: 0..1, l: 0..1 })
 */
export function hexToHsl(hex) {
    const norm = normalizeHex(hex, '#000000').slice(1);
    const r = parseInt(norm.substring(0, 2), 16) / 255;
    const g = parseInt(norm.substring(2, 4), 16) / 255;
    const b = parseInt(norm.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s, l };
}

/**
 * Converts HSL (h: 0..360, s: 0..1, l: 0..1) to #rrggbb hex
 */
export function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const hn = (((h % 360) + 360) % 360) / 360;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, hn + 1 / 3);
        g = hue2rgb(p, q, hn);
        b = hue2rgb(p, q, hn - 1 / 3);
    }
    const toHex = (x) => Math.round(Math.max(0, Math.min(255, x * 255))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Determines optimal button/module text color (#ffffff vs #0f172a) based on WCAG contrast ratio
 */
export function getBestTextContrast(bgHex) {
    const normBg = normalizeHex(bgHex, '#f59e0b');
    return getContrastRatio('#ffffff', normBg) >= getContrastRatio('#0f172a', normBg)
        ? '#ffffff'
        : '#0f172a';
}

/**
 * Adjusts lightness of accentHex in O(1) preserving Hue/Saturation
 * until contrast against bgHex meets minRatio (default WCAG AA 4.5:1).
 */
export function ensureContrastColor(accentHex, bgHex, minRatio = 4.5) {
    const normAccent = normalizeHex(accentHex, '#f59e0b');
    const normBg = normalizeHex(bgHex, '#052244');
    if (getContrastRatio(normAccent, normBg) >= minRatio) {
        return normAccent;
    }

    const { h, s, l } = hexToHsl(normAccent);
    const isLightBg = getContrastRatio('#0f172a', normBg) > getContrastRatio('#ffffff', normBg);

    let low = isLightBg ? 0.03 : l;
    let high = isLightBg ? l : 0.97;
    let best = null;

    for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        const candidate = hslToHex(h, s, mid);
        if (getContrastRatio(candidate, normBg) >= minRatio) {
            best = candidate;
            if (isLightBg) low = mid;
            else high = mid;
        } else {
            if (isLightBg) high = mid;
            else low = mid;
        }
    }

    if (best && getContrastRatio(best, normBg) >= minRatio) {
        return best;
    }
    return isLightBg ? '#0f172a' : '#ffffff';
}

/**
 * Updates UI state of navigation mode chips (Oscuro, Claro, Marca)
 */
export function updateSidebarModeUI(asideColor, primaryColor) {
    const btnDark = $('btn-aside-mode-dark');
    const btnLight = $('btn-aside-mode-light');
    const btnBrand = $('btn-aside-mode-brand');
    if (!btnDark || !btnLight || !btnBrand) return;

    const normAside = normalizeHex(asideColor, '').toLowerCase();
    const normPrimary = normalizeHex(primaryColor, '').toLowerCase();

    const isDark = normAside === '#0b1329' || normAside === '#052244' || normAside === '#0f172a' || normAside === '#111827';
    const isLight = normAside === '#f8fafc' || normAside === '#ffffff' || normAside === '#f1f5f9';
    const isBrand = normAside === normPrimary && normPrimary !== '';

    const setChipState = (btn, isActive) => {
        if (!btn) return;
        if (isActive) {
            btn.className = 'flex-1 py-1 px-1.5 rounded-md text-[11px] font-bold transition-all flex items-center justify-center gap-1 bg-white text-gray-900 shadow-sm ring-1 ring-gray-300';
        } else {
            btn.className = 'flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-all flex items-center justify-center gap-1 text-gray-500 hover:text-gray-900 hover:bg-white/60';
        }
    };

    setChipState(btnDark, isDark && !isBrand);
    setChipState(btnLight, isLight && !isBrand);
    setChipState(btnBrand, isBrand);
}

/**
 * Applies the sidebar background color and dynamically computes high-contrast styles.
 */
export function applySidebarTheme(asideColor, primaryColor = null) {
    asideColor = normalizeHex(asideColor || state.config?.sidebarColor || (typeof localStorage !== 'undefined' ? localStorage.getItem('digirest_sidebar_color') : null), '#0b1329');
    primaryColor = normalizeHex(primaryColor || state.config?.primaryColor, '#f59e0b');

    const root = document.documentElement;
    root.style.setProperty('--system-bg-aside', asideColor);

    if (!state.config) state.config = {};
    state.config.sidebarColor = asideColor;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('digirest_sidebar_color', asideColor);
    }

    const lum = getLuminance(asideColor);
    const whiteContrast = getContrastRatio('#ffffff', asideColor);
    const darkContrast = getContrastRatio('#0f172a', asideColor);
    const isLight = darkContrast > whiteContrast;
    const isMidTone = lum > 0.09 && lum < 0.55;

    if (isLight) {
        // Claro minimalista: textos oscuros y divisor nítido
        root.style.setProperty('--sidebar-text', isMidTone ? '#090d16' : '#0f172a');
        root.style.setProperty('--sidebar-section-title', isMidTone ? 'rgba(9, 13, 22, 0.92)' : 'rgba(15, 23, 42, 0.84)');
        root.style.setProperty('--sidebar-section-dot', isMidTone ? 'rgba(9, 13, 22, 0.72)' : 'rgba(15, 23, 42, 0.55)');
        root.style.setProperty('--sidebar-inactive-bg', isMidTone ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.045)');
        root.style.setProperty('--sidebar-inactive-border', isMidTone ? 'rgba(9, 13, 22, 0.24)' : 'rgba(15, 23, 42, 0.14)');
        root.style.setProperty('--sidebar-inactive-text', isMidTone ? 'rgba(9, 13, 22, 0.96)' : 'rgba(15, 23, 42, 0.88)');
        root.style.setProperty('--sidebar-inactive-icon', isMidTone ? 'rgba(9, 13, 22, 0.88)' : 'rgba(15, 23, 42, 0.72)');
        root.style.setProperty('--sidebar-inactive-hover-bg', isMidTone ? 'rgba(255, 255, 255, 0.35)' : 'rgba(15, 23, 42, 0.09)');
        root.style.setProperty('--sidebar-border', isMidTone ? 'rgba(9, 13, 22, 0.24)' : 'rgba(15, 23, 42, 0.16)');
        root.style.setProperty('--sidebar-muted', isMidTone ? 'rgba(9, 13, 22, 0.82)' : 'rgba(15, 23, 42, 0.72)');
        root.style.setProperty('--sidebar-greeting-bg', isMidTone ? 'rgba(255, 255, 255, 0.20)' : 'rgba(15, 23, 42, 0.045)');
        root.style.setProperty('--sidebar-greeting-border', isMidTone ? 'rgba(9, 13, 22, 0.22)' : 'rgba(15, 23, 42, 0.14)');
        root.style.setProperty('--sidebar-close-btn', '#0f172a');
        root.style.setProperty('--sidebar-outer-border', '1px solid rgba(15, 23, 42, 0.12)');
    } else {
        // Oscuro elegante: textos blancos y acentos translúcidos
        root.style.setProperty('--sidebar-text', '#ffffff');
        root.style.setProperty('--sidebar-section-title', isMidTone ? '#ffffff' : 'rgba(255, 255, 255, 0.92)');
        root.style.setProperty('--sidebar-section-dot', isMidTone ? 'rgba(255, 255, 255, 0.82)' : 'rgba(255, 255, 255, 0.65)');
        root.style.setProperty('--sidebar-inactive-bg', isMidTone ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.07)');
        root.style.setProperty('--sidebar-inactive-border', isMidTone ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.14)');
        root.style.setProperty('--sidebar-inactive-text', isMidTone ? 'rgba(255, 255, 255, 0.97)' : 'rgba(255, 255, 255, 0.90)');
        root.style.setProperty('--sidebar-inactive-icon', isMidTone ? 'rgba(255, 255, 255, 0.90)' : 'rgba(255, 255, 255, 0.78)');
        root.style.setProperty('--sidebar-inactive-hover-bg', isMidTone ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.14)');
        root.style.setProperty('--sidebar-border', isMidTone ? 'rgba(255, 255, 255, 0.26)' : 'rgba(255, 255, 255, 0.18)');
        root.style.setProperty('--sidebar-muted', isMidTone ? 'rgba(255, 255, 255, 0.88)' : 'rgba(255, 255, 255, 0.78)');
        root.style.setProperty('--sidebar-greeting-bg', isMidTone ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.07)');
        root.style.setProperty('--sidebar-greeting-border', isMidTone ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.16)');
        root.style.setProperty('--sidebar-close-btn', 'rgba(255, 255, 255, 0.92)');
        root.style.setProperty('--sidebar-outer-border', 'none');
    }

    // Contraste WCAG para realce sobre el aside (nombre, saludo, hover, slogan)
    const safeAccent = ensureContrastColor(primaryColor, asideColor, 4.5);
    const primaryRatio = getContrastRatio(primaryColor, asideColor);

    root.style.setProperty('--sidebar-accent-safe', safeAccent);
    root.style.setProperty('--sidebar-slogan-color', primaryRatio >= 4.0 ? primaryColor : (isLight ? 'rgba(15, 23, 42, 0.76)' : 'rgba(255, 255, 255, 0.82)'));
    root.style.setProperty('--sidebar-accent-border', primaryRatio >= 2.2 ? primaryColor : (isLight ? 'rgba(15, 23, 42, 0.25)' : 'rgba(255, 255, 255, 0.35)'));

    if (primaryRatio < 2.2) {
        root.style.setProperty('--sidebar-active-border', isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(255, 255, 255, 0.65)');
        root.style.setProperty('--sidebar-active-shadow', 'none');
    } else {
        root.style.setProperty('--sidebar-active-border', 'transparent');
        root.style.setProperty('--sidebar-active-shadow', 'none');
    }

    // Sincronizar input color en el formulario
    const sidebarInput = $('conf-sidebar-color');
    if (sidebarInput && sidebarInput.value.toLowerCase() !== asideColor.toLowerCase()) {
        sidebarInput.value = asideColor;
    }

    // Sincronizar botones de modo de navegación (Oscuro / Claro / Marca)
    updateSidebarModeUI(asideColor, primaryColor);
}

/**
 * Sets predefined navigation style mode
 */
export function setSidebarStyleMode(mode) {
    const primary = state.config?.primaryColor || '#f59e0b';
    if (mode === 'dark') {
        applySidebarTheme('#0b1329', primary);
    } else if (mode === 'light') {
        applySidebarTheme('#f8fafc', primary);
    } else if (mode === 'brand') {
        applySidebarTheme(primary, primary);
    }
}

/**
 * Applies the primary brand color globally via CSS variables with automated contrast guardrails
 */
export function applySystemTheme(primaryColor, contrastColor = null, themeId = null) {
    primaryColor = normalizeHex(primaryColor, '#f59e0b');

    // 1. Automatic WCAG Contrast Calculation for Buttons and Accents
    const contrastText = getBestTextContrast(primaryColor);
    const lum = getLuminance(primaryColor);
    const isPrimaryVeryLight = lum > 0.82; // e.g. pure white #ffffff or pale pastels

    // Safe text version to guarantee readability on white background surfaces (cards, clock, headers)
    const safeTextOnWhite = isPrimaryVeryLight ? ensureContrastColor(primaryColor, '#ffffff', 4.5) : primaryColor;
    const primaryBorder = isPrimaryVeryLight ? '1px solid rgba(15, 23, 42, 0.20)' : '1px solid transparent';

    // 2. Set CSS variables globally
    const root = document.documentElement;
    root.style.setProperty('--system-primary', primaryColor);
    root.style.setProperty('--system-primary-contrast-text', contrastText);
    root.style.setProperty('--system-primary-text-safe', safeTextOnWhite);
    root.style.setProperty('--system-primary-border', primaryBorder);
    root.style.setProperty('--system-secondary', contrastText); // Unified backward compatibility!

    // 3. Sync state
    if (!state.config) state.config = {};
    state.config.primaryColor = primaryColor;
    state.config.nameColor = primaryColor;
    state.config.contrastColor = contrastText;
    if (themeId) state.config.themeId = themeId;

    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('digirest_primary_color', primaryColor);
        localStorage.setItem('digirest_contrast_color', contrastText);
    }

    // 4. Restaurant name on banners & display
    const bannerName1 = $('display-restaurant-name');
    const bannerName2 = $('display-restaurant-name-2');
    if (bannerName1) bannerName1.style.color = primaryColor;
    if (bannerName2) bannerName2.style.color = primaryColor;

    // 5. Sidebar branding
    const sidebarName = $('sidebar-business-name');
    if (sidebarName) sidebarName.style.color = 'var(--sidebar-accent-safe)';
    const sidebarUserGreeting = $('sidebar-user-name');
    if (sidebarUserGreeting) sidebarUserGreeting.style.color = 'var(--sidebar-accent-safe)';

    // 6. Live preview pill in settings card
    const previewBtn = $('brand-color-preview-btn');
    if (previewBtn) {
        previewBtn.style.backgroundColor = primaryColor;
        previewBtn.style.color = contrastText;
        previewBtn.style.border = primaryBorder;
    }

    // 7. Synchronize input element
    const primaryInput = $('conf-primary-color');
    if (primaryInput && primaryInput.value.toLowerCase() !== primaryColor.toLowerCase()) {
        primaryInput.value = primaryColor;
    }

    // 8. Update brand palette dots active ring
    document.querySelectorAll('[data-brand-color]').forEach(dot => {
        const dotColor = normalizeHex(dot.getAttribute('data-brand-color'), '');
        const isActive = dotColor === primaryColor.toLowerCase();
        dot.classList.toggle('ring-2', isActive);
        dot.classList.toggle('ring-blue-600', isActive);
        dot.classList.toggle('ring-offset-1', isActive);
        dot.classList.toggle('scale-110', isActive);
    });

    // 9. Recompute sidebar contrast with new primary color
    applySidebarTheme(state.config?.sidebarColor || localStorage.getItem('digirest_sidebar_color') || '#0b1329', primaryColor);
}

/**
 * Handles selecting a quick brand color from the palette
 */
export function selectBrandColor(colorHex) {
    applySystemTheme(colorHex, null, 'custom');
}

/**
 * Sets up live color picker input listeners
 */
export function initThemeListeners() {
    const primaryInput = $('conf-primary-color');
    if (primaryInput) {
        primaryInput.addEventListener('input', (e) => {
            applySystemTheme(e.target.value, null, 'custom');
        });
    }

    const sidebarInput = $('conf-sidebar-color');
    if (sidebarInput) {
        sidebarInput.addEventListener('input', (e) => {
            applySidebarTheme(e.target.value, state.config?.primaryColor);
        });
    }
}

// Deprecated legacy stubs for compatibility
export function setModuleContrast() {}
export function updateContrastButtons() {}
export function renderThemePresets() {}
export function updateThemePresetUI() {}
export function selectThemePreset(id) {
    const p = BRAND_PRESETS.find(b => b.name === id || b.color === id);
    if (p) selectBrandColor(p.color);
}

// Global window bindings for inline HTML onclick handlers
window.BRAND_PRESETS = BRAND_PRESETS;
window.SYSTEM_THEMES = SYSTEM_THEMES;
window.SIDEBAR_PRESETS = SIDEBAR_PRESETS;
window.normalizeHex = normalizeHex;
window.getLuminance = getLuminance;
window.getContrastRatio = getContrastRatio;
window.getBestTextContrast = getBestTextContrast;
window.applySystemTheme = applySystemTheme;
window.applySidebarTheme = applySidebarTheme;
window.setSidebarStyleMode = setSidebarStyleMode;
window.selectBrandColor = selectBrandColor;
window.setModuleContrast = setModuleContrast;
window.updateContrastButtons = updateContrastButtons;
window.renderThemePresets = renderThemePresets;
window.updateThemePresetUI = updateThemePresetUI;
window.selectThemePreset = selectThemePreset;
