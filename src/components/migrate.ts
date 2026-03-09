import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast } from '../lib/toast';
import { mlImportListings } from '../lib/ml';

interface SheetRow {
  date: string;
  name: string;
  category: string;
  condition: string;
  costPrice: string;
  listPrice: string;
  floorPrice: string;
  notes: string;
  photoUrl: string;
  status: string;
  salePrice: string;
  saleDate: string;
}

function mapCategory(cat: string): string {
  const map: Record<string, string> = {
    electronica: 'Electronics',
    electronics: 'Electronics',
    moda: 'Fashion',
    fashion: 'Fashion',
    ropa: 'Fashion',
    hogar: 'Home',
    home: 'Home',
    deportes: 'Sports',
    sports: 'Sports',
    juguetes: 'Toys',
    toys: 'Toys',
    libros: 'Books',
    books: 'Books',
    herramientas: 'Tools',
    tools: 'Tools',
    auto: 'Auto',
    otros: 'Other',
    other: 'Other',
  };
  return map[cat.toLowerCase()] || cat || 'Other';
}

function mapStatus(s: string): 'available' | 'sold' | 'archived' {
  const lower = s.toLowerCase();
  if (lower.includes('vendido') || lower.includes('sold')) return 'sold';
  if (lower.includes('delete') || lower.includes('archiv')) return 'archived';
  return 'available';
}

export function renderMigrate(container: HTMLElement) {
  container.innerHTML = `
    <div class="card">
      <h2>Importar desde Mercado Libre</h2>
      <p class="hint" style="margin-bottom:16px">Importa tus publicaciones activas y pausadas de ML al inventario.</p>
      <button class="btn btn-ml" id="ml-import-btn" style="width:100%">Importar de ML</button>
      <div id="ml-import-log" style="margin-top:12px;font-size:13px;color:var(--color-text-secondary)"></div>
    </div>

    <div class="card" style="margin-top:16px">
      <h2>Migrar desde Sheet</h2>
      <p class="hint" style="margin-bottom:16px">Ingresa la URL del GAS API y el token para importar los productos existentes.</p>
      <div class="form-group">
        <label class="label">GAS URL</label>
        <input class="input" id="mig-url" placeholder="https://script.google.com/macros/s/.../exec" />
      </div>
      <div class="form-group">
        <label class="label">API Token</label>
        <input class="input" id="mig-token" type="password" />
      </div>
      <button class="btn btn-primary" id="mig-start" style="width:100%">Migrar</button>
      <div id="mig-log" style="margin-top:16px;font-size:13px;color:var(--color-text-secondary)"></div>
    </div>
  `;

  // ML Import
  document.getElementById('ml-import-btn')!.addEventListener('click', async () => {
    const btn = document.getElementById('ml-import-btn') as HTMLButtonElement;
    const log = document.getElementById('ml-import-log')!;
    btn.disabled = true;
    btn.textContent = 'Importando...';
    log.textContent = 'Buscando publicaciones en ML...';
    try {
      const result = await mlImportListings();
      log.textContent = `Importados: ${result.imported} | Ya existentes: ${result.skipped}`;
      showToast(`${result.imported} productos importados de ML`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      log.textContent = `Error: ${msg}`;
      showToast('Error al importar de ML', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Importar de ML';
    }
  });

  // Sheet Migration
  document.getElementById('mig-start')!.addEventListener('click', async () => {
    const url = (document.getElementById('mig-url') as HTMLInputElement).value.trim();
    const token = (document.getElementById('mig-token') as HTMLInputElement).value.trim();
    if (!url || !token) return showToast('URL y token requeridos', 'error');

    const log = document.getElementById('mig-log')!;
    const btn = document.getElementById('mig-start') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Migrando...';
    log.textContent = 'Descargando datos del Sheet...';

    try {
      const res = await fetch(`${url}?action=getData&token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows: string[][] = json.data || json;

      if (!rows || rows.length === 0) {
        log.textContent = 'No hay datos para migrar.';
        return;
      }

      // Check existing products to avoid duplicates
      const existing = await getDocs(query(collection(db, 'products'), where('createdBy', '==', auth.currentUser!.uid)));
      const existingNames = new Set(existing.docs.map((d) => d.data().name?.toLowerCase()));

      let imported = 0;
      let skipped = 0;
      const user = auth.currentUser!;

      for (const row of rows) {
        const product: SheetRow = {
          date: row[0] || '',
          name: row[1] || '',
          category: row[2] || '',
          condition: row[3] || '',
          costPrice: row[4] || '',
          listPrice: row[5] || '',
          floorPrice: row[6] || '',
          notes: row[7] || '',
          photoUrl: row[8] || '',
          status: row[9] || '',
          salePrice: row[10] || '',
          saleDate: row[11] || '',
        };

        if (!product.name || existingNames.has(product.name.toLowerCase())) {
          skipped++;
          continue;
        }

        const status = mapStatus(product.status);

        const docData: Record<string, unknown> = {
          name: product.name,
          category: mapCategory(product.category),
          condition: Number(product.condition) || 7,
          costPrice: Number(product.costPrice) || 0,
          listPrice: Number(product.listPrice) || 0,
          floorPrice: Number(product.floorPrice) || 0,
          notes: product.notes,
          photoUrl: product.photoUrl,
          status,
          createdAt: product.date ? Timestamp.fromDate(new Date(product.date)) : Timestamp.now(),
          createdBy: user.uid,
          createdByEmail: user.email || '',
        };
        if (status === 'sold') {
          docData.salePrice = Number(product.salePrice) || 0;
          if (product.saleDate) docData.saleDate = Timestamp.fromDate(new Date(product.saleDate));
        }
        await addDoc(collection(db, 'products'), docData);

        imported++;
        log.textContent = `Importados: ${imported} | Omitidos: ${skipped}`;
      }

      log.textContent = `Migración completa. Importados: ${imported} | Omitidos (duplicados): ${skipped}`;
      showToast(`${imported} productos migrados`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      log.textContent = `Error: ${msg}`;
      showToast('Error en migración', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Migrar';
    }
  });
}
