import { CATEGORIES } from './types';

const ML_API = 'https://api.mercadolibre.com';

// Map ML top-level category names to our app categories
const ML_CATEGORY_MAP: Record<string, string> = {
  'Ropa y Accesorios': 'Fashion',
  'Calzados': 'Fashion',
  'Celulares y Telefonía': 'Electronics',
  'Computación': 'Electronics',
  'Electrónica, Audio y Video': 'Electronics',
  'Consolas y Videojuegos': 'Electronics',
  'Cámaras y Accesorios': 'Electronics',
  'Hogar, Muebles y Jardín': 'Home',
  'Electrodomésticos y Aires Ac.': 'Home',
  'Deportes y Fitness': 'Sports',
  'Juegos y Juguetes': 'Toys',
  'Libros, Revistas y Comics': 'Books',
  'Herramientas': 'Tools',
  'Accesorios para Vehículos': 'Auto',
  'Autos, Motos y Otros': 'Auto',
};

async function predictCategory(title: string): Promise<string> {
  try {
    const res = await fetch(
      `${ML_API}/sites/MLA/category_predictor/predict?title=${encodeURIComponent(title)}`
    );
    if (!res.ok) return 'Other';
    const data = await res.json();
    const path = data.path_from_root || [];
    if (path.length > 0) {
      const topName: string = path[0].name;
      return ML_CATEGORY_MAP[topName] || 'Other';
    }
    return 'Other';
  } catch {
    return 'Other';
  }
}

// Local keyword fallback for category
const KEYWORD_CATEGORIES: Record<string, string> = {
  pantalon: 'Fashion', remera: 'Fashion', campera: 'Fashion', zapatilla: 'Fashion',
  zapato: 'Fashion', vestido: 'Fashion', camisa: 'Fashion', short: 'Fashion',
  jean: 'Fashion', buzo: 'Fashion', ropa: 'Fashion', cartera: 'Fashion',
  jordan: 'Fashion', nike: 'Fashion', adidas: 'Fashion',
  celular: 'Electronics', notebook: 'Electronics', tablet: 'Electronics',
  auricular: 'Electronics', parlante: 'Electronics', cargador: 'Electronics',
  silla: 'Home', mesa: 'Home', lampara: 'Home', espejo: 'Home',
  pelota: 'Sports', bici: 'Sports', raqueta: 'Sports',
  juguete: 'Toys', muneca: 'Toys', lego: 'Toys',
  libro: 'Books', manual: 'Books',
  taladro: 'Tools', destornillador: 'Tools',
};

interface ParsedProduct {
  name: string;
  category: string;
  condition: number;
  listPrice: number;
  floorPrice: number;
  costPrice: number;
  notes: string;
}

function extractPrice(text: string): number {
  const kMatch = text.match(/(\d+[\.,]?\d*)\s*k\b/i);
  if (kMatch) return parseFloat(kMatch[1].replace(',', '.')) * 1000;

  const dotMatch = text.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (dotMatch) return parseFloat(dotMatch[1].replace(/\./g, ''));

  const numMatch = text.match(/\b(\d{4,})\b/);
  if (numMatch) return parseInt(numMatch[1], 10);

  return 0;
}

function extractCondition(text: string): number {
  const lower = text.toLowerCase();
  if (/\bnuev[oa]s?\b|sellad|etiqueta|sin uso/i.test(lower)) return 10;
  if (/\busad[oa]s?\b|gastado/i.test(lower)) return 6;
  return 7;
}

function extractName(text: string): string {
  let name = text
    .replace(/\d+[\.,]?\d*\s*k\b/gi, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\d{1,3}(?:\.\d{3})+/g, '')
    .replace(/\$/g, '')
    .replace(/\b(nuev[oa]s?|usad[oa]s?|sellad[oa]?|sin uso)\b/gi, '')
    .trim();

  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Producto';
}

function localCategoryFallback(text: string): string {
  const lower = text.toLowerCase();
  for (const [keyword, cat] of Object.entries(KEYWORD_CATEGORIES)) {
    if (lower.includes(keyword)) return cat;
  }
  return 'Other';
}

export async function parseProductInput(input: string): Promise<ParsedProduct | null> {
  const price = extractPrice(input);
  const condition = extractCondition(input);
  const name = extractName(input);

  // Try ML category predictor, fall back to keywords
  let category = localCategoryFallback(input);
  if (name && name !== 'Producto') {
    const mlCat = await predictCategory(name);
    if (mlCat !== 'Other') category = mlCat;
  }

  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) category = 'Other';

  return {
    name,
    category,
    condition,
    listPrice: price,
    floorPrice: price ? Math.round(price * 0.8) : 0,
    costPrice: 0,
    notes: '',
  };
}
