'use strict';
/*
 * THE ORACLE. The backer feed and the weekly digest exactly as server.js had them at
 * origin/master 4a19a4b (before lib/backer-surface.js existed), copied verbatim and reshaped only
 * enough to take a database and RETURN what the route used to send. They exist so the tests can
 * say "the new code, on its default path, produces exactly what the old code produced" without
 * trusting the new code to describe itself. Do not tidy, share or "fix" anything in this file.
 *
 * Sources: server.js:576-632 (GET /api/backer/:token/feed), 10659-10686 (backerCumulativeCents,
 * backerRecordByToken), 11691-11703 (stakesSummaryServer), 11793-11837 (sendBackerWeeklyDigests),
 * 738-751 (the notify relay's wording).
 */

function backerCumulativeCents(db, token) {
  let c = 0;
  const s = db.prepare('SELECT COALESCE(SUM(share_cents),0) AS c FROM backer_events WHERE token = ?');
  s.bind([token]); if (s.step()) c = s.getAsObject().c; s.free();
  return c || 0;
}
function backerRecordByToken(db, token) {
  const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
  let found = null;
  while (s.step()) {
    try {
      const b = JSON.parse(s.getAsObject().data);
      if (b && b.token === token) { found = b; break; }
    } catch (_) { /* skip malformed */ }
  }
  s.free();
  return found;
}
const SRV_FMT_LABEL = {
  PLO: 'PLO', PLO8: 'PLO8', NLH: 'NLH', mixed: 'Mixed', stud8: 'Stud8',
  razz: 'Razz', '2-7': '2-7', BigO: 'Big O', other: 'Other', all: 'all games',
};
function stakesSummaryServer(stakes) {
  if (!Array.isArray(stakes) || !stakes.length) return '';
  return stakes
    .map((s) => {
      const f = SRV_FMT_LABEL[s.format] || s.format;
      const c = s.channel && s.channel !== 'any' ? ` (${s.channel})` : '';
      return `${s.pct}% ${f}${c}`;
    })
    .join(' · ');
}
function fmtSignedCents(cents) {
  const v = (Number(cents) || 0) / 100;
  const n = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (v < 0 ? '−' : '+') + '$' + n;
}
function fmtHours(h) {
  return (Math.round((Number(h) || 0) * 10) / 10) + 'h';
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What GET /api/backer/:token/feed sent (the object handed to res.json). */
function legacyFeed(db, token) {
  let name = null;
  const nstmt = db.prepare('SELECT name FROM backer_public WHERE token = ?');
  nstmt.bind([token]); if (nstmt.step()) name = nstmt.getAsObject().name; nstmt.free();
  let stakes = '';
  let openingCents = 0;
  const rec = backerRecordByToken(db, token);
  if (rec) {
    if (!name) name = rec.name || null;
    stakes = stakesSummaryServer(rec.stakes || []);
    openingCents = Math.round((Number(rec.opening) || 0) * 100);
  }
  const events = [];
  const estmt = db.prepare(
    'SELECT ts, date, game, venue, hours, session_result_cents, pct, share_cents FROM backer_events WHERE token = ? ORDER BY date DESC, ts DESC LIMIT 200'
  );
  estmt.bind([token]);
  while (estmt.step()) {
    const r = estmt.getAsObject();
    events.push({
      ts: r.ts, date: r.date, game: r.game, venue: r.venue, hours: r.hours,
      sessionResultCents: r.session_result_cents, pct: r.pct, shareCents: r.share_cents,
    });
  }
  estmt.free();
  let grossCents = 0, netSessionCents = 0;
  for (const e of events) {
    grossCents += e.sessionResultCents || 0;
    netSessionCents += e.shareCents || 0;
  }
  let sessions = 0, hours = 0;
  const tstmt = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(hours), 0) AS h FROM backer_events WHERE token = ?');
  tstmt.bind([token]); if (tstmt.step()) { const t = tstmt.getAsObject(); sessions = t.n || 0; hours = t.h || 0; } tstmt.free();
  return {
    name, stakes, openingCents, grossCents, netSessionCents,
    cumulativeCents: backerCumulativeCents(db, token) + openingCents,
    sessions, hours,
    events,
  };
}

/** What sendBackerWeeklyDigests handed to sendConsoleEmail: [{ to, subject, html }]. */
function legacyDigests(db, now = Date.now()) {
  const out = [];
  const backers = [];
  const s = db.prepare("SELECT data FROM console_records WHERE store = 'backers' AND deleted = 0");
  while (s.step()) {
    try {
      const b = JSON.parse(s.getAsObject().data);
      if (b && b.token && b.delivery && b.delivery.email) backers.push(b);
    } catch (_) { /* skip malformed */ }
  }
  s.free();
  if (!backers.length) return out;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  for (const b of backers) {
    const evs = [];
    const es = db.prepare(
      'SELECT date, game, venue, hours, session_result_cents, pct, share_cents FROM backer_events WHERE token = ? AND ts >= ? ORDER BY ts DESC'
    );
    es.bind([b.token, weekAgo]);
    while (es.step()) evs.push(es.getAsObject());
    es.free();
    if (!evs.length) continue; // nothing to report this week
    const cum = backerCumulativeCents(db, b.token) + Math.round((Number(b.opening) || 0) * 100);
    const weekShare = evs.reduce((a, e) => a + (e.share_cents || 0), 0);
    const rows = evs.map((e) => {
      const col = (e.share_cents || 0) >= 0 ? '#2c7a52' : '#c0544c';
      return `<tr>
          <td style="padding:6px 10px 6px 0;">${escapeHtml(e.game)}</td>
          <td style="padding:6px 10px 6px 0;color:#888;">${escapeHtml(e.venue)} · ${fmtHours(e.hours)} · ${escapeHtml(e.date)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:${col};">${fmtSignedCents(e.share_cents)}</td>
        </tr>`;
    }).join('');
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111;">
        <h2 style="margin:0 0 2px;">Your week with Ethan</h2>
        <p style="color:#888;margin:0 0 16px;">${evs.length} session${evs.length > 1 ? 's' : ''} · your week ${fmtSignedCents(weekShare)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
        <p style="margin:18px 0 4px;font-size:16px;"><strong>Running total: ${fmtSignedCents(cum)}</strong></p>
        <p style="color:#888;font-size:12px;">Full detail anytime: <a href="https://futurega.me/b/${b.token}">your private page</a>.</p>
      </div>`;
    out.push({ to: b.delivery.email, subject: 'Your weekly staking digest', html });
  }
  return out;
}

/** The notify relay's push and text wording (server.js:738-751), for the sweep's golden comparison. */
function legacyRelayMessages(session, pct, shareCents, cum, token) {
  return {
    title: `${session.game} — ${fmtSignedCents(shareCents)}`,
    body: `${session.venue} · ${fmtHours(session.hours)} · session ${fmtSignedCents(session.resultCents)}. ` +
      `Your ${pct}% = ${fmtSignedCents(shareCents)}. Running: ${fmtSignedCents(cum)}.`,
    sms: `${session.game} at ${session.venue}: session ${fmtSignedCents(session.resultCents)} over ${fmtHours(session.hours)}. ` +
      `Your ${pct}% = ${fmtSignedCents(shareCents)}. Running ${fmtSignedCents(cum)}. futurega.me/b/${token}`,
  };
}

module.exports = { legacyFeed, legacyDigests, legacyRelayMessages };
