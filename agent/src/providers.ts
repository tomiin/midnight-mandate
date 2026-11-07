// MidnightProviders for Node: proof server over HTTP, ZK assets from disk, fees paid by the WalletFacade.
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { inMemoryPrivateStateProvider } from '../../api/src/private-state.ts';
import { net, MANAGED_DIR, NETWORK_NAME } from './config.js';

export function buildProviders(w: Awaited<ReturnType<typeof import('./wallet.js').buildFeeWallet>>) {
  setNetworkId(NETWORK_NAME as any); // 'undeployed' | 'preprod'
  const zkConfigProvider = new NodeZkConfigProvider<any>(MANAGED_DIR);
  const secretKeys = { shieldedSecretKeys: w.zswapSecretKeys, dustSecretKey: w.dustSecretKey };
  return {
    privateStateProvider: inMemoryPrivateStateProvider<string, any>(),
    publicDataProvider: indexerPublicDataProvider(net.indexerHttpUrl, net.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(net.proofServer, zkConfigProvider),
    walletProvider: {
      getCoinPublicKey: () => w.zswapSecretKeys.coinPublicKey,
      getEncryptionPublicKey: () => w.zswapSecretKeys.encryptionPublicKey,
      balanceTx: async (tx: any, ttl?: Date) => {
        const recipe = await w.facade.balanceUnboundTransaction(tx, secretKeys,
          { ttl: ttl ?? new Date(Date.now() + 10 * 60_000) });
        const signed = await w.facade.signRecipe(recipe, (p: Uint8Array) => w.keystore.signData(p));
        return (await w.facade.finalizeRecipe(signed)) as any;
      },
    },
    midnightProvider: {
      submitTx: async (tx: any) => {
        // The Preprod node socket sometimes drops mid-submit; resubmitting the same tx is safe.
        for (let i = 1; ; i++) {
          try { await w.facade.submitTransaction(tx); return tx.identifiers()[0]; }
          catch (e: any) {
            if (i >= 5 || !/Normal Closure|disconnected/i.test(String(e?.message ?? e))) throw e;
            await new Promise((r) => setTimeout(r, 2000 * i));
          }
        }
      },
    },
  } as any;
}
