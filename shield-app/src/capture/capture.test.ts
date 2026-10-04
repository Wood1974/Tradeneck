import { describe, expect, it } from "vitest";
import { chainStep, sha256Text, stableStringify, verifySignature, devicePublicKeyRaw } from "../crypto/seal";
import { sealFromBytes } from "./capture";

describe("sealFromBytes", () => {
  it("derives chainHead from the stableStringify hash of the unsigned record and signs it", async () => {
    const bytes = new TextEncoder().encode("not really a jpeg").buffer;
    const item = await sealFromBytes(bytes, "image/jpeg", "arrival-hash", null);
    const { chainHead, signature, ...unsigned } = item.record;
    const recordHash = await sha256Text(stableStringify(unsigned));
    expect(chainHead).toBe(await chainStep(unsigned.prevChain, recordHash));
    expect(await verifySignature(await devicePublicKeyRaw(), { ...unsigned, chainHead }, signature)).toBe(true);
  });

  it("chains the second seal onto the first", async () => {
    const a = await sealFromBytes(new TextEncoder().encode("one").buffer, "image/jpeg", "arrival-hash", null);
    const b = await sealFromBytes(new TextEncoder().encode("two").buffer, "image/jpeg", "arrival-hash", null);
    expect(b.record.prevChain).toBe(a.record.chainHead);
  });
});
