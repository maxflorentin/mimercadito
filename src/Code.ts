/** 
 * GLOBAL_ENV: Placeholder para inyección automática desde GitHub Actions.
 * Para uso local, se completa vía setupSecrets() o editando este objeto.
 */
const GLOBAL_ENV = {
  SPREADSHEET_ID: 'REPLACE_WITH_SPREADSHEET_ID',
  DRIVE_FOLDER_ID: 'REPLACE_WITH_DRIVE_FOLDER_ID',
  API_TOKEN: 'REPLACE_WITH_API_TOKEN',
  AUTHORIZED_EMAILS: 'REPLACE_WITH_EMAILS',
  ML_CLIENT_ID: 'REPLACE_WITH_ML_CLIENT_ID',
  ML_CLIENT_SECRET: 'REPLACE_WITH_ML_CLIENT_SECRET'
};

function getSettings() {
  const p = PropertiesService.getScriptProperties().getProperties();

  // Prioridad: Inyección directa > Propiedades del script > Defaults
  const get = (key: keyof typeof GLOBAL_ENV) => {
    const val = GLOBAL_ENV[key];
    if (val && !val.includes('REPLACE_WITH')) return val;
    return p[key] || "";
  };

  return {
    SPREADSHEET_ID: get("SPREADSHEET_ID"),
    DRIVE_FOLDER_ID: get("DRIVE_FOLDER_ID"),
    API_TOKEN: get("API_TOKEN") || "default_token",
    AUTHORIZED_EMAILS: (get("AUTHORIZED_EMAILS") || "").split(","),
    ML_CLIENT_ID: get("ML_CLIENT_ID"),
    ML_CLIENT_SECRET: get("ML_CLIENT_SECRET")
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormPayload {
  productName: string;
  category: string;
  condition: string | number;
  costPrice?: string | number;   // optional — some items have no known cost
  publicPrice: string | number;
  minPrice: string | number;
  notes?: string;
  imageBlob?: string | null;
  rowIndex?: number; // Added for updates
}

// Column indices (0-based) in the Sheet — keep in sync with the header row
const COL = {
  DATE: 0,
  NAME: 1,
  CATEGORY: 2,
  CONDITION: 3,
  COST: 4,
  LIST: 5,
  FLOOR: 6,
  NOTES: 7,
  PHOTO: 8,
  STATUS: 9,
  SALE_PRICE: 10,
  SALE_DATE: 11,
  ML_ID: 12,
  ML_LINK: 13,
} as const;

type InventoryRow = string[];
type InventoryData = InventoryRow[];

/**
 * ONE-TIME SETUP: Run this function in the Apps Script Editor to set your IDs securely.
 */
function setupSecrets() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    "SPREADSHEET_ID": "PONER_ACA_ID_DEL_SHEET",
    "DRIVE_FOLDER_ID": "PONER_ACA_ID_DE_CARPETA",
    "AUTHORIZED_EMAILS": "tu@email.com,otro@email.com",
    "API_TOKEN": "un_token_seguro_y_largo_aca"
  });
  console.log("✅ Secretos configurados.");
}

// ── Entry point ───────────────────────────────────────────────────────────────

function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput | GoogleAppsScript.Content.TextOutput {
  try {
    const action = e.parameter["action"];
    if (action) return handleApiRequest(e);

    // Si viene de Mercado Libre con un código de autorización
    if (e.parameter["code"]) {
      return handleMLCallback(e.parameter["code"]);
    }

    const config = getSettings();
    const page = e.parameter["p"] || "index";
    const userEmail = Session.getActiveUser().getEmail();
    const isAuthorized = config.AUTHORIZED_EMAILS.indexOf(userEmail) !== -1 || userEmail === "";

    if (!isAuthorized) return HtmlService.createHtmlOutput("<h2>Access Denied</h2>");

    const template = HtmlService.createTemplateFromFile(page);
    return template
      .evaluate()
      .setTitle("Inventory System")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    if (e.parameter["action"]) return createJsonResponse({ error: "CRITICAL_GET_ERROR: " + String(err) });
    return HtmlService.createHtmlOutput("<h2>Error Crítico</h2><p>" + err + "</p>");
  }
}

