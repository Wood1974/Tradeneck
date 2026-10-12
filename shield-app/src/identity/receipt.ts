import { sha256Bytes, bytesFromB64, verifySignature } from "../crypto/seal";
import { TRUSTED_RECEIPT_KEYS } from "./trust";

export const RECEIPT_KIND = "tradedeck.shield.idreceipt";

/** The service's signed statement that an ID check passed for exactly this note. */
export interface Receipt {
  payload: {
    kind: string;
    v: number;
    attestationId: string;
    noteSha256: string;
    deviceSealId: string;
    sessionSha256: string;
    idCheck: { provider: string; status: string };
    issuedAt: string;
    kid: string;
    /** Signed. Present (true) only when the check ran in Stripe test mode: no real ID was checked. */
    testMode?: boolean;
  };
  signature: string;
}

export interface ReceiptExpectation {
  attestationId: string;
  noteSha256: string;
  deviceSealId: string;
}

export interface ReceiptCheck {
  /** Reasons the receipt is wrong. Empty means well-formed, bound to this note and (if a key is pinned) correctly signed. */
  failed: string[];
  /** Key id of the pinned service key that verified it, or null when no pinned key could check it. */
  confirmedBy: string | null;
  /** True when the service says this check ran in test mode. Never counts as a confirmed ID check. */
  testMode: boolean;
}

export async function checkReceipt(receipt: Receipt, expect: ReceiptExpectation, keys: Record<string, string> = TRUSTED_RECEIPT_KEYS): Promise<ReceiptCheck> {
  const failed: string[] = [];
  let confirmedBy: string | null = null;
  let testMode = false;
  try {
    const p = receipt.payload;
    testMode = p.testMode === true;
    if (p.kind !== RECEIPT_KIND || p.v !== 1) failed.push("receipt-bad-kind");
    if (p.attestationId !== expect.attestationId || p.noteSha256 !== expect.noteSha256 || p.deviceSealId !== expect.deviceSealId) failed.push("receipt-mismatch");
    if (p.idCheck?.provider !== "stripe-identity" || p.idCheck?.status !== "verified") failed.push("receipt-not-verified");
    if (Number.isNaN(Date.parse(p.issuedAt))) failed.push("receipt-bad-time");
    const pinned = keys[p.kid];
    if (pinned) {
      // The key id must really be this key's digest, so a receipt cannot borrow another key's name.
      const digest = (await sha256Bytes(bytesFromB64(pinned))).slice(0, 16);
      if (digest !== p.kid || !(await verifySignature(pinned, p, receipt.signature))) failed.push("receipt-signature-invalid");
      else confirmedBy = p.kid;
    }
  } catch {
    failed.push("receipt-unverifiable");
  }
  return { failed, confirmedBy, testMode };
}
