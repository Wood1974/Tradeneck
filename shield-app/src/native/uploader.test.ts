import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = { exportQueue: vi.fn(), readOriginal: vi.fn() };
vi.mock("@tradedeck/secure-capture", () => ({ SecureCapture: plugin }));
vi.mock("../platform", () => ({ isNativeOriginAvailable: () => true }));
const api = { signedIn: vi.fn(), listCaptures: vi.fn(), uploadCapture: vi.fn() };
vi.mock("../identity/client", () => ({ identityApi: () => api }));

// The queue keeps its state in the module, so each test starts from a fresh copy.
async function load() {
  vi.resetModules();
  return import("./uploader");
}

const item = (n: number) => ({
  record: { record_hash: `h${n}`, wall_time_ms: 1_000 * n, photo_sha256: `p${n}` },
  signature_der_b64: `sig${n}`,
  public_key_uncompressed_b64: "pub",
  app_attest_key_id: n === 2 ? "key" : null,
  app_attest_assertion_b64: n === 2 ? "assert" : null,
});

beforeEach(() => {
  plugin.exportQueue.mockReset().mockResolvedValue({ packages: [{ records: [item(3), item(1), item(2)] }] });
  plugin.readOriginal.mockReset().mockImplementation(async ({ recordHash }: { recordHash: string }) => ({ photoBase64: `photo-${recordHash}` }));
  api.signedIn.mockReset().mockReturnValue(true);
  api.listCaptures.mockReset().mockResolvedValue([]);
  api.uploadCapture.mockReset().mockResolvedValue({ already: false });
});

describe("copying sealed photos to the server", () => {
  it("uploads oldest first, with the photo and the Apple assertion when there is one", async () => {
    const u = await load();
    await u.uploadPending(true);
    expect(api.uploadCapture.mock.calls.map((c) => c[0].record.record_hash)).toEqual(["h1", "h2", "h3"]);
    const second = api.uploadCapture.mock.calls[1]![0];
    expect(second).toMatchObject({ photo_b64: "photo-h2", app_attest_key_id: "key", app_attest_assertion_b64: "assert", signature_der_b64: "sig2" });
    expect(u.uploadState()).toMatchObject({ total: 3, stored: 3, note: "", running: false });
    expect(u.uploadLine()).toBe("Server copy: 3 of 3 stored.");
  });

  it("skips what the server already has", async () => {
    api.listCaptures.mockResolvedValue([{ record_hash: "h1" }, { record_hash: "h3" }]);
    const u = await load();
    await u.uploadPending(true);
    expect(api.uploadCapture.mock.calls.map((c) => c[0].record.record_hash)).toEqual(["h2"]);
    expect(u.uploadState().stored).toBe(3);
  });

  it("does nothing but say so while signed out, and never reads a photo", async () => {
    api.signedIn.mockReturnValue(false);
    const u = await load();
    await u.uploadPending(true);
    expect(api.uploadCapture).not.toHaveBeenCalled();
    expect(plugin.readOriginal).not.toHaveBeenCalled();
    expect(u.uploadState().note).toBe("sign-in");
    expect(u.uploadLine()).toContain("Sign in to copy them to the Shield server");
  });

  it("stops at a lost connection and leaves the rest waiting", async () => {
    api.uploadCapture.mockResolvedValueOnce({ already: false }).mockRejectedValueOnce({ code: "network" });
    const u = await load();
    await u.uploadPending(true);
    expect(api.uploadCapture).toHaveBeenCalledTimes(2);
    expect(u.uploadState()).toMatchObject({ stored: 1, note: "offline" });
    expect(u.uploadLine()).toBe("Server copy: 1 of 3 stored. 2 waiting for signal.");
  });

  it("shows a refusal, keeps going, and does not try that photo again", async () => {
    api.uploadCapture.mockRejectedValueOnce({ code: "photo_hash_mismatch" }).mockResolvedValue({ already: false });
    const u = await load();
    await u.uploadPending(true);
    expect(u.uploadState().refused).toEqual([{ recordHash: "h1", reason: "photo_hash_mismatch" }]);
    expect(u.uploadState().stored).toBe(2);
    expect(u.uploadLine()).toContain("1 refused by the server (photo_hash_mismatch); they stay on this phone.");
    api.uploadCapture.mockClear();
    api.listCaptures.mockResolvedValue([{ record_hash: "h2" }, { record_hash: "h3" }]);
    await u.uploadPending(true);
    expect(api.uploadCapture).not.toHaveBeenCalled();
  });

  it("says the account is out of space instead of retrying", async () => {
    api.uploadCapture.mockRejectedValue({ code: "quota_exceeded" });
    const u = await load();
    await u.uploadPending(true);
    expect(api.uploadCapture).toHaveBeenCalledTimes(1);
    expect(u.uploadLine()).toContain("this account is out of server space");
  });

  it("asks to sign in again when the session ended", async () => {
    api.listCaptures.mockRejectedValue({ code: "session-expired" });
    const u = await load();
    await u.uploadPending(true);
    expect(u.uploadState().note).toBe("sign-in");
  });

  it("does not start a second run, and a plain call within 20 seconds does nothing", async () => {
    const u = await load();
    await u.uploadPending(true);
    plugin.exportQueue.mockClear();
    await u.uploadPending(false);
    expect(plugin.exportQueue).not.toHaveBeenCalled();
    await u.uploadPending(true);
    expect(plugin.exportQueue).toHaveBeenCalledTimes(1);
  });

  it("says nothing when there are no photos", async () => {
    plugin.exportQueue.mockResolvedValue({ packages: [] });
    const u = await load();
    await u.uploadPending(true);
    expect(u.uploadLine()).toBe("");
  });
});
