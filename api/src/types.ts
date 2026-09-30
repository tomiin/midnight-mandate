import type { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import type { Ledger as MandateLedger } from "mandate-contract/src/managed/mandate/contract/index.js";
import type { MandatePrivateState } from "mandate-contract";

/**
 * Wired to the actual compiled Mandate contract (contract/src/mandate.compact).
 *
 * ContractState — the on-chain ledger shape, parsed via the generated
 *   `ledger()` function from the compiled contract output.
 *
 * PrivateState — off-chain state held locally: the acting party's secret
 *   key, the request id they're currently exercising, and a test-only
 *   forged-leaf field used by the path-binding regression test. See
 *   contract/src/witnesses.ts for the authoritative definition.
 *
 * DerivedState — the combined view UI components consume.
 */

// The seven impure circuits Mandate exposes, per the compiled contract's
// ImpureCircuits<PS> type (contract/src/managed/mandate/contract/index.d.ts).
export type ImpureCircuitKeys =
  | "isAgent"
  | "registerAgent"
  | "revokeAgent"
  | "setCategoryLimit"
  | "advancePeriod"
  | "issueAuthorization"
  | "exercise";

export const PRIVATE_STATE_ID = "mandatePrivateState" as const;

export type ContractState = MandateLedger;

export type PrivateState = MandatePrivateState;

// Combined state for UI consumption
export interface DerivedState {
  contractState: ContractState | null;
  privateState: PrivateState | null;
}

export type AppProviders = MidnightProviders<
  ImpureCircuitKeys,
  typeof PRIVATE_STATE_ID,
  PrivateState
>;
