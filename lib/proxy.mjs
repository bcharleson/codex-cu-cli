// codex-cu-mcp proxy.
//
// Runs the computer-use MCP server that ships with the ChatGPT desktop app
// (the "cua_repl" entry of Codex's bundled unified-computer-use plugin) and
// relays newline-delimited JSON-RPC between it and any MCP client.
//
// Codex talks to this server with a few extras that other clients don't send.
// The proxy fills them in:
//   1. Turn metadata: browser control rejects calls without
//      _meta["x-codex-turn-metadata"] = { session_id, turn_id }.
//   2. App consent: every app is gated by an elicitation such as
//      'Allow Computer Use to use "Calculator"?'. Clients that support
//      elicitation see the prompt (once per app per session); clients that
//      don't (or CODEX_CU_ASK=never) get the CODEX_CU_AUTO_APPROVE policy.
//   3. Tool surface: only the tools Codex itself enables are listed.
//   4. Cursor motion: the js tool description asks agents to click at
//      screenshot coordinates, which the service animates (CODEX_CU_GLIDE).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DiscoveryError, findServerConfig } from './discover.mjs';
import { fixScreenshots } from './scale-fix.mjs';

const EXPOSED_TOOLS = new Set(splitList(process.env.CODEX_CU_TOOLS ?? 'js,js_reset'));
// 'all' (default), 'none', or a comma-separated list of app display names.
const AUTO_APPROVE = (process.env.CODEX_CU_AUTO_APPROVE ?? 'all').trim();
// 'client' (default): ask through the client when it supports elicitation.
// 'never': never ask the client, apply AUTO_APPROVE. Needed for headless runs
// (e.g. `grok -p`) whose client advertises elicitation but can't answer it.
const ASK = (process.env.CODEX_CU_ASK ?? 'client').trim();
if (!['client', 'never'].includes(ASK)) throw new Error('CODEX_CU_ASK must be client or never');
const VERBOSE = process.env.CODEX_CU_VERBOSE === '1';
// Glide mode (default on): tell agents to click at screenshot coordinates.
// Element-index clicks are instant accessibility presses, so the agent cursor
// jumps; coordinate clicks are simulated pointer clicks that the Computer Use
// service animates, which is what makes Codex's cursor move like a hand.
const GLIDE = process.env.CODEX_CU_GLIDE !== '0';

// Some clients (e.g. Grok's tool search) only surface the start of a tool
// description, so the key rule leads and the details follow at the end.
const GLIDE_LEAD =
  'Always click with screenshot coordinates: `await app.getScreenshot()`, then `await app.click([x, y])`. The on-screen cursor then glides to the target like a human hand; clicking by element index (`app.click(42)`) makes it jump, so use indices only when the target is not visible in the screenshot. Leave windows where they are; do not raise or activate them unless asked. ';

// Appended to a js result when the code clicked by element index, so the agent
// corrects course within the session.
const GLIDE_NUDGE =
  'codex-cu: this call clicked by element index, so the cursor jumped instead of gliding. For natural cursor motion, take a screenshot and click with `await app.click([x, y])`.';
