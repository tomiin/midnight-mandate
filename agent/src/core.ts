// Mandate agent core: the same operations behind every interface.
//   - mcp.ts   exposes them as MCP tools (Claude, and any MCP-capable AI client)
//   - REST     /api/v1/... + /openapi.json on the local hub (ChatGPT actions, Gemini/OpenAI
//              function calling, LangChain, or a company's own agent)
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../../contract/src/managed/mandate/contract/index.js';
import { connect, MandateRefused, type Session } from './mandate.js';
import { net, NETWORK_NAME } from './config.js';
import {
  PROVIDERS, providerIds, searchFlights, searchHotels, searchTravel, createOrder, getOrder, updateOrder,
  findFare, findRoom, log, emit, startHub, destinations, openOrders,
} from './merchants.js';
import { openapi } from './openapi.js';
import { handleChat, chatStatus } from './chat.js';
import { authRoutes, userOf, label, audit } from './auth.js';
import * as crm from './crm.js';
import * as backup from './backup.js';
let maintenance = ''; // set after a restore: the app must restart before anything else is written
import { allRecords } from './merchants.js';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
import { existsSync, readFileSync } from 'fs';
import { STATE_PATH } from './config.js';
import { orderRefOf, budgetCheck, payBlockReason } from './rules.js';
export { orderRefOf };
const savedContract = () => { try { return existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')).contract : undefined; } catch { return undefined; } };

let session: Session | null = null;
let connecting: Promise<Session> | null = null;
export const getSession = () => session ? Promise.resolve(session) : (connecting ??= connect().then((s) => {
  session = s; log(`Agent wallet synced. Mandate contract ${s.contractAddress.slice(0, 12)}… on ${NETWORK_NAME}`, 'ok');
  s.publicState().then((st) => { emit('budget', { limit: st.travelLimit, period: st.period }); emit('agent', { active: st.agentActive }); }).catch(() => {});
  return s;
}).catch((e) => { connecting = null; throw e; }));

// Booking inside a trip: price follows travellers (flights) or rooms x nights (hotels); travellers must
// have complete profiles; anything over the trip budget waits for the owner in Approvals.
function bookForTrip(offer: { merchant: string; item: string; amount: number }, offerId: string, tripId: string, actor: string) {
  const t = crm.getTrip(tripId); if (!t) return { error: `No trip ${tripId}. Use find_clients or get_trip to get the id.` };
  const tv = crm.tripView(t);
  if (!tv.travellers.length) return { error: 'This trip has no travellers. Add travellers to the client profile first.' };
  const missing = tv.travellers.filter((x) => x.missing.length);
  if (missing.length) return { error: 'Traveller details are missing, so this cannot be ticketed yet.', missing: missing.map((x) => ({ traveller: x.fullName, needs: x.missing })),
    advice: `Ask the user to complete these in Clients > ${tv.client} (the profile form). Never ask for dates of birth or passport numbers in chat.` };
  const flight = /^Flight to/.test(offer.item);
  const qty = flight ? tv.travellers.length : tv.nights * t.rooms;
  const amount = offer.amount * qty;
  const item = flight ? `${offer.item} × ${qty} traveller${qty > 1 ? 's' : ''}`
    : offer.item.replace(/, 1 night from .*/, `, ${t.rooms} room${t.rooms > 1 ? 's' : ''} × ${tv.nights} night${tv.nights > 1 ? 's' : ''} from ${t.start}`);
  const committed = allRecords().filter((o) => o.tripId === t.id && (o.status === 'paid' || o.status === 'awaiting_payment')).reduce((a, o) => a + Number(o.amount), 0);
  const { remaining, over } = budgetCheck(t.budget, committed, amount);
  const o: any = createOrder(offer.merchant, item, amount, offerId, tv.client, actor, { tripId: t.id, qty, unitPrice: offer.amount, travellerIds: t.travellerIds, status: over ? 'needs_approval' : 'awaiting_payment' });
  if (!o.note) {
    audit(actor, over ? 'booked, sent to approvals' : 'booked', `${o.id} · ${tv.client} · ${t.title} · ${offer.merchant} · $${amount} (${qty} × $${offer.amount})`);
    log(over ? `${o.id} for ${tv.client} is $${amount}, over the trip budget ($${Math.max(0, remaining)} left). Sent to Approvals.` : `${offer.merchant} created order ${o.id} for ${tv.client}: ${item}, $${amount}. Awaiting payment.`, over ? 'proof' : 'info');
  }
  return { ...o, trip: { id: t.id, title: t.title, budget: t.budget, remainingBeforeThis: remaining },
    ...(over ? { next: 'Over the trip budget. It is waiting for the owner in Approvals. Tell the user; do not pay it.' } : { next: 'Confirm with the user, then pay_with_mandate.' }) };
}

// ---------- agent operations ----------
export const ops = {
  listMerchants() {
    log('Looking up connected travel providers');
    return { providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, sells: p.kinds, simulated: p.simulated })), destinations: destinations(),
      note: 'Simulated providers use invented inventory and are not affiliated with the brands they are named after.' };
  },
  searchTravel(query: string) {
    log(`Searching all providers: “${query}”…`);
    const r: any = searchTravel(query);
    if (r.error) log(r.error, 'bad');
    else {
      log(`${r.providersSearched.length} providers searched, ${r.totalFound} offers, ${r.results.length} match${r.results[0] ? `, best $${r.results[0].priceUsd} (${r.results[0].provider})` : ''}`);
      emit('fares', { airline: `All providers · ${r.understood.kind}`, to: r.understood.destination, date: r.understood.date, fares: r.results.map((x: any) => ({ ...x, depart: x.depart ?? x.hotel, durationH: x.durationH ?? `${x.stars}★` })) });
    }
    return r;
  },
  searchFlights(provider: string, destination: string, date: string) {
    log(`Searching ${provider} for flights to ${destination} on ${date}…`);
    const r: any = searchFlights(provider, destination, date);
    if (r.error) log(r.error, 'bad'); else { log(`${r.provider}: ${r.fares.length} fares, cheapest $${r.fares[0].priceUsd}`); emit('fares', r); }
    return r;
  },
  searchHotels(city: string, date: string, provider = 'staywell') {
    log(`Searching ${provider} for hotels in ${city} on ${date}…`);
    const r: any = searchHotels(provider, city, date);
    if (r.error) log(r.error, 'bad'); else log(`${r.provider}: ${r.rooms.length} rooms, from $${r.rooms[0]?.nightly}/night`);
    return r;
  },
  book(offerId: string, client?: string, actor = 'AI agent', tripId?: string) {
    const offer = findFare(offerId) ?? findRoom(offerId);
    if (!offer) return { error: 'Unknown offer. Search first and use an id from the results.' };
    if (tripId) return bookForTrip(offer, offerId, tripId, actor);
    const o: any = createOrder(offer.merchant, offer.item, offer.amount, offerId, client, actor);
    if (!o.note) audit(actor, 'booked', `${o.id} · ${o.client} · ${offer.merchant} · ${offer.item} · $${offer.amount}`);
    if (!o.note) log(`${offer.merchant} created order ${o.id} for ${o.client}: ${offer.item}, $${offer.amount}. Awaiting payment.`);
    return o;
  },
  cancel(orderId: string, actor = 'AI agent') {
    const o = getOrder(orderId);
    if (!o) return { error: `No order ${orderId}` };
    if (o.status !== 'awaiting_payment') return { error: `${orderId} is ${o.status} and cannot be cancelled` };
    updateOrder(o.id, { status: 'cancelled' }); audit(actor, 'cancelled order', `${o.id} · $${o.amount}`); log(`${o.merchant} cancelled unpaid order ${o.id}`);
    return { orderId: o.id, status: 'cancelled' };
  },
  listOrders: () => openOrders(),
  async status() {
    const s = await getSession(); const st = await s.publicState();
    log(`Mandate check: travel limit $${st.travelLimit}/period, agent ${st.agentActive ? 'authorized' : 'NOT authorized'}`);
    emit('budget', { limit: st.travelLimit, period: st.period }); emit('agent', { active: st.agentActive });
    return { ...st, network: NETWORK_NAME, note: 'Who the agent works for is never on the ledger.' };
  },
  async pay(orderId: string, actor = 'AI agent') {
    const o = getOrder(orderId);
    if (!o) return { error: `No order ${orderId}` };
    const blocked = payBlockReason(o);
    if (blocked) return { error: blocked, ...(o.status === 'paid' ? { txId: o.txId } : {}) };
    const s = await getSession();
    log(`Paying ${o.id} ($${o.amount}) at ${o.merchant}: generating zero-knowledge proof…`, 'proof');
    emit('proving', { orderId: o.id, amount: o.amount });
    const pre = await s.publicState();
    emit('budget', { limit: pre.travelLimit, period: pre.period });
    try {
      const ref = orderRefOf(o.merchant, o.id);
      const p = await s.pay(o.amount, ref);
      log(`Proof accepted on chain in ${(p.proveAndSubmitMs / 1000).toFixed(1)}s, tx ${p.txId.slice(0, 16)}…`, 'ok');
      // Merchant side: look up ITS OWN order on the public ledger and check the exact amount.
      const merchantView = indexerPublicDataProvider(net.indexerHttpUrl, net.indexerWsUrl);
      await merchantView.watchForTxData(p.txId as any);
      const cs = await merchantView.queryContractState(s.contractAddress);
      const l: any = ledger(cs!.data);
      const onLedger = l.paidOrders.member(ref) ? Number(l.paidOrders.lookup(ref)) : null;
      const ok = onLedger === o.amount;
      const refHex = Buffer.from(ref).toString('hex');
      updateOrder(o.id, { status: ok ? 'paid' : 'awaiting_payment', txId: p.txId, blockHeight: p.blockHeight, period: pre.period, orderRef: refHex, contract: s.contractAddress, paidBy: actor,
        verified: ok ? `Authorized agent ✓  Within budget ✓  Order ${o.id} paid $${onLedger} on ledger ✓  Principal: hidden` : `Ledger shows ${onLedger ?? 'no payment'} for this order` });
      log(ok ? `${o.merchant} found order ${o.id} on the ledger: paid $${onLedger}. Booking confirmed.` : `${o.merchant} could not match the payment to order ${o.id}`, ok ? 'ok' : 'bad');
      if (ok && o.travellerIds?.length) { log(`${o.merchant} received passenger details for ${o.travellerIds.length} traveller${o.travellerIds.length > 1 ? 's' : ''}, sent from the agency's records (never through the AI)`); audit('Mandate Travel', 'sent traveller details to supplier', `${o.id} · ${o.merchant} · ${o.travellerIds.length} traveller(s)`); }
      audit(actor, ok ? 'paid with mandate' : 'payment unconfirmed', `${o.id} · ${o.client} · ${o.merchant} · $${o.amount} · tx ${p.txId.slice(0, 16)}…`);
      return { orderId: o.id, status: ok ? 'paid' : 'unconfirmed', txId: p.txId, blockHeight: p.blockHeight, network: NETWORK_NAME };
    } catch (e: any) {
      if (e instanceof MandateRefused) {
        updateOrder(o.id, { status: 'refused', verified: e.message, period: pre.period, contract: s.contractAddress, paidBy: actor });
        audit(actor, 'payment refused by contract', `${o.id} · ${o.client} · $${o.amount} · ${e.message}`);
        log(`REFUSED by the Mandate contract: ${e.message}. Nothing was submitted, no fee spent.`, 'bad');
        return { orderId: o.id, status: 'refused', reason: e.message, advice: 'The agency must raise the limit, start a new period, or reinstate the agent.' };
      }
      log(`Payment error: ${String(e.message ?? e).slice(0, 200)}`, 'bad');
      return { orderId: o.id, status: 'error', error: String(e.message ?? e).slice(0, 500) };
    }
  },
};

