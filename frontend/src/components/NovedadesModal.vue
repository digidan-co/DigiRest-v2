<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show && anuncios.length > 0" class="nv-overlay" @click.self="dismiss">
        <div class="nv-card">
          <!-- Header -->
          <div class="nv-header">
            <div class="nv-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <div>
              <h2 class="nv-title">Novedades y Anuncios</h2>
              <p class="nv-subtitle">Actualizaciones recientes de tu plataforma DigiRest</p>
            </div>
            <button class="nv-close" @click="dismiss">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- Paginación de anuncios -->
          <div class="nv-body">
            <div class="nv-anuncio" :class="'nv-anuncio--' + current.tipo">
              <div class="nv-anuncio-header">
                <span class="nv-tipo-badge" :class="'badge--' + current.tipo">
                  {{ tipoEmoji(current.tipo) }} {{ tipoLabel(current.tipo) }}
                </span>
                <span class="nv-fecha">{{ formatDate(current.created_at) }}</span>
              </div>
              <h3 class="nv-anuncio-titulo">{{ current.titulo }}</h3>
              <p class="nv-anuncio-contenido">{{ current.contenido }}</p>
            </div>
          </div>

          <!-- Navegación y footer -->
          <div class="nv-footer">
            <div class="nv-dots" v-if="anuncios.length > 1">
              <button
                v-for="(_, i) in anuncios"
                :key="i"
                :class="['nv-dot', i === currentIndex ? 'nv-dot--active' : '']"
                @click="currentIndex = i"
              ></button>
            </div>
            <div class="nv-nav-btns">
              <button v-if="currentIndex > 0" class="nv-nav-btn" @click="currentIndex--">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Anterior
              </button>
              <button v-if="currentIndex < anuncios.length - 1" class="nv-nav-btn nv-nav-btn--next" @click="currentIndex++">
                Siguiente
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button v-else class="nv-btn-dismiss" @click="dismiss">
                Entendido
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const show = ref(false);
const anuncios = ref([]);
const currentIndex = ref(0);

const current = computed(() => anuncios.value[currentIndex.value] || {});

const SEEN_STORAGE_KEY = '_anuncios_vistos_digirest';

function getSeenIds() {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function dismiss() {
  show.value = false;
  const currentSeen = getSeenIds();
  const newSeen = [...new Set([...currentSeen, ...anuncios.value.map(a => a.id)])];
  localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(newSeen));
  sessionStorage.removeItem('_anuncios_digirest');
}

const tipoEmoji = (t) => ({ novedad: '✨', info: 'ℹ️', advertencia: '⚠️' }[t] || '📢');
const tipoLabel = (t) => ({ novedad: 'Novedad', info: 'Información', advertencia: 'Advertencia' }[t] || t);

const formatDate = (dt) => {
  if (!dt) return '';
  try {
    const str = String(dt).trim();
    const isoLike = str.includes('T') ? str : str.replace(' ', 'T');
    let d = new Date(isoLike);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    const m = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
      }
    }
  } catch (e) {}
  return '';
};

function isUserAdmin() {
  try {
    const rawUser = localStorage.getItem('pos_user');
    const token = localStorage.getItem('pos_token');
    if (!token || !rawUser) return false;
    const user = JSON.parse(rawUser);
    return user && user.role === 'admin';
  } catch {
    return false;
  }
}

async function checkAnuncios() {
  // Solo se debe mostrar al administrador
  if (!isUserAdmin()) {
    show.value = false;
    anuncios.value = [];
    return;
  }

  let list = [];
  
  // 1. Primero intentar obtener de sessionStorage
  const raw = sessionStorage.getItem('_anuncios_digirest');
  if (raw) {
    try { list = JSON.parse(raw); } catch (e) {}
  }

  // 2. Si no hay en sessionStorage, consultar al endpoint local /api/saas/anuncios con token del admin
  if (!Array.isArray(list) || list.length === 0) {
    try {
      const token = localStorage.getItem('pos_token');
      const res = await fetch('/api/saas/anuncios', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store'
      });
      if (res.ok) {
        list = await res.json();
      }
    } catch (e) {
      // ignore
    }
  }

  if (!Array.isArray(list) || list.length === 0) return;

  // 3. Filtrar no vistos por este navegador
  const seenIds = getSeenIds();
  const pendientes = list.filter(a => !seenIds.includes(a.id));

  if (pendientes.length > 0) {
    anuncios.value = pendientes;
    currentIndex.value = 0;
    setTimeout(() => { show.value = true; }, 350);
  }
}

