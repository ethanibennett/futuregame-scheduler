# The app's MCP server (Claude chat ↔ futurega.me)

Owner, 2026-10-23: "build an MCP so that I can use Claude chat to communicate with the app."
`lib/mcp/index.js`, mounted by server.js at `/mcp/:token`. Test: `npm run test:mcp`.

## Setting it up

1. **Generate the secret** (Mac or PC, identical; prints 48 characters and nothing else):

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g,'x'))"
   ```

2. **Set `MCP_TOKEN`** to it on the futurega.me Render service (Environment → Add). Nothing to add
   to the local `ecosystem.config.cjs`: this box's copy stays OFF, and the boot line says so
   (`[mcp] OFF: MCP_TOKEN is not set`). Render redeploys on the change; the boot line reads
   `[mcp] ON at /mcp/<token> (48 characters)`.

3. **Add the connector in claude.ai**: Settings → Connectors → *Add custom connector*:
   - Name: `futurega.me`
   - Remote MCP server URL: `https://futurega.me/mcp/<the secret>`
   - Authentication: none (the secret is the path; see "Why the secret is in the URL")

   Then in a chat, enable the connector under the tools menu. "What's on my schedule this week?",
   "Find the Turning Stone Main Event flights and add Flight B", "What's the clock on the Main Event?",
   "Who do I owe?" all work from the tools below.

4. **Rotate** by setting `MCP_TOKEN` to a new value and `MCP_TOKEN_PREVIOUS` to the old one, updating the
   connector's URL, then clearing `MCP_TOKEN_PREVIOUS`. The token never appears in a log line.

## Tools

| Tool | Does | Calls |
|---|---|---|
| `find_events` | search the schedule: words (name, series, room, game), date range, buy-in range, game; online rooms only when asked; at most 40, soonest first | `GET /api/tournaments` |
| `my_schedule` | the owner's saved events, the last 7 days and ahead | `GET /api/schedule/:owner` |
| `add_to_schedule` / `remove_from_schedule` | by tournament id | `POST` / `DELETE /api/schedule` |
| `live_clock` | the room's real clock for a started event (PokerAtlas, WSOP+, Bravo) | `POST /api/live-clocks` |
| `bankroll_summary` | the bankrolls and balances | `GET /api/bankrolls/summary` |
| `recent_results` | logged tournament results, newest first | `GET /api/tracking` |
| `backers` | each backer's standing and any Settled press in progress; **never a page link or token** | `GET /api/staking/standing/backers` |

Every tool is a call on the app's own REST API as the owner: a 2-minute JWT is minted per call and the
request goes to `http://127.0.0.1:PORT/api/...`, so each route's own checks and side effects apply
unchanged, and nothing here reads the database for figures. Money is never written here: logging a
result or settling with a backer stays a press in the app.

## How it is served

Streamable HTTP, stateless: one `McpServer` and one transport per POST, JSON responses
(`enableJsonResponse`), no session ids. GET and DELETE answer 405. 60 requests a minute per IP.
Unset or wrong token = 404, so nothing says whether the route exists. The SDK:
`@modelcontextprotocol/sdk` 1.32 (`server/mcp.js`, `server/streamableHttp.js`), schemas in zod 4.

## Why the secret is in the URL

claude.ai's custom connectors can send no custom header; the only alternative to "no authentication"
is OAuth 2.1 with dynamic client registration, an authorization page and token endpoints, which this
app does not have. The path secret is the same shape as a backer's page link, with the same rules:
rotatable, never logged, 404 on a mismatch. It acts as the owner, so treat the URL like a password:
the connector stores it; do not paste it in chat.

Upgrade path, if ever wanted: an OAuth authorization server on the app (the SDK ships
`server/auth` helpers), the connector then holds a per-client token the app can revoke on its own.
