import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  POLICY_KEY_DOMAIN,
  derivePolicyKey,
  encryptJson,
  decryptJson,
  type EncryptedPayload,
} from "./crypto.js";
import type { UniversalSigner } from "./lumera-types.js";

// A stand-in for a real wallet. The production path signs via CosmJS's
// secp256k1, which is deterministic (RFC 6979) — the property the key
// derivation depends on. Here we assert the derivation's own behaviour
// given a signature, without needing a real wallet or network.
function fakeSigner(signatureB64: string): UniversalSigner {
  return {
    getAccounts: async () => [],
    signDirect: async () => {
      throw new Error("not used");
    },
    signAmino: async () => {
      throw new Error("not used");
    },
    signArbitrary: vi.fn(async () => ({
      signed: POLICY_KEY_DOMAIN,
      signature: signatureB64,
      pub_key: { type: "tendermint/PubKeySecp256k1", value: "irrelevant" },
    })),
  } as unknown as UniversalSigner;
}

const SIG_A = Buffer.from("signature-alpha-64-bytes-worth-of-material").toString("base64");
const SIG_B = Buffer.from("signature-bravo-64-bytes-worth-of-material").toString("base64");

const SAMPLE_POLICY = {
  version: 1,
  agents: [
    { id: "travel-booking-agent", category: 1, cap: 500 },
    { id: "grocery-reorder-agent", category: 2, cap: 150 },
  ],
  note: "unicode ok: café — 日本語 — 🔐",
};

describe("derivePolicyKey", () => {
  it("returns a 32-byte key (AES-256)", async () => {
    const key = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("is deterministic — the same signature always yields the same key", async () => {
    const a = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    const b = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    expect(a.toString("hex")).toBe(b.toString("hex"));
  });

  it("derives a different key from a different signature", async () => {
    const a = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    const b = await derivePolicyKey(fakeSigner(SIG_B), "lumera-testnet-2", "lumera1abc");
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });

  it("is exactly SHA-256 over the raw signature bytes", async () => {
    const key = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    const expected = createHash("sha256").update(Buffer.from(SIG_A, "base64")).digest();
    expect(key.toString("hex")).toBe(expected.toString("hex"));
  });

  it("signs the domain-separated string, not arbitrary data", async () => {
    const signer = fakeSigner(SIG_A);
    await derivePolicyKey(signer, "lumera-testnet-2", "lumera1abc");
    expect(signer.signArbitrary).toHaveBeenCalledWith(
      "lumera-testnet-2",
      "lumera1abc",
      POLICY_KEY_DOMAIN,
    );
  });

  // Guards against a silent breaking change: altering this constant would
  // make every previously uploaded policy backup underivable, with no error.
  it("uses the pinned domain tag", () => {
    expect(POLICY_KEY_DOMAIN).toBe("mandate:policy-key:v1");
  });
});

describe("encryptJson / decryptJson", () => {
  const key = createHash("sha256").update("test-key-material").digest();

  it("round-trips a policy document exactly", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    expect(decryptJson(key, payload)).toEqual(SAMPLE_POLICY);
  });

  it("does not leak plaintext into the payload", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain("travel-booking-agent");
    expect(blob).not.toContain("grocery-reorder-agent");
  });

  it("produces a fresh IV per encryption — never reuses one", () => {
    // GCM security collapses entirely if an IV is reused under the same key.
    const ivs = new Set(
      Array.from({ length: 50 }, () => encryptJson(key, SAMPLE_POLICY).iv),
    );
    expect(ivs.size).toBe(50);
  });

  it("emits a 12-byte IV and 16-byte auth tag", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    expect(Buffer.from(payload.iv, "base64").length).toBe(12);
    expect(Buffer.from(payload.authTag, "base64").length).toBe(16);
  });

  it("rejects the wrong key", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    const wrongKey = createHash("sha256").update("not-the-right-key").digest();
    expect(() => decryptJson(wrongKey, payload)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    const bytes = Buffer.from(payload.ciphertext, "base64");
    bytes[0] ^= 0xff;
    const tampered: EncryptedPayload = {
      ...payload,
      ciphertext: bytes.toString("base64"),
    };
    expect(() => decryptJson(key, tampered)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const payload = encryptJson(key, SAMPLE_POLICY);
    const tag = Buffer.from(payload.authTag, "base64");
    tag[0] ^= 0xff;
    const tampered: EncryptedPayload = { ...payload, authTag: tag.toString("base64") };
    expect(() => decryptJson(key, tampered)).toThrow();
  });

  it("rejects a swapped IV", () => {
    const a = encryptJson(key, SAMPLE_POLICY);
    const b = encryptJson(key, SAMPLE_POLICY);
    expect(() => decryptJson(key, { ...a, iv: b.iv })).toThrow();
  });

  it("survives a full derive -> encrypt -> decrypt cycle", async () => {
    const derived = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    const payload = encryptJson(derived, SAMPLE_POLICY);
    // A second wallet session re-deriving the same key can read it back.
    const rederived = await derivePolicyKey(fakeSigner(SIG_A), "lumera-testnet-2", "lumera1abc");
    expect(decryptJson(rederived, payload)).toEqual(SAMPLE_POLICY);
  });
});
