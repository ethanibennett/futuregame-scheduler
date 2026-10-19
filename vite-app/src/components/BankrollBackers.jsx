import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getToday } from '../utils/utils.js';
import {
  normalise, displayName, stakesLine, statItems, bbItems, deliveryText, shareRow, moreLine, listSummary, toneClass,
  fmtSignedCents, plural,
} from '../utils/bankroll-backers.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { settleView } from '../utils/backer-settle.js';
import './analytics.css';
import './bankroll-locations.css';
import './bankroll-backers.css';

/**
 * The bankroll dashboard's Backers tab — BETA, app admins; READ-ONLY.
 *
 * The owner's backers, which until the bankroll merge's Phase 8 are managed on the dashboard app
 * and showed nowhere in this one. One card per backer, in the Locations card's anatomy
 * (bankroll-locations.css): the name, the stakes in force under it, the running total at the right
 * (green up, red down), then one line of sessions, hours and the opening balance, and under it the
 * player's bb/hr (BB/hr for limit games) over those sessions when they name a big blind. Under the card,
 * Copy link and Open page (the backer's /b/ page), and whether texts and the weekly email are set
 * up. Tap the card for the last ten shares, newest first.
 *
 * Data: GET /api/staking/standing/backers (the owner's alone, lib/backer-surface.js backersView).
 * Every figure is built through the backer's own feed, so a card reads exactly what that backer's
 * page shows; nothing is added up or rounded here (utils/bankroll-backers.js only words it). The
 * server never sends a phone number or an address, only whether each is on file.
 *
 * No edits and no Notify here: a result's shares are sent from that result (components/BackerNotify.jsx,
 * the Notify tap); adding and editing backers stays on the dashboard app until the merge moves it here.
 *
 * Layout (35g content; bankroll-backers.css lists every row): the card as Locations' (11r), an
 * actions row of 6r (a 1r gap, 4r buttons, a 1r gap), and an open card's share rows of 7r.
 */

