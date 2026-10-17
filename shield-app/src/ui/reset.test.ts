import { beforeEach, describe, expect, it, vi } from "vitest";

const api = { requestReset: vi.fn(), confirmReset: vi.fn() };
vi.mock("../identity/client", () => ({ identityApi: () => api }));

// The panel keeps its state in the module, so each test starts from a fresh copy.
async function load() {
  vi.resetModules();
  return import("./reset");
}

beforeEach(() => {
  api.requestReset.mockReset().mockResolvedValue(undefined);
  api.confirmReset.mockReset().mockResolvedValue(undefined);
});

describe("asking for a code", () => {
  it("opens closed, then shows the email step, and moves to the code step once a code is requested", async () => {
    const r = await load();
    expect(r.resetOpen()).toBe(false);
    r.openReset("  me@example.test ");
    expect(r.resetOpen()).toBe(true);
    expect(r.resetView()).toContain('value="me@example.test"');
    expect(r.resetView()).toContain("SEND CODE");
    await r.sendCode("me@example.test");
    expect(api.requestReset).toHaveBeenCalledWith("me@example.test");
    expect(r.resetView()).toContain("SET NEW PASSWORD");
    expect(r.resetView()).toContain("If that email has a Shield account");
  });

  it("does not call the server for something that is not an email", async () => {
    const r = await load();
    r.openReset();
    await r.sendCode("not an email");
    expect(api.requestReset).not.toHaveBeenCalled();
    expect(r.resetView()).toContain("Enter the email address");
  });

  it("says plainly when the server has no email service, and stays on the email step", async () => {
    api.requestReset.mockRejectedValueOnce({ code: "email_not_configured" });
    const r = await load();
    r.openReset();
    await r.sendCode("me@example.test");
    expect(r.resetView()).toContain("SEND CODE");
    expect(r.resetView()).toContain("not set up on the Shield server yet");
  });

  it("reads a lost connection and the rate limit as such", async () => {
    const r = await load();
    expect(r.resetErrorText("network")).toContain("Could not reach the Shield server");
    expect(r.resetErrorText("rate_limit_exceeded")).toContain("Too many tries");
    expect(r.resetErrorText("odd")).toBe("Something went wrong (odd).");
  });
});

describe("setting the new password", () => {
  const good = "a-long-new-password";

  it("checks the password locally and never sends a bad one", async () => {
    const r = await load();
    r.openReset("me@example.test");
    expect(await r.setNewPassword("me@example.test", "12345678", "short", "short")).toBe(false);
    expect(await r.setNewPassword("me@example.test", "12345678", good, good + "x")).toBe(false);
    expect(await r.setNewPassword("me@example.test", "1234", good, good)).toBe(false);
    expect(api.confirmReset).not.toHaveBeenCalled();
  });

  it("sends only the digits of the code, closes the panel and leaves a notice for the sign-in screen", async () => {
    const r = await load();
    r.openReset("me@example.test");
    expect(await r.setNewPassword("me@example.test", "1234 5678", good, good)).toBe(true);
    expect(api.confirmReset).toHaveBeenCalledWith("me@example.test", "12345678", good);
    expect(r.resetOpen()).toBe(false);
    expect(r.resetNotice()).toBe("Password changed. Sign in with the new password.");
    expect(r.resetEntry()).toContain("Password changed");
  });

  it("keeps the panel open and says why when the code is wrong or expired", async () => {
    api.confirmReset.mockRejectedValueOnce({ code: "invalid_or_expired_code" });
    const r = await load();
    r.openReset("me@example.test");
    expect(await r.setNewPassword("me@example.test", "12345678", good, good)).toBe(false);
    expect(r.resetOpen()).toBe(true);
    expect(r.resetView()).toContain("wrong or has expired");
    expect(r.resetNotice()).toBe("");
  });

  it("never puts the typed code or password into the page it draws", async () => {
    const r = await load();
    r.openReset("me@example.test");
    await r.setNewPassword("me@example.test", "12345678", good, good + "x");
    expect(r.resetView()).not.toContain(good);
    expect(r.resetView()).not.toContain("12345678");
  });
});
