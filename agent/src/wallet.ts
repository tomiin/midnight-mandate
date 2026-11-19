// Fee wallet for ledger 9 (Wallet SDK 2.0.1). The SDK starts its three wallets (shielded, unshielded, Dust)
// from seeds, so it can follow a chain across a protocol boundary. Preprod moved to ledger 9 on 9 Nov 2026.
import {
  WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, PublicKey, createKeystore,
  InMemoryTransactionHistoryStorage, WalletEntrySchema, WalletSeeds, DefaultForkSchedule,
} from '@midnight-ntwrk/wallet-sdk';
import { firstValueFrom } from 'rxjs';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { NETWORK_ID, net, CHECKPOINT_PATH, NETWORK_NAME } from './config.js';

export async function buildFeeWallet(masterSeed: Buffer) {
  const seeds = WalletSeeds.fromMasterSeed(new Uint8Array(masterSeed));
  const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, NETWORK_ID as any);
  // Only Preprod restores a checkpoint (the local devnet is wiped on restart and syncs in seconds).
  const cp = NETWORK_NAME !== 'undeployed' && existsSync(CHECKPOINT_PATH) ? JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) : null;
  if (cp?.v !== 2) { if (cp) console.error('[wallet] ignoring an old (ledger 8) checkpoint'); }
  const restore = cp?.v === 2 ? cp : null;
  if (restore) console.error(`[wallet] restoring DUST/unshielded state from checkpoint saved ${new Date(restore.savedAt).toLocaleString()}`);
  else console.error('[wallet] no checkpoint yet: first sync starts from scratch (long on Preprod; progress is saved every minute)');

  const configuration = {
    networkId: NETWORK_ID,
    indexerClientConnection: { indexerHttpUrl: net.indexerHttpUrl, indexerWsUrl: net.indexerWsUrl },
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema as any),
    provingServerUrl: new URL(net.proofServer),
    relayURL: new URL(net.node),
  };
  const facade = await WalletFacade.init({
    configuration,
    shielded: (cfg: any) => restore?.shielded ? ShieldedWallet(cfg).restore(restore.shielded) : ShieldedWallet(cfg).startWithSeed(seeds.shielded),
    unshielded: (cfg: any) => restore
      ? UnshieldedWallet(cfg).restore(restore.unshielded)
      : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg: any) => restore ? DustWallet(cfg).restore(restore.dust) : DustWallet(cfg).startWithSeed(seeds.dust),
  } as any);
  await facade.start(seeds);
  const st: any = await firstValueFrom(facade.state());
  const coinPublicKey: string = st.shielded.coinPublicKey.toHexString();
  const encryptionPublicKey: string = st.shielded.encryptionPublicKey.toHexString();
  return { facade, keystore, coinPublicKey, encryptionPublicKey };
}

/** Addresses to fund from the faucet (printed by `npm run wallet:info`). */
export async function addressesOf(w: Awaited<ReturnType<typeof buildFeeWallet>>) {
  const st: any = await firstValueFrom(w.facade.state());
  return { unshielded: String(st.unshielded.address), dust: String(st.dust.address), shielded: String(st.shielded.address) };
}

// Spending DUST needs the Dust wallet caught up, otherwise the node rejects the fee spend.
const V9 = (DefaultForkSchedule as any).v9;
export function waitForDust(facade: any, timeoutMs = Number(process.env.DUST_TIMEOUT_MIN ?? 240) * 60_000): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let sub: any;
    const save = async () => {
      try {
        const payload = JSON.stringify({ v: 2, shielded: await facade.shielded.serializeState(), dust: await facade.dust.serializeState(), unshielded: await facade.unshielded.serializeState(), savedAt: Date.now() });
        writeFileSync(CHECKPOINT_PATH + '.tmp', payload); renameSync(CHECKPOINT_PATH + '.tmp', CHECKPOINT_PATH);
      } catch { /* best effort */ }
    };
    const tick = setInterval(save, 60_000);
    sub = facade.state().subscribe((s: any) => {
      const pr = s.dust?.progress;
      const applied = Number(pr?.appliedIndex ?? 0);
      const target = Number(pr?.highestRelevantWalletIndex ?? 0);
      let dust = 0n;
      try { dust = s.dust.balance(new Date()); } catch {}
      // Transact only once all three wallets are synced AND settled on ledger 9: the facade acts at the version of
      // the wallet furthest behind, and one still below the 9 Nov 2026 fork builds ledger 8 transactions.
      const phase = s.protocol?._tag === 'Settled' ? `settled@${s.activeProtocolVersion}` : `crossing (behind: ${(s.protocol?.behind ?? []).join(',')})`;
      const onV9 = s.protocol?._tag === 'Settled' && BigInt(String(s.activeProtocolVersion)) >= BigInt(String(V9));
      process.stderr.write(`\r[wallet] dust ${applied}/${target}  balance ${dust}  synced=${s.isSynced}  ${phase}   `);
      if (s.isSynced === true && onV9 && dust > 0n) {
        clearInterval(tick); sub?.unsubscribe(); process.stderr.write('\n'); save().then(() => resolve(dust));
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(tick); sub?.unsubscribe();
        reject(new Error(`DUST wallet not caught up or empty (${applied}/${target}, balance ${dust}). Fund the wallet and register DUST, then retry.`));
      }
    });
  });
}
