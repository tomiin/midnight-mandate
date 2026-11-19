// MidnightProviders for Node on ledger 9 (Midnight.js 5): proof server over HTTP, ZK assets from disk,
// fees paid by the Wallet SDK 2 facade. Midnight.js 5 passes era-tagged transaction handles; the wallet
// facade reads the same transaction from its bytes.
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { createLedger9WalletProvider, createLedger9MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { inMemoryPrivateStateProvider } from './private-state.js';
import { net, MANAGED_DIR, NETWORK_NAME } from './config.js';

export function buildProviders(w: Awaited<ReturnType<typeof import('./wallet.js').buildFeeWallet>>) {
  const zkConfigProvider = new NodeZkConfigProvider<any>(MANAGED_DIR);
  const sign = (data: Uint8Array) => Promise.resolve(w.keystore.signData(data));
  return {
    config: { networkId: NETWORK_NAME, ttlSeconds: 600 },
    privateStateProvider: inMemoryPrivateStateProvider<string, any>(),
    publicDataProvider: indexerPublicDataProvider({ queryURL: net.indexerHttpUrl, subscriptionURL: net.indexerWsUrl } as any),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(net.proofServer, zkConfigProvider),
    walletProvider: createLedger9WalletProvider({
      getCoinPublicKey: () => w.coinPublicKey as any,
      getEncryptionPublicKey: () => w.encryptionPublicKey as any,
      balanceTx: async (tx, ttl) => {
        const handle = w.facade.adoptTransaction(tx.serialize(), 'Unbound');
        const recipe = await w.facade.balanceUnboundTransaction(handle, { ttl: ttl ?? new Date(Date.now() + 10 * 60_000) });
        const signed = await w.facade.signRecipe(recipe, sign as any);
        return (await w.facade.finalizeRecipe(signed)) as any; // a handle with serialize()
      },
    }),
    midnightProvider: createLedger9MidnightProvider(async (tx) => {
      // The Preprod node socket sometimes drops mid-submit; resubmitting the same tx is safe.
      for (let i = 1; ; i++) {
        try { return await w.facade.submitTransaction(w.facade.adoptTransaction(tx.serialize(), 'Finalized')); }
        catch (e: any) {
          if (i >= 5 || !/Normal Closure|disconnected/i.test(String(e?.message ?? e))) throw e;
          await new Promise((r) => setTimeout(r, 2000 * i));
        }
      }
    }),
  } as any;
}
