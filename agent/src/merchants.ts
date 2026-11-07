// Back office (simulated travel providers), orders, and the live demo page.
// The fares are invented; the payments are real Mandate proofs on chain, and each merchant
// re-checks the payment against the public ledger before marking an order paid.
import { createServer, type ServerResponse, type IncomingMessage } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { renderInvoice } from './invoices.js';
import { appendAudit } from './audit.js';
import { getTrip } from './crm.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- back office: travel providers ----------
// Each provider is a plug-in slot. Today every slot is SIMULATED (invented, deterministic inventory).
// When a real partner API is available (e.g. an OTA affiliate/partner API), replace that provider's
// search functions with the real connector; nothing else changes. Simulated providers are not
// affiliated with or endorsed by the brands they are named after.
export type Kind = 'flights' | 'hotels';
type Provider = { id: string; name: string; kinds: Kind[]; mult: number; simulated: boolean };
export const PROVIDERS: Provider[] = [
  { id: 'cheapair', name: 'CheapAir', kinds: ['flights'], mult: 0.82, simulated: true },
  { id: 'skylark', name: 'Skylark', kinds: ['flights'], mult: 1.12, simulated: true },
  { id: 'coastal', name: 'Coastal Airways', kinds: ['flights'], mult: 0.97, simulated: true },
  { id: 'expedia', name: 'Expedia', kinds: ['flights', 'hotels'], mult: 0.95, simulated: true },
  { id: 'priceline', name: 'Priceline', kinds: ['flights', 'hotels'], mult: 0.9, simulated: true },
  { id: 'tripcom', name: 'Trip.com', kinds: ['flights', 'hotels'], mult: 0.88, simulated: true },
  { id: 'hotelscom', name: 'Hotels.com', kinds: ['hotels'], mult: 1.0, simulated: true },
  { id: 'bookingcom', name: 'Booking.com', kinds: ['hotels'], mult: 0.97, simulated: true },
  { id: 'staywell', name: 'StayWell Hotels', kinds: ['hotels'], mult: 1.05, simulated: true },
];
export const providerIds = (k: Kind) => PROVIDERS.filter((p) => p.kinds.includes(k)).map((p) => p.id);
const prov = (id: string) => PROVIDERS.find((p) => p.id === id);
const label = (p: Provider) => p.simulated ? `${p.name} (simulated)` : p.name;

const ROUTES: Record<string, { city: string; base: number; hotel: number }> = {
  LIS: { city: 'Lisbon', base: 290, hotel: 160 }, BCN: { city: 'Barcelona', base: 310, hotel: 190 }, CDG: { city: 'Paris', base: 340, hotel: 240 },
  LHR: { city: 'London', base: 360, hotel: 250 }, NAS: { city: 'Nassau', base: 210, hotel: 280 }, MIA: { city: 'Miami', base: 160, hotel: 220 },
  JFK: { city: 'New York', base: 180, hotel: 300 }, CUN: { city: 'Cancún', base: 230, hotel: 200 },
};
const CITY_TO_CODE = Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [v.city.toLowerCase(), k]));
export const destinations = () => Object.entries(ROUTES).map(([code, r]) => `${r.city} (${code})`);

// Deterministic pseudo-random so the same search always shows the same results.
const rand = (seed: string) => { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000; };

export function resolveDestination(input: string) {
  const s = input.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (ROUTES[s.toUpperCase()]) return s.toUpperCase();
  if (CITY_TO_CODE[s]) return CITY_TO_CODE[s];
  return Object.keys(ROUTES).find((k) => s.includes(ROUTES[k].city.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) || new RegExp(`\\b${k.toLowerCase()}\\b`).test(s)) ?? null;
}

// Search results are remembered so booking can only use an offer the provider actually made.
const offered = new Map<string, any>();
export const findFare = (id: string) => offered.get(id) ?? null;
export const findRoom = (id: string) => offered.get(id) ?? null;

