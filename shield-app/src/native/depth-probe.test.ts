import { describe, expect, it } from "vitest";
import { depthProbeLines, type DepthProbeResult } from "./depth-probe";

const good: DepthProbeResult = { lidar_device: true, depth_delivery_supported: true, captured: true, width: 256, height: 192, min_mm: 310, max_mm: 4870, median_mm: 1420, valid_percent: 91, accuracy: "absolute", quality: "high", filtered: true };

describe("the LiDAR check says only what was measured", () => {
  it("reports a depth map with its numbers", () => {
    const text = depthProbeLines(good).join("\n");
    expect(text).toContain("Depth map: 256 × 192 points");
    expect(text).toContain("Distances: 0.31 to 4.87 m (middle 1.42 m)");
    expect(text).toContain("Points with a distance: 91%");
    expect(text).toContain("absolute accuracy, high quality, smoothed by iOS");
    expect(text).toContain("Nothing was saved, signed or sent.");
  });
  it("says a phone without LiDAR has none, and does not claim a result", () => {
    const lines = depthProbeLines({ lidar_device: false, error: "no-lidar-camera" });
    expect(lines).toEqual(["No LiDAR check: this phone has no LiDAR depth camera."]);
  });
  it("is plain about Android", () => {
    expect(depthProbeLines({ supported: false, error: "android-not-supported" })).toEqual(["No LiDAR check: this check is only on iPhone."]);
  });
  it("names the step that failed when the LiDAR camera was found", () => {
    expect(depthProbeLines({ lidar_device: true, depth_delivery_supported: false, error: "depth-delivery-unsupported" })[0]).toBe("LiDAR camera found, but the camera would not deliver depth with a photo.");
    expect(depthProbeLines({ lidar_device: true, captured: true, error: "no-depth-with-photo" })[0]).toBe("LiDAR camera found, but the photo came back with no depth map.");
    expect(depthProbeLines({ lidar_device: true, error: "capture-failed: Cannot Record" })[0]).toBe("LiDAR camera found, but the photo failed: Cannot Record.");
  });
  it("never shows the 'nothing was saved' line unless a depth map was measured", () => {
    for (const r of [{ error: "timed-out" }, { error: "camera-denied" }, { lidar_device: true, captured: false }] as DepthProbeResult[]) {
      expect(depthProbeLines(r).join(" ")).not.toContain("Nothing was saved");
    }
  });
  it("leaves out distances it was not given instead of inventing them", () => {
    const text = depthProbeLines({ lidar_device: true, captured: true, width: 4, height: 4 }).join("\n");
    expect(text).not.toContain("Distances");
    expect(text).not.toContain("Points with a distance");
  });
});
