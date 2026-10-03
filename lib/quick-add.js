// Quick-add hand histories, part B: the server endpoints that turn a description into a
// replayer hand. Design: docs/quick-add-hands.md. Contract: docs/quick-add-contract.md.
//
//   POST /api/quick-add/parse   { text, source: 'text'|'speech', hints?: { gameType?, heroName? } }
//     -> { hand, notes }
//   POST /api/quick-add/answer  { hand, gap, answer }
//     -> { hand, applied, notes }
//
// Admins only (every parse is a paid API call), rate-limited per user, and 503 without
// ANTHROPIC_API_KEY. The Anthropic client is injected (getClient) so tests run on stubs.
//
// Pieces: quick-add/prompt.js (tools + prompts), quick-add/normalize.js (draft → hand,
// deterministic), quick-add/patch.js (answers), quick-add/games.js, quick-add/cards.js.
'use strict';

const express = require('express');
const { buildParseRequest, buildAnswerRequest, HAND_TOOL, ANSWER_TOOL } = require('./quick-add/prompt');
const { normalizeDraft, normalizeHand } = require('./quick-add/normalize');
const { applyOps, fastAnswerOps } = require('./quick-add/patch');
const { canonicalGameName } = require('./quick-add/games');
const { cleanText } = require('./quick-add/cards');

const DEFAULTS = {
  parseModel: 'claude-sonnet-5',
  answerModel: 'claude-haiku-4-5-20251001',
  parsePerHour: 30,
  answersPerHour: 150,
  maxTextChars: 6000,
  maxHandBytes: 64 * 1024,
  maxAnswerChars: 1000,
};

class QuickAddError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || null; }
}

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/* ── Input validation ──────────────────────────────────────────────────────── */

function validateParseBody(body, limits = DEFAULTS) {
  if (!isObj(body)) throw new QuickAddError(400, 'Send JSON: { text, source }.');
  const { text, source = 'text', hints } = body;
  if (typeof text !== 'string' || !text.trim()) throw new QuickAddError(400, 'Describe the hand in text.');
  if (text.length > limits.maxTextChars) {
    throw new QuickAddError(413, `That description is too long (${text.length} characters; the limit is ${limits.maxTextChars}).`);
  }
  if (source !== 'text' && source !== 'speech') throw new QuickAddError(400, "source must be 'text' or 'speech'.");
  let h = {};
  if (hints != null) {
    if (!isObj(hints)) throw new QuickAddError(400, 'hints must be an object.');
    if (hints.gameType != null) {
      const g = canonicalGameName(hints.gameType);
      if (!g) throw new QuickAddError(400, `Unknown game in hints: ${cleanText(hints.gameType, 40)}.`);
      h.gameType = g;
    }
    if (hints.heroName != null) {
      const n = cleanText(hints.heroName, 40);
      if (n) h.heroName = n;
    }
  }
  // Control characters are dropped; newlines and tabs are kept for pasted hand histories.
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return { text: clean, source, hints: h };
}

function validateAnswerBody(body, limits = DEFAULTS) {
  if (!isObj(body)) throw new QuickAddError(400, 'Send JSON: { hand, gap, answer }.');
  const { hand, gap, answer } = body;
  if (!isObj(hand) || !Array.isArray(hand.players) || !Array.isArray(hand.streets)) {
    throw new QuickAddError(400, 'hand must be a hand object with players and streets.');
  }
  if (hand.players.length > 10 || hand.streets.length > 9) throw new QuickAddError(400, 'hand has too many players or streets.');
  const size = Buffer.byteLength(JSON.stringify(hand), 'utf8');
  if (size > limits.maxHandBytes) throw new QuickAddError(413, 'hand is too large.');
  if (hand.gameType != null && hand.gameType !== '' && !canonicalGameName(hand.gameType)) {
    throw new QuickAddError(400, `Quick add does not handle ${cleanText(hand.gameType, 40)} hands.`);
  }
  if (!isObj(gap) || typeof gap.question !== 'string') throw new QuickAddError(400, 'gap must be the gap object being answered.');
  const g = {
    id: cleanText(gap.id, 80),
    kind: cleanText(gap.kind, 20),
    field: typeof gap.field === 'string' ? gap.field.slice(0, 80) : null,
    question: cleanText(gap.question, 300),
    ...(Array.isArray(gap.options) ? { options: gap.options.slice(0, 8).filter(isObj).map((o) => ({ label: cleanText(o.label, 80), value: o.value })) } : {}),
  };
  if (JSON.stringify(g).length > 4000) throw new QuickAddError(413, 'gap is too large.');
  if (typeof answer !== 'string' || !answer.trim()) throw new QuickAddError(400, 'answer must be the player\'s reply, as text.');
  if (answer.length > limits.maxAnswerChars) throw new QuickAddError(413, 'That answer is too long.');
  return { hand, gap: g, answer: answer.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() };
}

