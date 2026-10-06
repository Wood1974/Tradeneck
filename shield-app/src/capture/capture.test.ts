import { describe, expect, it } from "vitest";
import { chainStep, sha256Text, stableStringify, verifySignature, devicePublicKeyRaw } from "../crypto/seal";
import { chainHead } from "../store/db";
import { captureNative, sealFromBytes } from "./capture";

describe("sealFromBytes", () => {
  it("derives chainHead from the stableStringify hash of the unsigned record and signs it", async () => {
    const bytes = new TextEncoder().encode("not really a jpeg").buffer;
    const item = await sealFromBytes(bytes, "image/jpeg", null);
    const { chainHead, signature, ...unsigned } = item.record;
    const recordHash = await sha256Text(stableStringify(unsigned));
    expect(chainHead).toBe(await chainStep(unsigned.prevChain, recordHash));
    expect(await verifySignature(await devicePublicKeyRaw(), { ...unsigned, chainHead }, signature)).toBe(true);
  });

  it("chains the second seal onto the first", async () => {
    const a = await sealFromBytes(new TextEncoder().encode("one").buffer, "image/jpeg", null);
    const b = await sealFromBytes(new TextEncoder().encode("two").buffer, "image/jpeg", null);
    expect(b.record.prevChain).toBe(a.record.chainHead);
  });

  it("serializes concurrent seals into one linear chain and persists the last head", async () => {
    const items = await Promise.all(
      ["c1", "c2", "c3"].map((s) => sealFromBytes(new TextEncoder().encode(s).buffer, "image/jpeg", null)),
    );
    expect(items[1]!.record.prevChain).toBe(items[0]!.record.chainHead);
    expect(items[2]!.record.prevChain).toBe(items[1]!.record.chainHead);
    expect(await chainHead()).toBe(items[2]!.record.chainHead);
  });

  it("seals nothing when the native camera is unavailable", async () => {
    const before = await chainHead();
    expect(await captureNative(null)).toEqual({ error: "not-native" });
    expect(await chainHead()).toBe(before);
  });

  it("only ever produces native-camera records", async () => {
    const item = await sealFromBytes(new TextEncoder().encode("kind").buffer, "image/jpeg", null);
    expect(item.record.captureKind).toBe("native-camera");
  });
});
