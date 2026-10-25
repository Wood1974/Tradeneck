import { waitForTicket } from "../native/tickets";
import { detectPlatform, isNativeOriginAvailable } from "../platform";
import { attestPhotoHash } from "../native/attest";
import {
  chainStep,
  deviceSealId,
  sha256Bytes,
  signPayload,
  stableStringify,
} from "../crypto/seal";
import { activeJobId, chainHead, commitSeal, getJob } from "../store/db";
import type { NativeSealResult } from "@tradedeck/secure-capture";
import { identityApi } from "../identity/client";
import { currentAttestation } from "../identity/store";
import type { SealRecord, VaultItem } from "../types";

export type CaptureError =
  | "not-native"
  | "camera-denied"
  | "camera-cancelled"
  | "camera-failed"
  | "empty-bytes"
  | "plugin-missing"
  | "seal-failed"
  | "not-verified"
  | "not-signed-in";

/** A failed capture. `detail` is the underlying reason, shown so a failure on a real phone can be diagnosed. */
export interface CaptureFailureResult {
  error: CaptureError;
  detail?: string;
}

export interface CaptureOk {
  item: VaultItem;
  /** Hardware seal from the native plugin. Absent on the e2e stand-in path. */
  hardware?: NativeSealResult;
}

const APP_VERSION = "0.4.0";

function uid(): string {
  return crypto.randomUUID();
}

const GPS_TIMEOUT_MS = 4000;

async function readGps(): Promise<SealRecord["gps"]> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
  try {
    // The geolocation `timeout` option does not start until permission is decided, so an
    // unanswered prompt would stall the seal forever. Race it with a hard deadline.
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("gps-timeout")), GPS_TIMEOUT_MS + 500);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(deadline); resolve(p); },
        (e) => { clearTimeout(deadline); reject(e); },
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 5000 },
      );
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      acc: pos.coords.accuracy,
      source: "os",
    };
  } catch {
    return null;
  }
}

