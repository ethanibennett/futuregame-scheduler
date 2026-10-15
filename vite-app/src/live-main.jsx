import React from 'react';
import ReactDOM from 'react-dom/client';
import LivePage from './components/LivePage.jsx';
import './styles.css';
import { captureLanding } from './utils/live-page.js';

// futurega.me/live's own entry (scripts/make-live-html.mjs): the landing page alone, without the app's
// code, so an ad click loads a fraction of what the app does. App.jsx's Root still renders LivePage for
// /live as a fallback (the dev server, or a build without live.html).
captureLanding(window.location.search, document.referrer, '/live');

ReactDOM.createRoot(document.getElementById('root')).render(<LivePage />);
