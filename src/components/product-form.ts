import { addProduct, uploadProductPhoto, updateProduct } from '../lib/products';
import { mlSearch, mlPrefill, type MLCandidate } from '../lib/ml';
import { showToast } from '../lib/toast';
import { CATEGORIES } from '../lib/types';
import { esc } from '../lib/sanitize';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Product } from '../lib/types';

function formatPrice(n: number): string {
  return '$' + n.toLocaleString('es-AR');
}

export async function renderProductForm(container: HTMLElement, editId?: string) {
  let editing: Product | null = null;

  if (editId) {
    const snap = await getDoc(doc(db, 'products', editId));
    if (snap.exists()) editing = { id: snap.id, ...snap.data() } as Product;
  }

  // Populated when a search result is picked — saved alongside the product
  let mlPhotoUrl = '';
  let mlSourceId = '';
  let mlSourceTitle = '';

  container.innerHTML = `
    <div class="card">
      <h2>${editing ? 'Editar producto' : 'Agregar producto'}</h2>

      ${!editing ? `
        <div class="ml-search-section">
          <p class="label">Vender uno similar (ML)</p>
          <input class="input" id="ml-search-input" placeholder="ej: zapatillas nike jordan" autocomplete="off" />
          <div id="ml-results"></div>
          <p class="hint">Tocá el que coincida: copia nombre, categoría, descripción y precio de ML — ajustá el precio y guardá</p>
        </div>
        <hr style="border:none;border-top:1px solid var(--color-border);margin:16px 0" />
      ` : ''}

      <form id="product-form">
        <div class="form-group">
          <label class="label">Nombre</label>
          <input class="input" id="f-name" required value="${editing ? esc(editing.name) : ''}" />
        </div>
        <div class="form-group">
          <label class="label">Categoria</label>
          <select class="input" id="f-category">
            ${CATEGORIES.map((c) => `<option value="${c}" ${editing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Condicion (1-10)</label>
            <input class="input" type="number" id="f-condition" min="1" max="10" value="${editing?.condition ?? 7}" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio costo</label>
            <input class="input" type="number" id="f-cost" value="${editing?.costPrice ?? 0}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Precio lista</label>
            <input class="input" type="number" id="f-list" required value="${editing?.listPrice ?? ''}" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio piso</label>
            <input class="input" type="number" id="f-floor" value="${editing?.floorPrice ?? ''}" />
          </div>
        </div>
        <div class="form-group">
          <label class="label">Notas</label>
          <textarea class="input" id="f-notes" rows="2">${editing ? esc(editing.notes) : ''}</textarea>
        </div>
        <div class="form-group">
          <label class="label">Foto</label>
          <div id="ml-reference-box"></div>
          <input class="input" type="file" id="f-photo" accept="image/*" />
          ${editing?.photoUrl ? `<img class="photo-preview" src="${esc(editing.photoUrl)}" />` : ''}
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">
          ${editing ? 'Guardar cambios' : 'Agregar producto'}
        </button>
      </form>
    </div>
  `;

  function renderReferencePhoto() {
    const box = document.getElementById('ml-reference-box');
    if (!box) return;
    box.innerHTML = mlPhotoUrl
      ? `
        <div class="ml-reference">
          <img class="ml-reference-photo" src="${esc(mlPhotoUrl)}" alt="" />
          <span class="hint">Foto de referencia de ML — subí la tuya cuando puedas</span>
        </div>
      `
      : '';
  }

  // ML search
  const searchInput = document.getElementById('ml-search-input') as HTMLInputElement | null;
  const resultsBox = document.getElementById('ml-results');

  function renderResults(candidates: MLCandidate[]) {
    if (!resultsBox) return;
    if (!candidates.length) {
      resultsBox.innerHTML = '<p class="hint">Sin resultados. Cargá los datos a mano abajo.</p>';
      return;
    }
    resultsBox.innerHTML = candidates.map((c, i) => `
      <div class="ml-result-item" data-index="${i}">
        <img class="ml-result-thumb" src="${esc(c.thumbnail)}" alt="" loading="lazy" />
        <div class="ml-result-info">
          <div class="ml-result-title">${esc(c.title)}</div>
          <div class="ml-result-price">${formatPrice(c.price)}</div>
        </div>
      </div>
    `).join('');
    resultsBox.querySelectorAll('.ml-result-item').forEach((el) => {
      const index = Number((el as HTMLElement).dataset.index);
      el.addEventListener('click', () => selectCandidate(candidates[index]));
    });
  }

  function renderMatchedChip() {
    if (!resultsBox) return;
    resultsBox.innerHTML = `
      <div class="ml-matched">
        <span>✓ Copiado de ML: ${esc(mlSourceTitle)}</span>
        <button type="button" class="btn-link ml-matched-clear">Cambiar</button>
      </div>
    `;
    resultsBox.querySelector('.ml-matched-clear')?.addEventListener('click', () => {
      mlPhotoUrl = '';
      mlSourceId = '';
      mlSourceTitle = '';
      renderReferencePhoto();
      resultsBox!.innerHTML = '';
      searchInput?.focus();
    });
  }

  async function selectCandidate(candidate: MLCandidate) {
    if (!resultsBox) return;
    resultsBox.innerHTML = '<p class="hint">Cargando...</p>';
    try {
      const prefill = await mlPrefill(candidate.id);
      (document.getElementById('f-name') as HTMLInputElement).value = prefill.name;
      (document.getElementById('f-category') as HTMLSelectElement).value = prefill.category;
      (document.getElementById('f-condition') as HTMLInputElement).value = String(prefill.condition);
      (document.getElementById('f-notes') as HTMLTextAreaElement).value = prefill.notes;
      mlPhotoUrl = prefill.mlPhotoUrl;
      mlSourceId = prefill.mlSourceId;
      mlSourceTitle = prefill.mlSourceTitle;
      renderReferencePhoto();
      renderMatchedChip();

      const priceInput = document.getElementById('f-list') as HTMLInputElement;
      priceInput.value = String(candidate.price);
      priceInput.focus();
      priceInput.select();
      showToast('Datos completados — ajustá el precio');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cargar la publicación';
      showToast(msg, 'error');
      resultsBox.innerHTML = '';
    }
  }

  if (searchInput && resultsBox) {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function runSearch() {
      const q = searchInput!.value.trim();
      if (q.length < 3) {
        resultsBox!.innerHTML = '';
        return;
      }
      resultsBox!.innerHTML = '<p class="hint">Buscando...</p>';
      try {
        const results = await mlSearch(q);
        renderResults(results);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al buscar';
        resultsBox!.innerHTML = `<p class="hint">${esc(msg)}</p>`;
      }
    }

    searchInput.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 500);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (debounceTimer) clearTimeout(debounceTimer);
        runSearch();
      }
    });
    searchInput.focus();
  }

  // Form submit
  document.getElementById('product-form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';

    try {
      const name = (document.getElementById('f-name') as HTMLInputElement).value.trim();
      const category = (document.getElementById('f-category') as HTMLSelectElement).value;
      const condition = Number((document.getElementById('f-condition') as HTMLInputElement).value);
      const listPrice = Number((document.getElementById('f-list') as HTMLInputElement).value);
      const floorPrice = Number((document.getElementById('f-floor') as HTMLInputElement).value) || Math.round(listPrice * 0.8);
      const costPrice = Number((document.getElementById('f-cost') as HTMLInputElement).value) || 0;
      const notes = (document.getElementById('f-notes') as HTMLTextAreaElement).value.trim();
      const photoFile = (document.getElementById('f-photo') as HTMLInputElement).files?.[0];

      if (!name || !listPrice) {
        showToast('Nombre y precio son requeridos', 'error');
        return;
      }

      if (editing) {
        const data: Partial<Product> = { name, category, condition, listPrice, floorPrice, costPrice, notes };
        if (photoFile) {
          data.photoUrl = await uploadProductPhoto(photoFile, editing.id);
        }
        await updateProduct(editing.id, data);
        showToast('Producto actualizado');
        window.location.hash = '#productos';
      } else {
        const productData = {
          name,
          category,
          condition,
          listPrice,
          floorPrice,
          costPrice,
          notes,
          photoUrl: '',
          status: 'available' as const,
          ...(searchInput?.value ? { parsedFrom: searchInput.value } : {}),
          ...(mlPhotoUrl ? { mlPhotoUrl } : {}),
          ...(mlSourceId ? { mlSourceId } : {}),
          ...(mlSourceTitle ? { mlSourceTitle } : {}),
        };
        const id = await addProduct(productData);
        if (photoFile) {
          const photoUrl = await uploadProductPhoto(photoFile, id);
          await updateProduct(id, { photoUrl });
        }
        showToast('Producto agregado');
        window.location.hash = '#productos';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      showToast(msg, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = editing ? 'Guardar cambios' : 'Agregar producto';
    }
  });
}
