import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../identity/client";
import { IdentityError } from "../identity/client";
import * as uploader from "./uploader";
import { DEFAULT_SHARE_DAYS, SHARE_DAYS, ShareError, canShare, describeShare, makeShare, shareCheckUrl, shareMessage, sharesFor, shareText, withdrawShare } from "./share";

const SHA = "a".repeat(64);
const HASH = "b".repeat(64);

function fakeApi() {
  return { createShare: vi.fn(async () => ({ id: "s1", code: "ABCD-EFGH", expires_at: "2026-11-24T10:00:00+00:00" })), listShares: vi.fn(async () => []), revokeShare: vi.fn(async () => undefined) };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

function withServerCopy(has: boolean) {
  vi.spyOn(uploader, "recordHashFor").mockImplementation((sha) => (has && sha === SHA ? HASH : undefined));
}

describe("what a code is for", () => {
  it("lengths offered are 7, 30 and 90 days and the default is one of them", () => {
    expect([...SHARE_DAYS]).toEqual([7, 30, 90]);
    expect(SHARE_DAYS).toContain(DEFAULT_SHARE_DAYS);
  });
  it("only a photo the server holds can be shared", () => {
    withServerCopy(false);
    expect(canShare(SHA)).toBe(false);
    withServerCopy(true);
    expect(canShare(SHA)).toBe(true);
    expect(canShare("c".repeat(64))).toBe(false);
  });
});

describe("making, listing and withdrawing", () => {
  it("makes a code against the server's record hash, not the photo's own hash", async () => {
    withServerCopy(true);
    const api = fakeApi();
    vi.spyOn(client, "identityApi").mockReturnValue(api as never);
    const made = await makeShare(SHA, 30);
    expect(api.createShare).toHaveBeenCalledWith(HASH, 30);
    expect(made.code).toBe("ABCD-EFGH");
  });
  it("refuses a length it does not offer, before any request", async () => {
    withServerCopy(true);
    const api = fakeApi();
    vi.spyOn(client, "identityApi").mockReturnValue(api as never);
    await expect(makeShare(SHA, 365)).rejects.toThrow(ShareError);
    expect(api.createShare).not.toHaveBeenCalled();
  });
  it("makes nothing for a photo the server does not have", async () => {
    withServerCopy(false);
    const api = fakeApi();
    vi.spyOn(client, "identityApi").mockReturnValue(api as never);
    await expect(sharesFor(SHA)).rejects.toThrow(/does not have this photo/);
    await expect(makeShare(SHA, 30)).rejects.toThrow(/does not have this photo/);
    expect(api.createShare).not.toHaveBeenCalled();
    expect(api.listShares).not.toHaveBeenCalled();
  });
  it("lists and withdraws through the client", async () => {
    withServerCopy(true);
    const api = fakeApi();
    vi.spyOn(client, "identityApi").mockReturnValue(api as never);
    await sharesFor(SHA);
    await withdrawShare("s1");
    expect(api.listShares).toHaveBeenCalledWith(HASH);
    expect(api.revokeShare).toHaveBeenCalledWith("s1");
  });
});

describe("words", () => {
  it("describes each state without showing a code", () => {
    const base = { id: "s", created_at: "2026-10-25T10:00:00+00:00", expires_at: "2026-11-24T10:00:00+00:00" };
    expect(describeShare({ ...base, revoked: false, active: true })).toBe("works until 2026-11-24 · made 2026-10-25");
    expect(describeShare({ ...base, revoked: false, active: false })).toBe("expired 2026-11-24 · made 2026-10-25");
    expect(describeShare({ ...base, revoked: true, active: false })).toBe("withdrawn · made 2026-10-25");
    expect(describeShare({ id: "s", created_at: null, expires_at: null, revoked: false, active: true })).toBe("works until — · made —");
  });
  it("says which codes carry timing evidence, and says nothing when an older server does not know", () => {
    const base = { id: "s", created_at: "2026-10-25T10:00:00+00:00", expires_at: "2026-11-24T10:00:00+00:00", revoked: false, active: true };
    expect(describeShare({ ...base, timing: true })).toBe("works until 2026-11-24 · made 2026-10-25 · shows timing evidence");
    expect(describeShare({ ...base, timing: false })).toBe("works until 2026-11-24 · made 2026-10-25 · basic answer only");
    expect(describeShare({ ...base, timing: true, revoked: true, active: false })).toBe("withdrawn · made 2026-10-25 · shows timing evidence");
    expect(describeShare(base)).toBe("works until 2026-11-24 · made 2026-10-25");
  });
  it("puts only the page, the code and the expiry on the clipboard", () => {
    const text = shareText({ id: "secret-id", code: "ABCD-EFGH", expires_at: "2026-11-24T10:00:00+00:00" });
    expect(text).toContain(shareCheckUrl());
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("2026-11-24");
    expect(text).not.toContain("secret-id");
  });
  it("turns errors into plain words, never a raw code", () => {
    expect(shareMessage(new IdentityError("network"))).toMatch(/No connection/);
    expect(shareMessage(new IdentityError("session-expired"))).toMatch(/Sign in again/);
    expect(shareMessage(new IdentityError("not_found"))).toMatch(/does not have this photo/);
    expect(shareMessage(new IdentityError("rate_limit_exceeded"))).toMatch(/Too many/);
    expect(shareMessage(new IdentityError("weird_code"))).toBe("Could not do that (weird_code).");
    expect(shareMessage(new Error("x"))).toBe("Could not do that.");
  });
  it("points at the Shield server's check page", () => {
    expect(shareCheckUrl()).toBe(`${client.API_BASE}/check`);
  });
});
