// Command-line access to every Computer Use action, for agents and scripts
// that don't speak MCP. Each invocation starts a fresh server session, binds
// the app, performs one action and prints the resulting accessibility state.

import fs from 'node:fs';
import { connect } from './client.mjs';
import { parseInventory } from './inventory.mjs';

export const USAGE = `usage: codex-cu <command> [options]

Diagnostics
  --version                              print package version
  doctor                                 check the install
  demo                                   12 × 12 in Calculator, in the background

Discover
  apps                                   list apps (running and recent)
  state <app>                            print the app's accessibility tree
  screenshot <app> [-o file.jpg]         capture the app's window

Act (prefer id:Identifier or label:Name; numeric indices can change between commands)
  click <app> <id:ID|label:Name|index|x,y> [--right] [--double] [--key <chord>] [--hold <ms>]
                                         --key holds a modifier during the click (shift, cmd)
  type <app> <text>                      type into the focused element
  key <app> <key> [--hold <ms>]          press a key, e.g. Return, cmd+a
  paste <app> <text>                     paste text (clipboard is restored)
  set <app> <index> <value>              set an element's value
  scroll <app> <id:ID|label:Name|index|x,y> <up|down|left|right> [pages]
  drag <app> <x1,y1> <x2,y2>
  action <app> <index> <name>            secondary action, e.g. Raise, Expand
  raise <app>                            bring the window forward
  js <code> [--app <app>]                run cua REPL code (\`app\` is bound when --app is set)

Options
  --show       raise the window first so you can watch the agent cursor
  --quiet      don't print the accessibility state after an action
  --json       machine-readable result (including saved image paths)
  --           end options; subsequent arguments are literal text

Examples: click Calculator id:AllClear; click Calculator id:Nine;
          click Calculator label:Multiply; click Calculator label:Equals
Selectors are resolved afresh and must match exactly one element.

Each invocation opens a new session. For multiple steps in one persistent
session use js --app <app> '<code>'. Use fresh state/screenshot targets.`;

