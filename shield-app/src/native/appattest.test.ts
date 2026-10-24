import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityError } from "../identity/client";

const appAttestStatus = vi.fn();
const appAttestEnroll = vi.fn();
const appAttestConfirm = vi.fn();
vi.mock("@tradedeck/secure-capture", () => ({
  SecureCapture: {
    // Like Capacitor's real plugin object, which answers every property: anything that awaits or returns it from
    // an async function waits forever. The device check must never do that.
    then: () => undefined,
    appAttestStatus: (...a: unknown[]) => appAttestStatus(...a),
    appAttestEnroll: (...a: unknown[]) => appAttestEnroll(...a),
    appAttestConfirm: (...a: unknown[]) => appAttestConfirm(...a),
  },
}));

const api = {
  signedIn: vi.fn(),
  attestChallenge: vi.fn(),
  attestRegister: vi.fn(),
};
vi.mock("../identity/client", async (original) => ({
  ...(await original<typeof import("../identity/client")>()),
  identityApi: () => api,
}));

import { appAttestState, ENROLL_LIMIT_MS, enrollDevice, enrollErrorText, enrollStepText, type EnrollStep } from "./appattest";

const g = globalThis as unknown as { Capacitor?: unknown };
const order: string[] = [];

beforeEach(() => {
  order.length = 0;
  g.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
  api.signedIn.mockReset().mockReturnValue(true);
  api.attestChallenge.mockReset().mockImplementation(async () => (order.push("challenge"), { nonce: "nonce-1" }));
  api.attestRegister.mockReset().mockImplementation(async () => (order.push("register"), { trusted: true, environment: "production" }));
  appAttestStatus.mockReset();
  appAttestEnroll.mockReset().mockImplementation(async () => (order.push("enroll"), { key_id: "key-1", attestation_b64: "QVRURVNU" }));
  appAttestConfirm.mockReset().mockImplementation(async () => void order.push("confirm"));
});
afterEach(() => {
  delete g.Capacitor;
});

describe("Apple device check state", () => {
  it("does nothing off an iPhone", async () => {
    g.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    expect(await appAttestState()).toEqual({ state: "not-ios" });
    expect(await enrollDevice()).toEqual({ ok: false, reason: "not-ios" });
    expect(appAttestStatus).not.toHaveBeenCalled();
  });

  it("reports unsupported, not enrolled and enrolled from the phone", async () => {
    appAttestStatus.mockResolvedValueOnce({ supported: false, enrolled: false, key_id: null });
    expect(await appAttestState()).toEqual({ state: "unsupported" });
    appAttestStatus.mockResolvedValueOnce({ supported: true, enrolled: false, key_id: null });
    expect(await appAttestState()).toEqual({ state: "not-enrolled" });
    appAttestStatus.mockResolvedValueOnce({ supported: true, enrolled: true, key_id: "key-1" });
    expect(await appAttestState()).toEqual({ state: "enrolled", keyId: "key-1" });
  });

  it("treats a build without the plugin methods as not enrolled", async () => {
    appAttestStatus.mockRejectedValueOnce(new Error("not implemented"));
    expect(await appAttestState()).toEqual({ state: "not-enrolled" });
  });
});

