<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="sw-overlay" @click.self="dismiss">
        <div class="sw-card">
          <div class="sw-icon-wrap">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div class="sw-days-badge">
            {{ data.daysLeft === 0 ? 'Vence HOY' : `${data.daysLeft} ${data.daysLeft === 1 ? 'día' : 'días'}` }}
          </div>
          <h2 class="sw-title">Tu suscripción está por vencer</h2>
          <p class="sw-message">{{ data.message }}</p>
          <p class="sw-contact">Por favor, contacta a soporte en <a href="https://digidan.co" target="_blank" rel="noopener">digidan.co</a> para renovar tu plan.</p>
          <button class="sw-btn" @click="dismiss">Entendido</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const show = ref(false);
const data = ref({ daysLeft: 0, message: '' });

function dismiss() {
  show.value = false;
  sessionStorage.removeItem('_warningSaaS_digirest');
}

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

function checkWarning() {
  if (!isUserAdmin()) {
    show.value = false;
    return;
  }
  const raw = sessionStorage.getItem('_warningSaaS_digirest');
  if (raw) {
    try {
      data.value = JSON.parse(raw);
      show.value = true;
    } catch (e) { /* ignore */ }
  }
}

onMounted(() => {
  if (isUserAdmin()) {
    checkWarning();
  }
  window.addEventListener('saas-refresh', checkWarning);
});

onUnmounted(() => {
  window.removeEventListener('saas-refresh', checkWarning);
});
</script>

<style scoped>
.sw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  padding: 1rem;
  backdrop-filter: blur(4px);
}

.sw-card {
  background: #fff;
  border-radius: 1.25rem;
  padding: 2rem 2rem 1.75rem;
  max-width: 400px;
  width: 100%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  animation: cardPop 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
}

@keyframes cardPop {
  from { transform: scale(0.88); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.sw-icon-wrap {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(245,158,11,0.1);
  color: #D97706;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
}

.sw-days-badge {
  display: inline-block;
  background: #FEF3C7;
  color: #D97706;
  font-size: 0.8rem;
  font-weight: 800;
  padding: 0.3rem 0.85rem;
  border-radius: 99px;
  letter-spacing: 0.04em;
  margin-bottom: 0.85rem;
}

.sw-title {
  font-size: 1.3rem;
  font-weight: 800;
  color: #111827;
  margin: 0 0 0.6rem 0;
}

.sw-message {
  font-size: 0.9rem;
  color: #6B7280;
  line-height: 1.6;
  margin: 0 0 0.4rem 0;
}

.sw-contact {
  font-size: 0.82rem;
  color: #9CA3AF;
  margin: 0 0 1.5rem 0;
}
.sw-contact a {
  color: #F97316;
  font-weight: 600;
  text-decoration: none;
}

.sw-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  border: none;
  background: #F97316;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, transform 0.12s;
}
.sw-btn:hover { background: #EA580C; transform: translateY(-1px); }
.sw-btn:active { transform: scale(0.98); }

.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
