// Hosted demo mode. Off unless MANDATE_DEMO=1, so Lite on your own machine behaves exactly as before.
// Turns on: guest sessions ("Try the demo"), daily limits per guest and per IP address, REST API keys,
// a public host name, and proxy-aware client IPs. The wallet queue is used in every mode.
import type { IncomingMessage } from 'http';
import { randomBytes, createHash } from 'crypto';

const num = (name: string, dflt: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt; };

export const DEMO = process.env.MANDATE_DEMO === '1';
// The demo's public address, e.g. demo.example.com (no scheme, no path).
export const PUBLIC_HOST = (process.env.PUBLIC_HOST ?? '').trim().toLowerCase();
// Set when a reverse proxy (Caddy, nginx) in front of the app adds X-Forwarded-For.
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';

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
export function clientIpFrom(remote: string | undefined, xff: string | string[] | undefined, trustProxy: boolean): string {
  const sock = String(remote ?? '').replace(/^::ffff:/, '');
  if (!trustProxy) return sock;
  const parts = String(Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1].replace(/^::ffff:/, '') : sock;
}
export const clientIp = (req: IncomingMessage) => clientIpFrom(req.socket.remoteAddress, req.headers['x-forwarded-for'], TRUST_PROXY);

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
