import { describe, expect, it } from "vitest";
import { chainStep, sha256Text, stableStringify, verifySignature, devicePublicKeyRaw } from "../crypto/seal";
import { chainHead } from "../store/db";
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

  it("serializes concurrent seals into one linear chain and persists the last head", async () => {
    const items = await Promise.all(
      ["c1", "c2", "c3"].map((s) => sealFromBytes(new TextEncoder().encode(s).buffer, "image/jpeg", "arrival-hash", null)),
    );
    expect(items[1]!.record.prevChain).toBe(items[0]!.record.chainHead);
    expect(items[2]!.record.prevChain).toBe(items[1]!.record.chainHead);
    expect(await chainHead()).toBe(items[2]!.record.chainHead);
  });

  it("records which lens a live capture used, defaulting to unknown", async () => {
    const bytes = new TextEncoder().encode("lens").buffer;
    const back = await sealFromBytes(bytes, "image/jpeg", "web-camera", null, "back");
    const front = await sealFromBytes(bytes, "image/jpeg", "web-camera", null, "front");
    const other = await sealFromBytes(bytes, "image/jpeg", "web-camera", null);
    expect([back.record.facing, front.record.facing, other.record.facing]).toEqual(["back", "front", "unknown"]);
    const { chainHead, signature, ...unsigned } = back.record;
    expect(await verifySignature(await devicePublicKeyRaw(), { ...unsigned, chainHead }, signature)).toBe(true);
  });

  it("attaches no location to arrival-hash records", async () => {
    const item = await sealFromBytes(new TextEncoder().encode("loc").buffer, "image/jpeg", "arrival-hash", null);
    expect(item.record.gps).toBeNull();
  });
});
