import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../native/devices", async (orig) => ({ ...(await orig<typeof import("../native/devices")>()), listPhones: vi.fn(), withdrawPhone: vi.fn() }));
vi.mock("../native/appattest", () => ({ appAttestState: vi.fn() }));

import { IdentityError, type PhoneKey } from "../identity/client";
import { appAttestState } from "../native/appattest";
import * as devices from "../native/devices";
import { bindPhonesPanel, phonesPanelHtml, resetPhones } from "./devices-panel";

const phone = (over: Partial<PhoneKey> = {}): PhoneKey => ({ id: "k1", environment: "production", enrolled_at: "2026-10-01T10:00:00Z", photos: 2, revoked_at: null, ...over });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function press(act: string, phoneId?: string): Promise<void> {
  let handler: (() => void) | undefined;
  const el = { dataset: { phones: act, phoneId }, addEventListener: (_t: string, fn: () => void) => (handler = fn) };
  bindPhonesPanel({ querySelectorAll: () => [el] } as never, () => undefined);
  handler?.();
  for (let i = 0; i < 4; i++) await flush();
}

beforeEach(() => {
  resetPhones();
  vi.mocked(appAttestState).mockResolvedValue({ state: "enrolled", keyId: "k-this" });
  vi.mocked(devices.listPhones).mockResolvedValue([phone({ id: "k-this" }), phone({ id: "k-old" })]);
  vi.mocked(devices.withdrawPhone).mockResolvedValue(undefined);
});

describe("Your phones", () => {
  it("is a closed button until opened, and lists nothing", () => {
    const html = phonesPanelHtml();
    expect(html).toContain('data-phones="open"');
    expect(html).not.toContain("phones-panel");
  });

  it("opening loads the list and offers WITHDRAW for every phone but this one", async () => {
    await press("open");
    const html = phonesPanelHtml();
    expect(html).toContain("this phone");
    expect((html.match(/data-phones="withdraw"/g) ?? []).length).toBe(1);
    expect(html).toContain('data-phone-id="k-old"');
    expect(html).not.toContain('data-phone-id="k-this"');
  });

  it("says what withdrawing does, and that only the account holder sees the list", async () => {
    await press("open");
    const html = phonesPanelHtml();
    expect(html).toMatch(/Only you see this list/);
    expect(html).toMatch(/cannot be set up again/);
    expect(html).toMatch(/Photos already stored keep the result they had/);
  });

  it("withdraws the chosen phone, then reloads the list", async () => {
    await press("open");
    vi.mocked(devices.listPhones).mockResolvedValue([phone({ id: "k-this" }), phone({ id: "k-old", revoked_at: "2026-10-25T10:00:00Z" })]);
    await press("withdraw", "k-old");
    expect(devices.withdrawPhone).toHaveBeenCalledWith("k-old");
    const html = phonesPanelHtml();
    expect(html).toContain("withdrawn 2026-10-25");
    expect(html).not.toContain('data-phone-id="k-old"');
    expect(html).toContain("Withdrawn.");
  });

  it("when the list cannot be loaded it says why and claims nothing about the account's phones", async () => {
    vi.mocked(devices.listPhones).mockRejectedValue(new IdentityError("network"));
    await press("open");
    const html = phonesPanelHtml();
    expect(html).toContain("No connection");
    expect(html).not.toContain("No phones enrolled");
    expect(html).not.toContain("does not list it");
    expect(html).toContain('data-phones="retry"');
  });

  it("signed out is the same: the sign-in message, never 'no phones enrolled'", async () => {
    vi.mocked(devices.listPhones).mockRejectedValue(new IdentityError("not-signed-in"));
    await press("open");
    const html = phonesPanelHtml();
    expect(html).toContain("Sign in again");
    expect(html).not.toContain("No phones enrolled");
  });

  it("TRY AGAIN loads the list once the problem is gone", async () => {
    vi.mocked(devices.listPhones).mockRejectedValueOnce(new IdentityError("network"));
    await press("open");
    await press("retry");
    const html = phonesPanelHtml();
    expect(html).toContain("this phone");
    expect(html).not.toContain('data-phones="retry"');
  });

  it("an answer with no phones in it says so", async () => {
    vi.mocked(appAttestState).mockResolvedValue({ state: "not-enrolled" });
    vi.mocked(devices.listPhones).mockResolvedValue([]);
    await press("open");
    const html = phonesPanelHtml();
    expect(html).toContain("No phones enrolled for this account.");
    expect(html).not.toContain("does not list it");
  });

  it("when this phone has an Apple key the server does not list, it says the two disagree", async () => {
    vi.mocked(devices.listPhones).mockResolvedValue([phone({ id: "k-old" })]);
    await press("open");
    expect(phonesPanelHtml()).toContain("This phone has an Apple key, but the Shield server does not list it under this account");
  });

  it("no disagreement is reported when the server lists this phone's key", async () => {
    await press("open");
    expect(phonesPanelHtml()).not.toContain("does not list it");
  });

  it("closing forgets the list", async () => {
    await press("open");
    await press("close");
    expect(phonesPanelHtml()).not.toContain("k-old");
    expect(phonesPanelHtml()).toContain('data-phones="open"');
  });

  it("works when this app has no enrolled key (every phone can be withdrawn)", async () => {
    vi.mocked(appAttestState).mockResolvedValue({ state: "not-enrolled" });
    await press("open");
    expect((phonesPanelHtml().match(/data-phones="withdraw"/g) ?? []).length).toBe(2);
  });
});
