// Client profiles and trips for Mandate Travel. Private agency records, never on chain.
// Travel documents (date of birth, gender, passport) are shown masked in the app and never given
// to the AI: at ticketing the server attaches them for the supplier; the AI only sees traveller ids.
// (The full Mandate Travel edition also encrypts them at rest.)
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const NET = process.env.MN_NETWORK ?? 'undeployed';
const FILE = resolve(here, `../data/crm-${NET}.json`);

export type Docs = { dob?: string; gender?: string; passportNumber?: string; passportExpiry?: string; passportCountry?: string; ktn?: string };
export type Traveller = { id: string; fullName: string; docs?: string /* encrypted Docs */; seat?: string; meal?: string; loyalty?: string };
export type Client = { id: string; name: string; email?: string; phone?: string; notes?: string; travellers: Traveller[]; createdAt: number; createdBy: string };
export type Trip = { id: string; clientId: string; title: string; destination: string; start: string; end: string; travellerIds: string[]; rooms: number; budget: number; international: boolean; createdAt: number; createdBy: string };
type Db = { clients: Client[]; trips: Trip[] };

let db: Db = { clients: [], trips: [] };
const enc = (d: Docs) => JSON.stringify(d);
const dec = (s?: string): Docs => { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } };
const load = () => { try { if (existsSync(FILE)) db = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e: any) { console.error(`[crm] could not load: ${e.message}`); } };
const save = () => { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 }); renameSync(FILE + '.tmp', FILE); };
load();
const id = (p: string) => `${p}-${randomBytes(3).toString('hex').toUpperCase()}`;
const s = (v: any, n = 120) => (v == null ? undefined : String(v).trim().slice(0, n) || undefined);
const isDate = (v?: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- what a traveller is missing for ticketing ----------
export function missingFor(t: Traveller, international: boolean) {
  const d = dec(t.docs); const m: string[] = [];
  if (!t.fullName) m.push('full name as on ID');
  if (!d.dob) m.push('date of birth'); if (!d.gender) m.push('gender');
  if (international) { if (!d.passportNumber) m.push('passport number'); if (!d.passportExpiry) m.push('passport expiry'); if (!d.passportCountry) m.push('passport country'); }
  return m;
}
const mask = (d: Docs) => ({ dob: d.dob ? `${d.dob.slice(0, 4)}-••-••` : undefined, gender: d.gender, passport: d.passportNumber ? `•••• ${d.passportNumber.slice(-4)}` : undefined,
  passportExpiry: d.passportExpiry, passportCountry: d.passportCountry, ktn: d.ktn ? `•••• ${d.ktn.slice(-3)}` : undefined });
const travellerView = (t: Traveller, international = true) => ({ id: t.id, fullName: t.fullName, seat: t.seat, meal: t.meal, loyalty: t.loyalty, ...mask(dec(t.docs)), missing: missingFor(t, international) });

// ---------- reads ----------
export const getClient = (cid: string) => db.clients.find((c) => c.id === cid);
export const getTrip = (tid: string) => db.trips.find((t) => t.id === tid);
export const clientSummaries = () => db.clients.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, travellers: c.travellers.length,
  incomplete: c.travellers.filter((t) => missingFor(t, true).length).length, trips: db.trips.filter((t) => t.clientId === c.id).length, createdAt: c.createdAt }));
export function clientView(cid: string) {
  const c = getClient(cid); if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, notes: c.notes, createdAt: c.createdAt, createdBy: c.createdBy,
    travellers: c.travellers.map((t) => travellerView(t)), trips: db.trips.filter((t) => t.clientId === c.id).map(tripView) };
}
export function tripView(t: Trip) {
  const c = getClient(t.clientId);
  const ts = (c?.travellers ?? []).filter((x) => t.travellerIds.includes(x.id));
  return { ...t, client: c?.name ?? 'Unknown client', nights: nights(t), travellers: ts.map((x) => ({ id: x.id, fullName: x.fullName, missing: missingFor(x, t.international) })) };
}
export const tripsList = () => db.trips.map(tripView).sort((a, b) => b.createdAt - a.createdAt);
export const nights = (t: Trip) => Math.max(1, Math.round((Date.parse(t.end) - Date.parse(t.start)) / 86400000));
export function findClients(q: string) {
  const s2 = q.trim().toLowerCase();
  return db.clients.filter((c) => !s2 || c.name.toLowerCase().includes(s2) || c.travellers.some((t) => t.fullName.toLowerCase().includes(s2)))
    .map((c) => ({ id: c.id, name: c.name, travellers: c.travellers.map((t) => ({ id: t.id, fullName: t.fullName, missing: missingFor(t, true) })), trips: db.trips.filter((t) => t.clientId === c.id).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end })) }));
}
// Full documents, for the owner's "reveal" and for sending to a supplier at ticketing. Never for the AI.
export const travellerDocs = (tid: string) => { for (const c of db.clients) { const t = c.travellers.find((x) => x.id === tid); if (t) return { client: c.name, fullName: t.fullName, ...dec(t.docs) }; } return null; };

