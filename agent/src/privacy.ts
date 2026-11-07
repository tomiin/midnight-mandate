// Privacy proxy between Mandate Travel and the AI provider.
//
// The AI does not need to know who the client is to search, compare, book or pay. So before
// anything leaves this machine, every known client, traveller and staff name is replaced with a
// stable placeholder (Client-3F2A, Traveller-8FBF, Staff-1C9E), and placeholders in the AI's
// answers and tool calls are turned back into names here, on the agency's machine. The mapping
// never leaves the agency. Names the proxy doesn't know are not guessed at: the message is held
// back and the person is asked to add the client through the form first.
import { createHash } from 'crypto';

export type Entry = { name: string; token: string; kind: 'client' | 'traveller' | 'staff'; cs?: boolean /* case-sensitive: single words */ };
const short = (s: string) => s.replace(/^[A-Za-z]+[-_]/, '').slice(0, 4).toUpperCase();
const hashTok = (s: string) => createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 4).toUpperCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words that look like names but are travel vocabulary: destinations, hotels, airlines, providers, dates.
const NOT_NAMES = new Set(('lisbon porto madrid paris london rome barcelona nassau exuma miami new york jfk lis cancún cancun bcn cdg lhr nas cun bahamas portugal spain france england mexico usa us uk europe ' +
  'hotel hotels inn suites grand meridian palácio palacio azul casa lumen riverside avenida harbour harbor the ' +
  'cheapair skylark coastal expedia priceline trip.com booking.com hotels.com staywell tap iberia united lufthansa delta air france ' +
  'jan january feb february mar march apr april may jun june jul july aug august sep sept september oct october nov november dec december ' +
  'monday tuesday wednesday thursday friday saturday sunday today tomorrow mandate travel claude assistant client clients trip trips family').split(/\s+/));

