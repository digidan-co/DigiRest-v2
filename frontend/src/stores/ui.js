import { defineStore } from 'pinia';
import { ref } from 'vue';

// Reactive mirror of the app navigation. The original `window.switchView`
// (legacy/main.js) remains the source of truth for rendering; this store keeps
// the active view observable so migrated Vue components can bind to it.
export const useUiStore = defineStore('ui', () => {
    const activeView = ref('client');

    function switchView(name) {
        activeView.value = name;
        if (typeof window.switchView === 'function') {
            window.switchView(name);
        }
    }

    return { activeView, switchView };
});