/* ── Rate limiting ─────────────────────────────────────────────────────────── */

/* Sliding window, in memory, per key. Enough for a handful of admins on one process;
   a restart forgives everyone, which is fine for a cost guard. */
function createRateLimiter({ limit, windowMs = 60 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (list.length >= limit) {
        hits.set(key, list);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true, remaining: limit - list.length };
    },
    reset() { hits.clear(); },
  };
}

/* ── Model calls ───────────────────────────────────────────────────────────── */

async function callTool(client, request, toolName) {
  let msg;
  try {
    msg = await client.messages.create(request);
  } catch (err) {
    // A model that will not take a forced tool alongside its default thinking: retry
    // once with thinking off, which forced tool use never needed anyway.
    if (err && err.status === 400 && /tool_choice|thinking/i.test(String(err.message)) && !request.thinking) {
      return callTool(client, { ...request, thinking: { type: 'disabled' } }, toolName);
    }
    throw mapApiError(err);
  }
  if (!msg || !Array.isArray(msg.content)) throw new QuickAddError(502, 'The parser returned nothing usable.');
  if (msg.stop_reason === 'refusal') throw new QuickAddError(422, 'The parser declined this description.');
  const block = msg.content.find((b) => b && b.type === 'tool_use' && b.name === toolName);
  if (!block) {
    if (msg.stop_reason === 'max_tokens') throw new QuickAddError(422, 'That hand is too long to record in one go; try describing it in fewer words.');
    throw new QuickAddError(502, 'The parser did not return a hand.');
  }
  if (msg.stop_reason === 'max_tokens') throw new QuickAddError(422, 'That hand is too long to record in one go; try describing it in fewer words.');
  if (!isObj(block.input)) throw new QuickAddError(502, 'The parser returned a malformed hand.');
  return { input: block.input, usage: msg.usage || null };
}

function mapApiError(err) {
  if (err instanceof QuickAddError) return err;
  const status = err && err.status;
  const detail = err && err.message ? String(err.message).slice(0, 200) : 'unknown error';
  if (status === 429 || status === 529) return new QuickAddError(503, 'The parser is busy; try again in a minute.');
  if (status === 401 || status === 403) return new QuickAddError(503, 'The parser is not configured correctly on the server.');
  if (status === 400 || status === 404 || status === 413) return new QuickAddError(502, `The parser rejected the request (${detail}).`);
  if (typeof status === 'number') return new QuickAddError(502, `The parser failed (${status}).`);
  return new QuickAddError(504, 'Could not reach the parser; try again.');
}

function cleanNotes(list) {
  const out = [];
  for (const n of Array.isArray(list) ? list : []) {
    const s = cleanText(n, 300);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 16);
}

/* ── Service ───────────────────────────────────────────────────────────────── */

/** text → { hand, notes, usage }. */
async function parseHand({ client, text, source = 'text', hints = {}, model = DEFAULTS.parseModel }) {
  const request = buildParseRequest({ text, source, hints, model });
  const { input, usage } = await callTool(client, request, HAND_TOOL.name);
  const { hand, notes: serverNotes } = normalizeDraft(input, { hints });
  return { hand, notes: cleanNotes([...(Array.isArray(input.notes) ? input.notes : []), ...serverNotes]), usage };
}

/** One free-text answer to one gap → { hand, applied, notes, usage }. */
async function answerGap({ client, hand, gap, answer, model = DEFAULTS.answerModel }) {
  // The hand is normalised first, so the model sees (and the ops index) the same hand
  // the reply is built from.
  const base = normalizeHand(hand).hand;
  let ops = fastAnswerOps(base, gap, answer);
  let usage = null, modelNote = null, understood = true;
  if (!ops) {
    if (!client) throw new QuickAddError(503, 'ANTHROPIC_API_KEY not configured on server');
    const out = await callTool(client, buildAnswerRequest({ hand: base, gap, answer, model }), ANSWER_TOOL.name);
    usage = out.usage;
    understood = out.input.understood !== false;
    ops = understood && Array.isArray(out.input.ops) ? out.input.ops : [];
    modelNote = cleanText(out.input.note, 300);
  }
  const { hand: patched, applied, rejected } = applyOps(base, ops);
  const { hand: result, notes } = normalizeHand(patched);
  const extra = [];
  if (!understood) extra.push('That answer did not answer the question, so nothing changed.');
  if (rejected.length) extra.push('Part of the answer could not be applied.');
  if (modelNote) extra.push(modelNote);
  return { hand: result, applied: applied > 0, notes: cleanNotes([...extra, ...notes]), usage };
}

