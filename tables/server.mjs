// The tables service's entry point (docs/play-money-platform.md §5; owner, 2026-11-22: its own service).
//
//   TABLES_SECRET        shared with the scheduler (>= 32 characters); signs seat tickets, authorises the internal routes
//   TABLES_SCHEDULER_URL the scheduler's base URL (chips and the hand archive)
//   TABLES_DATA_DIR      where the journal and the outbox live (default ./tables-data, gitignored)
//   TABLES_ORIGINS       comma-separated origins the app is served from (CORS)
//   PORT                 default 3101 (never 3001: the scheduler's pm2 app)
//   TABLES_TEST_DECK     tests only: a comma-separated deck dealt to every hand; refused where RENDER is set
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTablesService } from '../lib/tables/service.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3101;
if (port === 3001) { console.error('[tables] refusing port 3001: the scheduler lives there'); process.exit(1); }
if (process.env.TABLES_TEST_DECK && process.env.RENDER) { console.error('[tables] TABLES_TEST_DECK is refused where RENDER is set'); process.exit(1); }
const testDeck = process.env.TABLES_TEST_DECK ? (() => process.env.TABLES_TEST_DECK.split(',')) : undefined;

const svc = createTablesService({
  secret: process.env.TABLES_SECRET,
  schedulerUrl: (process.env.TABLES_SCHEDULER_URL || 'http://127.0.0.1:3001').replace(/\/$/, ''),
  dataDir: path.resolve(root, process.env.TABLES_DATA_DIR || 'tables-data'),
  origins: (process.env.TABLES_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  handGapMs: process.env.TABLES_HAND_GAP_MS != null ? Number(process.env.TABLES_HAND_GAP_MS) : undefined,
  testDeck,
});

const server = svc.app.listen(port, () => console.log(`Tables running on port ${port}${testDeck ? ' (TEST DECK)' : ''}`));
const shutdown = () => {
  console.log('[tables] shutting down: hands in progress are journalled and resume after the restart');
  svc.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
