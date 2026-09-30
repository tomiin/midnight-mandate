/**
 * `@lumera-protocol/sdk-js@0.3.0` (the version actually published to npm)
 * does not export `UniversalSigner` or `ArbitrarySignResponse` from its
 * public root entrypoint — confirmed by reading the installed package's
 * own `dist/types/index.d.ts`, which has no such export. It's not just
 * missing from the barrel file either: the package's own `package.json`
 * "exports" map only lists `.`, `./compat/blake3`, and `./compat/zstd` —
 * there is no `./wallets/signer` subpath, so even a deep import is
 * genuinely blocked by Node's own module resolution, not merely
 * undocumented.
 *
 * These are local, structural re-declarations of that same interface,
 * copied field-for-field from the installed package's own
 * `dist/types/wallets/signer.d.ts` (read directly, not guessed — see
 * BUILD-LOG.md). Because TypeScript is structurally typed, an object
 * matching this shape is assignable anywhere the SDK's own (unreachable
 * from here) `UniversalSigner` type is used internally — in particular
 * `LumeraClientConfig.signer`, whose declared type (`OfflineSigner` from
 * `@cosmjs/proto-signing`) is a strict subset of this shape, so passing a
 * value shaped like this compiles and works identically to passing the
 * SDK's own type.
 */

import type { AminoSignResponse, OfflineAminoSigner } from "@cosmjs/amino";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";

export interface ArbitrarySignResponse {
  /** The signed data (may be modified by the wallet). */
  signed: string;
  /** Base64-encoded signature. */
  signature: string;
  /** Public key used for signing. */
  pub_key: { type: string; value: string };
}

export interface UniversalSigner extends OfflineAminoSigner, OfflineDirectSigner {
  signArbitrary(chainId: string, signerAddress: string, data: string): Promise<ArbitrarySignResponse>;
}

// Re-exported so call sites don't need to know AminoSignResponse lives
// upstream in @cosmjs/amino.
export type { AminoSignResponse };