// ---------- agency (principal) actions ----------
let busy = false;
async function principalAction(label: string, fn: (s: Session) => Promise<any>, actor = 'Agency') {
  if (busy) throw new Error('Another console action is still running');
  busy = true;
  try {
    const s = await getSession();
    log(`Agency console: ${label}… (signing as principal, generating proof)`, 'proof');
    const t = Date.now(); const r = await fn(s);
    const st = await s.publicState();
    emit('budget', { limit: st.travelLimit, period: st.period }); emit('agent', { active: st.agentActive });
    audit(actor, 'changed mandate', `${label} · confirmed on chain`);
    log(`Agency console: ${label} confirmed on chain in ${((Date.now() - t) / 1000).toFixed(1)}s${r?.public?.txId ? `, tx ${String(r.public.txId).slice(0, 16)}…` : ''}`, 'ok');
    return { ok: true, state: st };
  } catch (e: any) { audit(actor, 'mandate change failed', `${label} · ${String(e.message ?? e).slice(0, 120)}`); log(`Agency console: ${label} failed: ${String(e.message ?? e).slice(0, 160)}`, 'bad'); throw e; }
  finally { busy = false; }
}

// ---------- local hub: web app + REST API for any AI ----------
export function startServices() {
  getSession().catch((e) => log(`Mandate not ready: ${e.message}`, 'bad')); // warm up
  startHub(undefined, () => ({ network: NETWORK_NAME, contract: session?.contractAddress ?? savedContract() }), async (method, path, body, req) => {
    const me = userOf(req); const who = me ? label(me) : (req as any).apiKey ? `API key "${(req as any).apiKey.name}"` : 'API client (REST)';
    const ownerOnly = () => { if (!me || me.role !== 'owner') throw new Error('Only the agency owner can change the mandate.'); };
    const q = (k: string) => new URLSearchParams(path.split('?')[1] ?? '').get(k) ?? body?.[k];
    const route = path.split('?')[0];
    // console + verify page
    if (method === 'GET' && route === '/public') { const s = await getSession(); return { network: NETWORK_NAME, ...(await s.publicState()) }; }
    if (method === 'POST' && route === '/revoke') { ownerOnly(); return principalAction('revoke agent', (s) => s.principal.revokeAgent(), who); }
    if (method === 'POST' && route === '/reinstate') { ownerOnly(); return principalAction('reinstate agent', (s) => s.principal.registerAgent(), who); }
    if (method === 'POST' && route === '/new-period') { ownerOnly(); return principalAction('start a new budget period', (s) => s.principal.advancePeriod(), who); }
    if (method === 'POST' && route === '/limit') {
      ownerOnly();
      const n = Math.round(Number(body?.amount));
      if (!(n > 0 && n < 1_000_000)) throw new Error('limit must be a positive number');
      return principalAction(`set travel limit to $${n}`, (s) => s.principal.setTravelLimit(n), who);
    }
    // agent REST API (v1)
    if (method === 'GET' && route === '/v1/openapi.json') return openapi;
    if (method === 'GET' && route === '/v1/merchants') return ops.listMerchants();
    if (method === 'GET' && route === '/v1/search') return ops.searchTravel(String(q('q') ?? ''));
    if (method === 'GET' && route === '/v1/flights') return ops.searchFlights(String(q('provider')), String(q('destination')), String(q('date')));
    if (method === 'GET' && route === '/v1/hotels') return ops.searchHotels(String(q('city')), String(q('date')), String(q('provider') ?? 'staywell'));
    if (method === 'GET' && route === '/v1/mandate') return ops.status();
    if (method === 'GET' && route === '/v1/orders') return ops.listOrders();
    if (method === 'POST' && route === '/v1/orders') return ops.book(String(body?.offerId), body?.client, who, body?.tripId);
    const m = route.match(/^\/v1\/orders\/([^/]+)\/(pay|cancel)$/);
    if (method === 'POST' && m) return m[2] === 'pay' ? ops.pay(m[1], who) : ops.cancel(m[1], who);
    if (method === 'GET' && route === '/chat/status') return { ...chatStatus(), paused: false, locked: false };
    // ---------- encrypted backups on Lumera Cascade (owner) ----------
    if (route.startsWith('/backup')) {
      if (!me) throw new Error('Sign in first.');
      if (me.role !== 'owner') throw new Error('Only the agency owner can back up or restore records.');
      const by = label(me);
      if (route === '/backup' && method === 'GET') return { ...backup.backupInfo(), backups: backup.listBackups() };
      if (route === '/backup/cascade' && method === 'POST') {
        audit(by, 'backup to Cascade started', `${backup.backupInfo().files.length} record files, encrypted on this machine`);
        try { const e = await backup.backupToCascade(String(body?.passphrase ?? ''), by); audit(by, 'backed up to Cascade', `action ${e.actionId} · ${e.bytes} bytes encrypted · sha256 ${e.sha256.slice(0, 16)}…`); return e; }
        catch (e: any) { audit(by, 'backup to Cascade failed', String(e.message ?? e).slice(0, 160)); throw e; }
      }
      if (route === '/backup/download' && method === 'POST') {
        if (String(body?.passphrase ?? '').length < 12) throw new Error('Use a backup passphrase of at least 12 characters.');
        const r2 = backup.seal(String(body.passphrase)); audit(by, 'downloaded encrypted backup', `${r2.files.length} files · sha256 ${r2.sha256.slice(0, 16)}…`); return r2.sealed;
      }
      if (route === '/backup/restore' && method === 'POST') {
        if (body?.confirm !== 'RESTORE') throw new Error('Type RESTORE to confirm.');
        audit(by, 'restore from Cascade started', `action ${body?.actionId}; current records copied aside first`);
        const r2 = body?.sealed ? backup.restoreSealed(body.sealed, String(body?.passphrase ?? '')) : await backup.restoreFromCascade(String(body?.actionId ?? ''), String(body?.passphrase ?? ''));
        maintenance = `Mandate Travel restored ${r2.files.length} record files from a backup made ${r2.createdAt}. Quit Claude Desktop (Cmd+Q) and reopen it to finish. Previous records were kept in ${r2.snapshot}.`;
        return { ok: true, ...r2, next: 'Quit Claude Desktop (Cmd+Q) and reopen it to finish the restore.' };
      }
      throw new Error(`not found: ${method} ${route}`);
    }
    // ---------- clients, trips, approvals (signed-in staff only) ----------
    if (route.startsWith('/crm/') || route.startsWith('/orders/')) {
      if (!me) throw new Error('Sign in first.');
      const by = label(me);
      if (method === 'GET' && route === '/crm/clients') return crm.clientSummaries();
      if (method === 'POST' && route === '/crm/clients') { const c = crm.createClient(body, by); audit(by, 'created client', `${c.name} · ${c.travellers.length} traveller(s)`); return c; }
      if (method === 'GET' && route === '/crm/trips') return crm.tripsList();
      if (method === 'POST' && route === '/crm/trips') { const t = crm.createTrip(body, by); audit(by, 'created trip', `${t.title} · ${t.client} · ${t.start} to ${t.end} · budget $${t.budget}`); return t; }
      let m2 = route.match(/^\/crm\/clients\/(C-[A-F0-9]+)$/);
      if (m2 && method === 'GET') { const c = crm.clientView(m2[1]); if (!c) throw new Error('No such client'); return c; }
      if (m2 && method === 'POST') { const c = crm.updateClient(m2[1], body); audit(by, 'updated client', c.name); return c; }
      m2 = route.match(/^\/crm\/clients\/(C-[A-F0-9]+)\/travellers$/);
      if (m2 && method === 'POST') { const r = crm.upsertTraveller(m2[1], body); audit(by, body?.id ? 'updated traveller profile' : 'added traveller', `${r.traveller.fullName} · ${r.client.name}`); return r; }
      m2 = route.match(/^\/crm\/trips\/(TR-[A-F0-9]+)$/);
      if (m2 && method === 'GET') { const t = crm.getTrip(m2[1]); if (!t) throw new Error('No such trip'); return crm.tripView(t); }
      m2 = route.match(/^\/crm\/(clients|travellers|trips)\/((?:C|T|TR)-[A-F0-9]+)\/delete$/);
      if (m2 && method === 'POST') {
        if (me.role !== 'owner') throw new Error('Only the agency owner can delete client records.');
        const open = (ids: string[]) => allRecords().filter((o) => o.tripId && ids.includes(o.tripId) && (o.status === 'awaiting_payment' || o.status === 'needs_approval'));
        if (m2[1] === 'travellers') { const r = crm.deleteTraveller(m2[2]); audit(by, 'deleted traveller', `${r.fullName} · ${r.client} · profile and documents erased`); return r; }
        if (m2[1] === 'trips') { if (open([m2[2]]).length) throw new Error('This trip has unpaid or pending bookings. Cancel or reject them first.'); const r = crm.deleteTrip(m2[2]); audit(by, 'deleted trip', `${r.title} · ${r.client}`); return r; }
        if (open(crm.tripIdsOfClient(m2[2])).length) throw new Error('This client has unpaid or pending bookings. Cancel or reject them first.');
        const r = crm.deleteClient(m2[2]); audit(by, 'deleted client', `${r.name} · ${r.travellers} traveller profile(s) and ${r.trips} trip(s) erased; paid booking records kept for accounting`); return r;
      }
      m2 = route.match(/^\/orders\/([A-Z0-9-]+)\/(approve|reject)$/);
      if (m2 && method === 'POST') {
        if (me.role !== 'owner') throw new Error('Only the agency owner can approve over-budget bookings.');
        const o = getOrder(m2[1]); if (!o) throw new Error('No such order (it may belong to another session).');
        if (o.status !== 'needs_approval') throw new Error(`${o.id} is ${o.status}, not waiting for approval.`);
        if (m2[2] === 'reject') { updateOrder(o.id, { status: 'rejected', approvedBy: by }); audit(by, 'rejected booking', `${o.id} · ${o.client} · $${o.amount}`); return { orderId: o.id, status: 'rejected' }; }
        updateOrder(o.id, { status: 'awaiting_payment', approvedBy: by }); audit(by, 'approved over-budget booking', `${o.id} · ${o.client} · $${o.amount}`);
        return body?.pay ? ops.pay(o.id, `${by} (approved)`) : { orderId: o.id, status: 'awaiting_payment' };
      }
      throw new Error(`not found: ${method} ${route}`);
    }
    throw new Error(`not found: ${method} ${route}`);
  }, async (req, res) => {
    if (maintenance) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(maintenance); return true; }
    // ---- transport security for every request ----
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    // Only answer to this machine's own names: blocks DNS-rebinding attacks from malicious web pages.
    const port = process.env.DEMO_PORT ?? '4400';
    if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(String(req.headers.host ?? ''))) { res.writeHead(421); res.end('Misdirected request'); return true; }
    // Refuse state-changing requests that come from another website (cross-site request forgery).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const o = req.headers.origin; const sfs = req.headers['sec-fetch-site'];
      if ((o && (() => { try { return new URL(o).host !== req.headers.host; } catch { return true; } })()) || sfs === 'cross-site') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"error":"Cross-site request blocked"}'); return true; }
    }
    // Sign-in, team and audit routes, and the login page.
    if (await authRoutes(req, res, () => readFileSync(resolve(webDir, 'login.html'), 'utf8'))) return true;
    const url = (req.url ?? '').split('?')[0];
    // Public, no sign-in: anyone holding an invoice can check a booking against the ledger.
    if (url === '/verify') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(readFileSync(resolve(webDir, 'verify.html'), 'utf8')); return true; }
    if (url === '/api/verify-order') {
      const u = new URL(req.url ?? '', 'http://x'); const c = String(u.searchParams.get('c') ?? ''); const ref = String(u.searchParams.get('ref') ?? '').toLowerCase();
      const out = (code: number, o: any) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!/^[0-9a-f]{64,}$/i.test(c) || !/^[0-9a-f]{64}$/.test(ref)) { out(400, { error: 'Bad contract or order reference' }); return true; }
      try {
        const view = indexerPublicDataProvider(net.indexerHttpUrl, net.indexerWsUrl);
        const cs = await view.queryContractState(c);
        if (!cs) { out(200, { network: NETWORK_NAME, contract: c, found: false }); return true; }
        const l: any = ledger(cs.data); const key = new Uint8Array(Buffer.from(ref, 'hex'));
        out(200, { network: NETWORK_NAME, contract: c, found: true, paid: l.paidOrders.member(key) ? Number(l.paidOrders.lookup(key)) : null, checkedAt: Date.now() });
      } catch (e: any) { out(502, { error: `Ledger not reachable: ${String(e.message ?? e).slice(0, 120)}` }); }
      return true;
    }
    // Machine routes stay open on this machine: other AI clients (REST) and the MCP copies forwarding events.
    if (url === '/ingest') return false;
    // Other AI clients use the REST API on this machine. (The full edition requires owner-issued API keys.)
    if (url.startsWith('/api/v1/')) return false;
    const me = userOf(req);
    if (!me) {
      if (url.startsWith('/api/') || url === '/events' || url === '/state' || url === '/chat') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"Sign in first."}'); }
      else { res.writeHead(302, { Location: '/login' }); res.end(); }
      return true;
    }
    if (req.method === 'POST' && url === '/chat') { handleChat(req, res, me).catch(() => res.end()); return true; }
    return false;
  });
}
export { providerIds };
