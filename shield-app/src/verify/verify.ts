import { checkRecordAuth } from "../crypto/record";
import { bytesFromB64, devicePublicKeyRaw, sha256Bytes } from "../crypto/seal";
import type { SealRecord, ShieldBundle, Verdict } from "../types";

export interface VerifyResult {
  verdict: Verdict;
  reasons: string[];
  computedSha: string | null;
  record: SealRecord | null;
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export function verdictFor(record: SealRecord, computedSha: string | null): VerifyResult {
  if (!computedSha) {
    return { verdict: "NO-ORIGIN", reasons: ["no-bytes"], computedSha: null, record };
  }
  if (computedSha !== record.sha256) {
    return { verdict: "TAMPERED", reasons: ["sha256-mismatch"], computedSha, record };
  }
  // Only native camera captures are valid. Anything else claims an origin Shield never produces.
  if ((record.captureKind as string) !== "native-camera") {
    return { verdict: "NO-ORIGIN", reasons: ["unsupported-capture-kind"], computedSha, record };
  }
  if (record.attest.kind === "none") {
    return { verdict: "UNATTESTED-NATIVE", reasons: ["native-camera-no-attest"], computedSha, record };
  }
  // The attestation token is not stored in the record, so it cannot be independently validated here.
  return { verdict: "SEALED", reasons: ["hash-match", record.attest.kind, "attest-token-not-validated"], computedSha, record };
}

export async function verifyBundle(bundle: ShieldBundle): Promise<VerifyResult> {
  let computedSha: string;
  try {
    computedSha = await sha256Bytes(bytesFromB64(bundle.originalB64));
  } catch {
    return { verdict: "NO-ORIGIN", reasons: ["bundle-unreadable"], computedSha: null, record: bundle.record };
  }
  const base = verdictFor(bundle.record, computedSha);
  if (base.verdict === "TAMPERED") return base;

  // A hash match alone says nothing about the metadata (time, place, capture kind), so the record
  // must also authenticate against the signing device's key.
  if (!bundle.devicePublicKey) {
    return { ...base, verdict: "NO-ORIGIN", reasons: [...base.reasons, "record-unauthenticated"] };
  }
  const failed = await checkRecordAuth(bundle.record, bundle.devicePublicKey);
  if (failed.length) return { ...base, verdict: "TAMPERED", reasons: failed };
  return { ...base, reasons: [...base.reasons, "record-signature-valid"] };
}

/** Re-hash a vault item stored on this device, authenticated against this device's own key. */
export async function verifyItemOriginal(record: SealRecord, originalB64: string): Promise<VerifyResult> {
  return verifyBundle({ version: 1, record, originalB64, devicePublicKey: await devicePublicKeyRaw() });
}

export function parseBundle(text: string): ShieldBundle {
  if (text.length > MAX_IMPORT_BYTES) throw new Error("file-too-large");
  const raw = JSON.parse(text) as ShieldBundle;
  const rec = raw?.record as Partial<SealRecord> | undefined;
  if (
    raw?.version !== 1 ||
    typeof raw.originalB64 !== "string" ||
    !raw.originalB64 ||
    !rec ||
    typeof rec.sha256 !== "string" ||
    typeof rec.signature !== "string" ||
    typeof rec.captureKind !== "string" ||
    typeof rec.attest?.kind !== "string"
  ) {
    throw new Error("bad-bundle");
  }
  if (raw.devicePublicKey !== undefined && typeof raw.devicePublicKey !== "string") throw new Error("bad-bundle");
  return raw;
}
