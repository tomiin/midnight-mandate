import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  requestId(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  grantPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
            leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                        path: { sibling: { field: bigint },
                                                goes_left: boolean
                                              }[]
                                      }];
}

export type ImpureCircuits<PS> = {
  isAgent(context: __compactRuntime.CircuitContext<PS>, id_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeAgent(context: __compactRuntime.CircuitContext<PS>, agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  setCategoryLimit(context: __compactRuntime.CircuitContext<PS>,
                   category_0: bigint,
                   maxSpend_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  advancePeriod(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  issueAuthorization(context: __compactRuntime.CircuitContext<PS>,
                     agent_0: Uint8Array,
                     category_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  exercise(context: __compactRuntime.CircuitContext<PS>,
           category_0: bigint,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  isAgent(context: __compactRuntime.CircuitContext<PS>, id_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeAgent(context: __compactRuntime.CircuitContext<PS>, agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  setCategoryLimit(context: __compactRuntime.CircuitContext<PS>,
                   category_0: bigint,
                   maxSpend_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  advancePeriod(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  issueAuthorization(context: __compactRuntime.CircuitContext<PS>,
                     agent_0: Uint8Array,
                     category_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  exercise(context: __compactRuntime.CircuitContext<PS>,
           category_0: bigint,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  agentId(sk_0: Uint8Array): Uint8Array;
  actorId(sk_0: Uint8Array): Uint8Array;
  grantLeaf(agent_0: Uint8Array, category_0: bigint): Uint8Array;
}

export type Circuits<PS> = {
  agentId(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  actorId(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  grantLeaf(context: __compactRuntime.CircuitContext<PS>,
            agent_0: Uint8Array,
            category_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  isAgent(context: __compactRuntime.CircuitContext<PS>, id_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
  registerAgent(context: __compactRuntime.CircuitContext<PS>,
                agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  revokeAgent(context: __compactRuntime.CircuitContext<PS>, agent_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  setCategoryLimit(context: __compactRuntime.CircuitContext<PS>,
                   category_0: bigint,
                   maxSpend_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  advancePeriod(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  issueAuthorization(context: __compactRuntime.CircuitContext<PS>,
                     agent_0: Uint8Array,
                     category_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  exercise(context: __compactRuntime.CircuitContext<PS>,
           category_0: bigint,
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly principal: Uint8Array;
  agents: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  authorized: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  spentRequests: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
  readonly period: bigint;
  spend: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  categoryLimit: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>
  };
  readonly grantsIssued: bigint;
  readonly exercisedCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
