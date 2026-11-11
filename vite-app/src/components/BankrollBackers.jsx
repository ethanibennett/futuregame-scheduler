import useOpenSpring from '../hooks/useOpenSpring.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getToday } from '../utils/utils.js';
import {
  normalise, displayName, stakesLine, statItems, bbItems, deliveryText, shareRow, moreLine, toneClass,
  fmtSignedCents, plural, cardRows, ledgerSides, monogram, needsYou, backerGroups, weekGroups,
} from '../utils/bankroll-backers.js';
import { settlementCountdown, nextSettlement, SETTLE_WEEK_MS } from '../utils/backer-page.js';
import { useToast } from '../contexts/ToastContext.jsx';
import { settleView, paymentView } from '../utils/backer-settle.js';
import { usePaneWidth } from './BankrollLocations.jsx';
import { LoadFailed } from './EmptyState.jsx';
import { SkeletonBlocks } from './SkeletonBankroll.jsx';
import Icon from './Icon.jsx';
import './analytics.css';
import './bankroll-locations.css';
import './bankroll-backers.css';
import SettleInline from './SettleInline.jsx';

/**
 * The bankroll dashboard's Backers tab — BETA, app admins; READ-ONLY.
 *
 * One card per backer, in the Locations card's anatomy (bankroll-locations.css). Bankroll design 51-59, 70:
 *   - the head of the list is a two-sided ledger, what is owed to the player and what he owes, with the week's
 *     clock (51);
 *   - each card has a monogram tile to be found by (56), and an all-square backer reads as settled, shorter
 *     and quieter (57);
 *   - a closed card is the name, the balance and the settle row; Copy link, Open page and Discord move inside
 *     the open card (55);
 *   - a half-confirmed settlement shows both presses as two steps (52);
 *   - an open card's rows are grouped at the settlement line with each group's sum (54), and a payment is a band
 *     across the ledger (53);
 *   - past eight backers the list is grouped 6r rows, who needs the player first (58);
 *   - the empty and the refused states have shapes of their own (59); the small grey lines read at 4.5:1 (60);
 *   - on a desktop pane wide enough an open card's actions sit beside the ledger they belong to (70).
 *
 * Data: GET /api/staking/standing/backers (the owner's alone, lib/backer-surface.js backersView). Every figure
 * is built through the backer's own feed, so a card reads exactly what that backer's page shows.
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
const usd = (c) => '$' + Math.round(Math.abs(Number(c) || 0) / 100).toLocaleString('en-US');
const dayET = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : '');

/** A half-confirmed settlement as two steps in press order (Bankroll design 52). */
function stepsOf(b) {
  const o = b.settlement && b.settlement.open;
  if (!o) return null;
  const first = (b.name || 'Your backer').split(' ')[0];
  const amt = o.kind === 'part' && o.amountCents != null ? ' · ' + usd(o.amountCents) : '';
  if (o.ownerAt && !o.backerAt) return [{ label: `You, ${dayET(o.ownerAt)}${amt}`, done: true }, { label: first, done: false }];
  if (o.backerAt && !o.ownerAt) return [{ label: `${first}, ${dayET(o.backerAt)}${amt}`, done: true }, { label: 'You', done: false }];
  return null;
}

