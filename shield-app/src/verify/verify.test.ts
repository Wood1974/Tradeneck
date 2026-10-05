import { describe, expect, it } from "vitest";
import type { SealRecord } from "../types";
import { verdictFor } from "./verify";

function rec(captureKind: SealRecord["captureKind"]): SealRecord {
  return {
    id: "r", createdAt: "2026-10-05T00:00:00.000Z", captureKind, platform: "web", jobId: null, checkpointId: null,
    sha256: "a".repeat(64), prevChain: "0".repeat(64), chainHead: "1".repeat(64), bytes: 1, mime: "image/jpeg", gps: null, pinScore: null,
    deviceSealId: "X", attest: { kind: "none", boundHash: null, tokenPresent: false }, signature: "s",
  };
}

describe("verdictFor", () => {
  it("never upgrades a browser capture to SEALED", () => {
    const v = verdictFor(rec("web-camera"), "a".repeat(64));
    expect(v.verdict).toBe("ARRIVAL-ONLY");
    expect(v.reasons).toContain("web-camera-not-proven");
  });
  it("keeps arrival hash as ARRIVAL-ONLY and native as SEALED", () => {
    expect(verdictFor(rec("arrival-hash"), "a".repeat(64)).verdict).toBe("ARRIVAL-ONLY");
    expect(verdictFor(rec("native-camera"), "a".repeat(64)).verdict).toBe("SEALED");
  });
  it("flags a hash mismatch regardless of kind", () => {
    expect(verdictFor(rec("web-camera"), "b".repeat(64)).verdict).toBe("TAMPERED");
  });
});