/**
 * Handle external POST requests (for data mutation from Vercel/GitHub Pages)
 */
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  try {
    return handleApiRequest(e);
  } catch (err) {
    return createJsonResponse({ error: "CRITICAL_POST_ERROR: " + String(err) });
  }
}

/**
 * Dispatcher para llamadas externas vía fetch()
 */
function handleApiRequest(e: any): GoogleAppsScript.Content.TextOutput {
  let config: any;
  try {
    config = getSettings();
  } catch (err) {
    return createJsonResponse({ error: "SETTINGS_ERROR: " + String(err) });
  }

  const params = e.parameter || {};
  let postData: any = {};
  if (e.postData && e.postData.contents) {
    try {
      postData = JSON.parse(e.postData.contents);
    } catch (f) { }
  }

  const action = (params["action"] || postData.action || "").trim();
  const token = (params["token"] || postData.token || "").trim();

  // Google Auth — no requiere API token, valida vía JWT de Google
  if (action === "googleAuth") {
    const credential = params["credential"] || postData.credential || "";
    return createJsonResponse(verifyGoogleAuth(credential));
  }

  // Notificaciones de Mercado Libre (no traen nuestro token pero traen 'resource')
  if (postData.resource && postData.topic) {
    try {
      const result = processMLNotification(postData);
      return createJsonResponse(result);
    } catch (err) {
      console.error("Error processing ML notification:", err);
      return createJsonResponse({ status: "received" });
    }
  }

  // Check Token (con trim para seguridad)
  if (!token || token !== config.API_TOKEN.trim()) {
    return createJsonResponse({ error: "Unauthorized: Invalid API Token." });
  }

  const payload = (e.postData && e.postData.contents) ? postData : params;

  try {
    let result: any;
    switch (action) {
      case "getData": result = getInventoryData(); break;
      case "processForm": result = processForm(payload); break;
      case "markSold": result = markSold(Number(payload.rowIndex), Number(payload.salePrice)); break;
      case "softDelete": result = softDelete(Number(payload.rowIndex)); break;
      case "updateProduct": result = updateProduct(payload); break;
      case "publishToML": result = publishToML(Number(payload.rowIndex)); break;
      default: result = { error: "Action '" + action + "' not found" };
    }
    return createJsonResponse(result);
  } catch (err) {
    return createJsonResponse({ error: "EXECUTION_ERROR: " + String(err) });
  }
}

function createJsonResponse(data: any): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Utility used in HTML templates: <?!= include('theme') ?>
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getScriptUrl(): string {
  return ScriptApp.getService().getUrl();
}

// ── Google Auth ──────────────────────────────────────────────────────────────

