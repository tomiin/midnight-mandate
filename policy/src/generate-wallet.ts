// Generates a FRESH, testnet-only Lumera wallet and writes the mnemonic
// straight to a local .env file — it is never printed to the terminal or
// returned anywhere else. Only the derived address is printed, which is
// safe to share (it's how you'll request funds from the faucet and how
// Mandate identifies the principal's Cascade-backing wallet).
//
// Run once. If .env already exists with a MNEMONIC line, this refuses to
// overwrite it — delete that line yourself first if you really want a new one.
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// new URL(...).pathname leaves spaces percent-encoded (%20), which is not a
// valid filesystem path on a directory that has real spaces in its name
// (this repo lives under "Midnight code /"). fileURLToPath decodes it
// properly. Found by running this for real and hitting ENOENT on a path
// containing literal "%20" segments.
const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));
const PREFIX = "lumera";

async function main() {
  if (existsSync(ENV_PATH)) {
    const existing = readFileSync(ENV_PATH, "utf8");
    if (/^MNEMONIC=/m.test(existing)) {
      console.error(
        `A MNEMONIC already exists in ${ENV_PATH}. Refusing to overwrite it. ` +
        `Delete that line yourself first if you actually want a fresh wallet.`
      );
      process.exit(1);
    }
  }

  const wallet = await DirectSecp256k1HdWallet.generate(24, { prefix: PREFIX });
  const [account] = await wallet.getAccounts();
  const mnemonic = wallet.mnemonic;

  const envLine = `MNEMONIC="${mnemonic}"\n`;
  if (existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, readFileSync(ENV_PATH, "utf8") + envLine);
  } else {
    writeFileSync(ENV_PATH, envLine);
  }

  console.log("Wallet generated. Mnemonic written to policy/.env (not printed here, not committed to git).");
  console.log("");
  console.log("Your testnet address (safe to share, this is what the faucet needs):");
  console.log(account.address);
}

main().catch((err) => {
  console.error("Wallet generation failed:", err);
  process.exit(1);
});
