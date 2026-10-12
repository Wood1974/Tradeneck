import { afterEach, describe, expect, it, vi } from "vitest";
import { identityApi } from "./client";

// signUp talks to Supabase auth. These check the request it makes and how each answer is read.
function reply(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("create account", () => {
  it("posts the email and password to Supabase signup with the public key", async () => {
    const fetchMock = reply(200, { id: "u1", email: "a@b.test" });
    await identityApi().signUp("a@b.test", "correct-horse");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://jlaajejpqjldpbinktln.supabase.co/auth/v1/signup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.test", password: "correct-horse" });
    expect((init.headers as Record<string, string>).apikey).toMatch(/^eyJ/);
  });

  it("stays signed out when the account still needs its email confirmed", async () => {
    reply(200, { id: "u1", email: "a@b.test" });
    expect(await identityApi().signUp("a@b.test", "correct-horse")).toEqual({ signedIn: false });
    expect(identityApi().signedIn()).toBe(false);
  });

  it("maps Supabase error codes to the ones the screen has text for", async () => {
    const cases: Array<[number, string, string]> = [
      [422, "weak_password", "weak-password"],
      [422, "user_already_exists", "account-exists"],
      [422, "email_exists", "account-exists"],
      [422, "email_address_invalid", "bad-email"],
      [429, "over_email_send_rate_limit", "rate-limited"],
      [422, "signup_disabled", "signup-disabled"],
    ];
    for (const [status, error_code, want] of cases) {
      reply(status, { code: status, error_code, msg: "x" });
      await expect(identityApi().signUp("a@b.test", "correct-horse")).rejects.toMatchObject({ code: want });
    }
  });

  it("reports a lost connection as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(identityApi().signUp("a@b.test", "correct-horse")).rejects.toMatchObject({ code: "network" });
  });

  it("signs in when Supabase returns a session (confirmation switched off)", async () => {
    reply(200, { access_token: "tok", user: { id: "u1" } });
    expect(await identityApi().signUp("a@b.test", "correct-horse")).toEqual({ signedIn: true });
    expect(identityApi().signedIn()).toBe(true);
  });
});
