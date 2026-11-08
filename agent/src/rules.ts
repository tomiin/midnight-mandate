// Business rules for bookings and payments, kept free of wallet and network code so they can be
// unit-tested on their own (see agent/test). core.ts uses these; the contract enforces the
// agency-wide limit on chain regardless.
import { createHash } from 'crypto';

// The order reference the merchant can compute on its own: a hash of merchant + order id.
// It ties a payment proof to one specific order without revealing anything about the principal.
// The public Verify page (web/verify.html) computes the same value in the browser.
export const orderRefOf = (merchant: string, orderId: string) =>
  new Uint8Array(createHash('sha256').update(`mandate:order:v1|${merchant}|${orderId}`).digest());

// A booking goes to the owner's Approvals when it costs more than what is left of the trip budget.
// "Committed" counts orders that are paid or waiting to be paid on this trip.
export function budgetCheck(budget: number, committed: number, amount: number) {
  const remaining = budget - committed;
  return { remaining, over: budget > 0 && amount > remaining };
}

// Why an order must not be paid (yet), or null if it can go to the contract.
export function payBlockReason(o: { id: string; status: string }): string | null {
  switch (o.status) {
    case 'paid': return `${o.id} is already paid`;
    case 'cancelled': return `${o.id} was cancelled`;
    case 'needs_approval': return `${o.id} is over the trip budget and is waiting for the owner's approval in Approvals. Do not retry until it is approved.`;
    case 'rejected': return `${o.id} was rejected by the owner.`;
    default: return null;
  }
}
