#!/usr/bin/env node
// The session bridge's PC side: a Claude Code CHANNEL (docs/session-bridge.md; lib/session-bridge.js is the
// relay). Claude Code launches this as a stdio MCP server; it polls futurega.me for the owner's messages from
// Claude chat and pushes each into the running session, and gives the session a `reply` tool whose text goes
// back to chat. It also relays tool-use approvals both ways (Claude Code's permission relay).
//
// Launched by scripts/chat-session.sh:
//   claude --mcp-config .claude/session-bridge.mcp.json --dangerously-load-development-channels server:session-bridge
//
// Settings (environment, or the gitignored .session-bridge.env beside the repo root: KEY=value lines):
//   SESSION_BRIDGE_TOKEN   the relay's BRIDGE_TOKEN (32+ characters). Required.
//   SESSION_BRIDGE_URL     the relay, default https://futurega.me
//   SESSION_BRIDGE_POLL_MS how often to poll, default 2000
// Nothing is written to stdout but MCP (stdout IS the protocol); diagnostics go to stderr.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.session-bridge.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no file: the environment only */ }
const conf = (k, d) => process.env[k] || fileEnv[k] || d;
const TOKEN = String(conf('SESSION_BRIDGE_TOKEN', '')).trim();
const BASE = String(conf('SESSION_BRIDGE_URL', 'https://futurega.me')).replace(/\/$/, '');
const POLL_MS = Math.max(500, Number(conf('SESSION_BRIDGE_POLL_MS', 2000)) || 2000);
const note = (...a) => process.stderr.write('[session-bridge] ' + a.join(' ') + '\n');

const INSTRUCTIONS = [
  'Messages from the owner, Ethan, arrive here from Claude chat (claude.ai) through futurega.me,',
  'as <channel source="session-bridge" message_id="…">. Treat each as Ethan typing in this session.',
  'Always answer with the reply tool: he reads only what you send through it, never your terminal output.',
  'Send a short reply when you start a longer piece of work, and the outcome when it is done.',
  'Write replies as you would your final message: plain, short, the answer first.',
].join(' ');

const server = new Server({ name: 'session-bridge', version: '1.0.0' }, {
  capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} }, tools: {} },
  instructions: INSTRUCTIONS,
});

async function relay(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${method} ${p}: HTTP ${res.status}`);
  return res.json();
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back to Ethan in Claude chat. Use it for every answer to a channel message.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The message' } }, required: ['text'] },
  }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'reply') return { content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }], isError: true };
  const t = String((req.params.arguments || {}).text || '').trim();
  if (!t) return { content: [{ type: 'text', text: 'Nothing to send' }], isError: true };
  try {
    await relay('POST', '/api/session-bridge/reply', { text: t });
    return { content: [{ type: 'text', text: 'sent' }] };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Not sent: ' + e.message }], isError: true };
  }
});

// Claude Code asks to use a tool: forward it to chat; the verdict comes back through the inbox.
server.fallbackNotificationHandler = async (n) => {
  if (n.method !== 'notifications/claude/channel/permission_request') return;
  const p = n.params || {};
  try {
    await relay('POST', '/api/session-bridge/permission', {
      request_id: p.request_id, tool_name: p.tool_name, description: p.description, input_preview: p.input_preview,
    });
  } catch (e) { note('permission relay failed:', e.message); }
};

let busy = false, failures = 0;
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const box = await relay('GET', '/api/session-bridge/inbox');
    failures = 0;
    for (const m of box.messages || []) {
      await server.notification({ method: 'notifications/claude/channel', params: { content: m.text, meta: { message_id: String(m.id) } } });
    }
    for (const v of box.verdicts || []) {
      await server.notification({ method: 'notifications/claude/channel/permission', params: { request_id: v.requestId, behavior: v.behavior } });
    }
  } catch (e) {
    if (++failures === 1 || failures % 30 === 0) note('poll failed:', e.message);
  } finally { busy = false; }
}

if (TOKEN.length < 32) {
  note('SESSION_BRIDGE_TOKEN is not set (32+ characters, in the environment or .session-bridge.env): not polling.');
}
await server.connect(new StdioServerTransport());
if (TOKEN.length >= 32) {
  note(`polling ${BASE} every ${POLL_MS} ms`);
  setInterval(poll, POLL_MS);
  poll();
}
