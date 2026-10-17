// Opt-in live smoke: only Calculator is approved; never touches private apps.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from '../lib/scale-fix.mjs';

const main = fileURLToPath(new URL('../lib/main.mjs', import.meta.url));
const env = { ...process.env, CODEX_CU_AUTO_APPROVE: 'Calculator', CODEX_CU_ASK: 'never' };
const run = args => JSON.parse(execFileSync(process.execPath, [main, ...args, '--json'], { env, encoding: 'utf8', timeout: 120_000 }));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-live-'));
try {
  assert.equal(run(['doctor']).ok, true);
  assert.ok(run(['apps']).apps.length > 0);
  assert.equal(run(['demo']).result, '144');
  const shot = path.join(dir, 'calculator.jpg');
  assert.equal(run(['screenshot', 'Calculator', '-o', shot]).ok, true);
  const size = imageSize(fs.readFileSync(shot));
  assert.ok(size?.every(n => n > 100));
  assert.match(run(['state', 'Calculator']).text, /144/);
  console.log('PASS: discovery, transport, app inventory, Calculator input/result, screenshot, state read-back.');
  console.log('Tab-level browsers, other apps, and interactive consent UX are separate acceptance checks.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
