import { createApp } from 'vue';
import { pinia } from './stores/index.js';
import { useUiStore } from './stores/ui.js';
import DeliveryView from './views/DeliveryView.vue';
import ChefView from './views/ChefView.vue';
import TrackerView from './views/TrackerView.vue';
import WaiterView from './views/WaiterView.vue';
import ClientView from './views/ClientView.vue';
import DisplayView from './views/DisplayView.vue';
import AdminSidebar from './components/AdminSidebar.vue';
import OrdersPanel from './components/OrdersPanel.vue';
import DashboardPanel from './components/DashboardPanel.vue';
import ProductsPanel from './components/ProductsPanel.vue';
import CierreCajaPanel from './components/CierreCajaPanel.vue';
import InventoryPanel from './components/InventoryPanel.vue';
import ToppingsPanel from './components/ToppingsPanel.vue';
import DeliveryZonesPanel from './components/DeliveryZonesPanel.vue';
import CrmPanel from './components/CrmPanel.vue';
import UsersPanel from './components/UsersPanel.vue';
import ReservationsList from './components/ReservationsList.vue';
import SaasStatusPanel from './components/SaasStatusPanel.vue';
import SaasWarningModal from './components/SaasWarningModal.vue';
import NovedadesModal from './components/NovedadesModal.vue';
import StaffHeader from './components/StaffHeader.vue';


// Bootstrap the original application logic. This module is loaded as a deferred
// `<script type="module">` at the end of <body>, so the full static markup
// (preserved pixel-for-pixel from the vanilla version) is already in the DOM and
// the legacy listeners bind correctly. `legacy/main.js` registers `load` → init().
import './legacy/main.js';

// Establish the Vue runtime + Pinia (the reactive state layer for the migration).
const app = createApp({ render: () => null });
app.use(pinia);

const ui = useUiStore(pinia);

// Keep the reactive navigation store in sync with the original switchView.
const legacySwitchView = window.switchView;
window.switchView = (name) => {
    ui.activeView = name;
    if (legacySwitchView) legacySwitchView(name);
};

// Mount on an inert element; the app shell remains the original static markup.
const root = document.createElement('div');
root.id = 'app';
document.body.appendChild(root);
app.mount(root);

// --- Staff Header (Header with user role & logout for waiter, chef, delivery) ---
const staffHeaderMount = document.getElementById('staff-header-mount');
if (staffHeaderMount) {
    const staffHeaderApp = createApp(StaffHeader);
    staffHeaderApp.use(pinia);
    staffHeaderApp.mount(staffHeaderMount);
}

// --- Migrated views (Vue components mounted onto their original containers) ---
// Delivery view: full Vue SFC port. It owns its own order subscription.
const deliveryMount = document.getElementById('delivery-view');
if (deliveryMount) {
    const deliveryApp = createApp(DeliveryView);
    deliveryApp.use(pinia);
    deliveryApp.mount(deliveryMount);
}

// Chef view (KDS): full Vue SFC port.
const chefMount = document.getElementById('chef-view');
if (chefMount) {
    const chefApp = createApp(ChefView);
    chefApp.use(pinia);
    chefApp.mount(chefMount);
}

// Tracker/status view: Vue SFC mounted onto the existing #status-list container.
const trackerMount = document.getElementById('status-list');
if (trackerMount) {
    const trackerApp = createApp(TrackerView);
    trackerApp.use(pinia);
    trackerApp.mount(trackerMount);
}

// Waiter view: full Vue SFC port (main active-orders grid). Its modals stay legacy.
const waiterMount = document.getElementById('waiter-view');
if (waiterMount) {
    const waiterApp = createApp(WaiterView);
    waiterApp.use(pinia);
    waiterApp.mount(waiterMount);
}

// Client view (public menu): full Vue SFC port. Cart/checkout/toppings stay legacy.
const clientMount = document.getElementById('client-view');
if (clientMount) {
    const clientApp = createApp(ClientView);
    clientApp.use(pinia);
    clientApp.mount(clientMount);
}

// Display view (interactive menu): full Vue SFC port.
const displayMount = document.getElementById('display-view');
if (displayMount) {
    const displayApp = createApp(DisplayView);
    displayApp.use(pinia);
    displayApp.mount(displayMount);
}

