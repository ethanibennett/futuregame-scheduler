import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import TabErrorBoundary from './components/TabErrorBoundary.jsx';
import './styles.css';
// The experimental Swiss theme: every rule in it is scoped to data-theme swiss-light / swiss-dark.
import './theme-swiss.css';
import { installNumericFocusClear } from './utils/numeric-focus-clear.js';
import { installGridSnap } from './utils/grid-snap.js';
import { installSwissTypography } from './utils/swiss-typography.js';
import { applyStoredCardBack } from './utils/card-back.js';
import { startNativeInsets } from './utils/native-insets.js';

// In the iPhone app, the safe area as the window gives it, over env()'s (utils/native-insets.js).
startNativeInsets();

// Every numeric field clears on focus, ready for a new number (utils/numeric-focus-clear.js).
installNumericFocusClear();
// Content-sized pills (class snap-g) round their width up to a whole g (utils/grid-snap.js).
installGridSnap();
installSwissTypography();
// The card back the viewer chose in the replayer's settings, on every face-down card (utils/card-back.js).
applyStoredCardBack();

// After a deploy, vite chunks get new hashes — pages loaded against the old
// HTML will fail to fetch the renamed chunks. Catch the preload error and do
// a one-shot reload so users don't see a dead button.
window.addEventListener('vite:preloadError', (e) => {
  // Offline, a reload cannot help: the tab's own boundary says what happened instead (App improvements 452).
  if (!navigator.onLine) { if (e && e.preventDefault) e.preventDefault(); return; }
  if (!sessionStorage.getItem('viteChunkReloadAttempted')) {
    sessionStorage.setItem('viteChunkReloadAttempted', '1');
    window.location.reload();
  }
});
// Once the app has rendered, the next deploy gets its own one reload (452: the flag was never cleared, so a second
// failed chunk blanked the app).
setTimeout(() => { try { sessionStorage.removeItem('viteChunkReloadAttempted'); } catch (_) { /* private mode */ } }, 8000);

ReactDOM.createRoot(document.getElementById('root')).render(
  <TabErrorBoundary name="app">
    <ToastProvider>
      <App />
    </ToastProvider>
  </TabErrorBoundary>
);
