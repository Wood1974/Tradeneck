import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const DESCRIPTION =
  "Tear off the existing asphalt shingle roof on the south slope of 872 High Country Ln, replace the felt underlayment " +
  "and step flashing, install 30-year architectural shingles with a new ridge cap, and haul away all debris. " +
  "Gutters and fascia are not included. The job is finished when the new roof passes the city inspection.";

type TestWindow = Window & { __shieldCalls: string[]; __shieldE2ECamera: (d: string) => Promise<{ base64String: string; format: string }> };

// A browser cannot drive the OS camera, so these tests run the native code path against an "e2e" build
// where the camera call is replaced by a stand-in. Everything after the camera (hash, chain, sign, store,
// freeze, verify) is the real code.
async function asNativeApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as TestWindow & { Capacitor: unknown };
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    w.__shieldCalls = [];
    w.__shieldE2ECamera = async (direction: string) => {
      w.__shieldCalls.push(direction);
      await new Promise((r) => setTimeout(r, 120));
      return { base64String: btoa(`e2e-frame-${Math.random()}`), format: "jpeg" };
    };
  });
}

async function lockBrief(page: Page): Promise<void> {
  await page.goto("/");
  await page.click('[data-tab="construction"]');
  await page.fill("#c-title", "Reroof 872 High Country Ln");
  await page.fill("#c-desc", DESCRIPTION);
  await page.selectOption("#c-budget", "under15");
  await expect(page.locator('[data-act="c-next"]')).toContainText("LOCK BRIEF & GENERATE 5 POINTS");
  await page.click('[data-act="c-next"]');
  await expect(page.locator("[data-slot]")).toHaveCount(5);
}

async function freeze(page: Page): Promise<string> {
  await page.click('[data-tab="construction"]');
  await page.click('[data-cview="close"]');
  await page.check("#c-allow-missing");
  await page.fill("#c-close-notes", "e2e close");
  page.once("dialog", (d) => void d.accept());
  const [download] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="c-freeze"]')]);
  return readFileSync((await download.path())!, "utf8");
}

async function verifyFile(page: Page, text: string): Promise<void> {
  await page.click('[data-tab="verify"]');
  await page.setInputFiles("#file-bundle", { name: "record.shield-record.json", mimeType: "application/json", buffer: Buffer.from(text) });
}

test("brief to sealed point to frozen record to verified packet", async ({ page }) => {
  await asNativeApp(page);
  await lockBrief(page);
  await expect(page.locator("[data-slot]").first()).toHaveText("SEAL");

  await page.locator("[data-slot]").first().click();
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-tab="construction"]');
  await page.click('[data-cview="points"]');
  await expect(page.locator(".point .chip").first()).toHaveText("NATIVE · NO ATTEST");
  await expect(page.locator("[data-pt-label]").first()).toBeDisabled();

  const text = await freeze(page);
  const packet = JSON.parse(text);
  expect(packet.counts).toMatchObject({ points: 5, sealed: 1, missing: 4 });
  expect(packet.integrity.hash).toMatch(/^[0-9a-f]{64}$/);

  await verifyFile(page, text);
  await expect(page.locator(".card h2", { hasText: "Record consistent" })).toBeVisible();
  await expect(page.locator(".card .chip", { hasText: "PACKET-SEALED" })).toBeVisible();
  await expect(page.locator(".foot-note", { hasText: "does not show who holds the key" })).toBeVisible();
});

test("an edited packet is reported as altered", async ({ page }) => {
  await asNativeApp(page);
  await lockBrief(page);
  const packet = JSON.parse(await freeze(page));
  packet.notes = "edited after signing";
  await verifyFile(page, JSON.stringify(packet));
  await expect(page.locator(".card .chip", { hasText: "PACKET-TAMPERED" })).toBeVisible();
  await expect(page.locator("pre", { hasText: "hash-mismatch" })).toBeVisible();
});

test("pinning the wrong signer fails an otherwise valid packet", async ({ page }) => {
  await asNativeApp(page);
  await lockBrief(page);
  const text = await freeze(page);
  await page.click('[data-tab="verify"]');
  await page.fill("#expected-signer", "DEADBEEF·DEADBEEF");
  await page.setInputFiles("#file-bundle", { name: "r.shield-record.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("pre", { hasText: "signer-not-expected" })).toBeVisible();
});

test("a double tap on SEAL FRAME takes and seals exactly one photo", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.locator('[data-act="native"]').waitFor();
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-act="native"]')!;
    b.click();
    b.click();
  });
  await expect(page.locator(".thumb")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__shieldCalls.length)).toBe(1);
  await page.click('[data-act="vault-back"]');
  await expect(page.locator("[data-open]")).toHaveCount(1);
});

test("a sealed photo rehashes clean and survives a reload", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-act="rehash"]');
  await expect(page.locator(".foot-note", { hasText: "record-signature-valid" })).toBeVisible();

  await page.reload();
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(1);
});

test("back camera is the default and the front camera can be chosen", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-tab="capture"]');
  await page.click('[data-act="cam-flip"]');
  await expect(page.locator('[data-act="cam-flip"]')).toHaveText("USE BACK CAMERA");
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__shieldCalls)).toEqual(["back", "front"]);
});

test("a denied camera seals nothing", async ({ page }) => {
  await asNativeApp(page);
  await page.addInitScript(() => {
    (window as unknown as TestWindow).__shieldE2ECamera = async () => {
      throw new Error("User denied camera permission");
    };
  });
  await page.goto("/");
  await page.click('[data-act="native"]');
  await expect(page.locator(".foot-note", { hasText: "Camera access is off" })).toBeVisible();
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(0);
});

test("a browser cannot capture: no camera, gallery or file path exists", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1", { hasText: "Capture needs the app" })).toBeVisible();
  for (const sel of ['[data-act="native"]', '[data-act="webcam"]', '[data-act="arrival"]', '[data-act="shutter"]', "#file-arrival", "video"]) {
    await expect(page.locator(sel)).toHaveCount(0);
  }
  // The only file input is the Verify tab's record importer, which cannot create a seal.
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.locator("#file-bundle")).toHaveCount(1);

  let chooser = false;
  page.on("filechooser", () => (chooser = true));
  await lockBrief(page);
  await page.locator("[data-slot]").first().click();
  await expect(page.locator(".foot-note", { hasText: "only be taken in the Shield iOS or Android app" })).toBeVisible();
  expect(chooser).toBe(false);
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(0);
});

test("the whole workflow makes no network requests once loaded", async ({ page, context }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.click('[data-tab="construction"]');
  await page.fill("#c-title", "Offline job");
  await page.fill("#c-desc", DESCRIPTION);
  await page.click('[data-act="c-next"]');
  await expect(page.locator("[data-slot]")).toHaveCount(5);
  await page.click('[data-tab="capture"]');
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();

  expect(requests.filter((u) => !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
});
