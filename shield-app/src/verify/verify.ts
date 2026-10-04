import { bytesFromB64, sha256Bytes } from "../crypto/seal";
import type { SealRecord, ShieldBundle, Verdict } from "../types";

export interface VerifyResult {
  verdict: Verdict;
  reasons: string[];
  computedSha: string | null;
  record: SealRecord | null;
}

export function verdictFor(record: SealRecord, computedSha: string | null): VerifyResult {
  const reasons: string[] = [];
  if (!computedSha) {
    return { verdict: "NO-ORIGIN", reasons: ["no-bytes"], computedSha: null, record };
  }
  if (computedSha !== record.sha256) {
    return { verdict: "TAMPERED", reasons: ["sha256-mismatch"], computedSha, record };
  }
  if (record.captureKind === "arrival-hash") {
    reasons.push("arrival-hash-only");
    if (record.attest.kind === "none") reasons.push("no-attest");
    return { verdict: "ARRIVAL-ONLY", reasons, computedSha, record };
  }
  if (record.attest.kind === "none" || !record.attest.tokenPresent) {
    reasons.push("native-camera-no-attest");
    return { verdict: "SEALED", reasons, computedSha, record };
  }
  return { verdict: "SEALED", reasons: ["hash-match", record.attest.kind], computedSha, record };
}

export async function verifyBundle(bundle: ShieldBundle): Promise<VerifyResult> {
  try {
    const bytes = bytesFromB64(bundle.originalB64);
    const computedSha = await sha256Bytes(bytes);
    return verdictFor(bundle.record, computedSha);
  } catch {
    return { verdict: "NO-ORIGIN", reasons: ["bundle-unreadable"], computedSha: null, record: bundle.record };
  }
}

export async function verifyItemOriginal(record: SealRecord, originalB64: string): Promise<VerifyResult> {
  return verifyBundle({ version: 1, record, originalB64 });
}

export function parseBundle(text: string): ShieldBundle {
  const raw = JSON.parse(text) as ShieldBundle;
  if (raw.version !== 1 || !raw.record || !raw.originalB64) throw new Error("bad-bundle");
  return raw;
}
