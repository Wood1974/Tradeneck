import { identityApi, type CaptureUpload, type StoredCapture } from "../identity/client";
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

// What the server said about each photo, keyed by the photo's SHA-256. Only the server's answer goes in here: the
// phone cannot check Apple's proof itself, so it shows nothing for a photo the server has not looked at.
const serverFacts = new Map<string, Pick<StoredCapture, "record_hash" | "attest" | "time" | "ticket" | "outside_time">>();

function remember(photoSha256: string | undefined, c: Partial<StoredCapture> | undefined): void {
  if (photoSha256 && c?.attest) serverFacts.set(photoSha256, { record_hash: c.record_hash as string, attest: c.attest, time: c.time, ticket: c.ticket, outside_time: c.outside_time });
}

/** The server's record hash for a photo it has stored, or undefined while the photo has not reached it. Share codes are made against this. */
export function recordHashFor(photoSha256: string): string | undefined {
  return serverFacts.get(photoSha256)?.record_hash;
}

export interface DeviceCheckLine {
  text: string;
  tone: "ok" | "warn" | "";
}

/** The Apple device check result for one photo, worded as exactly what is known. iPhone photos only. */
export function appleCheckFor(platform: string, photoSha256: string): DeviceCheckLine | null {
  if (platform !== "ios") return null;
  const seen = serverFacts.get(photoSha256)?.attest;
  if (!seen) return { text: "Apple device check: not checked yet. The Shield server checks it when the photo uploads.", tone: "" };
  if (seen.trusted) return { text: "Apple device check: verified by the Shield server", tone: "ok" };
  const why = seen.status === "none" ? "no Apple proof came with this photo" : seen.status;
  return { text: `Apple device check: not verified by the server (${why})`, tone: "warn" };
}

const utc = (iso: string): string => iso.slice(0, 16).replace("T", " ") + " UTC";

/**
 * What the server says about a photo's clocks, how its chain started, and its outside time-stamp. Facts only, in the server's
 * own terms. A field the server did not send (an older server) produces no line at all, never a guess.
 */
export function serverResultLines(photoSha256: string): DeviceCheckLine[] {
  const seen = serverFacts.get(photoSha256);
  const lines: DeviceCheckLine[] = [];
  if (seen?.time) {
    const note = seen.time.notes[0] ? ` (${seen.time.notes[0]})` : "";
    if (seen.time.label === "CONSISTENT") lines.push({ text: "Clock check: the phone's clocks agree with each other (this is not a timestamp)", tone: "ok" });
    else if (seen.time.label === "DEVICE CLOCK MISMATCH") lines.push({ text: `Clock check: the phone's clocks disagree${note}`, tone: "warn" });
    else if (seen.time.label === "UNVERIFIED TIME") lines.push({ text: `Clock check: cannot be judged${note}`, tone: "" });
    else lines.push({ text: "Clock check: nothing to compare yet", tone: "" });
  }
  if (seen?.ticket) {
    lines.push(seen.ticket.origin === "server" && seen.ticket.after && seen.ticket.before
      ? { text: `Job start: anchored by a server ticket, started ${utc(seen.ticket.after) === utc(seen.ticket.before) ? `at ${utc(seen.ticket.after)}` : `between ${utc(seen.ticket.after)} and ${utc(seen.ticket.before)}`}`, tone: "ok" }
      : { text: "Job start: not anchored by the server", tone: "" });
  }
  const outside = seen?.outside_time;
  if (outside?.status === "stamped" && outside.gen_time) {
    let host = outside.tsa ?? "a time-stamp authority";
    try { host = new URL(host).host; } catch { /* keep the text as the server gave it */ }
    lines.push({ text: `Outside timestamp: ${host} says this existed by ${utc(outside.gen_time)}${outside.chain_checked === false ? " (its certificate chain was not checked)" : ""}`, tone: outside.chain_checked === false ? "" : "ok" });
  } else if (outside?.status === "waiting") {
    lines.push({ text: "Outside timestamp: waiting for the next daily run", tone: "" });
  }
  return lines;
}

/** True when the server flagged this photo's clocks as disagreeing. Used for the one warning mark on the list. */
export function hasClockWarning(photoSha256: string): boolean {
  return serverFacts.get(photoSha256)?.time?.label === "DEVICE CLOCK MISMATCH";
}

/** Photos kept in the phone's protected storage that the Vault list does not show. The list is separate storage the system can clear. */
export function missingFromVault(vaultCount: number): number {
  return Math.max(0, state.total - vaultCount);
}

/** What the phone knows about its connection, from the last real attempt to reach the server plus the system's own flag. */
export function connectionLine(): string {
  if (!isNativeOriginAvailable()) return "";
  const systemOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (systemOffline || state.note === "offline") {
    return "No signal. Photos, sealing, closing a job and verifying records still work. Photos upload when signal returns.";
  }
  if (state.note === "sign-in") return "Signal. Sign in to copy photos to the Shield server.";
  if (state.note === "quota") return "Signal, but this account is out of server space. Photos stay on this phone.";
  if (state.note === "error") return "Signal, but the last copy to the server failed. It tries again.";
  return "Signal. Photos copy to the Shield server while you are signed in.";
}

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
    const stored = await api.listCaptures();
    for (const c of stored) remember(c.photo_sha256, c);
    const onServer = new Set(stored.map((c) => c.record_hash));
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
        const reply = await api.uploadCapture(body);
        const photoSha = String(item.record.photo_sha256 ?? "");
        remember(photoSha, reply);
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
