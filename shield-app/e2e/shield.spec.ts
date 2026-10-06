import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const DESCRIPTION =
  "Tear off the existing asphalt shingle roof on the south slope of 872 High Country Ln, replace the felt underlayment " +
  "and step flashing, install 30-year architectural shingles with a new ridge cap, and haul away all debris. " +
  "Gutters and fascia are not included. The job is finished when the new roof passes the city inspection.";

// Shield hashes bytes and never decodes them, so any payload works as a "photo".
const PHOTO = { name: "site.jpg", mimeType: "image/jpeg", buffer: Buffer.from("e2e-photo-bytes") };

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

async function sealPointWithCamera(page: Page, index: number): Promise<void> {
  await page.locator("[data-slot]").nth(index).click();
  await expect(page.locator("#cam")).toBeVisible();
  await page.waitForFunction(() => (document.getElementById("cam") as HTMLVideoElement).videoWidth > 0);
  await page.click('[data-act="shutter"]');
  await expect(page.locator(".thumb")).toBeVisible();
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
  await lockBrief(page);
  await expect(page.locator("[data-slot]").first()).toHaveText("SEAL");

  await sealPointWithCamera(page, 0);
  await page.click('[data-tab="construction"]');
  await page.click('[data-cview="points"]');
  await expect(page.locator(".point .chip").first()).toHaveText("WEB CAMERA");
  await expect(page.locator("[data-pt-label]").first()).toBeDisabled();

  const text = await freeze(page);
  const packet = JSON.parse(text);
  expect(packet.counts).toMatchObject({ points: 5, sealed: 1, missing: 4, web: 1, native: 0, arrival: 0 });
  expect(packet.integrity.hash).toMatch(/^[0-9a-f]{64}$/);

  await verifyFile(page, text);
  await expect(page.locator(".card h2", { hasText: "Record consistent" })).toBeVisible();
  await expect(page.locator(".card .chip", { hasText: "PACKET-SEALED" })).toBeVisible();
  await expect(page.locator(".foot-note", { hasText: "does not show who holds the key" })).toBeVisible();
});

test("an edited packet is reported as altered", async ({ page }) => {
  await lockBrief(page);
  const packet = JSON.parse(await freeze(page));
  packet.notes = "edited after signing";
  await verifyFile(page, JSON.stringify(packet));
  await expect(page.locator(".card .chip", { hasText: "PACKET-TAMPERED" })).toBeVisible();
  await expect(page.locator("pre", { hasText: "hash-mismatch" })).toBeVisible();
});

test("pinning the wrong signer fails an otherwise valid packet", async ({ page }) => {
  await lockBrief(page);
  const text = await freeze(page);
  await page.click('[data-tab="verify"]');
  await page.fill("#expected-signer", "DEADBEEF·DEADBEEF");
  await page.setInputFiles("#file-bundle", { name: "r.shield-record.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect(page.locator("pre", { hasText: "signer-not-expected" })).toBeVisible();
});

test("a double tap on the shutter seals exactly one photo", async ({ page }) => {
  await lockBrief(page);
  await page.locator("[data-slot]").first().click();
  await page.waitForFunction(() => (document.getElementById("cam") as HTMLVideoElement)?.videoWidth > 0);
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-act="shutter"]')!;
    b.click();
    b.click();
  });
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-act="vault-back"]');
  await expect(page.locator("[data-open]")).toHaveCount(1);
});

test("arrival-hash seal rehashes clean and survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.click('[data-act="arrival"]');
  await page.setInputFiles("#file-arrival", PHOTO);
  await expect(page.locator(".foot-note", { hasText: "ARRIVAL-ONLY" })).toBeVisible();
  await page.click('[data-act="rehash"]');
  await expect(page.locator(".foot-note", { hasText: "record-signature-valid" })).toBeVisible();

  await page.reload();
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(1);
});

test("the whole workflow makes no network requests once loaded", async ({ page, context }) => {
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
  await page.click('[data-act="arrival"]');
  await page.setInputFiles("#file-arrival", PHOTO);
  await expect(page.locator(".thumb")).toBeVisible();

  expect(requests.filter((u) => !u.startsWith("blob:") && !u.startsWith("data:"))).toEqual([]);
});
