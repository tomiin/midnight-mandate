// In-memory harness around the compiled Mandate contract.
// `as(name)` swaps the acting caller, so localSecretKey() resolves to them.
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from './managed/mandate/contract/index.js';
import { type MandatePrivateState, createPrivateState, witnesses } from './witnesses.js';
import {
  type CircuitContext,
  type CircuitResults,
  type ContractAddress,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';

// A deterministic 32-byte value from a label, for readable test fixtures.
export const key = (label: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
};

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

// Off-chain mirrors of the contract's pure circuits.
export const agentId = (sk: Uint8Array): Uint8Array => pureCircuits.agentId(sk);
export const grantLeaf = (agent: Uint8Array, category: bigint): Uint8Array =>
  pureCircuits.grantLeaf(agent, category);
// The contract's own ACTOR-domain derivation. Not mirrored in TypeScript — the
// test calls the real circuit so it cannot drift from the contract.
export const actorId = (sk: Uint8Array): Uint8Array => pureCircuits.actorId(sk);

export class MandateSimulator {
  readonly contract: Contract<MandatePrivateState>;
  circuitContext: CircuitContext<MandatePrivateState>;
  private states: Record<string, MandatePrivateState>;
  private commitState: (ps: MandatePrivateState) => void;
  readonly address: ContractAddress;

  constructor(principalSk: Uint8Array) {
    this.contract = new Contract<MandatePrivateState>(witnesses);
    this.address = sampleContractAddress();
    const ps = createPrivateState(principalSk);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(createConstructorContext(ps, hex(principalSk)));
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(currentContractState.data, this.address),
      costModel: CostModel.initialCostModel(),
    };
    this.states = { principal: ps };
    this.commitState = () => {};
  }

  /** Register an actor under a name so `as(name)` can act as them. */
  actor(name: string, secretKey: Uint8Array, requestId?: Uint8Array, forgePathForLeaf?: Uint8Array): this {
    this.states[name] = createPrivateState(secretKey, requestId, forgePathForLeaf);
    return this;
  }

  /** Set which request the named actor is currently trying to exercise. */
  requesting(name: string, requestId: Uint8Array): this {
    const ps = this.states[name];
    if (!ps) throw new Error(`no actor '${name}'`);
    this.states[name] = { ...ps, requestId };
    return this;
  }

  as(name: string): this {
    const ps = this.states[name];
    if (!ps) throw new Error(`no actor '${name}'`);
    this.circuitContext = { ...this.circuitContext, currentPrivateState: ps };
    this.commitState = (next) => { this.states[name] = next; };
    return this;
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  private commit<T>(r: CircuitResults<MandatePrivateState, T>): T {
    this.circuitContext = r.context;
    this.commitState(r.context.currentPrivateState);
    return r.result;
  }

  // ---- contract calls ----
  registerAgent(id: Uint8Array): void {
    this.commit(this.contract.impureCircuits.registerAgent(this.circuitContext, id));
  }
  revokeAgent(id: Uint8Array): void {
    this.commit(this.contract.impureCircuits.revokeAgent(this.circuitContext, id));
  }
  setCategoryLimit(category: bigint, maxSpend: bigint): void {
    this.commit(this.contract.impureCircuits.setCategoryLimit(this.circuitContext, category, maxSpend));
  }
  advancePeriod(): void {
    this.commit(this.contract.impureCircuits.advancePeriod(this.circuitContext));
  }
  issueAuthorization(agent: Uint8Array, category: bigint): void {
    this.commit(this.contract.impureCircuits.issueAuthorization(this.circuitContext, agent, category));
  }
  exercise(category: bigint, amount: bigint): void {
    this.commit(this.contract.impureCircuits.exercise(this.circuitContext, category, amount));
  }
  isAgent(id: Uint8Array): boolean {
    return this.commit(this.contract.impureCircuits.isAgent(this.circuitContext, id));
  }
}

/** Deploy with a principal, one registered agent, and one configured category. */
export const deploy = (opts?: { category?: bigint; limit?: bigint }) => {
  const category = opts?.category ?? 1n;
  const limit = opts?.limit ?? 200n;

  const principalSk = key('principal');
  const agentSk = key('agent');

  const sim = new MandateSimulator(principalSk);
  sim.actor('principal', principalSk);
  sim.actor('agent', agentSk);

  const agentPseudonym = agentId(agentSk);

  sim.as('principal').setCategoryLimit(category, limit);
  sim.as('principal').registerAgent(agentPseudonym);

  return { sim, category, limit, agentPseudonym, principalSk, agentSk };
};
