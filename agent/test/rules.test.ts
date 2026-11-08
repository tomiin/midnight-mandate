// Booking and payment rules (agent side). The contract enforces the agency-wide limit on chain;
// these are the rules the back office applies before anything reaches the contract.
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';
import { orderRefOf, budgetCheck, payBlockReason } from '../src/rules.js';

describe('trip budget → Approvals', () => {
  it('a booking within what is left of the trip budget can be paid', () => {
    expect(budgetCheck(2400, 472, 777)).toEqual({ remaining: 1928, over: false });
  });
  it('a booking that costs exactly what is left is still within budget', () => {
    expect(budgetCheck(1000, 600, 400).over).toBe(false);
  });
  it('a booking over what is left of the trip budget goes to Approvals', () => {
    // The Lisbon weekend test: $300 trip, $430 hotel.
    expect(budgetCheck(300, 0, 430)).toEqual({ remaining: 300, over: true });
  });
  it('earlier bookings on the trip count against its budget', () => {
    expect(budgetCheck(1000, 900, 150).over).toBe(true);
  });
  it('a trip already over budget sends every new booking to Approvals', () => {
    expect(budgetCheck(500, 700, 1)).toEqual({ remaining: -200, over: true });
  });
});

describe('which orders may be paid', () => {
  it('an order awaiting payment can go to the contract', () => {
    expect(payBlockReason({ id: 'NA-1', status: 'awaiting_payment' })).toBeNull();
  });
  it('a paid order cannot be paid twice', () => {
    expect(payBlockReason({ id: 'NA-1', status: 'paid' })).toMatch(/already paid/);
  });
  it('an over-budget order cannot be paid until the owner approves it', () => {
    expect(payBlockReason({ id: 'NA-2', status: 'needs_approval' })).toMatch(/waiting for the owner's approval/);
  });
  it('rejected and cancelled orders cannot be paid', () => {
    expect(payBlockReason({ id: 'NA-3', status: 'rejected' })).toMatch(/rejected/);
    expect(payBlockReason({ id: 'NA-4', status: 'cancelled' })).toMatch(/cancelled/);
  });
});

describe('order reference', () => {
  it('is 32 bytes and the same for the same merchant and order', () => {
    const a = orderRefOf('Skylark Air', 'NA-5V6JPRO');
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(orderRefOf('Skylark Air', 'NA-5V6JPRO')))).toBe(true);
  });
  it('differs for a different order or merchant, so one proof cannot cover two orders', () => {
    const a = Buffer.from(orderRefOf('Skylark Air', 'NA-5V6JPRO')).toString('hex');
    expect(Buffer.from(orderRefOf('Skylark Air', 'NA-5V6JPRP')).toString('hex')).not.toBe(a);
    expect(Buffer.from(orderRefOf('CheapAir', 'NA-5V6JPRO')).toString('hex')).not.toBe(a);
  });
  it('matches what the public Verify page computes in the browser', async () => {
    // Same steps as web/verify.html: TextEncoder + SHA-256 via Web Crypto.
    const bytes = new TextEncoder().encode('mandate:order:v1|Skylark Air|NA-5V6JPRO');
    const browser = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
    expect(Buffer.from(orderRefOf('Skylark Air', 'NA-5V6JPRO')).toString('hex')).toBe(browser);
  });
});