// ---------- writes ----------
function travellerFrom(b: any, prev?: Traveller): Traveller {
  const old = prev ? dec(prev.docs) : {};
  const d: Docs = { ...old };
  for (const k of ['dob', 'gender', 'passportNumber', 'passportExpiry', 'passportCountry', 'ktn'] as const) if (b[k] !== undefined && b[k] !== '') d[k] = s(b[k], 40);
  if (!isDate(d.dob) || !isDate(d.passportExpiry)) throw new Error('Dates must be YYYY-MM-DD.');
  const fullName = s(b.fullName, 80) ?? prev?.fullName;
  if (!fullName) throw new Error('Each traveller needs a full name as it appears on their ID.');
  return { id: prev?.id ?? id('T'), fullName, docs: Object.keys(d).length ? enc(d) : undefined, seat: s(b.seat, 20) ?? prev?.seat, meal: s(b.meal, 40) ?? prev?.meal, loyalty: s(b.loyalty, 80) ?? prev?.loyalty };
}
export function createClient(b: any, by: string) {
  const name = s(b.name, 80); if (!name) throw new Error('Client name is required.');
  if (db.clients.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`A client called "${name}" already exists.`);
  const c: Client = { id: id('C'), name, email: s(b.email), phone: s(b.phone, 40), notes: s(b.notes, 1000), travellers: (Array.isArray(b.travellers) ? b.travellers : []).slice(0, 20).map((t: any) => travellerFrom(t)), createdAt: Date.now(), createdBy: by };
  db.clients.push(c); save(); return clientView(c.id)!;
}
export function updateClient(cid: string, b: any) {
  const c = getClient(cid); if (!c) throw new Error('No such client');
  for (const k of ['email', 'phone', 'notes'] as const) if (b[k] !== undefined) (c as any)[k] = s(b[k], k === 'notes' ? 1000 : 120);
  save(); return clientView(cid)!;
}
export function upsertTraveller(cid: string, b: any) {
  const c = getClient(cid); if (!c) throw new Error('No such client');
  const i = b.id ? c.travellers.findIndex((t) => t.id === b.id) : -1;
  const t = travellerFrom(b, i >= 0 ? c.travellers[i] : undefined);
  if (i >= 0) c.travellers[i] = t; else c.travellers.push(t);
  save(); return { client: clientView(cid)!, traveller: travellerView(t) };
}
export function createTrip(b: any, by: string) {
  const c = getClient(String(b.clientId)); if (!c) throw new Error('Pick a client first (unknown client id).');
  const start = s(b.start, 10), end = s(b.end, 10);
  if (!start || !end || !isDate(start) || !isDate(end) || end < start) throw new Error('Trip needs start and end dates (YYYY-MM-DD), end on or after start.');
  if (!s(b.destination, 60)) throw new Error('Enter where the trip is going (destination).');
  if (!(Math.round(Number(b.budget) || 0) > 0)) throw new Error('Enter the budget the client approved for this trip.');
  const ids = Array.isArray(b.travellerIds) && b.travellerIds.length ? b.travellerIds.map(String).filter((x: string) => c.travellers.some((t) => t.id === x)) : c.travellers.map((t) => t.id);
  const t: Trip = { id: id('TR'), clientId: c.id, title: s(b.title, 80) ?? `${c.name} · ${s(b.destination, 40) ?? 'Trip'}`, destination: s(b.destination, 60) ?? '', start, end, travellerIds: ids,
    rooms: Math.max(1, Math.min(20, Math.round(Number(b.rooms) || Math.ceil(ids.length / 2) || 1))), budget: Math.max(0, Math.round(Number(b.budget) || 0)), international: b.international !== false, createdAt: Date.now(), createdBy: by };
  db.trips.push(t); save(); return tripView(t);
}

// ---------- deletes (owner only; booking records are kept for accounting) ----------
export function deleteTraveller(tid: string) {
  for (const c of db.clients) {
    const i = c.travellers.findIndex((t) => t.id === tid);
    if (i >= 0) { const [t] = c.travellers.splice(i, 1); for (const tr of db.trips) tr.travellerIds = tr.travellerIds.filter((x) => x !== tid); save(); return { client: c.name, fullName: t.fullName }; }
  }
  throw new Error('No such traveller');
}
export function deleteTrip(tid: string) {
  const i = db.trips.findIndex((t) => t.id === tid); if (i < 0) throw new Error('No such trip');
  const [t] = db.trips.splice(i, 1); save(); return { title: t.title, client: getClient(t.clientId)?.name ?? '' };
}
export function deleteClient(cid: string) {
  const i = db.clients.findIndex((c) => c.id === cid); if (i < 0) throw new Error('No such client');
  const [c] = db.clients.splice(i, 1); const trips = db.trips.filter((t) => t.clientId === cid).length;
  db.trips = db.trips.filter((t) => t.clientId !== cid); save();
  return { name: c.name, travellers: c.travellers.length, trips };
}
export const tripIdsOfClient = (cid: string) => db.trips.filter((t) => t.clientId === cid).map((t) => t.id);