export function searchFlights(providerId: string, destination: string, date: string) {
  const p = prov(providerId);
  if (!p || !p.kinds.includes('flights')) return { error: `Unknown flight provider "${providerId}". Use one of: ${providerIds('flights').join(', ')}` };
  const code = resolveDestination(destination);
  if (!code) return { provider: label(p), error: `No routes to "${destination}". Served: ${destinations().join(', ')}` };
  const r = rand(`${p.id}|${code}|${date}`);
  const times = ['06:10', '08:45', '11:30', '14:05', '17:20', '21:40'];
  const carriers = ['TAP', 'Iberia', 'United', 'Lufthansa', 'Delta', 'Air France'];
  const fares = Array.from({ length: 3 + Math.floor(r() * 2) }, (_, i) => {
    const price = Math.round(ROUTES[code].base * p.mult * (0.85 + r() * 0.5));
    const stops = r() < 0.55 ? 0 : 1;
    const carrier = p.id === 'cheapair' || p.id === 'skylark' || p.id === 'coastal' ? p.name : carriers[Math.floor(r() * carriers.length)];
    return { fareId: `${p.id}~${code}~${date}~${i}`, provider: label(p), carrier, depart: times[Math.floor(r() * times.length)], stops, durationH: +(3 + r() * 6 + stops * 2).toFixed(1), priceUsd: price };
  }).sort((a, b) => a.priceUsd - b.priceUsd);
  const to = `${ROUTES[code].city} (${code})`;
  for (const f of fares) offered.set(f.fareId, { merchant: label(p), item: `Flight to ${to}, ${date} ${f.depart}, ${f.carrier}, ${f.stops ? '1 stop' : 'nonstop'}`, amount: f.priceUsd });
  return { provider: label(p), airline: label(p), to, date, fares };
}

export function searchHotels(providerId: string, city: string, date: string) {
  const p = prov(providerId);
  if (!p || !p.kinds.includes('hotels')) return { error: `Unknown hotel provider "${providerId}". Use one of: ${providerIds('hotels').join(', ')}` };
  const code = resolveDestination(city);
  if (!code) return { provider: label(p), error: `No hotels in "${city}"` };
  // Same hotels on every provider; price follows star rating, and each provider prices slightly differently.
  const hotels: [string, number][] = [['Hotel Avenida', 3], ['Casa Lumen', 3], ['The Harbour Inn', 4], ['Riverside Suites', 4], ['Palácio Azul', 5], ['Grand Meridian', 5]];
  const r = rand(`hotel|${code}|${date}`);
  const rooms = hotels.map(([n, stars], i) => {
    const base = ROUTES[code].hotel * (0.6 + (stars - 3) * 0.45 + r() * 0.2);
    const pr = rand(`${p.id}|${n}|${date}`)();
    return { roomId: `${p.id}~${code}~${date}~${i}`, provider: label(p), hotel: n, stars, nightly: Math.round(base * p.mult * (0.92 + pr * 0.16)) };
  }).filter((_, i) => rand(`${p.id}|avail|${code}|${i}`)() > 0.2).sort((a, b) => a.nightly - b.nightly);
  for (const x of rooms) offered.set(x.roomId, { merchant: label(p), item: `${x.hotel} (${x.stars}★), ${ROUTES[code].city}, 1 night from ${date}`, amount: x.nightly });
  return { provider: label(p), merchant: label(p), city: ROUTES[code].city, date, rooms };
}

