import { describe, expect, it } from "vitest";
import { sha256Text, stableStringify } from "../crypto/seal";
import type { Job, SealRecord } from "../types";
import { buildCloseoutPacket, missingPoints, packetToHtml, parseCloseoutPacket, verifyCloseoutPacket } from "./closeout";
import { generatePoints } from "./points";

function record(id: string, sha: string): SealRecord {
  return {
    id, createdAt: "2026-10-04T00:00:00.000Z", captureKind: "arrival-hash", platform: "web", jobId: "job-1", checkpointId: "construction-1",
    sha256: sha, prevChain: "0".repeat(64), chainHead: "1".repeat(64), bytes: 10, mime: "image/jpeg", gps: null, pinScore: null,
    deviceSealId: "AAAAAAAA·BBBBBBBB", attest: { kind: "none", boundHash: null, tokenPresent: false }, signature: "sig",
  };
}

function job(): Job {
  const checkpoints = generatePoints({ role: "gc", title: "Slab", trade: "concrete", budgetBand: "under15", description: "pour slab", include: "", exclude: "", answers: {} });
  checkpoints[0]!.shotId = "shot-1";
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

const vault: Record<string, SealRecord> = { "shot-1": record("shot-1", "a".repeat(64)) };
const recordFor = (id: string) => vault[id];

describe("buildCloseoutPacket", () => {
  it("hashes the body with stableStringify and signs with the device key", async () => {
    const p = await buildCloseoutPacket({ job: job(), role: "gc", notes: "done", recordFor });
    const { integrity, ...body } = p;
    expect(integrity.hash).toBe(await sha256Text(stableStringify(body)));
    expect(p.counts).toEqual({ points: 5, sealed: 1, missing: 4 });
    expect(p.points[0]!.record?.sha256).toBe("a".repeat(64));
    expect(p.points[1]!.code?.irc).toBe("R403.1.1");
    expect((await verifyCloseoutPacket(p)).verdict).toBe("PACKET-SEALED");
  });

  it("is key-order independent", async () => {
    const p = await buildCloseoutPacket({ job: job(), role: "gc", notes: "", recordFor });
    const reordered = reverseKeys(p) as typeof p;
    const { integrity: _i, ...body } = reordered;
    expect(await sha256Text(stableStringify(body))).toBe(p.integrity.hash);
  });

  it("detects a changed photo hash", async () => {
    const p = await buildCloseoutPacket({ job: job(), role: "gc", notes: "", recordFor });
    const tampered = JSON.parse(JSON.stringify(p)) as typeof p;
    tampered.points[0]!.record!.sha256 = "b".repeat(64);
    const v = await verifyCloseoutPacket(tampered);
    expect(v.verdict).toBe("PACKET-TAMPERED");
    expect(v.reasons).toContain("hash-mismatch");
    expect(v.reasons).toContain("signature-invalid");
  });

  it("round-trips through JSON and renders HTML", async () => {
    const p = await buildCloseoutPacket({ job: job(), role: "gc", notes: "<b>x</b>", recordFor });
    const back = parseCloseoutPacket(JSON.stringify(p));
    expect((await verifyCloseoutPacket(back)).verdict).toBe("PACKET-SEALED");
    const html = packetToHtml(back);
    expect(html).toContain("IRC R403.1.1");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("lists missing points", () => {
    expect(missingPoints(job(), recordFor).map((p) => p.id)).toEqual(["construction-2", "construction-3", "construction-4", "construction-5"]);
  });

  it("rejects a non-packet", () => {
    expect(() => parseCloseoutPacket('{"version":1}')).toThrow("bad-packet");
  });
});
