import { beforeEach, describe, expect, it, vi } from "vitest";

const api = { signUp: vi.fn() };
vi.mock("../identity/client", () => ({ identityApi: () => api }));

// The panel keeps its state in the module, so each test starts from a fresh copy.
async function load() {
  vi.resetModules();
  return import("./signup");
}

const good = { invite: "ABCD-EFGH-JKMN", email: "me@example.test", password: "a-long-new-password", again: "a-long-new-password" };

beforeEach(() => {
  api.signUp.mockReset().mockResolvedValue(undefined);
});

describe("checking the form on the phone", () => {
  it("accepts a complete form", async () => {
    const s = await load();
    expect(s.validateSignup(good)).toBeNull();
  });

  it("names the first thing that is wrong, and sends nothing", async () => {
    const s = await load();
    expect(s.validateSignup({ ...good, invite: "ABC" })).toContain("invite code");
    expect(s.validateSignup({ ...good, email: "nope" })).toContain("email address");
    expect(s.validateSignup({ ...good, password: "short", again: "short" })).toContain("12 characters");
    expect(s.validateSignup({ ...good, again: "different-long-password" })).toContain("do not match");
    expect(await s.submitSignup({ ...good, invite: "" })).toBe(false);
    expect(api.signUp).not.toHaveBeenCalled();
  });
});

describe("making the account", () => {
  it("sends the trimmed email and the code and says true", async () => {
    const s = await load();
    expect(await s.submitSignup({ ...good, email: "  me@example.test ", invite: " ABCD-EFGH-JKMN " })).toBe(true);
    expect(api.signUp).toHaveBeenCalledWith("me@example.test", good.password, "ABCD-EFGH-JKMN");
  });

  it("explains each server refusal in plain words", async () => {
    const s = await load();
    expect(s.signupErrorText("invalid_or_expired_invite")).toContain("wrong, already used, or has expired");
    expect(s.signupErrorText("account_already_exists")).toContain("already has an account");
    expect(s.signupErrorText("network")).toContain("Could not reach");
    expect(s.signupErrorText("odd")).toBe("Something went wrong (odd).");
  });

  it("shows the refusal in the panel and says false", async () => {
    api.signUp.mockRejectedValueOnce({ code: "invalid_or_expired_invite" });
    const s = await load();
    s.openSignup();
    expect(await s.submitSignup(good)).toBe(false);
    expect(s.signupView()).toContain("wrong, already used, or has expired");
  });

  it("opens, closes and renders the form with the password toggle", async () => {
    const s = await load();
    expect(s.signupOpen()).toBe(false);
    s.openSignup();
    expect(s.signupOpen()).toBe(true);
    const view = s.signupView();
    expect(view).toContain("CREATE ACCOUNT");
    expect(view).toContain('data-pw-toggle="su-pass"');
    s.closeSignup();
    expect(s.signupOpen()).toBe(false);
  });
});