// "Google-like" search: one free-text query, fanned out across every connected provider.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function parseQuery(q: string) {
  const s = q.toLowerCase();
  const kind: Kind = /hotel|room|stay|night|accommodation|lodging/.test(s) ? 'hotels' : 'flights';
  let date = s.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1];
  if (!date) {
    const m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/) ?? s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
    if (m) {
      const [mon, day] = isNaN(Number(m[1])) ? [m[1], m[2]] : [m[2], m[1]];
      const mi = MONTHS.indexOf(mon.slice(0, 3)); const now = new Date();
      let y = now.getFullYear(); if (new Date(y, mi, Number(day)) < now) y++;
      date = `${y}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const max = s.match(/(?:under|below|max(?:imum)?|less than|<)\s*\$?\s*(\d+)/)?.[1];
  const st = s.match(/\b([345])\s*-?\s*(?:star|★)/)?.[1] ?? (/luxury|five.star/.test(s) ? '5' : /four.star/.test(s) ? '4' : undefined);
  return { kind, destination: resolveDestination(s), date: date ?? null, maxPrice: max ? Number(max) : null, minStars: kind === 'hotels' && st ? Number(st) : null };
}
export function searchTravel(query: string) {
  const q = parseQuery(query);
  if (!q.destination) return { query, error: `Could not find a destination in "${query}". Served: ${destinations().join(', ')}` };
  if (!q.date) return { query, error: 'Please include a date, e.g. 2026-11-14 or "Nov 14".' };
  const ids = providerIds(q.kind);
  const all: any[] = q.kind === 'flights'
    ? ids.flatMap((id) => (searchFlights(id, q.destination!, q.date!) as any).fares ?? [])
    : ids.flatMap((id) => ((searchHotels(id, q.destination!, q.date!) as any).rooms ?? []).map((r: any) => ({ ...r, priceUsd: r.nightly })));
  const within = all.filter((x) => (q.maxPrice == null || x.priceUsd <= q.maxPrice) && (q.minStars == null || (x.stars ?? 0) >= q.minStars)).sort((a, b) => a.priceUsd - b.priceUsd);
  if (/most expensive|priciest|highest price|top of the range/.test(query.toLowerCase())) within.reverse(); // show the top end first when asked
  return { query, understood: q, providersSearched: ids.map((id) => label(prov(id)!)), results: within.slice(0, 12), totalFound: all.length, note: 'All providers are simulated until real partner APIs are connected.' };
}
// ---------- orders ----------
export type Order = { id: string; offerId?: string; client?: string; agent?: string; merchant: string; item: string; amount: number; status: 'awaiting_payment' | 'needs_approval' | 'rejected' | 'paid' | 'refused' | 'cancelled'; tripId?: string; qty?: number; unitPrice?: number; travellerIds?: string[]; approvedBy?: string; txId?: string; blockHeight?: number; verified?: string; period?: number; orderRef?: string; contract?: string; createdAt: number; requestedBy?: string; paidBy?: string };
const orders = new Map<string, Order>();
// Order ids must be unique across every copy of the server (one per AI chat), so they are time-based.
const newOrderId = () => `NA-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`;
export const AGENT_NAME = process.env.AGENT_NAME ?? 'Booking agent (Claude)';
export function createOrder(merchant: string, item: string, amount: number, offerId?: string, client?: string, requestedBy?: string, extra: Partial<Order> = {}) {
  // Booking the same offer twice returns the existing unpaid order instead of a duplicate.
  const existing = offerId && [...orders.values()].find((x) => x.offerId === offerId && x.tripId === extra.tripId && (x.status === 'awaiting_payment' || x.status === 'needs_approval'));
  if (existing) return { ...existing, note: 'Already booked; reusing the unpaid order.' };
  const o: Order = { id: newOrderId(), offerId, client: client?.trim() || 'Unassigned', agent: AGENT_NAME, merchant, item, amount, status: 'awaiting_payment', createdAt: Date.now(), requestedBy, ...extra };
  orders.set(o.id, o); emit('order', o); return o;
}
export const openOrders = () => [...orders.values()].filter((o) => o.status === 'awaiting_payment');
export const getOrder = (id: string) => orders.get(id);
export function updateOrder(id: string, patch: Partial<Order>) { const o = orders.get(id)!; Object.assign(o, patch); emit('order', o); return o; }

// ---------- live activity feed (Server-Sent Events) ----------
const clients = new Set<ServerResponse>();
const history: any[] = [];
// Claude Desktop starts one copy of this server per chat. The first copy owns the page;
// the others forward their events to it, so one page shows every agent's activity.
let ownsPage = false;
const PORT = Number(process.env.DEMO_PORT ?? 4400);
// Agency records: the private, off-chain book of every purchase (client, agent, merchant, amount,
// on-chain receipt). Kept only on the agency's machine; none of this is ever written to the chain.
const remoteOrders = new Map<string, Order>();
const RECORDS = resolve(here, `../data/records-${process.env.MN_NETWORK ?? 'undeployed'}.json`);
let saveTimer: any;
function loadRecords() {
  try { if (existsSync(RECORDS)) for (const o of JSON.parse(readFileSync(RECORDS, 'utf8'))) remoteOrders.set(o.id, o); } catch (e: any) { console.error(`[records] could not load: ${e.message}`); }
}
function saveRecords() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { mkdirSync(dirname(RECORDS), { recursive: true }); writeFileSync(RECORDS + '.tmp', JSON.stringify([...remoteOrders.values()], null, 2)); renameSync(RECORDS + '.tmp', RECORDS); }
    catch (e: any) { console.error(`[records] could not save: ${e.message}`); }
  }, 300);
}
export const allRecords = () => [...remoteOrders.values()].sort((a, b) => a.createdAt - b.createdAt);
function broadcast(ev: any) {
  if (ev.type === 'audit') { if (ownsPage) { try { appendAudit({ ...ev.data, at: ev.at }); } catch (e: any) { console.error(`[audit] ${e.message}`); } } return; } // private: never broadcast
  history.push(ev); if (history.length > 300) history.shift();
  if (ev.type === 'order') { remoteOrders.set(ev.data.id, { ...(remoteOrders.get(ev.data.id) ?? {}), ...ev.data }); if (ownsPage) saveRecords(); }
  for (const c of clients) c.write(`data: ${JSON.stringify(ev)}\n\n`);
}
export function emit(type: string, data: any) {
  const ev = { type, at: Date.now(), data };
  if (ownsPage) return broadcast(ev);
  fetch(`http://127.0.0.1:${PORT}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) })
    .catch(() => broadcast(ev)); // no page running: keep it locally
}
export const log = (text: string, kind = 'info') => emit('log', { text, kind });

