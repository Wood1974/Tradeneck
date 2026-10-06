import { describe, expect, it } from "vitest";
import { chainStep, devicePublicKeyRaw, deviceSealId, sha256Text, signPayload, stableStringify } from "../crypto/seal";
import type { CloseoutPacket, Job, SealRecord } from "../types";
import { buildCloseoutPacket, missingPoints, packetToHtml, parseCloseoutPacket, verifyCloseoutPacket } from "./closeout";
import { generatePoints } from "./points";

const ZERO = "0".repeat(64);

async function signedRecord(id: string, sha: string, o: { prev?: string; checkpointId?: string; createdAt?: string; jobId?: string } = {}): Promise<SealRecord> {
  const unsigned = {
    id, createdAt: o.createdAt ?? "2026-10-04T00:00:00.000Z", captureKind: "native-camera" as const, platform: "android" as const,
    jobId: o.jobId ?? "job-1", checkpointId: o.checkpointId ?? "construction-1", sha256: sha, prevChain: o.prev ?? ZERO, bytes: 10,
    mime: "image/jpeg", gps: null, pinScore: null, deviceSealId: await deviceSealId(),
    attest: { kind: "none" as const, boundHash: null, tokenPresent: false },
  };
  const chainHead = await chainStep(unsigned.prevChain, await sha256Text(stableStringify(unsigned)));
  const signature = await signPayload({ ...unsigned, chainHead });
  return { ...unsigned, chainHead, signature };
}

function job(shots: string[] = ["shot-1"]): Job {
  const checkpoints = generatePoints({ role: "gc", title: "Slab", trade: "concrete", budgetBand: "under15", description: "pour slab", include: "", exclude: "", answers: {} });
  shots.forEach((s, i) => (checkpoints[i]!.shotId = s));
  return {
    id: "job-1", pack: "construction", customCount: 0, budgetUsd: 4000, feeUsd: 79, feeTier: "standard", lockedAt: "2026-10-04T00:00:00.000Z", pin: null,
    checkpoints,
    brief: { role: "gc", title: "Slab", trade: "concrete", budgetBand: "under15", description: "pour slab", include: "", exclude: "", answers: {}, lockedText: "GC brief", lockedAt: "2026-10-04T00:00:00.000Z" },
  };
}

function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

async function build(records: Record<string, SealRecord>, shots?: string[], notes = ""): Promise<CloseoutPacket> {
  return buildCloseoutPacket({ job: job(shots), role: "gc", notes, recordFor: (id) => records[id] });
}

/** Re-hash and re-sign with the device key, as a holder of the key (not a file editor) could. */
async function resign(p: CloseoutPacket): Promise<CloseoutPacket> {
  const { integrity: _i, ...body } = p;
  return { ...body, integrity: { ...p.integrity, hash: await sha256Text(stableStringify(body)), signature: await signPayload(body) } };
}

const clone = (p: CloseoutPacket) => JSON.parse(JSON.stringify(p)) as CloseoutPacket;

describe("buildCloseoutPacket", () => {
  it("hashes the body with stableStringify and signs with the device key", async () => {
    const r1 = await signedRecord("shot-1", "a".repeat(64));
    const p = await build({ "shot-1": r1 });
    const { integrity, ...body } = p;
    expect(integrity.hash).toBe(await sha256Text(stableStringify(body)));
    expect(p.counts).toEqual({ points: 5, sealed: 1, missing: 4 });
    expect(p.points[0]!.record?.sha256).toBe("a".repeat(64));
    expect(p.points[1]!.code?.irc).toBe("R403.1.1");
    const v = await verifyCloseoutPacket(p);
    expect(v.verdict).toBe("PACKET-SEALED");
    expect(v.signer).toBe(await deviceSealId());
    expect(v.reasons).toContain("signer-not-independently-verified");
  });

  it("is key-order independent", async () => {
    const p = await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) });
    const { integrity: _i, ...body } = reverseKeys(p) as CloseoutPacket;
    expect(await sha256Text(stableStringify(body))).toBe(p.integrity.hash);
  });

  it("round-trips through JSON and renders HTML", async () => {
    const p = await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) }, ["shot-1"], "<b>x</b>");
    const back = parseCloseoutPacket(JSON.stringify(p));
    expect((await verifyCloseoutPacket(back)).verdict).toBe("PACKET-SEALED");
    const html = packetToHtml(back);
    expect(html).toContain("IRC R403.1.1");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("lists missing points", () => {
    expect(missingPoints(job(), () => undefined).map((p) => p.id)).toEqual(["construction-1", "construction-2", "construction-3", "construction-4", "construction-5"]);
  });

  it("rejects non-packets, oversize files and wrong field types", () => {
    expect(() => parseCloseoutPacket('{"version":1}')).toThrow("bad-packet");
    expect(() => parseCloseoutPacket("x".repeat(11 * 1024 * 1024))).toThrow("file-too-large");
    expect(() => parseCloseoutPacket('{"schema":"tradedeck.shield.completion.v3","integrity":{},"points":[],"closedAt":"x","closedBy":null}')).toThrow("bad-packet");
  });
});