function ShareRows({ b, thisYear, weekStart, next }) {
  const rows = cardRows(b);
  const g = weekGroups(rows, weekStart);
  const head = (key, label, sum) => (
    <li key={key} className="bb-group">
      <span className="an-cell an-lbl an-lbl-3b an-clip">{label}</span>
      {sum != null && <span className={'an-cell an-lbl an-lbl-3b an-num bb-group-sum' + toneClass(sum)}>{fmtSignedCents(sum)}</span>}
    </li>
  );
  const row = (r, i) => {
    if (r.type === 'payment') {
      // A payment is a band across the ledger (Bankroll design 53): the moment the two sides were square.
      const v = paymentView(r.p, { side: 'owner', backer: b.name || 'your backer' });
      const d = shareRow({ date: r.p.date }, thisYear).date;
      return (
        <li key={'p' + i} className="bb-payband">
          <span className="an-cell an-td an-clip bb-pay-date">{d}</span>
          <span className="an-cell an-td an-clip bb-pay-what"><span className="bb-pay-arrow" aria-hidden="true">{'→'}</span> {v.title}<span className="bb-pay-kind"> · {v.kind}</span></span>
          <span className="an-cell an-td an-num an-clip bb-pay-amt">{v.amount}</span>
        </li>
      );
    }
    const s = r.s;
    const x = shareRow(s, thisYear);
    return (
      <li key={i} className="bb-share">
        <span className="an-cell bl-res-date an-clip bb-date">{x.date}</span>
        <span className="an-cell an-td an-clip bb-game" title={x.game}>{x.game}</span>
        <span className={'an-cell an-td an-num bl-res-amt an-clip bb-cut' + x.shareTone}>{x.share}</span>
        <span className="an-cell an-note an-clip bb-hours">{x.hours}</span>
        <span className="an-cell an-note an-clip bb-venue" title={x.venue}>{x.venue}</span>
        <span className="an-cell an-note an-num an-clip bb-of">{x.of}</span>
      </li>
    );
  };
  // The settlement line (Bankroll design 54): this week's shares, then what earlier weeks owe (the sum the
  // Settled button names), then everything a payment band has already squared.
  const after = rows.slice(g.week.length + g.earlier.length);
  return (
    <ul className="bb-shares" aria-label={`${displayName(b)}'s last ${plural(b.shares.length, 'share')}, newest first`}>
      {g.week.length > 0 && head('w', `This week · settles ${dayET(new Date(next).toISOString())}`, g.weekSum)}
      {g.week.map(row)}
      {g.earlier.length > 0 && head('e', 'Earlier weeks · to settle now', Math.round(Number(b.dueCents) || 0))}
      {g.earlier.map((r, i) => row(r, 'e' + i))}
      {after.map((r, i) => row(r, 'a' + i))}
    </ul>
  );
}

/* What this backer's page may show (Features 21, 23; off until turned on): this week's events in their
   action, and the chips of a run in their action while it is live. */
function PageOptions({ id, token, name }) {
  const [opts, setOpts] = useState(null);
  useEffect(() => {
    let on = true;
    fetch(`${API_URL}/staking/standing/backers/${encodeURIComponent(id)}/page-options`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (on && d) setOpts(d); }).catch(() => {});
    return () => { on = false; };
  }, [id, token]);
  if (!opts) return null;
  const set = async (k) => {
    const next = { ...opts, [k]: !opts[k] };
    setOpts(next);
    const r = await fetch(`${API_URL}/staking/standing/backers/${encodeURIComponent(id)}/page-options`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ [k]: next[k] }),
    }).catch(() => null);
    if (!r || !r.ok) setOpts(opts);
  };
  return (
    <div className="bb-pageopts">
      <label className="bb-pageopt"><input type="checkbox" checked={opts.comingUp} onChange={() => set('comingUp')} /><span>{`Show ${name} this week’s events in their action`}</span></label>
      <label className="bb-pageopt"><input type="checkbox" checked={opts.sweat} onChange={() => set('sweat')} /><span>{`Share chip counts on runs in ${name}’s action`}</span></label>
    </div>
  );
}

