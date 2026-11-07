/**
 * Generic encrypted-file upload to Cascade, used by Mandate Travel's
 * "Back up to Cascade". The file passed in is ALREADY encrypted by the
 * agent server (agent/src/backup.ts) with the owner's passphrase, so it is
 * uploaded with isPublic: true exactly like upload-policy.ts: privacy comes
 * from our encryption, not from Cascade's access control.
 *
 *   tsx src/upload-file.ts <path> <fileName> [days]
 *
 * Prints one machine-readable line at the end: RESULT {"actionId": ...}
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createLumeraClient, CHAIN_PRESETS } from "@lumera-protocol/sdk-js";
import { createProgrammaticSigner } from "./wallets/programmatic.js";

async function main() {
  const [path, fileName = "mandate-backup.enc.json", daysArg = "90"] = process.argv.slice(2);
  if (!path) throw new Error("usage: upload-file <path> <fileName> [days]");
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) throw new Error("MNEMONIC not found in policy/.env");
  const signer = await createProgrammaticSigner(mnemonic);
  const [account] = await signer.getAccounts();
  const client = await createLumeraClient({ preset: "testnet", signer, address: account.address });
  const fileBytes = new Uint8Array(readFileSync(path));
  const uploader = client.Cascade.uploader;
  console.error(`[cascade] wallet ${account.address} on ${CHAIN_PRESETS.testnet.chainId}, ${fileBytes.length} bytes`);
  const prepared = await uploader.prepareFile(fileBytes);
  console.error(`[cascade] 1/3 prepared, dataHash ${prepared.dataHash}`);
  const expirationTime = String(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * Math.max(1, Math.min(365, Number(daysArg) || 90)));
  const registered = await uploader.registerAction(prepared, { fileName, isPublic: true, expirationTime });
  console.error(`[cascade] 2/3 registered action ${registered.actionId}`);
  await uploader.sendFileToSupernodes(registered.actionId, registered.authSignature, fileBytes);
  console.error(`[cascade] 3/3 sent to supernodes`);
  console.log("RESULT " + JSON.stringify({ actionId: String(registered.actionId), chainId: CHAIN_PRESETS.testnet.chainId, address: account.address, dataHash: prepared.dataHash, expirationTime, fileName }));
}
main().catch((e) => { console.log("ERROR " + JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) })); process.exit(1); });
