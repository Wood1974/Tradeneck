import type { PlatformKind } from "./types";

export function detectPlatform(): PlatformKind {
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const p = cap.getPlatform?.();
    if (p === "ios") return "ios";
    if (p === "android") return "android";
  }
  return "web";
}

export function isNativeOriginAvailable(): boolean {
  return detectPlatform() !== "web";
}
