const fs = require('fs');
const path = require('path');
require('dotenv').config();

const filePath = path.join(__dirname, '../deploy/Code.gs');
let content = fs.readFileSync(filePath, 'utf8');

const mapping = {
  'REPLACE_WITH_SPREADSHEET_ID': process.env.SPREADSHEET_ID,
  'REPLACE_WITH_DRIVE_FOLDER_ID': process.env.DRIVE_FOLDER_ID,
  'REPLACE_WITH_API_TOKEN': process.env.API_TOKEN,
  'REPLACE_WITH_EMAILS': process.env.AUTHORIZED_EMAILS,
  'REPLACE_WITH_ML_CLIENT_ID': process.env.ML_CLIENT_ID,
  'REPLACE_WITH_ML_CLIENT_SECRET': process.env.ML_CLIENT_SECRET,
};

console.log('💉 Injecting secrets from .env into deploy/Code.gs...');

for (const [placeholder, value] of Object.entries(mapping)) {
  if (value) {
    // Escaping for JS string inclusion
    const escapedValue = value.replace(/'/g, "\\'");
    content = content.replace(new RegExp(placeholder, 'g'), escapedValue);
  } else {
    console.warn(`⚠️ Warning: ${placeholder} not found in .env`);
  }
}

fs.writeFileSync(filePath, content);
console.log('✅ Injection complete.');
