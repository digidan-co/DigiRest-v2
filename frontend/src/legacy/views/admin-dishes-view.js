/**
 * DigiRest - Admin Dishes & Categories View Module
 * Handles products table, pagination, category cards, modal previews, and CSV import/export.
 */

import { state } from '../core/state.js';
import { $, formatMoney, escapeHtml } from '../utils/helpers.js';
import { deleteProduct, deleteCategory, importProductsCSV, importCategoriesCSV, toggleProductRecommended, toggleProductPromo } from '../services/product-service.js';
import { toast, showConfirmModal } from '../components/ui.js';
import { populateDishFormExtensions } from '../features/toppings-manager.js';

function triggerQuotaUpdate() {
    if (typeof window.updateQuotaWidget === 'function') {
        window.updateQuotaWidget();
    }
}

/**
 * Initialize subtab navigation between Platos and Categorías
 */
export function initProductsSubtabs() {
    const btnDishes = $('tab-btn-prod-dishes');
    const btnCategories = $('tab-btn-prod-categories');
    const viewDishes = $('prod-view-dishes');
    const viewCategories = $('prod-view-categories');

    const activeClass = 'px-3.5 py-1.5 rounded-lg transition-all btn-system-primary text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer';
    const inactiveClass = 'px-3.5 py-1.5 rounded-lg transition-all text-gray-600 hover:text-gray-900 hover:bg-white flex items-center gap-1.5 cursor-pointer text-xs font-bold';

    window.switchProductsSubtab = (subtab) => {
        if (btnDishes) btnDishes.className = subtab === 'dishes' ? activeClass : inactiveClass;
        if (btnCategories) btnCategories.className = subtab === 'categories' ? activeClass : inactiveClass;

        if (viewDishes) viewDishes.classList.toggle('hidden', subtab !== 'dishes');
        if (viewCategories) viewCategories.classList.toggle('hidden', subtab !== 'categories');

        if (subtab === 'dishes') {
            renderAdminProductsPage();
        } else if (subtab === 'categories') {
            renderAdminCategoriesPage();
        }
    };

    if (btnDishes) btnDishes.onclick = () => window.switchProductsSubtab('dishes');
    if (btnCategories) btnCategories.onclick = () => window.switchProductsSubtab('categories');
}

/**
 * Render dishes/products table with pagination, search, duplicate, edit and delete actions
 */
