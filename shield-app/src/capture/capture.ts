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
import type { SealRecord, VaultItem } from "../types";

export type CaptureError =
  | "not-native"
  | "camera-denied"
  | "camera-cancelled"
  | "camera-failed"
  | "empty-bytes"
  | "plugin-missing";

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

function pinScore(gps: SealRecord["gps"], jobPin: { lat: number; lng: number; radiusM: number } | null): SealRecord["pinScore"] {
  if (!jobPin) return null;
  if (!gps) {
    return { meters: null, inside: null, mockFlag: isNativeOriginAvailable() ? "native-pending" : "unknown" };
  }
  const meters = haversineM(gps.lat, gps.lng, jobPin.lat, jobPin.lng);
  // A fix less precise than the pin radius cannot place the device inside it.
  return {
    meters,
    inside: gps.acc > jobPin.radiusM ? null : meters <= jobPin.radiusM,
    mockFlag: isNativeOriginAvailable() ? "native-pending" : "unknown",
  };
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat);
  const dLng = toR(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bytesFromBase64(raw: string): ArrayBuffer {
  const cleaned = raw.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function nativeFailure(err: unknown): CaptureError {
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  if (msg.includes("camera-denied") || msg.includes("permission") || msg.includes("denied")) return "camera-denied";
  if (msg.includes("camera-cancelled") || msg.includes("cancel")) return "camera-cancelled";
  if (msg.includes("empty-bytes")) return "empty-bytes";
  if (msg.includes("unavailable") || msg.includes("not implemented") || msg.includes("plugin")) return "plugin-missing";
  return "camera-failed";
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
  const [prev, jobId, gps, device] = await Promise.all([chainHead(), activeJobId(), readGps(), deviceSealId()]);
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
    pinScore: pinScore(gps, job?.pin ?? null),
    deviceSealId: device,
    attest,
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

export async function captureNative(checkpointId: string | null, direction: "back" | "front" = "back"): Promise<CaptureOk | { error: CaptureError }> {
  if (import.meta.env.MODE === "e2e") {
    // Test builds only (`vite build --mode e2e`): stands in for the OS camera, which a browser test cannot drive.
    // This branch is removed from production bundles; `npm run check:bundle` fails the build if it ships.
    if (!isNativeOriginAvailable()) return { error: "not-native" };
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
  if (!isNativeOriginAvailable()) return { error: "not-native" };
  try {
    const { SecureCapture } = await import("@tradedeck/secure-capture");
    const ticketId = (await activeJobId()) ?? "device";
    const sealed = await SecureCapture.captureAndSeal({
      checkpointId: checkpointId ?? "unbound",
      ticketId,
      facing: direction,
      appVersion: APP_VERSION,
    });
    if (!sealed.photoBase64) return { error: "empty-bytes" };
    const bytes = bytesFromBase64(sealed.photoBase64);
    const sha = await sha256Bytes(bytes);
    if (sha !== sealed.record.photo_sha256) return { error: "camera-failed" };
    const item = await sealFromBytes(bytes, "image/jpeg", checkpointId);
    return { item, hardware: sealed };
  } catch (err) {
    return { error: nativeFailure(err) };
  }
}

/** Starts the in-app camera session before the shutter. No-op in a browser and in e2e. */
export function warmNativeCamera(direction: "back" | "front", ticketId?: string): void {
  if (import.meta.env.MODE === "e2e") return;
  if (!isNativeOriginAvailable()) return;
  void import("@tradedeck/secure-capture")
    .then(({ SecureCapture }) => SecureCapture.warmCamera({ facing: direction, ticketId }))
    .catch(() => undefined);
}
