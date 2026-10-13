/**
 * Utility: date-helper.js
 * DigiRest v2 - Control Horario de Jornadas y Anulaciones
 * 
 * Determina el corte de jornada a las 11:59:59 p. m. en la zona horaria del restaurante (America/Bogota).
 */

const TIMEZONE = 'America/Bogota';

/**
 * Retorna la fecha YYYY-MM-DD en la zona horaria de Colombia para una fecha/timestamp dada.
 * @param {string|number|Date} timestamp 
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
function getColombiaDateString(timestamp = new Date()) {
    try {
        const d = timestamp ? new Date(timestamp) : new Date();
        if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
        return d.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    } catch (e) {
        return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    }
}

/**
 * Valida si un pedido fue creado en la misma jornada del día actual (hasta las 11:59:59 p. m.)
 * @param {string|number|Date} orderTimestamp - Fecha/hora de creación del pedido
 * @returns {boolean} true si el pedido fue registrado hoy; false si pertenece a un día anterior
 */
function isSameDayOrder(orderTimestamp) {
    if (!orderTimestamp) return false;
    const orderDate = getColombiaDateString(orderTimestamp);
    const todayDate = getColombiaDateString(new Date());
    return orderDate === todayDate;
}

module.exports = {
    TIMEZONE,
    getColombiaDateString,
    isSameDayOrder
};
