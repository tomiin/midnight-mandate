// Network selection: MN_NETWORK=undeployed (local devnet, default for building) | preprod (Blockfrost).
import { NetworkId } from '@midnight-ntwrk/wallet-sdk';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
export const NETWORK_NAME = (process.env.MN_NETWORK ?? 'undeployed').toLowerCase();

function preprod() {
  // Midnight's own Preprod indexer/RPC were decommissioned on 2026-10-09; Blockfrost serves them now.
  const BF = encodeURIComponent((process.env.BLOCKFROST_PREPROD_PROJECT_ID ?? '').trim());
  if (!BF) {
    console.error('Missing BLOCKFROST_PREPROD_PROJECT_ID in agent/.env');
    process.exit(1);
  }
  return {
    networkId: NetworkId.NetworkId.PreProd,
    indexerHttpUrl: `https://midnight-preprod.blockfrost.io/api/v0?project_id=${BF}`,
    indexerWsUrl: `wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=${BF}`,
    node: `wss://rpc.midnight-preprod.blockfrost.io?project_id=${BF}`,
  };
}
// Local devnet from midnight-cli-wallet/devnet.yml (node 9944, indexer 8088). The dev preset
// pre-mints NIGHT to seed 0x..01, so no faucet and DUST catches up in seconds.
const undeployed = () => ({
  networkId: NetworkId.NetworkId.Undeployed,
  indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  indexerWsUrl: 'ws://localhost:8088/api/v4/graphql/ws',
  node: 'ws://localhost:9944',
});

const sel = NETWORK_NAME === 'preprod' ? preprod() : NETWORK_NAME === 'undeployed' ? undeployed() : null;
if (!sel) { console.error(`Unknown MN_NETWORK "${NETWORK_NAME}" (use undeployed or preprod)`); process.exit(1); }

export const NETWORK_ID = sel.networkId;
export const net = { ...sel, proofServer: process.env.PROOF_SERVER ?? 'http://localhost:6300' };
export const MANAGED_DIR = resolve(here, '../../contract/src/managed/mandate');

// Fee wallet seed. 0x..01 = devnet genesis wallet (pre-funded) and the funded Preprod tutorial wallet.
export const FEE_SEED_HEX = process.env.FEE_WALLET_SEED ??
  '0000000000000000000000000000000000000000000000000000000000000001';
// Our own per-network wallet checkpoint (the July cli-wallet one is incompatible with Blockfrost's index).
export const CHECKPOINT_PATH = resolve(here, `../.wallet-checkpoint-${NETWORK_NAME}.json`);
export const STATE_PATH = resolve(here, `../.spike-state-${NETWORK_NAME}.json`);
