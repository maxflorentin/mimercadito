import { getAI, getGenerativeModel, GoogleAIBackend } from 'firebase/ai';
import { app } from './firebase';
import { CATEGORIES } from './types';

const ai = getAI(app, { backend: new GoogleAIBackend() });
const model = getGenerativeModel(ai, { model: 'gemini-2.5-flash' });

interface ParsedProduct {
  name: string;
  category: string;
  condition: number;
  listPrice: number;
  floorPrice: number;
  costPrice: number;
  notes: string;
}

function localParse(input: string): ParsedProduct | null {
  const lower = input.toLowerCase().trim();

  // Extract price: "80k" or "80000"
  let price = 0;
  const kMatch = lower.match(/(\d+[\.,]?\d*)\s*k\b/i);
  if (kMatch) {
    price = parseFloat(kMatch[1].replace(',', '.')) * 1000;
  } else {
    const numMatch = lower.match(/(\d{1,3}(?:[\.,]\d{3})+)/);
    if (numMatch) {
      price = parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'));
    } else {
      const simpleMatch = lower.match(/(\d+)/);
      if (simpleMatch) price = parseInt(simpleMatch[1], 10);
    }
  }

  if (price <= 0) return null;

  // Remove price from input to get name
  let name = lower
    .replace(/\d+[\.,]?\d*\s*k\b/gi, '')
    .replace(/\d+/g, '')
    .replace(/\$/g, '')
    .trim();

  // Capitalize words
  name = name
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Guess condition from keywords
  let condition = 7;
  if (/nuev|sellad|etiqueta|sin uso/i.test(lower)) condition = 10;
  if (/usado|gastado/i.test(lower)) condition = 5;

  // Guess category
  let category = 'Other';
  const categoryMap: Record<string, string> = {
    pantalon: 'Fashion', remera: 'Fashion', campera: 'Fashion', zapatilla: 'Fashion',
    zapato: 'Fashion', vestido: 'Fashion', camisa: 'Fashion', short: 'Fashion',
    jean: 'Fashion', buzo: 'Fashion', ropa: 'Fashion', cartera: 'Fashion',
    celular: 'Electronics', notebook: 'Electronics', tablet: 'Electronics',
    auricular: 'Electronics', parlante: 'Electronics', cargador: 'Electronics',
    silla: 'Home', mesa: 'Home', lampara: 'Home', espejo: 'Home',
    pelota: 'Sports', bici: 'Sports', raqueta: 'Sports',
    juguete: 'Toys', muneca: 'Toys', lego: 'Toys',
    libro: 'Books', manual: 'Books',
    taladro: 'Tools', destornillador: 'Tools',
  };

  for (const [keyword, cat] of Object.entries(categoryMap)) {
    if (lower.includes(keyword)) {
      category = cat;
      break;
    }
  }

  return {
    name: name || 'Producto',
    category,
    condition,
    listPrice: price,
    floorPrice: Math.round(price * 0.8),
    costPrice: 0,
    notes: '',
  };
}

function validateParsed(data: ParsedProduct): ParsedProduct | null {
  if (!data.listPrice || data.listPrice <= 0) return null;
  if (!CATEGORIES.includes(data.category as (typeof CATEGORIES)[number])) data.category = 'Other';
  data.name = (data.name || '').slice(0, 200);
  if (!data.name) data.name = 'Producto';
  if (!data.condition || data.condition < 1) data.condition = 7;
  if (data.condition > 10) data.condition = 10;
  if (!data.floorPrice) data.floorPrice = Math.round(data.listPrice * 0.8);
  return data;
}

export async function parseProductPhoto(file: File): Promise<ParsedProduct | null> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';

  const prompt = `Analizá esta foto de un producto para venta en Argentina.
Categorías válidas: ${CATEGORIES.join(', ')}.

Identificá:
- Qué producto es (nombre descriptivo para publicar en MercadoLibre)
- Categoría
- Condición estimada (1-10, donde 10 es nuevo/sellado)
- Precio de lista estimado en ARS (basado en producto y condición)
- floorPrice = ~80% del listPrice
- Notas: marca, modelo, detalles relevantes que veas

Respondé SOLO con JSON:
{"name": "string", "category": "string", "condition": number, "listPrice": number, "floorPrice": number, "costPrice": 0, "notes": "string"}`;

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
    });

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed: ParsedProduct = JSON.parse(jsonMatch[0]);
    return validateParsed(parsed);
  } catch {
    return null;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:image/...;base64, prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function parseProductInput(input: string): Promise<ParsedProduct | null> {
  try {
    const prompt = `Sos un parser de productos para venta en Argentina. Dada la entrada del usuario, extraé los datos del producto.
Categorías válidas: ${CATEGORIES.join(', ')}.

Reglas:
- Si dice "k" después de un número, multiplicá por 1000 (ej: "80k" = 80000)
- Si dice "nuevo" o "con etiquetas", condition = 10
- Si dice "usado", condition = 5-7 según contexto
- floorPrice = ~80% del listPrice (precio mínimo aceptable)
- costPrice = 0 si no se menciona

Respondé SOLO con JSON:
{"name": "string", "category": "string", "condition": number, "listPrice": number, "floorPrice": number, "costPrice": number, "notes": "string"}

Entrada: "${input}"`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
    });

    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const parsed: ParsedProduct = JSON.parse(jsonMatch[0]);
    return validateParsed(parsed);
  } catch {
    return localParse(input);
  }
}