export function renderAdminProductsPage() {
    const searchTerm = ($('prod-search')?.value || '').toLowerCase();

    let filteredProducts = state.products || [];
    if (searchTerm) {
        filteredProducts = filteredProducts.filter(p => (p.name || '').toLowerCase().includes(searchTerm));
    }

    const PER_PAGE = 14;
    const totalPages = Math.ceil(filteredProducts.length / PER_PAGE) || 1;

    if (state.productsPage < 1) state.productsPage = 1;
    if (state.productsPage > totalPages) state.productsPage = totalPages;

    const start = (state.productsPage - 1) * PER_PAGE;
    const end = start + PER_PAGE;
    const pageItems = filteredProducts.slice(start, end);

    let html = '';
    pageItems.forEach(p => {
        const isAvailable = p.available !== 0 && p.available !== false;
        const catName = (state.categories || []).find(c => c.id === p.category || c.name === p.category)?.name || p.category || 'General';

        html += `
            <tr class="border-b border-gray-50">
                <td class="p-2 flex items-center gap-3">
                    <img src="${p.img || 'img/icon.png'}" alt="Miniatura de ${escapeHtml(p.name)}" loading="lazy" class="w-9 h-9 rounded-lg bg-gray-100 object-cover shrink-0">
                    <div class="min-w-0">
                        <div class="font-bold text-gray-800 text-xs sm:text-sm truncate">${escapeHtml(p.name)}</div>
                        <div class="text-[11px] text-gray-500 flex items-center gap-1 font-medium mt-0.5">
                            <i class="fas fa-tag text-[9px] text-gray-400"></i> ${escapeHtml(catName)}
                        </div>
                    </div>
                </td>
                <td class="p-2 text-sm font-bold">${formatMoney(p.price)}</td>
                <td class="p-2 text-center">
                    ${p.has_toppings ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">Sí</span>' : '<span class="text-gray-300 text-xs">—</span>'}
                </td>
                <td class="p-2 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer prod-rec-toggle" data-id="${p.id}" ${p.is_recommended ? 'checked' : ''}>
                        <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                    </label>
                </td>
                <td class="p-2 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer prod-promo-toggle" data-id="${p.id}" ${p.is_promo ? 'checked' : ''}>
                        <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                    </label>
                    ${p.is_promo && p.promo_price ? `<div class="text-[10px] font-bold text-red-500 mt-0.5">${formatMoney(p.promo_price)}</div>` : ''}
                </td>
                <td class="p-2 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer prod-avail-toggle" data-id="${p.id}" ${isAvailable ? 'checked' : ''}>
                        <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--system-primary)]"></div>
                    </label>
                </td>
                <td class="p-2 text-center align-middle">
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors edit-prod-btn" data-id="${p.id}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar Plato</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-gray-700 hover:bg-gray-50 transition-colors duplicate-prod-btn" data-id="${p.id}">
                                <i class="fas fa-copy w-4 text-center"></i> <span>Duplicar</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors delete-prod-btn" data-id="${p.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    const tbody = $('admin-products-body');
    if (tbody) tbody.innerHTML = html;

    if ($('prod-page-indicator')) $('prod-page-indicator').innerText = `Página ${state.productsPage} de ${totalPages}`;
    if ($('btn-prev-prod')) $('btn-prev-prod').disabled = state.productsPage === 1;
    if ($('btn-next-prod')) $('btn-next-prod').disabled = state.productsPage === totalPages;

    // Availability toggle listener
    document.querySelectorAll('.prod-avail-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const available = e.target.checked;
            try {
                const { saveProduct } = await import('../services/product-service.js');
                await saveProduct({ available }, id);

                const p = (state.products || []).find(x => x.id === id);
                if (p) p.available = available;

                toast(`Disponibilidad actualizada: ${available ? 'Disponible' : 'No disponible'}`, 'success');
            } catch (err) {
                console.error(err);
                toast('Error actualizando disponibilidad', 'error');
                e.target.checked = !available;
            }
        });
    });

    // Recommended toggle listener
    document.querySelectorAll('.prod-rec-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const isRec = e.target.checked;
            try {
                await toggleProductRecommended(id);
                const p = (state.products || []).find(x => x.id === id);
                if (p) p.is_recommended = isRec ? 1 : 0;
                toast(`Recomendado: ${isRec ? 'Activado' : 'Desactivado'}`, 'success');
            } catch (err) {
                console.error(err);
                toast('Error al actualizar recomendado', 'error');
                e.target.checked = !isRec;
            }
        });
    });

    // Promo toggle listener
    document.querySelectorAll('.prod-promo-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const isPromo = e.target.checked;
            try {
                await toggleProductPromo(id);
                const p = (state.products || []).find(x => x.id === id);
                if (p) p.is_promo = isPromo ? 1 : 0;
                toast(`Promoción: ${isPromo ? 'Activada' : 'Desactivada'}`, 'success');
            } catch (err) {
                console.error(err);
                toast('Error al actualizar promoción', 'error');
                e.target.checked = !isPromo;
            }
        });
    });

    // Delete product listener
    document.querySelectorAll('.delete-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showConfirmModal('Eliminar Plato', '¿Estás seguro de eliminar este plato? Esta acción no se puede deshacer.', async () => {
                try {
                    await deleteProduct(btn.dataset.id);
                    toast('Plato eliminado', 'success');
                    renderAdminProductsPage();
                    triggerQuotaUpdate();
                } catch (error) {
                    console.error(error);
                    toast('Error al eliminar', 'error');
                }
            });
        });
    });

    // Edit product listener
    document.querySelectorAll('.edit-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = (state.products || []).find(x => x.id === btn.dataset.id);
            if (p) {
                if ($('p-id')) $('p-id').value = p.id;
                if ($('p-name')) $('p-name').value = p.name;
                if ($('p-desc')) $('p-desc').value = p.desc;

                const sel = $('p-cat');
                if (sel) {
                    sel.innerHTML = (state.categories || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
                    const catOption = (state.categories || []).find(c => c.name === p.category || c.id === p.category);
                    sel.value = catOption ? catOption.id : p.category;
                }

                if ($('p-price')) $('p-price').value = p.price;

                const toggle = $('p-available');
                if (toggle) toggle.checked = p.available !== false;

                if ($('btn-save-prod')) $('btn-save-prod').innerText = "Actualizar";

                // Image Delete Logic
                const btnDelImg = $('btn-delete-img');
                const delInput = $('p-delete-img');
                const imgPreview = $('p-current-img');
                const imgContainer = $('p-current-img-container');

                if (btnDelImg && delInput) {
                    delInput.value = '';
                    if ($('p-file')) $('p-file').value = '';

                    const hasImage = p.img && !p.img.includes('noimage.png') && !p.img.includes('icon.png');
                    if (imgContainer) {
                        imgContainer.classList.toggle('hidden', !hasImage);
                        if (imgPreview && hasImage) imgPreview.src = p.img;
                    }

                    if (hasImage) {
                        btnDelImg.classList.remove('hidden');
                        btnDelImg.onclick = () => {
                            showConfirmModal('Restaurar Imagen', '¿Restaurar imagen por defecto?', () => {
                                delInput.value = 'true';
                                btnDelImg.classList.add('hidden');
                                if (imgContainer) imgContainer.classList.add('hidden');
                                toast("Imagen se eliminará al guardar", "info");
                            }, null, 'Restaurar');
                        };
                    } else {
                        btnDelImg.classList.add('hidden');
                    }
                }

                if ($('product-modal')) $('product-modal').classList.remove('hidden');
                populateDishFormExtensions(p);
            }
        });
    });

    // Duplicate product listener
    document.querySelectorAll('.duplicate-prod-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = (state.products || []).find(x => x.id === btn.dataset.id);
            if (!p) return;

            if ($('p-id')) $('p-id').value = '';
            if ($('p-name')) $('p-name').value = p.name + ' (Copia)';
            if ($('p-desc')) $('p-desc').value = p.desc;

            const sel = $('p-cat');
            if (sel) {
                sel.innerHTML = (state.categories || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
                const catOption = (state.categories || []).find(c => c.name === p.category || c.id === p.category);
                sel.value = catOption ? catOption.id : p.category;
            }

            if ($('p-price')) $('p-price').value = p.price;

            const toggle = $('p-available');
            if (toggle) toggle.checked = p.available !== false;

            const btnDelImg = $('btn-delete-img');
            const delInput = $('p-delete-img');
            const imgPreview = $('p-current-img');
            const imgContainer = $('p-current-img-container');

            if (delInput) delInput.value = '';
            if ($('p-file')) $('p-file').value = '';

            const hasImage = p.img && !p.img.includes('noimage.png') && !p.img.includes('icon.png');
            if (imgContainer) {
                imgContainer.classList.toggle('hidden', !hasImage);
                if (imgPreview && hasImage) imgPreview.src = p.img;
            }
            if (btnDelImg) btnDelImg.classList.add('hidden');

            if ($('btn-save-prod')) $('btn-save-prod').innerText = 'Crear Copia';
            if ($('product-modal')) $('product-modal').classList.remove('hidden');
            populateDishFormExtensions(p);
        });
    });

    // Search input listener
    const searchInput = $('prod-search');
    if (searchInput && !searchInput.hasAttribute('data-listening')) {
        searchInput.setAttribute('data-listening', 'true');
        searchInput.addEventListener('input', () => {
            state.productsPage = 1;
            renderAdminProductsPage();
        });
    }
}

/**
 * Render categories page with counts, view-dishes preview, edit and delete actions
 */
export function renderAdminCategoriesPage() {
    const categories = state.categories || [];
    const PER_PAGE = 14;
    const totalPages = Math.ceil(categories.length / PER_PAGE) || 1;

    if (state.categoriesPage < 1) state.categoriesPage = 1;
    if (state.categoriesPage > totalPages) state.categoriesPage = totalPages;

    const start = (state.categoriesPage - 1) * PER_PAGE;
    const end = start + PER_PAGE;
    const pageItems = categories.slice(start, end);

    const tbody = $('admin-cat-body');
    if (!tbody) return;

    let html = '';
    pageItems.forEach(c => {
        const productCount = (state.products || []).filter(p => p.category === c.id || p.category === c.name).length;
        html += `
            <tr class="border-b border-gray-50">
                <td class="py-2 px-4">${escapeHtml(c.name)}</td>
                <td class="py-2 px-4 text-center">
                    <span class="text-sm font-semibold text-gray-600">${productCount}</span>
                    <button aria-label="Ver productos" class="view-cat-prods-btn ml-1.5 text-blue-500 hover:text-blue-700 transition-colors text-xs" data-id="${c.id}" data-name="${escapeHtml(c.name)}" ${productCount === 0 ? 'disabled style="opacity:0.3;cursor:not-allowed"' : ''}>
                        <i class="fas fa-list"></i>
                    </button>
                </td>
                <td class="py-2 px-4 text-center">
                    <div class="relative inline-block text-left table-action-container">
                        <button type="button" class="table-action-trigger w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors focus:outline-none" title="Acciones">
                            <i class="fas fa-ellipsis-v text-xs"></i>
                        </button>
                        <div class="table-action-menu hidden absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-50 text-xs font-medium text-left">
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-blue-600 hover:bg-blue-50 transition-colors edit-cat-btn" data-id="${c.id}" data-name="${escapeHtml(c.name)}">
                                <i class="fas fa-edit w-4 text-center"></i> <span>Editar</span>
                            </button>
                            <button type="button" class="w-full text-left px-3 py-2 flex items-center gap-2 text-red-600 hover:bg-red-50 transition-colors delete-cat-btn" data-id="${c.id}">
                                <i class="fas fa-trash-alt w-4 text-center"></i> <span>Eliminar</span>
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;

    if ($('cat-page-indicator')) $('cat-page-indicator').innerText = `Página ${state.categoriesPage} de ${totalPages}`;
    if ($('btn-prev-cat')) $('btn-prev-cat').disabled = state.categoriesPage === 1;
    if ($('btn-next-cat')) $('btn-next-cat').disabled = state.categoriesPage === totalPages;

    // Delete category
    document.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            showConfirmModal('Eliminar Categoría', '¿Estás seguro de eliminar esta categoría? Esta acción no se puede deshacer.', async () => {
                try {
                    await deleteCategory(btn.dataset.id);
                    const idx = (state.categories || []).findIndex(c => c.id === btn.dataset.id);
                    if (idx > -1) state.categories.splice(idx, 1);
                    renderAdminCategoriesPage();
                    triggerQuotaUpdate();
                    toast('Categoría eliminada', 'success');
                } catch (error) {
                    console.error(error);
                    toast('Error al eliminar categoría', 'error');
                }
            });
        });
    });

    // Edit category
    document.querySelectorAll('.edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if ($('cat-id')) $('cat-id').value = btn.dataset.id;
            if ($('cat-name')) $('cat-name').value = btn.dataset.name;
            if ($('btn-save-cat')) $('btn-save-cat').innerText = "Actualizar";
            if ($('cat-modal')) $('cat-modal').classList.remove('hidden');
        });
    });

    // View products in category modal
    document.querySelectorAll('.view-cat-prods-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const catId = btn.dataset.id;
            const catName = btn.dataset.name;
            const products = (state.products || []).filter(p => p.category === catId || p.category === catName);
            if (products.length === 0) return;

            if ($('cat-prods-title')) $('cat-prods-title').innerText = `Productos — ${catName}`;
            const body = $('cat-prods-body');
            if (body) {
                body.innerHTML = products.map(p => {
                    const available = p.available !== 0 && p.available !== false;
                    return `
                        <div class="flex items-center justify-between p-2.5 rounded-xl transition-colors ${available ? 'bg-white hover:bg-gray-50' : 'bg-red-50/50 opacity-75'} border border-gray-100">
                            <div class="flex items-center gap-3 min-w-0">
                                ${p.img && !p.img.includes('noimage.png') && !p.img.includes('icon.png')
                                    ? `<img src="${p.img}" alt="${escapeHtml(p.name)}" class="w-9 h-9 rounded-lg object-cover shrink-0 border border-gray-100">`
                                    : `<div class="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shrink-0"><i class="fas fa-utensils text-gray-400 text-xs"></i></div>`}
                                <span class="text-sm font-medium text-gray-700 truncate">${escapeHtml(p.name)}</span>
                            </div>
                            <div class="flex items-center gap-3 shrink-0">
                                <span class="text-sm font-bold text-gray-800">${formatMoney(p.price)}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full ${available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'} font-medium">${available ? 'Disponible' : 'Agotado'}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
            if ($('cat-products-modal')) $('cat-products-modal').classList.remove('hidden');
        });
    });
}

/**
 * Setup CSV Import and Export for Products & Categories
 */
export function setupDishesCSVListeners() {
    const btnExpProds = $('btn-export-products');
    const btnImpProds = $('btn-import-products-trigger');
    const fileImpProds = $('file-import-products');

    if (btnExpProds) {
        btnExpProds.onclick = () => {
            window.open('/api/products/export', '_blank');
        };
    }

    if (btnImpProds && fileImpProds) {
        btnImpProds.addEventListener('click', () => fileImpProds.click());
        fileImpProds.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.name.endsWith('.csv')) {
                return toast("Por favor selecciona un archivo CSV", "error");
            }

            try {
                btnImpProds.disabled = true;
                btnImpProds.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';

                const res = await importProductsCSV(file);
                toast(res.message || "Productos importados correctamente", "success");
                fileImpProds.value = '';
            } catch (err) {
                console.error(err);
                toast("Error al importar productos", "error");
                fileImpProds.value = '';
            } finally {
                btnImpProds.disabled = false;
                btnImpProds.innerHTML = '<i class="fas fa-file-import"></i> Importar';
            }
        });
    }

    const btnExpCats = $('btn-export-categories');
    const btnImpCats = $('btn-import-categories-trigger');
    const fileImpCats = $('file-import-categories');

    if (btnExpCats) {
        btnExpCats.onclick = () => {
            window.open('/api/categories/export', '_blank');
        };
    }

    if (btnImpCats && fileImpCats) {
        btnImpCats.addEventListener('click', () => fileImpCats.click());
        fileImpCats.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.name.endsWith('.csv')) {
                return toast("Por favor selecciona un archivo CSV", "error");
            }

            try {
                btnImpCats.disabled = true;
                btnImpCats.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';

                const res = await importCategoriesCSV(file);
                toast(res.message || "Categorías importadas correctamente", "success");
                fileImpCats.value = '';
            } catch (err) {
                console.error(err);
                toast("Error al importar categorías", "error");
                fileImpCats.value = '';
            } finally {
                btnImpCats.disabled = false;
                btnImpCats.innerHTML = '<i class="fas fa-file-import"></i> Importar';
            }
        });
    }
}

// Global exposure for inline HTML calls
window.renderAdminProductsPage = renderAdminProductsPage;
window.renderAdminCategoriesPage = renderAdminCategoriesPage;
window.initProductsSubtabs = initProductsSubtabs;

// Extracted actions for the Vue ProductsPanel
function fillProductForm(p, isDuplicate) {
    if ($('p-id')) $('p-id').value = isDuplicate ? '' : p.id;
    if ($('p-name')) $('p-name').value = isDuplicate ? p.name + ' (Copia)' : p.name;
    if ($('p-desc')) $('p-desc').value = p.desc;

    const sel = $('p-cat');
    if (sel) {
        sel.innerHTML = (state.categories || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        const catOption = (state.categories || []).find(c => c.name === p.category || c.id === p.category);
        sel.value = catOption ? catOption.id : p.category;
    }

    if ($('p-price')) $('p-price').value = p.price;
    const toggle = $('p-available');
    if (toggle) toggle.checked = p.available !== false;
    if ($('btn-save-prod')) $('btn-save-prod').innerText = isDuplicate ? 'Crear Copia' : 'Actualizar';

    const btnDelImg = $('btn-delete-img');
    const delInput = $('p-delete-img');
    const imgPreview = $('p-current-img');
    const imgContainer = $('p-current-img-container');

    if (btnDelImg && delInput) {
        delInput.value = '';
        if ($('p-file')) $('p-file').value = '';
        const hasImage = p.img && !p.img.includes('noimage.png') && !p.img.includes('icon.png');
        if (imgContainer) {
            imgContainer.classList.toggle('hidden', !hasImage);
            if (imgPreview && hasImage) imgPreview.src = p.img;
        }
        if (hasImage && !isDuplicate) {
            btnDelImg.classList.remove('hidden');
            btnDelImg.onclick = () => {
                showConfirmModal('Restaurar Imagen', '¿Restaurar imagen por defecto?', () => {
                    delInput.value = 'true';
                    btnDelImg.classList.add('hidden');
                    if (imgContainer) imgContainer.classList.add('hidden');
                    toast('Imagen se eliminará al guardar', 'info');
                }, null, 'Restaurar');
            };
        } else {
            btnDelImg.classList.add('hidden');
        }
    }
}

window.openEditProductModal = (id) => {
    const p = (state.products || []).find(x => x.id == id);
    if (!p) return;
    fillProductForm(p, false);
    if ($('product-modal')) $('product-modal').classList.remove('hidden');
    populateDishFormExtensions(p);
};

window.openDuplicateProductModal = (id) => {
    const p = (state.products || []).find(x => x.id == id);
    if (!p) return;
    fillProductForm(p, true);
    if ($('product-modal')) $('product-modal').classList.remove('hidden');
    populateDishFormExtensions(p);
};

window.deleteProductRow = (id) => {
    showConfirmModal('Eliminar Plato', '¿Estás seguro de eliminar este plato? Esta acción no se puede deshacer.', async () => {
        try {
            await deleteProduct(id);
            toast('Plato eliminado', 'success');
            triggerQuotaUpdate();
            if (window.reloadAdminData) window.reloadAdminData();
        } catch (error) {
            console.error(error);
            toast('Error al eliminar', 'error');
        }
    });
};

window.deleteCategoryRow = (id) => {
    showConfirmModal('Eliminar Categoría', '¿Estás seguro de eliminar esta categoría? Esta acción no se puede deshacer.', async () => {
        try {
            await deleteCategory(id);
            toast('Categoría eliminada', 'success');
            triggerQuotaUpdate();
            if (window.reloadAdminData) window.reloadAdminData();
        } catch (error) {
            console.error(error);
            toast('Error al eliminar categoría', 'error');
        }
    });
};

window.openEditCategoryModal = (id, name) => {
    if ($('cat-id')) $('cat-id').value = id;
    if ($('cat-name')) $('cat-name').value = name;
    if ($('btn-save-cat')) $('btn-save-cat').innerText = 'Actualizar';
    if ($('cat-modal')) $('cat-modal').classList.remove('hidden');
};

window.openCategoryProductsModal = (catId, catName) => {
    const products = (state.products || []).filter(p => p.category == catId || p.category == catName);
    if (products.length === 0) return;
    if ($('cat-prods-title')) $('cat-prods-title').innerText = `Productos — ${catName}`;
    const body = $('cat-prods-body');
    if (body) {
        body.innerHTML = products.map(p => {
            const available = p.available !== 0 && p.available !== false;
            return `
                <div class="flex items-center justify-between p-2.5 rounded-xl transition-colors ${available ? 'bg-white hover:bg-gray-50' : 'bg-red-50/50 opacity-75'} border border-gray-100">
                    <div class="flex items-center gap-3 min-w-0">
                        ${p.img && !p.img.includes('noimage.png') && !p.img.includes('icon.png')
                            ? `<img src="${p.img}" alt="${escapeHtml(p.name)}" class="w-9 h-9 rounded-lg object-cover shrink-0 border border-gray-100">`
                            : `<div class="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shrink-0"><i class="fas fa-utensils text-gray-400 text-xs"></i></div>`}
                        <span class="text-sm font-medium text-gray-700 truncate">${escapeHtml(p.name)}</span>
                    </div>
                    <div class="flex items-center gap-3 shrink-0">
                        <span class="text-sm font-bold text-gray-800">${formatMoney(p.price)}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full ${available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'} font-medium">${available ? 'Disponible' : 'Agotado'}</span>
                    </div>
                </div>`;
        }).join('');
    }
    if ($('cat-products-modal')) $('cat-products-modal').classList.remove('hidden');
};

window.toggleProductAvailability = async (id, available) => {
    try {
        const { saveProduct } = await import('../services/product-service.js');
        await saveProduct({ available }, id);
        const p = (state.products || []).find(x => x.id == id);
        if (p) p.available = available;
        toast(`Disponibilidad actualizada: ${available ? 'Disponible' : 'No disponible'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error actualizando disponibilidad', 'error');
    }
};

window.toggleProductRecommended = async (id, isRec) => {
    try {
        await toggleProductRecommended(id);
        const p = (state.products || []).find(x => x.id == id);
        if (p) p.is_recommended = isRec ? 1 : 0;
        toast(`Recomendado: ${isRec ? 'Activado' : 'Desactivado'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error al actualizar recomendado', 'error');
    }
};

window.toggleProductPromo = async (id, isPromo) => {
    try {
        await toggleProductPromo(id);
        const p = (state.products || []).find(x => x.id == id);
        if (p) p.is_promo = isPromo ? 1 : 0;
        toast(`Promoción: ${isPromo ? 'Activada' : 'Desactivada'}`, 'success');
    } catch (err) {
        console.error(err);
        toast('Error al actualizar promoción', 'error');
    }
};
