// Mandate client used by the MCP server and the demo reset script.
// Same calls the spike proved on devnet: findDeployedContract + callTx.<circuit>().
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract, ledger, pureCircuits } from '../../contract/src/managed/mandate/contract/index.js';
import { witnesses, createPrivateState } from '../../contract/src/witnesses.ts';
import { buildFeeWallet, waitForDust } from './wallet.js';
import { buildProviders } from './providers.js';
import { FEE_SEED_HEX, MANAGED_DIR, STATE_PATH } from './config.js';

export const PSID = 'mandatePrivateState';
export const CATEGORY = { travel: 1n } as const;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

const compiled = CompiledContract.make('mandate', Contract as any).pipe(
  CompiledContract.withWitnesses(witnesses as any),
  CompiledContract.withCompiledFileAssets(MANAGED_DIR),
) as any;

export type Session = Awaited<ReturnType<typeof connect>>;

/** Sync the fee wallet and join (or deploy, if allowed) the Mandate contract. */
export async function connect(opts: { deployIfMissing?: boolean } = {}) {
  const w = await buildFeeWallet(Buffer.from(FEE_SEED_HEX, 'hex'));
  await waitForDust(w.facade);
  const providers = buildProviders(w);

  let state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null;
  const principalSk = state ? unhex(state.principalSk) : new Uint8Array(randomBytes(32));
  const agentSk = state ? unhex(state.agentSk) : new Uint8Array(randomBytes(32));
  let contract: any;
  if (state) {
    // A local devnet restart wipes the chain. Check the contract exists first, because
    // findDeployedContract waits forever for a contract that is not there.
    const exists = await Promise.race([
      providers.publicDataProvider.queryContractState(state.contract).then((cs: any) => !!cs).catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
    ]);
    if (!exists) {
      if (!opts.deployIfMissing) throw new Error(`Mandate contract ${state.contract.slice(0, 12)}… is not on this chain (devnet restarted?). Run: npm run demo:reset`);
      console.error('[mandate] saved contract is not on this chain, deploying a fresh one');
      state = null;
    }
  }
  if (state) {
    try {
      contract = await findDeployedContract(providers, {
        compiledContract: compiled, contractAddress: state.contract,
        privateStateId: PSID, initialPrivateState: createPrivateState(principalSk),
      } as any);
    } catch (e: any) {
      // A local devnet restart wipes the chain, so the saved contract can disappear.
      if (!opts.deployIfMissing) throw new Error(`Saved Mandate contract ${state.contract} not found (${e.message}). Run: npm run demo:reset`);
      console.error(`[mandate] saved contract not found, deploying a fresh one`);
      state = null;
    }
  }
  if (!contract) {
    if (!opts.deployIfMissing) throw new Error(`No Mandate contract for this network yet. Run: npm run demo:reset`);
    contract = await deployContract(providers, {
      compiledContract: compiled, privateStateId: PSID, initialPrivateState: createPrivateState(principalSk),
    } as any);
    state = { contract: contract.deployTxData.public.contractAddress, principalSk: hex(principalSk), agentSk: hex(agentSk) };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
  const agentId = pureCircuits.agentId(agentSk);

  const asPrincipal = () => providers.privateStateProvider.set(PSID, createPrivateState(principalSk));
  const asAgent = () => providers.privateStateProvider.set(PSID, createPrivateState(agentSk, new Uint8Array(randomBytes(32))));

  /** Read the public ledger (what anyone can see). */
  async function publicState() {
    const cs = await providers.publicDataProvider.queryContractState(state.contract);
    if (!cs) throw new Error('contract state not found');
    const l: any = ledger(cs.data);
    const limit = l.categoryLimit.member(CATEGORY.travel) ? l.categoryLimit.lookup(CATEGORY.travel) : 0n;
    return {
      contract: state.contract as string,
      travelLimit: Number(limit),
      period: Number(l.period),
      agentActive: l.agents.member(agentId) && l.agents.lookup(agentId),
      paymentsOnLedger: Number(l.exercisedCount),
    };
  }

  /** Agent pays `amount` from its mandate. Throws MandateRefused if the contract says no. */
  /** Merchant-side lookup: was this order reference paid, and for how much? */
  async function paidAmount(orderRef: Uint8Array): Promise<number | null> {
    const cs = await providers.publicDataProvider.queryContractState(state.contract);
    const l: any = cs && ledger(cs.data);
    return l && l.paidOrders.member(orderRef) ? Number(l.paidOrders.lookup(orderRef)) : null;
  }

  async function pay(amount: number, orderRef: Uint8Array, category: bigint = CATEGORY.travel) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await asAgent();
      const t0 = Date.now();
      try {
        const r = await contract.callTx.exercise(category, BigInt(amount), orderRef);
        return { txId: r.public.txId as string, blockHeight: r.public.blockHeight as number, proveAndSubmitMs: Date.now() - t0 };
      } catch (e: any) {
        let msg = ''; let cur = e;
        while (cur) { msg += ' ' + String(cur.message ?? cur); cur = cur.cause; }
        const refused = msg.match(/Mandate: [^"\n]+?(?= failed assert|$)/)?.[0];
        if (refused) throw new MandateRefused(refused.trim());
        if (/\b170\b/.test(msg) && attempt < 5) continue; // stale DUST fee spend: rebuild and retry
        throw e;
      }
    }
    throw new Error('payment failed after retries');
  }

  return {
    wallet: w, providers, contractAddress: state.contract as string, publicState, pay, paidAmount,
    principal: {
      advancePeriod: async () => { await asPrincipal(); return contract.callTx.advancePeriod(); },
      setTravelLimit: async (n: number) => { await asPrincipal(); return contract.callTx.setCategoryLimit(CATEGORY.travel, BigInt(n)); },
      registerAgent: async () => { await asPrincipal(); return contract.callTx.registerAgent(agentId); },
      revokeAgent: async () => { await asPrincipal(); return contract.callTx.revokeAgent(agentId); },
      authorizeTravel: async () => { await asPrincipal(); return contract.callTx.issueAuthorization(agentId, CATEGORY.travel); },
    },
  };
}

export class MandateRefused extends Error {}
