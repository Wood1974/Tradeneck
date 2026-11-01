// LiDAR check: what iOS actually hands the app as depth with a photo, measured once on this phone.
// It signs nothing, stores nothing and sends nothing; the native side returns numbers and the photo is dropped there.
import type { DepthProbeResult } from "@tradedeck/secure-capture";
import { detectPlatform } from "../platform";

export type { DepthProbeResult };

const REASONS: Record<string, string> = {
  "android-not-supported": "this check is only on iPhone",
  "no-lidar-camera": "this phone has no LiDAR depth camera",
  "depth-delivery-unsupported": "the camera would not deliver depth with a photo",
  "no-depth-with-photo": "the photo came back with no depth map",
  "camera-denied": "camera access is off for Shield",
  "camera-permission-not-asked": "camera access has not been asked for yet; take a photo once first",
  "timed-out": "the camera did not answer in 12 seconds",
  "probe-already-running": "a check is already running",
};

export const isDepthProbeAvailable = (): boolean => detectPlatform() === "ios";

export async function runDepthProbe(): Promise<DepthProbeResult> {
  const { SecureCapture } = await import("@tradedeck/secure-capture");
  return SecureCapture.depthProbe();
}

const m = (mm: number): string => (mm / 1000).toFixed(2);

/** Plain lines for the screen. Every number here was measured by the native check; nothing is inferred. */
export function depthProbeLines(r: DepthProbeResult): string[] {
  if (r.error?.startsWith("capture-failed")) return [`LiDAR camera found, but the photo failed: ${r.error.slice("capture-failed: ".length) || "unknown reason"}.`];
  if (r.error && r.lidar_device !== true) return [`No LiDAR check: ${REASONS[r.error] ?? r.error}.`];
  if (r.error) return [`LiDAR camera found, but ${REASONS[r.error] ?? r.error}.`];
  if (r.captured !== true || r.width == null || r.height == null) return ["The check ended without a depth map."];
  const lines = ["LiDAR camera: found", "Depth with the photo: yes", `Depth map: ${r.width} × ${r.height} points`];
  if (r.min_mm != null && r.max_mm != null && r.median_mm != null) lines.push(`Distances: ${m(r.min_mm)} to ${m(r.max_mm)} m (middle ${m(r.median_mm)} m)`);
  if (r.valid_percent != null) lines.push(`Points with a distance: ${r.valid_percent}%`);
  const quality = [r.accuracy ? `${r.accuracy} accuracy` : "", r.quality ? `${r.quality} quality` : "", r.filtered ? "smoothed by iOS" : r.filtered === false ? "not smoothed" : ""].filter(Boolean);
  if (quality.length) lines.push(`iOS reports: ${quality.join(", ")}`);
  lines.push("Nothing was saved, signed or sent.");
  return lines;
}
