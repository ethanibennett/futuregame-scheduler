/* A hand link's hand, asked for until the server answers (2026-11-27). The in-app link check opened a good link in
 * the iPhone app while futurega.me was being redeployed, and the page said "This hand link doesn't open": ANY failed
 * request read as a dead link, so everyone who opened a link during a deploy, or on a bad connection, was told the
 * hand was gone. Now only an answer that the hand is not there (404, 410, 400, or a body with no hand) is "gone"; no
 * answer, a timeout, a 429 or a 5xx is asked again, after 1, 2, 4 and 8 s, and only then "down" (the page says the
 * site did not answer, with Try again, never that the link is dead). */

export const RETRY_AFTER_MS = [1000, 2000, 4000, 8000];

const transient = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

/* { kind: 'ok', data } | { kind: 'gone' } | { kind: 'down' } */
export async function fetchHandLink(url, init, { fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), delays = RETRY_AFTER_MS } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    try {
      const r = await fetchImpl(url, init);
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
    }
    if (attempt >= delays.length) return { kind: 'down' };
    await wait(delays[attempt]);
  }
}
