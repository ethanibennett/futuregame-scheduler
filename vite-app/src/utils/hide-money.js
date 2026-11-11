/**
 * Hide money (Features 44, 2026-11-11): one switch, kept on this device, that shows every result, balance,
 * profit and return as "$•••" or "•••%" until a figure is pressed and held, which shows it for 3 seconds.
 *
 * Money is formatted in dozens of places, so rather than trust every formatter to know the switch, the
 * mask works on what is drawn: inside a money zone (any element marked data-money-zone: the Bankroll tab,
 * Staking, Cash, Home's result and period blocks), every text node that reads as an amount ("+$1,234",
 * "−€320", "$1.2k") or a percentage is rewritten, and rewritten again whenever React changes it. Event
 * buy-ins outside those zones (the Schedule, My Schedule) are public prices and stay. A figure drawn as a
 * bare number after a separate currency mark ("$" in its own span) is caught by its neighbour.
 *
 * Face, size and colour are untouched: only the characters change.
 */

const KEY = 'hideMoney';
const ZONE = '[data-money-zone]';
const CUR = '[$€£¥]';
const MONEY_RE = new RegExp(`[+\\-−]?\\s?(?:[A-Z]{1,3})?${CUR}\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kKmM]?`, 'g');
const PCT_RE = /[+\-−]?\d[\d,]*(?:\.\d+)?\s?%/g;
const BARE_RE = /^\s*[+\-−]?\d[\d,]*(?:\.\d+)?[kKmM]?\s*$/;

export function moneyHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function maskMoneyText(text) {
  return String(text).replace(MONEY_RE, '$•••').replace(PCT_RE, '•••%');
}

const masked = new Set();
const originals = new WeakMap();
const revealing = new WeakSet();
let observer = null;

function zoneOf(node) {
  const el = node && (node.nodeType === 3 ? node.parentElement : node);
  return el && el.closest ? el.closest(ZONE) : null;
}

function prevText(n) {
  if (n.previousSibling) return n.previousSibling.textContent || '';
  const p = n.parentElement;
  return p && p.previousSibling ? (p.previousSibling.textContent || '') : '';
}

function maskNode(n) {
  if (!n || n.nodeType !== 3 || revealing.has(n)) return;
  const v = n.nodeValue;
  if (!v || !/\d/.test(v)) return;
  let m = maskMoneyText(v);
  if (m === v && BARE_RE.test(v) && new RegExp(`${CUR}\\s*$`).test(prevText(n))) m = '•••';
  if (m !== v) {
    originals.set(n, v);
    masked.add(n);
    n.nodeValue = m;
  }
}

function walk(root) {
  if (!root) return;
  const zones = root.nodeType === 1 && root.matches && root.matches(ZONE) ? [root]
    : (root.querySelectorAll ? [...root.querySelectorAll(ZONE)] : []);
  if (!zones.length && zoneOf(root)) zones.push(root);
  for (const z of zones) {
    const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) maskNode(t);
  }
}

function start() {
  document.documentElement.setAttribute('data-hide-money', '');
  walk(document.body);
  if (observer) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') {
        if (zoneOf(m.target)) maskNode(m.target);
      } else {
        for (const n of m.addedNodes) {
          if (n.nodeType === 3) { if (zoneOf(n)) maskNode(n); }
          else if (n.nodeType === 1) walk(n);
        }
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

function stop() {
  document.documentElement.removeAttribute('data-hide-money');
  if (observer) { observer.disconnect(); observer = null; }
  for (const n of masked) {
    if (n.isConnected && originals.has(n)) n.nodeValue = originals.get(n);
  }
  masked.clear();
}

export function applyMoneyMask() {
  if (typeof document === 'undefined') return;
  if (moneyHidden()) start(); else stop();
}

export function setMoneyHidden(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private window */ }
  applyMoneyMask();
}

/** Press and hold a figure: the masked text under the pressed element shows for 3 seconds. */
export function installRevealOnHold() {
  if (typeof document === 'undefined' || installRevealOnHold.done) return;
  installRevealOnHold.done = true;
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  document.addEventListener('pointerdown', (e) => {
    if (!observer) return;
    const el = e.target && e.target.closest ? e.target : null;
    if (!el || !zoneOf(el)) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const shown = [];
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        if (masked.has(t) && originals.has(t)) { revealing.add(t); t.nodeValue = originals.get(t); shown.push(t); }
      }
      if (!shown.length) return;
      setTimeout(() => {
        for (const t of shown) { revealing.delete(t); if (observer) maskNode(t); }
      }, 3000);
    }, 450);
  }, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('pointermove', (e) => { if (timer && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) cancel(); }, true);
}
