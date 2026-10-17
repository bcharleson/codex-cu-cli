// Opt-in: opens and edits a disposable TextEdit file, verifies disk and UI, then closes it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { connect } from '../lib/client.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-textedit-'));
const name = path.basename(dir) + '.txt';
const file = path.join(dir, name);
fs.writeFileSync(file, 'Disposable CLI validation document.\n');
execFileSync('open', ['-a', 'TextEdit', file]);
const c = await connect({ env: { ...process.env, CODEX_CU_AUTO_APPROVE: 'TextEdit', CODEX_CU_ASK: 'never' } });
let own = false;
try {
  const initial = await c.js('let app = await cua.getApp("TextEdit");', 'Bind temporary document');
  assert.ok(initial.includes(name), 'TextEdit must be bound to the disposable document');
  own = true;
  await c.js('await app.pressKey("cmd+a"); await app.typeText("CLI smoke typed."); await app.paste(" Pasted."); await app.pressKey("cmd+s");', 'Exercise text, paste, keyboard and save');
  for (let i = 0; i < 30 && fs.readFileSync(file, 'utf8').trim() !== 'CLI smoke typed. Pasted.'; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(fs.readFileSync(file, 'utf8').trim(), 'CLI smoke typed. Pasted.');
  const state = await c.js('await app.getAXState();', 'Read back temporary document');
  assert.match(state, /CLI smoke typed\. Pasted\./);
  await c.js('await app.pressKey("cmd+w");', 'Close disposable document');
  own = false;
  console.log('PASS: TextEdit keyboard, type, paste, save-to-disk verification, UI read-back and close.');
} finally {
  c.close();
  if (!own) fs.rmSync(dir, { recursive: true, force: true });
  else console.error('Disposable document retained for diagnosis: ' + file);
}
