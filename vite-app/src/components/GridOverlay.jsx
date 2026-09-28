import React, { useLayoutEffect, useState } from 'react';

/**
 * Admin-only layout-grid overlay. Draws the app's real content grid faintly
 * over the screen so alignment can be checked against it and detailed layout
 * fixes made by eye.
 *
 * Matches the .content-area rails exactly: 12px side margins on phone
 * (16/20 vertical, 20 horizontal at >=640; 32 horizontal at >=1024), four
 * columns with 12px gutters, and an 8px vertical baseline with every fourth
 * line (32px) drawn stronger. pointer-events:none so it never blocks the UI.
 *
 * The baseline is anchored to the APP's real top — the rendered top of the
 * `.top-bar`, which is the origin every seated element is measured from (the
 * wordmark on 32, the date block on 160, all relative to it). `.app-shell` pads
 * the whole app down by the safe-area inset, so on a phone that origin sits
 * 47–59px below the screen. Earlier this was computed as
 * shell.top + parseFloat(paddingTop); on the device that computed value and the
 * actually-rendered content origin differed by a couple of device px (env()
 * resolves fractionally, parseFloat rounds), so the whole ruler read a hair low
 * and everything looked "slightly above the grid". Measuring the top-bar's own
 * getBoundingClientRect().top is the origin by construction — no computation to
 * drift. Falls back to the shell's content top if the bar isn't present.
 */
