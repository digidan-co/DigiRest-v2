<template>
  <div v-if="loaded" class="saas-widget">
    <div
      class="flex items-center gap-3 bg-gray-50 border border-gray-200/80 px-4 py-2.5 rounded-xl shadow-xs hover:border-gray-300 transition-all select-none"
      :class="{ 'border-rose-300 bg-rose-50/30': isSuspended || isUrgent }"
    >
      <div class="flex flex-col justify-center">
        <!-- Fila superior: Título y Badge de Estado -->
        <div class="flex items-center gap-2">
          <h4 class="font-bold text-gray-800 text-xs leading-tight flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Suscripción
          </h4>
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-none tracking-tight"
            :class="statusBadgeClass"
          >
            <span class="w-1.5 h-1.5 rounded-full" :class="statusDotClass"></span>
            {{ statusLabel }}
          </span>
          <span
            v-if="status.configured === false"
            class="text-[10px] text-amber-600 font-semibold cursor-help"
            title="Configuración SaaS pendiente en Dokploy"
          >
            ⚠️
          </span>
        </div>

        <!-- Fila inferior: Saldo de documentos y Vencimiento -->
        <p class="text-[10px] text-gray-400 mt-0.5 leading-tight flex items-center gap-1.5">
          <span
            class="font-semibold text-gray-600 flex items-center gap-0.5"
            :class="{ 'text-amber-600 font-bold': status.saldo_documentos <= 10 && status.saldo_documentos > 0, 'text-rose-600 font-bold': status.saldo_documentos === 0 }"
            :title="`${status.saldo_documentos} documentos disponibles para facturación`"
          >
            <svg class="w-2.5 h-2.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {{ status.saldo_documentos ?? 0 }} docs
          </span>
          <span class="text-gray-300">•</span>
          <span
            :class="daysClass"
            :title="status.vencimiento ? `Fecha límite: ${formatDate(status.vencimiento)}` : 'Sin fecha registrada'"
          >
            {{ compactVencimientoText }}
          </span>
        </p>
      </div>

      <!-- Botón sutil de actualización -->
      <button
        type="button"
        @click="loadStatus"
        :disabled="loading"
        class="ml-0.5 p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-200/70 transition-all cursor-pointer disabled:opacity-50"
        title="Actualizar estado de suscripción"
      >
        <svg
          :class="['w-3.5 h-3.5', loading ? 'animate-spin text-gray-600' : '']"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
      </button>
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
const isSuspended = computed(() => status.value.estado && status.value.estado !== 'Activa' && status.value.estado !== 'Desconocido');

const statusLabel = computed(() => {
  if (status.value.estado === 'Activa') return 'Activa';
  if (status.value.estado === 'Desconocido') return 'Pendiente';
  return 'Suspendida';
});

const statusBadgeClass = computed(() => {
  if (status.value.estado === 'Activa') return 'bg-emerald-100 text-emerald-800 border border-emerald-200/80';
  if (status.value.estado === 'Desconocido') return 'bg-amber-100 text-amber-800 border border-amber-200/80';
  return 'bg-rose-100 text-rose-800 border border-rose-200/80';
});

const statusDotClass = computed(() => {
  if (status.value.estado === 'Activa') return 'bg-emerald-500';
  if (status.value.estado === 'Desconocido') return 'bg-amber-500';
  return 'bg-rose-500 animate-pulse';
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

const compactVencimientoText = computed(() => {
  if (!status.value.vencimiento) return 'Sin fecha';
  const days = daysRemaining.value;
  if (days === null) return 'No definida';
  if (days < 0) return `Venció hace ${Math.abs(days)}d`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Queda 1 día';
  return `Quedan ${days} días`;
});

const isUrgent = computed(() => {
  const days = daysRemaining.value;
  return days !== null && days <= 5;
});

const daysClass = computed(() => {
  const days = daysRemaining.value;
  if (days === null) return 'text-gray-400';
  if (days < 0) return 'text-rose-600 font-bold';
  if (days <= 3) return 'text-rose-500 font-bold';
  if (days <= 7) return 'text-amber-600 font-semibold';
  return 'text-gray-500';
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
.saas-widget {
  font-family: inherit;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
