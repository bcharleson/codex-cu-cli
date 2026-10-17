// Minimal, bounded MCP transport for the shell CLI. Also used by diagnostics.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function connect({ timeoutMs = 120_000, command = process.execPath,
  args = [fileURLToPath(new URL('./proxy.mjs', import.meta.url))], env = process.env,
  capabilities = {}, onElicitation } = {}) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let nextId = 0, buffer = '', failure, closed = false;
  const send = message => {
    if (failure) throw failure;
    child.stdin.write(JSON.stringify(message) + '\n');
  };
  function fail(err) {
    failure ??= err;
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(failure); }
    pending.clear();
  }
  child.on('error', err => fail(new Error(`Cannot launch server: ${err.message}`)));
  child.on('exit', (code, signal) => fail(new Error(`Server exited (${signal || code})`)));
  child.stdin.on('error', err => fail(new Error(`Server input failed: ${err.message}`)));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { fail(new Error('Server returned invalid JSON on stdout')); close(); return; }
      if (!message || typeof message !== 'object') { fail(new Error('Invalid server message')); close(); return; }
      if (message.method && message.id !== undefined) {
        Promise.resolve().then(async () => {
          if (message.method === 'ping') return { result: {} };
          if (message.method === 'elicitation/create') return { result: onElicitation ? await onElicitation(message.params) : { action: 'decline' } };
          return { error: { code: -32601, message: `Unsupported client method: ${message.method}` } };
        }).then(reply => send({ jsonrpc: '2.0', id: message.id, ...reply })).catch(err => fail(err));
      } else if (message.method == null) {
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
        else waiter.resolve(message.result);
      }
    }
  });
  function close() {
    if (closed) return;
    closed = true;
    fail(new Error('Client closed'));
    child.stdin.end();
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2500);
    timer.unref();
    child.once('close', () => clearTimeout(timer));
  }
  function request(method, params) {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
        // Timed-out actions must not continue unobserved in an orphan server.
        close();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      try { send({ jsonrpc: '2.0', id, method, params }); }
      catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
    });
  }
  let init;
  try {
    init = await request('initialize', { protocolVersion: '2025-06-18', capabilities,
      clientInfo: { name: 'codex-cu-cli', version: '0.1.0' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  } catch (err) { close(); throw err; }
  return {
    init, request, close,
    async call(code, title) {
      const result = await request('tools/call', { name: 'js', arguments: { code, title, timeout_ms: Math.min(90_000, timeoutMs) } });
      const content = result?.content ?? [];
      const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (result?.isError) throw new Error(text.split('\n## ')[0].trim() || 'js tool call failed');
      const images = content.filter(c => c.type === 'image').map(c => Buffer.from(c.data, 'base64'));
      return { text, images };
    },
    async js(code, title) { return (await this.call(code, title)).text; },
  };
}
