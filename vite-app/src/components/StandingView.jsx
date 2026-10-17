import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { getToday } from '../utils/utils.js';
import Icon from './Icon.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import {
  normaliseList, stakeWords, agreementView, toCreateBody, toStakesBody, correctionText, eventView, driftView, stateLine, fmtPct,
  toPaymentBody, paymentView,
} from '../utils/standing-ui.js';
import './standing.css';

/**
 * Standing agreements (the Staking tab › Standing; docs/bankroll-merge.md Phase 8, on Phase 7's
 * routes). A standing agreement is a backer's % of every result of a game, from a date: the
 * dashboard app's model, now kept here. This view lists the player's agreements, adds one (an
 * existing staking backer, or a new one minted a private link), edits its stakes ("from today"
 * keeps every past share; "correct" re-derives the shares it changes after a preview), ends it,
 * sets texts and the weekly email, mints a new link, and shows a backer's recorded shares with
 * their actions: exclude a result, and for a dashboard-era share recalculate or remove it. The
 * owner also sees the money state and the drift report (shares a feed edit moved under).
 *
 * The server computes every figure (lib/staking/live.js); this sends references and the stakes as
 * typed. No token or event id is ever shown: a link reads by its last four characters, and a NEW
 * link is shown once, when minted.
 *
 * Layout (standing.css): every text line a .sd-t block (the Backers block's recipe), every box
 * whole g by whole r, the buttons' labels centred.
 */
const thisYear = () => Number(getToday().slice(0, 4));

function useApi(token) {
  return useCallback(async (method, path, body) => {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (_) { return { status: 0, data: {} }; }
  }, [token]);
}

function Btn({ w = 8, tone = '', disabled, onClick, children, title, type = 'button' }) {
  return (
    <button type={type} className={'sd-btn' + (tone ? ' sd-btn--' + tone : '')} style={{ '--w': w }} disabled={disabled} onClick={onClick} title={title}>
      <span>{children}</span>
    </button>
  );
}

/** The stakes editor's rows: game | channel | % | remove, and + Stake. */
function StakeRows({ rows, setRows, formats, channels }) {
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="sd-stakes">
      {rows.map((r, i) => (
        <div key={i} className="sd-stake-row">
          <label className="staking-field sd-f-game"><span>Game</span>
            <select value={r.format} onChange={(e) => set(i, { format: e.target.value })}>
              {formats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="staking-field sd-f-chan"><span>Where</span>
            <select value={r.channel} onChange={(e) => set(i, { channel: e.target.value })}>
              {channels.map((c) => <option key={c} value={c}>{c === 'any' ? 'Live + online' : c === 'live' ? 'Live' : 'Online'}</option>)}
            </select>
          </label>
          <label className="staking-field sd-f-pct"><span>%</span>
            <input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} />
          </label>
          <Btn w={4} tone="ghost" title="Remove this stake" onClick={() => setRows(rows.filter((_, k) => k !== i))} disabled={rows.length <= 1}><Icon.x /></Btn>
        </div>
      ))}
      <div className="sd-actions"><Btn w={8} onClick={() => setRows([...rows, { format: 'all', channel: 'any', pct: '' }])}>+ Stake</Btn></div>
    </div>
  );
}

