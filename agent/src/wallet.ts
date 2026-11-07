// Fee wallet: WalletFacade built the same way as midnight-cli-wallet (which is proven on Preprod).
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, PublicKey,
  createKeystore, InMemoryTransactionHistoryStorage, TransactionHistoryStorage, HDWallet, Roles,
} from '@midnight-ntwrk/wallet-sdk';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { NETWORK_ID, net, CHECKPOINT_PATH, NETWORK_NAME } from './config.js';

function deriveKey(seed: Buffer, role: (typeof Roles)[keyof typeof Roles]): Uint8Array {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Invalid seed for HD wallet');
  const d = hd.hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0);
  if (d.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return d.key;
}

export async function buildFeeWallet(seed: Buffer) {
  const zswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(deriveKey(seed, Roles.Zswap));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(deriveKey(seed, Roles.Dust));
  const keystore = createKeystore(deriveKey(seed, Roles.NightExternal), NETWORK_ID);
  // Devnet syncs from scratch in seconds and is wiped on restart, so only Preprod restores a checkpoint.
  const cp = NETWORK_NAME !== 'undeployed' && existsSync(CHECKPOINT_PATH) ? JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) : null;
  if (cp) console.error(`[wallet] restoring DUST/unshielded state from checkpoint saved ${new Date(cp.savedAt).toLocaleString()}`);
  else console.error('[wallet] no checkpoint yet: first sync starts from scratch (seconds on devnet, long on Preprod; progress is saved every minute)');

  const configuration = {
    networkId: NETWORK_ID,
    indexerClientConnection: { indexerHttpUrl: net.indexerHttpUrl, indexerWsUrl: net.indexerWsUrl },
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema),
    provingServerUrl: new URL(net.proofServer),
    relayURL: new URL(net.node),
  };
  const facade = await WalletFacade.init({
    configuration,
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(zswapSecretKeys),
    unshielded: (cfg: any) => cp
      ? UnshieldedWallet(cfg).restore(cp.unshielded)
      : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg: any) => cp
      ? DustWallet(cfg).restore(cp.dust)
      : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  } as any);
  await facade.start(zswapSecretKeys, dustSecretKey);
  return { facade, keystore, zswapSecretKeys, dustSecretKey };
}

// Spending DUST needs the dust wallet caught up, otherwise the node rejects the fee spend (error 170).
export function waitForDust(facade: any, timeoutMs = Number(process.env.DUST_TIMEOUT_MIN ?? 240) * 60_000): Promise<bigint> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let sub: any;
    const save = async () => {
      try {
        const payload = JSON.stringify({ dust: await facade.dust.serializeState(), unshielded: await facade.unshielded.serializeState(), savedAt: Date.now() });
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
      process.stderr.write(`\r[wallet] dust sync ${applied}/${target}  balance ${dust} specks   `);
      if (((target > 0 && target - applied <= 10) || s.isSynced === true) && dust > 0n) {
        clearInterval(tick); sub?.unsubscribe(); process.stderr.write('\n'); save().then(() => resolve(dust));
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(tick); sub?.unsubscribe();
        reject(new Error(`DUST wallet not caught up (${applied}/${target}). Run midnight-cli-wallet \`sync\` first, then retry.`));
      }
    });
  });
}
