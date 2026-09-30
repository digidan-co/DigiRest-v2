<template>
  <div v-if="loaded" class="saas-status-panel">
    <div class="saas-header">
      <div class="saas-title-group">
        <span class="saas-section-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Suscripción Activa (Estado SaaS Central)
        </span>
        <span class="saas-tenant-badge" v-if="status.subdominio">
          {{ status.subdominio }}
        </span>
      </div>

      <button type="button" class="saas-btn-refresh" @click="loadStatus" :disabled="loading" title="Actualizar estado">
        <svg :class="['w-3.5 h-3.5', loading ? 'animate-spin' : '']" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        <span class="text-[11px] font-semibold">Actualizar</span>
      </button>
    </div>

    <div class="saas-card">
      <!-- Fila superior: Badge de suscripción y documentos -->
      <div class="saas-top-row">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="saas-badge" :class="estadoBadgeClass">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline v-if="isActiva" points="20 6 9 17 4 12"/>
              <g v-else>
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </g>
            </svg>
            {{ isActiva ? 'Plan Activo' : (status.estado === 'Desconocido' ? 'Conexión Pendiente' : 'Suscripción Suspendida') }}
          </span>

          <span class="saas-badge saas-badge--neutral" v-if="status.configured === false">
            ⚠️ Sin Configurar
          </span>
        </div>

        <span class="saas-docs-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <strong>{{ status.saldo_documentos }}</strong> Documentos Restantes
        </span>
      </div>

      <!-- CONTENEDOR DESTACADO: Fecha Límite de Suspensión -->
      <div class="saas-suspension-box" :class="{ 'saas-suspension-box--urgent': isUrgent }">
        <div class="saas-suspension-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </div>
        <div class="saas-suspension-content">
          <div class="saas-suspension-label">Fecha Límite para Suspensión</div>
          <div class="saas-suspension-value">
            <span v-if="status.vencimiento" class="saas-date-text">
              {{ formatDate(status.vencimiento) }}
            </span>
            <span v-else class="saas-date-text saas-date-text--empty">
              Sin fecha de suspensión registrada en panel
            </span>

            <span v-if="daysRemainingText" class="saas-days-badge" :class="daysBadgeClass">
              {{ daysRemainingText }}
            </span>
          </div>
        </div>
      </div>

      <!-- Descripción comercial -->
      <p class="saas-description">
        Tu suscripción actual se encuentra <strong>{{ isActiva ? 'Activa' : (status.estado || 'en revisión') }}</strong>.
        Tienes un total de <strong>{{ status.saldo_documentos }} documentos disponibles</strong> para emitir Facturas Electrónicas, Notas o Documentos POS.
      </p>

      <!-- Barra de progreso de documentos disponibles -->
      <div class="saas-progress-container">
        <div class="saas-progress-track">
          <div
            class="saas-progress-bar"
            :style="{ width: barWidth, backgroundColor: barColor }"
          ></div>
        </div>
      </div>

      <!-- Alertas de saldo -->
      <p v-if="status.saldo_documentos <= 10 && status.saldo_documentos > 0" class="saas-warn-msg saas-warn-msg--warning">
        ⚠️ Quedan muy pocos documentos DIAN. Contáctate con soporte en digidan.co para recargar.
      </p>
      <p v-if="status.saldo_documentos === 0 && status.configured" class="saas-warn-msg saas-warn-msg--critical">
        🚫 Sin saldo de documentos. Recarga en panel.digidan.co para emitir documentos electrónicos.
      </p>

      <!-- Aviso de configuración o error si aplica -->
      <div v-if="status.error || status.configured === false" class="saas-conn-error">
        <div class="flex items-start gap-2">
          <span class="text-amber-500 font-bold">⚠️</span>
          <div>
            <div class="font-bold text-xs text-amber-900">Configuración SaaS en Dokploy</div>
            <p class="text-[11px] text-amber-800 mt-0.5">
              {{ status.mensaje || 'Verifica que la variable SAAS_MANAGER_URL sea https://app.digidan.co y que el contenedor haya sido redesplegado.' }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const status = ref({
  configured: true,
  estado: 'Activa',
  saldo_documentos: 0,
  vencimiento: null,
  subdominio: ''
});
const loaded = ref(false);
const loading = ref(false);

const isActiva = computed(() => status.value.estado === 'Activa');

const estadoBadgeClass = computed(() => {
  if (status.value.estado === 'Activa') return 'saas-badge--activo';
  if (status.value.estado === 'Desconocido') return 'saas-badge--unknown';
  return 'saas-badge--suspendido';
});

const barWidth = computed(() => {
  const s = status.value.saldo_documentos;
  if (!s || s <= 0) return '0%';
  if (s >= 1000) return '100%';
  return `${Math.min(100, Math.max(3, (s / 1000) * 100))}%`;
});

const barColor = computed(() => {
  const s = status.value.saldo_documentos;
  if (s <= 10) return '#EF4444';
  if (s <= 50) return '#F59E0B';
  return 'var(--system-primary, #f97316)';
});

function parseDateObject(dt) {
  if (!dt) return null;
  try {
    const str = String(dt).trim();
    const isoLike = str.includes('T') ? str : `${str.replace(' ', 'T')}`;
    let d = new Date(isoLike);
    if (!isNaN(d.getTime())) return d;
    const m = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      if (!isNaN(d.getTime())) return d;
    }
  } catch (e) {}
  return null;
}

