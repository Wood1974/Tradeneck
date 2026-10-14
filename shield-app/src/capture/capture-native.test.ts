import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The native camera plugin and the sign-on check are stood in for, so each way a capture can fail is reachable.
const captureAndSeal = vi.fn();
vi.mock("@tradedeck/secure-capture", () => ({ SecureCapture: { captureAndSeal: (...a: unknown[]) => captureAndSeal(...a) } }));
vi.mock("../identity/store", () => ({
  currentAttestation: async () => ({ attestationId: "att-1", noteSha256: "b".repeat(64) }),
}));

import { captureNative } from "./capture";
import { sha256Bytes } from "../crypto/seal";

const g = globalThis as unknown as { Capacitor?: unknown };

beforeEach(() => {
  captureAndSeal.mockReset();
  g.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
});
afterEach(() => {
  delete g.Capacitor;
});

describe("a native capture that fails says why", () => {
  it("keeps the person-fixable cases distinct", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("camera-denied"));
    expect(await captureNative(null)).toEqual({ error: "camera-denied" });
    captureAndSeal.mockRejectedValueOnce(new Error("camera-cancelled"));
    expect(await captureNative(null)).toEqual({ error: "camera-cancelled" });
    captureAndSeal.mockRejectedValueOnce(new Error("empty-bytes"));
    expect(await captureNative(null)).toEqual({ error: "empty-bytes" });
  });

  it("carries the camera's own reason after camera-failed", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("camera-failed: Cannot Record"));
    expect(await captureNative(null)).toEqual({ error: "camera-failed", detail: "Cannot Record" });
  });

  it("reports a sealing failure as that, not as a camera failure", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("seal-failed: ContractError(message: \"keychain rejected the signing key (-25299)\")"));
    const res = await captureNative(null);
    expect(res).toMatchObject({ error: "seal-failed" });
    expect((res as { detail?: string }).detail).toContain("keychain rejected the signing key");
  });

  it("a reason that mentions 'denied' does not turn a sealing failure into a permission error", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("seal-failed: access denied by the keychain"));
    expect(await captureNative(null)).toMatchObject({ error: "seal-failed", detail: "access denied by the keychain" });
  });

  it("keeps an unrecognised native error as camera-failed with its text", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("something odd"));
    expect(await captureNative(null)).toEqual({ error: "camera-failed", detail: "something odd" });
  });

  it("trims a very long reason", async () => {
    captureAndSeal.mockRejectedValueOnce(new Error("camera-failed: " + "x".repeat(500)));
    const res = (await captureNative(null)) as { detail?: string };
    expect(res.detail?.length).toBe(160);
  });

  it("reports a photo that does not match its sealed record as a sealing failure", async () => {
    const bytes = new TextEncoder().encode("a photo");
    captureAndSeal.mockResolvedValueOnce({ photoBase64: btoa("a photo"), record: { photo_sha256: "0".repeat(64) } });
    expect(await captureNative(null)).toEqual({ error: "seal-failed", detail: "the photo did not match its sealed record" });
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("seals a good photo", async () => {
    const photo = "a good photo";
    const sha = await sha256Bytes(new TextEncoder().encode(photo));
    captureAndSeal.mockResolvedValueOnce({ photoBase64: btoa(photo), record: { photo_sha256: sha }, key_security_level: "SecureEnclave" });
    const res = await captureNative(null);
    expect("item" in res).toBe(true);
    if ("item" in res) expect(res.item.record.sha256).toBe(sha);
  });
});
