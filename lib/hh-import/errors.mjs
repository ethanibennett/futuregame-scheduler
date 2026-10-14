// ── Hand-history import: one error type for every refusal ─────────────────────
// code: 'unknown-format' | 'needs-sample' | 'malformed' | 'unsupported-feature' |
//       'unsupported-game' | 'unsupported-currency' | 'seating' | 'inconsistent' | any
//       HandExportError code the consistency replay raises (bad-amount, out-of-turn, …).
// detail: free-form (the offending line, the construct, …).

export class HandHistoryError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'HandHistoryError';
    this.code = code;
    this.detail = detail == null ? null : detail;
  }
}
