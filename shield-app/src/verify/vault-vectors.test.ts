import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyCloseoutPacket } from "../construction/closeout";
import { verifyBundle } from "./verify";

// Made by the app's own sealing code and frozen in test-vectors/vault-v1.json. The same file is checked by the independent
// Python checker in tradedeck-shield (verifier/shield_vault_verify.py), so if either side's canonical form drifts, a test fails.
const vectors = JSON.parse(readFileSync(new URL("../../test-vectors/vault-v1.json", import.meta.url), "utf8"));

describe("the frozen vault vectors", () => {
  it("a photo bundle verifies with the app's own verifier", async () => {
    const v = await verifyBundle(vectors.bundle);
    expect(v.verdict).toBe("SEALED");
    expect(v.reasons).toContain("record-signature-valid");
  });
  it("a close-out packet verifies with the app's own verifier", async () => {
    const v = await verifyCloseoutPacket(vectors.packet);
    expect(v.verdict).toBe("PACKET-SEALED");
    expect(v.reasons).toContain("signature-valid");
  });
  it("the vectors contain what the checker needs to be tested against", () => {
    expect(vectors.packet.counts).toEqual({ points: 5, sealed: 2, missing: 3 });
    expect(vectors.packet.points[0].record.gps).toEqual({ lat: 40.760779, lng: -111.891047, acc: 4.5, source: "os" }); // a float, formatted the same by both sides
    expect(vectors.bundle.record.attestationId).toBeTruthy(); // the optional signed fields are in the canonical form too
    expect(vectors.packet.brief.lockedText).toContain("🚧"); // non-ASCII text goes through the canonical form unchanged
  });
});
