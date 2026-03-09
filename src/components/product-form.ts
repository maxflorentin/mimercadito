import { addProduct, uploadProductPhoto, updateProduct } from '../lib/products';
import { parseProductInput, parseProductPhoto } from '../lib/gemini';
import { showToast } from '../lib/toast';
import { CATEGORIES } from '../lib/types';
import { esc } from '../lib/sanitize';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Product } from '../lib/types';

export async function renderProductForm(container: HTMLElement, editId?: string) {
  let editing: Product | null = null;

  if (editId) {
    const snap = await getDoc(doc(db, 'products', editId));
    if (snap.exists()) editing = { id: snap.id, ...snap.data() } as Product;
  }

  container.innerHTML = `
    <div class="card">
      <h2>${editing ? 'Editar producto' : 'Agregar producto'}</h2>

      ${!editing ? `
        <div class="smart-input-section">
          <p class="label">Carga rapida con AI</p>
          <div class="smart-tabs">
            <button class="smart-tab active" data-mode="photo">Por foto</button>
            <button class="smart-tab" data-mode="text">Por texto</button>
          </div>
          <div id="smart-photo" class="smart-panel">
            <div class="photo-drop" id="photo-drop">
              <input type="file" id="smart-photo-input" accept="image/*" hidden />
              <div class="photo-drop-content" id="photo-drop-content">
                <span class="photo-drop-icon">📷</span>
                <span>Seleccionar foto</span>
                <span class="hint">Gemini analiza la foto y completa los datos</span>
              </div>
            </div>
          </div>
          <div id="smart-text" class="smart-panel" style="display:none">
            <div class="smart-input-row">
              <input class="input" id="smart-input" placeholder='Ej: "pantalon levis nuevo 80k"' />
              <button class="btn btn-primary" id="smart-parse">AI</button>
            </div>
            <p class="hint">Gemini parsea nombre, precio, categoria y condicion</p>
          </div>
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
          <input class="input" type="file" id="f-photo" accept="image/*" />
          ${editing?.photoUrl ? `<img class="photo-preview" src="${esc(editing.photoUrl)}" />` : ''}
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%">
          ${editing ? 'Guardar cambios' : 'Agregar producto'}
        </button>
      </form>
    </div>
  `;

  // Helper to fill form fields from parsed data
  function fillForm(parsed: { name: string; category: string; condition: number; listPrice: number; floorPrice: number; costPrice: number; notes: string }) {
    (document.getElementById('f-name') as HTMLInputElement).value = parsed.name;
    (document.getElementById('f-category') as HTMLSelectElement).value = parsed.category;
    (document.getElementById('f-condition') as HTMLInputElement).value = String(parsed.condition);
    (document.getElementById('f-list') as HTMLInputElement).value = String(parsed.listPrice);
    (document.getElementById('f-floor') as HTMLInputElement).value = String(parsed.floorPrice);
    (document.getElementById('f-cost') as HTMLInputElement).value = String(parsed.costPrice);
    (document.getElementById('f-notes') as HTMLInputElement).value = parsed.notes;
  }

  // Smart tabs
  container.querySelectorAll('.smart-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.smart-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = (tab as HTMLElement).dataset.mode;
      const photoPanel = document.getElementById('smart-photo');
      const textPanel = document.getElementById('smart-text');
      if (photoPanel) photoPanel.style.display = mode === 'photo' ? '' : 'none';
      if (textPanel) textPanel.style.display = mode === 'text' ? '' : 'none';
    });
  });

  // Smart photo input
  const photoDrop = document.getElementById('photo-drop');
  const photoInput = document.getElementById('smart-photo-input') as HTMLInputElement | null;
  if (photoDrop && photoInput) {
    photoDrop.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;

      // Show preview
      const dropContent = document.getElementById('photo-drop-content')!;
      const previewUrl = URL.createObjectURL(file);
      dropContent.innerHTML = `
        <img src="${previewUrl}" class="photo-drop-preview" />
        <span class="hint">Analizando con Gemini...</span>
      `;

      try {
        const parsed = await parseProductPhoto(file);
        if (parsed) {
          fillForm(parsed);
          // Also set the photo in the form's file input
          const formPhoto = document.getElementById('f-photo') as HTMLInputElement;
          const dt = new DataTransfer();
          dt.items.add(file);
          formPhoto.files = dt.files;
          dropContent.innerHTML = `
            <img src="${previewUrl}" class="photo-drop-preview" />
            <span class="hint" style="color:var(--color-success)">Datos completados con AI</span>
          `;
          showToast('Foto analizada con AI');
        } else {
          dropContent.innerHTML = `
            <img src="${previewUrl}" class="photo-drop-preview" />
            <span class="hint" style="color:var(--color-danger)">No se pudo analizar. Completá manualmente.</span>
          `;
          // Still set the photo
          const formPhoto = document.getElementById('f-photo') as HTMLInputElement;
          const dt = new DataTransfer();
          dt.items.add(file);
          formPhoto.files = dt.files;
        }
      } catch {
        dropContent.innerHTML = `
          <img src="${previewUrl}" class="photo-drop-preview" />
          <span class="hint" style="color:var(--color-danger)">Error de AI. Completá manualmente.</span>
        `;
      }
    });
  }

  // Smart text input
  const smartBtn = document.getElementById('smart-parse');
  const smartInput = document.getElementById('smart-input') as HTMLInputElement | null;
  if (smartBtn && smartInput) {
    smartBtn.addEventListener('click', async () => {
      const text = smartInput.value.trim();
      if (!text) return;
      smartBtn.textContent = '...';
      (smartBtn as HTMLButtonElement).disabled = true;
      try {
        const parsed = await parseProductInput(text);
        if (parsed) {
          fillForm(parsed);
          showToast('Parseado con AI');
        } else {
          showToast('No se pudo parsear', 'error');
        }
      } catch {
        showToast('Error de AI', 'error');
      } finally {
        smartBtn.textContent = 'AI';
        (smartBtn as HTMLButtonElement).disabled = false;
      }
    });
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
          parsedFrom: smartInput?.value || undefined,
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
