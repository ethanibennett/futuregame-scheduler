#!/usr/bin/env node
'use strict';
/*
 * A stand-in dashboard for guard runs of the import review (Bankroll › Import › From the dashboard
 * app; docs/bankroll-merge.md §9.3): the Phase 5 test's stub of GET /api/money-export
 * (test/helpers/stub-dashboard.js) serving the MADE-UP fixtures (test/helpers/money-import-fixtures.js)
 * on a scratch port, so a scratch server's Fetch stages the same run scripts/seed-money-import-demo.js
 * seeds, and the guards' walk (which imports, undoes and fetches again) gets the run back.
 *
 *   node scripts/money-import-stub-dashboard.js [--port 4631] [--token <LEDGER_TOKEN>] [--delta]
 *
 * It prints the environment the scratch server needs (LEDGER_TOKEN, DASHBOARD_BASE_URL) and stays
 * up until stopped. --delta serves the fixtures' later edits as well (seedDelta: a session changed,
 * one deleted, a backer edited), so a fetch after an import brings a delta review. The token is made
 * up for this run unless given; it never reaches a real dashboard. Every name and figure is invented.
 */
const crypto = require('crypto');
const { createStub } = require('../test/helpers/stub-dashboard');
const fx = require('../test/helpers/money-import-fixtures');

const args = process.argv.slice(2);
const opt = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const port = Number(opt('--port', 4631));
const token = opt('--token', crypto.randomBytes(32).toString('hex'));
if (!Number.isInteger(port) || port === 3001) { console.error('money-import-stub-dashboard: a scratch port, never 3001'); process.exit(1); }

const stub = createStub({ token });
fx.seedDashboard(stub);
if (args.includes('--delta')) fx.seedDelta(stub);
stub.listen(port).then(() => {
  console.log(`stub dashboard on http://127.0.0.1:${port} (${stub.live('sessions').length} sessions, ${stub.live('backers').length} backers${args.includes('--delta') ? ', with the later edits' : ''})`);
  console.log('boot the scratch server with:');
  console.log(`  LEDGER_TOKEN=${token}`);
  console.log(`  DASHBOARD_BASE_URL=http://127.0.0.1:${port}`);
  console.log('  CONSOLE_OWNER_USER_ID=<the guard account\'s user id>');
  console.log('Ctrl+C stops it.');
}).catch((e) => { console.error(`money-import-stub-dashboard: ${e.message}`); process.exit(1); });
