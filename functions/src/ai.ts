import { GoogleGenerativeAI, type Part } from "@google/generative-ai";

const CATEGORIES = ["Electronics", "Fashion", "Home", "Sports", "Toys", "Books", "Tools", "Auto", "Other"];

export interface AIParseResult {
  name: string;
  category: string;
  notes: string;
  condition: number;
}

export async function parseProductWithAI(input: {
  text?: string;
  photoBase64?: string;
  photoMimeType?: string;
}): Promise<AIParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const parts: Part[] = [];
  if (input.photoBase64) {
    parts.push({ inlineData: { data: input.photoBase64, mimeType: input.photoMimeType || "image/jpeg" } });
  }
  parts.push({
    text: `Sos un asistente que cataloga productos usados, semi-nuevos o nuevos para vender en Mercado Libre Argentina.
${input.text ? `Descripción del vendedor: "${input.text}"` : ""}
${input.photoBase64 ? "Mirá la foto adjunta del producto." : ""}
Devolvé SOLO un JSON, sin texto adicional ni markdown, con esta forma exacta:
{"name": "nombre corto y claro del producto", "category": "una de estas exactamente: ${CATEGORIES.join(", ")}", "notes": "descripción breve en 1-2 oraciones", "condition": <número 1 a 10, 10 nuevo, 6-7 usado normal>}`,
  });

  const result = await model.generateContent(parts);
  const text = result.response.text();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("La IA no devolvió un resultado válido");
  const parsed = JSON.parse(jsonMatch[0]);

  const condition = Number(parsed.condition);

  return {
    name: String(parsed.name || "Producto"),
    category: CATEGORIES.includes(parsed.category) ? parsed.category : "Other",
    notes: String(parsed.notes || ""),
    condition: condition >= 1 && condition <= 10 ? condition : 7,
  };
}