function bytesFromBase64(raw: string): ArrayBuffer {
  const cleaned = raw.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** The underlying reason, without the leading error code, trimmed to a length that fits on screen. */
function detailOf(err: unknown, code: string): string | undefined {
  const raw = String((err as { message?: string })?.message ?? err ?? "").trim();
  const cut = raw.toLowerCase().startsWith(code) ? raw.slice(code.length).replace(/^[\s:]+/, "") : raw;
  return cut ? cut.slice(0, 160) : undefined;
}

function nativeFailure(err: unknown): CaptureFailureResult {
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  // The native plugin reports a code, then (for these two) the reason: "seal-failed: <why>", "camera-failed: <why>".
  if (msg.startsWith("seal-failed")) return { error: "seal-failed", detail: detailOf(err, "seal-failed") };
  if (msg.startsWith("camera-failed")) return { error: "camera-failed", detail: detailOf(err, "camera-failed") };
  if (msg.includes("camera-denied") || msg.includes("permission") || msg.includes("denied")) return { error: "camera-denied" };
  if (msg.includes("camera-cancelled") || msg.includes("cancel")) return { error: "camera-cancelled" };
  if (msg.includes("empty-bytes")) return { error: "empty-bytes" };
  if (msg.includes("unavailable") || msg.includes("not implemented") || msg.includes("plugin")) return { error: "plugin-missing" };
  return { error: "camera-failed", detail: detailOf(err, "camera-failed") };
}

let sealQueue: Promise<unknown> = Promise.resolve();

// Seals must run one at a time: each reads the chain head and writes the next one, and a GPS wait
// sits in between. Without this, overlapping seals fork the chain and overwrite each other's job edits.
export function sealFromBytes(bytes: ArrayBuffer, mime: string, checkpointId: string | null): Promise<VaultItem> {
  const run = sealQueue.then(() => sealLocked(bytes, mime, checkpointId));
  sealQueue = run.catch(() => undefined);
  return run;
}

async function sealLocked(bytes: ArrayBuffer, mime: string, checkpointId: string | null): Promise<VaultItem> {
  const createdAt = new Date().toISOString();
  const sha = await sha256Bytes(bytes);
  const [prev, jobId, gps, device, att] = await Promise.all([chainHead(), activeJobId(), readGps(), deviceSealId(), currentAttestation()]);
  const job = jobId ? await getJob(jobId) : undefined;
  const attest = await attestPhotoHash(sha);

  const unsigned = {
    id: uid(),
    createdAt,
    captureKind: "native-camera" as const,
    platform: detectPlatform(),
    jobId: job?.id ?? null,
    checkpointId: checkpointId && job?.checkpoints.some((c) => c.id === checkpointId) ? checkpointId : null,
    sha256: sha,
    prevChain: prev,
    bytes: bytes.byteLength,
    mime,
    gps,
    // No typed job location exists, so there is nothing to score against.
    pinScore: null,
    deviceSealId: device,
    attest,
    // Omitted (not undefined) when there is no note, so records made before the ID check still canonicalize.
    ...(att ? { attestationId: att.attestationId, noteSha256: att.noteSha256 } : {}),
  };

  const recordHash = await sha256Bytes(new TextEncoder().encode(stableStringify(unsigned)));
  const head = await chainStep(prev, recordHash);
  const signature = await signPayload({ ...unsigned, chainHead: head });

  const record: SealRecord = { ...unsigned, chainHead: head, signature };
  const item: VaultItem = { record };
  let updatedJob: typeof job | null = null;
  if (job && record.checkpointId) {
    updatedJob = {
      ...job,
      checkpoints: job.checkpoints.map((c) => (c.id === record.checkpointId ? { ...c, shotId: record.id } : c)),
    };
  }
  await commitSeal(item, bytes, head, updatedJob ?? null);
  return item;
}

export async function captureNative(checkpointId: string | null, direction: "back" | "front" = "back"): Promise<CaptureOk | CaptureFailureResult> {
  if (!isNativeOriginAvailable()) return { error: "not-native" };
  // No photo is taken, and nothing is sealed, until this device holds a signed note backed by a passed ID check.
  // This sits above both the e2e stand-in and the native plugin so neither path can skip it.
  if (!(await currentAttestation())) return { error: "not-verified" };
  // One login is not shared: a photo is sealed only in a session where someone has signed in, and each app restart or SIGN OUT ends it.
  if (!identityApi().signedIn()) return { error: "not-signed-in" };
  if (import.meta.env.MODE === "e2e") {
    // Test builds only (`vite build --mode e2e`): stands in for the OS camera, which a browser test cannot drive.
    // This branch is removed from production bundles; `npm run check:bundle` fails the build if it ships.
    const hook = (globalThis as { __shieldE2ECamera?: (d: string) => Promise<{ base64String?: string; format?: string }> | { base64String?: string; format?: string } }).__shieldE2ECamera;
    if (!hook) return { error: "plugin-missing" };
    try {
      const photo = await hook(direction);
      if (!photo.base64String) return { error: "empty-bytes" };
      const item = await sealFromBytes(bytesFromBase64(photo.base64String), photo.format === "png" ? "image/png" : "image/jpeg", checkpointId);
      return { item };
    } catch (err) {
      const msg = String(err ?? "").toLowerCase();
      if (msg.includes("denied") || msg.includes("permission")) return { error: "camera-denied" };
      return { error: "camera-failed" };
    }
  }
  let sealed: NativeSealResult;
  try {
    const { SecureCapture } = await import("@tradedeck/secure-capture");
    const ticketId = (await activeJobId()) ?? "device";
    // A start-of-job ticket already being fetched gets a moment to finish; the shutter never starts a network call itself.
    await waitForTicket(ticketId);
    sealed = await SecureCapture.captureAndSeal({
      checkpointId: checkpointId ?? "unbound",
      ticketId,
      facing: direction,
      appVersion: APP_VERSION,
    });
  } catch (err) {
    return nativeFailure(err);
  }
  // The phone has a photo. Anything that fails from here is the app's own sealing or storage step, not the camera,
  // so it is reported as such instead of as a camera failure.
  try {
    if (!sealed.photoBase64) return { error: "empty-bytes" };
    const bytes = bytesFromBase64(sealed.photoBase64);
    const sha = await sha256Bytes(bytes);
    if (sha !== sealed.record.photo_sha256) return { error: "seal-failed", detail: "the photo did not match its sealed record" };
    const item = await sealFromBytes(bytes, "image/jpeg", checkpointId);
    return { item, hardware: sealed };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const msg = String((err as { message?: string })?.message ?? err).slice(0, 160);
    return { error: "seal-failed", detail: name && name !== "Error" ? `${name}: ${msg}` : msg };
  }
}

/** Starts the in-app camera session before the shutter. No-op in a browser and in e2e. */
export function warmNativeCamera(direction: "back" | "front", ticketId?: string): void {
  if (import.meta.env.MODE === "e2e") return;
  if (!isNativeOriginAvailable()) return;
  // Not before sign-on: a signed-out phone must not open the camera, or ask for its permission, ahead of the ID check.
  void currentAttestation()
    .then((att) => (att ? import("@tradedeck/secure-capture") : null))
    .then((mod) => mod?.SecureCapture.warmCamera({ facing: direction, ticketId }))
    .catch(() => undefined);
}
