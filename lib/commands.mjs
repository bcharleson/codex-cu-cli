// `codex-cu-mcp doctor` and `codex-cu-mcp demo`.

import { connect } from './client.mjs';
import { findServerConfig, checkServerFiles } from './discover.mjs';
import { parseInventory } from './inventory.mjs';

export async function doctor({ json = false } = {}) {
  const checks = [];
  const add = (ok, message) => checks.push({ ok, message });
  let client;
  try {
    if (process.platform !== 'darwin') throw new Error('Computer Use requires macOS');
    const config = findServerConfig();
    add(true, `plugin unified-computer-use ${config.version}`);
    for (const item of checkServerFiles(config)) add(item.ok, `${item.label}: ${item.file}`);
    if (checks.some(c => !c.ok)) throw new Error('Required server files are missing; open/update ChatGPT and enable Computer Use.');
    client = await connect();
    add(true, `server ${client.init.serverInfo?.name} ${client.init.serverInfo?.version} initialized`);
    const { tools } = await client.request('tools/list', {});
    add(tools.some(t => t.name === 'js'), `tools: ${tools.map(t => t.name).join(', ')}`);
    if (!tools.some(t => t.name === 'js')) throw new Error('The js tool is required; check CODEX_CU_TOOLS.');
    const state = parseInventory(await client.js('await cua.getState();', 'Inventory'));
    add(state.apps.length > 0, `computer use: ${state.apps.length} apps visible (${state.apps.filter(a => a.isRunning).length} running)`);
    for (const error of state.errors ?? []) add(false, typeof error === 'string' ? error : JSON.stringify(error));
    checks.push({ ok: true, optional: true, message: state.browsers.length
      ? `browser control: ${state.browsers.map(b => b.name ?? b.id).join(', ')}`
      : 'No extension-connected browsers. Tab-level control is unavailable; native app control is separate.' });
    checks.push({ ok: true, optional: true, message: 'Inventory checks do not verify input or Screen Recording. Run demo and screenshot Calculator to test those.' });
  } catch (err) { add(false, err.message); }
  finally { client?.close(); }
  const ok = checks.every(c => c.ok);
  if (json) console.log(JSON.stringify({ ok, checks }));
  else {
    console.log('codex-cu doctor\n');
    for (const c of checks) console.log(`  ${c.optional ? '·' : c.ok ? '✔' : '✘'} ${c.message}`);
    console.log(ok ? '\nCore checks passed.' : '\nSome checks failed.');
  }
  process.exitCode = ok ? 0 : 1;
  return { ok, checks };
}

// Deterministic accessibility demo. Coordinates depend on window layout; this
// demo deliberately resolves fresh controls instead of assuming a fixed size.
export async function demo({ show = false, json = false } = {}) {
  const client = await connect();
  try {
    if (!json) console.log('Opening Calculator through Computer Use…');
    await client.js('let app = await cua.getApp("Calculator");', 'Get Calculator');
    if (show) await client.js('await app.performSecondaryAction(0, "Raise");', 'Show Calculator');
    const output = await client.js(`
await app.pressKey("Escape");
await app.pressKey("Escape");
for (const wanted of ['One', 'Two', 'Multiply', 'One', 'Two', 'Equals']) {
  const tree = await app.getAXState({ emit: false, disableDiffing: true });
  const line = tree.split("\\n").find(l => l.includes('ID: ' + wanted) || l.trim().endsWith('button ' + wanted));
  if (!line) throw new Error('Calculator button not found: ' + wanted);
  await app.click(Number(line.trim().split(' ')[0]));
  ${show ? 'await new Promise(r => setTimeout(r, 250));' : ''}
}
const after = await app.getAXState({ emit: false, disableDiffing: true });
nodeRepl.write("RESULT=" + (after.match(/Edit field, Value: ([^\\n,]+)/)?.[1] ?? "?"));
`, 'Compute 12 × 12');
    const result = output.match(/RESULT=(.*)/)?.[1]?.trim();
    console.log(json ? JSON.stringify({ ok: result === '144', expression: '12 × 12', result }) : `12 × 12 = ${result}`);
    process.exitCode = result === '144' ? 0 : 1;
  } finally { client.close(); }
}
