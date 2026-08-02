import { subscribeProducts, markSold, archiveProduct, reactivateProduct, updateProduct, uploadProductPhoto } from '../lib/products';
import { mlPublish, mlToggle, mlGetAuthUrl, mlCheckAuth } from '../lib/ml';
import { showToast } from '../lib/toast';
import { esc } from '../lib/sanitize';
import { CATEGORIES } from '../lib/types';
import type { Product } from '../lib/types';

function formatPrice(n: number): string {
  return '$' + n.toLocaleString('es-AR');
}

function statusBadge(p: Product): string {
  if (p.mlId && p.mlStatus === 'active') return '<span class="badge badge-ml">En ML</span>';
  if (p.status === 'sold') return '<span class="badge badge-sold">Vendido</span>';
  if (p.status === 'archived') return '<span class="badge badge-archived">Archivado</span>';
  return '<span class="badge badge-available">Disponible</span>';
}

function categoryBadge(cat: string): string {
  return `<span class="badge badge-accent">${esc(cat)}</span>`;
}

function conditionStars(n: number): string {
  return `<span class="condition">${n}/10</span>`;
}

interface MenuItem {
  label: string;
  action: string;
}

function primaryAction(p: Product): { label: string; action: string; variant: string } | null {
  if (p.status === 'available') return { label: 'Vender', action: 'sell', variant: 'btn-success' };
  if (p.status === 'archived') return { label: 'Reactivar', action: 'reactivate', variant: 'btn-primary' };
  return null;
}

function menuItems(p: Product): MenuItem[] {
  if (p.status !== 'available') return [];
  const items: MenuItem[] = [{ label: 'Editar', action: 'edit' }];
  if (!p.mlId && p.photoUrl) items.push({ label: 'Publicar en ML', action: 'ml-publish' });
  if (p.mlId && p.mlStatus === 'active') items.push({ label: 'Pausar en ML', action: 'ml-pause' });
  if (p.mlId && p.mlStatus === 'paused') items.push({ label: 'Reactivar en ML', action: 'ml-activate' });
  items.push({ label: 'Archivar', action: 'archive' });
  return items;
}

