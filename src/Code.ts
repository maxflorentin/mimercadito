// ============================================================
//  ventas2026 — Google Apps Script backend (Secure API)
// ============================================================

function getSettings() {
  const p = PropertiesService.getScriptProperties().getProperties();
  return {
    SPREADSHEET_ID: p["SPREADSHEET_ID"] || "",
    DRIVE_FOLDER_ID: p["DRIVE_FOLDER_ID"] || "",
    AUTHORIZED_EMAILS: (p["AUTHORIZED_EMAILS"] || "").split(","),
    API_TOKEN: p["API_TOKEN"] || "default_dev_token"
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

  // Check Token (with trim for safety)
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
