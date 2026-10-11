import type { SealRecord } from "../types";
import { chainStep, sealIdForPublicKey, sha256Text, stableStringify, verifySignature } from "./seal";

/**
 * Authenticates one seal record against a public key: seal ID binds to the key, chainHead recomputes
 * from prevChain + record hash, and the signature covers the whole record. Returns the failed checks.
 */
export async function checkRecordAuth(record: SealRecord, publicKeyRawB64: string): Promise<string[]> {
  const failed: string[] = [];
  try {
    if (record.deviceSealId !== (await sealIdForPublicKey(publicKeyRawB64))) failed.push("seal-id-key-mismatch");
    const { chainHead, signature, ...unsigned } = record;
    const recordHash = await sha256Text(stableStringify(unsigned));
    if (chainHead !== (await chainStep(record.prevChain, recordHash))) failed.push("chain-head-mismatch");
    if (!(await verifySignature(publicKeyRawB64, { ...unsigned, chainHead }, signature))) failed.push("record-signature-invalid");
  } catch {
    failed.push("record-unverifiable");
  }
  return failed;
}