function formatDate(dt) {
  const d = parseDateObject(dt);
  if (!d) return 'No definida';
  return d.toLocaleDateString('es-CO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

const daysRemaining = computed(() => {
  if (!status.value.vencimiento) return null;
  const d = parseDateObject(status.value.vencimiento);
  if (!d) return null;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

const daysRemainingText = computed(() => {
  const days = daysRemaining.value;
  if (days === null) return null;
  if (days < 0) return `Venció hace ${Math.abs(days)} días`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Queda 1 día';
  return `Quedan ${days} días`;
});

const isUrgent = computed(() => {
  const days = daysRemaining.value;
  return days !== null && days <= 5;
});

const daysBadgeClass = computed(() => {
  const days = daysRemaining.value;
  if (days === null) return '';
  if (days < 0) return 'saas-days-badge--expired';
  if (days <= 3) return 'saas-days-badge--danger';
  if (days <= 7) return 'saas-days-badge--warning';
  return 'saas-days-badge--ok';
});

async function loadStatus() {
  loading.value = true;
  try {
    const token = localStorage.getItem('pos_token') || localStorage.getItem('token');
    const res = await fetch('/api/saas/status', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        status.value = data;
      }
    }
  } catch (e) {
    console.warn('[SaasStatusPanel] Error loading status:', e);
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}

onMounted(() => {
  loadStatus();
  window.addEventListener('saas-refresh', loadStatus);
  window.addEventListener('offline_sync_complete', loadStatus);
});

onUnmounted(() => {
  window.removeEventListener('saas-refresh', loadStatus);
  window.removeEventListener('offline_sync_complete', loadStatus);
});
</script>

<style scoped>
.saas-status-panel {
  font-family: inherit;
  margin-top: 1rem;
  margin-bottom: 1.25rem;
}

.saas-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.65rem;
  gap: 0.75rem;
}

.saas-title-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.saas-section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #4B5563;
}

.saas-tenant-badge {
  font-size: 0.65rem;
  font-weight: 700;
  background: #EFF6FF;
  color: #2563EB;
  padding: 0.15rem 0.5rem;
  border-radius: 99px;
  border: 1px solid #DBEAFE;
}

.saas-btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.65rem;
  border-radius: 0.5rem;
  background: #F3F4F6;
  border: 1px solid #E5E7EB;
  color: #4B5563;
  cursor: pointer;
  transition: all 0.15s ease;
}
.saas-btn-refresh:hover:not(:disabled) {
  background: #E5E7EB;
  color: #111827;
}

.saas-card {
  background: #ffffff;
  border: 1px solid #E5E7EB;
  border-radius: 1rem;
  padding: 1.15rem 1.25rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.saas-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.saas-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.85rem;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.saas-badge--activo {
  background: #10B981;
  color: #ffffff;
}
.saas-badge--suspendido {
  background: #EF4444;
  color: #ffffff;
}
.saas-badge--unknown {
  background: #F59E0B;
  color: #ffffff;
}
.saas-badge--neutral {
  background: #FEF3C7;
  color: #92400E;
  border: 1px solid #FDE68A;
}

.saas-docs-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #374151;
  background: #F9FAFB;
  padding: 0.3rem 0.7rem;
  border-radius: 0.6rem;
  border: 1px solid #E5E7EB;
}

/* Destacado de Fecha Límite de Suspensión */
.saas-suspension-box {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.85rem 1.1rem;
  background: #F8FAFC;
  border: 1.5px solid #E2E8F0;
  border-radius: 0.85rem;
  margin-bottom: 0.9rem;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.saas-suspension-box--urgent {
  background: #FFF1F2;
  border-color: #FECDD3;
}

.saas-suspension-icon {
  width: 42px;
  height: 42px;
  border-radius: 0.7rem;
  background: #EFF6FF;
  color: #3B82F6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.saas-suspension-box--urgent .saas-suspension-icon {
  background: #FFE4E6;
  color: #E11D48;
}

.saas-suspension-content {
  flex: 1;
  min-width: 0;
}

.saas-suspension-label {
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748B;
  margin-bottom: 0.15rem;
}
.saas-suspension-box--urgent .saas-suspension-label {
  color: #BE123C;
}

.saas-suspension-value {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.saas-date-text {
  font-size: 0.95rem;
  font-weight: 800;
  color: #0F172A;
  text-transform: capitalize;
}
.saas-date-text--empty {
  font-size: 0.82rem;
  font-weight: 600;
  color: #94A3B8;
  font-style: italic;
  text-transform: none;
}

.saas-days-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 99px;
  letter-spacing: 0.02em;
}
.saas-days-badge--ok {
  background: #ECFDF5;
  color: #059669;
  border: 1px solid #A7F3D0;
}
.saas-days-badge--warning {
  background: #FFFBEB;
  color: #D97706;
  border: 1px solid #FDE68A;
}
.saas-days-badge--danger {
  background: #FEF2F2;
  color: #DC2626;
  border: 1px solid #FECACA;
  animation: pulseBadge 1.5s infinite;
}
.saas-days-badge--expired {
  background: #450A0A;
  color: #FCA5A5;
}

@keyframes pulseBadge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.saas-description {
  font-size: 0.82rem;
  color: #6B7280;
  line-height: 1.55;
  margin: 0 0 0.85rem 0;
}
.saas-description strong {
  color: #1F2937;
}

.saas-progress-container {
  margin-bottom: 0.5rem;
}

.saas-progress-track {
  height: 8px;
  background: #F3F4F6;
  border-radius: 99px;
  overflow: hidden;
}

.saas-progress-bar {
  height: 100%;
  border-radius: 99px;
  transition: width 0.6s ease, background-color 0.3s;
  min-width: 4px;
}

.saas-warn-msg {
  font-size: 0.75rem;
  font-weight: 600;
  margin: 0.45rem 0 0 0;
  padding: 0.35rem 0.65rem;
  border-radius: 0.5rem;
}
.saas-warn-msg--warning {
  background: #FFFBEB;
  color: #B45309;
  border: 1px solid #FDE68A;
}
.saas-warn-msg--critical {
  background: #FEF2F2;
  color: #B91C1C;
  border: 1px solid #FECACA;
}

.saas-conn-error {
  margin-top: 0.75rem;
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
}
</style>
