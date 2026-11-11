import React, { useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

/* Subscribe to My Schedule (Features 1, 2026-11-11): the top of the Export sheet. A private link the
   calendar apps poll; Apple opens it as webcal://, Google by its "add by URL" link, and Copy link covers
   Outlook and the rest. New link revokes the old one; Turn off ends it. */
export default function CalendarFeedCard({ token }) {
  const toast = useToast();
  const [feed, setFeed] = useState(null);
  const [busy, setBusy] = useState(false);
  const hdr = { Authorization: 'Bearer ' + token };
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/calendar-feed`, { headers: hdr }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setFeed(d)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  if (!token || !feed) return null;
  const make = async () => {
    setBusy(true);
    const r = await fetch(`${API_URL}/calendar-feed`, { method: 'POST', headers: hdr }).catch(() => null);
    if (r && r.ok) setFeed(await r.json());
    setBusy(false);
    return r && r.ok;
  };
  const off = async () => {
    setBusy(true);
    const r = await fetch(`${API_URL}/calendar-feed`, { method: 'DELETE', headers: hdr }).catch(() => null);
    if (r && r.ok) setFeed({ on: false });
    setBusy(false);
  };
  const openWith = async (kind) => {
    let f = feed;
    if (!f.on) {
      const r = await fetch(`${API_URL}/calendar-feed`, { method: 'POST', headers: hdr }).catch(() => null);
      if (!r || !r.ok) return;
      f = await r.json();
      setFeed(f);
    }
    if (kind === 'copy') {
      navigator.clipboard.writeText(f.url).then(() => toast && toast.success('Calendar link copied'), () => {});
      return;
    }
    window.open(kind === 'google' ? f.google : f.webcal, '_blank', 'noopener');
  };
  return (
    <div className="calfeed">
      <div className="calfeed-label">Calendar feed</div>
      <div className="calfeed-title">My Schedule in your calendar</div>
      <p className="calfeed-p">Your saved events, kept up to date as you edit them. Calendar apps check for changes on their own schedule, from minutes to a few hours.</p>
      <div className="calfeed-btns">
        <button type="button" className="btn btn-ghost ctl calfeed-btn" onClick={() => openWith('apple')} disabled={busy}><span>Apple</span></button>
        <button type="button" className="btn btn-ghost ctl calfeed-btn" onClick={() => openWith('google')} disabled={busy}><span>Google</span></button>
        <button type="button" className="btn btn-ghost ctl calfeed-btn" onClick={() => openWith('copy')} disabled={busy}><span>Copy link</span></button>
      </div>
      {feed.on && (
        <div className="calfeed-foot">
          <span className="calfeed-link">Private link: anyone with it sees your plan.</span>
          <button type="button" className="calfeed-text" onClick={make} disabled={busy}><span>New link</span></button>
          <button type="button" className="calfeed-text" onClick={off} disabled={busy}><span>Turn off</span></button>
        </div>
      )}
    </div>
  );
}
