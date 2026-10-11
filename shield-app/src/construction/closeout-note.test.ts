import { describe, expect, it } from "vitest";
import { chainStep, devicePublicKeyRaw, deviceSealId, sha256Text, signPayload, stableStringify } from "../crypto/seal";
import { noteSha256, signNote, type Attestation } from "../identity/note";
import { makeServiceKey, type TestServiceKey } from "../identity/test-helpers";
import type { CloseoutPacket, Job, SealRecord } from "../types";
import { buildCloseoutPacket, packetToHtml, verifyCloseoutPacket } from "./closeout";
import { generatePoints } from "./points";

const ZERO = "0".repeat(64);

let svc: TestServiceKey;

async function att(signedAt = new Date(Date.now() - 60_000), receiptOver: Parameters<TestServiceKey["receipt"]>[1] = {}): Promise<Attestation> {
  svc ??= await makeServiceKey();
  const note = await signNote("vs_packet", signedAt);
  const attestationId = "33333333-3333-4333-8333-333333333333";
  const sha = await noteSha256(note.payload);
  const receipt = await svc.receipt({ attestationId, noteSha256: sha, deviceSealId: note.payload.deviceSealId }, receiptOver);
  return { attestationId, noteSha256: sha, note, receipt, idCheck: { provider: "stripe-identity" } };
}

async function record(a: Attestation | null, createdAt = new Date().toISOString()): Promise<SealRecord> {
  const unsigned = {
    id: "shot-1", createdAt, captureKind: "native-camera" as const, platform: "android" as const, jobId: "job-1", checkpointId: "construction-1",
    sha256: "a".repeat(64), prevChain: ZERO, bytes: 10, mime: "image/jpeg", gps: null, pinScore: null, deviceSealId: await deviceSealId(),
    attest: { kind: "none" as const, boundHash: null, tokenPresent: false },
    ...(a ? { attestationId: a.attestationId, noteSha256: a.noteSha256 } : {}),
  };
  const chainHead = await chainStep(ZERO, await sha256Text(stableStringify(unsigned)));
  return { ...unsigned, chainHead, signature: await signPayload({ ...unsigned, chainHead }) };
}

function job(): Job {
  const checkpoints = generatePoints({ role: "gc", title: "Slab", trade: "concrete", budgetBand: "under15", description: "pour slab", include: "", exclude: "", answers: {} });
  checkpoints[0]!.shotId = "shot-1";
  return {
    id: "job-1", pack: "construction", customCount: 0, budgetUsd: 4000, feeUsd: 79, feeTier: "standard", lockedAt: "2026-10-04T00:00:00.000Z", pin: null, checkpoints,
    brief: { role: "gc", title: "Slab", trade: "concrete", budgetBand: "under15", description: "pour slab", include: "", exclude: "", answers: {}, lockedText: "GC brief", lockedAt: "2026-10-04T00:00:00.000Z" },
  };
}

const build = async (r: SealRecord, a: Attestation | null) => buildCloseoutPacket({ job: job(), role: "gc", notes: "", recordFor: () => r, attestation: a });
const clone = (p: CloseoutPacket) => JSON.parse(JSON.stringify(p)) as CloseoutPacket;
async function resign(p: CloseoutPacket): Promise<CloseoutPacket> {
  const { integrity: _i, ...body } = p;
  return { ...body, integrity: { ...p.integrity, hash: await sha256Text(stableStringify(body)), signature: await signPayload(body) } };
}

