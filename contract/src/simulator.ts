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
  type ChargedState,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
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
  readonly address: ContractAddress;
  private state!: ChargedState;
  private coinPublicKey: string;
  private states: Record<string, MandatePrivateState>;
  private current = 'principal';

  private constructor(principalSk: Uint8Array) {
    this.contract = new Contract<MandatePrivateState>(witnesses);
    this.address = sampleContractAddress();
    this.coinPublicKey = hex(principalSk);
    this.states = { principal: createPrivateState(principalSk) };
  }

  /** compact-runtime 0.21: the constructor (initialState) is async, so build through this factory. */
  static async create(principalSk: Uint8Array): Promise<MandateSimulator> {
    const sim = new MandateSimulator(principalSk);
    const { currentPrivateState, currentContractState } =
      await sim.contract.initialState(createConstructorContext(sim.states.principal, sim.coinPublicKey));
    sim.state = currentContractState.data;
    sim.states.principal = currentPrivateState;
    return sim;
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
    if (!this.states[name]) throw new Error(`no actor '${name}'`);
    this.current = name;
    return this;
  }

  getLedger(): Ledger {
    return ledger(this.state);
  }

  // A fresh circuit context per call, built from the current on-chain state and the acting caller's private state.
  private ctx(circuitId: string): CircuitContext<MandatePrivateState> {
    return createCircuitContext<MandatePrivateState>({
      circuitId: circuitId as any,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: this.coinPublicKey,
      contractState: this.state,
      privateState: this.states[this.current],
      costModel: CostModel.initialCostModel(),
    });
  }

  private async run<T>(circuitId: string, call: (c: CircuitContext<MandatePrivateState>) => Promise<CircuitResults<MandatePrivateState, T>>): Promise<T> {
    const r = await call(this.ctx(circuitId));
    this.state = r.context.callContext.currentQueryContext.state;
    if (r.context.callContext.currentPrivateState) this.states[this.current] = r.context.callContext.currentPrivateState;
    return r.result;
  }

  // ---- contract calls ----
  async registerAgent(id: Uint8Array): Promise<void> {
    await this.run('registerAgent', (c) => this.contract.impureCircuits.registerAgent(c, id));
  }
  async revokeAgent(id: Uint8Array): Promise<void> {
    await this.run('revokeAgent', (c) => this.contract.impureCircuits.revokeAgent(c, id));
  }
  async setCategoryLimit(category: bigint, maxSpend: bigint): Promise<void> {
    await this.run('setCategoryLimit', (c) => this.contract.impureCircuits.setCategoryLimit(c, category, maxSpend));
  }
  async advancePeriod(): Promise<void> {
    await this.run('advancePeriod', (c) => this.contract.impureCircuits.advancePeriod(c));
  }
  async issueAuthorization(agent: Uint8Array, category: bigint): Promise<void> {
    await this.run('issueAuthorization', (c) => this.contract.impureCircuits.issueAuthorization(c, agent, category));
  }
  /** orderRef defaults to a fresh random reference so older tests keep their meaning. */
  async exercise(category: bigint, amount: bigint, orderRef: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): Promise<void> {
    await this.run('exercise', (c) => this.contract.impureCircuits.exercise(c, category, amount, orderRef));
  }
  async isAgent(id: Uint8Array): Promise<boolean> {
    return this.run('isAgent', (c) => this.contract.impureCircuits.isAgent(c, id));
  }
}

/** Deploy with a principal, one registered agent, and one configured category. */
export const deploy = async (opts?: { category?: bigint; limit?: bigint }) => {
  const category = opts?.category ?? 1n;
  const limit = opts?.limit ?? 200n;

  const principalSk = key('principal');
  const agentSk = key('agent');

  const sim = await MandateSimulator.create(principalSk);
  sim.actor('agent', agentSk);

  const agentPseudonym = agentId(agentSk);

  await sim.as('principal').setCategoryLimit(category, limit);
  await sim.as('principal').registerAgent(agentPseudonym);

  return { sim, category, limit, agentPseudonym, principalSk, agentSk };
};
