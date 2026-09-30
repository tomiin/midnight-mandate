/**
 * Client-side encryption for the Mandate policy backup — browser version.
 *
 * Mirrors policy/src/crypto.ts exactly in scheme (AES-256-GCM, key derived
 * by SHA-256-hashing an ADR-036 signArbitrary signature over a fixed
 * domain string), but uses the browser's built-in Web Crypto API
 * (crypto.subtle) instead of Node's node:crypto. This is a real
 * difference, not a stylistic one: Node's createCipheriv/getAuthTag/
 * setAuthTag for AES-256-GCM do not work through this project's browser
 * polyfill for node:crypto — crypto-browserify's browserify-aes has no
 * getAuthTag/setAuthTag implementation at all (verified by reading the
 * installed package, zero matches). Web Crypto needs no polyfill; every
 * browser ships it natively.
 *
 * One shape difference from Web Crypto's own default behavior: browser
 * AES-GCM returns ciphertext and the 16-byte auth tag concatenated as one
 * buffer. This file splits them back into separate base64 fields so the
 * EncryptedPayload produced here is byte-for-byte compatible with the one
 * policy/src/crypto.ts produces — whichever side encrypted something, the
 * other side can decrypt it.
 */

import type { UniversalSigner } from "./lumera-types";

/** Domain-separated tag for the policy-encryption key — must match
 *  policy/src/crypto.ts's POLICY_KEY_DOMAIN exactly, or the two sides
 *  derive different keys from the same wallet. */
export const POLICY_KEY_DOMAIN = "mandate:policy-key:v1";

const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedPayload {
  /** Base64-encoded 12-byte GCM IV. */
  iv: string;
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded 16-byte GCM auth tag. */
  authTag: string;
}

/**
 * Web Crypto's BufferSource typing (in current DOM lib types) only
 * accepts a plain ArrayBuffer, not the wider ArrayBufferLike that
 * TypedArray methods like .slice() return. This copies out a real
 * ArrayBuffer so every crypto.subtle.* call below has an unambiguous
 * argument type — not a workaround for a runtime problem, purely to
 * satisfy the stricter modern type declarations.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Derive a stable AES-256 key by signing a fixed domain string with the
 * wallet's ADR-036 signArbitrary, then SHA-256-hashing the signature
 * bytes. Same derivation as policy/src/crypto.ts — anyone who can sign as
 * Mandate's on-chain `principal` can recompute this key with their own
 * wallet; nobody else can.
 */
export async function derivePolicyKey(
  signer: UniversalSigner,
  chainId: string,
  address: string,
): Promise<Uint8Array> {
  const { signature } = await signer.signArbitrary(chainId, address, POLICY_KEY_DOMAIN);
  const sigBytes = base64ToBytes(signature);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(sigBytes));
  return new Uint8Array(digest);
}

/** Encrypt a JSON-serializable value with AES-256-GCM under the given key. */
export async function encryptJson(key: Uint8Array, value: unknown): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      cryptoKey,
      toArrayBuffer(plaintext),
    ),
  );
  const ciphertext = combined.slice(0, combined.length - AUTH_TAG_BYTES);
  const authTag = combined.slice(combined.length - AUTH_TAG_BYTES);
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    authTag: bytesToBase64(authTag),
  };
}

/**
 * Decrypt a payload produced by encryptJson — from either this file or
 * policy/src/crypto.ts — returning the parsed value. Throws if the key is
 * wrong or the payload was altered in transit; AES-GCM's built-in tag
 * check is what catches that, the same guarantee Node's getAuthTag/
 * setAuthTag gave on the CLI side.
 */
export async function decryptJson<T = unknown>(
  key: Uint8Array,
  payload: EncryptedPayload,
): Promise<T> {
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const authTag = base64ToBytes(payload.authTag);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(concatBytes(ciphertext, authTag)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
