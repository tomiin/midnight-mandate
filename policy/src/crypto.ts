/**
 * Client-side encryption for the Mandate policy backup.
 *
 * Cascade's own "private" download path is documented (in the installed
 * SDK's own source comments, `cascade/downloader.d.ts`) as using "a
 * simulated signature for download_auth" that "should be replaced with a
 * real wallet signature... for private downloads" — i.e. not fully
 * implemented in this SDK version. Rather than depend on that, we encrypt
 * the policy document ourselves before it ever reaches Cascade and upload
 * it with `isPublic: true`. Privacy comes from our own AES-256-GCM
 * encryption, not from Cascade's storage-layer access control — this
 * sidesteps the limitation entirely. See BUILD-LOG.md.
 *
 * Key derivation: sign a fixed domain-separated string with the
 * principal's own wallet via ADR-036 `signArbitrary`. CosmJS's secp256k1
 * signing is deterministic (RFC 6979) — the same wallet signing the same
 * fixed message always produces the same signature bytes — so hashing
 * that signature gives a stable, recreatable 32-byte AES-256 key without
 * ever storing a separate secret anywhere. Anyone who can derive Mandate's
 * on-chain `principal` value can also recompute this key with their own
 * mnemonic; nobody else can.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { UniversalSigner } from "./lumera-types.js";

/** Domain-separated tag for the policy-encryption key, mirrors the
 * `"mandate:...:v1"` tagging convention used throughout the Compact
 * contract's persistentHash calls. */
export const POLICY_KEY_DOMAIN = "mandate:policy-key:v1";

export interface EncryptedPayload {
  /** Base64-encoded 12-byte GCM IV. */
  iv: string;
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded 16-byte GCM auth tag. */
  authTag: string;
}

/**
 * Derive a stable AES-256 key by signing a fixed domain string with the
 * wallet's ADR-036 signArbitrary, then SHA-256-hashing the signature bytes.
 */
export async function derivePolicyKey(
  signer: UniversalSigner,
  chainId: string,
  address: string
): Promise<Buffer> {
  const { signature } = await signer.signArbitrary(chainId, address, POLICY_KEY_DOMAIN);
  const sigBytes = Buffer.from(signature, "base64");
  return createHash("sha256").update(sigBytes).digest();
}

/** Encrypt a JSON-serializable value with AES-256-GCM under the given key. */
export function encryptJson(key: Buffer, value: unknown): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** Decrypt a payload produced by encryptJson, returning the parsed value. */
export function decryptJson<T = unknown>(key: Buffer, payload: EncryptedPayload): T {
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
