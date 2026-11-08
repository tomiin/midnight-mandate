// Privacy proxy: names are swapped for placeholders before anything reaches the AI provider,
// and swapped back on the agency's machine.
import { describe, it, expect } from 'vitest';
import { Proxy, newClientIntent } from '../src/privacy.js';

const clients = [
  { id: 'CL-212C9A', name: 'Smith family', travellers: [{ id: 'TV-C1CC01', fullName: 'John Smith' }, { id: 'TV-A7B2C3', fullName: 'Mia Smith' }] },
  { id: 'CL-9F00AA', name: 'Garcia family', travellers: [{ id: 'TV-0E0E0E', fullName: 'Ana Garcia' }] },
];
const staff = [{ id: 'U-5D5D5D', name: 'Jay Morgan' }];
const proxy = () => new Proxy(clients, staff);

describe('privacy proxy', () => {
  it('replaces client, traveller and staff names with placeholders', () => {
    const out = proxy().mask('Book the Smith family to Lisbon. John Smith needs a window seat. Booked by Jay Morgan.');
    expect(out).not.toMatch(/Smith|John|Jay Morgan/);
    expect(out).toContain('Client-212C');
    expect(out).toContain('Traveller-C1CC');
    expect(out).toContain('Staff-5D5D');
  });

  it('catches first names and surnames on their own', () => {
    const out = proxy().mask('Mia wants a late checkout; the Smiths prefer aisle seats.');
    expect(out).not.toMatch(/Mia|Smith/);
  });

  it('leaves destinations, hotels and dates alone', () => {
    const text = 'Two nights in Lisbon at the Grand Meridian from 12 December, flying TAP.';
    expect(proxy().mask(text)).toBe(text);
  });

  it('turns placeholders back into names on the agency side', () => {
    const p = proxy();
    const masked = p.mask('Hotel for Ana Garcia in Porto');
    expect(masked).not.toContain('Ana Garcia');
    expect(p.unmask(masked)).toBe('Hotel for Ana Garcia in Porto');
  });

  it('masks names inside tool results too (nested objects)', () => {
    const r = proxy().maskDeep({ order: { client: 'Smith family', travellers: ['John Smith', 'Mia Smith'], amount: 472 } });
    expect(JSON.stringify(r)).not.toMatch(/Smith|John|Mia/);
    expect(r.order.amount).toBe(472);
  });

  it('holds back names it does not know instead of sending them', () => {
    expect(proxy().unknownNames('Book a flight for Maria Lopez to Madrid')).toEqual(['Maria Lopez']);
  });

  it('does not flag known clients or travel words as unknown names', () => {
    expect(proxy().unknownNames('Book a hotel for John Smith in Lisbon')).toEqual([]);
  });

  it('handles "new client" requests locally, without the AI', () => {
    expect(newClientIntent('new client Lee family, travellers Kim Lee and Sam Lee')).toEqual({ name: 'Lee family', travellers: ['Kim Lee', 'Sam Lee'] });
    expect(newClientIntent('find a hotel in Porto')).toBeNull();
  });
});