// Recognisable element-index clicks: a numeric literal, a variable looping
// over a list of numbers, or an index-lookup helper. Ambiguous cases such as
// click(point) are left alone; the nudge is advice, not enforcement.
function clicksByIndex(code) {
  if (/\.click\(\s*\d/.test(code)) return true;
  if (/\.click\(\s*(find|idx|index|indexOf|lookup|el|element)\w*\s*\(/.test(code)) return true;
  for (const m of code.matchAll(/for\s*\(\s*(?:const|let|var)\s+(\w+)\s+of\s+\[\s*\d/g)) {
    if (new RegExp(`\\.click\\(\\s*${m[1]}\\s*[,)]`).test(code)) return true;
  }
  return false;
}

const GLIDE_GUIDANCE = `

## Cursor motion

Click with screenshot coordinates so the on-screen agent cursor glides to each target like a human hand, as it does in Codex:

\`\`\`javascript
await app.getScreenshot();      // locate the target in this image
await app.click([x, y]);        // x, y in that screenshot's pixels
\`\`\`

Clicking by element index (\`app.click(42)\`) is an instant accessibility press and the cursor jumps instead, so use element indices for reading state, \`setValue\`, \`selectText\` and secondary actions, and coordinates for clicks, double-clicks and drags. Take a fresh screenshot whenever the layout may have changed.

Leave the user's screen as it is: work on windows where they are and don't raise, activate or reorder them (no \`performSecondaryAction(0, "Raise")\`) unless the user explicitly asks to bring a window forward. Raising a window changes focus and makes the user's own apps go inactive.`;

const APP_CONSENT = /^Allow Computer Use to use "(.+)"\?$/;
// Never infer consent from response timing. Headless clients opt in explicitly
// with CODEX_CU_ASK=never; cancellations and refusals are always respected.

function splitList(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function log(message) {
  process.stderr.write(`[codex-cu] ${message}\n`);
}

function lineReader(stream, onMessage) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log('dropping non-JSON upstream line');
        continue;
      }
      if (!message || Array.isArray(message) || typeof message !== 'object') continue;
      onMessage(message);
    }
  });
}

function send(stream, message) {
  if (!stream.destroyed && !stream.writableEnded) stream.write(JSON.stringify(message) + '\n');
}

let config;
try {
  config = findServerConfig();
} catch (err) {
  if (!(err instanceof DiscoveryError)) throw err;
  log(err.message);
  process.exit(1);
}
if (VERBOSE) log(`using unified-computer-use ${config.version} (${config.file})`);

const server = spawn(config.command, config.args, {
  env: { ...process.env, ...config.env },
  stdio: ['pipe', 'pipe', 'inherit'],
});

server.on('error', err => {
  log(`failed to start server: ${err.message}`);
  process.exit(1);
});
let stopping = false;
let killTimer;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  server.stdin.end();
  server.kill(signal);
  killTimer = setTimeout(() => server.kill('SIGKILL'), 2000);
  killTimer.unref();
}
// 'close' waits for stdout to drain; async screenshot processing must also finish.
server.on('close', (code, signal) => {
  clearTimeout(killTimer);
  outbound.finally(() => process.stdout.write('', () => process.exit(code ?? (stopping ? 0 : signal ? 1 : 0))));
});
server.stdin.on('error', err => { if (err.code !== 'EPIPE') log(err.message); stop(); });
process.stdout.on('error', () => stop());
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => stop(sig));
}

const turnMetadata = { session_id: randomUUID(), turn_id: randomUUID() };
let clientSupportsElicitation = false;
const toolsListRequests = new Set();
const indexClickCalls = new Set(); // tools/call ids whose js code clicked by index
const jsCalls = new Set(); // tools/call ids for the js tool
const boundApps = new Set(); // names or bundle ids passed to cua.getApp()
let initializeRequestId;
const forwardedConsents = new Map(); // server request id -> app
const approvedApps = new Set(); // apps approved for this session

