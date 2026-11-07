// Spike: can an AI agent pay through Mandate with NO browser wallet?
//
// Runs the whole story headlessly on Midnight Preprod:
//   principal deploys Mandate, sets a $500 travel budget, registers + authorizes an agent,
//   agent pays $250 (accepted on chain), agent tries $251 more (refused by the contract).
// Prints proof/submit timings so we know what a live AI demo will feel like.
//
// Needs: proof server on localhost:6300, a funded + DUST-synced fee wallet (see config.ts).
// Run:   cd agent && npm run spike
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract, pureCircuits } from '../../contract/src/managed/mandate/contract/index.js';
import { witnesses, createPrivateState } from '../../contract/src/witnesses.ts';
import { buildFeeWallet, waitForDust } from './wallet.js';
import { buildProviders } from './providers.js';
import { FEE_SEED_HEX, MANAGED_DIR, STATE_PATH, NETWORK_NAME } from './config.js';

const PSID = 'mandatePrivateState';
const TRAVEL = 1n;          // category id
const BUDGET = 500n;        // per period
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));

const compiled = CompiledContract.make('mandate', Contract as any).pipe(
  CompiledContract.withWitnesses(witnesses as any),
  CompiledContract.withCompiledFileAssets(MANAGED_DIR),
) as any;

const timings: { step: string; ms: number; result: string }[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now();
  process.stdout.write(`\n> ${name} ... `);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r: any = await fn();
      const ms = Date.now() - t0;
      const tx = r?.public?.txId ?? r?.deployTxData?.public?.txId ?? '';
      timings.push({ step: name, ms, result: `ok ${tx}` });
      console.log(`ok in ${(ms / 1000).toFixed(1)}s ${tx ? 'tx ' + tx : ''}`);
      return r;
    } catch (e: any) {
      let msg = ''; let cur = e;
      while (cur) { msg += ' ' + String(cur.message ?? cur); cur = cur.cause; }
      if (/\b170\b/.test(msg) && attempt < 5) { console.log(`stale DUST spend (170), rebuilding (try ${attempt + 1})`); continue; }
      const ms = Date.now() - t0;
      const refused = msg.match(/Mandate: [^"\n.]+/)?.[0];
      timings.push({ step: name, ms, result: refused ? `REFUSED: ${refused}` : `ERROR: ${msg.trim().slice(0, 200)}` });
      console.log(refused ? `REFUSED by contract: "${refused}" (${(ms / 1000).toFixed(1)}s, nothing submitted)` : `ERROR: ${msg.trim().slice(0, 300)}`);
      return undefined;
    }
  }
}

async function main() {
  console.log(`Mandate headless agent spike (${NETWORK_NAME})`);
  const w = await buildFeeWallet(Buffer.from(FEE_SEED_HEX, 'hex'));
  const dust = await waitForDust(w.facade);
  console.log(`[wallet] DUST ready: ${dust} specks`);
  const providers = buildProviders(w);

  const saved = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, 'utf8')) : null;
  const principalSk = saved ? unhex(saved.principalSk) : new Uint8Array(randomBytes(32));
  const agentSk = saved ? unhex(saved.agentSk) : new Uint8Array(randomBytes(32));
  const agent = pureCircuits.agentId(agentSk);
  const asPrincipal = () => providers.privateStateProvider.set(PSID, createPrivateState(principalSk));
  const asAgent = () => providers.privateStateProvider.set(PSID, createPrivateState(agentSk, new Uint8Array(randomBytes(32))));

  let mandate: any;
  if (saved) {
    console.log(`Reusing contract ${saved.contract}`);
    mandate = await findDeployedContract(providers, {
      compiledContract: compiled, contractAddress: saved.contract,
      privateStateId: PSID, initialPrivateState: createPrivateState(principalSk),
    } as any);
    await asPrincipal();
    await step('principal: advancePeriod (fresh budget for this run)', () => mandate.callTx.advancePeriod());
  } else {
    mandate = await step('principal: deploy Mandate', () => deployContract(providers, {
      compiledContract: compiled, privateStateId: PSID, initialPrivateState: createPrivateState(principalSk),
    } as any));
    if (!mandate) throw new Error('deploy failed');
    const contract = mandate.deployTxData.public.contractAddress;
    writeFileSync(STATE_PATH, JSON.stringify({ contract, principalSk: hex(principalSk), agentSk: hex(agentSk) }, null, 2));
    console.log(`  contract ${contract} (keys saved to .spike-state.json, gitignored)`);
    await step(`principal: setCategoryLimit(travel, ${BUDGET})`, () => mandate.callTx.setCategoryLimit(TRAVEL, BUDGET));
    await step('principal: registerAgent', () => mandate.callTx.registerAgent(agent));
    await step('principal: issueAuthorization(travel)', () => mandate.callTx.issueAuthorization(agent, TRAVEL));
  }

  await asAgent();
  await step('agent: pay $250 for a flight', () => mandate.callTx.exercise(TRAVEL, 250n, new Uint8Array(randomBytes(32))));
  await asAgent();
  await step('agent: pay $251 for a hotel (would exceed $500)', () => mandate.callTx.exercise(TRAVEL, 251n, new Uint8Array(randomBytes(32))));

  console.log('\nSummary');
  for (const t of timings) console.log(`  ${(t.ms / 1000).toFixed(1).padStart(6)}s  ${t.step}  ->  ${t.result}`);
  await w.facade.stop();
  process.exit(0);
}

main().catch((e) => { console.error('\nSpike failed:', e); process.exit(1); });
