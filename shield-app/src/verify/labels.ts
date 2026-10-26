import type { VerifyResult } from "./verify";

/**
 * What the Verify tab and REHASH say first about a photo. The stored verdict name (`UNATTESTED-NATIVE`) is unchanged, so
 * exports and checks that read it still agree; only the words on screen differ. A record with no platform claim of its own
 * is not a suspect one: the Apple device check is the server's, made after the photo uploads, and shown on the photo.
 */
export function verdictLine(result: VerifyResult): string {
  if (result.verdict !== "UNATTESTED-NATIVE") return result.verdict;
  const signature = result.reasons.includes("record-signature-valid") ? " · signature valid" : "";
  return `NATIVE CAMERA · photo matches its signed hash${signature}`;
}

/** The plain sentence that goes under the first line, or an empty string when the verdict needs none. */
export function verdictNote(result: VerifyResult): string {
  if (result.verdict !== "UNATTESTED-NATIVE") return "";
  return "The record has no platform claim of its own. Apple's device check is made by the Shield server after the photo uploads, and shown on the photo.";
}
