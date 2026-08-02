import { addProduct, uploadProductPhoto, updateProduct } from '../lib/products';
import { aiParseProduct } from '../lib/ai';
import { showToast } from '../lib/toast';
import { CATEGORIES } from '../lib/types';

function readFileAsBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.split(',')[1] || '';
      resolve({ data, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function renderProductForm(container: HTMLElement) {
  container.innerHTML = `
    <div class="card">
      <h2>Agregar producto</h2>

      <div class="ai-intake-section">
        <p class="label">Carga con IA</p>
        <input class="input" id="ai-text-input" placeholder="ej: zapatillas nike jordan usadas" autocomplete="off" />
        <input class="input" type="file" id="f-photo" accept="image/*" capture="environment" style="margin-top:8px" />
        <button type="button" class="btn btn-secondary" id="ai-complete-btn" style="width:100%;margin-top:8px">✨ Completar con IA</button>
        <p class="hint">Escribí una descripción breve y/o subí una foto — la IA completa nombre, categoría, condición y notas; vos ponés el precio</p>
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
        <button class="btn btn-primary" type="submit" style="width:100%">
          Agregar producto
        </button>
      </form>
    </div>
  `;

  const aiTextInput = document.getElementById('ai-text-input') as HTMLInputElement;
  const aiCompleteBtn = document.getElementById('ai-complete-btn') as HTMLButtonElement;
  const photoInput = document.getElementById('f-photo') as HTMLInputElement;

  aiTextInput.focus();

  aiCompleteBtn.addEventListener('click', async () => {
    const text = aiTextInput.value.trim();
    const photoFile = photoInput.files?.[0];
    if (!text && !photoFile) {
      showToast('Escribí una descripción o subí una foto', 'error');
      return;
    }

    aiCompleteBtn.disabled = true;
    aiCompleteBtn.textContent = 'Pensando...';
    try {
      let photoBase64: string | undefined;
      let photoMimeType: string | undefined;
      if (photoFile) {
        const encoded = await readFileAsBase64(photoFile);
        photoBase64 = encoded.data;
        photoMimeType = encoded.mimeType;
      }

      const result = await aiParseProduct({ text: text || undefined, photoBase64, photoMimeType });
      (document.getElementById('f-name') as HTMLInputElement).value = result.name;
      (document.getElementById('f-category') as HTMLSelectElement).value = result.category;
      (document.getElementById('f-condition') as HTMLInputElement).value = String(result.condition);
      (document.getElementById('f-notes') as HTMLTextAreaElement).value = result.notes;

      const priceInput = document.getElementById('f-list') as HTMLInputElement;
      priceInput.focus();
      showToast('Completado con IA — ingresá el precio');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error de IA';
      showToast(msg, 'error');
    } finally {
      aiCompleteBtn.disabled = false;
      aiCompleteBtn.textContent = '✨ Completar con IA';
    }
  });

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
      const photoFile = photoInput.files?.[0];

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
