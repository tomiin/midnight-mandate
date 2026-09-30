#!/usr/bin/env node
/**
 * Independent on-chain verification for Mandate's Cascade backups.
 *
 * Why this exists: Keplr's History tab shows "No recent transaction
 * history" for this account even though the transactions demonstrably
 * exist. That tab is a convenience view backed by Keplr's own indexing,
 * and it does not surface Lumera's custom action-module messages. The
 * chain itself is the source of truth, so this script asks the chain
 * directly and prints evidence anyone can re-check by hand.
 *
 * No wallet, no keys, no signing — read-only public queries against the
 * Lumera testnet LCD endpoint. Safe to run and safe to publish.
 *
 * Usage:
 *   node scripts/verify-onchain.mjs [lumera-address]
 *
 * Defaults to the address used for the Buildathon demo backups.
 */

const LCD = "https://lcd.testnet.lumera.io";
const DEFAULT_ADDRESS = "lumera1grpvkkzcqsyj5egpn7arj0eyjmy5wlr6ukg6q6";

const address = process.argv[2] ?? DEFAULT_ADDRESS;

const balanceUrl = `${LCD}/cosmos/bank/v1beta1/balances/${address}`;
const txUrl =
  `${LCD}/cosmos/tx/v1beta1/txs` +
  `?query=${encodeURIComponent(`message.sender='${address}'`)}` +
  `&limit=50&order_by=ORDER_BY_DESC`;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} from ${url}`);
  }
  return res.json();
}

function ulumeToLume(amount) {
  // 1 LUME = 1,000,000 ulume. Kept as integer maths on a string so a big
  // balance can never lose precision through a float.
  const n = BigInt(amount);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

async function main() {
  console.log(`Address: ${address}`);
  console.log(`Endpoint: ${LCD}`);
  console.log("");

  const balances = await getJson(balanceUrl);
  console.log("Balance");
  for (const b of balances.balances ?? []) {
    const label = b.denom === "ulume" ? `${ulumeToLume(b.amount)} LUME` : "";
    console.log(`  ${b.amount} ${b.denom}${label ? `  (${label})` : ""}`);
  }
  if ((balances.balances ?? []).length === 0) console.log("  (none)");
  console.log("");

  const txs = await getJson(txUrl);
  const responses = txs.tx_responses ?? [];
  console.log(`Transactions sent by this address: ${txs.total ?? responses.length}`);
  console.log("");

  for (const tx of responses) {
    const messages = (tx.tx?.body?.messages ?? []).map((m) => m["@type"]);
    const ok = tx.code === 0;
    console.log(`  ${tx.txhash}`);
    console.log(`    block      ${tx.height}`);
    console.log(`    time       ${tx.timestamp}`);
    console.log(`    result     ${ok ? "success (code 0)" : `FAILED (code ${tx.code})`}`);
    console.log(`    messages   ${messages.join(", ") || "(none)"}`);
    if (tx.gas_used) console.log(`    gas used   ${tx.gas_used}`);
    console.log("");
  }

  const cascadeTxs = responses.filter((tx) =>
    (tx.tx?.body?.messages ?? []).some((m) =>
      String(m["@type"]).includes("action"),
    ),
  );
  console.log(
    `Cascade action registrations found: ${cascadeTxs.length}` +
      (cascadeTxs.length > 0
        ? ` (all ${cascadeTxs.every((t) => t.code === 0) ? "succeeded" : "NOT all succeeded"})`
        : ""),
  );
  console.log("");
  console.log("Re-check any of this by hand:");
  console.log(`  ${balanceUrl}`);
  console.log(`  ${txUrl}`);
}

main().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
