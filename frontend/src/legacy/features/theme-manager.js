/**
 * DigiRest - Theme Manager Feature Module
 * Manages system palettes, CSS variables (--system-primary, --system-secondary),
 * contrast buttons, live color inputs, and branding elements.
 */

import { state } from '../core/state.js';
import { $ } from '../utils/helpers.js';

export const SYSTEM_THEMES = [
    { id: 'amber', name: 'Ámbar Clásico', primary: '#f5b55f', contrast: '#64010e', desc: 'Dorado original DigiRest' },
    { id: 'emerald', name: 'Esmeralda', primary: '#10b981', contrast: '#ffffff', desc: 'Verde fresco y natural' },
    { id: 'ocean', name: 'Azul Océano', primary: '#0284c7', contrast: '#ffffff', desc: 'Azul profesional' },
    { id: 'crimson', name: 'Carmesí Gourmet', primary: '#e11d48', contrast: '#ffffff', desc: 'Rojo elegante' },
    { id: 'violet', name: 'Púrpura Real', primary: '#8b5cf6', contrast: '#ffffff', desc: 'Violeta moderno' },
    { id: 'cyan', name: 'Turquesa Caribe', primary: '#06b6d4', contrast: '#1e2122', desc: 'Cian fresco y vivo' },
    { id: 'sunset', name: 'Naranja Sunset', primary: '#f97316', contrast: '#ffffff', desc: 'Naranja enérgico' },
    { id: 'golden', name: 'Dorado Mostaza', primary: '#eab308', contrast: '#1e2122', desc: 'Dorado gourmet' },
    { id: 'rose', name: 'Rosa Fucsia', primary: '#ec4899', contrast: '#ffffff', desc: 'Rosa llamativo' },
    { id: 'slate', name: 'Gris Grafito', primary: '#475569', contrast: '#ffffff', desc: 'Neutro sofisticado' }
];

/**
 * Calculates WCAG relative luminance of a hex color
 */
