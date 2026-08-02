import { addProduct, uploadProductPhoto, updateProduct } from '../lib/products';
import { mlPrefill } from '../lib/ml';
import { showToast } from '../lib/toast';
import { CATEGORIES } from '../lib/types';
import { esc } from '../lib/sanitize';

function extractMlRef(text: string): { id: string; kind: 'catalog' | 'item' } | null {
  // Catalog product link (ML's own "sell one like this"): .../up/MLAU123... or .../p/MLA123...
  const catalogMatch = text.match(/\/up\/(MLAU\d+)/i) || text.match(/\/p\/(MLA\d+)/i);
  if (catalogMatch) return { id: catalogMatch[1].toUpperCase(), kind: 'catalog' };

  const itemMatch = text.match(/MLA-?(\d{6,})/i);
  if (itemMatch) return { id: `MLA${itemMatch[1]}`, kind: 'item' };

  return null;
}

export function renderProductForm(container: HTMLElement) {
  // Populated when an ML link is pasted — saved alongside the product
  let mlPhotoUrl = '';
  let mlSourceId = '';
  let mlSourceTitle = '';

  container.innerHTML = `
    <div class="card">
      <h2>Agregar producto</h2>

      <div class="ml-search-section">
        <p class="label">Vender uno similar (ML)</p>
        <input class="input" id="ml-link-input" placeholder="Pegá el link del producto de ML" autocomplete="off" inputmode="url" />
        <div id="ml-results"></div>
        <p class="hint">Buscalo en la app de ML, copiá el link de esa publicación y pegalo acá — copia nombre, categoría, descripción y foto; vos ponés el precio</p>
      </div>
      <hr style="border:none;border-top:1px solid var(--color-border);margin:16px 0" />

      <form id="product-form">
        <div class="form-group">
          <label class="label">Nombre</label>
          <input class="input" id="f-name" required value="" />
        </div>
        <div class="form-group">
          <label class="label">Categoria</label>
          <select class="input" id="f-category">
            ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Condicion (1-10)</label>
            <input class="input" type="number" id="f-condition" min="1" max="10" value="7" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio costo</label>
            <input class="input" type="number" id="f-cost" value="0" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-half">
            <label class="label">Precio lista</label>
            <input class="input" type="number" id="f-list" required value="" />
          </div>
          <div class="form-group form-half">
            <label class="label">Precio piso</label>
            <input class="input" type="number" id="f-floor" value="" />
          </div>
        </div>
        <div class="form-group">
          <label class="label">Notas</label>
          <textarea class="input" id="f-notes" rows="2"></textarea>
        </div>
        <div class="form-group">
          <label class="label">Foto</label>
          <div id="ml-reference-box"></div>
          <input class="input" type="file" id="f-photo" accept="image/*" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">
          Agregar producto
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

  // ML link prefill
  const linkInput = document.getElementById('ml-link-input') as HTMLInputElement | null;
  const resultsBox = document.getElementById('ml-results');
  let lastProcessed = '';

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
      lastProcessed = '';
      renderReferencePhoto();
      resultsBox!.innerHTML = '';
      if (linkInput) linkInput.value = '';
      linkInput?.focus();
    });
  }

  async function loadFromRef(ref: { id: string; kind: 'catalog' | 'item' }) {
    if (!resultsBox) return;
    resultsBox.innerHTML = '<p class="hint">Cargando...</p>';
    try {
      const prefill = await mlPrefill(ref.id, ref.kind);
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
      if (prefill.price) priceInput.value = String(prefill.price);
      priceInput.focus();
      priceInput.select();
      showToast('Datos completados — ajustá el precio');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al cargar la publicación';
      resultsBox.innerHTML = `<p class="hint">${esc(msg)}</p>`;
    }
  }

  if (linkInput && resultsBox) {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function tryLoad() {
      const text = linkInput!.value.trim();
      if (!text || text === lastProcessed) return;
      const ref = extractMlRef(text);
      if (!ref) {
        resultsBox!.innerHTML = '<p class="hint">No encontré el link de ML ahí — pegá el link completo de la publicación</p>';
        return;
      }
      lastProcessed = text;
      loadFromRef(ref);
    }

    linkInput.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(tryLoad, 300);
    });
    linkInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (debounceTimer) clearTimeout(debounceTimer);
        tryLoad();
      }
    });
    linkInput.focus();
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
        ...(linkInput?.value ? { parsedFrom: linkInput.value } : {}),
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      showToast(msg, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Agregar producto';
    }
  });
}
