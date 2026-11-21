// Quick add: what a model call cost, from the usage the API returned. For the eval's cost per case and the
// parse log; nothing is billed from these figures.
//
// List prices in US dollars per million tokens (first-party API, 2026-11, the claude-api skill's model
// table): input, output, and a cache read. A cache write (5-minute) is 1.25x input. Output tokens include
// thinking. Check https://platform.claude.com/docs/en/about-claude/pricing before budgeting on them.
'use strict';

const PRICES = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.20 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.50 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.50 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.10 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.20 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30 },
  // Haiku 5.5's rates hold for prompts of 100K tokens or fewer, which every quick-add prompt is.
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.10 },
};
const CACHE_WRITE = 1.25;

/** The price row for a model id ("claude-haiku-4-5-20251001" and "anthropic.claude-…" included), or null. */
function priceFor(model) {
  const m = String(model || '').trim().replace(/^anthropic\./, '').replace(/-\d{8}$/, '');
  return PRICES[m] || null;
}

/** Dollars for one usage object (or the sum of several), at a model's list price; null when unknown. */
function costUsd(usage, model) {
  const p = priceFor(model);
  if (!p || !usage) return null;
  const n = (k) => (Number.isFinite(usage[k]) ? usage[k] : 0);
  return (n('input_tokens') * p.input + n('cache_creation_input_tokens') * p.input * CACHE_WRITE
    + n('cache_read_input_tokens') * p.cacheRead + n('output_tokens') * p.output) / 1e6;
}

/** Usage objects added up, field by field (the four the cost reads). */
function addUsage(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return a;
  const out = { ...a };
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    out[k] = (Number(a[k]) || 0) + (Number(b[k]) || 0);
  }
  return out;
}

module.exports = { PRICES, priceFor, costUsd, addUsage };
