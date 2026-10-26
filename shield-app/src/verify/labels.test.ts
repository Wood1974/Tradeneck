import { describe, expect, it } from "vitest";
import type { Verdict } from "../types";
import { verdictLine, verdictNote } from "./labels";
import type { VerifyResult } from "./verify";

const result = (verdict: Verdict, reasons: string[] = []): VerifyResult => ({ verdict, reasons, computedSha: "a".repeat(64), record: null });

describe("what the screen says first about a photo", () => {
  it("a native photo with no platform claim in its record is described by what was checked, not as suspect", () => {
    const line = verdictLine(result("UNATTESTED-NATIVE", ["native-camera-no-attest", "record-signature-valid"]));
    expect(line).toBe("NATIVE CAMERA · photo matches its signed hash · signature valid");
    expect(line).not.toMatch(/UNATTESTED/);
  });

  it("does not claim a valid signature unless one was checked", () => {
    expect(verdictLine(result("UNATTESTED-NATIVE", ["native-camera-no-attest"]))).toBe("NATIVE CAMERA · photo matches its signed hash");
  });

  it("says where the Apple check is made, and never calls the photo attested", () => {
    const note = verdictNote(result("UNATTESTED-NATIVE"));
    expect(note).toContain("Apple's device check is made by the Shield server after the photo uploads");
    expect(note).not.toMatch(/\battested\b|\bverified\b/i);
  });

  it("leaves every other verdict exactly as it was, with no reassuring note", () => {
    for (const v of ["SEALED", "TAMPERED", "NO-ORIGIN"] as const) {
      expect(verdictLine(result(v))).toBe(v);
      expect(verdictNote(result(v))).toBe("");
    }
  });

  it("a photo that fails never gets the reassuring words", () => {
    const tampered = result("TAMPERED", ["sha256-mismatch"]);
    expect(`${verdictLine(tampered)} ${verdictNote(tampered)}`).not.toMatch(/matches|valid|NATIVE CAMERA/);
  });
});