function verifyGoogleAuth(credential: string): any {
  try {
    if (!credential) {
      return { authorized: false, error: "No se recibió credencial de Google." };
    }

    const config = getSettings();

    const parts = credential.split(".");
    if (parts.length !== 3) {
      return { authorized: false, error: "Token inválido." };
    }

    const decoded = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[1])
    ).getDataAsString();
    const tokenPayload = JSON.parse(decoded);

    const email = (tokenPayload.email || "").toLowerCase().trim();

    if (!tokenPayload.email_verified) {
      return { authorized: false, error: "Email no verificado." };
    }

    const now = Math.floor(Date.now() / 1000);
    if (tokenPayload.exp && tokenPayload.exp < now) {
      return { authorized: false, error: "Token expirado." };
    }

    const authorized = config.AUTHORIZED_EMAILS.some(
      (e: string) => e.toLowerCase().trim() === email
    );

    if (!authorized) {
      return { authorized: false, error: "Tu email (" + email + ") no tiene permisos para acceder." };
    }

    return { authorized: true, email: email, token: config.API_TOKEN };
  } catch (err) {
    return { authorized: false, error: "Error verificando credenciales: " + String(err) };
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

function getInventoryData(): InventoryData | string {
  try {
    const config = getSettings();
    const id = (config.SPREADSHEET_ID || "").trim();

    if (!id || id.includes("PONER_ACA")) {
      return "Error: SPREADSHEET_ID no configurado. Ejecutá setupSecrets.";
    }

    const ss = SpreadsheetApp.openById(id);
    const sheet = ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();

    if (values.length <= 1) return [];

    // Normalize every cell to string to avoid Date/Number serialization issues
    const cleanData: InventoryData = values.slice(1).map((row) =>
      row.map((cell) => String(cell))
    );

    return cleanData;
  } catch (err) {
    return `Error: ${String(err)}`;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

function processForm(formObject: FormPayload): string {
  try {
    const config = getSettings();
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];

    const folder = DriveApp.getFolderById(config.DRIVE_FOLDER_ID);

    let fileUrl = "";

    if (formObject.imageBlob && formObject.imageBlob.includes(",")) {
      const [meta, b64] = formObject.imageBlob.split(",");
      const contentType = meta.split(":")[1].split(";")[0];
      const bytes = Utilities.base64Decode(b64);
      const blob = Utilities.newBlob(
        bytes,
        contentType,
        `${formObject.productName}.jpg`
      );
      const file = folder.createFile(blob);

      // Make publicly accessible so Web Share API / WhatsApp can fetch the image.
      // The folder is already "Anyone with link can view"; this is explicit insurance.
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );

      // Direct-view URL — works with fetch() and WhatsApp image preview
      fileUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
    }

    sheet.appendRow([
      new Date(),                          // COL.DATE
      formObject.productName,              // COL.NAME
      formObject.category,                 // COL.CATEGORY
      formObject.condition,                // COL.CONDITION
      formObject.costPrice ?? "",          // COL.COST  ← nuevo
      formObject.publicPrice,              // COL.LIST
      formObject.minPrice,                 // COL.FLOOR
      formObject.notes ?? "",              // COL.NOTES
      fileUrl,                             // COL.PHOTO
      "Pending",                           // COL.STATUS
      "",                                  // COL.SALE_PRICE (vacío hasta vender)
      "",                                  // COL.SALE_DATE  (vacío hasta vender)
    ]);

    return "✅ Producto guardado.";
  } catch (err) {
    return `❌ Error: ${String(err)}`;
  }
}

// ── Update operations ─────────────────────────────────────────────────────────

/**
 * Mark a row as sold. Called from the dashboard "Cerrar venta" modal.
 * rowIndex is 1-based (Sheet row number, including header row).
 */
function markSold(rowIndex: number, salePrice: number): string {
  try {
    const config = getSettings();
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];
    sheet.getRange(rowIndex, COL.STATUS + 1).setValue("Sold");
    sheet.getRange(rowIndex, COL.SALE_PRICE + 1).setValue(salePrice);
    sheet.getRange(rowIndex, COL.SALE_DATE + 1).setValue(
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")
    );
    return "✅ Venta registrada.";
  } catch (err) {
    return `❌ Error: ${String(err)}`;
  }
}

/**
 * Soft-delete: set status to "Deleted". Data is preserved in the Sheet.
 * rowIndex is 1-based.
 */
function softDelete(rowIndex: number): string {
  try {
    const config = getSettings();
    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];
    sheet.getRange(rowIndex, COL.STATUS + 1).setValue("Deleted");
    return "✅ Producto archivado.";
  } catch (err) {
    return `❌ Error: ${String(err)}`;
  }
}

/**
 * Update an existing product.
 */
function updateProduct(payload: FormPayload): string {
  try {
    const config = getSettings();
    if (!payload.rowIndex) throw new Error("Missing rowIndex for update.");

    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];
    const row = payload.rowIndex;

    sheet.getRange(row, COL.NAME + 1).setValue(payload.productName);
    sheet.getRange(row, COL.CATEGORY + 1).setValue(payload.category);
    sheet.getRange(row, COL.CONDITION + 1).setValue(payload.condition);
    sheet.getRange(row, COL.COST + 1).setValue(payload.costPrice ?? "");
    sheet.getRange(row, COL.LIST + 1).setValue(payload.publicPrice);
    sheet.getRange(row, COL.FLOOR + 1).setValue(payload.minPrice);
    sheet.getRange(row, COL.NOTES + 1).setValue(payload.notes ?? "");

    // Handling image update...
    if (payload.imageBlob && payload.imageBlob.includes(",")) {
      const folder = DriveApp.getFolderById(config.DRIVE_FOLDER_ID);
      const [meta, b64] = payload.imageBlob.split(",");
      const contentType = meta.split(":")[1].split(";")[0];
      const bytes = Utilities.base64Decode(b64);
      const blob = Utilities.newBlob(bytes, contentType, `${payload.productName}.jpg`);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const fileUrl = `https://drive.google.com/uc?export=view&id=${file.getId()}`;
      sheet.getRange(row, COL.PHOTO + 1).setValue(fileUrl);
    }

    return "✅ Producto actualizado.";
  } catch (err) {
    return `❌ Error: ${String(err)}`;
  }
}

