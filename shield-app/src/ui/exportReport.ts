import { VERDICT_INTACT, VERDICT_TAMPERED, type ExportVerification } from "../capture/record";

/**
 * The lines the Verify tab shows for a capture export. A valid signature only shows the record was not changed
 * after signing, so the image result is stated separately and an export with no image bytes says so.
 */
export function exportReport(result: ExportVerification): string[] {
  const mismatched = result.photos.filter((p) => p === "mismatch").length;
  const checked = result.photos.filter((p) => p === "match").length;
  const total = result.photos.length;
  const signatureBad = result.signatures.includes("invalid");
  const tampered = result.chain.verdict !== VERDICT_INTACT || mismatched > 0 || signatureBad;

  const reasons: string[] = [];
  if (mismatched > 0) reasons.push("photo-sha256-mismatch");
  if (signatureBad) reasons.push("record-signature-invalid");

  const lines = [tampered ? VERDICT_TAMPERED : result.chain.verdict, ...reasons, result.chain.summary];
  lines.push(...result.time.map((entry) => entry.verdict));
  lines.push(`signatures ${result.signatures.join(",") || "none"}`);
  lines.push(`images ${result.photos.join(",") || "none"}`);
  if (total === 0 || checked === 0 && mismatched === 0) {
    lines.push("NO IMAGE CHECKED: this export carries no image bytes, so the signature covers the record only.");
  } else if (checked < total) {
    lines.push(`IMAGES CHECKED ${checked} of ${total}: the rest carry no image bytes and were not checked.`);
  } else {
    lines.push(`IMAGES CHECKED ${checked} of ${total}: each image hashes to the signed photo hash.`);
  }
  return lines;
}
