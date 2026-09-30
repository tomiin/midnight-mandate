/**
 * Encrypts the principal's Mandate authorization policy — the
 * human-readable operational notes behind the on-chain opaque hashes
 * (which agent pseudonym is which real agent, what each category label
 * means, what caps were actually agreed) — and backs it up to Cascade.
 *
 * On-chain, Mandate only ever sees `agentId`/`grantLeaf`/category numbers:
 * domain-separated hashes with no human meaning outside the principal's
 * own head. If the principal loses that mapping, the contract still works
 * perfectly but nobody can explain what it authorized. This script is the
 * "don't lose the device" backup for that mapping, matching Cascade's own
 * "Storage First" pattern for static credentials (see
 * lumera-cascade-dolos-findings memory).
 *
 * Flow: build the policy JSON -> encrypt client-side (crypto.ts) ->
 * prepareFile -> registerAction -> sendFileToSupernodes (the explicit
 * 3-step CascadeUploader flow, chosen over the one-shot uploadFile()
 * orchestrator specifically because registerAction() returns a concrete,
 * typed actionId; uploadFile()'s Task return type doesn't expose one
 * cleanly). Uploaded with isPublic: true — see crypto.ts header for why
 * that's safe here.
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLumeraClient, CHAIN_PRESETS } from "@lumera-protocol/sdk-js";
import { createProgrammaticSigner } from "./wallets/programmatic.js";
import { derivePolicyKey, encryptJson } from "./crypto.js";

const REFERENCE_PATH = fileURLToPath(new URL("../policy-reference.json", import.meta.url));

// The actual policy: real agent labels, category meanings, and caps behind
// the on-chain hashes. Replace with the real registered values before the
// Buildathon demo; these are placeholder/example entries for the round-trip
// test.
const POLICY = {
  version: 1,
  principalNote: "Mandate demo principal — Buildathon Wave 2 submission",
  agents: [
    { label: "travel-booking-agent", category: 1, categoryLabel: "travel", capUnits: 500 },
    { label: "grocery-reorder-agent", category: 2, categoryLabel: "groceries", capUnits: 150 },
  ],
  notes: "Caps are budget-tracked as a dollar-equivalent sum per period, not a count of calls — see README 'What this does'.",
};

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error("MNEMONIC not found in policy/.env — run `npm run generate-wallet` first.");
    process.exit(1);
  }

  const signer = await createProgrammaticSigner(mnemonic);
  const [account] = await signer.getAccounts();
  const address = account.address;
  const chainId = CHAIN_PRESETS.testnet.chainId;

  console.log(`Using wallet: ${address}`);
  console.log(`Chain: ${chainId}`);

  const client = await createLumeraClient({
    preset: "testnet",
    signer,
    address,
  });

  console.log("Deriving encryption key from wallet signature (ADR-036 signArbitrary)...");
  const key = await derivePolicyKey(signer, chainId, address);

  console.log("Encrypting policy document...");
  const payload = encryptJson(key, POLICY);
  const fileBytes = new TextEncoder().encode(JSON.stringify(payload));

  const uploader = client.Cascade.uploader;

  console.log("Step 1/3: prepareFile...");
  const prepared = await uploader.prepareFile(fileBytes);
  console.log(`  dataHash: ${prepared.dataHash}`);

  // Short expiration while we're still iterating on this script — a
  // failed sendFileToSupernodes step (as happened once already, see
  // BUILD-LOG.md's LEP-5 merkle bug entry) leaves the escrowed action fee
  // locked until expiry, so a long window just parks funds on every retry.
  // Extend this once the round-trip is confirmed working and this is the
  // real Buildathon demo upload.
  const expirationTime = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7); // +7 days

  console.log("Step 2/3: registerAction...");
  const registered = await uploader.registerAction(prepared, {
    fileName: "mandate-policy.enc.json",
    isPublic: true,
    expirationTime,
  });
  console.log(`  actionId: ${registered.actionId}`);

  console.log("Step 3/3: sendFileToSupernodes...");
  const task = await uploader.sendFileToSupernodes(registered.actionId, registered.authSignature, fileBytes);
  console.log("  task:", JSON.stringify(task, null, 2));

  const reference = {
    actionId: registered.actionId,
    fileName: "mandate-policy.enc.json",
    chainId,
    address,
    expirationTime,
    uploadedAt: new Date().toISOString(),
  };
  writeFileSync(REFERENCE_PATH, JSON.stringify(reference, null, 2) + "\n");

  console.log("");
  console.log(`Done. Reference written to policy/policy-reference.json (actionId: ${registered.actionId}).`);
  console.log("Run `npm run download-policy` to fetch and decrypt it back.");
}

main().catch((err) => {
  console.error("Policy upload failed:", err);
  process.exit(1);
});
