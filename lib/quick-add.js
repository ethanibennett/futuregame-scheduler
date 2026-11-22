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
const { buildParseRequest, buildAnswerRequest, buildLineRequest, HAND_TOOL, ANSWER_TOOL, LINE_TOOL, requestShape, describeShape } = require('./quick-add/prompt');
const { addUsage, costUsd } = require('./quick-add/pricing');
const { normalizeDraft, normalizeHand } = require('./quick-add/normalize');
const { applyOps, fastAnswerOps } = require('./quick-add/patch');
const { canonicalGameName } = require('./quick-add/games');
const { cleanText } = require('./quick-add/cards');
const { parseHandHistory } = require('./quick-add/hh');
const { numberWords, looksSpoken } = require('./quick-add/speech');
const DECISIONS = require('./quick-add/decisions');

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
    // Owner decision F: a post that tells several hands, and the player asked for another one.
    if (hints.handIndex != null) {
      const k = Number(hints.handIndex);
      if (!Number.isInteger(k) || k < 1 || k > 8) throw new QuickAddError(400, 'hints.handIndex must be a whole number from 1 to 8.');
      h.handIndex = k;
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

/* A thinking request (prompt.js 'thinking' shape) may run long: it gets its own timeout, above the
   client's 90 s. The forced shape keeps the client's. */
const THINKING_TIMEOUT_MS = 150000;

/**
 * One tool call → { input, usage, meta }. usage adds up every request made; meta says which model served
 * it (a server-side fallback can answer for another), how many requests it took and whether a fallback ran.
 *
 * The forced shape (tool_choice names the tool) is today's: a 400 about forced tools and thinking is
 * retried once with thinking off. The thinking shape (tool_choice auto) cannot be sure of a call, so:
 *   - a reply with no tool call is asked once more, as a continuation (the reply, its thinking blocks
 *     unchanged, then "call the tool"), and is a 502 after that;
 *   - a reply cut off at max_tokens (thinking spends output tokens) is retried once at effort low;
 *   - a refusal is a 422, as before (with fallbacks on, it means every model in the chain declined).
 */
async function callTool(client, request, toolName) {
  const thinking = !!(request.thinking && request.thinking.type === 'adaptive');
  const opts = thinking ? { timeout: THINKING_TIMEOUT_MS } : undefined;
  const create = (req) => (req.betas && client.beta && client.beta.messages
    ? client.beta.messages.create(req, opts)
    : client.messages.create(stripBeta(req), opts));
  let req = request;
  let usage = null, calls = 0, asked = false, lowered = false;
  for (;;) {
    let msg;
    try {
      calls++;
      msg = await create(req);
    } catch (err) {
      // A model that will not take a forced tool alongside its default thinking: retry
      // once with thinking off, which forced tool use never needed anyway.
      if (!thinking && err && err.status === 400 && /tool_choice|thinking/i.test(String(err.message)) && !req.thinking) {
        req = { ...req, thinking: { type: 'disabled' } };
        continue;
      }
      throw mapApiError(err);
    }
    if (msg && msg.usage) usage = addUsage(usage, msg.usage);
    if (!msg || !Array.isArray(msg.content)) throw new QuickAddError(502, 'The parser returned nothing usable.');
    if (msg.stop_reason === 'refusal') throw new QuickAddError(422, 'The parser declined this description.');
    const block = msg.content.find((b) => b && b.type === 'tool_use' && b.name === toolName);
    if (msg.stop_reason === 'max_tokens') {
      const effort = req.output_config && req.output_config.effort;
      if (thinking && !lowered && effort && effort !== 'low') {
        lowered = true;
        req = { ...req, output_config: { ...req.output_config, effort: 'low' } };
        continue;
      }
      throw new QuickAddError(422, 'That hand is too long to record in one go; try describing it in fewer words.');
    }
    if (!block) {
      // (A reply holding some other tool's call cannot be continued without its result: that is the 502.)
      if (thinking && !asked && !msg.content.some((b) => b && b.type === 'tool_use')) {
        asked = true;
        req = { ...req, messages: [...req.messages,
          { role: 'assistant', content: msg.content },
          { role: 'user', content: `Answer with the ${toolName} tool call now, and nothing else.` }] };
        continue;
      }
      throw new QuickAddError(502, 'The parser did not return a hand.');
    }
    if (!isObj(block.input)) throw new QuickAddError(502, 'The parser returned a malformed hand.');
    const fallback = msg.content.some((b) => b && b.type === 'fallback')
      || (msg.usage && Array.isArray(msg.usage.iterations) && msg.usage.iterations.some((it) => it && it.type === 'fallback_message'));
    const tool = (req.tools || []).find((t) => t && t.name === toolName);
    const { input, unwrapped } = unwrapInput(block.input, tool && tool.input_schema);
    return {
      input,
      usage,
      meta: { model: msg.model || req.model, requested: request.model, calls, fallback, ...(lowered ? { effortLowered: true } : {}), ...(unwrapped ? { unwrapped } : {}) },
    };
  }
}

/* A tool call whose arguments came wrapped in one more key (2026-11-21: Opus 5.5 in the thinking shape, about
   one parse in fifteen, sent { "record_hand": { ...the hand } } or { "argument": { ... } }, and the hand
   normalized to nothing): when the top level holds none of the tool's own fields and one key holds an object
   that does, that object is the input. Returns the key it was under as `unwrapped`. */
function unwrapInput(input, schema) {
  const fields = schema && schema.properties ? Object.keys(schema.properties) : [];
  if (!fields.length || !isObj(input) || fields.some((f) => f in input)) return { input };
  const inner = Object.entries(input).filter(([, v]) => isObj(v) && fields.some((f) => f in v));
  if (inner.length !== 1) return { input };
  return { input: inner[0][1], unwrapped: inner[0][0] };
}
// A client with no beta namespace (the tests' stubs, an older SDK) gets the request without the beta's fields.
function stripBeta(req) {
  if (!req.betas && !('fallbacks' in req)) return req;
  const { betas, fallbacks, ...rest } = req; // eslint-disable-line no-unused-vars
  return rest;
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

/* The unread lines of a pasted hand history, read by the model one by one (decision H). Names
   are already replaced; only the lines go. Returns a Map of line id → action or null. */
async function readUnreadLines({ client, hh, model, effort, fallbacks }) {
  const resolved = new Map();
  if (!client || !hh.unread.length) return { resolved, usage: null, meta: null };
  const lines = hh.unread.slice(0, 40);
  const { input, usage, meta } = await callTool(client, buildLineRequest({ lines, model, effort, fallbacks }), LINE_TOOL.name);
  const seatOf = (label) => {
    if (/^hero$/i.test(String(label))) return hh.heroIndex;
    const m = /^Player (\d+)$/i.exec(String(label || ''));
    return m ? hh.playerIndexBySeat(Number(m[1])) : null;
  };
  for (const r of Array.isArray(input.lines) ? input.lines : []) {
    const line = lines[r && r.index];
    if (!line) continue;
    if (r.skip === true || !r.action) { resolved.set(line.id, null); continue; }
    const p = seatOf(r.player);
    if (!Number.isInteger(p)) { resolved.set(line.id, null); continue; }
    const a = { player: p, action: r.action };
    if (typeof r.toAmount === 'number') a.toAmount = r.toAmount;
    if (typeof r.amount === 'number') a.amount = r.amount;
    resolved.set(line.id, a);
  }
  return { resolved, usage, meta };
}

/* What a parse ran on, for logs, the eval and the parse log: the model asked, the one that answered, the
   shape and effort, requests made, and the cost at list price. */
function parseMeta({ model, effort, meta, usage }) {
  const shape = requestShape(model, effort);
  const servedBy = (meta && meta.model) || model;
  const cost = usage ? costUsd(usage, servedBy) : null;
  return {
    model, servedBy, mode: shape.mode, effort: shape.effort,
    calls: meta ? meta.calls : 0, fallback: !!(meta && meta.fallback),
    ...(meta && meta.effortLowered ? { effortLowered: true } : {}),
    ...(meta && meta.unwrapped ? { unwrapped: meta.unwrapped } : {}),
    costUsd: cost == null ? null : Math.round(cost * 1e6) / 1e6,
  };
}

/* The env's switches are the defaults for every caller, so a parse that does not come through the router
   (the Apple Watch's, lib/watch.js) runs on the same model and effort. */
const envParseModel = () => process.env.QUICK_ADD_PARSE_MODEL || DEFAULTS.parseModel;
const envEffort = (k) => process.env[k] || null;
const envFallbacks = () => process.env.QUICK_ADD_FALLBACKS !== '0';

/** text → { hand, notes, usage, meta }. */
async function parseHand({ client, text, source = 'text', hints = {}, model = envParseModel(), effort = envEffort('QUICK_ADD_EFFORT'), fallbacks = envFallbacks(), log = null }) {
  let modelText = text;
  // Owner decision H: a pasted hand history is read in code first. The model reads only the
  // lines the code could not, or the whole history when the game is not one the code reads,
  // and what it is sent has the screen names replaced.
  if (source === 'text') {
    const hh = parseHandHistory(text);
    if (hh && DECISIONS.HAND_HISTORY_FAST_PATH && !hh.unsupported && (hh.game || hints.gameType)) {
      const { resolved, usage, meta } = await readUnreadLines({ client, hh, model, effort, fallbacks });
      const { draft, notes: hhNotes } = hh.build(resolved);
      if (log && log.log) log.log(`[QuickAdd] hand history (${hh.format}) read in code: players=${hh.players} unread=${hh.unread.length} model=${usage ? 'lines' : 'no'}`);
      const { hand, notes: serverNotes } = normalizeDraft(draft, { hints, source });
      const dropped = hh.unread.length && !usage ? [`${hh.unread.length} line${hh.unread.length > 1 ? 's' : ''} of the hand history could not be read and ${hh.unread.length > 1 ? 'were' : 'was'} left out.`] : [];
      return { hand, notes: cleanNotes([...hhNotes, ...dropped, ...serverNotes]), usage, fastPath: hh.format, meta: parseMeta({ model, effort, meta, usage }) };
    }
    if (hh) modelText = hh.anonymised; // names out before anything reaches the API
    // Dictated through the keyboard's mic or the Watch, sent as text: read as the speech it is.
    else if (looksSpoken(text)) {
      source = 'speech';
      if (log && log.log) log.log('[QuickAdd] typed description reads as dictation: parsed as speech');
    }
  }
  // Owner decision I: the number words rewritten in a transcript are logged.
  if (source === 'speech' && DECISIONS.NUMBER_WORDS && log && log.log) {
    const nw = numberWords(text).conversions;
    if (nw.length) log.log(`[QuickAdd] number words: ${nw.slice(0, 30).map((c) => `"${c.from}"=${c.to}`).join(' ')}`);
  }
  const request = buildParseRequest({ text: modelText, source, hints, model, effort, fallbacks });
  const { input, usage, meta } = await callTool(client, request, HAND_TOOL.name);
  // The typed text goes too: the cards as typed are read in code and win over the model's reading (normalize.js).
  const { hand, notes: serverNotes } = normalizeDraft(input, { hints, source, text: modelText });
  const out = { hand, notes: cleanNotes([...(Array.isArray(input.notes) ? input.notes : []), ...serverNotes]), usage, meta: parseMeta({ model, effort, meta, usage }) };
  // A tool call that normalizes to nothing (2026-11-21: Opus 5.5 in the thinking shape, now and then, a
  // long call that left no game, player or action): what it sent, by shape, so the eval's kept parses show it.
  if (!hand.gameType && !(hand.players || []).length && !(hand.streets || []).some((st) => (st.actions || []).length)) {
    out.meta.inputShape = inputShape(input);
  }
  return out;
}

/* The top two levels of a tool input, by key and type, with the start of each string: enough to tell a
   hand wrapped in another key or sent as JSON text from one with nothing in it. */
function inputShape(input, depth = 0) {
  if (input == null || typeof input !== 'object') return typeof input === 'string' ? `string(${input.length}): ${input.slice(0, 120)}` : String(input);
  if (Array.isArray(input)) return `array(${input.length})`;
  const out = {};
  for (const [k, v] of Object.entries(input).slice(0, 40)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && depth < 1 ? inputShape(v, depth + 1)
      : typeof v === 'string' ? `string(${v.length}): ${v.slice(0, 120)}` : Array.isArray(v) ? `array(${v.length})` : v;
  }
  return out;
}

/** One free-text answer to one gap → { hand, applied, notes, usage }. */
async function answerGap({ client, hand, gap, answer, model = process.env.QUICK_ADD_ANSWER_MODEL || DEFAULTS.answerModel, effort = envEffort('QUICK_ADD_ANSWER_EFFORT'), fallbacks = envFallbacks() }) {
  // The hand is normalised first, so the model sees (and the ops index) the same hand
  // the reply is built from.
  const base = normalizeHand(hand).hand;
  let ops = fastAnswerOps(base, gap, answer);
  let usage = null, modelNote = null, understood = true;
  if (!ops) {
    if (!client) throw new QuickAddError(503, 'ANTHROPIC_API_KEY not configured on server');
    const out = await callTool(client, buildAnswerRequest({ hand: base, gap, answer, model, effort, fallbacks }), ANSWER_TOOL.name);
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
 *   getDb()            optional: the database, for the parse log (lib/quick-add/learn.js)
 *   saveDatabase()     optional: persists it
 *
 * The models and their effort come from the environment, read once here (docs/quick-add-model-runs.md):
 *   QUICK_ADD_PARSE_MODEL / QUICK_ADD_ANSWER_MODEL   the models (defaults in DEFAULTS)
 *   QUICK_ADD_EFFORT / QUICK_ADD_ANSWER_EFFORT       low|medium|high|xhigh|max: thinking at that effort
 *                                                    (prompt.js requestShape); unset = today's request
 *   QUICK_ADD_FALLBACKS=0                            no server-side refusal fallback on the new models
 *   QUICK_ADD_LOG=0                                  no parse log
 */
function createQuickAddRouter(opts) {
  const {
    authenticateToken, isAdmin, getClient, getDb = null, saveDatabase = null,
    parseModel = envParseModel(),
    answerModel = process.env.QUICK_ADD_ANSWER_MODEL || DEFAULTS.answerModel,
    parseEffort = envEffort('QUICK_ADD_EFFORT'),
    answerEffort = envEffort('QUICK_ADD_ANSWER_EFFORT'),
    fallbacks = envFallbacks(),
    parseLog = process.env.QUICK_ADD_LOG !== '0',
    limits: limitOverrides = {}, now = Date.now, log = console,
  } = opts || {};
  if (typeof authenticateToken !== 'function' || typeof isAdmin !== 'function' || typeof getClient !== 'function') {
    throw new Error('createQuickAddRouter needs authenticateToken, isAdmin and getClient');
  }
  // Said once at boot, so a flipped env is visible in the logs before the first parse.
  if (log && log.log) log.log(`[QuickAdd] parse: ${describeShape(parseModel, parseEffort)} · answer: ${describeShape(answerModel, answerEffort)}`);
  const learn = getDb && parseLog ? require('./quick-add/learn') : null;
  const record = (entry) => {
    if (!learn) return null;
    const db = getDb();
    if (!db) return null;
    const id = learn.recordParse(db, entry);
    if (saveDatabase) Promise.resolve(saveDatabase()).catch(() => {});
    return id;
  };
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
    let input = null;
    try {
      input = validateParseBody(req.body, limits);
      const client = getClient();
      if (!client) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
      const r = parseLimiter.take(userKey(req));
      if (!r.ok) return limited(res, r);
      const out = await parseHand({ client, ...input, model: parseModel, effort: parseEffort, fallbacks, log });
      const u = out.usage || {};
      const m = out.meta || {};
      const ms = now() - t0;
      log.log(`[QuickAdd] parse user=${req.user.username} source=${input.source} chars=${input.text.length} ms=${ms}` +
        ` in=${u.input_tokens ?? '?'} cached=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens ?? '?'}` +
        ` players=${out.hand.players.length} notes=${out.notes.length}` +
        (m.mode === 'thinking' ? ` effort=${m.effort} calls=${m.calls}${m.fallback ? ` fallback=${m.servedBy}` : ''}` : '') +
        (m.costUsd != null ? ` cost=$${m.costUsd.toFixed(4)}` : ''));
      // The notes say what the parse could not do — the first thing to read when a hand goes badly.
      if (out.notes.length) log.log(`[QuickAdd] parse notes: ${out.notes.join(' | ').slice(0, 1500)}`);
      /* The parse log: the hand carries its row's id (top-level quickAddParseId, which normalizeHand, the
         client's answers and the replayer all keep as an unknown key) so the save routes can pair the
         saved hand with the parse. */
      const parseId = record({ userId: req.user.id, ...input, meta: m, usage: out.usage, ms, hand: out.hand, notes: out.notes, fastPath: out.fastPath });
      const hand = parseId ? { ...out.hand, quickAddParseId: parseId } : out.hand;
      res.json({ hand, notes: out.notes });
    } catch (err) {
      if (input && err instanceof QuickAddError && err.status !== 503) {
        record({ userId: req.user.id, ...input, meta: { model: parseModel, ...requestShape(parseModel, parseEffort) }, ms: now() - t0, status: err.status, error: err.message });
      }
      fail(res, err, 'parse');
    }
  });

  /* The parse log, for Admin (app admins): the newest parses with what the player changed before saving,
     one in full, and the saved ones as draft corpus cases. */
  if (learn) {
    const noStore = (res) => res.set('Cache-Control', 'no-store');
    router.get('/log', authenticateToken, requireAdmin, (req, res) => {
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'No database' });
      noStore(res);
      res.json({ summary: learn.summary(db), parses: learn.listParses(db, { limit: req.query.limit, before: req.query.before, savedOnly: req.query.saved === '1' }) });
    });
    router.get('/log/export', authenticateToken, requireAdmin, (req, res) => {
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'No database' });
      noStore(res);
      res.json(learn.exportCases(db, { limit: req.query.limit }));
    });
    router.get('/log/:id', authenticateToken, requireAdmin, (req, res) => {
      const db = getDb();
      const id = Number(req.params.id);
      if (!db || !Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
      const [row] = learn.listParses(db, { limit: 1, before: id + 1, full: true }).filter((r) => r.id === id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      noStore(res);
      res.json(row);
    });
  }

  router.post('/answer', authenticateToken, requireAdmin, async (req, res) => {
    const t0 = now();
    try {
      const input = validateAnswerBody(req.body, limits);
      const r = answerLimiter.take(userKey(req));
      if (!r.ok) return limited(res, r);
      const out = await answerGap({ client: getClient(), ...input, model: answerModel, effort: answerEffort, fallbacks });
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
