// Print the fee wallet's unshielded address straight from the seed (no sync needed), so it can be funded
// from the faucet while the first sync is still running.   npm run wallet:address:preprod
import { createKeystore, WalletSeeds } from '@midnight-ntwrk/wallet-sdk';
import { FEE_SEED_HEX, NETWORK_ID, NETWORK_NAME } from './config.js';

if (/^0{63}1$/.test(FEE_SEED_HEX) && NETWORK_NAME !== 'undeployed') {
  console.error('FEE_WALLET_SEED is still the public tutorial seed. Put your own seed in agent/.env first.');
  process.exit(1);
}
const seeds = WalletSeeds.fromMasterSeed(new Uint8Array(Buffer.from(FEE_SEED_HEX, 'hex')));
const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, NETWORK_ID as any);
console.log(`Network: ${NETWORK_NAME}`);
console.log(`Unshielded address (fund this from the faucet): ${String(keystore.getBech32Address())}`);