export function getLuminance(hex) {
    if (!hex) return 0;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const a = [r, g, b].map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Calculates WCAG contrast ratio between two hex colors
 */
export function getContrastRatio(hex1, hex2) {
    const l1 = getLuminance(hex1);
    const l2 = getLuminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Applies the sidebar background color and dynamically computes high-contrast
 * styles for module cards, icons, texts, borders, and the restaurant slogan.
 */
export function applySidebarTheme(asideColor, primaryColor = null) {
    if (!asideColor) asideColor = state.config?.sidebarColor || localStorage.getItem('digirest_sidebar_color') || '#052244';
    if (!primaryColor) primaryColor = state.config?.primaryColor || '#f5b55f';

    const root = document.documentElement;
    root.style.setProperty('--system-bg-aside', asideColor);

    if (!state.config) state.config = {};
    state.config.sidebarColor = asideColor;
    localStorage.setItem('digirest_sidebar_color', asideColor);

    const lum = getLuminance(asideColor);
    const isLight = lum > 0.45;
    const primaryRatio = getContrastRatio(primaryColor, asideColor);

    if (isLight) {
        // High contrast against light backgrounds
        root.style.setProperty('--sidebar-text', '#0f172a');
        root.style.setProperty('--sidebar-section-title', '#334155');
        root.style.setProperty('--sidebar-section-dot', '#64748b');
        root.style.setProperty('--sidebar-inactive-bg', 'rgba(0, 0, 0, 0.05)');
        root.style.setProperty('--sidebar-inactive-border', 'rgba(0, 0, 0, 0.08)');
        root.style.setProperty('--sidebar-inactive-text', '#334155');
        root.style.setProperty('--sidebar-inactive-icon', '#475569');
        root.style.setProperty('--sidebar-inactive-hover-bg', 'rgba(0, 0, 0, 0.09)');
        root.style.setProperty('--sidebar-border', 'rgba(0, 0, 0, 0.12)');
        root.style.setProperty('--sidebar-muted', 'rgba(30, 41, 59, 0.7)');
        root.style.setProperty('--sidebar-greeting-bg', 'rgba(0, 0, 0, 0.04)');
        root.style.setProperty('--sidebar-greeting-border', 'rgba(0, 0, 0, 0.08)');
        root.style.setProperty('--sidebar-close-btn', '#334155');

        // Slogan contrast handling
        const sloganColor = primaryRatio >= 3.2 ? primaryColor : '#334155';
        root.style.setProperty('--sidebar-slogan-color', sloganColor);
    } else {
        // High contrast against dark backgrounds
        root.style.setProperty('--sidebar-text', '#ffffff');
        root.style.setProperty('--sidebar-section-title', 'rgba(255, 255, 255, 0.95)');
        root.style.setProperty('--sidebar-section-dot', 'rgba(255, 255, 255, 0.6)');
        root.style.setProperty('--sidebar-inactive-bg', 'rgba(255, 255, 255, 0.06)');
        root.style.setProperty('--sidebar-inactive-border', 'rgba(255, 255, 255, 0.07)');
        root.style.setProperty('--sidebar-inactive-text', '#cbd5e1');
        root.style.setProperty('--sidebar-inactive-icon', '#94a3b8');
        root.style.setProperty('--sidebar-inactive-hover-bg', 'rgba(255, 255, 255, 0.12)');
        root.style.setProperty('--sidebar-border', 'rgba(255, 255, 255, 0.12)');
        root.style.setProperty('--sidebar-muted', 'rgba(255, 255, 255, 0.75)');
        root.style.setProperty('--sidebar-greeting-bg', 'rgba(255, 255, 255, 0.05)');
        root.style.setProperty('--sidebar-greeting-border', 'rgba(255, 255, 255, 0.1)');
        root.style.setProperty('--sidebar-close-btn', 'rgba(255, 255, 255, 0.7)');

        // Slogan contrast handling
        const sloganColor = primaryRatio >= 3.0 ? primaryColor : 'rgba(255, 255, 255, 0.82)';
        root.style.setProperty('--sidebar-slogan-color', sloganColor);
    }

    // Sync input value if DOM element exists
    const sidebarInput = $('conf-sidebar-color');
    if (sidebarInput && sidebarInput.value.toLowerCase() !== asideColor.toLowerCase()) {
        sidebarInput.value = asideColor;
    }
    const badge = $('sidebar-contrast-badge');
    if (badge) {
        badge.innerHTML = isLight 
            ? '<i class="fas fa-sun text-[9px] text-amber-500"></i> Fondo Claro (Texto Oscuro)'
            : '<i class="fas fa-moon text-[9px] text-indigo-400"></i> Fondo Oscuro (Texto Claro)';
    }
}

/**
 * Applies the primary and contrast colors globally via CSS variables and updates state & UI
 */
export function applySystemTheme(primaryColor, contrastColor, themeId = null) {
    if (!primaryColor) primaryColor = '#f5b55f';
    if (!contrastColor) contrastColor = '#64010e';

    // Set CSS variables globally
    document.documentElement.style.setProperty('--system-primary', primaryColor);
    document.documentElement.style.setProperty('--system-secondary', contrastColor);

    // Sync state
    if (!state.config) state.config = {};
    state.config.primaryColor = primaryColor;
    state.config.nameColor = primaryColor; // Unified with name color!
    state.config.contrastColor = contrastColor;
    if (themeId) state.config.themeId = themeId;

    // Apply to restaurant name on banners and display
    const bannerName1 = $('display-restaurant-name');
    const bannerName2 = $('display-restaurant-name-2');
    if (bannerName1) bannerName1.style.color = primaryColor;
    if (bannerName2) bannerName2.style.color = primaryColor;

    // Apply to sidebar branding
    const sidebarName = $('sidebar-business-name');
    if (sidebarName) sidebarName.style.color = primaryColor;
    const sidebarUserGreeting = $('sidebar-user-name');
    if (sidebarUserGreeting) sidebarUserGreeting.style.color = primaryColor;

    // Synchronize color input
    const primaryInput = $('conf-primary-color');
    if (primaryInput && primaryInput.value.toLowerCase() !== primaryColor.toLowerCase()) {
        primaryInput.value = primaryColor;
    }

    // Update contrast buttons active state
    updateContrastButtons(contrastColor);

    // Apply sidebar theme & slogan contrast
    applySidebarTheme(state.config?.sidebarColor || localStorage.getItem('digirest_sidebar_color') || '#052244', primaryColor);
}

/**
 * Updates UI of contrast selection buttons (White vs Dark/Black)
 */
export function updateContrastButtons(contrastColor) {
    const isWhite = (contrastColor || '').toLowerCase() === '#ffffff';
    const btnWhite = $('btn-contrast-white');
    const btnBlack = $('btn-contrast-black');

    if (btnWhite) {
        if (isWhite) {
            btnWhite.className = 'px-2 py-1 rounded-md text-xs font-black transition-all flex items-center gap-1 bg-white text-gray-900 shadow-sm ring-1 ring-gray-300';
        } else {
            btnWhite.className = 'px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 text-gray-500 hover:text-gray-900 hover:bg-white/60';
        }
    }
    if (btnBlack) {
        if (!isWhite) {
            btnBlack.className = 'px-2 py-1 rounded-md text-xs font-black transition-all flex items-center gap-1 bg-gray-900 text-white shadow-sm ring-1 ring-black';
        } else {
            btnBlack.className = 'px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1 text-gray-500 hover:text-gray-900 hover:bg-white/60';
        }
    }
}

/**
 * Updates active indicator on theme preset pills
 */
export function updateThemePresetUI(activeThemeId, currentPrimary) {
    const container = $('theme-presets-container');
    const activeLabel = $('theme-active-label');
    if (!container) return;

    const matchedPreset = SYSTEM_THEMES.find(t => 
        (activeThemeId && t.id === activeThemeId) || 
        t.primary.toLowerCase() === (currentPrimary || '').toLowerCase()
    );

    if (matchedPreset) {
        if (activeLabel) activeLabel.innerText = matchedPreset.name;
    } else {
        if (activeLabel) activeLabel.innerText = 'Personalizado';
    }

    container.querySelectorAll('.theme-preset-btn').forEach(btn => {
        const themeId = btn.getAttribute('data-theme-id');
        const checkIcon = btn.querySelector('.fa-check');
        if (matchedPreset && themeId === matchedPreset.id) {
            btn.classList.add('theme-preset-active', 'scale-[1.02]');
            btn.classList.remove('border-gray-200/80', 'ring-2', 'ring-blue-600', 'bg-blue-50/60', 'border-blue-300', 'shadow-xs', 'shadow-sm');
            btn.style.borderColor = 'var(--system-primary)';
            btn.style.boxShadow = 'none';
            btn.style.outline = 'none';
            btn.setAttribute('aria-pressed', 'true');
            if (checkIcon) checkIcon.classList.remove('hidden');
        } else {
            btn.classList.remove('theme-preset-active', 'scale-[1.02]', 'ring-2', 'ring-blue-600', 'bg-blue-50/60', 'border-blue-300');
            btn.classList.add('border-gray-200/80');
            btn.style.borderColor = '';
            btn.style.boxShadow = '';
            btn.style.outline = '';
            btn.setAttribute('aria-pressed', 'false');
            if (checkIcon) checkIcon.classList.add('hidden');
        }
    });
}

/**
 * Generates theme preset buttons inside configuration panel
 */
export function renderThemePresets() {
    const container = $('theme-presets-container');
    if (!container) return;

    container.innerHTML = SYSTEM_THEMES.map(theme => `
        <button type="button" 
            data-theme-id="${theme.id}"
            title="${theme.name} (${theme.desc})"
            onclick="selectThemePreset('${theme.id}')"
            class="theme-preset-btn group relative flex items-center justify-start gap-2 sm:gap-2.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl bg-white hover:bg-gray-100/80 border border-gray-200/80 shadow-2xs transition-all cursor-pointer min-w-0">
            <span class="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-110" 
                style="background-color: ${theme.primary};">
                <i class="fas fa-check text-[9px] hidden" style="color: ${theme.contrast};"></i>
            </span>
            <span class="text-[11px] sm:text-xs text-gray-700 font-semibold truncate leading-tight">${theme.name.split(' ')[0]}</span>
        </button>
    `).join('');
}

/**
 * Handles selecting a preset from the UI
 */
export function selectThemePreset(themeId) {
    const theme = SYSTEM_THEMES.find(t => t.id === themeId);
    if (!theme) return;
    if (!state.config) state.config = {};
    state.config.themeId = theme.id;
    applySystemTheme(theme.primary, theme.contrast, theme.id);
}

/**
 * Handles toggling module contrast (White vs Black)
 */
export function setModuleContrast(contrastColor) {
    if (!state.config) state.config = {};
    state.config.contrastColor = contrastColor;
    applySystemTheme(state.config.primaryColor, contrastColor, state.config.themeId || 'custom');
}

/**
 * Sets up live color picker input listener
 */
export function initThemeListeners() {
    const primaryInput = $('conf-primary-color');
    if (primaryInput) {
        primaryInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            const contrast = state.config?.contrastColor || '#64010e';
            applySystemTheme(newColor, contrast, 'custom');
        });
    }

    const sidebarInput = $('conf-sidebar-color');
    if (sidebarInput) {
        sidebarInput.addEventListener('input', (e) => {
            const newColor = e.target.value;
            applySidebarTheme(newColor, state.config?.primaryColor);
        });
    }
}

// Bind to window for HTML inline calls (onclick="...")
window.SYSTEM_THEMES = SYSTEM_THEMES;
window.applySystemTheme = applySystemTheme;
window.applySidebarTheme = applySidebarTheme;
window.updateThemePresetUI = updateThemePresetUI;
window.renderThemePresets = renderThemePresets;
window.selectThemePreset = selectThemePreset;
window.setModuleContrast = setModuleContrast;
