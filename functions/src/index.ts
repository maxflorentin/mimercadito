import * as admin from "firebase-admin";
import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import {
  getAuthUrl,
  exchangeCode,
  publishProduct,
  toggleListing,
  updateListing,
  isMLAuthorized,
} from "./ml";

admin.initializeApp();

const ALLOWED_EMAILS = ["macsee13@gmail.com", "romi.fndz87@gmail.com"];

function assertAuthorized(auth: { token: { email?: string } } | undefined) {
  if (!auth?.token?.email || !ALLOWED_EMAILS.includes(auth.token.email)) {
    throw new HttpsError("permission-denied", "No autorizado");
  }
}

// --- ML Auth ---

export const mlGetAuthUrl = onCall(
  { region: "us-central1", secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"] },
  async (req) => {
    assertAuthorized(req.auth);
    return { url: getAuthUrl() };
  }
);

export const mlCallback = onRequest(
  { region: "us-central1", secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"] },
  async (req, res) => {
    const code = req.query.code as string;
    if (!code) {
      res.status(400).send("Missing code");
      return;
    }
    try {
      await exchangeCode(code);
      res.send("<html><body><h1>ML autorizado correctamente</h1><p>Podes cerrar esta ventana.</p></body></html>");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      res.status(500).send(`Error: ${msg}`);
    }
  }
);

export const mlCheckAuth = onCall(
  { region: "us-central1" },
  async (req) => {
    assertAuthorized(req.auth);
    return { authorized: await isMLAuthorized() };
  }
);

// --- ML Publish ---

export const mlPublish = onCall(
  { region: "us-central1", secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"], timeoutSeconds: 60 },
  async (req) => {
    assertAuthorized(req.auth);
    const { productId } = req.data;
    if (!productId) throw new HttpsError("invalid-argument", "productId requerido");

    const snap = await admin.firestore().doc(`products/${productId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Producto no encontrado");

    const product = snap.data()!;
    const result = await publishProduct(productId, {
      name: product.name,
      category: product.category,
      condition: product.condition,
      listPrice: product.listPrice,
      notes: product.notes || "",
      photoUrl: product.photoUrl || "",
    });

    return result;
  }
);

// --- ML Pause / Activate ---

export const mlToggle = onCall(
  { region: "us-central1", secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"] },
  async (req) => {
    assertAuthorized(req.auth);
    const { productId, mlId, action } = req.data;
    if (!productId || !mlId || !action) {
      throw new HttpsError("invalid-argument", "productId, mlId, action requeridos");
    }
    if (action !== "paused" && action !== "active") {
      throw new HttpsError("invalid-argument", "action debe ser 'paused' o 'active'");
    }
    await toggleListing(productId, mlId, action);
    return { success: true };
  }
);

// --- ML Update ---

export const mlUpdate = onCall(
  { region: "us-central1", secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"] },
  async (req) => {
    assertAuthorized(req.auth);
    const { mlId, price, description } = req.data;
    if (!mlId) throw new HttpsError("invalid-argument", "mlId requerido");
    await updateListing(mlId, { price, description });
    return { success: true };
  }
);
