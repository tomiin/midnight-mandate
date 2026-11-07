// Prepare a clean demo: deploy if needed, fresh budget period, $500 travel limit, agent registered + authorized.
// Run: npm run demo:reset   (devnet)   |   MN_NETWORK=preprod npm run demo:reset
import { connect } from './mandate.js';
import { existsSync, readFileSync } from 'fs';
import { STATE_PATH } from './config.js';

const LIMIT = Number(process.env.TRAVEL_LIMIT ?? 500);
const before = existsSync(STATE_PATH) ? readFileSync(STATE_PATH, 'utf8') : '';
const s = await connect({ deployIfMissing: true });
const fresh = before !== readFileSync(STATE_PATH, 'utf8');
console.log(`Mandate contract ${s.contractAddress}${fresh ? ' (newly deployed)' : ''}`);
const step = async (name: string, fn: () => Promise<any>) => { const t = Date.now(); await fn(); console.log(`  ok ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`); };
let st = await s.publicState();
if (!fresh) await step('advancePeriod (fresh budget)', s.principal.advancePeriod);
if (st.travelLimit !== LIMIT) await step(`setCategoryLimit(travel, ${LIMIT})`, () => s.principal.setTravelLimit(LIMIT));
if (!st.agentActive) {
  await step('registerAgent', s.principal.registerAgent);
  await step('issueAuthorization(travel)', s.principal.authorizeTravel);
}
st = await s.publicState();
console.log('Ready:', st);
await s.wallet.facade.stop();
process.exit(0);