/* ── Router ────────────────────────────────────────────────────────────────── */

/**
 * createQuickAddRouter({ authenticateToken, isAdmin, getClient, ... }) -> express.Router
 *   authenticateToken  the app's JWT middleware (sets req.user)
 *   isAdmin(user)      the admin gate
 *   getClient()        an Anthropic client, or null when no API key is configured
 */
function createQuickAddRouter(opts) {
  const {
    authenticateToken, isAdmin, getClient,
    parseModel = process.env.QUICK_ADD_PARSE_MODEL || DEFAULTS.parseModel,
    answerModel = process.env.QUICK_ADD_ANSWER_MODEL || DEFAULTS.answerModel,
    limits: limitOverrides = {}, now = Date.now, log = console,
  } = opts || {};
  if (typeof authenticateToken !== 'function' || typeof isAdmin !== 'function' || typeof getClient !== 'function') {
    throw new Error('createQuickAddRouter needs authenticateToken, isAdmin and getClient');
  }
  const limits = { ...DEFAULTS, ...limitOverrides };
  const parseLimiter = createRateLimiter({ limit: limits.parsePerHour, now });
  const answerLimiter = createRateLimiter({ limit: limits.answersPerHour, now });
  const router = express.Router();

  const requireAdmin = (req, res, next) => {
    if (!req.user || !isAdmin(req.user)) return res.status(403).json({ error: 'Quick add is for admins for now.' });
    next();
  };
  const userKey = (req) => String(req.user.id != null ? req.user.id : req.user.username);
  const limited = (res, r) => {
    res.set('Retry-After', String(r.retryAfterSec));
    return res.status(429).json({ error: `Too many quick adds; try again in ${Math.ceil(r.retryAfterSec / 60)} min.`, retryAfterSec: r.retryAfterSec });
  };
  const fail = (res, err, tag) => {
    const e = err instanceof QuickAddError ? err : new QuickAddError(500, 'Quick add failed.');
    if (!(err instanceof QuickAddError) || e.status >= 500) log.error(`[QuickAdd] ${tag} ${e.status}: ${err && err.message}`);
    return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  };

  router.post('/parse', authenticateToken, requireAdmin, async (req, res) => {
    const t0 = now();
    try {
      const input = validateParseBody(req.body, limits);
      const client = getClient();
      if (!client) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
      const r = parseLimiter.take(userKey(req));
      if (!r.ok) return limited(res, r);
      const out = await parseHand({ client, ...input, model: parseModel });
      const u = out.usage || {};
      log.log(`[QuickAdd] parse user=${req.user.username} source=${input.source} chars=${input.text.length} ms=${now() - t0}` +
        ` in=${u.input_tokens ?? '?'} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? '?'}` +
        ` players=${out.hand.players.length} notes=${out.notes.length}`);
      // The notes say what the parse could not do — the first thing to read when a hand goes badly.
      if (out.notes.length) log.log(`[QuickAdd] parse notes: ${out.notes.join(' | ').slice(0, 1500)}`);
      res.json({ hand: out.hand, notes: out.notes });
    } catch (err) {
      fail(res, err, 'parse');
    }
  });

  router.post('/answer', authenticateToken, requireAdmin, async (req, res) => {
    const t0 = now();
    try {
      const input = validateAnswerBody(req.body, limits);
      const r = answerLimiter.take(userKey(req));
      if (!r.ok) return limited(res, r);
      const out = await answerGap({ client: getClient(), ...input, model: answerModel });
      log.log(`[QuickAdd] answer user=${req.user.username} gap=${input.gap.id || input.gap.field || '?'} applied=${out.applied}` +
        ` model=${out.usage ? 'yes' : 'no'} ms=${now() - t0}`);
      res.json({ hand: out.hand, applied: out.applied, notes: out.notes });
    } catch (err) {
      fail(res, err, 'answer');
    }
  });

  // Malformed JSON bodies reach here as a body-parser error: answer in JSON, not HTML.
  router.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'Send a JSON body.' });
    }
    next(err);
  });
  return router;
}

module.exports = {
  createQuickAddRouter, parseHand, answerGap, validateParseBody, validateAnswerBody,
  createRateLimiter, callTool, mapApiError, QuickAddError, DEFAULTS,
  normalizeDraft, normalizeHand, applyOps, fastAnswerOps,
};
