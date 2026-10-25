import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../native/share", async (orig) => ({
  ...(await orig<typeof import("../native/share")>()),
  canShare: vi.fn(),
  makeShare: vi.fn(),
  sharesFor: vi.fn(),
  withdrawShare: vi.fn(),
}));

import { IdentityError } from "../identity/client";
import * as share from "../native/share";
import { bindSharePanel, resetShare, sharePanelHtml } from "./share-panel";

const SHA = "a".repeat(64);
const made = { id: "s1", code: "ABCD-EFGH", expires_at: "2026-11-24T10:00:00+00:00" };
const info = (over = {}) => ({ id: "s1", created_at: "2026-10-25T10:00:00+00:00", expires_at: "2026-11-24T10:00:00+00:00", revoked: false, active: true, ...over });

let days = "30";
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Presses one Share button the way the app does: bind it on the screen, then click it. */
async function press(act: string, shareId?: string): Promise<void> {
  let handler: (() => void) | undefined;
  const el = { dataset: { share: act, shareId }, addEventListener: (_t: string, fn: () => void) => (handler = fn) };
  bindSharePanel({ querySelectorAll: () => [el] } as never, SHA, () => undefined);
  handler?.();
  await flush();
  await flush();
}

beforeEach(() => {
  resetShare();
  days = "30";
  vi.stubGlobal("document", { getElementById: () => ({ value: days }) });
  vi.mocked(share.canShare).mockReturnValue(true);
  vi.mocked(share.sharesFor).mockResolvedValue([]);
  vi.mocked(share.makeShare).mockResolvedValue(made);
  vi.mocked(share.withdrawShare).mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("the Share section of a photo", () => {
  it("says to wait when the server does not have the photo, and offers no button", () => {
    vi.mocked(share.canShare).mockReturnValue(false);
    const html = sharePanelHtml(SHA);
    expect(html).toContain("once this photo has reached the server");
    expect(html).not.toContain('data-share="open"');
  });

  it("starts as one SHARE button and shows nothing about codes", () => {
    const html = sharePanelHtml(SHA);
    expect(html).toContain('data-share="open"');
    expect(html).not.toContain("MAKE A CODE");
  });

  it("opens with what a code lets someone do, the lengths on offer and the codes already made", async () => {
    vi.mocked(share.sharesFor).mockResolvedValue([info({ timing: true }), info({ id: "s2", active: false, timing: false, expires_at: "2026-10-01T00:00:00+00:00" })]);
    await press("open");
    const html = sharePanelHtml(SHA);
    expect(html).toContain("MAKE A CODE");
    expect(html).toContain("whether the file matches");
    expect(html).toContain("two timing facts");
    expect(html).toContain("They do not see your name, email, location, other photos, or the details behind the clock check");
    expect(html).toContain("Codes made before this version show only the first three");
    expect(html).toContain("Nothing is sent from this phone");
    for (const d of [7, 30, 90]) expect(html).toContain(`${d} days`);
    expect(html).toContain("works until 2026-11-24");
    expect(html).toContain("shows timing evidence");
    expect(html).toContain("expired 2026-10-01");
    expect(html).toContain("basic answer only");
    expect(html.match(/data-share="withdraw"/g)).toHaveLength(1); // only a working code can be withdrawn
  });

  it("makes a code for the chosen length and shows it once", async () => {
    await press("open");
    days = "90";
    await press("make");
    expect(share.makeShare).toHaveBeenCalledWith(SHA, 90);
    const html = sharePanelHtml(SHA);
    expect(html).toContain("ABCD-EFGH");
    expect(html).toContain("shown once");
    expect(html).toContain('data-share="copy"');
  });

  it("falls back to 30 days if the select holds anything it does not offer", async () => {
    await press("open");
    days = "9999";
    await press("make");
    expect(share.makeShare).toHaveBeenCalledWith(SHA, 30);
  });

  it("never keeps a code once the panel is closed or the photo changes", async () => {
    await press("open");
    await press("make");
    expect(sharePanelHtml(SHA)).toContain("ABCD-EFGH");
    resetShare(); // what opening any other photo does
    expect(sharePanelHtml(SHA)).not.toContain("ABCD-EFGH");
    await press("open");
    expect(sharePanelHtml(SHA)).not.toContain("ABCD-EFGH");
  });

  it("copies only the page, the code and the expiry", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await press("open");
    await press("make");
    await press("copy");
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String((writeText.mock.calls[0] as unknown[])[0]);
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("/check");
    expect(text).not.toContain("s1");
    expect(sharePanelHtml(SHA)).toContain("Copied");
  });

  it("says so plainly when copying is not allowed", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
    await press("open");
    await press("make");
    await press("copy");
    expect(sharePanelHtml(SHA)).toContain("Could not copy");
  });

  it("withdraws a code and says it no longer works", async () => {
    vi.mocked(share.sharesFor).mockResolvedValueOnce([info()]).mockResolvedValueOnce([info({ revoked: true, active: false })]);
    await press("open");
    await press("withdraw", "s1");
    expect(share.withdrawShare).toHaveBeenCalledWith("s1");
    const html = sharePanelHtml(SHA);
    expect(html).toContain("no longer works");
    expect(html).toContain("withdrawn");
  });

  it("turns a failure into plain words and keeps the panel usable", async () => {
    await press("open");
    vi.mocked(share.makeShare).mockRejectedValue(new IdentityError("network"));
    await press("make");
    const html = sharePanelHtml(SHA);
    expect(html).toContain("No connection. Try again with signal.");
    expect(html).not.toContain("ABCD-EFGH");
    expect(html).toContain("MAKE A CODE");
    expect(html).not.toContain("disabled"); // not stuck on WORKING…
  });

  it("closing hides everything", async () => {
    await press("open");
    await press("close");
    expect(sharePanelHtml(SHA)).not.toContain("MAKE A CODE");
  });
});