/**
 * Busca una fila por ML_ID. Retorna rowIndex (1-based) y status, o null si no existe.
 */
function findRowByMLId(mlId: string): { rowIndex: number; status: string } | null {
  const config = getSettings();
  const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.ML_ID]).trim() === mlId.trim()) {
      return { rowIndex: i + 1, status: String(data[i][COL.STATUS]) };
    }
  }
  return null;
}

/**
 * Procesa notificaciones de Mercado Libre (webhooks).
 * Para orders_v2: marca el producto como vendido automáticamente.
 */
function processMLNotification(postData: any): { status: string; message?: string } {
  const topic = postData.topic;
  const resource = postData.resource;

  console.log("Processing ML notification:", topic, resource);

  if (topic === "orders_v2") {
    const token = getMLAccessToken();
    if (!token) {
      console.error("No ML access token available for webhook processing");
      return { status: "error", message: "No ML token" };
    }

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch("https://api.mercadolibre.com" + resource, options);
    const order = JSON.parse(res.getContentText());

    if (order.error || !order.order_items) {
      console.error("Error fetching ML order:", res.getContentText());
      return { status: "error", message: "Could not fetch order" };
    }

    for (const orderItem of order.order_items) {
      const mlItemId = orderItem.item.id;
      const unitPrice = orderItem.unit_price;

      const found = findRowByMLId(mlItemId);
      if (!found) {
        console.log("ML_ID " + mlItemId + " not found in sheet, skipping");
        continue;
      }

      if (found.status === "Sold") {
        console.log("Row " + found.rowIndex + " already sold, skipping");
        continue;
      }

      markSold(found.rowIndex, unitPrice);
      console.log("Auto-marked row " + found.rowIndex + " as sold (ML order, price: " + unitPrice + ")");
    }

    return { status: "processed" };
  }

  return { status: "received", message: "topic " + topic + " logged" };
}

/**
 * Publicar un producto existente en Mercado Libre de forma real.
 */