function productCard(p: Product): string {
  const thumbSrc = p.photoUrl || p.mlPhotoUrl;
  const photo = thumbSrc
    ? `<img class="product-thumb" src="${esc(thumbSrc)}" alt="" loading="lazy" />`
    : '<div class="product-thumb product-thumb-empty">📦</div>';

  const margin = p.salePrice
    ? `<span class="stat-green">+${formatPrice(p.salePrice - p.costPrice)}</span>`
    : '';

  const primary = primaryAction(p);
  const menu = menuItems(p);

  return `
    <div class="product-card" data-id="${esc(p.id)}">
      <div class="product-card-top">
        ${photo}
        <div class="product-card-info">
          <div class="product-name">${esc(p.name)}</div>
          <div class="product-meta">
            ${categoryBadge(p.category)} ${conditionStars(p.condition)}
          </div>
        </div>
        ${menu.length ? `
          <div class="card-menu">
            <button type="button" class="card-menu-trigger" aria-label="Más acciones">⋮</button>
            <div class="card-menu-dropdown hidden">
              ${menu.map((m) => `<button type="button" class="card-menu-item" data-action="${m.action}">${esc(m.label)}</button>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <div class="product-card-prices">
        <span class="product-price">${formatPrice(p.listPrice)}</span>
        ${p.floorPrice ? `<span class="product-floor">Piso: ${formatPrice(p.floorPrice)}</span>` : ''}
        ${margin}
      </div>
      <div class="product-card-status">
        ${statusBadge(p)}
        ${p.mlLink ? `<a href="${esc(p.mlLink)}" target="_blank" class="ml-link">Ver en ML</a>` : ''}
        ${p.mlLink ? `<a href="https://wa.me/1124005532?text=${encodeURIComponent(p.name + ' - ' + formatPrice(p.listPrice) + '\n' + p.mlLink)}" target="_blank" class="ml-link">Compartir</a>` : ''}
      </div>
      ${primary ? `
        <div class="product-card-actions">
          <button class="btn btn-sm ${primary.variant} action-primary" data-action="${primary.action}" style="width:100%">${primary.label}</button>
        </div>
      ` : ''}
      ${p.status === 'sold' ? `<div class="product-card-actions"><span class="sale-info">Vendido: ${formatPrice(p.salePrice || 0)}</span></div>` : ''}
    </div>
  `;
}

function renderStats(products: Product[]): string {
  const available = products.filter((p) => p.status === 'available');
  const sold = products.filter((p) => p.status === 'sold');
  const totalStock = available.reduce((s, p) => s + p.listPrice, 0);
  const totalSold = sold.reduce((s, p) => s + (p.salePrice || 0), 0);

  return `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">${available.length}</div>
        <div class="stat-label">Disponibles</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${sold.length}</div>
        <div class="stat-label">Vendidos</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-green">${formatPrice(totalStock)}</div>
        <div class="stat-label">Stock</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-green">${formatPrice(totalSold)}</div>
        <div class="stat-label">Ingresos</div>
      </div>
    </div>
  `;
}

function showSellModal(product: Product) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Vender: ${esc(product.name)}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="form-group">
        <label class="label">Precio de venta</label>
        <input class="input" type="number" id="sale-price" value="${product.listPrice}" />
      </div>
      <button class="btn btn-success" id="confirm-sell" style="width:100%">Confirmar venta</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById('confirm-sell')!.addEventListener('click', async () => {
    const price = Number((document.getElementById('sale-price') as HTMLInputElement).value);
    if (price <= 0) return showToast('Ingresa un precio valido', 'error');
    try {
      await markSold(product.id, price);
      showToast('Producto vendido');
      overlay.remove();
    } catch {
      showToast('Error al vender', 'error');
    }
  });
}

function showEditModal(product: Product) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Editar producto</h3>
        <button class="modal-close">&times;</button>
      </div>
      <form id="edit-form">
        <div class="form-group">
          <label class="label">Nombre</label>
          <input class="input" id="e-name" required value="${esc(product.name)}" />
        </div>
        <div class="form-group">
          <label class="label">Categoria</label>
          <select class="input" id="e-category">
            ${CATEGORIES.map((c) => `<option value="${c}" ${product.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Condicion (1-10)</label>
            <input class="input" type="number" id="e-condition" min="1" max="10" value="${product.condition}" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio costo</label>
            <input class="input" type="number" id="e-cost" value="${product.costPrice}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Precio lista</label>
            <input class="input" type="number" id="e-list" required value="${product.listPrice}" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio piso</label>
            <input class="input" type="number" id="e-floor" value="${product.floorPrice ?? ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="label">Notas</label>
          <textarea class="input" id="e-notes" rows="2">${esc(product.notes || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="label">Foto</label>
          ${!product.photoUrl && product.mlPhotoUrl ? `
            <div class="ml-reference">
              <img class="ml-reference-photo" src="${esc(product.mlPhotoUrl)}" alt="" />
              <span class="hint">Foto de referencia de ML — subí la tuya</span>
            </div>
          ` : ''}
          <input class="input" type="file" id="e-photo" accept="image/*" />
          ${product.photoUrl ? `<img class="photo-preview" src="${esc(product.photoUrl)}" />` : ''}
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">Guardar cambios</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#edit-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
      const name = (document.getElementById('e-name') as HTMLInputElement).value.trim();
      const category = (document.getElementById('e-category') as HTMLSelectElement).value;
      const condition = Number((document.getElementById('e-condition') as HTMLInputElement).value);
      const listPrice = Number((document.getElementById('e-list') as HTMLInputElement).value);
      const floorPrice = Number((document.getElementById('e-floor') as HTMLInputElement).value) || Math.round(listPrice * 0.8);
      const costPrice = Number((document.getElementById('e-cost') as HTMLInputElement).value) || 0;
      const notes = (document.getElementById('e-notes') as HTMLTextAreaElement).value.trim();
      const photoFile = (document.getElementById('e-photo') as HTMLInputElement).files?.[0];

      if (!name || !listPrice) {
        showToast('Nombre y precio son requeridos', 'error');
        return;
      }

      const data: Partial<Product> = { name, category, condition, listPrice, floorPrice, costPrice, notes };
      if (photoFile) {
        data.photoUrl = await uploadProductPhoto(photoFile, product.id);
      }
      await updateProduct(product.id, data);
      showToast('Producto actualizado');
      overlay.remove();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      showToast(msg, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar cambios';
    }
  });
}

function closeAllMenus(except?: HTMLElement) {
  document.querySelectorAll('.card-menu-dropdown').forEach((el) => {
    if (el !== except) el.classList.add('hidden');
  });
}

export function renderDashboard(container: HTMLElement): () => void {
  let currentTab: 'available' | 'sold' | 'archived' = 'available';
  let allProducts: Product[] = [];
  let searchQuery = '';
  let unsub: (() => void) | null = null;

  function render() {
    const filtered = allProducts.filter((p) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    });

    container.innerHTML = `
      ${currentTab === 'available' ? renderStats(allProducts) : ''}
      <div id="ml-auth-banner"></div>
      <div class="filter-row">
        <div class="status-tabs">
          <button class="status-tab ${currentTab === 'available' ? 'active' : ''}" data-tab="available">Disponibles</button>
          <button class="status-tab ${currentTab === 'sold' ? 'active' : ''}" data-tab="sold">Vendidos</button>
          <button class="status-tab ${currentTab === 'archived' ? 'active' : ''}" data-tab="archived">Archivados</button>
        </div>
        <input class="input input-sm search-input" type="search" placeholder="Buscar..." value="${esc(searchQuery)}" />
      </div>
      <div class="product-list">
        ${filtered.length ? filtered.map(productCard).join('') : '<div class="empty-state">No hay productos</div>'}
      </div>
    `;

    // Tab switching
    container.querySelectorAll('.status-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = (btn as HTMLElement).dataset.tab as typeof currentTab;
        subscribe();
      });
    });

    // Search
    container.querySelector('.search-input')?.addEventListener('input', (e) => {
      searchQuery = (e.target as HTMLInputElement).value;
      render();
    });

    // Menu toggles
    container.querySelectorAll('.card-menu-trigger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = (btn as HTMLElement).nextElementSibling as HTMLElement;
        const willOpen = dropdown.classList.contains('hidden');
        closeAllMenus();
        if (willOpen) dropdown.classList.remove('hidden');
      });
    });

    // Card actions (menu items + primary button), dispatched by data-action
    container.querySelectorAll('.product-card').forEach((card) => {
      const id = (card as HTMLElement).dataset.id!;
      const product = allProducts.find((p) => p.id === id);
      if (!product) return;

      card.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          closeAllMenus();
          const action = btn.dataset.action;

          if (action === 'edit') return showEditModal(product);
          if (action === 'sell') return showSellModal(product);

          if (action === 'archive') {
            try {
              await archiveProduct(id);
              showToast('Producto archivado');
            } catch {
              showToast('Error', 'error');
            }
            return;
          }

          if (action === 'reactivate') {
            try {
              await reactivateProduct(id);
              showToast('Producto reactivado');
            } catch {
              showToast('Error', 'error');
            }
            return;
          }

          if (action === 'ml-publish') {
            btn.disabled = true;
            btn.textContent = 'Publicando...';
            try {
              const result = await mlPublish(id);
              showToast(`Publicado: ${result.mlId}`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Error ML';
              showToast(msg, 'error');
            }
            return;
          }

          if (action === 'ml-pause') {
            btn.disabled = true;
            try {
              await mlToggle(id, product.mlId!, 'paused');
              showToast('Publicacion pausada');
            } catch {
              showToast('Error al pausar', 'error');
            }
            return;
          }

          if (action === 'ml-activate') {
            btn.disabled = true;
            try {
              await mlToggle(id, product.mlId!, 'active');
              showToast('Publicacion reactivada');
            } catch {
              showToast('Error al reactivar', 'error');
            }
            return;
          }
        });
      });
    });
  }

  const closeMenusOnOutsideClick = () => closeAllMenus();
  document.addEventListener('click', closeMenusOnOutsideClick);

  function subscribe() {
    if (unsub) unsub();
    unsub = subscribeProducts(currentTab, (products) => {
      allProducts = products;
      render();
    });
  }

  subscribe();

  // Check ML auth
  mlCheckAuth()
    .then((authorized) => {
      const banner = document.getElementById('ml-auth-banner');
      if (!banner) return;
      if (!authorized) {
        banner.innerHTML = `
          <div class="card" style="background:#fff8e1;border-left:4px solid #ff9500;padding:12px 16px">
            <strong>ML no autorizado</strong>
            <p class="hint" style="margin:4px 0 8px">Autorizá tu cuenta de Mercado Libre para publicar productos.</p>
            <button class="btn btn-sm btn-ml" id="ml-auth-btn">Autorizar ML</button>
          </div>
        `;
        document.getElementById('ml-auth-btn')?.addEventListener('click', async () => {
          try {
            const url = await mlGetAuthUrl();
            window.open(url, '_blank');
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error';
            showToast(msg, 'error');
          }
        });
      }
    })
    .catch(() => { /* functions not deployed yet */ });

  return () => {
    if (unsub) unsub();
    document.removeEventListener('click', closeMenusOnOutsideClick);
  };
}
