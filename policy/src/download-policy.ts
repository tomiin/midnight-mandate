/**
 * Fetches the encrypted Mandate policy backup from Cascade and decrypts it,
 * proving the recovery round-trip (needed for real confidence and for the
 * Buildathon demo itself). See upload-policy.ts for what it uploads and why.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLumeraClient, CHAIN_PRESETS } from "@lumera-protocol/sdk-js";
import { createProgrammaticSigner } from "./wallets/programmatic.js";
import { derivePolicyKey, decryptJson, type EncryptedPayload } from "./crypto.js";

const REFERENCE_PATH = fileURLToPath(new URL("../policy-reference.json", import.meta.url));

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    console.error("MNEMONIC not found in policy/.env — run `npm run generate-wallet` first.");
    process.exit(1);
  }

  // An explicit actionId on the command line wins, so any backup can be
  // restored — including one uploaded from the browser UI, which writes no
  // policy-reference.json. Falls back to the last CLI upload.
  //   npm run download-policy -- 88119
  const requestedActionId = process.argv[2];

  let actionId: string;
  if (requestedActionId) {
    actionId = requestedActionId;
  } else {
    try {
      const reference: { actionId: string } = JSON.parse(
        readFileSync(REFERENCE_PATH, "utf8"),
      );
      actionId = reference.actionId;
    } catch {
      console.error(
        "No actionId given and policy/policy-reference.json not found — " +
          "pass one (`npm run download-policy -- <actionId>`) or run " +
          "`npm run upload-policy` first.",
      );
      process.exit(1);
    }
  }

  const signer = await createProgrammaticSigner(mnemonic);
  const [account] = await signer.getAccounts();
  const address = account.address;
  const chainId = CHAIN_PRESETS.testnet.chainId;

  const client = await createLumeraClient({
    preset: "testnet",
    signer,
    address,
  });

  console.log(`Downloading actionId ${actionId}...`);
  const stream = await client.Cascade.downloader.download(actionId);
  const fileBytes = await streamToBuffer(stream);
  const payload: EncryptedPayload = JSON.parse(fileBytes.toString("utf8"));

  console.log("Re-deriving encryption key from wallet signature...");
  const key = await derivePolicyKey(signer, chainId, address);

  console.log("Decrypting...");
  const policy = decryptJson(key, payload);

  console.log("");
  console.log("Recovered policy:");
  console.log(JSON.stringify(policy, null, 2));
}

main().catch((err) => {
  console.error("Policy download failed:", err);
  process.exit(1);
});
