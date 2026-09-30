/**
 * What the contract writes to the public ledger, and what never reaches it.
 * Checked against contract/src/mandate.compact (categoryLimit, spend, the
 * disclosed amount and agentId). Shared by the live app and the demo page so
 * the two can't drift. If the contract changes, change this.
 */
export const ON_LEDGER = [
  "The agent's pseudonym (a hash of its key), on every spend",
  "Each category's cap, as a plain number",
  "Running totals and the amount of each spend",
  "The counts above",
];

export const NEVER_ON_LEDGER = [
  "Who the principal is (only a hash is stored)",
  "The agent's real name",
  "What a category means",
  "Who the agent bought from",
];
