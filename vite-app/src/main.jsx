import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import './styles.css';
import { installNumericFocusClear } from './utils/numeric-focus-clear.js';

// Every numeric field clears on focus, ready for a new number (utils/numeric-focus-clear.js).
installNumericFocusClear();

// After a deploy, vite chunks get new hashes — pages loaded against the old
// HTML will fail to fetch the renamed chunks. Catch the preload error and do
// a one-shot reload so users don't see a dead button.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('viteChunkReloadAttempted')) {
    sessionStorage.setItem('viteChunkReloadAttempted', '1');
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