describe("verifyCloseoutPacket rejects forgeries", () => {
  it("detects an edited photo hash (outer hash and signature break)", async () => {
    const p = clone(await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) }));
    p.points[0]!.record!.sha256 = "b".repeat(64);
    const v = await verifyCloseoutPacket(p);
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("hash-mismatch");
    expect(v.reasons).toContain("signature-invalid");
  });

  it("rejects a fabricated record even when the whole packet is validly re-signed", async () => {
    const fake = { ...(await signedRecord("shot-1", "a".repeat(64))), signature: "AAAA", chainHead: "1".repeat(64) };
    const p = await resign(clone(await build({ "shot-1": fake })));
    const v = await verifyCloseoutPacket(p);
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("construction-1:chain-head-mismatch");
    expect(v.reasons).toContain("construction-1:record-signature-invalid");
  });

  it("rejects a swapped public key", async () => {
    const p = clone(await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) }));
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey))));
    expect(raw).not.toBe(await devicePublicKeyRaw());
    p.devicePublicKey = raw;
    const v = await verifyCloseoutPacket(p);
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("seal-id-key-mismatch");
    expect(v.reasons).toContain("signature-invalid");
  });

  it("pins the signer when an expected seal ID is given", async () => {
    const p = await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) });
    const ok = await verifyCloseoutPacket(p, (await deviceSealId()).toLowerCase());
    expect(ok.verdict).toBe("PACKET-SEALED");
    expect(ok.reasons).toContain("signer-pinned");
    const bad = await verifyCloseoutPacket(p, "DEADBEEF·DEADBEEF");
    expect(bad.verdict).toBe("PACKET-TAMPERED");
    expect(bad.reasons).toContain("signer-not-expected");
  });

  it("rejects a forked chain, a record from another job, and a wrong checkpoint", async () => {
    const a = await signedRecord("shot-1", "a".repeat(64), { checkpointId: "construction-1" });
    const b = await signedRecord("shot-2", "b".repeat(64), { checkpointId: "construction-2" });
    const fork = await verifyCloseoutPacket(await build({ "shot-1": a, "shot-2": b }, ["shot-1", "shot-2"]));
    expect(fork.reasons).toContain("chain-fork");

    const c = await signedRecord("shot-3", "c".repeat(64), { jobId: "other-job" });
    expect((await verifyCloseoutPacket(await build({ "shot-1": c }))).reasons).toContain("construction-1:record-wrong-job");

    const d = await signedRecord("shot-4", "d".repeat(64), { checkpointId: "construction-3" });
    expect((await verifyCloseoutPacket(await build({ "shot-1": d }))).reasons).toContain("construction-1:record-wrong-checkpoint");
  });

  it("accepts a properly linked chain and rejects time running backwards along it", async () => {
    const a = await signedRecord("shot-1", "a".repeat(64), { checkpointId: "construction-1", createdAt: "2026-10-04T00:00:02.000Z" });
    const b = await signedRecord("shot-2", "b".repeat(64), { checkpointId: "construction-2", prev: a.chainHead, createdAt: "2026-10-04T00:00:05.000Z" });
    expect((await verifyCloseoutPacket(await build({ "shot-1": a, "shot-2": b }, ["shot-1", "shot-2"]))).verdict).toBe("PACKET-SEALED");
    const early = await signedRecord("shot-2", "b".repeat(64), { checkpointId: "construction-2", prev: a.chainHead, createdAt: "2026-10-04T00:00:01.000Z" });
    const v = await verifyCloseoutPacket(await build({ "shot-1": a, "shot-2": early }, ["shot-1", "shot-2"]));
    expect(v.reasons).toContain("shot-2:chain-time-order");
  });

  it("rejects future timestamps and a close that predates its photos", async () => {
    const future = await signedRecord("shot-1", "a".repeat(64), { createdAt: "2999-01-01T00:00:00.000Z" });
    const v = await verifyCloseoutPacket(await build({ "shot-1": future }));
    expect(v.reasons).toContain("future-timestamp");
    expect(v.reasons).toContain("closed-before-capture");
  });

  it("rejects records that are not native camera captures, even when validly signed", async () => {
    for (const kind of ["web-camera", "arrival-hash"]) {
      const r = { ...(await signedRecord("shot-1", "a".repeat(64))), captureKind: kind as "native-camera" };
      const { chainHead: _h, signature: _s, ...unsigned } = r;
      const rehead = await chainStep(unsigned.prevChain, await sha256Text(stableStringify(unsigned)));
      const resigned = { ...unsigned, chainHead: rehead, signature: await signPayload({ ...unsigned, chainHead: rehead }) };
      const v = await verifyCloseoutPacket(await build({ "shot-1": resigned }));
      expect(v.verdict).toBe("PACKET-TAMPERED");
      expect(v.reasons).toContain("construction-1:unsupported-capture-kind");
    }
  });

  it("rejects a wrong counts block", async () => {
    const p = clone(await build({ "shot-1": await signedRecord("shot-1", "a".repeat(64)) }));
    p.counts.sealed = 5;
    const v = await verifyCloseoutPacket(await resign(p));
    expect(v.reasons).toContain("counts-mismatch");
  });
});
