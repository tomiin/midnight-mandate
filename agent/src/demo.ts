// Hosted demo mode. Off unless MANDATE_DEMO=1, so Lite on your own machine behaves exactly as before.
// Turns on: guest sessions ("Try the demo"), daily limits per guest and per IP address, REST API keys,
// a public host name, and proxy-aware client IPs. The wallet queue is used in every mode.
import type { IncomingMessage } from 'http';
import { randomBytes, createHash } from 'crypto';

const num = (name: string, dflt: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt; };

export const DEMO = process.env.MANDATE_DEMO === '1';
// The demo's public address, e.g. demo.example.com (no scheme, no path).
export const PUBLIC_HOST = (process.env.PUBLIC_HOST ?? '').trim().toLowerCase();
// TRUST_PROXY=1: a reverse proxy (Caddy, nginx) in front of the app adds X-Forwarded-For.
// TRUST_PROXY=cloudflare: a Cloudflare Tunnel (cloudflared on this machine) forwards requests; Cloudflare
// sets CF-Connecting-IP to the visitor's address (Cloudflare docs recommend it over X-Forwarded-For).
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
export const TRUST_CLOUDFLARE = process.env.TRUST_PROXY === 'cloudflare';
const isLoopback = (a: string) => /^(127\.0\.0\.1|::1)$/.test(a);

export const LIMITS = {
  chatPerIp: num('DEMO_CHAT_PER_IP', 60),        // chat messages per IP address per day (on the agency's key)
  payPerGuest: num('DEMO_PAY_PER_GUEST', 5),     // payment attempts per guest per day
  payPerDay: num('DEMO_PAY_PER_DAY', 40),        // payment attempts for the whole demo per day
  guestsPerIp: num('DEMO_GUESTS_PER_IP', 10),    // new guest sessions per IP address per day
  guestHours: num('DEMO_GUEST_HOURS', 4),        // how long a guest session lasts
  apiKeyHours: num('DEMO_API_KEY_HOURS', 24),    // how long a guest's REST API key lasts
};

// ---------- client IP ----------
// Behind a trusted proxy the real client is the LAST address the proxy appended to X-Forwarded-For
// (earlier entries can be forged by the client). Without a trusted proxy, use the socket address.
export function clientIpFrom(remote: string | undefined, xff: string | string[] | undefined, trustProxy: boolean, cfIp?: string | string[], trustCloudflare = false): string {
  const sock = String(remote ?? '').replace(/^::ffff:/, '');
  // Only cloudflared on this machine can reach a 127.0.0.1-bound server, so the header is trusted from loopback only.
  if (trustCloudflare) { const cf = String(Array.isArray(cfIp) ? cfIp[0] : cfIp ?? '').trim(); return isLoopback(sock) && cf ? cf : sock; }
  if (!trustProxy) return sock;
  const parts = String(Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/^::ffff:/, '') : sock;
}
export const clientIp = (req: IncomingMessage) => clientIpFrom(req.socket.remoteAddress, req.headers['x-forwarded-for'], TRUST_PROXY, req.headers['cf-connecting-ip'], TRUST_CLOUDFLARE);

