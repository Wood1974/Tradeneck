import { describe, expect, it, vi } from "vitest";
import { buildHardwareExport, exportErrorText, exportFileName, ExportError, type ExportPlugin } from "./export-package";
import { sha256Bytes } from "../crypto/seal";

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => btoa(s);

async function fixture() {
  const photoA = "photo-a-bytes";
  const photoB = "photo-b-bytes";
  const shaA = await sha256Bytes(enc(photoA));
  const shaB = await sha256Bytes(enc(photoB));
  const rec = (hash: string, sha: string, ticket = "job-1") => ({ record: { record_hash: hash, photo_sha256: sha, ticket_id: ticket }, signature_der_b64: "sig-" + hash });
  const queue = [
    { record_hash: "h1", ticket_id: "job-1", photo_sha256: shaA },
    { record_hash: "h2", ticket_id: "job-1", photo_sha256: shaB },
    { record_hash: "h9", ticket_id: "job-2", photo_sha256: "f".repeat(64) },
  ];
  const pkgJob1 = { schema: "tradedeck.shield.capture-export.v1", ticket_id: "job-1", ticket_origin: "local", anchor_hash: "anchor", ticket_clock: null, records: [rec("h1", shaA), rec("h2", shaB)] };
  const pkgJob2 = { ...pkgJob1, ticket_id: "job-2", records: [rec("h9", "f".repeat(64), "job-2")] };
  const originals: Record<string, string> = { h1: b64(photoA), h2: b64(photoB) };
  const plugin = {
    listQueue: vi.fn(async () => ({ records: queue })),
    exportQueue: vi.fn(async (o?: { ticketId?: string }) => ({ packages: [pkgJob1, pkgJob2].filter((p) => !o?.ticketId || p.ticket_id === o.ticketId) })),
    readOriginal: vi.fn(async ({ recordHash }: { recordHash: string }) => ({ photoBase64: originals[recordHash]!, mime: "image/jpeg" as const })),
  };
  return { plugin: plugin as unknown as ExportPlugin & typeof plugin, shaA, shaB, originals };
}

describe("export writes the hardware-signed package", () => {
  it("is the plugin's own job chain with only the chosen photo's bytes added", async () => {
    const f = await fixture();
    const pkg = await buildHardwareExport(f.shaB, f.plugin);
    expect(pkg.schema).toBe("tradedeck.shield.capture-export.v1");
    expect(pkg.ticket_id).toBe("job-1");
    expect(pkg.records.map((r) => r.record.record_hash)).toEqual(["h1", "h2"]);
    expect(pkg.records[0]!.photo_b64).toBeUndefined();
    expect(pkg.records[1]!.photo_b64).toBe(f.originals.h2);
    expect(pkg.records[1]!.signature_der_b64).toBe("sig-h2");
  });

  it("asks the plugin for the chain without every photo, and for one original", async () => {
    const f = await fixture();
    await buildHardwareExport(f.shaA, f.plugin);
    expect(f.plugin.exportQueue).toHaveBeenCalledWith({ ticketId: "job-1", includePhotos: false });
    expect(f.plugin.readOriginal).toHaveBeenCalledTimes(1);
    expect(f.plugin.readOriginal).toHaveBeenCalledWith({ recordHash: "h1" });
  });

  it("refuses a photo with no hardware record instead of writing the software copy", async () => {
    const f = await fixture();
    await expect(buildHardwareExport("0".repeat(64), f.plugin)).rejects.toMatchObject({ code: "no-hardware-record" });
    expect(f.plugin.exportQueue).not.toHaveBeenCalled();
    expect(f.plugin.readOriginal).not.toHaveBeenCalled();
  });

  it("refuses when the queue lists the photo but the chain does not contain its record", async () => {
    const f = await fixture();
    f.plugin.exportQueue.mockResolvedValueOnce({ packages: [] });
    await expect(buildHardwareExport(f.shaA, f.plugin)).rejects.toMatchObject({ code: "no-hardware-record" });
  });

  it("refuses to write bytes the signed record does not name", async () => {
    const f = await fixture();
    f.plugin.readOriginal.mockResolvedValueOnce({ photoBase64: b64("someone else's bytes"), mime: "image/jpeg" });
    await expect(buildHardwareExport(f.shaA, f.plugin)).rejects.toMatchObject({ code: "photo-mismatch" });
  });
});

describe("what the person is told", () => {
  it("says nothing was written for every failure", () => {
    for (const code of ["not-native", "no-hardware-record", "photo-mismatch"] as const) expect(exportErrorText(new ExportError(code))).toContain("Nothing was written");
    expect(exportErrorText(new Error("bridge down"))).toContain("bridge down");
    expect(exportErrorText(new Error("bridge down"))).toContain("Nothing was written");
  });
  it("names the file after the photo and its time", () => {
    expect(exportFileName("3d9945ea-2597-4615", "2026-10-25T20:30:02.930Z")).toBe("shield-photo_3d9945ea_2026-10-25T20-30-02-930Z.shield.json");
  });
});
