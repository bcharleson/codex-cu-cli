import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { connect } from '../lib/client.mjs';
import { findServerConfig } from '../lib/discover.mjs';
import { parseInventory } from '../lib/inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/server.mjs', import.meta.url));
const proxy = path.join(root, 'lib/proxy.mjs');
const main = path.join(root, 'lib/main.mjs');
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plugins = path.join(dir, 'plugins/cache/openai-bundled/unified-computer-use');
  function manifest(version, data = { mcpServers: { cua_repl: { command: process.execPath, args: [fixture] } } }) {
    const folder = path.join(plugins, version);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '.mcp.json'), typeof data === 'string' ? data : JSON.stringify(data));
  }
  manifest('1.0.1');
  return { dir, plugins, manifest, env: { ...process.env, CODEX_HOME: dir, CODEX_CU_SCALE_FIX: '0', CODEX_CU_ASK: 'client', CODEX_CU_AUTO_APPROVE: 'none', CODEX_CU_TOOLS: 'js,js_reset' } };
}
async function client(t, env, options = {}) {
  const c = await connect({ command: process.execPath, args: [proxy], env, timeoutMs: 5000, ...options });
  t.after(() => c.close());
  return c;
}

test('discovery selects numeric newest, ignores staging, and reports invalid newest manifest', t => {
  const s = sandbox(t);
  s.manifest('1.0.10'); s.manifest('staging');
  assert.equal(findServerConfig(s.plugins).version, '1.0.10');
  s.manifest('1.0.11', '{broken');
  assert.throws(() => findServerConfig(s.plugins), /Cannot read/);
});
test('discovery validates command/args/env and expands plugin root', t => {
  const s = sandbox(t);
  s.manifest('2', { mcpServers: { cua_repl: { command: '${CLAUDE_PLUGIN_ROOT}/node', args: [] } } });
  assert.equal(findServerConfig(s.plugins).command, path.join(s.plugins, '2/node'));
  s.manifest('3', { mcpServers: { cua_repl: { command: 'node', args: 'not-array' } } });
  assert.throws(() => findServerConfig(s.plugins), /invalid/);
  assert.throws(() => findServerConfig(path.join(s.dir, 'missing')), /enable Computer Use/i);
});
test('proxy exposes only permitted tools and rejects direct hidden-tool execution', async t => {
  const c = await client(t, sandbox(t).env);
  assert.deepEqual((await c.request('tools/list', {})).tools.map(t => t.name), ['js', 'js_reset']);
  await assert.rejects(c.request('tools/call', { name: 'turn_ended', arguments: {} }), /not exposed/);
});
test('proxy supplies metadata and preserves client metadata; REPL reset forwards', async t => {
  const c = await client(t, sandbox(t).env);
  const a = JSON.parse(await c.js('echo', 'test'))._meta['x-codex-turn-metadata'];
  assert.ok(a.session_id && a.turn_id);
  const b = await c.request('tools/call', { name: 'js_reset', _meta: { custom: true, 'x-codex-turn-metadata': { session_id: 'caller', turn_id: 'turn' } } });
  const params = JSON.parse(b.content[0].text);
  assert.equal(params._meta.custom, true);
  assert.equal(params._meta['x-codex-turn-metadata'].session_id, 'caller');
});
test('concurrent requests retain IDs and responses', async t => {
  const c = await client(t, sandbox(t).env);
  const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => c.js(`echo-${i}`, 'test')));
  answers.forEach((a, i) => assert.equal(JSON.parse(a).arguments.code, `echo-${i}`));
});
test('glide advice appears only for index clicks and can be disabled', async t => {
  const s = sandbox(t);
  const c = await client(t, s.env);
  assert.match((await c.request('tools/list', {})).tools[0].description, /screenshot coordinates/);
  assert.match(await c.js('await app.click(42);', 'test'), /cursor jumped/);
  assert.doesNotMatch(await c.js('await app.click([4,2]);', 'test'), /cursor jumped/);
  const off = await client(t, { ...s.env, CODEX_CU_GLIDE: '0' });
  assert.equal((await off.request('tools/list', {})).tools[0].description, 'js');
});
for (const action of ['decline', 'cancel']) test(`instant ${action} is respected even with auto-approve=all`, async t => {
  const s = sandbox(t); let asks = 0;
  const c = await client(t, { ...s.env, CODEX_CU_AUTO_APPROVE: 'all' }, { capabilities: { elicitation: { form: {} } }, onElicitation: () => { asks++; return { action }; } });
  const result = JSON.parse(await c.js('prompt:Allow Computer Use to use "Calculator"?', 'test'));
  assert.equal(result.action, action); assert.equal(asks, 1);
});
test('accepted app consent is cached for the session', async t => {
  let asks = 0;
  const c = await client(t, sandbox(t).env, { capabilities: { elicitation: {} }, onElicitation: () => { asks++; return { action: 'accept' }; } });
  for (let i = 0; i < 2; i++) assert.equal(JSON.parse(await c.js('prompt:Allow Computer Use to use "Calculator"?', 'test')).action, 'accept');
  assert.equal(asks, 1);
});
test('headless app allowlist accepts matching apps and denies others/non-app prompts', async t => {
  const c = await client(t, { ...sandbox(t).env, CODEX_CU_AUTO_APPROVE: 'calculator', CODEX_CU_ASK: 'never' });
  assert.equal(JSON.parse(await c.js('prompt:Allow Computer Use to use "Calculator"?', 'test')).action, 'accept');
  assert.equal(JSON.parse(await c.js('prompt:Allow Computer Use to use "Mail"?', 'test')).action, 'decline');
  assert.equal(JSON.parse(await c.js('prompt:Record audio?', 'test')).action, 'decline');
});
test('URL-only elicitation capability does not pretend to support forms', async t => {
  let asked = false;
  const c = await client(t, sandbox(t).env, { capabilities: { elicitation: { url: {} } }, onElicitation: () => { asked = true; return { action: 'accept' }; } });
  assert.equal(JSON.parse(await c.js('prompt:Allow Computer Use to use "Calculator"?', 'test')).action, 'decline');
  assert.equal(asked, false);
});
test('tool errors fail the CLI call', async t => {
  const c = await client(t, sandbox(t).env);
  await assert.rejects(c.js('tool-error'), /fixture action failed/);
});
test('client startup failures and timeouts reject promptly', async t => {
  await assert.rejects(connect({ command: '/nonexistent/codex-cu-node', timeoutMs: 500 }), /Cannot launch/);
  for (const mode of ['exit', 'invalid', 'hang']) {
    await assert.rejects(connect({ command: process.execPath, args: [fixture], env: { ...process.env, FAKE_MODE: mode }, timeoutMs: 150 }), /exited|invalid JSON|timed out/i);
  }
});
test('inventory parser handles docs, braces in strings, and trailing text', () => {
  assert.equal(parseInventory('Docs\n{"apps":[{"name":"x}y"}],"browsers":[]}\nnote').apps[0].name, 'x}y');
  assert.throws(() => parseInventory('not inventory'), /no valid/);
});
test('invalid CLI args fail before launching an upstream', t => {
  const s = sandbox(t);
  for (const args of [['click', 'Calculator', 'bad'], ['drag', 'Finder', '1', '2'], ['scroll', 'Finder', '1', 'diagonal'], ['scroll', 'Finder', '1', 'down', 'NaN'], ['set', 'Finder', '1,2', 'text'], ['screenshot', 'Calculator', '-o'], ['state', 'Calculator', '--typo']]) {
    const result = spawnSync(process.execPath, [main, ...args, '--json'], { env: s.env, encoding: 'utf8' });
    assert.equal(result.status, 2, `${args}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
});
test('literal option-like text is passed safely using --', t => {
  const s = sandbox(t);
  const out = execFileSync(process.execPath, [main, 'type', 'Fixture', '--json', '--', '--hello'], { env: s.env, encoding: 'utf8' });
  assert.match(JSON.parse(out).text, /--hello/);
});
test('doctor returns nonzero for inventory errors', { skip: process.platform !== 'darwin' }, t => {
  const s = sandbox(t);
  const result = spawnSync(process.execPath, [main, 'doctor', '--json'], { env: { ...s.env, FAKE_INVENTORY_ERROR: '1' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.match(result.stdout, /Fixture permission denied/);
});
test('launcher works through relative symlinks from paths containing spaces', t => {
  const s = sandbox(t);
  const linkDir = path.join(s.dir, 'with spaces'); fs.mkdirSync(linkDir);
  fs.symlinkSync(path.relative(fs.realpathSync(linkDir), path.join(root, 'bin/codex-cu')), path.join(linkDir, 'cu'));
  const output = execFileSync(path.join(linkDir, 'cu'), ['--version'], { encoding: 'utf8', env: { ...s.env, CODEX_CU_NODE: process.execPath } });
  assert.equal(output.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
});

test('closing the client terminates the upstream process', async t => {
  const s = sandbox(t), pidFile = path.join(s.dir, 'upstream.pid');
  const c = await client(t, { ...s.env, FAKE_PID_FILE: pidFile });
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  c.close();
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) {
    await new Promise(resolve => setTimeout(resolve, 30));
    try { process.kill(pid, 0); } catch { alive = false; }
  }
  assert.equal(alive, false, 'upstream must not remain running after CLI exits');
});

test('semantic CLI targets resolve changing indices and fail on missing or ambiguous matches', t => {
  const s = sandbox(t);
  const run = (target, tree) => spawnSync(process.execPath, [main, 'click', 'Fixture', target, '--json'], {
    env: { ...s.env, FAKE_AX_TREE: tree }, encoding: 'utf8', timeout: 10_000,
  });
  for (const index of [17, 90]) {
    const r = run('id:Nine', `${index} button Description: 9, ID: Nine\n18 button Multiply`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(JSON.parse(r.stdout).text).clicked, index);
  }
  assert.equal(JSON.parse(JSON.parse(run('label:Multiply', '18 button Multiply').stdout).text).clicked, 18);
  assert.equal(JSON.parse(JSON.parse(run('label:9', '17 button Description: 9, ID: Nine').stdout).text).clicked, 17);
  for (const tree of ['1 button Other', '1 button ID: Nine\n2 button ID: Nine']) {
    const r = run('id:Nine', tree);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /matched [02] elements/);
  }
});
test('command-specific help succeeds without starting a server', t => {
  const s = sandbox(t);
  assert.match(execFileSync(process.execPath, [main, 'js', '--help'], { env: s.env, encoding: 'utf8' }), /id:AllClear/);
});
