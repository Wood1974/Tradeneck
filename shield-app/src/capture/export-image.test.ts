import { describe, expect, it } from "vitest";
import {
  VERDICT_INTACT,
  buildRecord,
  photoSha256,
  rawP1363ToDer,
  seal,
  signingMessage,
  unsignedRecordFields,
  verifyExport,
  verifyHardwareSignature,
  type ExportPackage,
  type ExportRecord,
} from "./record";
import { exportReport } from "../ui/exportReport";

const ANCHOR = "a".repeat(64);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function jpeg(seed: number): Uint8Array {
  const out = new Uint8Array(64);
  out.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < out.length; i += 1) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const keyB64 = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));

async function item(bytes: Uint8Array, prev: string, withPhoto: boolean): Promise<ExportRecord> {
  const record = buildRecord({
    version: 1,
    checkpoint_id: "cp-1",
    photo_sha256: await photoSha256(bytes as BufferSource),
    ticket_id: "job-1",
    wall_time_ms: 1_700_000_000_000,
    monotonic_ms: 5_000,
    boot_count: 4,
    flags: 0,
  });
  const sealed = await seal(record, prev);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signingMessage(sealed, prev) as BufferSource));
  return {
    record: sealed,
    signature_der_b64: b64(rawP1363ToDer(sig)),
    public_key_uncompressed_b64: keyB64,
    ...(withPhoto ? { photo_b64: b64(bytes) } : {}),
  };
}

async function pkg(records: ExportRecord[]): Promise<ExportPackage> {
  return {
    schema: "tradedeck.shield.capture-export.v1",
    anchor_hash: ANCHOR,
    ticket_clock: { wall_time_ms: 1_700_000_000_000, monotonic_ms: 5_000, boot_count: 4 },
    records,
  };
}

describe("export image check", () => {
  it("matches image bytes in the package against the signed photo hash", async () => {
    const result = await verifyExport(await pkg([await item(jpeg(1), ANCHOR, true)]));
    expect(result.chain.verdict).toBe(VERDICT_INTACT);
    expect(result.signatures).toEqual(["valid"]);
    expect(result.photos).toEqual(["match"]);
    expect(exportReport(result)).toContain("IMAGES CHECKED 1 of 1: each image hashes to the signed photo hash.");
  });

  it("reports a changed image as TAMPERED even though the record signature is still valid", async () => {
    const good = await item(jpeg(1), ANCHOR, false);
    const swapped: ExportRecord = { ...good, photo_b64: b64(jpeg(2)) };
    const result = await verifyExport(await pkg([swapped]));
    expect(result.signatures).toEqual(["valid"]);
    expect(result.photos).toEqual(["mismatch"]);
    const lines = exportReport(result);
    expect(lines[0]).toBe("TAMPERED");
    expect(lines).toContain("photo-sha256-mismatch");
  });

  it("says no image was checked when the package carries none, and a valid signature does not change that", async () => {
    const result = await verifyExport(await pkg([await item(jpeg(1), ANCHOR, false)]));
    expect(result.signatures).toEqual(["valid"]);
    expect(result.photos).toEqual(["absent"]);
    const lines = exportReport(result);
    expect(lines[0]).toBe(VERDICT_INTACT);
    expect(lines.some((line) => line.startsWith("NO IMAGE CHECKED"))).toBe(true);
  });

  it("does not accept a hash the exporter merely states", async () => {
    const good = await item(jpeg(1), ANCHOR, false);
    const claimed: ExportRecord = { ...good, photo_sha256_bytes: good.record.photo_sha256 };
    expect((await verifyExport(await pkg([claimed]))).photos).toEqual(["absent"]);
  });

  it("reports a partial check plainly", async () => {
    const first = await item(jpeg(1), ANCHOR, true);
    const second = await item(jpeg(2), first.record.record_hash, false);
    const result = await verifyExport(await pkg([first, second]));
    expect(result.photos).toEqual(["match", "absent"]);
    expect(exportReport(result)).toContain("IMAGES CHECKED 1 of 2: the rest carry no image bytes and were not checked.");
  });

  it("rejects an encoding that is not the canonical base64 of the bytes", async () => {
    const good = await item(jpeg(1), ANCHOR, true);
    const encoded = good.photo_b64!;
    const variants = [`${encoded.slice(0, 8)}\n${encoded.slice(8)}`, ` ${encoded}`, encoded.replace(/=+$/, ""), `${encoded}AAAA`, ""];
    for (const photo_b64 of variants) {
      const result = await verifyExport(await pkg([{ ...good, photo_b64 }]));
      expect(result.photos, JSON.stringify(photo_b64.slice(-6))).toEqual(["mismatch"]);
    }
  });

  it("rejects a record that carries fields the signature does not cover", async () => {
    const good = await item(jpeg(1), ANCHOR, true);
    const padded = { ...good, record: { ...good.record, caption: "added after signing" } };
    expect(unsignedRecordFields(padded.record)).toEqual(["caption"]);
    await expect(verifyExport(await pkg([padded as ExportRecord]))).rejects.toThrow(/does not cover: caption/);
    expect(unsignedRecordFields(good.record)).toEqual([]);
  });

  it("signs the image hash, so a different hash breaks the signature", async () => {
    const good = await item(jpeg(1), ANCHOR, false);
    const other = { ...good.record, photo_sha256: await photoSha256(jpeg(2) as BufferSource) };
    const message = signingMessage(other, other.prev_hash);
    expect(await verifyHardwareSignature(keyB64, message, good.signature_der_b64!)).toBe(false);
  });
});
