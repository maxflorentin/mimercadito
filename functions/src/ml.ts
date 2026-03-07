import * as admin from "firebase-admin";

const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.ar";

interface MLTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function getMLSecrets() {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI must be set");
  }
  return { clientId, clientSecret, redirectUri };
}

export function getAuthUrl(): string {
  const { clientId, redirectUri } = getMLSecrets();
  return `${ML_AUTH}/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export async function exchangeCode(code: string): Promise<MLTokens> {
  const { clientId, clientSecret, redirectUri } = getMLSecrets();
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`ML OAuth error: ${await res.text()}`);
  const data = await res.json();
  const tokens: MLTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  await admin.firestore().doc("config/ml_tokens").set(tokens);
  return tokens;
}

async function getValidToken(): Promise<string> {
  const snap = await admin.firestore().doc("config/ml_tokens").get();
  if (!snap.exists) throw new Error("ML no autorizado. Autorizá primero.");
  const tokens = snap.data() as MLTokens;

  if (Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  // Refresh
  const { clientId, clientSecret } = getMLSecrets();
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`ML refresh error: ${await res.text()}`);
  const data = await res.json();
  const updated: MLTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  await admin.firestore().doc("config/ml_tokens").set(updated);
  return updated.access_token;
}

async function mlFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidToken();
  const res = await fetch(`${ML_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

// --- Category prediction ---

async function predictCategory(title: string): Promise<string> {
  const FALLBACK = "MLA1953"; // Otros > Otros
  const res = await mlFetch(
    `/sites/MLA/category_predictor/predict?title=${encodeURIComponent(title)}`
  );
  if (!res.ok) return FALLBACK;
  const data = await res.json();
  return data.id || data[0]?.id || FALLBACK;
}

// --- Required attributes ---

const SKIP_ATTR_IDS = new Set([
  "COLOR", "SIZE", "ALPHANUMERIC_SIZE", "SHOE_SIZE",
  "WAIST_SIZE", "CHEST_SIZE", "LENGTH", "WIDTH",
]);

interface MLAttribute {
  id: string;
  name: string;
  value_type: string;
  values?: { id: string; name: string }[];
  tags?: Record<string, unknown>;
  default_value?: string;
}

async function getRequiredAttributes(categoryId: string): Promise<{ resolved: Record<string, string>; allRequired: MLAttribute[] }> {
  const res = await mlFetch(`/categories/${categoryId}/attributes`);
  if (!res.ok) return { resolved: {}, allRequired: [] };
  const attrs: MLAttribute[] = await res.json();
  const allRequired = attrs.filter((a) => a.tags && a.tags.required);
  const resolved: Record<string, string> = {};

  for (const attr of allRequired) {
    if (SKIP_ATTR_IDS.has(attr.id)) continue;
    if (attr.tags?.allow_variations) continue;

    if (attr.default_value) {
      resolved[attr.id] = attr.default_value;
      continue;
    }

    if (attr.values && attr.values.length > 0) {
      const generic = attr.values.find((v) =>
        /gen[eé]ric|no.?aplic|no.?especif|sin.?especif|uni(versal|sex)/i.test(v.name)
      );
      if (generic) {
        resolved[attr.id] = generic.id;
      } else if (attr.values.length === 1) {
        resolved[attr.id] = attr.values[0].id;
      }
    }
  }
  return { resolved, allRequired };
}

// --- Publish ---

interface ProductData {
  name: string;
  category: string;
  condition: number;
  listPrice: number;
  notes: string;
  photoUrl: string;
}

export async function publishProduct(
  productId: string,
  product: ProductData
): Promise<{ mlId: string; mlLink: string }> {
  const categoryId = await predictCategory(product.name);
  const { resolved: reqAttrs, allRequired: allRequiredAttrs } = await getRequiredAttributes(categoryId);

  const attributes: Record<string, unknown>[] = Object.entries(reqAttrs).map(([id, value]) => ({
    id,
    value_id: value,
  }));

  // Fill any still-missing required attributes with generic text
  const filledIds = new Set(attributes.map((a) => a.id as string));
  for (const attr of allRequiredAttrs) {
    if (!filledIds.has(attr.id) && !SKIP_ATTR_IDS.has(attr.id) && !attr.tags?.allow_variations) {
      if (attr.value_type === "string" || attr.value_type === "number_unit") {
        attributes.push({ id: attr.id, value_name: "No especificado" });
      }
    }
  }

  // Add ITEM_CONDITION
  attributes.push({
    id: "ITEM_CONDITION",
    value_id: product.condition >= 9 ? "2230284" : "2230581", // Nuevo : Usado
  });

  const hasPicture = !!product.photoUrl;
  const listingType = hasPicture ? "gold_special" : "gold_pro";

  const body: Record<string, unknown> = {
    family_name: product.name,
    category_id: categoryId,
    price: product.listPrice,
    currency_id: "ARS",
    available_quantity: 1,
    buying_mode: "buy_it_now",
    listing_type_id: listingType,
    condition: product.condition >= 9 ? "new" : "used",
    description: { plain_text: product.notes || product.name },
    shipping: {
      mode: "me2",
      local_pick_up: true,
      free_shipping: false,
    },
    attributes,
  };

  if (hasPicture) {
    body.pictures = [{ source: product.photoUrl }];
  }

  const res = await mlFetch("/items", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`ML publish error: ${JSON.stringify(data)}`);
  }

  // Update Firestore
  await admin.firestore().doc(`products/${productId}`).update({
    mlId: data.id,
    mlLink: data.permalink,
    mlStatus: "active",
    mlCategoryId: categoryId,
  });

  return { mlId: data.id, mlLink: data.permalink };
}

// --- Pause / Activate ---

export async function toggleListing(
  productId: string,
  mlId: string,
  action: "paused" | "active"
): Promise<void> {
  const res = await mlFetch(`/items/${mlId}`, {
    method: "PUT",
    body: JSON.stringify({ status: action }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(`ML toggle error: ${JSON.stringify(data)}`);
  }
  await admin.firestore().doc(`products/${productId}`).update({
    mlStatus: action,
  });
}

// --- Update listing ---

export async function updateListing(
  mlId: string,
  updates: { price?: number; description?: string }
): Promise<void> {
  if (updates.price) {
    const res = await mlFetch(`/items/${mlId}`, {
      method: "PUT",
      body: JSON.stringify({ price: updates.price }),
    });
    if (!res.ok) throw new Error(`ML update price error: ${await res.text()}`);
  }
  if (updates.description) {
    const res = await mlFetch(`/items/${mlId}/description`, {
      method: "PUT",
      body: JSON.stringify({ plain_text: updates.description }),
    });
    if (!res.ok) throw new Error(`ML update desc error: ${await res.text()}`);
  }
}

// --- Check auth status ---

export async function isMLAuthorized(): Promise<boolean> {
  const snap = await admin.firestore().doc("config/ml_tokens").get();
  return snap.exists;
}
