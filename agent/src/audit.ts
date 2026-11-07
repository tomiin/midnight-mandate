// Agency activity log: who signed in, who booked, who paid, who changed the mandate.
// Kept on the agency's machine (agent/data/), never on chain.
// (The full Mandate Travel edition adds a tamper-evident, hash-chained log.)
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), `../data/audit-${process.env.MN_NETWORK ?? 'undeployed'}.jsonl`);
export type AuditEntry = { at: number; actor: string; action: string; detail?: string; ip?: string };

export function readAudit(): AuditEntry[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
// Only the process that owns the hub writes; others forward through emit('audit').
export function appendAudit(a: { actor: string; action: string; detail?: string; ip?: string; at?: number }) {
  const e: AuditEntry = { at: a.at ?? Date.now(), actor: a.actor, action: a.action, detail: a.detail, ip: a.ip };
  mkdirSync(dirname(FILE), { recursive: true });
  appendFileSync(FILE, JSON.stringify(e) + '\n', { mode: 0o600 });
  return e;
}
