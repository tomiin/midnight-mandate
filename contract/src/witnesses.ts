// Private state + witness implementations for Mandate.
//
// Every actor holds exactly one secret key. An agent additionally holds the
// id of the request it's currently trying to exercise — in a real app this
// is generated fresh per purchase attempt by whatever is calling on the
// agent's behalf.
import type { Ledger } from './managed/mandate/contract/index.js';

// Tree depth declared in mandate.compact: HistoricMerkleTree<10, Bytes<32>>.
const TREE_DEPTH = 10;

export type MandatePrivateState = {
  secretKey: Uint8Array;
  requestId: Uint8Array;
  // Test-only. Set this and the witness returns the path for SOMEBODY ELSE'S
  // leaf, which is exactly what a malicious prover would do: the witness runs
  // on their machine, so nothing stops them editing it. Used by the
  // path-binding regression test to prove `exercise` rejects this.
  forgePathForLeaf?: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  requestId: Uint8Array = new Uint8Array(32),
  forgePathForLeaf?: Uint8Array,
): MandatePrivateState => ({ secretKey, requestId, forgePathForLeaf });

type WitnessContext<L, PS> = { privateState: PS; ledger: L };

// The shape the compiler expects back for a MerkleTreePath<10, Bytes<32>>.
type PathValue = {
  leaf: Uint8Array;
  path: { sibling: { field: bigint }; goes_left: boolean }[];
};

// A well-formed but deliberately invalid path.
//
// When the grant is not in the tree we still have to hand the circuit a path
// of the right shape. This one recomputes to a root that matches nothing, so
// checkRoot returns false and the assert fires with our error message —
// rather than the witness throwing and producing an opaque crash.
const dummyPath = (leaf: Uint8Array): PathValue => ({
  leaf,
  path: Array.from({ length: TREE_DEPTH }, () => ({
    sibling: { field: 0n },
    goes_left: false,
  })),
});

export const witnesses = {
  localSecretKey: ({ privateState }: WitnessContext<Ledger, MandatePrivateState>): [MandatePrivateState, Uint8Array] =>
    [privateState, privateState.secretKey],

  requestId: ({ privateState }: WitnessContext<Ledger, MandatePrivateState>): [MandatePrivateState, Uint8Array] =>
    [privateState, privateState.requestId],

  grantPath: (
    { privateState, ledger }: WitnessContext<Ledger, MandatePrivateState>,
    leaf: Uint8Array,
  ): [MandatePrivateState, PathValue] => {
    const target = privateState.forgePathForLeaf ?? leaf;
    const found = (ledger.authorized as unknown as {
      findPathForLeaf(l: Uint8Array): unknown;
    }).findPathForLeaf(target);
    return [privateState, (found as PathValue) ?? dummyPath(target)];
  },
};