// Client -> server
lineReader(process.stdin, message => {
  if (message.method === 'initialize') {
    initializeRequestId = message.id;
    const params = (message.params ??= {});
    const capabilities = (params.capabilities ??= {});
    const elicitation = capabilities.elicitation;
    clientSupportsElicitation = elicitation != null && (elicitation.form != null || Object.keys(elicitation).length === 0);
    // The proxy always handles elicitation, so advertise it to the server.
    capabilities.elicitation = { ...(capabilities.elicitation ?? {}), form: {} };
    if (VERBOSE) log(`client elicitation support: ${clientSupportsElicitation}`);
  } else if (message.method === 'tools/list') {
    toolsListRequests.add(message.id);
  } else if (message.method === 'tools/call') {
    const params = (message.params ??= {});
    if (!EXPOSED_TOOLS.has(params.name)) {
      send(process.stdout, { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Tool not exposed: ${params.name}` } });
      return;
    }
    const meta = (params._meta ??= {});
    meta['x-codex-turn-metadata'] = { ...turnMetadata, ...meta['x-codex-turn-metadata'] };
    if (params.name === 'js_reset') boundApps.clear();
    if (params.name === 'js') {
      jsCalls.add(message.id);
      for (const m of (params.arguments?.code ?? '').matchAll(/getApp\(\s*["'`]([^"'`]+)["'`]/g)) {
        boundApps.add(m[1]);
      }
    }
    if (GLIDE && params.name === 'js' && clicksByIndex(params.arguments?.code ?? '')) {
      indexClickCalls.add(message.id);
    }
  } else if (message.method == null && forwardedConsents.has(message.id)) {
    // Client's answer to a consent prompt we forwarded.
    const app = forwardedConsents.get(message.id);
    forwardedConsents.delete(message.id);
    if (message.result?.action === 'accept') {
      approvedApps.add(app);
      message.result._meta = { persist: 'session', ...(message.result._meta ?? {}) };
    }
  }
  send(server.stdin, message);
});
process.stdin.on('end', () => stop());

// Server -> client. Messages are handled in order through a queue because
// screenshot correction is asynchronous.
let outbound = Promise.resolve();
lineReader(server.stdout, message => {
  outbound = outbound
    .then(() => handleServerMessage(message))
    .catch(err => log(`failed to relay a server message: ${err.message}`));
});

async function handleServerMessage(message) {
  if (message.method === 'elicitation/create') {
    handleElicitation(message);
    return;
  }
  const isResponse = message.method == null;
  if (GLIDE && isResponse && message.id === initializeRequestId && message.result != null) {
    initializeRequestId = undefined;
    message.result.instructions = [message.result.instructions, GLIDE_LEAD.trim()].filter(Boolean).join('\n\n');
  }
  if (isResponse && indexClickCalls.has(message.id)) {
    indexClickCalls.delete(message.id);
    if (Array.isArray(message.result?.content) && !message.result.isError) {
      message.result.content.push({ type: 'text', text: GLIDE_NUDGE });
    }
  }
  if (isResponse && jsCalls.has(message.id)) {
    jsCalls.delete(message.id);
    if (process.env.CODEX_CU_SCALE_FIX !== '0') await fixScreenshots(message.result, boundApps, log);
  }
  if (isResponse && toolsListRequests.has(message.id)) {
    toolsListRequests.delete(message.id);
    if (Array.isArray(message.result?.tools)) {
      message.result.tools = message.result.tools.filter(t => EXPOSED_TOOLS.has(t.name));
      if (GLIDE) {
        for (const tool of message.result.tools) {
          if (tool.name === 'js') tool.description = GLIDE_LEAD + (tool.description ?? '') + GLIDE_GUIDANCE;
        }
      }
    }
  }
  send(process.stdout, message);
}

function handleElicitation(message) {
  const prompt = message.params?.message ?? '';
  const app = prompt.match(APP_CONSENT)?.[1];

  if (app != null && approvedApps.has(app)) {
    reply(message.id, true);
    return;
  }
  if (clientSupportsElicitation && ASK !== 'never') {
    if (app != null) forwardedConsents.set(message.id, app);
    send(process.stdout, message);
    return;
  }
  answerFromPolicy(message.id, app, prompt);
}

function answerFromPolicy(id, app, prompt) {
  const approve = autoApproves(app);
  log(`${approve ? 'auto-approved' : 'declined'}: ${prompt} (CODEX_CU_AUTO_APPROVE=${AUTO_APPROVE})`);
  if (approve && app != null) approvedApps.add(app);
  reply(id, approve);
}

// The policy covers app-consent prompts only. Anything else the server asks
// (e.g. permission to record computer audio) needs a client that can show it.
function autoApproves(app) {
  if (app == null || AUTO_APPROVE === 'none') return false;
  if (AUTO_APPROVE === 'all') return true;
  return splitList(AUTO_APPROVE).some(name => name.toLowerCase() === app.toLowerCase());
}

function reply(id, approve) {
  send(server.stdin, {
    jsonrpc: '2.0',
    id,
    result: approve
      ? { action: 'accept', content: {}, _meta: { persist: 'session' } }
      : { action: 'decline' },
  });
}
