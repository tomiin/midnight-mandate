// Adds the Mandate MCP server to Claude Desktop's config (keeps everything else, writes a backup first).
// Run from midnight-mandate/agent:  node scripts/install-claude-desktop.mjs
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(agentDir, 'package.json'));
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
const cfgPath = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

mkdirSync(dirname(cfgPath), { recursive: true });
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
if (existsSync(cfgPath)) copyFileSync(cfgPath, cfgPath + '.bak-mandate');
cfg.mcpServers ??= {};
cfg.mcpServers.mandate = {
  command: process.execPath,
  args: [tsxCli, join(agentDir, 'src', 'mcp.ts')],
  env: { MN_NETWORK: process.env.MN_NETWORK ?? 'undeployed', NODE_OPTIONS: '--max-old-space-size=16384' },
};
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log(`Added "mandate" to ${cfgPath}`);
console.log(`node: ${process.execPath}\ntsx:  ${tsxCli}`);
console.log('Quit Claude Desktop fully (Cmd+Q) and reopen it to load the tools.');
