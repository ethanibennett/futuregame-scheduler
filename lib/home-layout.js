'use strict';
/*
 * Edit home: the shape check for a user's home layout (users.home_layout, behind
 * GET / PUT /api/user/home-layout). The document belongs to the client
 * (vite-app/src/utils/home-layout.js): which Dashboard sections show and in what
 * order. The server checks its SHAPE only and never its ids, so a section added
 * to the app later needs no change here, and a layout saved by a newer build is
 * stored whole by an older server.
 *
 *   { v: 1, sections: [{ id, on }, ... 1..32], updatedAt }
 *
 * id matches /^[a-z][a-z0-9-]{0,23}$/ and is unique; on is a boolean; any other
 * key on an entry or on the document is stripped; the stored JSON is at most
 * 2048 bytes. updatedAt is stamped by the route, not taken from the client.
 * null is a valid layout: the default home (Reset to default).
 */

const ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const MAX_SECTIONS = 32;
const MAX_BYTES = 2048;

const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x)
  && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);

/**
 * validateHomeLayout(x, { now }) -> { ok: true, layout: object | null } | { ok: false }
 * `now` (an ISO string) is stamped as updatedAt on a non-null layout.
 */
function validateHomeLayout(x, { now = new Date().toISOString() } = {}) {
  if (x === null) return { ok: true, layout: null };
  if (!isPlain(x) || x.v !== 1 || !Array.isArray(x.sections)) return { ok: false };
  if (x.sections.length < 1 || x.sections.length > MAX_SECTIONS) return { ok: false };
  const seen = new Set();
  const sections = [];
  for (const e of x.sections) {
    if (!isPlain(e) || typeof e.id !== 'string' || !ID_RE.test(e.id) || typeof e.on !== 'boolean') return { ok: false };
    if (seen.has(e.id)) return { ok: false };
    seen.add(e.id);
    sections.push({ id: e.id, on: e.on });
  }
  const layout = { v: 1, sections, updatedAt: now };
  if (Buffer.byteLength(JSON.stringify(layout), 'utf8') > MAX_BYTES) return { ok: false };
  return { ok: true, layout };
}

/** The stored column back as a document, or null (absent, or junk that predates a rule). */
function parseStoredHomeLayout(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!isPlain(parsed) || parsed.v !== 1 || !Array.isArray(parsed.sections)) return null;
  return parsed;
}

module.exports = { validateHomeLayout, parseStoredHomeLayout, ID_RE, MAX_SECTIONS, MAX_BYTES };
