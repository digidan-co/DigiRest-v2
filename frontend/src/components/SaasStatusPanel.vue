<template>
  <div v-if="loaded" class="saas-status-panel">
    <div class="saas-header">
      <span class="saas-section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Suscripción Activa (Estado SaaS)
      </span>
    </div>

    <div class="saas-card">
      <!-- Badge de estado -->
      <div class="saas-top-row">
        <span class="saas-badge" :class="estadoBadgeClass">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline v-if="isActiva" points="20 6 9 17 4 12"/>
            <g v-else>
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </g>
          </svg>
          {{ isActiva ? 'Plan Activo' : 'Suscripción Suspendida' }}
        </span>
        <span class="saas-docs-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          {{ status.saldo_documentos }} Documentos Restantes
        </span>
      </div>

      <!-- Descripción -->
      <p class="saas-description">
        Tu suscripción actual se encuentra <strong>{{ isActiva ? 'Activa' : 'Suspendida' }}</strong>.
        Tienes un total de <strong>{{ status.saldo_documentos }} documentos disponibles</strong> para emitir Facturas Electrónicas, Notas o Documentos POS.
        <template v-if="status.vencimiento">
          Vence el: <strong>{{ formatDate(status.vencimiento) }}</strong>
        </template>
      </p>

      <!-- Barra de progreso de documentos -->
      <div class="saas-progress-track">
        <div
          class="saas-progress-bar"
          :style="{ width: barWidth, backgroundColor: barColor }"
        ></div>
      </div>

      <!-- Aviso crítico de documentos bajos -->
      <p v-if="status.saldo_documentos <= 10 && status.saldo_documentos > 0" class="saas-low-docs-warn">
        ⚠️ Quedan muy pocos documentos. Contáctate con soporte para recargar.
      </p>
      <p v-if="status.saldo_documentos === 0" class="saas-low-docs-warn saas-low-docs-warn--critical">
        🚫 Sin saldo de documentos. No podrás emitir facturas electrónicas.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const status = ref({ estado: 'Activa', saldo_documentos: 0, vencimiento: null });
const loaded = ref(false);

const isActiva = computed(() => status.value.estado === 'Activa');

const estadoBadgeClass = computed(() => isActiva.value ? 'saas-badge--activo' : 'saas-badge--suspendido');

const barWidth = computed(() => {
  const s = status.value.saldo_documentos;
  if (s <= 0) return '0%';
  if (s >= 1000) return '100%';
  return `${Math.min(100, (s / 1000) * 100)}%`;
});

const barColor = computed(() => {
  const s = status.value.saldo_documentos;
  if (s <= 10) return '#EF4444';
  if (s <= 50) return '#F59E0B';
  return 'var(--system-primary, #f97316)';
});

function formatDate(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function loadStatus() {
  try {
    const token = localStorage.getItem('pos_token') || localStorage.getItem('token');
    const res = await fetch('/api/saas/status', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data = await res.json();
      status.value = data;
    }
  } catch (e) { /* silent */ }
  finally { loaded.value = true; }
}

onMounted(loadStatus);
</script>

<style scoped>
.saas-status-panel {
  font-family: inherit;
  margin-top: 0.75rem;
}

.saas-header {
  margin-bottom: 0.5rem;
}

.saas-section-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6B7280;
}

.saas-card {
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 0.875rem;
  padding: 1rem 1.125rem;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}

.saas-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.saas-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.75rem;
  border-radius: 99px;
  font-size: 0.75rem;
  font-weight: 700;
}
.saas-badge--activo {
  background: var(--system-primary, #f97316);
  color: #fff;
}
.saas-badge--suspendido {
  background: #EF4444;
  color: #fff;
}

.saas-docs-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: #374151;
}

.saas-description {
  font-size: 0.82rem;
  color: #6B7280;
  line-height: 1.6;
  margin: 0 0 0.75rem 0;
}
.saas-description strong { color: #111827; }

.saas-progress-track {
  height: 7px;
  background: #F3F4F6;
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.saas-progress-bar {
  height: 100%;
  border-radius: 99px;
  transition: width 0.6s ease, background-color 0.3s;
  min-width: 2px;
}

.saas-low-docs-warn {
  font-size: 0.75rem;
  font-weight: 600;
  color: #D97706;
  margin: 0.4rem 0 0 0;
}
.saas-low-docs-warn--critical { color: #DC2626; }
</style>
