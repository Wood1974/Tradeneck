import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = { listQueue: vi.fn(), readClock: vi.fn(), signGenesis: vi.fn(), adoptServerTicket: vi.fn() };
vi.mock("@tradedeck/secure-capture", () => ({ SecureCapture: plugin }));
vi.mock("../platform", () => ({ isNativeOriginAvailable: () => true }));
const api = { signedIn: vi.fn(), issueTicket: vi.fn(), countersignTicket: vi.fn() };
vi.mock("../identity/client", async () => ({ ...(await vi.importActual<object>("../identity/client")), identityApi: () => api }));

// Each test starts from a fresh copy: the module remembers what it already tried.
async function load() {
  vi.resetModules();
  const t = await import("./tickets");
  const { IdentityError } = await import("../identity/client");
  return { ...t, IdentityError };
}

const CLOCK = { wall_time_ms: 1_700_000_000_000, monotonic_ms: 5000, boot_count: 4 };
const ISSUED = { ticket: { ticket_id: "job-1" }, ticket_hash: "ab".repeat(32), server_signature_der_b64: "srvsig" };

beforeEach(() => {
  api.signedIn.mockReset().mockReturnValue(true);
  api.issueTicket.mockReset().mockResolvedValue(ISSUED);
  api.countersignTicket.mockReset().mockResolvedValue({ ticket_hash: ISSUED.ticket_hash, started: true, already: false });
  plugin.listQueue.mockReset().mockResolvedValue({ records: [] });
  plugin.readClock.mockReset().mockResolvedValue(CLOCK);
  plugin.signGenesis.mockReset().mockResolvedValue({ signature_der_b64: "phonesig", public_key_uncompressed_b64: "pub" });
  plugin.adoptServerTicket.mockReset().mockResolvedValue(undefined);
});

describe("starting a job with a server ticket", () => {
  it("asks the server, countersigns with the phone's key, then makes the ticket the start of the chain", async () => {
    const t = await load();
    expect(await t.ensureServerTicket("job-1")).toBe("server");
    expect(api.issueTicket).toHaveBeenCalledWith("job-1");
    expect(plugin.signGenesis).toHaveBeenCalledWith({ ticketHashHex: ISSUED.ticket_hash, ticketClock: CLOCK });
    expect(api.countersignTicket).toHaveBeenCalledWith({
      ticket: ISSUED.ticket, server_signature_der_b64: "srvsig", ticket_clock: CLOCK, signature_der_b64: "phonesig", public_key_uncompressed_b64: "pub",
    });
    expect(plugin.adoptServerTicket).toHaveBeenCalledWith({ ticketId: "job-1", ticketHash: ISSUED.ticket_hash, ticketClock: CLOCK });
    // The order matters: the server must have accepted the countersign before the phone adopts the ticket.
    expect(api.countersignTicket.mock.invocationCallOrder[0]).toBeLessThan(plugin.adoptServerTicket.mock.invocationCallOrder[0]!);
    expect(t.ticketOutcome("job-1")).toBe("server");
  });

  it("asks once per id, however often it is called", async () => {
    const t = await load();
    await Promise.all([t.ensureServerTicket("job-1"), t.ensureServerTicket("job-1")]);
    await t.ensureServerTicket("job-1");
    expect(api.issueTicket).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a start that cannot be used once photos exist for that id", async () => {
    plugin.listQueue.mockResolvedValue({ records: [{ record_hash: "h", ticket_id: "job-1", photo_sha256: "p" }] });
    const t = await load();
    expect(await t.ensureServerTicket("job-1")).toBe("late");
    expect(api.issueTicket).not.toHaveBeenCalled();
    expect(plugin.adoptServerTicket).not.toHaveBeenCalled();
  });

  it.each(["tickets_closed", "ticket_key_invalid", "Not Found", "http-404", "http-503"])("a server with no ticket service (%s) ends quietly and is not asked again", async (code) => {
    const t = await load();
    api.issueTicket.mockRejectedValue(new t.IdentityError(code));
    expect(await t.ensureServerTicket("job-1")).toBe("closed");
    expect(await t.ensureServerTicket("job-2")).toBe("closed");
    expect(api.issueTicket).toHaveBeenCalledTimes(1);
    expect(plugin.adoptServerTicket).not.toHaveBeenCalled();
  });

  it("no signal, or nobody signed in, is tried again later rather than given up on", async () => {
    const t = await load();
    api.issueTicket.mockRejectedValueOnce(new t.IdentityError("network"));
    expect(await t.ensureServerTicket("job-1")).toBe("offline");
    expect(await t.ensureServerTicket("job-1")).toBe("server");
    api.signedIn.mockReturnValue(false);
    expect(await t.ensureServerTicket("job-2")).toBe("signed-out");
    api.signedIn.mockReturnValue(true);
    expect(await t.ensureServerTicket("job-2")).toBe("server");
  });

  it("a session that ended counts as signed out", async () => {
    const t = await load();
    api.issueTicket.mockRejectedValue(new t.IdentityError("session-expired"));
    expect(await t.ensureServerTicket("job-1")).toBe("signed-out");
  });

  it("a refusal keeps the chain local and is not retried", async () => {
    const t = await load();
    api.countersignTicket.mockRejectedValue(new t.IdentityError("ticket_already_started"));
    expect(await t.ensureServerTicket("job-1")).toBe("refused");
    expect(plugin.adoptServerTicket).not.toHaveBeenCalled();
    await t.ensureServerTicket("job-1");
    expect(api.issueTicket).toHaveBeenCalledTimes(1);
  });

  it("a failing plugin never reaches the caller", async () => {
    const t = await load();
    plugin.signGenesis.mockRejectedValue(new Error("secure enclave busy"));
    await expect(t.ensureServerTicket("job-1")).resolves.toBe("failed");
    plugin.adoptServerTicket.mockRejectedValue(new Error("chain already started"));
    plugin.signGenesis.mockResolvedValue({ signature_der_b64: "s", public_key_uncompressed_b64: "p" });
    await expect(t.ensureServerTicket("job-2")).resolves.toBe("failed");
  });

  it("is never reported as done unless the phone adopted the ticket", async () => {
    const t = await load();
    plugin.adoptServerTicket.mockRejectedValue(new Error("refused"));
    expect(await t.ensureServerTicket("job-1")).toBe("failed");
    expect(t.ticketOutcome("job-1")).toBe("failed");
  });
});

describe("the shutter and the ticket", () => {
  it("waits for a handshake already under way, but never longer than the limit", async () => {
    vi.useFakeTimers();
    const t = await load();
    api.issueTicket.mockReturnValue(new Promise(() => undefined)); // never answers
    void t.ensureServerTicket("job-1");
    let done = false;
    void t.waitForTicket("job-1", 2000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it("starts nothing of its own", async () => {
    const t = await load();
    await t.waitForTicket("never-asked");
    expect(api.issueTicket).not.toHaveBeenCalled();
    expect(plugin.listQueue).not.toHaveBeenCalled();
  });
});