describe("packet with a signed photographer note", () => {
  it("is confirmed by the service when the receipt checks out against a pinned key", async () => {
    const a = await att();
    const p = await build(await record(a), a);
    expect(p.photographer?.attestationId).toBe(a.attestationId);
    const v = await verifyCloseoutPacket(p, undefined, svc.keys);
    expect(v.verdict).toBe("PACKET-SEALED");
    expect(v.reasons).toContain("photographer-note-valid");
    expect(v.reasons).toContain(`id-check-confirmed-by-service:${svc.kid}`);
    expect(packetToHtml(p)).toContain("cannot be verified");
  });

  it("does not claim confirmation when no key is pinned or the receipt is signed by an unknown key", async () => {
    const a = await att();
    const p = await build(await record(a), a);
    const none = await verifyCloseoutPacket(p, undefined, {});
    expect(none.verdict).toBe("PACKET-SEALED");
    expect(none.reasons).toContain("id-receipt-signer-unknown");
    expect(none.reasons.join()).not.toContain("confirmed-by-service");
    const other = await makeServiceKey();
    expect((await verifyCloseoutPacket(p, undefined, other.keys)).reasons).toContain("id-receipt-signer-unknown");
  });

  it("rejects a forged or altered receipt, even when the packet is re-signed", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    p.photographer!.receipt!.payload.issuedAt = new Date(Date.now() - 5_000).toISOString();
    const v = await verifyCloseoutPacket(await resign(p), undefined, svc.keys);
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("receipt-signature-invalid");

    const q = clone(await build(await record(a), a));
    q.photographer!.receipt!.payload.idCheck.status = "requires_input";
    expect((await verifyCloseoutPacket(await resign(q), undefined, svc.keys)).reasons).toContain("receipt-not-verified");

    const forgerSvc = await makeServiceKey();
    const fake = await build(await record(a), { ...a, receipt: await forgerSvc.receipt({ attestationId: a.attestationId, noteSha256: a.noteSha256, deviceSealId: a.note.payload.deviceSealId }, { kid: svc.kid }) });
    expect((await verifyCloseoutPacket(fake, undefined, svc.keys)).reasons).toContain("receipt-signature-invalid");
  });

  it("rejects a receipt issued for another note or after the photos", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    p.photographer!.receipt = await svc.receipt({ attestationId: a.attestationId, noteSha256: "0".repeat(64), deviceSealId: a.note.payload.deviceSealId });
    expect((await verifyCloseoutPacket(await resign(p), undefined, svc.keys)).reasons).toContain("receipt-mismatch");

    const late = await att(new Date(Date.now() - 60_000), { issuedAt: new Date(Date.now() + 60_000).toISOString() });
    const v = await verifyCloseoutPacket(await build(await record(late, new Date(Date.now() - 30_000).toISOString()), late), undefined, svc.keys);
    expect(v.reasons).toContain("receipt-after-capture");
  });

  it("falls back to saying the ID check is unverified when a packet has no receipt", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    delete p.photographer!.receipt;
    const v = await verifyCloseoutPacket(await resign(p), undefined, svc.keys);
    expect(v.verdict).toBe("PACKET-SEALED");
    expect(v.reasons).toContain("id-check-not-independently-verified");
    expect(v.reasons.join()).not.toContain("confirmed-by-service");
  });

  it("still accepts a packet with no note at all, and says so", async () => {
    const v = await verifyCloseoutPacket(await build(await record(null), null));
    expect(v.verdict).toBe("PACKET-SEALED");
    expect(v.reasons).toContain("no-photographer-note");
  });

  it("rejects a packet whose note was stripped after photos were signed to it", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    delete p.photographer;
    const v = await verifyCloseoutPacket(await resign(p));
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("photographer-note-missing");
  });

  it("rejects an edited statement even when the whole packet is re-signed", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    p.photographer!.note.payload.statement = "I did not take these.";
    const v = await verifyCloseoutPacket(await resign(p));
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("note-statement-mismatch");
  });

  it("rejects a note from another key, another attestation, or a swapped hash", async () => {
    const a = await att();
    const p = clone(await build(await record(a), a));
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    p.photographer!.note.devicePublicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey))));
    expect((await verifyCloseoutPacket(await resign(p))).reasons).toContain("note-key-mismatch");

    const q = clone(await build(await record(a), a));
    q.photographer!.attestationId = "44444444-4444-4444-8444-444444444444";
    expect((await verifyCloseoutPacket(await resign(q))).reasons).toContain("shot-1:attestation-mismatch");

    const r = clone(await build(await record(a), a));
    r.photographer!.noteSha256 = "0".repeat(64);
    expect((await verifyCloseoutPacket(await resign(r))).reasons).toContain("note-hash-mismatch");
  });

  it("rejects a statement signed after the photos it claims to cover", async () => {
    const a = await att(new Date(Date.now() + 120_000));
    const v = await verifyCloseoutPacket(await build(await record(a, new Date(Date.now() - 30_000).toISOString()), a));
    expect(v.reasons).toContain("note-after-capture");
  });
});
