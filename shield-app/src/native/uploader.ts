import { identityApi, type CaptureUpload } from "../identity/client";
import { isNativeOriginAvailable } from "../platform";

// Copies each sealed photo to the Shield server for the account that is signed in. Sealing never waits on this: a photo
// is sealed and kept on the phone first, and goes up later when there is signal and a signed-in account. The server
// checks every upload and refuses what fails, so a refusal is shown and not retried. Order is oldest first, because the
// server checks Apple's assertion counter, which only rises.

const THROTTLE_MS = 20_000;
// What the server says when it will not store a photo. These cannot be fixed by trying again.
const REFUSALS = new Set(["record_invalid", "record_hash_mismatch", "photo_hash_mismatch", "photo_invalid", "signature_invalid", "photo_too_large"]);

export type UploadNote = "" | "sign-in" | "offline" | "quota" | "error";

export interface UploadState {
  /** Sealed photos on this phone. */
  total: number;
  /** Of those, how many the server already has for this account. */
  stored: number;
  refused: Array<{ recordHash: string; reason: string }>;
  running: boolean;
  note: UploadNote;
}

let state: UploadState = { total: 0, stored: 0, refused: [], running: false, note: "" };
let lastStart = 0;
const refusedHashes = new Set<string>();

export const uploadState = (): UploadState => state;

const codeOf = (err: unknown): string => (typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "network");

/** The line the Vault shows. Plain about what is and is not on the server. */
export function uploadLine(s: UploadState = state): string {
  if (!isNativeOriginAvailable() || s.total === 0) return "";
  if (s.note === "sign-in") return `${s.total} photo${s.total === 1 ? "" : "s"} on this phone. Sign in to copy them to the Shield server.`;
  const waiting = s.total - s.stored - s.refused.length;
  const parts = [`Server copy: ${s.stored} of ${s.total} stored.`];
  if (s.refused.length) parts.push(`${s.refused.length} refused by the server (${s.refused[0]!.reason}); they stay on this phone.`);
  if (waiting > 0) {
    parts.push(
      s.note === "quota"
        ? `${waiting} waiting: this account is out of server space.`
        : s.note === "offline"
          ? `${waiting} waiting for signal.`
          : s.running
            ? `Copying ${waiting}…`
            : `${waiting} waiting.`,
    );
  }
  return parts.join(" ");
}

interface PendingItem {
  record: { record_hash: string; wall_time_ms: number } & Record<string, unknown>;
  signature_der_b64: string;
  public_key_uncompressed_b64: string;
  app_attest_key_id?: string | null;
  app_attest_assertion_b64?: string | null;
}

/** Uploads what the server does not have yet. Safe to call at any time and from several places. */
export async function uploadPending(force = false): Promise<void> {
  if (state.running) return;
  if (!force && Date.now() - lastStart < THROTTLE_MS) return;
  if (!isNativeOriginAvailable() || import.meta.env.MODE === "e2e") return;
  lastStart = Date.now();
  state = { ...state, running: true, note: "" };
  try {
    const { SecureCapture } = await import("@tradedeck/secure-capture");
    const { packages } = await SecureCapture.exportQueue();
    const items = (packages.flatMap((p) => p.records) as unknown as PendingItem[])
      .slice()
      .sort((a, b) => a.record.wall_time_ms - b.record.wall_time_ms);
    state = { ...state, total: items.length };
    const api = identityApi();
    if (!api.signedIn()) {
      state = { ...state, note: "sign-in" };
      return;
    }
    const onServer = new Set((await api.listCaptures()).map((c) => c.record_hash));
    state = { ...state, stored: items.filter((i) => onServer.has(i.record.record_hash)).length };
    for (const item of items) {
      const hash = item.record.record_hash;
      if (onServer.has(hash) || refusedHashes.has(hash)) continue;
      const original = await SecureCapture.readOriginal({ recordHash: hash });
      const body: CaptureUpload = {
        record: item.record,
        signature_der_b64: item.signature_der_b64,
        public_key_uncompressed_b64: item.public_key_uncompressed_b64,
        photo_b64: original.photoBase64,
        app_attest_key_id: item.app_attest_key_id ?? null,
        app_attest_assertion_b64: item.app_attest_assertion_b64 ?? null,
      };
      try {
        await api.uploadCapture(body);
        onServer.add(hash);
        state = { ...state, stored: state.stored + 1 };
      } catch (err) {
        const code = codeOf(err);
        if (!REFUSALS.has(code)) throw err;
        refusedHashes.add(hash);
        state = { ...state, refused: [...state.refused, { recordHash: hash, reason: code }] };
      }
    }
  } catch (err) {
    const code = codeOf(err);
    state = { ...state, note: code === "quota_exceeded" ? "quota" : code === "network" ? "offline" : code === "session-expired" || code === "not-signed-in" ? "sign-in" : "error" };
  } finally {
    state = { ...state, running: false };
  }
}