function publishToML(rowIndex: number): any {
  try {
    const config = getSettings();
    const token = getMLAccessToken();
    if (!token) throw new Error("No estás autorizado. Debés conectar tu cuenta de ML primero.");

    const ss = SpreadsheetApp.openById(config.SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Inventario") ?? ss.getSheets()[0];

    // 1. Obtener datos de la fila
    const data = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    const productName = data[COL.NAME];
    const price = Number(data[COL.LIST]);
    const conditionScore = Number(data[COL.CONDITION]);
    const notes = String(data[COL.NOTES] || "");
    const photoUrl = String(data[COL.PHOTO] || "");

    // 2. Predecir Categoría (automatizado)
    const categoryId = predictMLCategory(productName);

    // 3. Subir foto directo a ML (más confiable que URLs de Drive)
    let pictures: any[] = [];
    if (photoUrl) {
      const pictureId = uploadPhotoToML(photoUrl, token);
      if (pictureId) {
        pictures = [{ id: pictureId }];
      } else {
        // Fallback a URL si el upload directo falla
        console.log("Upload directo falló, usando source URL como fallback");
        pictures = [{ source: photoUrl }];
      }
    }

    // 4. Obtener atributos requeridos de la categoría y auto-completar
    const attributes = getRequiredMLAttributes(categoryId, productName, token);

    // 5. Preparar Payload para ML
    const payload: any = {
      family_name: productName,
      category_id: categoryId,
      price: price,
      currency_id: "ARS",
      available_quantity: 1,
      buying_mode: "buy_it_now",
      listing_type_id: "bronze",
      condition: conditionScore >= 9 ? "new" : "used",
      description: {
        plain_text: `${notes}\n\nPublicado desde miMercadito Inventory.`
      },
      pictures: pictures,
      attributes: attributes,
      shipping: {
        mode: "me2",
        local_pick_up: true,
        free_shipping: false
      }
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    // 5. Llamada a ML
    const res = UrlFetchApp.fetch("https://api.mercadolibre.com/items", options);
    const resData = JSON.parse(res.getContentText());

    if (resData.error || resData.status === 400) {
      const fullResponse = res.getContentText();
      console.error("ML full response:", fullResponse);
      throw new Error(fullResponse.substring(0, 500));
    }

    // 6. Guardar ID y Link en el Sheet
    const mlId = resData.id;
    const mlLink = resData.permalink;

    sheet.getRange(rowIndex, COL.ML_ID + 1).setValue(mlId);
    sheet.getRange(rowIndex, COL.ML_LINK + 1).setValue(mlLink);

    return {
      success: true,
      id: mlId,
      link: mlLink,
      message: "🚀 ¡Publicado con éxito en Mercado Libre!"
    };

  } catch (err) {
    console.error("Error publishToML:", err);
    return { error: String(err) };
  }
}

/**
 * Consulta a ML cuál es la mejor categoría para un título dado.
 */
function predictMLCategory(title: string): string {
  try {
    const url = `https://api.mercadolibre.com/sites/MLA/category_predictor/predict?title=${encodeURIComponent(title)}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());

    // La respuesta puede ser { id: "MLAxxxx" } o { path_from_root: [...] }
    if (data.id) return data.id;
    // Si devuelve un array, tomar la primera predicción
    if (Array.isArray(data) && data.length > 0 && data[0].id) return data[0].id;

    return "MLA1055"; // Fallback: "Otros" (categoría hoja)
  } catch (e) {
    return "MLA1055";
  }
}

/**
 * Consulta los atributos requeridos de una categoría de ML y los auto-completa.
 */
function getRequiredMLAttributes(categoryId: string, productName: string, token: string): any[] {
  try {
    const url = `https://api.mercadolibre.com/categories/${categoryId}/attributes`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const allAttrs = JSON.parse(res.getContentText());

    if (!Array.isArray(allAttrs)) return [];

    const attributes: any[] = [];

    // IDs de atributos de variación que no queremos auto-completar con valores random
    const skipIds = new Set(["COLOR", "COLOR_SECONDARY_COLOR", "SIZE", "ALPHANUMERIC_SIZE"]);

    for (const attr of allAttrs) {
      const isRequired = attr.tags && (attr.tags.required || attr.tags.catalog_required);
      if (!isRequired) continue;

      // Skipear atributos de variación (color, talle) — ML no los exige si no hay variaciones
      if (skipIds.has(attr.id) || (attr.tags && attr.tags.allow_variations)) continue;

      const attrEntry: any = { id: attr.id };

      if (attr.values && attr.values.length > 0) {
        const generic = attr.values.find((v: any) =>
          /genér|generi|otro|other|no aplic|única|unico|universal/i.test(v.name)
        );
        attrEntry.value_id = generic ? generic.id : attr.values[0].id;
      } else if (attr.value_type === "string") {
        attrEntry.value_name = productName;
      } else if (attr.value_type === "number") {
        attrEntry.value_name = "1";
      } else if (attr.value_type === "boolean") {
        attrEntry.value_name = "No";
      }

      attributes.push(attrEntry);
    }

    return attributes;
  } catch (err) {
    console.error("Error fetching ML attributes:", err);
    return [];
  }
}

/**
 * Sube una foto desde Google Drive directo a ML (más confiable que pasar URL de Drive).
 * Retorna el picture ID de ML, o null si falla.
 */
function uploadPhotoToML(drivePhotoUrl: string, token: string): string | null {
  try {
    const match = drivePhotoUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!match) return null;

    const fileId = match[1];
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const contentType = blob.getContentType() || "image/jpeg";
    const imageBytes = blob.getBytes();

    // Construir multipart/form-data manualmente (GAS no tiene FormData)
    const boundary = "----MLUpload" + Utilities.getUuid().replace(/-/g, "");
    const header =
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="file"; filename="photo.jpg"\r\n' +
      "Content-Type: " + contentType + "\r\n\r\n";
    const footer = "\r\n--" + boundary + "--\r\n";

    const headerBytes = Utilities.newBlob(header).getBytes();
    const footerBytes = Utilities.newBlob(footer).getBytes();
    const payload = ([] as number[]).concat(headerBytes, imageBytes, footerBytes);

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      contentType: "multipart/form-data; boundary=" + boundary,
      headers: { Authorization: "Bearer " + token },
      payload: payload,
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch("https://api.mercadolibre.com/pictures/items/upload", options);
    const resData = JSON.parse(res.getContentText());

    if (resData.error || !resData.id) {
      console.error("ML photo upload failed:", res.getContentText());
      return null;
    }

    return resData.id;
  } catch (err) {
    console.error("Error uploading photo to ML:", err);
    return null;
  }
}

/** ── Mercado Libre Auth ─────────────────────────────────────────────────── */

function handleMLCallback(code: string): GoogleAppsScript.HTML.HtmlOutput {
  try {
    const props = PropertiesService.getScriptProperties();
    const config = getSettings();
    const ML_CLIENT_ID = props.getProperty("ML_CLIENT_ID") || GLOBAL_ENV.ML_CLIENT_ID;
    const ML_CLIENT_SECRET = props.getProperty("ML_CLIENT_SECRET") || GLOBAL_ENV.ML_CLIENT_SECRET;

    const payload = {
      grant_type: "authorization_code",
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code: code,
      redirect_uri: ScriptApp.getService().getUrl()
    };

    const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const res = UrlFetchApp.fetch("https://api.mercadolibre.com/oauth/token", options);
    const data = JSON.parse(res.getContentText());

    // Guardar tokens y timestamp
    props.setProperty("ML_ACCESS_TOKEN", data.access_token);
    props.setProperty("ML_REFRESH_TOKEN", data.refresh_token);
    props.setProperty("ML_TOKEN_EXPIRY", String(Date.now() + (data.expires_in * 1000)));

    return HtmlService.createHtmlOutput(`
      <div style="font-family:sans-serif;text-align:center;padding:40px;">
        <h2 style="color:#34c759;">¡Conexión Exitosa con Mercado Libre!</h2>
        <p>Ya podés cerrar esta pestaña y volver al Dashboard.</p>
        <button onclick="window.close()" style="padding:10px 20px;border-radius:8px;border:none;background:#007aff;color:white;cursor:pointer;">Cerrar</button>
      </div>
    `);
  } catch (err) {
    return HtmlService.createHtmlOutput("<h2>Error de Autenticación</h2><p>" + err + "</p>");
  }
}

function getMLAccessToken(): string {
  const props = PropertiesService.getScriptProperties();
  const expiry = Number(props.getProperty("ML_TOKEN_EXPIRY") || 0);

  // Si falta menos de 5 minutos, refrescamos
  if (Date.now() > (expiry - 300000)) {
    refreshMLToken();
  }

  return props.getProperty("ML_ACCESS_TOKEN") || "";
}

function refreshMLToken() {
  const props = PropertiesService.getScriptProperties();
  const config = getSettings();
  const ML_CLIENT_ID = props.getProperty("ML_CLIENT_ID") || GLOBAL_ENV.ML_CLIENT_ID;
  const ML_CLIENT_SECRET = props.getProperty("ML_CLIENT_SECRET") || GLOBAL_ENV.ML_CLIENT_SECRET;
  const refreshToken = props.getProperty("ML_REFRESH_TOKEN");

  if (!refreshToken) throw new Error("No hay Refresh Token. Debés autorizar la App nuevamente.");

  const payload = {
    grant_type: "refresh_token",
    client_id: ML_CLIENT_ID,
    client_secret: ML_CLIENT_SECRET,
    refresh_token: refreshToken
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch("https://api.mercadolibre.com/oauth/token", options);
  const data = JSON.parse(res.getContentText());

  props.setProperty("ML_ACCESS_TOKEN", data.access_token);
  props.setProperty("ML_REFRESH_TOKEN", data.refresh_token);
  props.setProperty("ML_TOKEN_EXPIRY", String(Date.now() + (data.expires_in * 1000)));
}