function parseFlags(argv) {
  const flags = { show: false, quiet: false, right: false, double: false, out: null, app: null, key: null, hold: null, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a === '--json') flags.json = true;
    else if (a === '--show') flags.show = true;
    else if (a === '--quiet') flags.quiet = true;
    else if (a === '--right') flags.right = true;
    else if (a === '--double') flags.double = true;
    else if (['-o', '--out', '--app', '--key'].includes(a)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${a} requires a value`);
      flags[{ '-o': 'out', '--out': 'out', '--app': 'app', '--key': 'key' }[a]] = value;
    }
    else if (a === '--hold') {
      flags.hold = Number(argv[++i]);
      if (!Number.isInteger(flags.hold) || flags.hold < 0) throw new UsageError('--hold takes milliseconds');
    }
    else if (a.startsWith('--')) throw new UsageError(`unknown option: ${a}; use -- before literal text`);
    else rest.push(a);
  }
  return { flags, rest };
}

// "12" -> 12, "300,140" -> [300, 140]
function target(value) {
  if (value == null) throw new UsageError('missing target');
  if (/^(id|label):.+$/.test(value)) return value;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new UsageError(`expected id:ID, label:Name, element index, or x,y: ${value}`);
  return [Number(m[1]), Number(m[2])];
}

class UsageError extends Error { name = 'UsageError'; }

const q = JSON.stringify;

// The first js call of a session must be exactly one entry call.
async function bindApp(client, app) {
  return client.js(`let app = await cua.getApp(${q(app)});`, `Get ${app}`);
}

// Codex's first-use result is long documentation followed by the UI state.
function stripDocs(text) {
  const i = text.lastIndexOf('\nWindow: ');
  return i >= 0 ? text.slice(i + 1) : text;
}

function need(rest, n, what) {
  if (rest.length < n) throw new UsageError(`missing ${what}`);
}

// Resolve semantic targets in the action's own session, so changing UI indices
// cannot silently redirect a shell command to a different control.
function targetCode(value) {
  const parsed = target(value);
  if (typeof parsed !== 'string') return q(parsed);
  const colon = parsed.indexOf(':');
  const kind = parsed.slice(0, colon), wanted = parsed.slice(colon + 1);
  return `await (async () => {
    const tree = await app.getAXState({ emit: false, disableDiffing: true });
    const wanted = ${q(wanted)};
    const matches = tree.split("\\n").filter(line => {
      const id = line.match(/\\bID: ([^,\\n]+)/)?.[1]?.trim();
      const description = line.match(/\\bDescription: ([^,\\n]+)/)?.[1]?.trim();
      const label = line.match(/^\\s*\\d+\\s+(?:button|text|menu item|menu button|checkbox|radio button)\\s+([^,]+)/)?.[1]?.trim();
      return ${q(kind)} === 'id' ? id === wanted : description === wanted || label === wanted;
    });
    if (matches.length !== 1) throw new Error('Target ' + ${q(parsed)} + ' matched ' + matches.length + ' elements; read fresh state and choose a unique target');
    return Number(matches[0].trim().match(/^\\d+/)[0]);
  })()`;
}

export async function runCli(argv) {
  const [command, ...args] = argv;
  if (args.slice(0, args.indexOf('--') < 0 ? undefined : args.indexOf('--')).some(a => a === '--help' || a === '-h')) { console.log(USAGE); return; }
  const { flags, rest } = parseFlags(args);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  let action;
  switch (command) {
    case 'apps': {
      const client = await connect();
      try {
        const text = await client.js('await cua.getState();', 'Inventory');
        const state = parseInventory(text);
        if (flags.json) { console.log(JSON.stringify({ ok: true, ...state })); return; }
        for (const app of state.apps) {
          console.log(`${app.isRunning ? '●' : '○'} ${app.displayName ?? app.id}  (${app.id})`);
        }
      } finally {
        client.close();
      }
      return;
    }
    case 'state':
      need(rest, 1, '<app>');
      action = null;
      break;
    case 'screenshot':
      need(rest, 1, '<app>');
      action = 'await app.getScreenshot();';
      break;
    case 'click': {
      need(rest, 2, '<app> <id:ID|label:Name|index|x,y>');
      const opts = {};
      if (flags.right) opts.mouseButton = 'right';
      if (flags.double) opts.clickCount = 2;
      if (flags.key) opts.key = flags.key;
      if (flags.hold != null) opts.durationMs = flags.hold;
      action = `await app.click(${targetCode(rest[1])}, ${q(opts)});`;
      break;
    }
    case 'type':
      need(rest, 2, '<app> <text>');
      action = `await app.typeText(${q(rest.slice(1).join(' '))});`;
      break;
    case 'key':
      need(rest, 2, '<app> <key>');
      action = `await app.pressKey(${q(rest[1])}${flags.hold != null ? `, ${q({ durationMs: flags.hold })}` : ''});`;
      break;
    case 'paste':
      need(rest, 2, '<app> <text>');
      action = `await app.paste(${q(rest.slice(1).join(' '))});`;
      break;
    case 'set':
      need(rest, 3, '<app> <index> <value>');
      if (Array.isArray(target(rest[1]))) throw new UsageError('set requires an element index or selector');
      action = `await app.setValue(${targetCode(rest[1])}, ${q(rest.slice(2).join(' '))});`;
      break;
    case 'scroll':
      need(rest, 3, '<app> <id:ID|label:Name|index|x,y> <direction>');
      if (!['up', 'down', 'left', 'right'].includes(rest[2])) throw new UsageError('scroll direction must be up, down, left, or right');
      if (rest[3] !== undefined && (!Number.isFinite(Number(rest[3])) || Number(rest[3]) <= 0)) throw new UsageError('scroll pages must be a positive number');
      action = `await app.scroll(${targetCode(rest[1])}, ${q(rest[2])}${rest[3] ? `, ${Number(rest[3])}` : ''});`;
      break;
    case 'drag':
      need(rest, 3, '<app> <x1,y1> <x2,y2>');
      if (!Array.isArray(target(rest[1])) || !Array.isArray(target(rest[2]))) throw new UsageError('drag requires two x,y coordinates');
      action = `await app.drag(${targetCode(rest[1])}, ${targetCode(rest[2])});`;
      break;
    case 'action':
      need(rest, 3, '<app> <index> <name>');
      if (Array.isArray(target(rest[1]))) throw new UsageError('action requires an element index or selector');
      action = `await app.performSecondaryAction(${targetCode(rest[1])}, ${q(rest.slice(2).join(' '))});`;
      break;
    case 'raise':
      need(rest, 1, '<app>');
      action = 'await app.performSecondaryAction(0, "Raise");';
      break;
    case 'js': {
      need(rest, 1, '<code>');
      const client = await connect();
      try {
        if (flags.app) await bindApp(client, flags.app);
        const { text, images } = await client.call(rest.join(' '), 'Run code');
        output(text, images, flags);
      } finally {
        client.close();
      }
      return;
    }
    default:
      throw new UsageError(`unknown command: ${command}`);
  }

  const app = rest[0];
  const client = await connect();
  try {
    const initial = await bindApp(client, app);
    if (action == null) {
      output(initial, [], flags);
      return;
    }
    if (flags.show && command !== 'raise') {
      await client.js(
        'await app.performSecondaryAction(0, "Raise"); await new Promise(r => setTimeout(r, 400));',
        'Raise window',
      );
    }
    const observe = command === 'screenshot' || flags.quiet ? '' : '\nawait app.getAXState();';
    const { text, images } = await client.call(action + observe, `${command} ${app}`);
    output(text, images, flags);
  } finally {
    client.close();
  }
}

function output(text, images, flags) {
  const files = images.map((img, i) => saveImage(img, flags.out, i));
  if (flags.json) console.log(JSON.stringify({ ok: true, text: stripDocs(text), images: files }));
  else {
    if (text) console.log(stripDocs(text));
    for (const file of files) console.log(`saved ${file}`);
  }
}

function saveImage(buffer, out, index) {
  const file = out
    ? index === 0 ? out : out.replace(/(\.\w+)?$/, `-${index}$1`)
    : `codex-cu-${Date.now()}${index ? `-${index}` : ''}.${buffer[0] === 0x89 ? 'png' : 'jpg'}`;
  fs.writeFileSync(file, buffer);
  return file;
}

export { UsageError };
