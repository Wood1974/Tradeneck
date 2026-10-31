// EXPORT writes what the phone's hardware key signed, not the Vault's software-key copy.
//
// The Vault copy of a photo is signed by a key in the web view's storage. The record that uploads to the Shield server
// is signed by the Secure Enclave / Keystore key and carries the sensor snapshot and Apple's assertion. An export is only
// "signed by this phone's hardware key" if it is that record, so that is what this builds: the plugin's own
// capture-export package for the photo's whole job chain (so the hash chain checks), with the chosen photo's bytes in it.
// Other photos in the chain keep their hashes but not their bytes, so the file stays small.
//
// A photo with no hardware record on this phone is refused. It is never replaced by the weaker Vault file.
import type { ExportPackage, SecureCapturePlugin } from "@tradedeck/secure-capture";
import { bytesFromB64, sha256Bytes } from "../crypto/seal";
import { isNativeOriginAvailable } from "../platform";

export type ExportPlugin = Pick<SecureCapturePlugin, "listQueue" | "exportQueue" | "readOriginal">;

export type ExportFailure = "not-native" | "no-hardware-record" | "photo-mismatch";

export class ExportError extends Error {
  constructor(readonly code: ExportFailure) {
    super(code);
  }
}

export async function buildHardwareExport(photoSha256: string, plugin: ExportPlugin): Promise<ExportPackage> {
  const { records } = await plugin.listQueue();
  const row = records.find((r) => r.photo_sha256 === photoSha256);
  if (!row) throw new ExportError("no-hardware-record");

  const { packages } = await plugin.exportQueue({ ticketId: row.ticket_id, includePhotos: false });
  const chain = packages.find((p) => p.ticket_id === row.ticket_id);
  const index = chain ? chain.records.findIndex((r) => r.record?.record_hash === row.record_hash) : -1;
  if (!chain || index < 0) throw new ExportError("no-hardware-record");

  const { photoBase64 } = await plugin.readOriginal({ recordHash: row.record_hash });
  // The bytes written must be the ones the signed record names; otherwise the file would carry a photo it does not vouch for.
  if ((await sha256Bytes(bytesFromB64(photoBase64))) !== photoSha256) throw new ExportError("photo-mismatch");

  return { ...chain, records: chain.records.map((r, i) => (i === index ? { ...r, photo_b64: photoBase64 } : r)) };
}

/** The plugin the real app exports through; tests of the whole app stand in for it, as they do for the camera. */
async function exportPlugin(): Promise<ExportPlugin> {
  if (import.meta.env.MODE === "e2e") {
    const hook = (globalThis as { __shieldE2EExportPlugin?: ExportPlugin }).__shieldE2EExportPlugin;
    if (hook) return hook;
  }
  if (!isNativeOriginAvailable()) throw new ExportError("not-native");
  const { SecureCapture } = await import("@tradedeck/secure-capture");
  return SecureCapture;
}

export async function exportHardwarePackage(photoSha256: string): Promise<ExportPackage> {
  return buildHardwareExport(photoSha256, await exportPlugin());
}

export function exportErrorText(err: unknown): string {
  const code = err instanceof ExportError ? err.code : null;
  if (code === "not-native") return "Export needs the phone's hardware-signed record, which only exists in the phone app. Nothing was written.";
  if (code === "no-hardware-record") return "This photo has no hardware-signed record on this phone, so there is nothing true to export. Nothing was written.";
  if (code === "photo-mismatch") return "The stored photo no longer matches its signed record. Nothing was written.";
  return `Export failed: ${String((err as { message?: string })?.message ?? err).slice(0, 160)}. Nothing was written.`;
}

export function exportFileName(photoId: string, createdAt: string): string {
  return `shield-photo_${photoId.slice(0, 8)}_${createdAt.replace(/[:.]/g, "-")}.shield.json`;
}
