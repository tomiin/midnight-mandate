// Encrypted off-site backup of the agency's private records, stored on Lumera Cascade.
//
// What's backed up: clients and travellers (documents stay encrypted, and the key that unlocks
// them is included INSIDE the encrypted bundle), trips, bookings, staff accounts (password hashes
// only), the audit log, security settings and incidents. Not backed up: the Claude API key and
// other secrets in .env, wallet files, and anything on the Midnight chain (it's already public).
//
// The bundle is sealed on this machine with AES-256-GCM under a key derived (scrypt) from a
// passphrase only the owner knows. Lumera stores ciphertext; without the passphrase it is noise.
// Upload/download reuse the proven Cascade flow in policy/ (run as a child process).
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const AGENT = resolve(here, '..');
const DATA = resolve(AGENT, 'data');
const POLICY = resolve(AGENT, '../policy');
const NET = process.env.MN_NETWORK ?? 'undeployed';
const LOG = resolve(DATA, `backups-${NET}.json`);
const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Which files make up the agency's records for this network.
function recordFiles(): string[] {
  if (!existsSync(DATA)) return [];
  return readdirSync(DATA).filter((f) => f === '.crm-key' || (f.includes(`-${NET}.`) && !f.startsWith('backups-'))).sort();
}

export type Sealed = { format: 'mandate-backup'; v: 1; kdf: 'scrypt'; salt: string; iv: string; tag: string; ct: string };
export const backupInfo = () => ({ files: recordFiles(), wallet: existsSync(join(POLICY, '.env')), network: NET });
export function seal(passphrase: string): { sealed: Sealed; files: string[]; sha256: string } {
  const files = recordFiles();
  const bundle = { app: 'Mandate Travel', network: NET, createdAt: new Date().toISOString(), files: Object.fromEntries(files.map((f) => [f, readFileSync(join(DATA, f)).toString('base64')])) };
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, KDF);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(bundle), 'utf8'), c.final()]);
  const sealed: Sealed = { format: 'mandate-backup', v: 1, kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  return { sealed, files, sha256: createHash('sha256').update(JSON.stringify(sealed)).digest('hex') };
}
export function unseal(sealed: Sealed, passphrase: string): { network: string; createdAt: string; files: Record<string, string> } {
  if (sealed?.format !== 'mandate-backup') throw new Error('This is not a Mandate Travel backup.');
  const key = scryptSync(passphrase, Buffer.from(sealed.salt, 'base64'), 32, KDF);
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  try { return JSON.parse(Buffer.concat([d.update(Buffer.from(sealed.ct, 'base64')), d.final()]).toString('utf8')); }
  catch { throw new Error('Wrong passphrase, or the backup was altered.'); }
}

// ---------- Cascade, via the policy/ scripts ----------
function runPolicy(script: string, args: string[], extraNodeArgs: string[] = []): Promise<any> {
  const req = createRequire(join(AGENT, 'package.json'));
  const tsxCli = join(dirname(req.resolve('tsx/package.json')), 'dist', 'cli.mjs');
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, [...extraNodeArgs, tsxCli, `src/${script}.ts`, ...args], { cwd: POLICY, env: { ...process.env, NODE_OPTIONS: '' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => { p.kill(); fail(new Error('Cascade timed out after 5 minutes.')); }, 5 * 60_000);
    p.on('close', () => {
      clearTimeout(timer);
      const r = out.split('\n').find((l) => l.startsWith('RESULT ')), e = out.split('\n').find((l) => l.startsWith('ERROR '));
      if (r) return ok(JSON.parse(r.slice(7)));
      const msg = e ? JSON.parse(e.slice(6)).error : (err.trim().split('\n').pop() || 'Cascade step failed');
      fail(new Error(msg));
    });
  });
}
const eventsourceArgs = () => { const major = Number(process.versions.node.split('.')[0]); return major >= 22 && major < 25 ? ['--experimental-eventsource'] : []; };

export type BackupEntry = { actionId: string; at: number; by: string; bytes: number; sha256: string; files: string[]; chainId: string; expires: string };
export const listBackups = (): BackupEntry[] => { try { return existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : []; } catch { return []; } };

export async function backupToCascade(passphrase: string, by: string): Promise<BackupEntry> {
  if (String(passphrase).length < 12) throw new Error('Use a backup passphrase of at least 12 characters. Store it in your password manager: without it the backup cannot be opened.');
  if (!existsSync(join(POLICY, '.env'))) throw new Error('No Lumera wallet found (policy/.env). Run `npm run generate-wallet` in policy/ first.');
  const { sealed, files, sha256 } = seal(passphrase);
  mkdirSync(DATA, { recursive: true });
  const tmp = join(DATA, `.outgoing-${Date.now()}.enc.json`);
  writeFileSync(tmp, JSON.stringify(sealed), { mode: 0o600 });
  try {
    const r = await runPolicy('upload-file', [tmp, `mandate-travel-backup-${new Date().toISOString().slice(0, 10)}.enc.json`, '90']);
    const e: BackupEntry = { actionId: r.actionId, at: Date.now(), by, bytes: readFileSync(tmp).length, sha256, files, chainId: r.chainId, expires: new Date(Number(r.expirationTime) * 1000).toISOString() };
    const all = listBackups(); all.unshift(e); writeFileSync(LOG, JSON.stringify(all.slice(0, 100), null, 2), { mode: 0o600 });
    return e;
  } finally { try { unlinkSync(tmp); } catch {} }
}

// Restore: fetch from Cascade (or use a local file), decrypt with the passphrase, keep a copy of the
// current records, then write the backed-up files back. The app must restart to load them.
export async function restoreFromCascade(actionId: string, passphrase: string): Promise<{ files: string[]; createdAt: string; snapshot: string }> {
  if (!/^\d{1,20}$/.test(actionId)) throw new Error('Backup ID should be a number, e.g. 88231.');
  const tmp = join(DATA, `.incoming-${actionId}.enc.json`);
  try { await runPolicy('download-file', [actionId, tmp], eventsourceArgs()); }
  catch (e: any) { if (/bad option|eventsource/i.test(e.message)) await runPolicy('download-file', [actionId, tmp]); else throw e; }
  try { return restoreSealed(JSON.parse(readFileSync(tmp, 'utf8')), passphrase); } finally { try { unlinkSync(tmp); } catch {} }
}
export function restoreSealed(sealed: Sealed, passphrase: string) {
  const b = unseal(sealed, passphrase);
  if (b.network !== NET) throw new Error(`This backup is for the ${b.network} network; the app is running on ${NET}.`);
  const snapshot = join(DATA, `pre-restore-${Date.now()}`); mkdirSync(snapshot, { recursive: true });
  for (const f of recordFiles()) copyFileSync(join(DATA, f), join(snapshot, f));
  const names = Object.keys(b.files).filter((f) => !/[\\/]/.test(f)); // file names only, no paths
  for (const f of names) writeFileSync(join(DATA, f), Buffer.from(b.files[f], 'base64'), { mode: 0o600 });
  return { files: names, createdAt: b.createdAt, snapshot };
}
