// Test-only: stands in for the service that signs ID-check receipts. Never imported by app code.
import { b64FromBytes, sha256Bytes, stableStringify } from "../crypto/seal";
import type { Receipt } from "./receipt";

export interface TestServiceKey {
  kid: string;
  publicKey: string;
  keys: Record<string, string>;
  receipt(parts: { attestationId: string; noteSha256: string; deviceSealId: string }, over?: Partial<Receipt["payload"]>): Promise<Receipt>;
}

export async function makeServiceKey(): Promise<TestServiceKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const publicKey = b64FromBytes(raw);
  const kid = (await sha256Bytes(raw)).slice(0, 16);
  return {
    kid,
    publicKey,
    keys: { [kid]: publicKey },
    async receipt(parts, over = {}) {
      const payload: Receipt["payload"] = {
        kind: "tradedeck.shield.idreceipt", v: 1, ...parts, sessionSha256: "9".repeat(64),
        idCheck: { provider: "stripe-identity", status: "verified" }, issuedAt: new Date(Date.now() - 90_000).toISOString(), kid, ...over,
      };
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(stableStringify(payload)));
      return { payload, signature: b64FromBytes(sig) };
    },
  };
}
