// The exported file is checked by the app's own verifier (the Verify tab's path) with real signatures: the chain holds even
// though only one photo's bytes are in the file, and the photo that is in it matches its signed hash.
import { describe, expect, it } from "vitest";
import { VERDICT_INTACT, rawP1363ToDer, seal, signingMessage, verifyExport } from "../capture/record";
import { sha256Bytes } from "../crypto/seal";
import { buildHardwareExport, type ExportPlugin } from "./export-package";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe("an exported package passes the app's own verifier", () => {
  it("keeps the chain and signatures valid with one photo's bytes in it", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const keyB64 = b64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const anchor = "a".repeat(64);
    const photos = ["first photo bytes", "second photo bytes"].map((t) => new TextEncoder().encode(t));
    const stored: Array<{ record: Awaited<ReturnType<typeof seal>>; signature_der_b64: string; public_key_uncompressed_b64: string; sensor_snapshot: null }> = [];
    let prev = anchor;
    for (const [i, bytes] of photos.entries()) {
      const record = { version: 1, checkpoint_id: `cp-${i}`, photo_sha256: await sha256Bytes(bytes), ticket_id: "job-1", wall_time_ms: 1_700_000_000_000 + i * 60_000, monotonic_ms: 5_000 + i * 60_000, boot_count: 4, flags: 0 };
      const sealed = await seal(record, prev);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signingMessage(record, prev) as BufferSource));
      stored.push({ record: sealed, signature_der_b64: b64(rawP1363ToDer(sig)), public_key_uncompressed_b64: keyB64, sensor_snapshot: null });
      prev = sealed.record_hash;
    }
    const plugin = {
      listQueue: async () => ({ records: stored.map((s) => ({ record_hash: s.record.record_hash, ticket_id: "job-1", photo_sha256: s.record.photo_sha256 })) }),
      exportQueue: async () => ({ packages: [{ schema: "tradedeck.shield.capture-export.v1", ticket_id: "job-1", ticket_origin: "local", anchor_hash: anchor, ticket_clock: { wall_time_ms: 1_700_000_000_000, monotonic_ms: 5_000, boot_count: 4 }, records: stored }] }),
      readOriginal: async ({ recordHash }: { recordHash: string }) => ({ photoBase64: b64(photos[stored.findIndex((s) => s.record.record_hash === recordHash)]!), mime: "image/jpeg" as const }),
    } as unknown as ExportPlugin;

    const pkg = await buildHardwareExport(stored[1]!.record.photo_sha256, plugin);
    const checked = await verifyExport(pkg as unknown as Parameters<typeof verifyExport>[0]);
    expect(checked.chain.verdict).toBe(VERDICT_INTACT);
    expect(checked.signatures).toEqual(["valid", "valid"]);
    expect(checked.photos).toEqual(["absent", "match"]);
  });
});
