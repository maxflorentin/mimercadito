import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/mimercadito/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'miMercadito',
        short_name: 'miMercadito',
        description: 'Inventario y ventas personal',
        start_url: '/mimercadito/',
        display: 'standalone',
        background_color: '#f2f2f7',
        theme_color: '#007aff',
        icons: [
          { src: '/mimercadito/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
