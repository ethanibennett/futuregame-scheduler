import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { writeLiveHtml } from './scripts/make-live-html.mjs';
import { writeLiveCss } from './scripts/make-live-css.mjs';

// futurega.me/live's page, generated from index.html whenever Vite starts (scripts/make-live-html.mjs).
writeLiveHtml();
// ...and its stylesheet, the part of styles.css the page uses (scripts/make-live-css.mjs).
writeLiveCss();

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Ensure only one copy of React is ever loaded (guards against
    // monorepo hoisting quirks or dynamic-import re-optimisation races).
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Declare all deps upfront so Vite never needs a mid-session
    // re-optimisation run (which would create a second browser hash
    // and load a second React instance, breaking all hooks).
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'react/jsx-runtime',
      'gifenc',        // dynamic import in replay-gif-export.js
      'modern-screenshot', // dynamic import in the replay exports
      'jspdf',         // dynamic import in export.js
      'jspdf-autotable', // dynamic import in export.js
      'leaflet',       // the venue map's OpenStreetMap provider (utils/venue-map/provider-osm.js)
    ],
    // Disable runtime discovery so no new dep can trigger a second
    // optimisation pass after the server has started serving modules.
    noDiscovery: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: '../public-vite',
    emptyOutDir: true,
    // Two pages: the app, and futurega.me/live, the ads' landing page, with its own small entry
    // (src/live-main.jsx; live.html is generated from index.html by scripts/make-live-html.mjs).
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), live: resolve(__dirname, 'live.html') },
    },
  },
});
