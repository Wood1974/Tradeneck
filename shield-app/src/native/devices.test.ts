import { describe, expect, it } from "vitest";
import { IdentityError, type PhoneKey } from "../identity/client";
import { canWithdraw, describePhone, phonesMessage } from "./devices";

const phone = (over: Partial<PhoneKey> = {}): PhoneKey => ({ id: "k1", environment: "production", enrolled_at: "2026-10-01T10:00:00Z", photos: 3, revoked_at: null, ...over });

describe("describing a phone", () => {
  it("says which one is this phone, when it was enrolled and how many photos it signed for", () => {
    expect(describePhone(phone(), "k1")).toBe("this phone · enrolled 2026-10-01 · 3 photos");
    expect(describePhone(phone({ photos: 1 }), "other")).toBe("another phone or an earlier install · enrolled 2026-10-01 · 1 photo");
  });
  it("says when one was withdrawn", () => {
    expect(describePhone(phone({ revoked_at: "2026-10-20T09:00:00Z" }), null)).toContain("withdrawn 2026-10-20");
  });
});

describe("what can be withdrawn here", () => {
  it("not the key this phone uses now, and not one already withdrawn", () => {
    expect(canWithdraw(phone(), "k1")).toBe(false);
    expect(canWithdraw(phone(), "other")).toBe(true);
    expect(canWithdraw(phone(), null)).toBe(true);
    expect(canWithdraw(phone({ revoked_at: "2026-10-20T09:00:00Z" }), "other")).toBe(false);
  });
});

describe("messages", () => {
  it("says the common failures in words, never a raw code", () => {
    expect(phonesMessage(new IdentityError("network"))).toBe("No connection. Try again with signal.");
    expect(phonesMessage(new IdentityError("session-expired"))).toBe("Sign in again, then try again.");
    expect(phonesMessage(new IdentityError("not_found"))).toBe("The server no longer has that phone.");
    expect(phonesMessage(new IdentityError("rate_limit_exceeded"))).toBe("Too many requests. Wait a minute and try again.");
    expect(phonesMessage(new IdentityError("Not Found"))).toBe("The Shield server has not been updated for this yet.");
  });
  it("names an unknown code and says nothing for a plain error", () => {
    expect(phonesMessage(new IdentityError("odd"))).toBe("Could not do that (odd).");
    expect(phonesMessage(new Error("x"))).toBe("Could not do that.");
  });
});
