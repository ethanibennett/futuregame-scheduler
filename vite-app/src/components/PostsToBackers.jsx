import React, { useEffect, useState } from 'react';
import { API_URL } from '../utils/api.js';
import { toQueryString } from '../utils/standing-ui.js';

/**
 * "Posts to backers: +$248 (20%), +$124 (10%)" under a result form, for figures NOT saved yet
 * (docs/bankroll-merge.md §6.5 Preview; Phase 8). The owner sees the cut before it goes out; the
 * server computes it (GET /api/staking/standing/preview, lib/staking/live.js previewUnsaved) from
 * the query the form builds (utils/standing-ui.js tournamentPreviewQuery / cashPreviewQuery).
 * Nothing posts here: a share is recorded only by the Notify tap on the SAVED result. Anyone but
 * the owner gets a 403 and sees nothing; a query of null (no cash-out yet) draws nothing.
 * One line of the Backers block's wrapped text (.bn-text), 3r a line.
 */
export default function PostsToBackers({ token, query }) {
  const [line, setLine] = useState(null);
  const qs = query ? toQueryString(query) : '';
  useEffect(() => {
    if (!token || !qs) { setLine(null); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/staking/standing/preview?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        if (live) setLine(res.status === 200 && data && data.backers && data.backers.length ? data.line : null);
      } catch (_) { if (live) setLine(null); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [token, qs]);
  if (!line) return null;
  return <p className="bn-text sd-posts" aria-live="polite">{line}. Nothing posts until you tap Notify on the saved result.</p>;
}
