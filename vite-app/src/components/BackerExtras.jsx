import React, { useMemo } from 'react';
import { fmtSignedCents } from '../utils/backer-page.js';
import { formatBuyin } from '../utils/utils.js';
import { shareOrDownloadBlob } from '../utils/export.js';

/* The backer page's Features (2026-11-11): what is coming up in this backer's action (21), a statement to
   keep (22) and, while a run in their action is live, its chips (23). The first and last appear only
   where the player turned them on for this backer; the statement is built here from the feed the page
   already has, so the server is unchanged by it. */

const day = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function ComingUpCard({ up }) {
  if (!up || (!up.inAction.length && !up.outside)) return null;
  return (
    <section className="bx-card" aria-label="Coming up this week">
      <div className="bx-label">{`Coming up this week · ${up.inAction.length}`}</div>
      {up.inAction.map((e, i) => (
        <div key={i} className="bx-row">
          <span className="bx-main">
            <span className="bx-name">{e.name}</span>
            <span className="bx-meta">{[e.room, `${day(e.date)}${e.time ? ' ' + e.time : ''}`, formatBuyin(e.buyin, e.currency && e.currency !== 'USD' ? e.currency : '')].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="bx-yours">{`Yours · ${e.pct}%${e.format ? ' of ' + e.format : ''}`}</span>
        </div>
      ))}
      {up.outside > 0 && <div className="bx-foot">{`${up.outside} more event${up.outside === 1 ? '' : 's'} this week outside your action`}</div>}
    </section>
  );
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const dollars = (c) => (Math.round(Number(c) || 0) / 100).toFixed(2);

/** The rows of the statement: sessions and payments in date order, with the running total. */
export function statementRows(feed) {
  const events = Array.isArray(feed && feed.events) ? feed.events : [];
  const pays = Array.isArray(feed && feed.payments) ? feed.payments : [];
  const items = [
    ...events.map((e) => ({ date: String(e.date || '').slice(0, 10), kind: 'Session', what: [e.game, e.venue].filter(Boolean).join(' · '), pct: e.pct, resultCents: e.sessionResultCents, cents: Number(e.shareCents) || 0 })),
    // A payment's amount is from the player's side (+ = the player paid): on the backer's balance it is the other sign.
    ...pays.map((p) => ({ date: String(p.date || p.at || '').slice(0, 10), kind: p.kind === 'part' ? 'Partial payment' : p.kind === 'payout' ? 'Payout' : 'Settled', what: '', pct: null, resultCents: null, cents: -(Number(p.amountCents) || 0) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let run = Number(feed && feed.openingCents) || 0;
  return { opening: run, rows: items.map((it) => { run += it.cents; return { ...it, runCents: run }; }), closing: run };
}

export function StatementCard({ feed, name }) {
  const st = useMemo(() => statementRows(feed), [feed]);
  if (!feed || !st.rows.length) return null;
  const year = new Date().getFullYear();
  const shares = st.rows.filter((r) => r.kind === 'Session');
  const paid = st.rows.filter((r) => r.kind !== 'Session').reduce((a, r) => a + r.cents, 0);
  const csv = () => {
    const lines = [['Date', 'Kind', 'Session', 'Your %', 'Session result', 'Your share or payment', 'Running total'].join(',')];
    if (st.opening) lines.push(['', 'Opening balance', '', '', '', dollars(st.opening), dollars(st.opening)].map(csvCell).join(','));
    for (const r of st.rows) lines.push([r.date, r.kind, r.what, r.pct == null ? '' : r.pct, r.resultCents == null ? '' : dollars(r.resultCents), dollars(r.cents), dollars(r.runCents)].map(csvCell).join(','));
    lines.push('', csvCell(`The player's own record, not an audited statement. ${feed.events && feed.events.length >= 200 ? 'The newest 200 sessions; older ones are in the opening balance.' : ''}`));
    const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    shareOrDownloadBlob(blob, `statement-${year}.csv`, 'text/csv', { mode: 'download' });
  };
  const pdf = async () => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Statement · ${name || 'Backer'} · ${year}`, 14, 16);
    doc.setFontSize(9);
    doc.text('From the player’s own records in futurega.me; not an audited statement.', 14, 22);
    autoTable(doc, {
      startY: 27, styles: { fontSize: 8 }, headStyles: { fillColor: [40, 40, 40] },
      head: [['Date', 'Kind', 'Session', '%', 'Share / payment', 'Running total']],
      body: [
        ...(st.opening ? [['', 'Opening balance', '', '', fmtSignedCents(st.opening), fmtSignedCents(st.opening)]] : []),
        ...st.rows.map((r) => [r.date, r.kind, r.what, r.pct == null ? '' : `${r.pct}%`, fmtSignedCents(r.cents), fmtSignedCents(r.runCents)]),
      ],
    });
    const blob = doc.output('blob');
    shareOrDownloadBlob(blob, `statement-${year}.pdf`, 'application/pdf', { mode: 'download' });
  };
  return (
    <section className="bx-card" aria-label="Statement">
      <div className="bx-label">{`Statement · ${year} so far`}</div>
      {st.opening !== 0 && <div className="bx-line"><span>Opening balance</span><b>{fmtSignedCents(st.opening)}</b></div>}
      <div className="bx-line"><span>{`Shares · ${shares.length}`}</span><b>{fmtSignedCents(shares.reduce((a, r) => a + r.cents, 0))}</b></div>
      {paid !== 0 && <div className="bx-line"><span>Payments settled</span><b>{fmtSignedCents(paid)}</b></div>}
      <div className="bx-line is-total"><span>Running total</span><b>{fmtSignedCents(st.closing)}</b></div>
      <div className="bx-btns">
        <button type="button" className="btn btn-ghost ctl bx-btn" onClick={csv}><span>Download CSV</span></button>
        <button type="button" className="btn btn-ghost ctl bx-btn" onClick={pdf}><span>Printable PDF</span></button>
      </div>
      <div className="bx-foot">The full-year statement is ready on January 1.</div>
    </section>
  );
}

/** The run's chips (23): "36,200 · 90 BB", the level's blinds and entries, and the stack line. */
export function SweatBlock({ sweat }) {
  if (!sweat) return null;
  const pts = sweat.points || [];
  const W = 100, H = 24;
  const max = Math.max(sweat.startingStack || 0, ...pts.map((p) => p.stack)) || 1;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${(pts.length === 1 ? W : (i / (pts.length - 1)) * W).toFixed(2)} ${(H - (p.stack / max) * H).toFixed(2)}`).join(' ');
  const sY = sweat.startingStack ? (H - (sweat.startingStack / max) * H).toFixed(2) : null;
  const bbs = sweat.bb ? Math.round(sweat.stack / sweat.bb) : null;
  return (
    <div className="bx-sweat">
      <div className="bx-sweat-line">
        <b>{`${Number(sweat.stack).toLocaleString('en-US')}${bbs ? ` · ${bbs} BB` : ''}`}</b>
        <span>{[sweat.bb ? `${Number(sweat.sb || sweat.bb / 2).toLocaleString('en-US')}/${Number(sweat.bb).toLocaleString('en-US')}` : null, sweat.entries ? `${Number(sweat.entries).toLocaleString('en-US')} entries` : null].filter(Boolean).join(' · ')}</span>
      </div>
      {pts.length > 1 && (
        <svg className="bx-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {sY && <line x1="0" x2={W} y1={sY} y2={sY} className="bx-spark-start" />}
          <path d={path} className="bx-spark-line" />
        </svg>
      )}
      <div className="bx-foot">You see the chips because this event is in your action.</div>
    </div>
  );
}