function AddForm({ api, backers, formats, channels, onSaved, onCancel }) {
  const [f, setF] = useState({ backerId: backers.length ? String(backers[0].id) : 'new', newName: '', newPhone: '', newEmail: '', effectiveFrom: getToday(), openingCents: '', openingNote: '', stakes: [{ format: 'all', channel: 'any', pct: '' }] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState(null);
  const put = (patch) => setF((x) => ({ ...x, ...patch }));
  const save = async () => {
    const r = toCreateBody(f);
    if (r.error) { setError(r.error); return; }
    setBusy(true); setError('');
    const res = await api('POST', '/staking/standing', r.body);
    setBusy(false);
    if (res.status !== 201) { setError(res.data.error || 'Could not save the agreement.'); return; }
    if (res.data.link) setMinted(res.data.link); else onSaved();
  };
  if (minted) {
    return (
      <div className="sd-form">
        <p className="sd-text">The backer&rsquo;s private link, shown once: <strong>futurega.me{minted}</strong>. Copy it now; later only its last four characters show, and New link replaces it.</p>
        <div className="sd-actions">
          <Btn w={9} tone="brand" onClick={() => { navigator.clipboard && navigator.clipboard.writeText('https://futurega.me' + minted).catch(() => {}); }}>Copy link</Btn>
          <Btn w={7} onClick={onSaved}>Done</Btn>
        </div>
      </div>
    );
  }
  return (
    <form className="sd-form" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label="New standing agreement">
      {error && <p className="sd-text sd-text--err" role="alert">{error}</p>}
      <label className="staking-field"><span>Backer</span>
        <select value={f.backerId} onChange={(e) => put({ backerId: e.target.value })}>
          {backers.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          <option value="new">New backer…</option>
        </select>
      </label>
      {f.backerId === 'new' && (
        <>
          <label className="staking-field"><span>Name</span><input type="text" value={f.newName} onChange={(e) => put({ newName: e.target.value })} placeholder="Backer name" /></label>
          <label className="staking-field"><span>Phone (texts)</span><input type="tel" value={f.newPhone} onChange={(e) => put({ newPhone: e.target.value })} placeholder="+1 555 555 0100" /></label>
          <label className="staking-field"><span>Email (weekly)</span><input type="email" value={f.newEmail} onChange={(e) => put({ newEmail: e.target.value })} placeholder="name@example.com" /></label>
        </>
      )}
      <div className="sd-two">
        <label className="staking-field"><span>Starts</span><input type="date" value={f.effectiveFrom} onChange={(e) => put({ effectiveFrom: e.target.value })} /></label>
        <label className="staking-field"><span>Opening ($, + = you owe)</span><input type="number" inputMode="decimal" step="0.01" value={f.openingCents} onChange={(e) => put({ openingCents: e.target.value })} placeholder="0" /></label>
      </div>
      <StakeRows rows={f.stakes} setRows={(stakes) => put({ stakes })} formats={formats} channels={channels} />
      <div className="sd-actions">
        <Btn type="submit" w={9} tone="brand" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
        <Btn w={8} onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </form>
  );
}

function StakesEditor({ api, a, formats, channels, onDone }) {
  const current = a.stakes.filter((s) => s.inForce);
  const [rows, setRows] = useState(current.length ? current.map((s) => ({ format: s.format, channel: s.channel, pct: String(s.pct) })) : [{ format: 'all', channel: 'any', pct: '' }]);
  const [mode, setMode] = useState('from-today');
  const [pv, setPv] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (confirm) => {
    const r = toStakesBody(rows, mode, confirm);
    if (r.error) { setError(r.error); return; }
    setBusy(true); setError('');
    const res = await api('POST', `/staking/standing/${a.id}/stakes`, r.body);
    setBusy(false);
    if (res.status !== 200) { setError(res.data.error || 'Could not save the stakes.'); return; }
    if (res.data.preview) { setPv(res.data); return; }
    onDone();
  };
  return (
    <div className="sd-editor" role="group" aria-label={`Stakes for ${a.backer.name}`}>
      {error && <p className="sd-text sd-text--err" role="alert">{error}</p>}
      <StakeRows rows={rows} setRows={(r) => { setRows(r); setPv(null); }} formats={formats} channels={channels} />
      <div className="sd-seg" role="radiogroup" aria-label="How the change applies">
        {[['from-today', 'From today'], ['correct', 'Correct']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} className={'sd-btn sd-btn--seg' + (mode === v ? ' is-on' : '')} style={{ '--w': 10 }} onClick={() => { setMode(v); setPv(null); }}><span>{l}</span></button>
        ))}
      </div>
      <p className="sd-text">{mode === 'correct' ? 'A correction edits the stakes in place and re-derives every recorded share they change, after you see which.' : 'From today keeps every past share as it was; the new stakes count from today.'}</p>
      {pv ? (
        <>
          <p className="sd-text sd-text--warn">{correctionText(pv)}</p>
          {pv.affected.slice(0, 20).map((x, i) => <p key={i} className="sd-t sd-line">{x.date} · {x.game}: {fmtPct(x.pctBefore)} → {x.pctAfter == null ? 'none' : fmtPct(x.pctAfter)}</p>)}
          <div className="sd-actions">
            <Btn w={9} tone="warn" disabled={busy} onClick={() => send(true)}>{busy ? 'Saving…' : 'Confirm'}</Btn>
            <Btn w={8} disabled={busy} onClick={() => setPv(null)}>Back</Btn>
          </div>
        </>
      ) : (
        <div className="sd-actions">
          <Btn w={9} tone="brand" disabled={busy} onClick={() => send(false)}>{busy ? 'Saving…' : mode === 'correct' ? 'Preview' : 'Save'}</Btn>
          <Btn w={8} disabled={busy} onClick={onDone}>Cancel</Btn>
        </div>
      )}
    </div>
  );
}

function Shares({ api, a, owner, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const load = useCallback(async () => { const r = await api('GET', `/staking/standing/${a.id}/events`); setData(r.status === 200 ? r.data : { events: [] }); }, [api, a.id]);
  useEffect(() => { load(); }, [load]);
  const act = async (path, body, key) => {
    setBusy(key);
    const r = await api(path === 'exclude' ? 'POST' : 'POST', path === 'exclude' ? '/staking/standing/exclusions' : `/staking/standing/events/${path}`, body);
    setBusy(null);
    if (r.status !== 200) { toast.error(r.data.error || 'That did not go through.'); return; }
    await load();
    onChanged();
  };
  if (!data) return <p className="sd-t sd-line">Loading…</p>;
  if (!data.events.length) return <p className="sd-t sd-line">No shares recorded yet.</p>;
  const y = thisYear();
  return (
    <ul className="sd-events">
      {data.events.map((e) => {
        const v = eventView(e, { thisYear: y });
        const ref = { refTable: e.refTable, refId: e.refId, key: a.backer.key };
        return (
          <li key={v.key} className="sd-event">
            <span className="sd-t sd-ev-when">{v.when}</span>
            <span className="sd-t sd-ev-what" title={v.what}>{v.what}</span>
            <span className={'sd-t sd-ev-share ' + v.shareTone}>{v.share}</span>
            <span className="sd-t sd-ev-detail" title={v.detail}>{v.detail}{v.revisions ? ` · ${v.revisions} change${v.revisions === 1 ? '' : 's'}` : ''}</span>
            {owner && (v.canExclude || v.dashboard) && e.refId != null && (
              <div className="sd-ev-act">
                {v.canExclude && <Btn w={8} disabled={!!busy} onClick={() => act('exclude', ref, v.key)}>{busy === v.key ? '…' : 'Exclude'}</Btn>}
                {v.dashboard && <Btn w={11} disabled={!!busy} onClick={() => act('recalc', ref, v.key)} title="Make it a share of the result as it is now, at its own %">Recalculate</Btn>}
                {v.dashboard && <Btn w={8} tone="ghost" disabled={!!busy} onClick={() => act('remove', ref, v.key)}>Remove</Btn>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Payouts (Phase 14): money that changed hands with this backer. Each lowers (or, from the backer,
 * raises) their running total and writes a settlement into Main. The list, newest first, each with
 * Remove; then the form: amount, who paid, the day, a note.
 */
function Payouts({ api, a, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [f, setF] = useState({ amount: '', direction: 'out', paidOn: getToday(), note: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api('GET', `/staking/standing/${a.id}/payments`); setData(r.status === 200 ? r.data : { payments: [] }); }, [api, a.id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    const r = toPaymentBody(f);
    if (r.error) { toast.error(r.error); return; }
    setBusy(true);
    const res = await api('POST', `/staking/standing/${a.id}/payments`, r.body);
    setBusy(false);
    if (res.status !== 201) { toast.error(res.data.error || 'Could not record it.'); return; }
    setF({ ...f, amount: '', note: '' });
    await load(); onChanged();
  };
  const remove = async (id) => {
    setBusy(true);
    const res = await api('DELETE', `/staking/standing/payments/${id}`);
    setBusy(false);
    if (res.status !== 200) { toast.error(res.data.error || 'Could not remove it.'); return; }
    await load(); onChanged();
  };
  const y = thisYear();
  return (
    <div className="sd-confirm" role="group" aria-label={`Payouts with ${a.backer.name}`}>
      {!data ? <p className="sd-t sd-line">Loading…</p> : !data.payments.length ? <p className="sd-t sd-line">No payouts recorded.</p> : (
        <ul className="sd-events">
          {data.payments.map((p) => {
            const v = paymentView(p, { thisYear: y });
            return (
              <li key={v.key} className="sd-event">
                <span className="sd-t sd-ev-when">{v.when}</span>
                <span className="sd-t sd-ev-what" title={v.what}>{v.what}</span>
                <span className={'sd-t sd-ev-share ' + v.tone}>{v.amount}</span>
                <div className="sd-ev-act"><Btn w={8} tone="ghost" disabled={busy} onClick={() => remove(p.id)}>Remove</Btn></div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="sd-two">
        <label className="staking-field"><span>Amount ($)</span><input type="number" inputMode="numeric" min="1" step="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="staking-field"><span>Who paid</span>
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="out">I paid them</option>
            <option value="in">They paid me</option>
          </select>
        </label>
      </div>
      <div className="sd-two">
        <label className="staking-field"><span>Day</span><input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></label>
        <label className="staking-field"><span>Note</span><input type="text" maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Venmo, cash…" /></label>
      </div>
      <p className="sd-text">It lowers {a.backer.name}&rsquo;s running total on their page and records a settlement in Main.</p>
      <div className="sd-actions"><Btn w={9} tone="brand" disabled={busy} onClick={add}>{busy ? 'Saving…' : 'Record'}</Btn></div>
    </div>
  );
}

function Card({ api, a, formats, channels, owner, reload }) {
  const toast = useToast();
  const [open, setOpen] = useState(null); // 'stakes' | 'shares' | 'end' | 'link' | 'delivery'
  const [minted, setMinted] = useState(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const v = agreementView(a, { thisYear: thisYear(), today: getToday() });
  const end = async () => {
    setBusy(true);
    const r = await api('PUT', `/staking/standing/${a.id}`, { status: 'ended' });
    setBusy(false);
    if (r.status !== 200) { toast.error(r.data.error || 'Could not end it.'); return; }
    setOpen(null); reload();
  };
  const newLink = async () => {
    setBusy(true);
    const r = await api('POST', `/staking/standing/backers/${a.backer.id}/rotate-link`, {});
    setBusy(false);
    if (r.status !== 200) { toast.error(r.data.error || 'Could not make a new link.'); return; }
    setMinted(r.data.path); reload();
  };
  const delivery = async () => {
    setBusy(true);
    const body = {};
    if (phone.trim() || a.delivery.sms) body.sms = phone.trim() || null;
    if (email.trim() || a.delivery.email) body.email = email.trim() || null;
    const r = await api('PUT', `/staking/standing/backers/${a.backer.id}/delivery`, body);
    setBusy(false);
    if (r.status !== 200) { toast.error(r.data.error || 'Could not set delivery.'); return; }
    setOpen(null); setPhone(''); setEmail(''); reload();
  };
  return (
    <li className={'sd-card' + (a.status === 'ended' ? ' is-ended' : '')}>
      <span className="sd-t sd-name" title={v.name}>{v.name}</span>
      <span className={'sd-t sd-running ' + v.runningTone} title="Running total: shares plus opening">{v.running}</span>
      <span className="sd-t sd-line">{v.status} · {v.stakes}</span>
      <span className="sd-t sd-line">{v.money}</span>
      <span className="sd-t sd-line">{v.link} · {v.delivery}</span>
      {a.status !== 'ended' && (
        <div className="sd-card-act">
          <Btn w={7} onClick={() => setOpen(open === 'stakes' ? null : 'stakes')}>Stakes</Btn>
          <Btn w={7} onClick={() => setOpen(open === 'shares' ? null : 'shares')}>Shares</Btn>
          <Btn w={8} onClick={() => setOpen(open === 'payouts' ? null : 'payouts')}>Payouts</Btn>
          <Btn w={8} onClick={() => setOpen(open === 'delivery' ? null : 'delivery')}>Delivery</Btn>
          <Btn w={8} onClick={() => setOpen(open === 'link' ? null : 'link')}>New link</Btn>
          <Btn w={4} tone="ghost" title="End this agreement" onClick={() => setOpen(open === 'end' ? null : 'end')}>End</Btn>
        </div>
      )}
      {a.status === 'ended' && <div className="sd-card-act"><Btn w={7} onClick={() => setOpen(open === 'shares' ? null : 'shares')}>Shares</Btn><Btn w={8} onClick={() => setOpen(open === 'payouts' ? null : 'payouts')}>Payouts</Btn></div>}
      {open === 'stakes' && <StakesEditor api={api} a={a} formats={formats} channels={channels} onDone={() => { setOpen(null); reload(); }} />}
      {open === 'shares' && <Shares api={api} a={a} owner={owner} onChanged={reload} />}
      {open === 'payouts' && <Payouts api={api} a={a} onChanged={reload} />}
      {open === 'end' && (
        <div className="sd-confirm">
          <p className="sd-text">End {v.name}&rsquo;s agreement today? Past shares stay on the page; nothing new posts to it.</p>
          <div className="sd-actions"><Btn w={9} tone="warn" disabled={busy} onClick={end}>End it</Btn><Btn w={8} disabled={busy} onClick={() => setOpen(null)}>Keep</Btn></div>
        </div>
      )}
      {open === 'link' && (
        <div className="sd-confirm">
          {minted ? (
            <>
              <p className="sd-text">The new link, shown once: <strong>futurega.me{minted}</strong>. The old one stops working now.</p>
              <div className="sd-actions"><Btn w={9} tone="brand" onClick={() => { navigator.clipboard && navigator.clipboard.writeText('https://futurega.me' + minted).catch(() => {}); }}>Copy link</Btn><Btn w={7} onClick={() => { setOpen(null); setMinted(null); }}>Done</Btn></div>
            </>
          ) : (
            <>
              <p className="sd-text">Replace {v.name}&rsquo;s private link? Every share moves to the new one; the old link stops working the moment it is made.</p>
              <div className="sd-actions"><Btn w={9} tone="warn" disabled={busy} onClick={newLink}>New link</Btn><Btn w={8} disabled={busy} onClick={() => setOpen(null)}>Cancel</Btn></div>
            </>
          )}
        </div>
      )}
      {open === 'delivery' && (
        <div className="sd-confirm">
          <label className="staking-field"><span>Texts to (blank turns texts off)</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={a.delivery.sms ? 'on' : 'off'} /></label>
          <label className="staking-field"><span>Weekly email to (blank turns it off)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={a.delivery.email ? 'on' : 'off'} /></label>
          <div className="sd-actions"><Btn w={9} tone="brand" disabled={busy} onClick={delivery}>Save</Btn><Btn w={8} disabled={busy} onClick={() => setOpen(null)}>Cancel</Btn></div>
        </div>
      )}
    </li>
  );
}

export default function StandingView({ token, backers, onBack }) {
  const api = useApi(token);
  const toast = useToast();
  const [list, setList] = useState(null);
  const [state, setState] = useState(null);
  const [drift, setDrift] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(null);
  const owner = state != null;
  const reload = useCallback(async () => {
    const [l, s, d] = await Promise.all([api('GET', '/staking/standing'), api('GET', '/bankrolls/money/cutover'), api('GET', '/staking/standing/drift')]);
    setList(normaliseList(l.status === 200 ? l.data : null));
    setState(s.status === 200 ? s.data.state : null);
    setDrift(d.status === 200 ? d.data.lines : null);
  }, [api]);
  useEffect(() => { reload(); }, [reload]);
  const applyDrift = async (l) => {
    setBusy(l.key);
    const r = await api('POST', '/staking/standing/drift/apply', { refTable: l.refTable, refId: l.refId });
    setBusy(null);
    if (r.status !== 200) { toast.error(r.data.error || 'Could not apply it.'); return; }
    reload();
  };
  const y = thisYear();
  // Posting: the dashboard import leaves it off (lib/money-import/apply.js; the spec's step 6 was to turn it
  // back on), and the plain cutover had no such step, so the Notify tap was refused (owner, 2026-10-17).
  // On only: no postingSince, so no agreement's date moves, and the cutover state is left alone.
  const setPosting = async (on) => {
    setBusy('posting');
    const r = await api('PUT', '/bankrolls/money/cutover', { posting: on ? 'on' : 'off' });
    setBusy(null);
    if (r.status !== 200) { toast.error((r.data && r.data.error) || 'Could not change posting.'); return; }
    toast.success(on ? 'Posting is on: Notify records shares again.' : 'Posting is off.');
    reload();
  };
  const driftLines = useMemo(() => (drift || []).map((l) => driftView(l, { thisYear: y })), [drift, y]);
  return (
    <div className="sd">
      <div className="group-detail-header">
        <button className="group-back-btn" onClick={onBack} aria-label="Back"><Icon.arrowLeft /></button>
        <div style={{ flex: 1 }}><div className="social-buddy-name" style={{ fontSize: 'calc(var(--subrow) * 2)', lineHeight: 'calc(var(--subrow) * 5)' }}>Standing</div></div>
        <button className="create-group-submit" style={{ width: 'calc(var(--gu) * 6)', fontSize: 'calc(var(--subrow) * 1.5)', height: 'calc(var(--subrow) * 4)', lineHeight: 'calc(var(--subrow) * 2)', padding: 0, textIndent: 'var(--track-caps)' }} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>
      <p className="sd-text">A standing agreement is a backer&rsquo;s share of every result of a game, from a day on. A share is recorded only when you tap Notify on a result; an edit after that follows it silently.</p>
      {owner && <p className="sd-text sd-text--muted">{stateLine(state)}</p>}
      {owner && state.posting === 'off' && (
        <div className="sd-actions"><Btn w={14} tone="brand" disabled={busy === 'posting'} onClick={() => setPosting(true)}>Turn posting on</Btn></div>
      )}
      {adding && list && <AddForm api={api} backers={backers || []} formats={list.formats} channels={list.channels} onSaved={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      {owner && driftLines.length > 0 && (
        <section className="sd-drift" aria-label="Shares a result moved under">
          <h3 className="sd-t sd-sec">Moved underneath ({driftLines.length})</h3>
          <p className="sd-text">A feed edit changed these results after their shares were sent. Nothing applies by itself.</p>
          <ul className="sd-events">
            {driftLines.map((l) => (
              <li key={l.key} className="sd-drift-line">
                <span className="sd-t sd-line" title={l.text}>{l.text}</span>
                <Btn w={7} disabled={!!busy} onClick={() => applyDrift(l)}>{busy === l.key ? '…' : 'Apply'}</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!list ? <p className="sd-t sd-line">Loading…</p> : !list.agreements.length ? (
        <p className="sd-text">No standing agreements yet. Add one above.</p>
      ) : (
        <ul className="sd-cards">
          {list.agreements.map((a) => <Card key={a.id} api={api} a={a} formats={list.formats} channels={list.channels} owner={owner} reload={reload} />)}
        </ul>
      )}
    </div>
  );
}
