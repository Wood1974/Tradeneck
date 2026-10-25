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

  it("says so in words when the server cannot be reached, and keeps the list on screen state clean", async () => {
    vi.mocked(devices.listPhones).mockRejectedValue(new IdentityError("network"));
    await press("open");
    expect(phonesPanelHtml()).toContain("No connection");
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
