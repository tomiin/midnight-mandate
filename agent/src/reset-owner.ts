// Reset the owner's password from the machine that runs Mandate Travel Lite.
// Only someone with access to this computer (and its data/ folder) can do this.
// Usage:  npm run reset-owner          (then restart `npm run serve`)
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { randomBytes, scryptSync } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), `../data/users-${process.env.MN_NETWORK ?? 'undeployed'}.json`);
if (!existsSync(FILE)) { console.log('No owner account yet. Start the app and create one at /login.'); process.exit(0); }
const users = JSON.parse(readFileSync(FILE, 'utf8'));
const owner = users.find((u: any) => u.role === 'owner');
if (!owner) { console.log('No owner account found.'); process.exit(1); }

// Read a line without echoing it to the screen.
function ask(q: string): Promise<string> {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    (rl as any)._writeToOutput = (s: string) => { if (s.startsWith(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); ok(a); });
  });
}

console.log(`Owner account: ${owner.name}  (username: ${owner.username})`);
const p1 = await ask('New password (12+ characters): ');
const p2 = await ask('Repeat it: ');
if (p1.length < 12) { console.log('Too short. Nothing changed.'); process.exit(1); }
if (p1 !== p2) { console.log("The two passwords don't match. Nothing changed."); process.exit(1); }
const salt = randomBytes(16);
owner.pw = `${salt.toString('hex')}:${scryptSync(p1, salt, 32).toString('hex')}`;
writeFileSync(FILE + '.tmp', JSON.stringify(users, null, 2), { mode: 0o600 }); renameSync(FILE + '.tmp', FILE);
console.log(`Password changed. Restart the app (Ctrl+C, then npm run serve) and sign in as "${owner.username}".`);