// ---------- host check ----------
export function hostAllowed(host: string | undefined, port: string, publicHost = PUBLIC_HOST, demo = DEMO): boolean {
  const h = String(host ?? '').toLowerCase();
  if ([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(h)) return true;
  return demo && !!publicHost && (h === publicHost || h === `${publicHost}:443`);
}

// ---------- daily counters (reset at local midnight, kept in memory) ----------
const today = (ts = Date.now()) => new Date(ts).toDateString();
export class DailyCounter {
  private m = new Map<string, { day: string; n: number }>();
  constructor(private now: () => number = Date.now) {}
  used(key: string) { const e = this.m.get(key); return e && e.day === today(this.now()) ? e.n : 0; }
  left(key: string, limit: number) { return limit ? Math.max(0, limit - this.used(key)) : Infinity; }
  // Counts one use and returns true, or returns false when the limit is reached (0 = no limit).
  take(key: string, limit: number) {
    if (limit && this.used(key) >= limit) return false;
    this.m.set(key, { day: today(this.now()), n: this.used(key) + 1 }); return true;
  }
}
export const counters = new DailyCounter();

// Payment limits for guests. Returns a reason when blocked, or null after counting the attempt.
export function guestPayCheck(guestId: string, c = counters, l = LIMITS): string | null {
  if (c.used(`pay:${guestId}`) >= l.payPerGuest && l.payPerGuest) return `Demo limit: ${l.payPerGuest} payments per guest per day. This protects the shared test wallet. Try again tomorrow.`;
  if (c.used('pay:all') >= l.payPerDay && l.payPerDay) return `Demo limit: the demo has made ${l.payPerDay} payments today, which is all the shared test wallet allows. Try again tomorrow.`;
  c.take(`pay:${guestId}`, 0); c.take('pay:all', 0); return null;
}

// ---------- one wallet action at a time ----------
// Payments and owner actions all spend from the same fee wallet. Running two at once can make them
// pick the same coins, so they wait in line.
let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;
export const walletQueueLength = () => waiting;
export function onWallet<T>(fn: () => Promise<T>): Promise<T> {
  waiting++;
  const run = tail.then(fn, fn);
  tail = run.then(() => { waiting--; }, () => { waiting--; });
  return run;
}

// ---------- hardening ----------
// Secrets must never reach a browser, the live feed or a pasted terminal log. Library errors can contain
// the Blockfrost project id inside a URL, so every error text and log line passes through redact().
const SECRET_ENV = ['BLOCKFROST_PREPROD_PROJECT_ID', 'FEE_WALLET_SEED', 'ANTHROPIC_API_KEY'];
export function redact(text: unknown, secrets: string[] = SECRET_ENV.map((k) => (process.env[k] ?? '').trim())): string {
  let s = String(text ?? '');
  for (const v of secrets) if (v && v.length >= 8) s = s.split(v).join('[redacted]');
  return s.replace(/(project_id=)[^&\s"'<>]+/gi, '$1[redacted]').replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]');
}
// Applies redact() to everything this process prints (console.log/info/warn/error).
let consoleWrapped = false;
export function installConsoleRedaction() {
  if (consoleWrapped) return; consoleWrapped = true;
  for (const k of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[k].bind(console);
    console[k] = (...args: any[]) => orig(...args.map((a) => (typeof a === 'string' ? redact(a) : a instanceof Error ? redact(a.stack ?? a.message) : a)));
  }
  // Some libraries write straight to stderr.
  const w = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: any, ...rest: any[]) => w(typeof chunk === 'string' ? redact(chunk) : chunk, ...rest);
  const o = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any, ...rest: any[]) => o(typeof chunk === 'string' ? redact(chunk) : chunk, ...rest);
}

// True when a request came from this machine directly, not through the tunnel or a proxy.
export function fromThisMachine(req: IncomingMessage) {
  const a = String(req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return isLoopback(a) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
}

// Sliding-window rate limit (in memory): at most `limit` hits per `windowMs` for a key.
const windows = new Map<string, number[]>();
export function rateOk(key: string, limit: number, windowMs: number, now = Date.now()) {
  const h = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (h.length >= limit) { windows.set(key, h); return false; }
  h.push(now); windows.set(key, h);
  if (windows.size > 50_000) for (const [k, v] of windows) if (!v.length || now - v[v.length - 1] > windowMs) windows.delete(k);
  return true;
}
export const RATE = { perMinute: num('DEMO_REQ_PER_MIN', 120), verifyPerMinute: num('DEMO_VERIFY_PER_MIN', 20) };
export const MAX_BODY = 64 * 1024; // bytes; the app's real requests are a few KB at most

// Demo defense in depth: no angle brackets in anything a visitor stores, so no stored HTML or script,
// even if a page template ever forgets to escape a field. Also caps string length and nesting.
export function sanitizeInput(v: any, depth = 0): any {
  if (depth > 6) return undefined;
  if (typeof v === 'string') return v.replace(/[<>]/g, '').slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitizeInput(x, depth + 1));
  if (v && typeof v === 'object') { const o: any = {}; for (const [k, x] of Object.entries(v).slice(0, 60)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') o[k] = sanitizeInput(x, depth + 1); return o; }
  return v;
}

// ---------- guest REST API keys ----------
// Shown once to the guest; only a hash is kept, in memory. Expire after LIMITS.apiKeyHours.
const apiKeys = new Map<string, { guestId: string; name: string; exp: number }>();
const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');
export function issueApiKey(guestId: string, name: string, hours = LIMITS.apiKeyHours) {
  for (const [h, v] of apiKeys) if (v.guestId === guestId) apiKeys.delete(h); // one key per guest
  const key = 'mtk_' + randomBytes(24).toString('hex');
  const exp = Date.now() + hours * 3600_000;
  apiKeys.set(hashKey(key), { guestId, name, exp });
  return { key, expiresAt: exp };
}
export function apiKeyOf(req: IncomingMessage): { guestId: string; name: string } | null {
  const m = /^Bearer\s+(mtk_[a-f0-9]{48})$/.exec(String(req.headers.authorization ?? ''));
  if (!m) return null;
  const v = apiKeys.get(hashKey(m[1]));
  if (!v || v.exp < Date.now()) return null;
  return { guestId: v.guestId, name: v.name };
}
