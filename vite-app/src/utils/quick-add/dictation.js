/* Quick add's dictation (owner, 2026-11-19: "make the shorthand and voice add more robust"): the pure
   half of QuickAddView's useDictation, so it can be tested without a recogniser.

   Web Speech hands over a list of results per event. The text of one listening session is rebuilt
   from the WHOLE list every time, never appended to: iOS Safari's continuous mode sends results
   again, and some versions send each final result as the whole transcript so far, which appending
   wrote twice ("I raise I raise to 15"). */

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const words = (s) => (norm(s) ? norm(s).split(' ').length : 0);

/** [{ transcript, isFinal }] → { final, interim } for one listening session. */
export function sessionTranscript(results) {
  const finals = [];
  const interim = [];
  for (const r of results || []) {
    const t = norm(r && r.transcript);
    if (!t) continue;
    if (r.isFinal) finals.push(t); else interim.push(t);
  }
  const kept = [];
  for (const t of finals) {
    const prev = kept[kept.length - 1];
    const lo = t.toLowerCase();
    if (prev && words(prev) >= 3 && lo.startsWith(prev.toLowerCase())) { kept[kept.length - 1] = t; continue; } // cumulative
    if (prev && lo === prev.toLowerCase()) continue; // sent twice
    kept.push(t);
  }
  let mid = interim.join(' ');
  const fin = kept.join(' ');
  // An interim that repeats what is already final adds nothing.
  if (mid && fin && fin.toLowerCase().endsWith(mid.toLowerCase())) mid = '';
  return { final: fin, interim: mid };
}

/** The description with a session's words after it, one space between. */
export function joinText(base, add) {
  const a = String(base || '');
  const b = norm(add);
  if (!b) return a;
  if (!a.trim()) return b;
  return (/\s$/.test(a) ? a : a + ' ') + b;
}

/* What each recogniser error means for the person holding the phone, and whether listening goes on.
   'no-speech' (a pause) and 'aborted' (our own stop) are not failures: a pause restarts listening. */
export function dictationError(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { stop: true, kind: 'denied', message: 'The microphone is off for futurega.me. Allow it in Settings, or tap the mic on your keyboard.' };
    case 'audio-capture':
      return { stop: true, kind: 'error', message: 'No microphone was found. Tap the mic on your keyboard instead.' };
    case 'network':
      return { stop: true, kind: 'error', message: 'Speech needs a connection. What you said so far is kept.' };
    case 'language-not-supported':
      return { stop: true, kind: 'error', message: 'Speech is not available in this language here. Tap the mic on your keyboard instead.' };
    case 'no-speech':
    case 'aborted':
      return { stop: false, kind: null, message: null };
    default:
      return { stop: true, kind: 'error', message: 'Listening stopped. What you said so far is kept: tap Speak to go on.' };
  }
}

// A pause ends a session on its own; listening resumes until Stop, within these limits.
export const MAX_RESTARTS = 30;
export const MAX_LISTEN_MS = 10 * 60 * 1000;
