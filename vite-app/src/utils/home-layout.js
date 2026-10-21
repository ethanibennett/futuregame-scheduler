// ── The home's layout: which sections show, and in what order (Edit home) ──────────────────────
// Pure (no React, no DOM, no storage): utils/__tests__/home-layout.test.mjs. The hook that loads,
// caches and saves it is hooks/useHomeLayout.js; the sheet that edits it HomeEditSheet.jsx.
//
// The document (stored per account as users.home_layout, validated for shape only by
// lib/home-layout.js, so a new section needs no server change):
//   { v: 1, sections: [{ id, on }, ...], updatedAt }
// The array's order is the top-level order. A part (a section drawn inside another: the noise line
// and the goals inside the period block) keeps only its on/off; its place in the array is ignored.
// null (no document) is the default home: every section on, in HOME_SECTIONS order.
//
// One stored order serves both layouts. The phone shows every visible section in that order, in
// one column. On desktop each section keeps its pane (NOW on the left, NUMBERS on the right) and
// each pane shows its sections in the user's RELATIVE order; a reorder made inside one desktop group
// rewrites only that group's slots (move / moveTo with { group }), so it never disturbs how the
// other pane's sections interleave with it on the phone.
//
// To add a section (Trend, say): one entry here (pane 'numbers', after 'period') and one element in
// DashboardView's section map. Saved layouts that predate it show it, on, at its default place.

export const HOME_SECTIONS = [
  { id: 'upnext',   name: 'Up Next',         note: 'Always on the home',       pane: 'now',     who: 'all',        locked: true },
  { id: 'tolog',    name: 'To log',          note: 'When a result is missing', pane: 'now',     who: 'registered' },
  { id: 'last',     name: 'Last result',                                       pane: 'now',     who: 'registered' },
  { id: 'bankroll', name: 'Bankroll',                                          pane: 'numbers', who: 'admin' },
  { id: 'period',   name: 'This month',      note: 'Or your trip or series',   pane: 'numbers', who: 'all' },
  { id: 'noise',    name: 'Signal or noise',                                   parent: 'period', who: 'admin' },
  { id: 'goals',    name: 'Goals',           note: 'When you have set some',   parent: 'period', who: 'admin' },
  // Brought back as options (owner, 2026-10-20: "bring back the option to add friends events to the
  // dashboard, and the tablescanner"), off until switched on in Edit home: defaultOff.
  { id: 'friends',  name: 'Friends',         note: 'Playing now, or on today', pane: 'now',     who: 'registered', defaultOff: true },
  { id: 'scanner',  name: 'Table scanner',   note: 'Read a table screenshot',  pane: 'now',     who: 'registered', defaultOff: true },
];

export const LAYOUT_VERSION = 1;
export const MAX_SECTIONS = 32;
export const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;

const BY_ID = new Map(HOME_SECTIONS.map((s) => [s.id, s]));
const TOP = HOME_SECTIONS.filter((s) => !s.parent);
const isPart = (id) => !!(BY_ID.get(id) && BY_ID.get(id).parent);

export const sectionOf = (id) => BY_ID.get(id) || null;

/** Whether a viewer of this kind can see a section at all (ctx = { admin, registered }). */
export function canSee(sec, ctx = {}) {
  if (!sec) return false;
  const c = ctx || {};
  if (sec.who === 'admin') return !!c.admin;
  if (sec.who === 'registered') return !!(c.registered || c.admin);
  return true;
}

/** The registry entries this viewer can see, in default order (a part only with its parent). */
export function available(ctx) {
  return HOME_SECTIONS.filter((s) => canSee(s, ctx) && (!s.parent || canSee(BY_ID.get(s.parent), ctx)));
}

const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

/**
 * Anything malformed becomes null (the default home): not a plain object, v other than 1, no
 * sections array, more than 32 entries. Bad entries (an id outside [a-z][a-z0-9-]{0,23}, an `on`
 * that is not a boolean) are dropped, duplicates after the first are dropped, extra keys are
 * stripped. A document left with no entries is null.
 */
