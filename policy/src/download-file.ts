/**
 * Generic Cascade download, used by Mandate Travel's "Restore from Cascade".
 *   tsx src/download-file.ts <actionId> <outPath>
 * Writes the raw (still encrypted) bytes; the agent server decrypts them.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createLumeraClient } from "@lumera-protocol/sdk-js";
import { createProgrammaticSigner } from "./wallets/programmatic.js";

async function main() {
  const [actionId, out] = process.argv.slice(2);
  if (!actionId || !out) throw new Error("usage: download-file <actionId> <outPath>");
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) throw new Error("MNEMONIC not found in policy/.env");
  const signer = await createProgrammaticSigner(mnemonic);
  const [account] = await signer.getAccounts();
  const client = await createLumeraClient({ preset: "testnet", signer, address: account.address });
  const stream = await client.Cascade.downloader.download(actionId);
  const reader = stream.getReader(); const chunks: Buffer[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(Buffer.from(value)); }
  const buf = Buffer.concat(chunks); writeFileSync(out, buf, { mode: 0o600 });
  console.log("RESULT " + JSON.stringify({ actionId, bytes: buf.length }));
}
main().catch((e) => { console.log("ERROR " + JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) })); process.exit(1); });
