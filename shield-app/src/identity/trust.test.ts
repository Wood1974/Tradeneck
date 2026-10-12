import { describe, expect, it } from "vitest";
import { bytesFromB64, sha256Bytes } from "../crypto/seal";
import { TRUSTED_RECEIPT_KEYS } from "./trust";

describe("pinned receipt keys", () => {
  it("pins at least one key", () => {
    expect(Object.keys(TRUSTED_RECEIPT_KEYS).length).toBeGreaterThan(0);
  });

  it("names each key by the first 16 hex chars of its SHA-256, as the service does", async () => {
    for (const [kid, key] of Object.entries(TRUSTED_RECEIPT_KEYS)) {
      const raw = bytesFromB64(key);
      expect(raw.byteLength).toBe(65); // uncompressed P-256 point
      expect((await sha256Bytes(raw)).slice(0, 16)).toBe(kid);
    }
  });
});
