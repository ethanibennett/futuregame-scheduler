// ── The games each Study tool covers, as tags on its row (UX pick 72) ───────
// The Study list named its games only in prose, in three rows of seven, so "what works for Badugi"
// could not be scanned for. Each row carries the tags of the games its tool takes, from the tool's own
// list (the drill's DRILL_GAMES, the trainers' and Price a draw's game pills), less any game this
// server has no blueprint for (GET /api/solver/availability, the same filter the tools apply). Quick
// spots and Watch the solver list the server's trained games when they open, so they carry none here.
import { DRILL_GAMES } from './replayer-drill.js';

const GAME = {
  razz: { label: 'Razz', gameType: 'Razz' },
  stud8: { label: 'Stud 8', gameType: 'Stud 8' },
  td27: { label: '2-7 TD', gameType: '2-7 TD' },
  a5td: { label: 'A-5 TD', gameType: 'A-5 TD' },
  badugi: { label: 'Badugi', gameType: 'Badugi' },
};

// tool id -> [game id, the availability key that game is offered under]
const TOOL_GAMES = {
  play: DRILL_GAMES.map((g) => [g.id, g.id]),
  hands: ['razz', 'stud8', 'td27', 'badugi', 'a5td'].map((g) => [g, g]),
  'three-way': [['razz', 'razz3']],
  solve: [['razz', 'razz'], ['stud8', 'stud8']],
  draw: [['td27', 'td27'], ['a5td', 'a5td'], ['badugi', 'badugi']],
  ranges: [['td27', 'td27']],
};

/** The tags for a Study tool: [{ id, label, gameType }], the games this server offers it in. */
export function studyTags(toolId, avail) {
  return (TOOL_GAMES[toolId] || [])
    .filter(([, key]) => !avail || avail[key] !== false)
    .map(([id]) => ({ id, ...GAME[id] }))
    .filter((t) => t.label);
}
