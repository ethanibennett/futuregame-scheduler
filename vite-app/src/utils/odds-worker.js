// The odds tool's work off the page's thread (Features 35): a sample of 20,000 run-outs takes seconds.
import { computeOdds } from './odds.js';

self.onmessage = (e) => {
  const { game, hands, board, id } = e.data || {};
  try {
    self.postMessage({ id, result: computeOdds(game, hands, board) });
  } catch (err) {
    self.postMessage({ id, result: { error: String((err && err.message) || err) } });
  }
};
