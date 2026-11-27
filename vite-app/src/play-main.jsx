import React from 'react';
import ReactDOM from 'react-dom/client';
import PlayApp from './components/PlayApp.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import TabErrorBoundary from './components/TabErrorBoundary.jsx';
import './styles.css';
import { installNumericFocusClear } from './utils/numeric-focus-clear.js';
import { installGridSnap } from './utils/grid-snap.js';
import { applyStoredCardBack } from './utils/card-back.js';
import { rememberTableInvite, rememberTableOpen } from './utils/play-tables.js';

// play.futurega.me's own entry (scripts/make-play-html.mjs; components/PlayApp.jsx): the play-money tables alone,
// never the app. The app's own entry (main.jsx) imports none of this, so the app and the iOS app built from it
// are untouched by the tables.
installNumericFocusClear();
installGridSnap();
applyStoredCardBack();
// An invite (play.futurega.me/join/<token>): kept across the sign-in, taken by the lobby.
rememberTableInvite(window.location.pathname);
// A table a "your turn" notification opened (play.futurega.me/table/<id>): the same, and the address goes back to /.
if (rememberTableOpen(window.location.pathname)) { try { window.history.replaceState(null, '', '/'); } catch { /* old browser */ } }
// The play origin's own worker (public/play-sw.js, served on the play host only) shows the "your turn" pushes and opens
// the table when one is tapped. It is registered when a player turns Turn alerts on (utils/play-push.js), never for a
// page that has not asked: the browser keeps it, and checks it for updates as the page loads.

window.addEventListener('vite:preloadError', (e) => {
  if (!navigator.onLine) { if (e && e.preventDefault) e.preventDefault(); return; }
  if (!sessionStorage.getItem('viteChunkReloadAttempted')) {
    sessionStorage.setItem('viteChunkReloadAttempted', '1');
    window.location.reload();
  }
});
setTimeout(() => { try { sessionStorage.removeItem('viteChunkReloadAttempted'); } catch (_) { /* private mode */ } }, 8000);

ReactDOM.createRoot(document.getElementById('root')).render(
  <TabErrorBoundary name="play">
    <ToastProvider>
      <PlayApp />
    </ToastProvider>
  </TabErrorBoundary>
);
