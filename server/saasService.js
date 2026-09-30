/**
 * saasService.js — DigiRest v2
 * Gestiona la comunicación con panel.digidan.co (SaaS Manager Central)
 * Patrón idéntico al de digiPOS v2 para mantener consistencia.
 */

const axios = require('axios');

// Cache simple en memoria (10 segundos de TTL)
let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 10000;

const SAAS_MANAGER_URL = process.env.SAAS_MANAGER_URL;
const SAAS_TENANT_KEY  = process.env.SAAS_TENANT_KEY;

/**
 * Obtiene el estado del SaaS Manager Central (con caché de 10 s)
 * Retorna: { estado: 'Activa'|'Suspendida', saldo_documentos: number, vencimiento: string|null }
 */
async function getSaaSStatus() {
    // Si no está configurado, retorna un fallback permisivo
    if (!SAAS_MANAGER_URL || !SAAS_TENANT_KEY) {
        return {
            estado: 'Activa',
            saldo_documentos: 999999,
            vencimiento: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString()
        };
    }

    // Intentar caché en memoria
    if (_cache && Date.now() < _cacheExpiry) {
        return _cache;
    }

    try {
        const response = await axios.get(`${SAAS_MANAGER_URL}/api/v1/tenant/status`, {
            headers: { Authorization: `Bearer ${SAAS_TENANT_KEY}` },
            timeout: 5000
        });

        const raw = response.data;
        const statusData = {
            estado: raw.estado_suscripcion === 'Activo' ? 'Activa' : 'Suspendida',
            saldo_documentos: raw.saldo_documentos || 0,
            vencimiento: raw.vencimiento_suscripcion || raw.vencimiento_documentos || null
        };

        _cache = statusData;
        _cacheExpiry = Date.now() + CACHE_TTL_MS;

        return statusData;
    } catch (error) {
        console.error('[DigiRest SaaS] Error consultando panel:', error.message);
        throw new Error('No se pudo validar la suscripción SaaS.');
    }
}

/**
 * Obtiene los anuncios/novedades activos del panel para mostrarlos al admin al iniciar sesión.
 */
async function getAnunciosActivos() {
    if (!SAAS_MANAGER_URL || !SAAS_TENANT_KEY) return [];
    try {
        const response = await axios.get(`${SAAS_MANAGER_URL}/api/v1/tenant/anuncios`, {
            headers: { Authorization: `Bearer ${SAAS_TENANT_KEY}` },
            timeout: 5000
        });
        return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
        console.error('[DigiRest SaaS] Error obteniendo anuncios:', error.message);
        return [];
    }
}

/**
 * Invalida el caché local (usar después de cambios de suscripción)
 */
function invalidateCache() {
    _cache = null;
    _cacheExpiry = 0;
}

module.exports = { getSaaSStatus, getAnunciosActivos, invalidateCache };