onMounted(() => {
  // Solo chequear si el usuario actual es administrador (evita mostrar en carga pública o a clientes)
  if (isUserAdmin()) {
    checkAnuncios();
  }
  window.addEventListener('saas-refresh', checkAnuncios);
  window.addEventListener('saas-check-anuncios', checkAnuncios);
  window.checkSaasAnuncios = checkAnuncios;
});

onUnmounted(() => {
  window.removeEventListener('saas-refresh', checkAnuncios);
  window.removeEventListener('saas-check-anuncios', checkAnuncios);
});
</script>

<style scoped>
.nv-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99998;
  padding: 1rem;
  backdrop-filter: blur(4px);
}

.nv-card {
  background: #fff;
  border-radius: 1.25rem;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
  animation: cardPop 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
}

@keyframes cardPop {
  from { transform: scale(0.88); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.nv-header {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 1.25rem 1.25rem 1rem;
  border-bottom: 1px solid #F3F4F6;
  position: relative;
}

.nv-header-icon {
  width: 42px;
  height: 42px;
  border-radius: 0.75rem;
  background: #FFF7ED;
  color: #F97316;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nv-title {
  font-size: 1.05rem;
  font-weight: 800;
  color: #111827;
  margin: 0 0 0.15rem 0;
}

.nv-subtitle {
  font-size: 0.78rem;
  color: #9CA3AF;
  margin: 0;
}

.nv-close {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 0.5rem;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6B7280;
  transition: background 0.15s, color 0.15s;
}
.nv-close:hover { background: #F3F4F6; color: #111827; }

.nv-body {
  padding: 1.25rem;
  min-height: 160px;
}

.nv-anuncio {
  border-left: 4px solid var(--nv-color, #3B82F6);
  padding: 0.85rem 1rem;
  background: var(--nv-bg, rgba(59,130,246,0.04));
  border-radius: 0 0.75rem 0.75rem 0;
}
.nv-anuncio--novedad    { --nv-color: #3B82F6; --nv-bg: rgba(59,130,246,0.04); }
.nv-anuncio--info       { --nv-color: #10B981; --nv-bg: rgba(16,185,129,0.04); }
.nv-anuncio--advertencia{ --nv-color: #F59E0B; --nv-bg: rgba(245,158,11,0.04); }

.nv-anuncio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.nv-tipo-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.6rem;
  border-radius: 99px;
  letter-spacing: 0.04em;
}
.badge--novedad    { background: rgba(59,130,246,0.12); color: #3B82F6; }
.badge--info       { background: rgba(16,185,129,0.12); color: #10B981; }
.badge--advertencia{ background: rgba(245,158,11,0.12); color: #D97706; }

.nv-fecha { font-size: 0.7rem; color: #9CA3AF; }

.nv-anuncio-titulo {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
  margin: 0 0 0.4rem 0;
}

.nv-anuncio-contenido {
  font-size: 0.85rem;
  color: #4B5563;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
}

.nv-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1.25rem;
  border-top: 1px solid #F3F4F6;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.nv-dots { display: flex; gap: 0.35rem; }
.nv-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #E5E7EB;
  border: none;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
}
.nv-dot--active { background: #F97316; transform: scale(1.25); }

.nv-nav-btns {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.nv-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem 0.9rem;
  border-radius: 0.6rem;
  border: 1.5px solid #E5E7EB;
  background: #fff;
  color: #374151;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.nv-nav-btn:hover { background: #F9FAFB; }
.nv-nav-btn--next { border-color: #F97316; color: #F97316; }
.nv-nav-btn--next:hover { background: #FFF7ED; }

.nv-btn-dismiss {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.55rem 1.1rem;
  border-radius: 0.6rem;
  border: none;
  background: #F97316;
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, transform 0.12s;
}
.nv-btn-dismiss:hover { background: #EA580C; transform: translateY(-1px); }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