export function normalise(raw) {
  if (!isPlain(raw) || raw.v !== LAYOUT_VERSION || !Array.isArray(raw.sections)) return null;
  if (raw.sections.length > MAX_SECTIONS) return null;
  const seen = new Set();
  const sections = [];
  for (const e of raw.sections) {
    if (!isPlain(e) || typeof e.id !== 'string' || !ID_RE.test(e.id) || typeof e.on !== 'boolean') continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    sections.push({ id: e.id, on: e.on });
  }
  if (!sections.length) return null;
  const out = { v: LAYOUT_VERSION, sections };
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt;
  return out;
}

/** The default document (what null stands for). */
export function defaultDoc() {
  return { v: LAYOUT_VERSION, sections: HOME_SECTIONS.map((s) => ({ id: s.id, on: !s.defaultOff })) };
}

// id -> on, from a (normalised) document; an id it does not mention is on.
function onMap(doc) {
  const m = new Map();
  if (doc && Array.isArray(doc.sections)) for (const e of doc.sections) m.set(e.id, !!e.on);
  return m;
}
// A section the document does not mention is on, unless the registry says it starts off.
const isOn = (m, id) => (BY_ID.get(id) && BY_ID.get(id).locked ? true : (m.has(id) ? m.get(id) : !(BY_ID.get(id) && BY_ID.get(id).defaultOff)));

/**
 * The full top-level order: the saved ids (parts left out; unknown ids keep their places), then
 * each registry section the document does not mention, inserted right after the nearest section
 * before it in default order that is present (or at the front when none is). So a layout saved
 * before a section existed shows it at its default place.
 */
export function fullOrder(doc) {
  const d = doc ? normalise(doc) || null : null;
  if (!d) return TOP.map((s) => s.id);
  const order = d.sections.map((e) => e.id).filter((id) => !isPart(id));
  for (let i = 0; i < TOP.length; i++) {
    const id = TOP[i].id;
    if (order.includes(id)) continue;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const j = order.indexOf(TOP[k].id);
      if (j >= 0) { at = j + 1; break; }
    }
    order.splice(at, 0, id);
  }
  return order;
}

/**
 * What the home renders: the top-level ids that are available and on, in order — phone (one
 * column), and per desktop pane (now, numbers) — and `on`, every visible id, parts included (a part
 * only while its parent is on).
 */
export function resolve(doc, ctx) {
  const m = onMap(doc ? normalise(doc) : null);
  const phone = fullOrder(doc).filter((id) => {
    const s = BY_ID.get(id);
    return s && !s.parent && canSee(s, ctx) && isOn(m, id);
  });
  const on = new Set(phone);
  for (const s of HOME_SECTIONS) {
    if (s.parent && on.has(s.parent) && canSee(s, ctx) && isOn(m, s.id)) on.add(s.id);
  }
  return {
    phone,
    now: phone.filter((id) => BY_ID.get(id).pane === 'now'),
    numbers: phone.filter((id) => BY_ID.get(id).pane === 'numbers'),
    on,
  };
}

/** Whether an id is switched on in the document (locked ids always are; parts by their own flag). */
export function isSwitchedOn(doc, id) {
  return isOn(onMap(doc ? normalise(doc) : null), id);
}

// A document with this top-level order and these flags. Parts follow their parent; unknown ids and
// ids this viewer cannot see keep their entries (and their places) untouched.
function build(doc, order, flags) {
  const d = doc ? normalise(doc) : null;
  const m = onMap(d);
  if (flags) for (const [id, v] of flags) m.set(id, v);
  const sections = [];
  const seen = new Set();
  const push = (id) => { if (!seen.has(id)) { seen.add(id); sections.push({ id, on: isOn(m, id) }); } };
  for (const id of order) {
    push(id);
    for (const s of HOME_SECTIONS) if (s.parent === id) push(s.id);
  }
  // Anything else the document carried (an unknown part, say) is kept at the end.
  if (d) for (const e of d.sections) push(e.id);
  for (const s of HOME_SECTIONS) push(s.id);
  return { v: LAYOUT_VERSION, sections };
}

