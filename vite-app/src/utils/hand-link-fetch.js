/* A hand link's hand, asked for until the server answers (2026-11-27). The in-app link check opened a good link in
 * the iPhone app while futurega.me was being redeployed, and the page said "This hand link doesn't open": ANY failed
 * request read as a dead link, so everyone who opened a link during a deploy, or on a bad connection, was told the
 * hand was gone. Now only an answer that the hand is not there (404, 410, 400, or a body with no hand) is "gone"; no
 * answer, a 429 or a 5xx is asked again, and only after about two minutes is it "down" (the page says the site did
 * not answer, with Try again, never that the link is dead). Two minutes because a deploy takes futurega.me down for
 * longer than the first 15 s this waited (measured by the Mac's in-app link check, a deploy refused every request for
 * over 15 s: Render cannot run two copies of a service with a disk side by side). After the first two refusals
 * `onWait` is told, so the page can say the site is restarting instead of showing nothing. */

export const RETRY_AFTER_MS = [1000, 2000, 3000, 5000, 8000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000];

const transient = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

/* { kind: 'ok', data } | { kind: 'gone' } | { kind: 'down' } */
export async function fetchHandLink(url, init, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), delays = RETRY_AFTER_MS, onWait = null, timeoutMs = 12000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    // A request held open with no answer (a server going down mid-request) is given up after 12 s and asked again.
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(url, ac ? { ...init, signal: ac.signal } : init);
      status = r.status;
      if (r.ok) {
        const data = await r.json().catch(() => undefined);
        if (data && data.shorthand) return { kind: 'ok', data };
        // A body that is not JSON (a captive portal's page, a proxy's) is no answer from us; JSON without a hand is.
        if (data !== undefined) return { kind: 'gone' };
      } else if (!transient(status)) {
        return { kind: 'gone' };
      }
    } catch {
      status = 0;   // no answer at all
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (attempt >= delays.length) return { kind: 'down' };
    if (onWait && attempt >= 1) { try { onWait(attempt); } catch { /* the page's own business */ } }
    await wait(delays[attempt]);
  }
}
