import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The client keeps its token in module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("the account's enrolled phones", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("lists them with the bearer token, and withdraws one by POST (the web view may only send GET and POST)", async () => {
    const { identityApi, API_BASE } = await load();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: "tok" }))
      .mockResolvedValueOnce(json(200, { devices: [{ id: "k", environment: "production", enrolled_at: "2026-10-01T10:00:00Z", photos: 2, revoked_at: null }] }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    expect(await identityApi().listPhones()).toEqual([{ id: "k", environment: "production", enrolled_at: "2026-10-01T10:00:00Z", photos: 2, revoked_at: null }]);
    await identityApi().revokePhone("a/b+c=");
    const [listUrl, listInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(listUrl).toBe(`${API_BASE}/shield/devices`);
    expect((listInit.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const [url, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/shield/devices/revoke`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ id: "a/b+c=" });
  });
});

describe("signing out", () => {
  it("drops the token, so the next call is refused before anything is sent", async () => {
    const { identityApi } = await load();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "tok" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    expect(identityApi().signedIn()).toBe(true);
    identityApi().signOut();
    expect(identityApi().signedIn()).toBe(false);
    await expect(identityApi().listPhones()).rejects.toMatchObject({ code: "not-signed-in" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("is harmless when nobody is signed in", async () => {
    const { identityApi } = await load();
    identityApi().signOut();
    expect(identityApi().signedIn()).toBe(false);
  });
});
