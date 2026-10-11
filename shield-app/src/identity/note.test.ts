import { describe, expect, it } from "vitest";
import { bytesFromB64, devicePublicKeyRaw, deviceSealId, sha256Text, stableStringify } from "../crypto/seal";
import { checkRecordAuth } from "../crypto/record";
import { captureNative, sealFromBytes } from "../capture/capture";
import { chainHead } from "../store/db";
import { CONSENT_VERSION, NOTE_STATEMENT, checkNote, noteSha256, signNote, type Attestation } from "./note";
import { currentAttestation, saveAttestation } from "./store";
import { makeServiceKey } from "./test-helpers";

const g = globalThis as unknown as { Capacitor?: unknown };

async function attestation(sessionId = "vs_test"): Promise<Attestation> {
  const note = await signNote(sessionId);
  const attestationId = "11111111-1111-4111-8111-111111111111";
  const sha = await noteSha256(note.payload);
  const receipt = await (await makeServiceKey()).receipt({ attestationId, noteSha256: sha, deviceSealId: note.payload.deviceSealId });
  return { attestationId, noteSha256: sha, note, receipt, idCheck: { provider: "stripe-identity" } };
}

describe("signed note", () => {
  it("pins the statement and consent version shared with the backend", async () => {
    // The same digest is pinned in tradedeck-api/tests/test_identity.py. Change both together, with a new version.
    expect(await sha256Text(NOTE_STATEMENT)).toBe("8bde7dfaa7949d57d0179ecb7f6a8a6dfc0ecd11912604d22ca528589074945c");
    expect(CONSENT_VERSION).toBe("1");
  });

  it("canonicalizes exactly like the backend", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: "é" }] })).toBe('{"a":[2,{"c":"é","d":1}],"b":1}');
  });

  it("signs with this device's key as raw r||s, which is the form the backend accepts", async () => {
    const note = await signNote("vs_1");
    expect(bytesFromB64(note.signature).byteLength).toBe(64);
    expect(note.payload.deviceSealId).toBe(await deviceSealId());
    expect(note.devicePublicKey).toBe(await devicePublicKeyRaw());
    expect(await checkNote(note)).toEqual([]);
  });

  it("rejects an edited statement, session, time, seal ID or key", async () => {
    const note = await signNote("vs_1");
    const edit = (over: object) => ({ ...note, payload: { ...note.payload, ...over } });
    expect(await checkNote(edit({ statement: "I did not take these." }))).toContain("note-statement-mismatch");
    expect(await checkNote(edit({ sessionId: "vs_other" }))).toContain("note-signature-invalid");
    expect(await checkNote(edit({ signedAt: "2020-01-01T00:00:00.000Z" }))).toContain("note-signature-invalid");
    expect(await checkNote(edit({ deviceSealId: "00000000·00000000" }))).toContain("note-seal-id-key-mismatch");
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey))));
    expect(await checkNote({ ...note, devicePublicKey: raw })).toContain("note-seal-id-key-mismatch");
  });
});

describe("attestation store and capture gate", () => {
  it("has no attestation until one is saved, and drops one that fails its own checks", async () => {
    expect(await currentAttestation()).toBeNull();
    const att = await attestation();
    await saveAttestation({ ...att, noteSha256: "0".repeat(64) });
    expect(await currentAttestation()).toBeNull();
    await saveAttestation({ ...att, note: { ...att.note, payload: { ...att.note.payload, statement: "x" } } });
    expect(await currentAttestation()).toBeNull();
    await saveAttestation(att);
    expect((await currentAttestation())?.attestationId).toBe(att.attestationId);
  });

  it("drops an attestation whose receipt is missing, for another note, or says the check did not pass", async () => {
    const att = await attestation();
    await saveAttestation({ ...att, receipt: undefined as never });
    expect(await currentAttestation()).toBeNull();
    await saveAttestation({ ...att, receipt: { ...att.receipt, payload: { ...att.receipt.payload, noteSha256: "0".repeat(64) } } });
    expect(await currentAttestation()).toBeNull();
    await saveAttestation({ ...att, receipt: { ...att.receipt, payload: { ...att.receipt.payload, idCheck: { provider: "stripe-identity", status: "requires_input" } } } });
    expect(await currentAttestation()).toBeNull();
    await saveAttestation(att);
    expect(await currentAttestation()).not.toBeNull();
  });

  it("refuses to take or seal a photo without one", async () => {
    await saveAttestation(null as unknown as Attestation);
    g.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    try {
      const before = await chainHead();
      expect(await captureNative(null)).toEqual({ error: "not-verified" });
      expect(await chainHead()).toBe(before);
      await saveAttestation(await attestation());
      // Past the gate: this unit-test build has no native camera, so it stops at the camera step instead.
      expect(await captureNative(null)).not.toEqual({ error: "not-verified" });
    } finally {
      delete g.Capacitor;
    }
  });

  it("signs the note's ID into each new record, and the record still authenticates", async () => {
    const att = await attestation();
    await saveAttestation(att);
    const item = await sealFromBytes(new TextEncoder().encode("with note").buffer, "image/jpeg", null);
    expect(item.record.attestationId).toBe(att.attestationId);
    expect(item.record.noteSha256).toBe(att.noteSha256);
    expect(await checkRecordAuth(item.record, await devicePublicKeyRaw())).toEqual([]);
    expect(await checkRecordAuth({ ...item.record, attestationId: "22222222-2222-4222-8222-222222222222" }, await devicePublicKeyRaw())).not.toEqual([]);
  });

  it("leaves the field out entirely when there is no note, so older records stay valid", async () => {
    await saveAttestation(null as unknown as Attestation);
    const item = await sealFromBytes(new TextEncoder().encode("no note").buffer, "image/jpeg", null);
    expect("attestationId" in item.record).toBe(false);
    expect(await checkRecordAuth(item.record, await devicePublicKeyRaw())).toEqual([]);
  });
});
