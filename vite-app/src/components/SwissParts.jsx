import React from 'react';

/*
 * Markup hooks for the Swiss theme (theme-swiss.css). Each renders exactly what the app showed
 * before in every other theme; the extra spans only take a style under data-theme="swiss-*".
 */

/** A money figure split into its sign, its currency mark and the number, so the Swiss theme can
 *  set the mark small and raised (catalogue item 19). "+$10,628" -> + | $ | 10,628. */
export function MoneyParts({ text }) {
  const s = String(text ?? '');
  const m = s.match(/^([+\-−]?)([^\d\s.,]*)(.*)$/);
  if (!m || !m[2]) return s;
  return (
    <>
      {m[1] && <span className="m-sign">{m[1]}</span>}
      <span className="m-cur">{m[2]}</span>
      {m[3]}
    </>
  );
}

const ACRONYM = /^(WSOP|WSOPC|WSOPE|WPT|MGM|TCH|IPO|NLH|PLO|LV|AC|RW|HS|GN|WPTDS|MSPT|RGPS|DSE)$/;

/** A venue strip's capitals in sentence case (catalogue item 11): BORGATA -> Borgata,
 *  HARRAH S -> Harrah’s; acronyms (WSOP, WPT, MGM) stay as they are. */
export function stripSentence(s) {
  const words = String(s || '').trim().split(/\s+/);
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w === 'S' && out.length) { out[out.length - 1] += '’s'; continue; }
    if (ACRONYM.test(w) || !/[AEIOUaeiou]/.test(w)) { out.push(w); continue; }
    out.push(w.charAt(0) + w.slice(1).toLowerCase());
  }
  return out.join(' ');
}

/** The strip's label: the capitals for every theme, the sentence-case twin for Swiss. */
export function StripLabel({ text }) {
  return (
    <>
      <span className="venue-strip-abbr">{text}</span>
      <span className="venue-strip-sc">{stripSentence(text)}</span>
    </>
  );
}
