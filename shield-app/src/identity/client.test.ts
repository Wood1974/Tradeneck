import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The client keeps its token in module state, so each test loads a fresh copy.
async function load() {
  vi.resetModules();
  return import("./client");
}

function reply(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("sign in to the standalone Shield server", () => {
  it("posts the email and password to the Shield login route and keeps the token in memory", async () => {
    const { identityApi, API_BASE } = await load();
    const fetchMock = reply(200, { access_token: "tok", token_type: "bearer", account_id: "a1", role: "capturer" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/shield/auth/login`);
    expect(API_BASE).toBe("https://tradedeck-shield.onrender.com");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.test", password: "correct-horse-battery" });
    expect(identityApi().signedIn()).toBe(true);
  });

  it("never talks to Supabase or the marketplace server", async () => {
    const { identityApi } = await load();
    const fetchMock = reply(200, { access_token: "tok" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    await identityApi().status().catch(() => undefined);
    for (const [url] of fetchMock.mock.calls as unknown as Array<[string]>) {
      expect(url).not.toMatch(/supabase|tradedeck-api/);
    }
  });

  it("reads a wrong password as bad credentials", async () => {
    const { identityApi } = await load();
    reply(401, { detail: "invalid_credentials" });
    await expect(identityApi().signIn("a@b.test", "wrong")).rejects.toMatchObject({ code: "bad-credentials" });
    expect(identityApi().signedIn()).toBe(false);
  });

  it("reads the server's rate limit and a lost connection as such", async () => {
    const { identityApi } = await load();
    reply(429, { detail: "rate_limit_exceeded" });
    await expect(identityApi().signIn("a@b.test", "x")).rejects.toMatchObject({ code: "rate-limited" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(identityApi().signIn("a@b.test", "x")).rejects.toMatchObject({ code: "network" });
  });

  it("treats a reply with no token as bad credentials", async () => {
    const { identityApi } = await load();
    reply(200, {});
    await expect(identityApi().signIn("a@b.test", "x")).rejects.toMatchObject({ code: "bad-credentials" });
  });
});

describe("calls that need a sign-in", () => {
  it("refuses before sending anything when signed out", async () => {
    const { identityApi } = await load();
    const fetchMock = reply(200, {});
    await expect(identityApi().start()).rejects.toMatchObject({ code: "not-signed-in" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token, and reads { error } from the identity routes", async () => {
    const { identityApi } = await load();
    reply(200, { access_token: "tok" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    const fetchMock = reply(409, { error: "id-check-not-verified", status: "requires_input" });
    await expect(identityApi().status()).rejects.toMatchObject({ code: "id-check-not-verified" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("drops the sign-in when the server says it has ended, so sign-on starts again", async () => {
    const { identityApi } = await load();
    reply(200, { access_token: "tok" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    expect(identityApi().signedIn()).toBe(true);
    reply(401, { detail: "invalid_access_token" });
    await expect(identityApi().status()).rejects.toMatchObject({ code: "session-expired" });
    expect(identityApi().signedIn()).toBe(false);
  });
});

describe("Apple device check routes", () => {
  it("sends form fields with the bearer token, the way the Shield server reads them", async () => {
    const { identityApi, API_BASE } = await load();
    const login = reply(200, { access_token: "tok" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    login.mockClear();
    const fetchMock = reply(200, { nonce: "n-1", expires_at: 1 });
    expect(await identityApi().attestChallenge()).toMatchObject({ nonce: "n-1" });
    let [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/shield/attest/challenge`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");

    fetchMock.mockClear();
    reply(200, { trusted: true, status: "attested", environment: "production" });
    const reg = vi.mocked(fetch);
    await identityApi().attestRegister({ keyId: "k=", nonce: "n-1", attestation: "A+B/c==" });
    [url, init] = reg.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/shield/attest`);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({ key_id: "k=", nonce: "n-1", attestation: "A+B/c==" });
  });

  it("surfaces the server's reason when it rejects Apple's proof", async () => {
    const { identityApi } = await load();
    reply(200, { access_token: "tok" });
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    reply(422, { detail: "app_id_hash_mismatch" });
    await expect(identityApi().attestRegister({ keyId: "k", nonce: "n", attestation: "a" })).rejects.toMatchObject({ code: "app_id_hash_mismatch" });
  });

  it("refuses to call while signed out", async () => {
    const { identityApi } = await load();
    await expect(identityApi().attestChallenge()).rejects.toMatchObject({ code: "not-signed-in" });
  });
});

describe("storing a photo", () => {
  const upload = { record: { record_hash: "h" }, signature_der_b64: "sig", public_key_uncompressed_b64: "pk", photo_b64: btoa("\xff\xd8\xff\xe0abc"), app_attest_key_id: "k", app_attest_assertion_b64: null };

  async function signedIn(fetchMock: ReturnType<typeof vi.fn>) {
    const { identityApi } = await load();
    vi.stubGlobal("fetch", fetchMock);
    await identityApi().signIn("a@b.test", "correct-horse-battery");
    return { api: identityApi(), api_base: (await import("./client")).API_BASE };
  }

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends the photo as raw bytes in a form, with the rest as JSON, and no Content-Type of its own", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { access_token: "tok" })).mockResolvedValueOnce(json(200, { already: false }));
    const { api, api_base } = await signedIn(fetchMock);
    await api.uploadCapture(upload);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`${api_base}/shield/captures/upload`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    const form = init.body as FormData;
    expect(JSON.parse(form.get("meta") as string)).toEqual({ record: { record_hash: "h" }, signature_der_b64: "sig", public_key_uncompressed_b64: "pk", app_attest_key_id: "k", app_attest_assertion_b64: null });
    const file = form.get("photo") as File;
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x61, 0x62, 0x63]);
  });

  it("falls back to the JSON route on a server that has no multipart route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { access_token: "tok" })).mockResolvedValueOnce(json(404, { detail: "Not Found" })).mockResolvedValueOnce(json(200, { already: false }));
    const { api, api_base } = await signedIn(fetchMock);
    await expect(api.uploadCapture(upload)).resolves.toMatchObject({ already: false });
    const [url, init] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe(`${api_base}/shield/captures`);
    expect(JSON.parse(init.body as string).photo_b64).toBe(upload.photo_b64);
  });

  it("does not fall back on the server's real refusals", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { access_token: "tok" })).mockResolvedValueOnce(json(422, { detail: "photo_hash_mismatch" }));
    const { api } = await signedIn(fetchMock);
    await expect(api.uploadCapture(upload)).rejects.toMatchObject({ code: "photo_hash_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("calls base64 that cannot be decoded an invalid photo, without sending anything", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { access_token: "tok" }));
    const { api } = await signedIn(fetchMock);
    await expect(api.uploadCapture({ ...upload, photo_b64: "***" })).rejects.toMatchObject({ code: "photo_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops the sign-in when the server says it has ended", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { access_token: "tok" })).mockResolvedValueOnce(json(401, { detail: "invalid_access_token" }));
    const { api } = await signedIn(fetchMock);
    await expect(api.uploadCapture(upload)).rejects.toMatchObject({ code: "session-expired" });
    expect(api.signedIn()).toBe(false);
  });
});