// Admin sidebar (shell): Vue SFC managing tab navigation. The panels stay legacy.
const sidebarMount = document.getElementById('admin-sidebar');
if (sidebarMount) {
    const sidebarApp = createApp(AdminSidebar);
    sidebarApp.use(pinia);
    sidebarApp.mount(sidebarMount);
}

// Admin orders panel: Vue SFC (general + local orders tables).
const ordersMount = document.getElementById('panel-orders');
if (ordersMount) {
    const ordersApp = createApp(OrdersPanel);
    ordersApp.use(pinia);
    ordersApp.mount(ordersMount);
}

// Admin dashboard panel: Vue SFC (stats, charts, star dish, tasks).
const dashboardMount = document.getElementById('panel-dashboard');
if (dashboardMount) {
    const dashboardApp = createApp(DashboardPanel);
    dashboardApp.use(pinia);
    dashboardApp.mount(dashboardMount);
}

// Admin products/categories panel: Vue SFC.
const productsMount = document.getElementById('panel-products');
if (productsMount) {
    const productsApp = createApp(ProductsPanel);
    productsApp.use(pinia);
    productsApp.mount(productsMount);
}

// Admin cierre de caja panel: Vue SFC (history table).
const cierreMount = document.getElementById('panel-cierrecaja');
if (cierreMount) {
    const cierreApp = createApp(CierreCajaPanel);
    cierreApp.use(pinia);
    cierreApp.mount(cierreMount);
}

// Admin inventory panel: Vue SFC (supplies/kardex/recipes).
const inventoryMount = document.getElementById('panel-supplies');
if (inventoryMount) {
    const inventoryApp = createApp(InventoryPanel);
    inventoryApp.use(pinia);
    inventoryApp.mount(inventoryMount);
}

// Admin toppings panel: Vue SFC.
const toppingsMount = document.getElementById('panel-toppings');
if (toppingsMount) {
    const toppingsApp = createApp(ToppingsPanel);
    toppingsApp.use(pinia);
    toppingsApp.mount(toppingsMount);
}

// Admin delivery zones panel: Vue SFC.
const zonesMount = document.getElementById('panel-delivery-zones');
if (zonesMount) {
    const zonesApp = createApp(DeliveryZonesPanel);
    zonesApp.use(pinia);
    zonesApp.mount(zonesMount);
}

// Admin CRM panel: Vue SFC.
const crmMount = document.getElementById('panel-crm');
if (crmMount) {
    const crmApp = createApp(CrmPanel);
    crmApp.use(pinia);
    crmApp.mount(crmMount);
}

// Admin users panel: Vue SFC.
const usersMount = document.getElementById('panel-users');
if (usersMount) {
    const usersApp = createApp(UsersPanel);
    usersApp.use(pinia);
    usersApp.mount(usersMount);
}

// Admin reservations list: Vue SFC (calendar stays legacy).
const reservationsMount = document.getElementById('reservations-list');
if (reservationsMount) {
    const reservationsApp = createApp(ReservationsList);
    reservationsApp.use(pinia);
    reservationsApp.mount(reservationsMount);
}

// SaaS Status Panel: muestra el estado de suscripción en el dashboard admin y en configuración.
['panel-saas', 'panel-saas-dashboard', 'panel-saas-config'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        const app = createApp(SaasStatusPanel);
        app.use(pinia);
        app.mount(el);
    }
});

// SaaS Warning Modal: aviso de suscripción por vencer (≤3 días, admin, 1x/día).
const saasWarnMount = document.getElementById('modal-saas-warning');
if (saasWarnMount) {
    const saasWarnApp = createApp(SaasWarningModal);
    saasWarnApp.use(pinia);
    saasWarnApp.mount(saasWarnMount);
}

// Novedades Modal: anuncios del panel maestro (admin, 1x/día).
const novedadesMount = document.getElementById('modal-novedades');
if (novedadesMount) {
    const novedadesApp = createApp(NovedadesModal);
    novedadesApp.use(pinia);
    novedadesApp.mount(novedadesMount);
}

// Expose for debugging and for future migrated components.
window.__pinia = pinia;
window.__uiStore = ui;
