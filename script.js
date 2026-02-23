function doGet(e) {
  var page = e.parameter.p || 'Formulario'; 
  var emailUsuario = Session.getActiveUser().getEmail();
  var correosAutorizados = ["macsee13@gmail.com", "romi.fndz87@gmail.com"];

  if (correosAutorizados.indexOf(emailUsuario) !== -1 || emailUsuario === "") {
    var template = HtmlService.createTemplateFromFile(page);
    return template.evaluate()
        .setTitle("Inventory System")
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else {
    return HtmlService.createHtmlOutput("Access Denied");
  }
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

const SPREADSHEET_ID = "18ZgIHi9fzBsNUg2AoenNXT6a0mNbpczeYNgN9FJnuwM";

function getInventoryData() {
  try {
    var ss = SpreadsheetApp.openById("18ZgIHi9fzBsNUg2AoenNXT6a0mNbpczeYNgN9FJnuwM");
    var sheet = ss.getSheets()[0]; 
    var values = sheet.getDataRange().getValues();
    
    if (values.length <= 1) return [];

    // Convertimos todo a String antes de enviar para evitar errores de fechas o formatos extraños
    var cleanData = values.slice(1).map(row => {
      return row.map(cell => cell.toString());
    });

    return cleanData;
  } catch (e) {
    return "Error: " + e.toString();
  }
}

function processForm(formObject) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName("Inventario") || ss.getSheets()[0];
    
    // Carpeta de Drive para fotos
    var folder = DriveApp.getFolderById("1dNO0SUZE2iy5jhJpOBjiAjH9UohTfliI");
    
    var fileUrl = "No photo";
    if (formObject.imageBlob && formObject.imageBlob.includes(",")) {
      var splitBlob = formObject.imageBlob.split(',');
      var contentType = splitBlob[0].split(':')[1].split(';')[0];
      var bytes = Utilities.base64Decode(splitBlob[1]);
      var blob = Utilities.newBlob(bytes, contentType, formObject.productName + ".jpg");
      fileUrl = folder.createFile(blob).getUrl();
    }
    
    sheet.appendRow([
      new Date(), 
      formObject.productName, 
      formObject.category,
      formObject.condition, 
      formObject.accessories, 
      formObject.publicPrice,
      formObject.minPrice, 
      formObject.notes, 
      fileUrl, 
      "Pending"
    ]);
    return "✅ Success! Item added to spreadsheet.";
  } catch (e) {
    return "❌ Error: " + e.toString();
  }
}