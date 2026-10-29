/**
 * saasService.js — DigiRest v2
 * Gestiona la comunicación con panel.digidan.co (SaaS Manager Central)
 * Incluye caché de 30 min + soporte de Push Webhooks firmados con HMAC-SHA256.
 */

const axios = require('axios');
const crypto = require('crypto');

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos (invalidación inmediata vía Push Webhook)
const NEGATIVE_CACHE_TTL_MS = 30 * 1000; // 30 segundos ante caída de red para evitar tormentas de reintentos
const WEBHOOK_MAX_SKEW_SECONDS = 300; // ±5 minutos anti-replay

let _cache = null;
let _cacheExpiry = 0;
let _inflightStatus = null;

let _anunciosCache = null;
let _anunciosExpiry = 0;
let _inflightAnuncios = null;

function getBogotaTodayYMD() {
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Bogota',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
    } catch (_) {
        return new Date(Date.now() - 5 * 3600 * 1000).toISOString().split('T')[0];
    }
}

function checkIsExpired(vencimiento) {
    if (!vencimiento || typeof vencimiento !== 'string') return false;
    const rawDate = vencimiento.includes('T') ? vencimiento.split('T')[0] : vencimiento.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return false;
    return getBogotaTodayYMD() > rawDate;
}

/**
 * Obtiene y sanitiza las variables de entorno para SaaS Central en tiempo de ejecución.
 */
function getSaasConfig() {
    let url = (process.env.SAAS_MANAGER_URL || '').trim();
    url = url.replace(/\/+$/, '');
    const key = (process.env.SAAS_TENANT_KEY || '').trim();
    return { url, key };
}

/**
 * Retorna el último estado en caché sin realizar llamadas de red (O(1)).
 */
function getCachedSaaSStatus() {
    if (_cache && Date.now() < _cacheExpiry) {
        return _cache;
    }
    return null;
}

/**
 * Obtiene el estado del SaaS Manager Central (con caché de 30 min y deduplicación en vuelo)
 */
async function getSaaSStatus(forceRefresh = false) {
    const { url, key } = getSaasConfig();

    if (!url || !key) {
        return {
            configured: false,
            estado: 'Activa',
            saldo_documentos: 0,
            vencimiento: null,
            mensaje: 'Variables SAAS_MANAGER_URL o SAAS_TENANT_KEY no configuradas'
        };
    }

    if (!forceRefresh && _cache && Date.now() < _cacheExpiry) {
        return _cache;
    }

    if (_inflightStatus) {
        return _inflightStatus;
    }

    _inflightStatus = (async () => {
        try {
            const response = await axios.get(`${url}/api/v1/tenant/status`, {
                headers: { Authorization: `Bearer ${key}` },
                timeout: 5000
            });

            const raw = response.data || {};
            const vencimiento = raw.vencimiento_suscripcion || raw.vencimiento_documentos || null;
            const isExpired = checkIsExpired(vencimiento);
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
            console.error(`[DigiRest SaaS] Error consultando estado SaaS:`, error.response?.status || error.message);
            const fallback = _cache
                ? { ..._cache, stale: true }
                : {
                    configured: true,
                    error: true,
                    estado: 'Desconocido',
                    saldo_documentos: 0,
                    vencimiento: null,
                    mensaje: 'No se pudo conectar temporalmente con el servidor central de suscripciones'
                };
            _cache = fallback;
            _cacheExpiry = Date.now() + NEGATIVE_CACHE_TTL_MS;
            return fallback;
        } finally {
            _inflightStatus = null;
        }
    })();

    return _inflightStatus;
}

/**
 * Obtiene los anuncios/novedades activos del panel con caché de 30 minutos.
 */
async function getAnunciosActivos(forceRefresh = false) {
    const { url, key } = getSaasConfig();
    if (!url || !key) return [];

    if (!forceRefresh && _anunciosCache && Date.now() < _anunciosExpiry) {
        return _anunciosCache;
    }

    if (_inflightAnuncios) {
        return _inflightAnuncios;
    }

    _inflightAnuncios = (async () => {
        try {
            const response = await axios.get(`${url}/api/v1/tenant/anuncios`, {
                headers: { Authorization: `Bearer ${key}` },
                timeout: 5000
            });
            const list = Array.isArray(response.data) ? response.data : [];
            _anunciosCache = list;
            _anunciosExpiry = Date.now() + CACHE_TTL_MS;
            return list;
        } catch (error) {
            console.error(`[DigiRest SaaS] Error obteniendo anuncios:`, error.response?.status || error.message);
            _anunciosCache = _anunciosCache || [];
            _anunciosExpiry = Date.now() + NEGATIVE_CACHE_TTL_MS;
            return _anunciosCache;
        } finally {
            _inflightAnuncios = null;
        }
    })();

    return _inflightAnuncios;
}

/**
 * Verifica la firma HMAC-SHA256 enviada por panel.digidan.co en POST /api/saas/webhook
 */
function verifySaaSWebhookSignature(rawTimestamp, signatureHeader, bodyObj) {
    const { key } = getSaasConfig();
    if (!key || !rawTimestamp || !signatureHeader) return false;

    const ts = Number(rawTimestamp);
    if (!Number.isFinite(ts)) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > WEBHOOK_MAX_SKEW_SECONDS) return false;

    const cleanSig = String(signatureHeader).replace(/^sha256=/i, '').trim();
    if (!/^[0-9a-f]{64}$/i.test(cleanSig)) return false;

    const payloadString = `${ts}.${JSON.stringify(bodyObj || {})}`;
    const expectedHex = crypto.createHmac('sha256', key).update(payloadString).digest('hex');

    const sigBuf = Buffer.from(cleanSig, 'hex');
    const expBuf = Buffer.from(expectedHex, 'hex');
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Invalida el caché local (y aplica estado inmediato si viene en el webhook).
 */
function invalidateCache(webhookData = null) {
    _cache = null;
    _cacheExpiry = 0;
    _anunciosCache = null;
    _anunciosExpiry = 0;

    if (webhookData && typeof webhookData === 'object' && webhookData.estado_suscripcion) {
        const vencimiento = webhookData.vencimiento_suscripcion || webhookData.vencimiento_documentos || null;
        const isExpired = checkIsExpired(vencimiento);
        const isSuspended = (
            webhookData.estado_suscripcion === 'Suspendido' ||
            webhookData.estado_suscripcion === 'Suspendida' ||
            isExpired
        );
        _cache = {
            configured: true,
            estado: isSuspended ? 'Suspendida' : 'Activa',
            isExpired,
            saldo_documentos: typeof webhookData.saldo_documentos === 'number' ? webhookData.saldo_documentos : 0,
            vencimiento,
            subdominio: webhookData.subdominio || ''
        };
        _cacheExpiry = Date.now() + CACHE_TTL_MS;
    }
}

module.exports = {
    getSaaSStatus,
    getCachedSaaSStatus,
    getAnunciosActivos,
    verifySaaSWebhookSignature,
    invalidateCache,
    getSaasConfig
};

