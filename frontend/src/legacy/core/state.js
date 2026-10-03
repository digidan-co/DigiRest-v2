import { reactive } from 'vue';

let initialUser = null;
if (typeof localStorage !== 'undefined') {
    try {
        const raw = localStorage.getItem('pos_user');
        if (raw) initialUser = JSON.parse(raw);
    } catch (_) {}
}

export const state = reactive({
    config: {},
    categories: [],
    products: [],
    toppings: [],
    deliveryZones: [],
    customers: [],
    customerStats: {},
    topDishes7d: [],
    cart: [],
    user: initialUser,
    orders: [],
    waiterOrders: [],
    unsubscribes: [],
    confirmId: null,
    restaurantData: {},
    accountData: {},
    bankAccounts: [],
    clientSplits: [],
    archivedPage: 1,
    lastVisible: null,
    firstVisible: null,
    checkedItems: new Set(),
    lastActivity: Date.now(),
    adminPage: 1,
    productsPage: 1,
    categoriesPage: 1
});
