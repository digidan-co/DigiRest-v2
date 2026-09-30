import { reactive } from 'vue';

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
    user: null,
    orders: [],
    unsubscribes: [],
    confirmId: null,
    restaurantData: {},
    accountData: {},
    archivedPage: 1,
    lastVisible: null,
    firstVisible: null,
    checkedItems: new Set(),
    lastActivity: Date.now(),
    adminPage: 1,
    productsPage: 1,
    categoriesPage: 1
});
