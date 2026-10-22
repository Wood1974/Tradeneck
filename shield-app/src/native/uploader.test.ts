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

  it("words the connection from what really happened, not from a fixed claim", async () => {
    const u = await load();
    expect(u.connectionLine()).toBe("Signal. Photos copy to the Shield server while you are signed in.");
    api.signedIn.mockReturnValue(false);
    await u.uploadPending(true);
    expect(u.connectionLine()).toBe("Signal. Sign in to copy photos to the Shield server.");
    api.signedIn.mockReturnValue(true);
    api.uploadCapture.mockRejectedValue({ code: "network" });
    await u.uploadPending(true);
    expect(u.connectionLine()).toContain("No signal.");
    expect(u.connectionLine()).toContain("still work");
  });

  it("says no signal when the system reports it, even before an attempt", async () => {
    const u = await load();
    vi.stubGlobal("navigator", { onLine: false });
    expect(u.connectionLine()).toContain("No signal.");
    vi.unstubAllGlobals();
  });

  it("shows the server's Apple result per photo, and says nothing is known before upload", async () => {
    api.listCaptures.mockResolvedValue([
      { record_hash: "h1", photo_sha256: "p1", attest: { status: "verified", trusted: true } },
      { record_hash: "h2", photo_sha256: "p2", attest: { status: "none", trusted: false } },
    ]);
    const u = await load();
    expect(u.appleCheckFor("ios", "p1")?.text).toContain("not checked yet");
    await u.uploadPending(true);
    expect(u.appleCheckFor("ios", "p1")).toEqual({ text: "Apple device check: verified by the Shield server", tone: "ok" });
    expect(u.appleCheckFor("ios", "p2")?.text).toBe("Apple device check: not verified by the server (no Apple proof came with this photo)");
    expect(u.appleCheckFor("android", "p1")).toBeNull();
  });

  it("learns the Apple result from the upload reply too", async () => {
    api.uploadCapture.mockResolvedValue({ already: false, attest: { status: "bad_assertion", trusted: false } });
    const u = await load();
    await u.uploadPending(true);
    expect(u.appleCheckFor("ios", "p2")?.tone).toBe("warn");
    expect(u.appleCheckFor("ios", "p2")?.text).toContain("bad_assertion");
  });

  it("counts photos the phone holds that the Vault list does not show", async () => {
    const u = await load();
    await u.uploadPending(true);
    expect(u.missingFromVault(3)).toBe(0);
    expect(u.missingFromVault(1)).toBe(2);
    expect(u.missingFromVault(9)).toBe(0);
  });

  it("shows the server's clock, job-start and outside-time results in its own terms", async () => {
    api.listCaptures.mockResolvedValue([
      { record_hash: "h1", photo_sha256: "p1", attest: { status: "none", trusted: false },
        time: { label: "CONSISTENT", notes: [] },
        ticket: { origin: "server", after: "2026-10-21T10:00:00+00:00", before: "2026-10-21T10:00:05+00:00" },
        outside_time: { status: "stamped", gen_time: "2026-10-22T00:00:09+00:00", tsa: "http://timestamp.digicert.com", chain_checked: false } },
      { record_hash: "h2", photo_sha256: "p2", attest: { status: "none", trusted: false },
        time: { label: "DEVICE CLOCK MISMATCH", notes: ["GPS time and the phone's clock differ by 3600 s"] },
        ticket: { origin: "local" }, outside_time: { status: "waiting" } },
      { record_hash: "h3", photo_sha256: "p3", attest: { status: "none", trusted: false },
        time: { label: "UNVERIFIED TIME", notes: ["the phone restarted since the earlier reading"] }, outside_time: { status: "off" } },
    ]);
    const u = await load();
    expect(u.serverResultLines("p1")).toEqual([]); // nothing is known before the photo has reached the server
    await u.uploadPending(true);
    expect(u.serverResultLines("p1")).toEqual([
      { text: "Clock check: the phone's clocks agree with each other (this is not a timestamp)", tone: "ok" },
      { text: "Job start: anchored by a server ticket, started at 2026-10-21 10:00 UTC", tone: "ok" },
      { text: "Outside timestamp: timestamp.digicert.com says this existed by 2026-10-22 00:00 UTC (its certificate chain was not checked)", tone: "" },
    ]);
    expect(u.serverResultLines("p2")).toEqual([
      { text: "Clock check: the phone's clocks disagree (GPS time and the phone's clock differ by 3600 s)", tone: "warn" },
      { text: "Job start: not anchored by the server", tone: "" },
      { text: "Outside timestamp: waiting for the next daily run", tone: "" },
    ]);
    expect(u.serverResultLines("p3")).toEqual([{ text: "Clock check: cannot be judged (the phone restarted since the earlier reading)", tone: "" }]);
    expect(u.hasClockWarning("p1")).toBe(false);
    expect(u.hasClockWarning("p2")).toBe(true);
    expect(u.hasClockWarning("nope")).toBe(false);
  });

  it("an older server that sends none of these fields produces no lines at all", async () => {
    api.listCaptures.mockResolvedValue([{ record_hash: "h1", photo_sha256: "p1", attest: { status: "verified", trusted: true } }]);
    const u = await load();
    await u.uploadPending(true);
    expect(u.serverResultLines("p1")).toEqual([]);
    expect(u.hasClockWarning("p1")).toBe(false);
  });

  it("learns the results from the upload reply as well", async () => {
    api.uploadCapture.mockResolvedValue({ already: false, attest: { status: "none", trusted: false }, time: { label: "NOT CHECKED", notes: ["nothing to compare it with"] } });
    const u = await load();
    await u.uploadPending(true);
    expect(u.serverResultLines("p2")).toEqual([{ text: "Clock check: nothing to compare yet", tone: "" }]);
  });
});
