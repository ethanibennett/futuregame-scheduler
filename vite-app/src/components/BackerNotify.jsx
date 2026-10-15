import React, { useCallback, useEffect, useId, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getToday } from '../utils/utils.js';
import { useToast } from '../contexts/ToastContext.jsx';
import {
  normalise, rowView, blockTitle, emptyText, footNote, sentToast,
} from '../utils/backer-notify.js';
import './backer-notify.css';

/**
 * The Backers block on a result — BETA, app admins, the OWNER's only (docs/bankroll-merge.md,
 * "Notify tap (built ahead of Phase 7)"). The dashboard app's Sessions-sheet Notify
 * (WC:app/src/screens/BackersUI.tsx BackerNotify), on futurega.me: in a tournament result's edit
 * form (TrackingView) and on a cash session's page and edit screen (CashSessions).
 *
 * Every backer staked in the SAVED result, with their pct, their share and whether it has been
 * sent; a Notify button that sends the shares not yet sent (a manual tap, owner Q1: nothing posts
 * on save). Two states: previewed ("Not sent") and sent ("Sent Oct 14", "· Updated" once a later
 * edit has moved the share, which tells the backer nothing, owner Q2). Where a new share may double
 * one the backer already has (the dashboard sent them a share on the same date, or a series
 * agreement covers the event, owner Q7), each such row says so and Notify opens a second confirm:
 * "Send anyway" (its own button) sends them all, "Send the others" sends only the backers not
 * flagged (Q7's "series wins": the flagged stay Not sent and are asked about again), Cancel sends
 * nothing. No stake matched: "No backers staked in <game>".
 *
 * Data: POST /api/staking/standing/notify (lib/staking/notify.js). The server computes every figure
 * from the saved result; this sends only { refTable, refId }. Anything but a 200 (another admin
 * gets 403, a live session 409) draws nothing at all, as does an account with no backers.
 *
 * Layout (backer-notify.css): a hairline, the title 5r, a row per backer of 8r (+3r a warning),
 * the confirm's sentence at 3r a line, the buttons 5r, the note at 3r a line. Every box whole g x whole r;
 * baselines on r lines; the buttons' labels centred.
 */
export default function BackerNotify({ token, refTable, refId }) {
  const toast = useToast();
  const titleId = 'bn-' + useId().replace(/[^\w-]/g, '');
  const [block, setBlock] = useState(null);
  // Per backer (owner, 2026-10-14): each unsent backer has its own Notify. A flagged one (a dashboard
  // share that night, or a series agreement) asks on its own row first: confirmKey is that row.
  const [confirmKey, setConfirmKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const thisYear = Number(getToday().slice(0, 4));

  const call = useCallback(async (body) => {
    const res = await fetch(`${API_URL}/staking/standing/notify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refTable, refId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }, [token, refTable, refId]);

  useEffect(() => {
    let live = true;
    setBlock(null);
    setConfirmKey(null);
    call({ preview: true })
      .then(({ status, data }) => { if (live) setBlock(status === 200 ? normalise(data) : null); })
      .catch(() => { if (live) setBlock(null); });
    return () => { live = false; };
  }, [call]);

  // Sends ONE backer's share: every other unsent backer goes in skip, so the server's own rules
  // (idempotency, the flags, delivery) are unchanged. confirm sends it despite its flag.
  const sendOne = async (key, confirm = false) => {
    if (busy || !block) return;
    const skip = block.backers.filter((x) => x.status !== 'sent' && x.key !== key).map((x) => x.key);
    setBusy(true);
    try {
      const { status, data } = await call({ preview: false, skip, ...(confirm ? { confirm: true } : {}) });
      if (status === 409 && data && data.needsConfirm) {
        setBlock(normalise(data));
        setConfirmKey(key);
        return;
      }
      if (status !== 200) { toast.error((data && data.error) || 'Notify failed. Try again.'); return; }
      setBlock(normalise(data));
      setConfirmKey(null);
      toast.success(sentToast(data));
    } catch (_) {
      toast.error('Notify failed. Check the connection and try again.');
    } finally { setBusy(false); }
  };

  if (!block) return null;
  if (!block.rosterSize && !block.backers.length) return null; // no backers at all, as on the dashboard
  const note = footNote(block);
  return (
    <section className="bn" aria-labelledby={titleId}>
      <h3 className="bn-t bn-title" id={titleId}>{blockTitle(block)}</h3>
      {block.backers.length === 0 ? (
        <p className="bn-t bn-empty">{emptyText(block)}</p>
      ) : (
        <>
          <ul className="bn-list">
            {block.backers.map((b) => {
              const r = rowView(b, { thisYear });
              return (
                <li key={r.key} className={'bn-row' + (r.warnings.length ? ' has-warn' : '')}>
                  <span className="bn-t bn-name" title={r.name}>{r.name}</span>
                  <span className={'bn-t bn-share' + (r.shareTone ? ' ' + r.shareTone : '')}>{r.share}</span>
                  <span className="bn-t bn-detail" title={r.detail}>{r.detail}</span>
                  {r.warnings.map((w) => <span key={w} className="bn-t bn-warn" title={w}>{w}</span>)}
                  {b.status !== 'sent' && (confirmKey === r.key ? (
                    <div className="bn-row-act" role="group" aria-label={`Confirm before sending to ${r.name}`}>
                      <button type="button" className="bn-btn bn-btn--warn" style={{ '--w': 11 }} disabled={busy} onClick={() => sendOne(r.key, true)}>
                        <span>{busy ? 'Sending…' : 'Send anyway'}</span>
                      </button>
                      <button type="button" className="bn-btn" style={{ '--w': 8 }} disabled={busy} onClick={() => setConfirmKey(null)}>
                        <span>Cancel</span>
                      </button>
                    </div>
                  ) : (
                    <div className="bn-row-act">
                      <button type="button" className="bn-btn bn-btn--brand" style={{ '--w': 9 }} disabled={busy}
                        aria-label={`Notify ${r.name}`}
                        onClick={() => (r.warnings.length ? setConfirmKey(r.key) : sendOne(r.key))}>
                        <span>{busy ? 'Sending…' : 'Notify'}</span>
                      </button>
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
          {note && <p className="bn-text bn-note">{note}</p>}
        </>
      )}
    </section>
  );
}
