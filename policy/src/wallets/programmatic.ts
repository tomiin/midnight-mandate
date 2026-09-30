/**
 * ADR-036 arbitrary-message signing for a plain Node.js / mnemonic-based
 * wallet.
 *
 * @lumera-protocol/sdk-js@0.3.0 (the version actually published to npm and
 * installed here) does NOT export `createProgrammaticSigner` — only
 * `getKeplrSigner`/`isKeplrAvailable` are exported for wallet signing (both
 * browser/Keplr-specific). Confirmed by reading the installed package's own
 * `dist/types/index.d.ts` and finding no such export, and by finding
 * `dist/types/wallets/programmatic.d.ts` present but empty.
 *
 * The function DOES exist in the SDK's unpublished main-branch source
 * (`lumera-cascade/sdk-js/src/wallets/programmatic.ts`, cloned locally) —
 * it just hasn't shipped to npm yet. This file is a local, hand-rolled
 * reimplementation of that exact approach: wrap a CosmJS mnemonic-derived
 * wallet and add ADR-036 signArbitrary, producing something that satisfies
 * the installed package's own `UniversalSigner` interface
 * (`wallets/signer.d.ts`) so it can be passed straight into
 * `createLumeraClient({ signer, ... })`.
 *
 * See BUILD-LOG.md, "createProgrammaticSigner not exported by 0.3.0" for
 * the full investigation trail.
 */

import { Secp256k1HdWallet, makeSignDoc as makeAminoSignDoc } from "@cosmjs/amino";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import type { AccountData } from "@cosmjs/proto-signing";
import type { ArbitrarySignResponse, UniversalSigner } from "../lumera-types.js";

export interface ProgrammaticSignerOptions {
  /** Bech32 prefix for derived addresses. Defaults to "lumera". */
  prefix?: string;
  /** BIP-39 passphrase, if the mnemonic uses one. */
  bip39Password?: string;
}

/**
 * Build a UniversalSigner from a BIP-39 mnemonic — no browser, no Keplr.
 *
 * Combines CosmJS direct (protobuf) transaction signing with ADR-036
 * arbitrary message signing, matching the interface the installed SDK's
 * Keplr adapter exposes (`wallets/signer.d.ts` -> UniversalSigner).
 */
export async function createProgrammaticSigner(
  mnemonic: string,
  options: ProgrammaticSignerOptions = {}
): Promise<UniversalSigner> {
  const prefix = options.prefix ?? "lumera";
  const opts: { prefix: string; bip39Password?: string } = { prefix };
  if (options.bip39Password !== undefined) {
    opts.bip39Password = options.bip39Password;
  }

  const direct = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, opts);
  const amino = await Secp256k1HdWallet.fromMnemonic(mnemonic, opts);

  const signArbitrary = async (
    _chainId: string,
    signerAddress: string,
    data: string | Uint8Array
  ): Promise<ArbitrarySignResponse> => {
    // Match Keplr/Leap ADR-036 semantics: the `data` field in the
    // MsgSignData envelope is base64(UTF-8 input) for strings, or
    // base64(raw) for byte input.
    const dataB64 = Buffer.from(
      typeof data === "string" ? new TextEncoder().encode(data) : data
    ).toString("base64");

    const msg = {
      type: "sign/MsgSignData",
      value: { signer: signerAddress, data: dataB64 },
    };
    // ADR-036 fixes chain_id="", account_number=0, sequence=0, zero fee.
    const signDoc = makeAminoSignDoc([msg], { gas: "0", amount: [] }, "", "", 0, 0);
    const { signature } = await amino.signAmino(signerAddress, signDoc);

    return {
      signed: typeof data === "string" ? data : dataB64,
      signature: signature.signature,
      pub_key: signature.pub_key as ArbitrarySignResponse["pub_key"],
    };
  };

  const signer: UniversalSigner = {
    getAccounts: (): Promise<readonly AccountData[]> => direct.getAccounts(),
    signDirect: (signerAddress, signDoc) => direct.signDirect(signerAddress, signDoc),
    signAmino: (signerAddress, signDoc) => amino.signAmino(signerAddress, signDoc),
    signArbitrary,
  } as UniversalSigner;

  return signer;
}
