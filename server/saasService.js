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

/**
 * Obtiene y sanitiza las variables de entorno para SaaS Central en tiempo de ejecución.
 */
function getSaasConfig() {
    let url = (process.env.SAAS_MANAGER_URL || '').trim();
    // Eliminar barra diagonal final si existe
    url = url.replace(/\/+$/, '');
    const key = (process.env.SAAS_TENANT_KEY || '').trim();
    return { url, key };
}

/**
 * Obtiene el estado del SaaS Manager Central (con caché de 10 s)
 * Retorna: { configured: boolean, estado: 'Activa'|'Suspendida'|'Desconocido', saldo_documentos: number, vencimiento: string|null, error?: string }
 */
async function getSaaSStatus() {
    const { url, key } = getSaasConfig();

    // Si no está configurado, retorna un fallback informativo
    if (!url || !key) {
        console.warn('[DigiRest SaaS] Variables SAAS_MANAGER_URL o SAAS_TENANT_KEY no configuradas en el entorno.');
        return {
            configured: false,
            estado: 'Activa',
            saldo_documentos: 0,
            vencimiento: null,
            mensaje: 'Variables SAAS_MANAGER_URL o SAAS_TENANT_KEY no configuradas en Dokploy'
        };
    }

    // Intentar caché en memoria
    if (_cache && Date.now() < _cacheExpiry) {
        return _cache;
    }

    try {
        console.log(`[DigiRest SaaS] Consultando estado a: ${url}/api/v1/tenant/status`);
        const response = await axios.get(`${url}/api/v1/tenant/status`, {
            headers: { Authorization: `Bearer ${key}` },
            timeout: 6000
        });

        const raw = response.data;
        let isExpired = false;
        const vencimiento = raw.vencimiento_suscripcion || raw.vencimiento_documentos || null;
        if (vencimiento) {
            const rawDate = vencimiento.includes('T') ? vencimiento.split('T')[0] : vencimiento;
            const parts = rawDate.split('-');
            if (parts.length >= 3) {
                const expDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999);
                if (new Date() > expDate) {
                    isExpired = true;
                }
            }
        }
        const isSuspended = (raw.estado_suscripcion === 'Suspendido' || raw.estado_suscripcion === 'Suspendida' || isExpired);
        const statusData = {
            configured: true,
            estado: isSuspended ? 'Suspendida' : 'Activa',
            isExpired,
            saldo_documentos: typeof raw.saldo_documentos === 'number' ? raw.saldo_documentos : 0,
            vencimiento,
            subdominio: raw.subdominio || ''
        };

        _cache = statusData;
        _cacheExpiry = Date.now() + CACHE_TTL_MS;

        return statusData;
    } catch (error) {
        console.error(`[DigiRest SaaS] Error consultando ${url}/api/v1/tenant/status:`, error.response?.status, error.response?.data || error.message);
        // Retornar fallback estructurado para no tumbar la aplicación
        return {
            configured: true,
            error: true,
            estado: 'Desconocido',
            saldo_documentos: 0,
            vencimiento: null,
            mensaje: `No se pudo conectar con el SaaS Central (${url}): ${error.response?.data?.error || error.message}`
        };
    }
}

/**
 * Obtiene los anuncios/novedades activos del panel para mostrarlos al admin.
 */
async function getAnunciosActivos() {
    const { url, key } = getSaasConfig();
    if (!url || !key) {
        console.warn('[DigiRest SaaS] getAnunciosActivos: SAAS_MANAGER_URL o SAAS_TENANT_KEY no están definidas.');
        return [];
    }
    try {
        console.log(`[DigiRest SaaS] Solicitando anuncios a: ${url}/api/v1/tenant/anuncios`);
        const response = await axios.get(`${url}/api/v1/tenant/anuncios`, {
            headers: { Authorization: `Bearer ${key}` },
            timeout: 6000
        });
        const list = Array.isArray(response.data) ? response.data : [];
        console.log(`[DigiRest SaaS] Anuncios activos recibidos: ${list.length}`);
        return list;
    } catch (error) {
        console.error(`[DigiRest SaaS] Error obteniendo anuncios de ${url}:`, error.response?.status, error.response?.data || error.message);
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

module.exports = { getSaaSStatus, getAnunciosActivos, invalidateCache, getSaasConfig };