export type Api = (method: string, path: string, body: any, req: IncomingMessage) => Promise<any>;
export type Raw = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
export function startHub(port = PORT, extra?: () => any, api?: Api, raw?: Raw) {
  const page = () => readFileSync(resolve(here, '../web/index.html'), 'utf8');
  const server = createServer(async (req, res) => {
    try { if (raw && await raw(req, res)) return; } catch (e: any) { res.writeHead(500); res.end(String(e.message ?? e)); return; }
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for (const ev of history) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (req.url?.startsWith('/api/') && api) {
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const out = await api(req.method ?? 'GET', req.url!.slice(4), body ? JSON.parse(body) : {}, req);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out ?? {}));
        } catch (e: any) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message ?? e) })); }
      });
      return;
    }
    if (req.url === '/ingest' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', () => { try { broadcast(JSON.parse(body)); } catch {} res.writeHead(204); res.end(); });
      return;
    }
    if (req.url === '/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ orders: allRecords(), ...(extra?.() ?? {}) })); return; }
    if (req.url?.startsWith('/invoice')) {
      const u = new URL(req.url, 'http://x');
      const html = renderInvoice(u.pathname === '/invoice/internal' ? 'internal' : 'client', allRecords(), {
        client: u.searchParams.get('client') ?? undefined, date: u.searchParams.get('date') ?? undefined, ...(extra?.() ?? {}),
        trip: (() => { const t = getTrip(u.searchParams.get('trip') ?? ''); return t ? { id: t.id, title: t.title, start: t.start, end: t.end } : undefined; })() });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page());
  });
  server.on('error', (e: any) => console.error(`[hub] ${e.code === 'EADDRINUSE' ? `page already running on ${port}; forwarding events to it` : e.message}`));
  server.listen(port, '127.0.0.1', () => {
    ownsPage = true; loadRecords(); console.error(`[hub] live demo page: http://localhost:${port}`);
    // Also answer on IPv6 loopback so both "localhost" and "127.0.0.1" work in every browser.
    const v6 = createServer((rq, rs) => server.emit('request', rq, rs));
    v6.on('error', () => {}); v6.listen(port, '::1');
  });
  return server;
}