// The ids a move works within: the available top-level sections, or one desktop group's.
function movable(order, ctx, group) {
  return order.filter((id) => {
    const s = BY_ID.get(id);
    return s && !s.parent && canSee(s, ctx) && (!group || s.pane === group);
  });
}

/** Move a section to `index` within its list (the available sections, or one group's). */
export function moveTo(doc, id, index, ctx, { group = null } = {}) {
  const order = fullOrder(doc);
  const sub = movable(order, ctx, group);
  const from = sub.indexOf(id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(sub.length - 1, Math.round(index)));
  if (to === from) return doc;
  const next = sub.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  // Slot-preserving: the moved subsequence goes back into the slots it occupied, so an id outside
  // it (unknown, unavailable, or in the other group) never moves.
  const slots = [];
  order.forEach((x, i) => { if (sub.includes(x)) slots.push(i); });
  const out = order.slice();
  slots.forEach((slot, k) => { out[slot] = next[k]; });
  return build(doc, out, null);
}

/** Move a section one place up (dir -1) or down (dir +1) within its list. */
export function move(doc, id, dir, ctx, opts = {}) {
  const sub = movable(fullOrder(doc), ctx, opts.group || null);
  const from = sub.indexOf(id);
  if (from < 0) return doc;
  return moveTo(doc, id, from + (dir < 0 ? -1 : 1), ctx, opts);
}

/** Switch a section (or a part) on or off. A locked section is a no-op. */
export function toggle(doc, id, on, ctx) {
  const s = BY_ID.get(id);
  if (!s || s.locked || !canSee(s, ctx)) return doc;
  return build(doc, fullOrder(doc), [[id, !!on]]);
}

/** Whether the home this viewer sees is the default one (order and every switch). */
export function isDefault(doc, ctx) {
  if (!doc) return true;
  const d = normalise(doc);
  if (!d) return true;
  const m = onMap(d);
  const avail = available(ctx);
  if (avail.some((s) => isOn(m, s.id) !== !s.defaultOff)) return false;
  const order = movable(fullOrder(d), ctx, null);
  const def = avail.filter((s) => !s.parent).map((s) => s.id);
  return order.length === def.length && order.every((id, i) => id === def[i]);
}

/** In this column's rendered order, is the bankroll line immediately above the period block? */
export function bankrollAbovePeriod(columnIds) {
  const ids = Array.isArray(columnIds) ? columnIds : [];
  const i = ids.indexOf('period');
  return i > 0 && ids[i - 1] === 'bankroll';
}

/**
 * The cached copy against the server's, at load:
 *   server undefined (the request failed, or a guest): keep the local copy;
 *   local dirty (a change not yet saved): keep it, and push it;
 *   otherwise: the server's (null is the default home).
 * local = { layout, dirty } | null.
 */
export function reconcile({ local, server }) {
  const mine = local && local.layout !== undefined ? local.layout : null;
  if (server === undefined) return { doc: mine, push: false };
  if (local && local.dirty) return { doc: mine, push: true };
  return { doc: server === null ? null : normalise(server), push: false };
}

/** The localStorage key of a user's cached layout. */
export const cacheKey = (userId) => `homeLayout:u${userId}`;

/**
 * The sheet's rows for this viewer: the top-level sections in their full order, each with its
 * parts. On desktop (grouped) they are split by pane.
 */
export function sheetRows(doc, ctx) {
  const m = onMap(doc ? normalise(doc) : null);
  const top = movable(fullOrder(doc), ctx, null);
  const rows = top.map((id) => {
    const s = BY_ID.get(id);
    const on = isOn(m, id);
    return {
      ...s, on,
      parts: HOME_SECTIONS.filter((p) => p.parent === id && canSee(p, ctx)).map((p) => ({ ...p, on: isOn(m, p.id), enabled: on })),
    };
  });
  return {
    all: rows,
    now: rows.filter((r) => r.pane === 'now'),
    numbers: rows.filter((r) => r.pane === 'numbers'),
  };
}
