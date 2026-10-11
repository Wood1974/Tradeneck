import { devicePublicKeyRaw } from "../crypto/seal";
import { getAttestationRaw, putAttestation } from "../store/db";
import { checkNote, noteSha256, type Attestation } from "./note";
import { checkReceipt } from "./receipt";

/**
 * The attestation counts only if it is intact, signed by THIS device's key, and still matches its own hash.
 * A replaced or lost device key therefore needs a fresh ID check instead of silently reusing an old note.
 */
export async function currentAttestation(): Promise<Attestation | null> {
  const raw = (await getAttestationRaw()) as Attestation | undefined;
  if (!raw?.note?.payload || typeof raw.attestationId !== "string") return null;
  try {
    if (raw.note.devicePublicKey !== (await devicePublicKeyRaw())) return null;
    if ((await checkNote(raw.note)).length) return null;
    if ((await noteSha256(raw.note.payload)) !== raw.noteSha256) return null;
    if (!raw.receipt) return null;
    const rc = await checkReceipt(raw.receipt, { attestationId: raw.attestationId, noteSha256: raw.noteSha256, deviceSealId: raw.note.payload.deviceSealId });
    if (rc.failed.length) return null;
  } catch {
    return null;
  }
  return raw;
}

export const saveAttestation = (att: Attestation): Promise<void> => putAttestation(att);
