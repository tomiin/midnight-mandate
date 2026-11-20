import { describe, it, expect } from 'vitest';
import { clientIpFrom, hostAllowed, DailyCounter, guestPayCheck, onWallet, issueApiKey, apiKeyOf } from '../src/demo.js';

describe('demo: client IP', () => {
  it('uses the socket address when no proxy is trusted, even if X-Forwarded-For is sent', () => {
    expect(clientIpFrom('::ffff:10.0.0.5', '1.2.3.4', false)).toBe('10.0.0.5');
  });
  it('behind a trusted proxy uses the last X-Forwarded-For entry (earlier ones can be forged)', () => {
    expect(clientIpFrom('172.18.0.2', 'forged.1, 203.0.113.9', true)).toBe('203.0.113.9');
  });
  it('falls back to the socket address when the proxy sent no header', () => {
    expect(clientIpFrom('172.18.0.2', undefined, true)).toBe('172.18.0.2');
  });
});

describe('demo: host check', () => {
  it('always allows this machine', () => {
    expect(hostAllowed('localhost:4500', '4500', '', false)).toBe(true);
    expect(hostAllowed('127.0.0.1:4500', '4500', '', false)).toBe(true);
  });
  it('allows the public host only in demo mode', () => {
    expect(hostAllowed('demo.example.com', '4500', 'demo.example.com', true)).toBe(true);
    expect(hostAllowed('demo.example.com', '4500', 'demo.example.com', false)).toBe(false);
  });
  it('rejects other hosts (DNS rebinding)', () => {
    expect(hostAllowed('evil.example', '4500', 'demo.example.com', true)).toBe(false);
    expect(hostAllowed('localhost:9999', '4500', '', true)).toBe(false);
  });
});

describe('demo: daily counters', () => {
  it('counts up to the limit, then refuses; 0 means no limit', () => {
    const c = new DailyCounter();
    expect(c.take('a', 2)).toBe(true);
    expect(c.take('a', 2)).toBe(true);
    expect(c.take('a', 2)).toBe(false);
    expect(c.used('a')).toBe(2);
    for (let i = 0; i < 50; i++) expect(c.take('b', 0)).toBe(true);
  });
  it('resets on a new day', () => {
    let now = new Date('2026-11-20T10:00:00').getTime();
    const c = new DailyCounter(() => now);
    c.take('a', 1); expect(c.take('a', 1)).toBe(false);
    now = new Date('2026-11-21T10:00:00').getTime();
    expect(c.take('a', 1)).toBe(true);
  });
});

describe('demo: guest payment limits', () => {
  const limits = { chatPerIp: 0, payPerGuest: 2, payPerDay: 3, guestsPerIp: 0, guestHours: 4, apiKeyHours: 24 };
  it('allows each guest a few payments and the whole demo a daily total', () => {
    const c = new DailyCounter();
    expect(guestPayCheck('g1', c, limits)).toBeNull();
    expect(guestPayCheck('g1', c, limits)).toBeNull();
    expect(guestPayCheck('g1', c, limits)).toMatch(/per guest/);
    expect(guestPayCheck('g2', c, limits)).toBeNull();
    expect(guestPayCheck('g3', c, limits)).toMatch(/demo has made 3 payments/);
  });
});

describe('demo: wallet queue', () => {
  it('runs wallet actions one at a time, in order, even if one fails', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number, fail = false) => () => new Promise<string>((ok, bad) => {
      log.push(`start ${name}`); setTimeout(() => { log.push(`end ${name}`); fail ? bad(new Error(name)) : ok(name); }, ms);
    });
    const a = onWallet(job('a', 30)); const b = onWallet(job('b', 5, true)); const c = onWallet(job('c', 1));
    await expect(a).resolves.toBe('a'); await expect(b).rejects.toThrow('b'); await expect(c).resolves.toBe('c');
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});

describe('demo: API keys', () => {
  const req = (auth?: string) => ({ headers: auth ? { authorization: auth } : {} }) as any;
  it('accepts a fresh key and links it to the guest', () => {
    const { key } = issueApiKey('g_1', 'Guest AB12');
    expect(apiKeyOf(req(`Bearer ${key}`))).toEqual({ guestId: 'g_1', name: 'Guest AB12' });
  });
  it('rejects missing, malformed, unknown and replaced keys', () => {
    expect(apiKeyOf(req())).toBeNull();
    expect(apiKeyOf(req('Bearer nope'))).toBeNull();
    expect(apiKeyOf(req(`Bearer mtk_${'0'.repeat(48)}`))).toBeNull();
    const first = issueApiKey('g_2', 'Guest CD34').key; issueApiKey('g_2', 'Guest CD34');
    expect(apiKeyOf(req(`Bearer ${first}`))).toBeNull();
  });
  it('rejects an expired key', () => {
    const { key } = issueApiKey('g_3', 'Guest EF56', -1);
    expect(apiKeyOf(req(`Bearer ${key}`))).toBeNull();
  });
});
