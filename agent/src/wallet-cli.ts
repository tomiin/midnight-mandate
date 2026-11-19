// Fee-wallet helper for ledger 9 networks (Preprod).
//   npm run wallet:info:preprod      show addresses to fund, NIGHT and DUST balances, sync progress
//   npm run wallet:dust:preprod      register the wallet's NIGHT for DUST generation (pays the network fees)
// Needs FEE_WALLET_SEED (your own 64-hex-character seed) in agent/.env. Never share or commit it.
import { firstValueFrom, filter, timeout } from 'rxjs';
import { isInsufficientDustForFeeError } from '@midnight-ntwrk/wallet-sdk';
import { writeFileSync, renameSync } from 'fs';
import { buildFeeWallet } from './wallet.js';
import { FEE_SEED_HEX, NETWORK_NAME, CHECKPOINT_PATH } from './config.js';

if (/^0{63}1$/.test(FEE_SEED_HEX) && NETWORK_NAME !== 'undeployed') {
  console.error('FEE_WALLET_SEED is the public tutorial seed. Anyone can spend from it and it is empty on Preprod.\nPut your own seed in agent/.env:  FEE_WALLET_SEED=<64 hex characters>  (generate one with: openssl rand -hex 32)');
  process.exit(1);
}
const cmd = process.argv[2] ?? 'info';
const w = await buildFeeWallet(Buffer.from(FEE_SEED_HEX, 'hex'));
console.error(`[wallet] network ${NETWORK_NAME}: syncing (first sync on Preprod can take a long time)…`);

const show = (s: any) => {
  const night = Object.entries(s.unshielded.balances ?? {}).map(([t, v]) => `${t.slice(0, 10)}…: ${v}`).join(', ') || '0';
  let dust = 0n; try { dust = s.dust.balance(new Date()); } catch {}
  const coins = s.unshielded.availableCoins ?? [];
  console.log(`\nUnshielded address (fund this from the faucet): ${String(w.keystore.getBech32Address())}`);
  console.log(`NIGHT balances: ${night}`);
  console.log(`NIGHT coins: ${coins.length} available, ${coins.filter((c: any) => c.meta.registeredForDustGeneration).length} registered for DUST`);
  console.log(`DUST balance: ${dust} specks`);
  console.log(`Synced: ${s.isSynced}   unshielded ${s.unshielded.progress?.appliedIndex}/${s.unshielded.progress?.highestIndex}   dust ${s.dust.progress?.appliedIndex}/${s.dust.progress?.highestIndex}`);
};

// Save sync progress every minute, so an interrupted first sync resumes instead of starting over.
const saveCheckpoint = async () => {
  try {
    const payload = JSON.stringify({ v: 2, shielded: await w.facade.shielded.serializeState(), dust: await w.facade.dust.serializeState(), unshielded: await w.facade.unshielded.serializeState(), savedAt: Date.now() });
    writeFileSync(CHECKPOINT_PATH + '.tmp', payload); renameSync(CHECKPOINT_PATH + '.tmp', CHECKPOINT_PATH);
  } catch { /* best effort */ }
};
const saver = setInterval(saveCheckpoint, 60_000);
const tick = setInterval(async () => { try { const s: any = await firstValueFrom(w.facade.state()); process.stderr.write(`\r[wallet] dust events ${s.dust.progress?.appliedIndex} (wallet ${s.dust.progress?.highestRelevantWalletIndex})  synced=${s.isSynced}   `); } catch {} }, 10_000);
const synced: any = await firstValueFrom(w.facade.state().pipe(filter((s: any) => s.isSynced === true), timeout({ first: Number(process.env.SYNC_TIMEOUT_MIN ?? 240) * 60_000 })));
clearInterval(tick); clearInterval(saver); await saveCheckpoint();
show(synced);

if (cmd === 'dust') {
  const coins = (synced.unshielded.availableCoins ?? []).filter((c: any) => !c.meta.registeredForDustGeneration);
  if (!coins.length) { console.log('\nNothing to register: no unregistered NIGHT coins. Fund the address first, or it is already registered.'); }
  else {
    const register = () => w.facade.registerNightUtxosForDustGeneration(coins, w.keystore.getPublicKey() as any, w.keystore.signDataAsync);
    const recipe = await register().catch(async (e: any) => {
      if (!isInsufficientDustForFeeError(e) || e.estimate?._tag !== 'Reachable') throw e;
      const ms = Number(e.estimate.seconds) * 1000 + 60_000;
      console.log(`\nWaiting about ${Math.ceil(ms / 60_000)} min for the NIGHT to generate enough DUST for the registration fee…`);
      await w.facade.waitForGeneratedDust(coins, e.fee, { timeoutMs: ms });
      return register();
    });
    const tx = await w.facade.finalizeRecipe(recipe);
    const id = await w.facade.submitTransaction(tx);
    console.log(`\nDUST registration submitted: ${id}. DUST builds up over the next minutes; run wallet:info again to check.`);
  }
}
await w.facade.stop();
process.exit(0);
