# The session bridge: Claude chat ↔ a Claude Code session on the PC

Owner, 2026-11-02: "build the MCP connector so that I can talk to this code session with Claude chat."

Regular claude.ai chat cannot reach a Claude Code session directly (Remote Control serves claude.ai/code and
the mobile apps only). So futurega.me relays, and a Claude Code **channel** on the PC carries messages into
the session:

```
claude.ai chat ── futurega.me connector (session_send / session_read / session_approve / session_status)
      │
futurega.me  ── table session_bridge ──  polled every 2 s with BRIDGE_TOKEN
      │
scripts/session-bridge-channel.mjs (stdio MCP channel) ── Claude Code CLI session on the PC
```

- A message sent from chat arrives in the session as if you typed it; the session answers with the
  channel's `reply` tool, and `session_read` hands the answer back to chat.
- When the session wants to run a tool that needs approval, the request shows up in `session_read`; answer
  it with `session_approve` (Claude Code's permission relay).
- Code: `lib/session-bridge.js` (relay + routes), the four tools in `lib/mcp/index.js`, the channel in
  `scripts/session-bridge-channel.mjs`, its MCP config `scripts/session-bridge.mcp.json`.
  Test: `npm run test:session-bridge`.

## Limits (from Claude Code's docs)

- Channels are a **research preview** and work in the **CLI** (`claude` in a terminal), not in the desktop
  app's Code tab. The bridge drives a terminal session on the PC, kept alive in tmux.
- A custom channel loads with `--dangerously-load-development-channels`, and Claude Code asks you to confirm
  it once when the session starts.
- Messages reach the session only while it is running. Queued messages wait and arrive together.
- "This conversation" can be continued in the bridged session with `--resume <session id>`, but close it
  everywhere else first: two processes on one session interleave its transcript.

## Setting it up

1. **Generate the bridge secret** (prints 64 hex characters; keep it out of chat):

   **Mac or PC:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **On Render** (the futurega.me service), set `BRIDGE_TOKEN` to it. The connector itself also needs
   `MCP_TOKEN` and the claude.ai custom connector from `docs/mcp.md`, if not done yet. The boot log then
   reads `[session-bridge] ON`.

3. **On the PC**, put the same value in the gitignored token file:

   **PC (PowerShell):**
   ```bash
   $t = Read-Host 'Bridge token'; Set-Content -Path D:\projects\scheduler\.session-bridge.env -Value "SESSION_BRIDGE_TOKEN=$t"
   ```

4. **Start the bridged session** in tmux on the PC, from an MSYS2 shell (`ssh sched`, or the MSYS2 terminal):

   **PC (MSYS2 bash):**
   ```bash
   tmux new-session -d -s chat -c /d/projects/scheduler 'claude --mcp-config scripts/session-bridge.mcp.json --dangerously-load-development-channels server:session-bridge'
   ```

   Then attach, confirm the development-channel prompt, and detach with Ctrl-b d:

   **PC (MSYS2 bash):**
   ```bash
   tmux attach -t chat
   ```

   To continue an existing conversation instead of a fresh one, add `--resume <session id>` inside the
   quotes, after closing that conversation everywhere else.

5. **In claude.ai chat** (with the futurega.me connector on): "Ask my code session to run the backer tests."
   Chat calls `session_send`, then `session_read` until the reply arrives. `session_status` says whether the
   session is connected.

## Security

The connector URL and `BRIDGE_TOKEN` are both passwords: whoever holds the URL can instruct the session.
Tool approvals still go through Claude Code's normal permission prompts, relayed to chat, so keep the
bridged session in its normal permission mode rather than one that skips approvals. Rotate with
`BRIDGE_TOKEN_PREVIOUS` (accepted inbound while the PC's file is updated). Neither token is logged.
