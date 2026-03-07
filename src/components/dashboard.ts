import { subscribeProducts, markSold, archiveProduct, reactivateProduct } from '../lib/products';
import { mlPublish, mlToggle, mlGetAuthUrl, mlCheckAuth } from '../lib/ml';
import { showToast } from '../lib/toast';
import { esc } from '../lib/sanitize';
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

function productCard(p: Product): string {
  const photo = p.photoUrl
    ? `<img class="product-thumb" src="${esc(p.photoUrl)}" alt="" loading="lazy" />`
    : '<div class="product-thumb product-thumb-empty">📦</div>';

  const margin = p.salePrice
    ? `<span class="stat-green">+${formatPrice(p.salePrice - p.costPrice)}</span>`
    : '';

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
      </div>
      <div class="product-card-prices">
        <span class="product-price">${formatPrice(p.listPrice)}</span>
        ${p.floorPrice ? `<span class="product-floor">Piso: ${formatPrice(p.floorPrice)}</span>` : ''}
        ${margin}
      </div>
      <div class="product-card-status">
        ${statusBadge(p)}
        ${p.mlLink ? `<a href="${esc(p.mlLink)}" target="_blank" class="ml-link">Ver en ML</a>` : ''}
      </div>
      <div class="product-card-actions">
        ${p.status === 'available' ? `
          ${!p.mlId ? `<button class="btn btn-sm btn-ml action-ml-publish">Publicar ML</button>` : ''}
          ${p.mlId && p.mlStatus === 'active' ? `<button class="btn btn-sm btn-ml-outline action-ml-pause">Pausar ML</button>` : ''}
          ${p.mlId && p.mlStatus === 'paused' ? `<button class="btn btn-sm btn-ml action-ml-activate">Reactivar ML</button>` : ''}
          <button class="btn btn-sm btn-success action-sell">Vender</button>
          <button class="btn btn-sm btn-secondary action-archive">Archivar</button>
          <button class="btn btn-sm btn-secondary action-edit">Editar</button>
        ` : ''}
        ${p.status === 'archived' ? `
          <button class="btn btn-sm btn-primary action-reactivate">Reactivar</button>
        ` : ''}
        ${p.status === 'sold' ? `
          <span class="sale-info">Vendido: ${formatPrice(p.salePrice || 0)}</span>
        ` : ''}
      </div>
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

    // Card actions
    container.querySelectorAll('.product-card').forEach((card) => {
      const id = (card as HTMLElement).dataset.id!;
      const product = allProducts.find((p) => p.id === id);
      if (!product) return;

      card.querySelector('.action-ml-publish')?.addEventListener('click', async (e) => {
        const btn = e.target as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Publicando...';
        try {
          const result = await mlPublish(id);
          showToast(`Publicado: ${result.mlId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Error ML';
          showToast(msg, 'error');
        }
      });
      card.querySelector('.action-ml-pause')?.addEventListener('click', async (e) => {
        const btn = e.target as HTMLButtonElement;
        btn.disabled = true;
        try {
          await mlToggle(id, product.mlId!, 'paused');
          showToast('Publicacion pausada');
        } catch {
          showToast('Error al pausar', 'error');
        }
      });
      card.querySelector('.action-ml-activate')?.addEventListener('click', async (e) => {
        const btn = e.target as HTMLButtonElement;
        btn.disabled = true;
        try {
          await mlToggle(id, product.mlId!, 'active');
          showToast('Publicacion reactivada');
        } catch {
          showToast('Error al reactivar', 'error');
        }
      });
      card.querySelector('.action-sell')?.addEventListener('click', () => showSellModal(product));
      card.querySelector('.action-archive')?.addEventListener('click', async () => {
        try {
          await archiveProduct(id);
          showToast('Producto archivado');
        } catch {
          showToast('Error', 'error');
        }
      });
      card.querySelector('.action-reactivate')?.addEventListener('click', async () => {
        try {
          await reactivateProduct(id);
          showToast('Producto reactivado');
        } catch {
          showToast('Error', 'error');
        }
      });
      card.querySelector('.action-edit')?.addEventListener('click', () => {
        window.location.hash = `#editar/${id}`;
      });
    });
  }

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
  };
}