// Single-word names are matched regardless of case ("john" = "John"), except short ones and ones that
// are also everyday words, which only match when capitalised.
const COMMON_WORDS = new Set('will may june april august grace hope faith joy mark bill rose dawn summer autumn winter chase hunter rich page bob pat sky star ivy lily jack king rob guy art ray sue'.split(' '));
export class Proxy {
  entries: Entry[] = [];
  private byToken = new Map<string, string>();
  constructor(clients: { id: string; name: string; travellers: { id: string; fullName: string }[] }[], staff: { id: string; name: string }[], extraClientNames: string[] = [], prefer: string[] = []) {
    const add = (name: string, token: string, kind: Entry['kind']) => { name = name.trim(); if (!name || name.length < 2) return; if (this.entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) return; this.entries.push({ name, token, kind, cs: !/\s/.test(name) && (name.length < 4 || COMMON_WORDS.has(name.toLowerCase())) }); if (!this.byToken.has(token)) this.byToken.set(token, name); };
    for (const c of clients) {
      add(c.name, `Client-${short(c.id)}`, 'client');
      const bare = c.name.replace(/^the\s+/i, '').replace(/\s+family$/i, ''); // "Smith family" -> also "Smiths"/"Smith"
      if (bare !== c.name && bare.length > 2) { add(`${bare}s`, `Client-${short(c.id)}`, 'client'); }
      for (const t of c.travellers) add(t.fullName, `Traveller-${short(t.id)}`, 'traveller');
    }
    for (const n of extraClientNames) add(n, `Client-${hashTok(n)}`, 'client');
    for (const u of staff) add(u.name, `Staff-${short(u.id)}`, 'staff');
    // First names on their own ("Mia"), only when unambiguous.
    const firsts = new Map<string, Entry[]>();
    for (const e of [...this.entries]) if (e.kind !== 'client') { const f = e.name.split(/\s+/)[0]; if (f.length >= 3 && !NOT_NAMES.has(f.toLowerCase())) firsts.set(f.toLowerCase(), [...(firsts.get(f.toLowerCase()) ?? []), e]); }
    // A first name shared by several people resolves to the one on the trip or client being worked on.
    const preferTokens = new Set(prefer.map((id) => `Traveller-${short(id)}`));
    for (const [, list] of firsts) { const pick = list.length === 1 ? list : list.filter((e) => preferTokens.has(e.token)); if (pick.length === 1) add(pick[0].name.split(/\s+/)[0], pick[0].token, pick[0].kind); }
    // Surnames shared by a client ("Smith") map to the client.
    for (const c of clients) { const sur = c.name.replace(/^the\s+/i, '').replace(/\s+family$/i, ''); if (/^[A-Z][\w'’-]+$/.test(sur) && !NOT_NAMES.has(sur.toLowerCase())) add(sur, `Client-${short(c.id)}`, 'client'); }
    this.entries.sort((a, b) => b.name.length - a.name.length); // longest first: "John Smith" before "Smith"
  }
  mask(text: string) {
    let out = text;
    for (const e of this.entries) out = out.replace(new RegExp(`(?<![\\w-])${escRe(e.name)}(?![\\w-])`, e.cs ? 'g' : 'gi'), e.token);
    return out;
  }
  unmask(text: string) {
    return text.replace(/\b(Client|Traveller|Staff)-[A-F0-9]{4}\b/g, (t) => {
      return this.byToken.get(t) ?? t; // the first name registered for a token is its full display name
    });
  }
  maskDeep<T>(o: T): T { return JSON.parse(this.mask(JSON.stringify(o))); }
  unmaskDeep<T>(o: T): T { return JSON.parse(this.unmask(JSON.stringify(o))); }
  // Capitalised name-like phrases after cue words that the proxy doesn't know. These are held back.
  unknownNames(text: string): string[] {
    const found = new Set<string>();
    const re = /\b(?:for|client|clients|traveller|travellers|traveler|travelers|passenger|passengers|guest|guests|named|called|add|book|with|and)\s+(?:the\s+|mr\.?\s+|mrs\.?\s+|ms\.?\s+|dr\.?\s+)?((?:[A-Z][a-zà-ÿ'’-]+)(?:\s+(?:[A-Z][a-zà-ÿ'’-]+|family))*)/g;
    for (const m of text.matchAll(re)) {
      const phrase = m[1].trim(); const words = phrase.split(/\s+/);
      if (words.every((w) => NOT_NAMES.has(w.toLowerCase()) || /^(Client|Traveller|Staff)-/.test(w))) continue;
      if (this.entries.some((e) => e.name.toLowerCase() === phrase.toLowerCase())) continue;
      if (/^(Client|Traveller|Staff)-[A-F0-9]{4}$/.test(phrase)) continue;
      const kept = words.filter((w) => !NOT_NAMES.has(w.toLowerCase()) || w.toLowerCase() === 'family');
      if (!kept.length || (kept.length === 1 && kept[0].toLowerCase() === 'family')) continue;
      // A single known first name or surname is fine.
      if (kept.length === 1 && this.entries.some((e) => e.name.toLowerCase() === kept[0].toLowerCase())) continue;
      found.add(phrase);
    }
    return [...found];
  }
}

// "new client Garcia family, travellers Ana Garcia and Luis Garcia" -> handled locally, never sent.
export function newClientIntent(text: string): { name?: string; travellers: string[] } | null {
  if (!/\b(new client|create (a |the )?client|add (a |new )?client|new customer|set up (a )?client)\b/i.test(text)) return null;
  const name = text.match(/\b(?:client|customer)\s*:?\s+(?:called\s+|named\s+)?((?:the\s+)?[A-Z][\wà-ÿ'’-]+(?:\s+(?:[A-Z][\wà-ÿ'’-]+|family))*)/)?.[1];
  const tail = text.split(/\b(?:travell?ers?|passengers?|guests?|people)\b\s*:?/i)[1] ?? '';
  const travellers = [...tail.matchAll(/([A-Z][\wà-ÿ'’-]+(?:\s+[A-Z][\wà-ÿ'’-]+)+)/g)].map((m) => m[1]).slice(0, 12);
  return { name, travellers };
}
