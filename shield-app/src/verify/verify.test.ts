import { describe, expect, it } from "vitest";
import { b64FromBytes, devicePublicKeyRaw, stableStringify } from "../crypto/seal";
import { sealFromBytes } from "../capture/capture";
import type { SealRecord } from "../types";
import { parseBundle, verdictFor, verifyBundle } from "./verify";

function rec(captureKind: string, attestKind: SealRecord["attest"]["kind"] = "none"): SealRecord {
  return {
    id: "r", createdAt: "2026-10-05T00:00:00.000Z", captureKind: captureKind as SealRecord["captureKind"], platform: "android", jobId: null, checkpointId: null,
    sha256: "a".repeat(64), prevChain: "0".repeat(64), chainHead: "1".repeat(64), bytes: 1, mime: "image/jpeg", gps: null, pinScore: null,
    deviceSealId: "X", attest: { kind: attestKind, boundHash: null, tokenPresent: attestKind !== "none" }, signature: "s",
  };
}

describe("verdictFor", () => {
  it("does not call a native capture without attestation SEALED", () => {
    expect(verdictFor(rec("native-camera"), "a".repeat(64)).verdict).toBe("UNATTESTED-NATIVE");
    const attested = verdictFor(rec("native-camera", "app-attest"), "a".repeat(64));
    expect(attested.verdict).toBe("SEALED");
    expect(attested.reasons).toContain("attest-token-not-validated");
  });
  it("rejects any record that is not a native camera capture", () => {
    for (const kind of ["web-camera", "arrival-hash", "gallery", ""]) {
      const v = verdictFor(rec(kind, "app-attest"), "a".repeat(64));
      expect(v.verdict).toBe("NO-ORIGIN");
      expect(v.reasons).toContain("unsupported-capture-kind");
    }
  });
  it("flags a hash mismatch", () => {
    expect(verdictFor(rec("native-camera"), "b".repeat(64)).verdict).toBe("TAMPERED");
  });
});

describe("verifyBundle", () => {
  async function sealed() {
    const bytes = new TextEncoder().encode(`photo ${Math.random()}`).buffer;
    const item = await sealFromBytes(bytes, "image/jpeg", null);
    return { item, originalB64: b64FromBytes(bytes), key: await devicePublicKeyRaw() };
  }

  it("authenticates a record against the embedded key", async () => {
    const { item, originalB64, key } = await sealed();
    const r = await verifyBundle({ version: 1, record: item.record, originalB64: originalB64, devicePublicKey: key });
    expect(r.reasons).toContain("record-signature-valid");
    expect(r.verdict).toBe("UNATTESTED-NATIVE");
  });

  it("rejects edited metadata even though the photo bytes still match", async () => {
    const { item, originalB64, key } = await sealed();
    const edited = { ...item.record, createdAt: "2020-01-01T00:00:00.000Z" };
    const r = await verifyBundle({ version: 1, record: edited, originalB64: originalB64, devicePublicKey: key });
    expect(r.verdict).toBe("TAMPERED");
    expect(r.reasons).toContain("chain-head-mismatch");
    expect(r.reasons).toContain("record-signature-invalid");
  });

  it("rejects a record presented with a different key", async () => {
    const { item, originalB64 } = await sealed();
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = b64FromBytes(await crypto.subtle.exportKey("raw", other.publicKey));
    const r = await verifyBundle({ version: 1, record: item.record, originalB64: originalB64, devicePublicKey: raw });
    expect(r.verdict).toBe("TAMPERED");
    expect(r.reasons).toContain("seal-id-key-mismatch");
  });

  it("marks a keyless bundle unauthenticated and never SEALED", async () => {
    const { item, originalB64 } = await sealed();
    const r = await verifyBundle({ version: 1, record: { ...item.record, attest: { kind: "app-attest", boundHash: null, tokenPresent: true } }, originalB64 });
    expect(r.verdict).toBe("NO-ORIGIN");
    expect(r.reasons).toContain("record-unauthenticated");
  });

  it("detects changed photo bytes", async () => {
    const { item, originalB64, key } = await sealed();
    const r = await verifyBundle({ version: 1, record: item.record, originalB64: b64FromBytes(new TextEncoder().encode("other").buffer), devicePublicKey: key });
    expect(r.verdict).toBe("TAMPERED");
  });
});

describe("parseBundle", () => {
  it("rejects malformed and oversize input", () => {
    expect(() => parseBundle("{}")).toThrow("bad-bundle");
    expect(() => parseBundle('{"version":1,"record":{},"originalB64":"x"}')).toThrow("bad-bundle");
    expect(() => parseBundle("x".repeat(11 * 1024 * 1024))).toThrow("file-too-large");
  });
});

describe("stableStringify", () => {
  it("sorts keys and is stable", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
  it("throws on values that do not survive a JSON round trip", () => {
    expect(() => stableStringify({ a: undefined })).toThrow();
    expect(() => stableStringify({ a: NaN })).toThrow();
    expect(() => stableStringify({ a: Infinity })).toThrow();
    expect(() => stableStringify({ a: new Date() })).toThrow();
    expect(() => stableStringify({ a: 1n })).toThrow();
    expect(() => stableStringify({ a: () => 1 })).toThrow();
    expect(() => stableStringify(undefined)).toThrow();
  });
  it("normalizes -0", () => {
    expect(stableStringify({ a: -0 })).toBe('{"a":0}');
  });
});
