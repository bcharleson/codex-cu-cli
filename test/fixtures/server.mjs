// Synthetic MCP upstream: no macOS, network, account, or personal data needed.
import readline from 'node:readline';
const prompts = new Map();
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
if (process.env.FAKE_MODE === 'invalid') process.stdout.write('invalid JSON\n');
if (process.env.FAKE_MODE === 'exit') process.exit(7);
if (process.env.FAKE_PID_FILE) (await import('node:fs')).writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  const m = JSON.parse(line);
  if (process.env.FAKE_MODE === 'hang') return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: ['js', 'js_reset', 'turn_ended'].map(name => ({ name, description: name, inputSchema: { type: 'object' } })) } });
  else if (m.method === 'tools/call') {
    const code = m.params.arguments?.code ?? '';
    if (process.env.FAKE_AX_TREE && code.includes('app.click(')) {
      let clicked;
      const app = { getAXState: async () => process.env.FAKE_AX_TREE, click: async target => { clicked = target; } };
      try {
        await new Function('app', `return (async () => { ${code} })();`)(app);
        send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ clicked }) }] } });
      } catch (err) { send({ id: m.id, result: { isError: true, content: [{ type: 'text', text: err.message }] } }); }
    } else if (code.startsWith('prompt:')) {
      const id = `prompt-${m.id}`;
      prompts.set(id, m.id);
      send({ id, method: 'elicitation/create', params: { message: code.slice(7), requestedSchema: { type: 'object', properties: {} } } });
    } else if (code === 'tool-error') send({ id: m.id, result: { isError: true, content: [{ type: 'text', text: 'fixture action failed' }] } });
    else if (code.includes('cua.getState')) send({ id: m.id, result: { content: [{ type: 'text', text: 'Docs\n' + JSON.stringify({ apps: [{ displayName: 'Fixture', isRunning: true }], browsers: [], errors: process.env.FAKE_INVENTORY_ERROR ? ['Fixture permission denied'] : [] }) }] } });
    else send({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(m.params) }] } });
  } else if (!m.method && prompts.has(m.id)) {
    send({ id: prompts.get(m.id), result: { content: [{ type: 'text', text: JSON.stringify(m.result ?? m.error) }] } });
    prompts.delete(m.id);
  }
});
rl.on('close', () => process.exit(0));
