import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = false;
const api = { signedIn: () => signedIn, signIn: vi.fn(), signOut: vi.fn() };
vi.mock("../identity/client", async (orig) => ({ ...(await orig<typeof import("../identity/client")>()), identityApi: () => api }));
vi.mock("../native/uploader", () => ({ uploadLine: () => "3 photos on this phone. Server copy: 1 of 3 stored.", uploadPending: vi.fn(async () => undefined) }));
vi.mock("./devices-panel", () => ({ phonesPanelHtml: () => '<div id="phones-stub"></div>', resetPhones: vi.fn() }));
vi.mock("./share-panel", () => ({ resetShare: vi.fn() }));

import { IdentityError } from "../identity/client";
import { uploadPending } from "../native/uploader";
import { resetPhones } from "./devices-panel";
import { resetShare } from "./share-panel";
import { accountView, bindAccount } from "./account";

interface FakeEl {
  value?: string;
  textContent?: string;
  oninput?: unknown;
  handler?: (e: { currentTarget: FakeEl }) => void;
  disabled: boolean;
  addEventListener: (t: string, fn: (e: { currentTarget: FakeEl }) => void) => void;
  setAttribute: (n: string) => void;
  removeAttribute: (n: string) => void;
}
const el = (value = ""): FakeEl => {
  const e: FakeEl = {
    value, textContent: "", disabled: false,
    addEventListener: (_t, fn) => (e.handler = fn),
    setAttribute: () => (e.disabled = true),
    removeAttribute: () => (e.disabled = false),
  };
  return e;
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function screen(typedEmail = " pro@example.test ", typedPass = "correct-horse") {
  const parts: Record<string, FakeEl> = {
    '[data-act="acct-signin"]': el(), '[data-act="acct-signout"]': el(), '[data-act="acct-sync"]': el(),
    "#acct-email": el(typedEmail), "#acct-pass": el(typedPass), "[data-acct-status]": el(),
  };
  const root = { querySelector: (s: string) => parts[s] ?? null, querySelectorAll: () => [] };
  const rerender = vi.fn();
  bindAccount(root as never, rerender);
  return { parts, rerender };
}

beforeEach(() => {
  signedIn = false;
  api.signIn.mockReset().mockResolvedValue(undefined);
  api.signOut.mockReset();
  vi.mocked(uploadPending).mockClear();
  vi.mocked(resetShare).mockClear();
  vi.mocked(resetPhones).mockClear();
});

describe("the Account tab, signed out", () => {
  it("offers a sign-in form and says photos need it", () => {
    const html = accountView();
    expect(html).toContain("SIGNED OUT");
    expect(html).toContain('data-act="acct-signin"');
    expect(html).toContain('id="acct-pass"');
    expect(html).toContain("only while you are signed in");
    expect(html).toContain("FORGOT PASSWORD?");
    expect(html).not.toContain("phones-stub");
    expect(html).not.toContain('data-act="acct-signout"');
  });

  it("signs in with the trimmed email, then copies waiting photos without another tap", async () => {
    const { parts, rerender } = screen();
    parts['[data-act="acct-signin"]']!.handler!({ currentTarget: parts['[data-act="acct-signin"]']! });
    await flush();
    expect(api.signIn).toHaveBeenCalledWith("pro@example.test", "correct-horse");
    expect(uploadPending).toHaveBeenCalledWith(true);
    expect(rerender).toHaveBeenCalled();
  });

  it("asks for both fields and sends nothing when one is empty", async () => {
    const { parts } = screen("pro@example.test", "");
    parts['[data-act="acct-signin"]']!.handler!({ currentTarget: parts['[data-act="acct-signin"]']! });
    await flush();
    expect(api.signIn).not.toHaveBeenCalled();
    expect(parts["[data-acct-status]"]!.textContent).toBe("Enter the email and password of your Shield account.");
  });

  it("says a wrong password in words, keeps what was typed and lets the button be used again", async () => {
    api.signIn.mockRejectedValue(new IdentityError("bad-credentials"));
    const { parts, rerender } = screen();
    const button = parts['[data-act="acct-signin"]']!;
    button.handler!({ currentTarget: button });
    expect(button.disabled).toBe(true);
    await flush();
    expect(parts["[data-acct-status]"]!.textContent).toBe("That email or password was not accepted.");
    expect(button.disabled).toBe(false);
    expect(parts["#acct-email"]!.value).toBe(" pro@example.test ");
    expect(uploadPending).not.toHaveBeenCalled();
    expect(rerender).not.toHaveBeenCalled();
  });

  it("says a lost connection in words", async () => {
    api.signIn.mockRejectedValue(new IdentityError("network"));
    const { parts } = screen();
    parts['[data-act="acct-signin"]']!.handler!({ currentTarget: parts['[data-act="acct-signin"]']! });
    await flush();
    expect(parts["[data-acct-status]"]!.textContent).toContain("Signing in needs a connection");
  });
});

describe("the Account tab, signed in", () => {
  it("shows what the sign-in covers, the upload line, sign out and the phones panel, and no password box", () => {
    signedIn = true;
    const html = accountView();
    expect(html).toContain("SIGNED IN");
    expect(html).toContain("3 photos on this phone. Server copy: 1 of 3 stored.");
    expect(html).toContain('data-act="acct-signout"');
    expect(html).toContain('data-act="acct-sync"');
    expect(html).toContain("phones-stub");
    expect(html).not.toContain("acct-pass");
    expect(html).toContain("Signing out does not delete anything");
    expect(html).toContain("12 hours");
  });

  it("sign out drops the sign-in and forgets a code or phone list that was on screen", async () => {
    signedIn = true;
    const { parts, rerender } = screen();
    parts['[data-act="acct-signout"]']!.handler!({ currentTarget: parts['[data-act="acct-signout"]']! });
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(resetShare).toHaveBeenCalled();
    expect(resetPhones).toHaveBeenCalled();
    expect(rerender).toHaveBeenCalled();
  });

  it("copy now asks the uploader to go, ignoring its throttle", async () => {
    signedIn = true;
    const { parts } = screen();
    parts['[data-act="acct-sync"]']!.handler!({ currentTarget: parts['[data-act="acct-sync"]']! });
    await flush();
    expect(uploadPending).toHaveBeenCalledWith(true);
  });
});