function BackerCard({ b, open, onToggle, thisYear, onCopy, onSettle, settling, onDiscord, compact = false, wide = false, weekStart, next, token = null }) {
  const liRef = useRef(null);
  useOpenSpring(open, liRef, '.bb-detail');
  const id = 'bb-shares-' + b.id.replace(/[^\w-]+/g, '-');
  const name = displayName(b);
  const items = statItems(b);
  const bbs = bbItems(b);
  const delivery = deliveryText(b.delivery);
  const more = moreLine(b);
  const settle = settleView({ settlement: b.settlement, totalCents: b.dueCents, runningCents: b.cumulativeCents, side: 'owner', backer: b.name || 'your backer' });
  const first = (b.name || 'Your backer').split(' ')[0];
  const cum = Math.round(Number(b.cumulativeCents) || 0);
  const dir = cum > 0 ? `You pay ${first}` : cum < 0 ? `${first} pays you` : '';
  const waiting = b.settlement && b.settlement.open && b.settlement.open.ownerAt && !b.settlement.open.backerAt;
  const meta = needsYou(b) && compact ? null : [dir, waiting && compact ? `Waiting for ${first}` : null, stakesLine(b)].filter(Boolean).join(' · ');
  const bare = fmtSignedCents(Math.abs(cum)).replace(/^\+/, '');
  // All square (Bankroll design 57): $0 with nothing waiting reads as settled, the settle row folded into the
  // stats line's foot.
  const square = cum === 0 && !(b.settlement && b.settlement.open);
  const settledNote = square && settle && settle.status ? settle.status : null;
  const steps = stepsOf(b);
  const actions = (
    <div className="bb-acts">
      {/* The links (Bankroll design 55): inside the open card, one row of three, the states on a note under them. */}
      <div className="bl-pager bb-actions bb-links">
        <button type="button" className="bk-btn bl-more bb-link-btn" disabled={!b.link} onClick={() => onCopy(b)}
          aria-label={`Copy ${name}'s page link`}><span>Copy link</span></button>
        {b.link
          ? <a className="bk-btn bl-more bb-open bb-link-btn" href={b.link} target="_blank" rel="noopener noreferrer"
            aria-label={`Open ${name}'s page`}><span>Open page</span></a>
          : <button type="button" className="bk-btn bl-more bb-link-btn" disabled><span>Open page</span></button>}
        <button type="button" className="bk-btn bl-more bb-link-btn" onClick={() => onDiscord(b)}
          aria-label={`Set ${name}'s Discord user id`}><span>Discord</span></button>
      </div>
      <div className="an-cell an-note an-clip bb-states" title={delivery.long}>
        {delivery.short} · {b.discord ? `Sunday noon reminder on · id ending ${b.discord.hint}` : 'No Discord id: no Sunday reminder'}
      </div>
      {open && token && <PageOptions id={b.id} token={token} name={b.name || 'them'} />}
    </div>
  );
  return (
    <li ref={liRef} className={'bl-item bb-item' + (open ? ' is-open' : '') + (square ? ' is-square' : '') + (compact ? ' is-compact' : '')}>
      <button type="button" className={'bl-card' + (bbs.length && !compact ? ' has-bb' : '')} aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <span className="bl-head bb-head">
          {/* A face to find (Bankroll design 56): the backer's initials in one neutral tile. */}
          <span className="bb-tile ctl" aria-hidden="true">{monogram(b.name)}</span>
          <span className={'an-cell bl-name an-clip' + (b.name ? '' : ' is-none')} title={name}>{name}</span>
          {meta != null
            ? <span className="an-cell bl-meta an-clip" title={meta}>{meta}</span>
            : <span className="an-cell bl-meta bb-needs an-clip">{first} marked {usd(b.settlement.open.amountCents != null ? b.settlement.open.amountCents : b.settlement.open.balanceCents)}: confirm</span>}
          <span className={'an-cell bl-total snap-g' + (square ? ' is-quiet' : toneClass(-cum))} aria-label={dir ? `${dir} ${bare}` : `Running total ${bare}`}>
            {bare}
          </span>
        </span>
        {(!compact || open) && (
          <span className="an-cell bl-stats an-clip bb-stats">
            <span className="bb-stats-l">
              {items.map((it, i) => (
                <React.Fragment key={it.key}>
                  {i > 0 && <span className="bl-sep" aria-hidden="true">{' • '}</span>}
                  <span className="bl-stat">{it.text}</span>
                </React.Fragment>
              ))}
            </span>
            {settledNote && <span className="bb-settled"><span className="bb-tick" aria-hidden="true">{'✓'}</span> {settledNote}</span>}
          </span>
        )}
        {bbs.length > 0 && (!compact || open) && (
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
      {settle && !square && (!compact || open) && (
        <div className={'bl-pager bb-actions bb-settle is-inline' + (steps ? ' is-half' : '')}>
          <SettleInline view={settle} busy={settling} btnClass="bk-btn bl-more bb-settle-btn" steps={steps}
            primary={(v) => !!(v.button && v.button.label === 'Confirm')}
            onSend={({ part, settleCents }) => onSettle(b, settle, part, settleCents)} />
        </div>
      )}
      {open && (
        <div className={'bl-detail bb-detail' + (wide ? ' is-two' : '')} id={id}>
          {/* Desktop (Bankroll design 70): the actions on the left, sticky; the ledger on the right, its
              amounts ending on the total's edge. On the phone they stack. */}
          {actions}
          <div className="bb-ledger">
            {b.shares.length === 0 && b.payments.length === 0 ? (
              <p className="an-p bb-none">No shares recorded yet. A share appears here once a session is notified.</p>
            ) : <ShareRows b={b} thisYear={thisYear} weekStart={weekStart} next={next} />}
            {more && <div className="an-cell bl-count bb-more" aria-live="polite">{more}</div>}
          </div>
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
  const secRef = useRef(null);
  const paneG = usePaneWidth(secRef);
  const wide = paneG >= 62;
  // The week's clock (Bankroll design 51) and the line between this week and the earlier ones (54).
  const now = Date.now();
  const clock = settlementCountdown(now);
  const next = nextSettlement(now);
  const weekStart = new Date(next - SETTLE_WEEK_MS).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

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
        if (live) setState((s) => ({ status: 'error', backers: s.backers, error: e.status === 403 ? 'forbidden' : 'failed' }));
      }
    })();
    return () => { live = false; };
  }, [bk.token, reloadKey]);

  const settle = useCallback(async (b, v, part = false, partSettleCents = null) => {
    const settleCents = part ? partSettleCents : null;
    if (part && settleCents == null) return;
    setSettling(true);
    try {
      const res = await fetch(`${API_URL}/staking/standing/backers/${encodeURIComponent(b.id)}/settle`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: part ? 'confirm' : v.button.action, amountCents: part ? b.cumulativeCents : v.sendCents, ...(settleCents != null ? { settleCents } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'That did not go through. Try again.');
      else if (data.completed) {
        toast.success(data.partial ? `${usd(data.amountCents)} payment recorded with ${b.name || 'your backer'}.`
          : `Settled with ${b.name || 'your backer'}. Last week is cleared.`);
      } else if (part) toast.success(`${usd(settleCents)} payment marked. It counts once ${b.name || 'your backer'} confirms.`);
      setReloadKey((k) => k + 1);
    } catch { toast.error('That did not go through. Check your connection.'); }
    finally { setSettling(false); }
  }, [bk.token, toast]);

  const setDiscord = useCallback(async (b) => {
    const who = b.name || 'this backer';
    const answer = window.prompt(`${who}'s Discord user id, for the Sunday noon reminder. In Discord: Settings > Advanced > Developer Mode on, then right-click their name > Copy User ID. The bot must share a server with them. Leave it empty to turn their reminder off.`, '');
    if (answer == null) return;
    try {
      const res = await fetch(`${API_URL}/staking/standing/backers/${encodeURIComponent(b.id)}/discord`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${bk.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: answer.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'That did not go through. Try again.');
      else toast.success(data.cleared ? `${who}'s Sunday reminder is off.` : `${who} gets the Sunday noon reminder on Discord.`);
      setReloadKey((k) => k + 1);
    } catch { toast.error('That did not go through. Check your connection.'); }
  }, [bk.token, toast]);

  const list = state.backers;
  const sides = useMemo(() => ledgerSides(list), [list]);
  const toggle = useCallback((id) => setOpen((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }), []);
  const copy = useCallback(async (b) => {
    if (await copyText(b.link)) toast.success('Link copied');
    else toast.error('Could not copy the link');
  }, [toast]);
  const many = list.length > 8;
  const card = (b, compact) => (
    <BackerCard key={b.id} b={b} open={open.has(b.id)} onToggle={() => toggle(b.id)} compact={compact} wide={wide}
      thisYear={thisYear} onCopy={copy} onSettle={settle} settling={settling} onDiscord={setDiscord} weekStart={weekStart} next={next} token={bk.token} />
  );
  const forbidden = state.status === 'error' && state.error === 'forbidden';
  const total = sides.owedToYou + sides.youOwe;

  return (
    <section ref={secRef} className={'bd-section bl-locations bb-backers' + (wide ? ' is-wide' : '')} aria-labelledby="bb-title">
      <h3 className="an-cell an-sec bb-titlerow" id="bb-title">
        <span>Backers</span>
        {list.length > 0 && <span className="bb-clock">Settles Sunday noon · {clock.text}</span>}
      </h3>
      {!forbidden && (
        <p className="an-p bb-note">
          Each card shows what that backer's page shows. Send a result's shares from its edit form; add
          and edit backers in Staking, under Standing.
        </p>
      )}

      {/* The refused state has a shape of its own (Bankroll design 59): a closed door, not an empty list. */}
      {forbidden && (
        <div className="bb-refused" role="note">
          <span className="bb-lock ctl" aria-hidden="true"><Icon.lock /></span>
          <span className="an-cell bb-refused-title">Another account's backers</span>
          <p className="an-p">Backers are shown to the account that owns them. Sign in as that account to see them.</p>
        </div>
      )}
      {state.status === 'error' && !forbidden && (
        <div className="bl-gap"><LoadFailed inline={list.length > 0} title="Your backers did not load" onRetry={() => setReloadKey((k) => k + 1)} /></div>
      )}
      {state.status === 'loading' && list.length === 0 && (
        <div className="bl-gap"><SkeletonBlocks label="Loading your backers" blocks={[{ h: 10, bars: [[17, 2], [17, 2]] }, ...[0, 1, 2].map(() => ({ h: 17, card: true, bars: [[3, 4], [14, 1], [8, 2, 'end']] }))]} /></div>
      )}
      {state.status === 'ready' && list.length === 0 && (
        /* Empty (Bankroll design 59): a ghost of the card a backer gets, and the way to add one. */
        <div className="bb-empty">
          <div className="bb-ghost" aria-hidden="true">
            <span className="bb-ghost-l"><span>A backer's name</span><span>Their share of each game</span></span>
            <span className="bb-ghost-r">$0</span>
            <span className="bb-ghost-stats">Sessions • Hours • What you owe each other</span>
          </div>
          <div className="bb-empty-row">
            <p className="an-p">No backers yet. Each backer gets a card here and a page of their own.</p>
            <a className="bk-btn bk-btn--brand bb-add" href="#staking/standing"><span>Add a backer</span></a>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <>
          {/* A two-sided ledger (Bankroll design 51): what is owed to the player and what he owes, as two
              figures, one bar split between them, and a foot line per side. */}
          <div className="bb-ledgerstrip" role="group" aria-label="Owed to you and what you owe">
            <div className="bb-side">
              <span className="an-cell an-lbl an-lbl-2">Owed to you</span>
              <span className="an-cell bb-side-fig">{usd(sides.owedToYou)}</span>
            </div>
            <div className="bb-side an-num">
              <span className="an-cell an-lbl an-lbl-2">You owe</span>
              <span className="an-cell bb-side-fig">{usd(sides.youOwe)}</span>
            </div>
            <div className="bb-split" aria-hidden="true">
              {total > 0 && <i className="is-pos" style={{ width: `${((sides.owedToYou / total) * 100).toFixed(2)}%` }} />}
              {total > 0 && <i className="is-neg" style={{ width: `${((sides.youOwe / total) * 100).toFixed(2)}%` }} />}
            </div>
            <span className="an-cell an-note an-clip">{plural(sides.nOwed, 'backer')}{sides.toConfirm ? ` · ${sides.toConfirm} to confirm` : ''}</span>
            <span className="an-cell an-note an-num an-clip">{plural(sides.nOwe, 'backer')}{sides.oweBefore ? ` · ${usd(sides.oweBefore)} before this week` : ''}</span>
          </div>
          {many ? (
            /* A long roster (Bankroll design 58): grouped 6r rows, who needs the player first. */
            backerGroups(list).map((g) => (
              <div key={g.key} className="bb-group-block">
                <div className="bb-group-head">
                  <span className="an-cell an-lbl an-lbl-3b">{g.label} · {g.backers.length}</span>
                  {g.netCents != null && <span className={'an-cell an-lbl an-lbl-3b an-num' + toneClass(-g.netCents)}>{fmtSignedCents(Math.abs(g.netCents)).replace(/^\+/, '')}</span>}
                </div>
                <ul className="bl-list bb-compact-list">{g.backers.map((b) => card(b, true))}</ul>
              </div>
            ))
          ) : (
            <ul className="bl-list">{list.map((b) => card(b, false))}</ul>
          )}
        </>
      )}
    </section>
  );
}