export default function GridOverlay() {
  const [top, setTop] = useState(0);
  const [dbg, setDbg] = useState('');
  useLayoutEffect(() => {
    // Live device readout: prints the actual numbers the pill/scroll math depends
    // on, measured on THIS device, so a screenshot shows the truth instead of a
    // Windows-WebKit guess. Reads r from a probe styled with the real --subrow.
    const readDbg = () => {
      try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;height:var(--subrow);width:0;visibility:hidden';
        document.body.appendChild(probe);
        const cssR = probe.getBoundingClientRect().height;
        document.body.removeChild(probe);
        const jsR = (window.innerWidth / 37) * 0.71;
        const bar = document.querySelector('.top-bar');
        const barTop = bar ? bar.getBoundingClientRect().top : 0;
        const ca = document.querySelector('.content-area');
        const caTop = ca ? ca.getBoundingClientRect().top : 0;
        const sf = document.querySelector('.tab-panel.tab-active .sticky-filters, .sticky-filters');
        const sfr = sf ? sf.getBoundingClientRect() : null;
        const db = [...document.querySelectorAll('.schedule-date-break')]
          .map(x => x.getBoundingClientRect())
          .filter(r => r.top > barTop - 5 && r.top < barTop + 400)
          .sort((a, b) => a.top - b.top)[0];
        const R = v => (v == null ? '—' : (v / cssR).toFixed(2));
        // Every .sticky-filters height (or 'none' if display:none) and the
        // date-break's actual pinned `top`, to prove where the pill is told to sit.
        const sfList = [...document.querySelectorAll('.sticky-filters')].map(x => {
          try { return getComputedStyle(x).display === 'none' ? 'none' : (x.getBoundingClientRect().height / cssR).toFixed(1); }
          catch (e) { return '?'; }
        }).join(',');
        const dbEl0 = document.querySelector('.schedule-date-break');
        const dbTopR = dbEl0 ? (parseFloat(getComputedStyle(dbEl0).top) / cssR).toFixed(2) : '—';
        // Dashboard card seating: each element's bottom-edge distance off the
        // nearest whole r (its baseline, since these are text-box-trimmed). ~0
        // means seated. Printed so a sim screenshot shows the truth with no JS
        // console — the whole point of measuring in the native app.
        const frac = (v) => { const n = v - Math.round(v); return (n >= 0 ? '+' : '') + n.toFixed(2); };
        // Dashboard sweep scanner: measure every text-bearing dashboard element's
        // bottom-edge drift off the nearest whole r and list only the ones that
        // are off (|frac| >= 0.07 — above the ~0.03 origin rounding every element
        // carries). One sim screenshot = the whole worklist; the list shrinks as
        // rows get seated. A short label + [i] when a selector has many.
        const dashSels = [
          '.dashboard-section-title', '.dashboard-section-badge',
          '.dash-event-name', '.dash-event-buyin', '.dash-event-meta', '.dash-event-tag',
          '.late-reg-label', '.late-reg-time',
          '.dash-stat-value', '.dash-stat-label',
          '.dash-upnext-counter', '.dash-upnext-pos', '.dash-upnext-step',
          '.dash-start-btn', '.dash-update-btn', '.dash-bag-btn', '.dash-bust-btn',
          '.dash-rebuy-btn', '.dash-no-rebuy', '.dash-playing-badge', '.dash-finished-badge',
          '.dash-restart-badge', '.dash-status-row',
          '.dash-friend-chip', '.friend-name', '.friend-event', '.friend-stack',
          '.dash-pl-value', '.dash-pl-label', '.dash-pl-roi',
          '.conn-name', '.dash-collapsed-countdown', '.mini-late-reg-label', '.mini-late-reg-time',
        ];
        // Only scan when the Dashboard tab is active. Several of these selectors
        // (late-reg-label/time, mini-late-reg-time) also exist on the Schedule,
        // where there are hundreds of them — scanning there floods the panel with
        // OFF(299) over the whole screen. Off the dashboard, show only the base
        // line below.
        const isDash = !!document.querySelector('.tab-panel.tab-active .dashboard-view');
        const offs = [];
        if (isDash) for (const s of dashSels) {
          const els = document.querySelectorAll(s);
          els.forEach((e, i) => {
            const r = e.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return; // hidden / absent
            const f = ((r.bottom - barTop) / cssR); const fr = f - Math.round(f);
            if (Math.abs(fr) >= 0.07) {
              offs.push(s.replace('.dashboard-', '.').replace('.dash-', '.') +
                (els.length > 1 ? '[' + i + ']' : '') + ':' + (fr >= 0 ? '+' : '') + fr.toFixed(2));
            }
          });
        }
        offs.sort((a, b) => Math.abs(parseFloat(b.split(':')[1])) - Math.abs(parseFloat(a.split(':')[1])));
        // Section block heights in r — a non-whole one is what pushes the section
        // below it off-grid. Flag any that aren't within 0.05 of a whole r.
        const secStr = [...document.querySelectorAll('.dashboard-section')].map((s) => {
          const r = s.getBoundingClientRect();
          const t = (r.top - barTop) / cssR; const h = r.height / cssR;
          const tf = t - Math.round(t);
          // topFrac@height — a non-whole top (prefixed !) means the gap/margin
          // above this section is off; a non-whole height means the section body.
          return (Math.abs(tf) >= 0.05 ? '!' : '') + (tf >= 0 ? '+' : '') + tf.toFixed(2) + '@' + h.toFixed(2);
        }).join(' ');
        // Measure the ACTIVE carousel card (the visible one), not card[0], and
        // rescan on swipe (the 500ms interval already re-runs this).
        const track = document.querySelector('.dash-carousel-track');
        const cardIdx = track ? (parseInt(track.dataset.idx, 10) || 0) : 0;
        const cards = document.querySelectorAll('.dash-event-card');
        const cardEl = cards[cardIdx] || cards[0];
        // Per-card state + height: list only the cards that differ from the plain
        // next-up/18r default (a 2-line title makes a taller card; playing/busted
        // /bagged/conditional/reg-closed change the body) so 2-line wraps and any
        // live states surface without dumping all 20.
        const cStr = [...cards].map((c, i) => {
          const st = c.className.replace('dash-event-card', '').trim().replace(/\s+/g, '.');
          const h = c.getBoundingClientRect().height / cssR;
          const interesting = (st && st !== 'next-up') || Math.abs(h - 18) >= 0.06;
          return interesting ? (i + ':' + (st || 'plain') + '/' + h.toFixed(2)) : null;
        }).filter(Boolean).join(' ');
        // Wrap OFF across lines (4 per line), capped so the panel can't grow into
        // a wall of text over the content — worst-first, with a "+N more" tail.
        const offShown = offs.slice(0, 12);
        const offLines = [];
        for (let i = 0; i < offShown.length; i += 4) offLines.push(offShown.slice(i, i + 4).join(' '));
        if (offs.length > 12) offLines.push('… +' + (offs.length - 12) + ' more');
        // Per-row heights inside the active card — every direct child of
        // .dash-card-content, class + height in r, "!" if not within 0.04 of a
        // whole r. The non-whole rows are exactly what leaves the card off-grid.
        const cc = cardEl && cardEl.querySelector('.dash-card-content');
        const rowStr = cc ? [...cc.children].map((ch) => {
          const h = ch.getBoundingClientRect().height / cssR;
          const cls = (typeof ch.className === 'string' && ch.className.split(' ')[0]) || ch.tagName.toLowerCase();
          return (Math.abs(h - Math.round(h)) >= 0.04 ? '!' : '') + cls.replace('dash-', '') + '/' + h.toFixed(2);
        }).join(' ') : 'no-cc';
        // Card chrome in r: the inter-row gap, the card's own top/bottom padding,
        // the venue strip height, the border — the non-row space that must also
        // sum to whole for the card to land on grid.
        const cs = cc ? getComputedStyle(cc) : null;
        const cardCs = cardEl ? getComputedStyle(cardEl) : null;
        const strip = cardEl && cardEl.querySelector('.dash-venue-strip');
        const chromeStr = (cs && cardCs)
          ? 'gap' + (parseFloat(cs.rowGap) / cssR).toFixed(2) +
            ' padT' + (parseFloat(cardCs.paddingTop) / cssR).toFixed(2) +
            ' padB' + (parseFloat(cardCs.paddingBottom) / cssR).toFixed(2) +
            ' strip' + (strip ? (strip.getBoundingClientRect().height / cssR).toFixed(2) : '-') +
            ' bord' + (parseFloat(cardCs.borderTopWidth) / cssR).toFixed(3)
          : '';
        const cardStr = !isDash ? '' : (cardEl
          ? 'card[' + cardIdx + '] ' + frac((cardEl.getBoundingClientRect().top - barTop) / cssR) + 't/' +
            ((cardEl.getBoundingClientRect().height) / cssR).toFixed(2) + 'h\n' : '') +
          (offs.length ? 'OFF(' + offs.length + '):\n' + offLines.join('\n') : 'ALL SEATED') +
          `\nS[${secStr}]` +
          (cStr ? `\nC[${cStr}]` : '') +
          `\nR[${rowStr}]` +
          (chromeStr ? `\n${chromeStr}` : '') +
          // Locate the persistent stat −0.47: the first stat-value's absolute
          // top/bottom frac AND its position INSIDE its own box. If inbox reads
          // 1.00-3.00 the cell is seated and the offset is the box's position
          // above it; if it reads e.g. 1.47-3.47 the cell itself is mis-seated.
          (() => {
            const sv = cardEl && cardEl.querySelector('.dash-stat-value');
            if (!sv) return '';
            const r = sv.getBoundingClientRect();
            const bt = (r.top - barTop) / cssR, bb = (r.bottom - barTop) / cssR;
            const box = sv.closest('.dash-stat-box');
            const boxr = box && box.getBoundingClientRect();
            const es = cardEl.querySelector('.dash-event-stats');
            const esr = es && es.getBoundingClientRect();
            return '\nSV abs ' + frac(bt) + '/' + frac(bb) +
              (boxr ? ' inbox ' + ((r.top - boxr.top) / cssR).toFixed(2) + '-' + ((r.bottom - boxr.top) / cssR).toFixed(2) : '') +
              (esr ? ' esTop ' + frac((esr.top - barTop) / cssR) : '');
          })();
        setDbg(
          `iw=${window.innerWidth} cssR=${cssR.toFixed(3)} jsR=${jsR.toFixed(3)}` +
          ` | bar=${barTop.toFixed(1)} ca=${caTop.toFixed(1)} scroll=${ca ? ca.scrollTop.toFixed(0) : '—'}` +
          ` | sf ${sfr ? R(sfr.top - barTop) + '→' + R(sfr.bottom - barTop) + 'r' : '—'}` +
          ` | db ${db ? R(db.top - barTop) + '→' + R(db.bottom - barTop) + 'r' : '—'}` +
          ` | sfs=[${sfList}] top=${dbTopR}r` +
          (cardStr ? `\n${cardStr}` : '')
        );
      } catch (e) { setDbg('dbg err: ' + e.message); }
    };
    const measure = () => {
      const bar = document.querySelector('.top-bar');
      if (bar) { setTop(bar.getBoundingClientRect().top); } else {
        const shell = document.querySelector('.app-shell');
        const pad = shell ? parseFloat(getComputedStyle(shell).paddingTop) || 0 : 0;
        setTop(shell ? shell.getBoundingClientRect().top + pad : 0);
      }
      readDbg();
    };
    // Measure now, then again after layout settles. A WKWebView applies the
    // safe-area inset AFTER first layout, so a single mount-time measurement
    // catches the top-bar before it has been pushed down and the whole ruler
    // ends up offset — which reads as "everything is off the grid". Re-measure
    // across a few frames/timeouts and whenever the bar actually moves.
    measure();
    const rafs = [requestAnimationFrame(() => { measure(); requestAnimationFrame(measure); })];
    const timers = [setTimeout(measure, 150), setTimeout(measure, 500), setTimeout(measure, 1200)];
    const bar = document.querySelector('.top-bar');
    let ro;
    if (bar && 'ResizeObserver' in window) { ro = new ResizeObserver(measure); ro.observe(bar); }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    // Update the readout live during scroll so a mid-scroll screenshot captures
    // the peek/pin state.
    const ca = document.querySelector('.content-area');
    if (ca) ca.addEventListener('scroll', readDbg, { passive: true });
    const dbgTimer = setInterval(readDbg, 500);
    return () => {
      rafs.forEach(cancelAnimationFrame);
      timers.forEach(clearTimeout);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      if (ca) ca.removeEventListener('scroll', readDbg);
      clearInterval(dbgTimer);
    };
  }, []);
  return (
    <div aria-hidden="true" className="grid-dev-overlay">
      <div style={{ position: 'fixed', left: 0, right: 'calc(var(--subrow) * 7.5)', bottom: 'calc(var(--nav-h) + var(--subrow))', maxHeight: '42vh', overflow: 'hidden', zIndex: 99999, font: '10px/1.3 ui-monospace,Menlo,monospace', color: '#0ff', background: 'rgba(0,0,0,0.88)', padding: '4px 6px', pointerEvents: 'none', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{dbg}</div>
      <div className="grid-dev-baseline" style={{ top }} />
      <div className="grid-dev-cols">
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
        <span className="grid-dev-col" />
      </div>
    </div>
  );
}
