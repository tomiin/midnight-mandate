// Owner sign-in for Mandate Travel Lite. Off chain, on the agency's machine.
// One owner account: password stored as a scrypt hash, session in an HttpOnly cookie.
// (The full Mandate Travel edition adds staff accounts, roles, 2-step sign-in and lockouts.)
import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { emit } from './merchants.js';
import { readAudit } from './audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, `../data/users-${process.env.MN_NETWORK ?? 'undeployed'}.json`);
export type Role = 'owner';
export type User = { id: string; name: string; username: string; role: Role; pw: string; active: boolean; createdAt: number; lastLogin?: number };

let users: User[] = [];
try { users = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []; } catch { users = []; }
const save = () => { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(users, null, 2), { mode: 0o600 }); renameSync(FILE + '.tmp', FILE); };
const pub = (u: User): any => { const { pw, ...rest } = u; return rest; };
const hashPw = (p: string) => { const salt = randomBytes(16); return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`; };
const checkPw = (p: string, stored: string) => { const [s, h] = stored.split(':'); const a = scryptSync(p, Buffer.from(s, 'hex'), 32); const b = Buffer.from(h, 'hex'); return a.length === b.length && timingSafeEqual(a, b); };
export const audit = (actor: string, action: string, detail?: string, ip?: string) => emit('audit', { actor, action, detail, ip });

const sessions = new Map<string, { userId: string; exp: number }>();
const TTL = 12 * 3600_000;
const fails = new Map<string, { n: number; until: number }>();
const cookieOf = (req: IncomingMessage) => /(?:^|;\s*)mtl_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? '')?.[1];
const ipOf = (req: IncomingMessage) => String(req.socket.remoteAddress ?? '').replace('::ffff:', '');
export function userOf(req: IncomingMessage): User | null {
  const t = cookieOf(req); if (!t) return null;
  const s = sessions.get(t); if (!s || s.exp < Date.now()) { sessions.delete(t); return null; }
  return users.find((x) => x.id === s.userId && x.active) ?? null;
}
export const label = (u: User) => `${u.name} (owner)`;
function startSession(res: ServerResponse, u: User) {
  const t = randomBytes(32).toString('hex'); sessions.set(t, { userId: u.id, exp: Date.now() + TTL });
  res.setHeader('Set-Cookie', `mtl_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}`);
}
const json = (res: ServerResponse, code: number, o: any) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
async function bodyOf(req: IncomingMessage) { let r = ''; for await (const c of req) { r += c; if (r.length > 1e5) break; } try { return JSON.parse(r || '{}'); } catch { return {}; } }

// Handles /login, /api/auth/*, /api/audit. Returns true if it answered.
export async function authRoutes(req: IncomingMessage, res: ServerResponse, loginPage: () => string): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0]; const m = req.method ?? 'GET'; const ip = ipOf(req);
  if (url === '/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(loginPage()); return true; }
  if (url === '/api/auth/state') { const u = userOf(req); json(res, 200, { setupNeeded: users.length === 0, user: u ? pub(u) : null, team: u ? [{ name: u.name, role: 'owner' }] : [] }); return true; }
  if (url === '/api/auth/setup' && m === 'POST') {
    if (users.length) return json(res, 403, { error: 'Setup is already done. Sign in instead.' }), true;
    const b = await bodyOf(req); const username = String(b.username ?? '').trim().toLowerCase();
    if (!String(b.name ?? '').trim() || !/^[a-z0-9._-]{3,32}$/.test(username) || String(b.password ?? '').length < 12) return json(res, 400, { error: 'Enter a name, a username (3–32 letters, numbers, . _ -) and a password of at least 12 characters.' }), true;
    const u: User = { id: 'u_' + randomBytes(5).toString('hex'), name: String(b.name).trim().slice(0, 60), username, role: 'owner', pw: hashPw(String(b.password)), active: true, createdAt: Date.now(), lastLogin: Date.now() };
    users.push(u); save(); startSession(res, u); audit(label(u), 'account created', 'Owner account set up', ip);
    return json(res, 200, { user: pub(u) }), true;
  }
  if (url === '/api/auth/login' && m === 'POST') {
    const f = fails.get(ip); if (f && f.until > Date.now()) return json(res, 429, { error: 'Too many attempts. Wait a minute and try again.' }), true;
    const b = await bodyOf(req); const username = String(b.username ?? '').trim().toLowerCase();
    const u = users.find((x) => x.username === username);
    if (!u || !checkPw(String(b.password ?? ''), u.pw)) {
      const n = (f?.n ?? 0) + 1; fails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      audit(username || 'unknown', 'sign-in failed', 'wrong username or password', ip);
      return json(res, 401, { error: 'Wrong username or password.' }), true;
    }
    fails.delete(ip); u.lastLogin = Date.now(); save(); startSession(res, u); audit(label(u), 'signed in', undefined, ip);
    return json(res, 200, { user: pub(u) }), true;
  }
  if (url === '/api/auth/logout' && m === 'POST') {
    const u = userOf(req); const t = cookieOf(req); if (t) sessions.delete(t);
    if (u) audit(label(u), 'signed out', undefined, ip);
    res.setHeader('Set-Cookie', 'mtl_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }), true;
  }
  if (url === '/api/audit') {
    const me = userOf(req); if (!me) return json(res, 401, { error: 'Sign in first.' }), true;
    return json(res, 200, { entries: readAudit().slice(-300).reverse() }), true;
  }
  return false;
}
// Names on the account, for the privacy proxy (so they are never sent to the AI).
export const teamList = () => users.map((u) => ({ id: u.id, name: u.name }));