describe("enrolling this phone with Apple", () => {
  it("asks the server for a challenge, has Apple vouch for a key, has the server check it, and only then keeps the key", async () => {
    expect(await enrollDevice()).toEqual({ ok: true, keyId: "key-1" });
    expect(order).toEqual(["challenge", "enroll", "register", "confirm"]);
    expect(appAttestEnroll).toHaveBeenCalledWith({ nonce: "nonce-1" });
    expect(api.attestRegister).toHaveBeenCalledWith({ keyId: "key-1", nonce: "nonce-1", attestation: "QVRURVNU" });
    expect(appAttestConfirm).toHaveBeenCalledWith({ keyId: "key-1" });
  });

  it("does not keep a key the server rejected", async () => {
    api.attestRegister.mockRejectedValueOnce(new IdentityError("app_id_hash_mismatch"));
    const res = await enrollDevice();
    expect(res).toEqual({ ok: false, reason: "app_id_hash_mismatch" });
    expect(appAttestConfirm).not.toHaveBeenCalled();
    expect(enrollErrorText("app_id_hash_mismatch")).toContain("app_id_hash_mismatch");
  });

  it("does not keep a key when the server answers but does not trust it", async () => {
    api.attestRegister.mockResolvedValueOnce({ trusted: false });
    expect(await enrollDevice()).toEqual({ ok: false, reason: "server-rejected" });
    expect(appAttestConfirm).not.toHaveBeenCalled();
  });

  it("asks for a sign-in instead of calling anything when the phone is signed out", async () => {
    api.signedIn.mockReturnValue(false);
    expect(await enrollDevice()).toEqual({ ok: false, reason: "not-signed-in" });
    expect(api.attestChallenge).not.toHaveBeenCalled();
    expect(appAttestEnroll).not.toHaveBeenCalled();
  });

  it("shows Apple's reason when Apple refuses", async () => {
    appAttestEnroll.mockRejectedValueOnce(new Error("attest-failed: App Attest is not available for this app or device"));
    const res = await enrollDevice();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(enrollErrorText(res.reason)).toBe("Apple's device check failed. Reason: App Attest is not available for this app or device");
    expect(api.attestRegister).not.toHaveBeenCalled();
  });

  it("says a lost connection is a connection problem", async () => {
    api.attestChallenge.mockRejectedValueOnce(new IdentityError("network"));
    const res = await enrollDevice();
    expect(res).toEqual({ ok: false, reason: "network" });
    expect(enrollErrorText("network")).toContain("Could not reach the Shield server");
  });
});

describe("enrolling always ends in a visible outcome", () => {
  it("reports each step as it starts, in order, with words for each", async () => {
    const seen: EnrollStep[] = [];
    expect(await enrollDevice((s) => seen.push(s))).toEqual({ ok: true, keyId: "key-1" });
    expect(seen).toEqual(["challenge", "apple", "proof", "saving"]);
    for (const s of seen) expect(enrollStepText(s).length).toBeGreaterThan(10);
  });

  it("names the step when Apple never answers, and keeps nothing", async () => {
    vi.useFakeTimers();
    try {
      appAttestEnroll.mockReturnValueOnce(new Promise(() => undefined));
      const pending = enrollDevice();
      await vi.advanceTimersByTimeAsync(45100);
      const res = await pending;
      expect(res).toEqual({ ok: false, reason: "timed-out:apple" });
      expect(api.attestRegister).not.toHaveBeenCalled();
      expect(appAttestConfirm).not.toHaveBeenCalled();
      expect(enrollErrorText("timed-out:apple")).toBe(
        "Apple's device check did not answer in time. Nothing was saved on this phone. Reason: timed-out:apple",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends after the overall limit even if the server call never comes back", async () => {
    vi.useFakeTimers();
    try {
      api.attestChallenge.mockReturnValueOnce(new Promise(() => undefined));
      const pending = enrollDevice();
      await vi.advanceTimersByTimeAsync(ENROLL_LIMIT_MS + 100);
      expect(await pending).toEqual({ ok: false, reason: "timed-out:challenge" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers and saves nothing for an answer that arrives after the limit", async () => {
    vi.useFakeTimers();
    try {
      let late: (v: { key_id: string; attestation_b64: string }) => void = () => undefined;
      // The step's own limit is 45 s and the overall one is 90 s, so a late answer needs a slow server call first.
      api.attestChallenge.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r({ nonce: "n" }), 60000)));
      appAttestEnroll.mockReturnValueOnce(new Promise((r) => (late = r)));
      const pending = enrollDevice();
      await vi.advanceTimersByTimeAsync(ENROLL_LIMIT_MS + 100);
      expect(await pending).toEqual({ ok: false, reason: "timed-out:apple" });
      late({ key_id: "k", attestation_b64: "QQ==" });
      await vi.advanceTimersByTimeAsync(10);
      expect(api.attestRegister).not.toHaveBeenCalled();
      expect(appAttestConfirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim 'nothing was saved' for a timeout while saving", () => {
    expect(enrollErrorText("timed-out:saving")).not.toContain("Nothing was saved");
    expect(enrollErrorText("timed-out:proof")).toContain("Reason: timed-out:proof");
  });
});

describe("the device check never holds the app up", () => {
  it("gives up on a phone that never answers", async () => {
    vi.useFakeTimers();
    try {
      appAttestStatus.mockReturnValueOnce(new Promise(() => undefined));
      const pending = appAttestState();
      await vi.advanceTimersByTimeAsync(4100);
      expect(await pending).toEqual({ state: "not-enrolled" });
    } finally {
      vi.useRealTimers();
    }
  });
});
