// Read the current installed plugin on each launch. No OpenAI code is bundled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const PLUGIN_ROOT = path.join(CODEX_HOME, 'plugins/cache/openai-bundled/unified-computer-use');
export class DiscoveryError extends Error {}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

export function findServerConfig(root = PLUGIN_ROOT) {
  let versions;
  try {
    versions = fs.readdirSync(root, { withFileTypes: true })
      .filter(d => (d.isDirectory() || d.isSymbolicLink()) && /^\d+(?:\.\d+)*$/.test(d.name))
      .map(d => d.name).filter(v => fs.existsSync(path.join(root, v, '.mcp.json')))
      .sort(compareVersions);
  } catch (err) {
    throw new DiscoveryError(`Cannot read Codex computer-use plugins at ${root}: ${err.code}.\nOpen ChatGPT desktop, open Codex, and enable Computer Use once.`);
  }
  const version = versions.at(-1);
  if (!version) throw new DiscoveryError(`No installed plugin with a .mcp.json under ${root}. Enable Computer Use in ChatGPT/Codex first.`);
  const directory = path.join(root, version);
  const file = path.join(directory, '.mcp.json');
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers?.cua_repl;
  } catch (err) {
    throw new DiscoveryError(`Cannot read ${file}: ${err.message}`);
  }
  if (!entry || typeof entry.command !== 'string' || !entry.command.trim() ||
      (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(a => typeof a !== 'string'))) ||
      (entry.env !== undefined && (!entry.env || Array.isArray(entry.env) || typeof entry.env !== 'object' || Object.values(entry.env).some(v => typeof v !== 'string')))) {
    throw new DiscoveryError(`${file} has an invalid mcpServers.cua_repl command, args, or env.`);
  }
  // Plugin manifests may use the standard plugin-root placeholder.
  const expand = value => value.replaceAll('${CLAUDE_PLUGIN_ROOT}', directory).replaceAll('${CODEX_PLUGIN_ROOT}', directory);
  const config = { version, file, command: expand(entry.command), args: (entry.args ?? []).map(expand),
    env: Object.fromEntries(Object.entries(entry.env ?? {}).map(([k, v]) => [k, expand(v)])) };
  if (/\$\{/.test(config.command) || config.args.some(v => /\$\{/.test(v))) {
    throw new DiscoveryError(`${file} contains an unsupported command placeholder. Update codex-cu-mcp for this plugin version.`);
  }
  return config;
}

export function checkServerFiles(config) {
  const files = [['server runtime', config.command, true],
    ['server script', config.args.find(a => /\.(?:mjs|cjs|js)$/.test(a)), false],
    ['Computer Use service', config.env.SKY_CUA_SERVICE_PATH, false]];
  return files.filter(([, file]) => file && path.isAbsolute(file)).map(([label, file, executable]) => {
    try {
      fs.accessSync(file, executable ? fs.constants.X_OK : fs.constants.R_OK);
      return { label, file, ok: true };
    } catch {
      return { label, file, ok: false };
    }
  });
}