/** Copy text to the clipboard: the async API where the page may use it, else a selected textarea. */
async function copyText(value) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch (_) { /* fall through to the textarea */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

function BackerCard({ b, open, onToggle, thisYear, onCopy, onSettle, settling }) {
  const id = 'bb-shares-' + b.id.replace(/[^\w-]+/g, '-');
  const name = displayName(b);
  const items = statItems(b);
  // The player's bb/hr (BB/hr for limit games) over this backer's sessions, as their page shows it.
  const bbs = bbItems(b);
  const delivery = deliveryText(b.delivery);
  const more = moreLine(b);
  const settle = settleView({ settlement: b.settlement, totalCents: b.cumulativeCents, side: 'owner', backer: b.name || 'your backer' });
  return (
    <li className={'bl-item bb-item' + (open ? ' is-open' : '')}>
      <button type="button" className={'bl-card' + (bbs.length ? ' has-bb' : '')} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <span className="bl-head">
          <span className={'an-cell bl-name an-clip' + (b.name ? '' : ' is-none')} title={name}>{name}</span>
          <span className="an-cell bl-meta an-clip" title={stakesLine(b)}>{stakesLine(b)}</span>
          <span className={'an-cell bl-total snap-g' + toneClass(b.cumulativeCents)} aria-label={`Running total ${fmtSignedCents(b.cumulativeCents)}`}>
            {fmtSignedCents(b.cumulativeCents)}
          </span>
        </span>
        <span className="an-cell bl-stats an-clip">
          {items.map((it, i) => (
            <React.Fragment key={it.key}>
              {i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}
              <span className="bl-stat">{it.text}</span>
            </React.Fragment>
          ))}
        </span>
        {bbs.length > 0 && (
          <span className="an-cell bl-stats bl-stats-bb an-clip">
            {bbs.map((it, i) => (
              <React.Fragment key={it.key}>
                {i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}
                <span className={'bl-stat' + it.tone} aria-label={it.label}>{it.text}</span>
              </React.Fragment>
            ))}
          </span>
        )}
      </button>
      <div className="bl-pager bb-actions">
        <button type="button" className="bk-btn bl-more" disabled={!b.link} onClick={() => onCopy(b)}
          aria-label={`Copy ${name}'s page link`}><span>Copy link</span></button>
        {b.link
          ? <a className="bk-btn bl-more bb-open" href={b.link} target="_blank" rel="noopener noreferrer"
            aria-label={`Open ${name}'s page`}><span>Open page</span></a>
          : <button type="button" className="bk-btn bl-more" disabled><span>Open page</span></button>}
        <span className="an-cell bl-count bb-delivery an-clip" title={delivery.long}>{delivery.short}</span>
      </div>
      {settle && (
        /* Settled (owner, 2026-10-19): the player's half of the handshake; the backer presses it on
           their page. Both pressed = the balance goes to $0 on both. */
        <div className="bl-pager bb-actions bb-settle">
          {settle.button && (
            <button type="button" className={'bk-btn bl-more bb-settle-btn' + (settle.button.primary ? ' is-primary' : '')}
              disabled={settling} onClick={() => onSettle(b, settle)}><span>{settle.button.label}</span></button>
          )}
          <span className="an-cell bl-count bb-settle-status an-clip" title={settle.status}>{settle.status}</span>
        </div>
      )}
      {open && (
        <div className="bl-detail bb-detail" id={id}>
          {b.shares.length === 0 ? (
            <p className="an-p bb-none">No shares recorded yet. A share appears here once a session is notified.</p>
          ) : (
            <ul className="bb-shares" aria-label={`${name}'s last ${plural(b.shares.length, 'share')}, newest first`}>
              {b.shares.map((s, i) => {
                const r = shareRow(s, thisYear);
                return (
                  <li key={i} className="bb-share">
                    <span className="an-cell bl-res-date an-clip bb-date">{r.date}</span>
                    <span className="an-cell an-td an-clip bb-game" title={r.game}>{r.game}</span>
                    <span className={'an-cell an-td an-num bl-res-amt an-clip bb-cut' + r.shareTone}>{r.share}</span>
                    <span className="an-cell an-note an-clip bb-hours">{r.hours}</span>
                    <span className="an-cell an-note an-clip bb-venue" title={r.venue}>{r.venue}</span>
                    <span className="an-cell an-note an-num an-clip bb-of">{r.of}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {more && <div className="an-cell bl-count bb-more" aria-live="polite">{more}</div>}
        </div>
      )}
    </li>
  );
}

export default function BankrollBackers({ bk }) {
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', backers: [], error: '' });
  const [open, setOpen] = useState(() => new Set());
  const [settling, setSettling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const thisYear = Number(getToday().slice(0, 4));

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await fetch(`${API_URL}/staking/standing/backers`, { headers: { Authorization: `Bearer ${bk.token}` } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
        if (live) setState({ status: 'ready', backers: normalise(data), error: '' });
      } catch (e) {
        if (live) setState({ status: 'error', backers: [], error: e.status === 403 ? 'forbidden' : 'failed' });
      }
    })();
    return () => { live = false; };
  }, [bk.token, reloadKey]);

  // A Settled press: sends the balance this card shows, then reloads the list (the figures come from
  // the server, so the card reads exactly what the backer's page does).
  const settle = useCallback(async (b, v) => {
    if (v.confirm && !window.confirm(v.confirm)) return;
    setSettling(true);
    try {
      const res = await fetch(`${API_URL}/staking/standing/backers/${encodeURIComponent(b.id)}/settle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: v.button.action, amountCents: b.cumulativeCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'That did not go through. Try again.');
      else if (data.completed) toast.success(`Settled with ${b.name || 'your backer'}. The balance is back to $0.`);
      setReloadKey((k) => k + 1);
    } catch { toast.error('That did not go through. Check your connection.'); }
    finally { setSettling(false); }
  }, [bk.token, toast]);

  const list = state.backers;
  const sum = useMemo(() => listSummary(list), [list]);
  const toggle = useCallback((id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const copy = useCallback(async (b) => {
    if (await copyText(b.link)) toast.success('Link copied');
    else toast.error('Could not copy the link');
  }, [toast]);

  return (
    <section className="bd-section bl-locations bb-backers" aria-labelledby="bb-title">
      <h3 className="an-cell an-sec" id="bb-title">Backers</h3>
      <p className="an-p bb-note">
        Read-only. Notify a result's backers from its edit form; add and edit backers on the dashboard app
        until the bankroll merge moves that here. Each card shows what that backer's page shows.
      </p>

      {state.status === 'error' && (
        <p className="an-p bl-gap">
          {state.error === 'forbidden'
            ? "Backers are shown to the account that owns them. This account can't see them."
            : 'The backers could not load. Close the dashboard and try again.'}
        </p>
      )}
      {state.status === 'loading' && list.length === 0 && <p className="an-p bl-gap">Loading…</p>}
      {state.status === 'ready' && list.length === 0 && (
        <p className="an-p bl-gap">
          <strong>No backers yet.</strong> Backers you add on the dashboard app appear here, with their running totals and last shares.
        </p>
      )}
      {list.length > 0 && (
        <>
          <p className="an-p bl-gap">
            <strong>{plural(sum.count, 'backer')}</strong>
            {' · '}{plural(sum.sessions, 'session')}
            {' · '}<span className={'bl-sum' + toneClass(sum.totalCents)}>{fmtSignedCents(sum.totalCents)}</span>
            {' running total'}
          </p>
          <ul className="bl-list">
            {list.map((b) => (
              <BackerCard key={b.id} b={b} open={open.has(b.id)} onToggle={() => toggle(b.id)}
                thisYear={thisYear} onCopy={copy} onSettle={settle} settling={settling} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
