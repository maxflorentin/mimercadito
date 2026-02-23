# miMercadito - Sistema de Inventario

Sistema de gestión de inventario con Google Sheets como backend y una interfaz moderna tipo Apple.

## Arquitectura

- **Backend**: Google Apps Script (GAS) actuando como API JSON.
- **Base de Datos**: Google Sheets.
- **Fotos**: Google Drive.
- **Frontend**: HTML/JS/CSS (preparado para hosting en Vercel o GitHub Pages).

## Seguridad

Los IDs del Spreadsheet y de Drive, así como el API Token, se gestionan mediante **Script Properties** en Google Apps Script para que no queden expuestos en el repositorio.

### Configuración de Secretos en GAS

1. Abre el editor de Apps Script.
2. Ejecuta la función `setupSecrets()` una sola vez después de completar los valores en el código (luego borra los valores del código o usa el archivo `.env` local como referencia).
3. Asegúrate de configurar el `API_TOKEN` para que coincida con el que usarás en el frontend.

## Desarrollo Local

1. Instala dependencias: `npm install`
2. Construye el proyecto: `npm run build`
3. Despliega a GAS: `npm run deploy` (requiere `clasp` logueado).

## Hosting en GitHub Pages (White Label)

Para eliminar el banner de Google y usar un dominio propio:
1. Sube este repositorio a un nuevo repo en **GitHub**.
2. En Settings de tu repo, ve a **Secrets and variables > Actions** y agrega:
   - `GAS_URL`: Tu URL de Web App de Google (terminada en `/exec`).
   - `API_TOKEN`: El token secreto que configuraste en GAS.
3. El despliegue es automático al hacer `push` a `main`. GitHub Actions creará la rama `gh-pages`.
4. En **Settings > Pages**, elige la rama `gh-pages` como origen.
