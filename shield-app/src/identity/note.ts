import type { Receipt } from "./receipt";
import { devicePublicKeyRaw, deviceSealId, sealIdForPublicKey, sha256Text, signPayload, stableStringify, verifySignature } from "../crypto/seal";

export const NOTE_VERSION = "1";
export const CONSENT_VERSION = "1";
export const NOTE_KIND = "tradedeck.shield.note";
// Must match STATEMENT in tradedeck-shield server/app/identity_core.py. Both test suites pin its SHA-256.
export const NOTE_STATEMENT =
  "I am the person who took the photographs in this record. I took each one myself, live, " +
  "with this device's camera, and I have not edited, replaced or staged any of them. I " +
  "understand this statement is signed with this device's key and tied to the ID check I completed.";

export interface NotePayload {
  kind: typeof NOTE_KIND;
  v: 1;
  statement: string;
  statementVersion: string;
  sessionId: string;
  deviceSealId: string;
  signedAt: string;
}

export interface SignedNote {
  payload: NotePayload;
  devicePublicKey: string;
  signature: string;
}

/** What the phone keeps after the service accepted the note. No ID or selfie images, no name. */
export interface Attestation {
  attestationId: string;
  noteSha256: string;
  note: SignedNote;
  /** Service-signed receipt that the ID check passed for this note. Verifiable offline against a pinned service key. */
  receipt: Receipt;
  idCheck: { provider: "stripe-identity" };
}

export function noteSha256(payload: NotePayload): Promise<string> {
  return sha256Text(stableStringify(payload));
}

/** Signs the statement with this device's key, tied to one ID-check session. */
export async function signNote(sessionId: string, now: Date = new Date()): Promise<SignedNote> {
  const payload: NotePayload = {
    kind: NOTE_KIND,
    v: 1,
    statement: NOTE_STATEMENT,
    statementVersion: NOTE_VERSION,
    sessionId,
    deviceSealId: await deviceSealId(),
    signedAt: now.toISOString(),
  };
  return { payload, devicePublicKey: await devicePublicKeyRaw(), signature: await signPayload(payload) };
}

/** Returns the failed checks (empty when the note is internally valid). It cannot show the ID check passed. */
export async function checkNote(note: SignedNote): Promise<string[]> {
  const failed: string[] = [];
  try {
    const p = note.payload;
    if (p.kind !== NOTE_KIND || p.v !== 1) failed.push("note-bad-kind");
    if (p.statementVersion !== NOTE_VERSION || p.statement !== NOTE_STATEMENT) failed.push("note-statement-mismatch");
    if (p.deviceSealId !== (await sealIdForPublicKey(note.devicePublicKey))) failed.push("note-seal-id-key-mismatch");
    if (!(await verifySignature(note.devicePublicKey, p, note.signature))) failed.push("note-signature-invalid");
    if (Number.isNaN(Date.parse(p.signedAt))) failed.push("note-bad-time");
  } catch {
    failed.push("note-unverifiable");
  }
  return failed;
}
