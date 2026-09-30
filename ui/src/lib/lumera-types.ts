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
 * `dist/types/wallets/signer.d.ts`. Because TypeScript is structurally
 * typed, an object matching this shape is assignable anywhere the SDK's
 * own (unreachable from here) `UniversalSigner` type is used internally.
 *
 * Duplicated from policy/src/lumera-types.ts rather than imported,
 * because `policy/` is a standalone folder (not a workspace member of the
 * root package.json — see root package.json's "workspaces" list), so `ui`
 * has no module path to it. Keep both copies in sync if the installed
 * SDK's own signer.d.ts ever changes.
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

export type { AminoSignResponse };
