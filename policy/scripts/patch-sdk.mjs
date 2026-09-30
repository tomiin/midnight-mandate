#!/usr/bin/env node
/**
 * Postinstall patch for a confirmed upstream bug in
 * `@lumera-protocol/sdk-js@0.3.0` (the latest version actually published to
 * npm as of 2026-09-14 — checked at registry.npmjs.org, not guessed).
 *
 * Bug: `buildTree()` in `cascade/commitment.ts` promotes a lone odd-indexed
 * Merkle node to the next level UNCHANGED instead of duplicating it and
 * hashing it with itself. The on-chain Go implementation
 * (`lumera/x/action/v1/merkle.BuildTree`, which SuperNodes use to verify
 * uploads) does the duplicate-and-hash version. Any file whose chunk count
 * produces an odd tree level therefore commits a WRONG availability
 * commitment root on-chain, and the SuperNode rejects the upload with:
 *
 *   LEP-5 commitment root verification failed: merkle root mismatch
 *
 * Power-of-two chunk counts never hit the odd branch, which is why this
 * shipped un-caught. Confirmed by hitting it for real (a 614-byte file
 * chunked into 5 pieces, action 88068 on lumera-testnet-2, 2026-09-14) and
 * by reading the actual fix: LumeraProtocol/sdk-js PR #14, "fix(cascade):
 * duplicate last merkle node on odd levels to match LEP-5", merged to
 * `master` 2026-08-20 but NOT YET published to npm (0.3.0 is still latest,
 * published 2026-07-14 — checked registry.npmjs.org directly, not assumed).
 *
 * This script applies that exact same one-line fix directly to the
 * installed package after every `npm install`, so we don't have to track
 * an unreleased git branch or wait on a new npm release. Idempotent and
 * safe to run against an already-patched or already-fixed-upstream copy —
 * it only ever touches an exact, verified string match and warns loudly
 * (without failing the install) if that string isn't found in either its
 * old or new form, which would mean the package changed shape and this
 * script needs a look.
 *
 * See BUILD-LOG.md, "Confirmed and patched: LEP-5 merkle root bug".
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PKG_ROOT = fileURLToPath(new URL("../node_modules/@lumera-protocol/sdk-js", import.meta.url));

const TARGETS = [
  `${PKG_ROOT}/dist/esm/cascade/commitment.js`,
  `${PKG_ROOT}/dist/cjs/cascade/commitment.js`,
];

const OLD = `            else {
                // Odd node: promote to next level
                next.push(current[i]);
            }`;

const NEW = `            else {
                // Odd node: duplicate so it pairs with itself, matching the
                // on-chain Go implementation (merkle.BuildTree) — patched
                // locally per LumeraProtocol/sdk-js#14 (merged to master,
                // not yet published to npm as of 0.3.0). See BUILD-LOG.md.
                next.push(await hashNode(current[i], current[i]));
            }`;

let patchedAny = false;
let alreadyPatchedAny = false;

for (const path of TARGETS) {
  if (!existsSync(path)) {
    console.warn(`[patch-sdk] Skipping — file not found: ${path}`);
    continue;
  }
  const contents = readFileSync(path, "utf8");
  if (contents.includes(NEW)) {
    alreadyPatchedAny = true;
    continue;
  }
  if (contents.includes(OLD)) {
    writeFileSync(path, contents.replace(OLD, NEW));
    console.log(`[patch-sdk] Patched LEP-5 odd-node Merkle bug in ${path}`);
    patchedAny = true;
    continue;
  }
  console.warn(
    `[patch-sdk] WARNING: expected text not found in ${path}. ` +
    `Either the installed @lumera-protocol/sdk-js version already ships ` +
    `the real fix (great — this patch is now a no-op, safe to remove) or ` +
    `the package changed shape and this patch needs a look. Not failing ` +
    `the install, but Cascade uploads of files with an odd chunk count ` +
    `may be unverified either way until this is checked.`
  );
}

if (patchedAny) {
  console.log("[patch-sdk] Done.");
} else if (alreadyPatchedAny) {
  console.log("[patch-sdk] Already patched, nothing to do.");
}
