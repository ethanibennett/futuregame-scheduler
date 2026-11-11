/**
 * Write a hand with no signal (Features 46, 2026-11-11): the saved list is kept on this device, and a save
 * the network refused goes to an outbox that uploads by itself when requests succeed again. A failed upload
 * stays in the outbox. Each entry carries a client id the server matches, so a retry never makes a double.
 * localStorage, which survives an app update: hands are small, and the outbox holds at most 40.
 */
const LIST = 'handsCopy';
const BOX = 'handOutbox';

const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export function keepListCopy(rows) {
  if (!Array.isArray(rows)) return;
  // The newest 150 rows: enough to read on a break, small enough for the device's storage.
  write(LIST, { at: Date.now(), rows: rows.slice(0, 150) });
}
export function listCopy() { return read(LIST, null); }

export function outbox() { return read(BOX, []); }

export function addToOutbox(payload, handId = null) {
  const box = outbox();
  const clientId = (payload.handData && payload.handData.clientId) || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const entry = { clientId, handId, payload: { ...payload, handData: { ...payload.handData, clientId } }, at: Date.now() };
  const next = [...box.filter((e) => e.clientId !== clientId && !(handId && e.handId === handId)), entry].slice(-40);
  write(BOX, next);
  return entry;
}

/** Sends what is waiting. Resolves to { sent, left }. */
export async function flushOutbox(apiUrl, token) {
  const box = outbox();
  if (!box.length || !token) return { sent: 0, left: box.length };
  const left = [];
  let sent = 0;
  for (const e of box) {
    try {
      const r = await fetch(e.handId ? `${apiUrl}/replayer/hands/${e.handId}` : `${apiUrl}/replayer/hands`, {
        method: e.handId ? 'PUT' : 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(e.payload),
      });
      if (r.ok) sent += 1; else left.push(e);
    } catch { left.push(e); }
  }
  write(BOX, left);
  return { sent, left: left.length };
}
