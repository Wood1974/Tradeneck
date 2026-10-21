import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const DESCRIPTION =
  "Tear off the existing asphalt shingle roof on the south slope of 872 High Country Ln, replace the felt underlayment " +
  "and step flashing, install 30-year architectural shingles with a new ridge cap, and haul away all debris. " +
  "Gutters and fascia are not included. The job is finished when the new roof passes the city inspection.";

type TestWindow = Window & {
  __shieldCalls: string[];
  __opened: string[];
  __idCalls: string[];
  __shieldE2ECamera: (d: string) => Promise<{ base64String: string; format: string }>;
  __shieldE2EIdentity: { _status: string };
};

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
    // Stand-in for the Shield server and Stripe Identity. The phone side (consent, statement, signing with the
    // device key, storing, gating) is real; only the server's answers are scripted.
    w.__opened = [];
    w.__idCalls = [];
    window.open = ((url: string) => {
      w.__opened.push(String(url));
      return null;
    }) as typeof window.open;
    const canon = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
    w.__shieldE2EIdentity = {
      _status: "none",
      signedIn() {
        return (this as unknown as { _in?: boolean })._in === true;
      },
      async signIn(_email: string, pass: string) {
        w.__idCalls.push("signIn");
        if (pass !== "correct-horse") throw { code: "bad-credentials" };
        (this as unknown as { _in: boolean })._in = true;
      },
      async signUp(email: string, _pass: string, invite: string) {
        w.__idCalls.push("signUp:" + email);
        if (invite.replace(/[^A-Za-z0-9]/g, "").toUpperCase() !== "ABCDEFGHJKMN") throw { code: "invalid_or_expired_invite" };
        if (email === "taken@example.test") throw { code: "account_already_exists" };
      },
      async requestReset(email: string) {
        w.__idCalls.push("requestReset:" + email);
      },
      async confirmReset(email: string, code: string, password: string) {
        w.__idCalls.push("confirmReset:" + email);
        if (code !== "12345678") throw { code: "invalid_or_expired_code" };
        if (password.length < 12) throw { code: "password_length_invalid" };
      },
      async start() {
        w.__idCalls.push("start");
        this._status = "requires_input";
        return { sessionId: "vs_e2e", status: "requires_input", url: "https://verify.example.test/s/vs_e2e" };
      },
      async status() {
        return { sessionId: "vs_e2e", status: this._status, verified: this._status === "verified" };
      },
      async submitNote(note: { payload: Record<string, unknown> }) {
        w.__idCalls.push("submitNote");
        if (this._status !== "verified") throw { code: "id-check-not-verified" };
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon(note.payload)));
        const noteSha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
        const attestationId = "55555555-5555-4555-8555-555555555555";
        // Shaped like the service's receipt but signed with nothing: no key is pinned in a test build, so the
        // phone must report it as unconfirmed rather than confirmed.
        const receipt = {
          payload: {
            kind: "tradedeck.shield.idreceipt", v: 1, attestationId, noteSha256, deviceSealId: note.payload.deviceSealId,
            sessionSha256: "9".repeat(64), idCheck: { provider: "stripe-identity", status: "verified" },
            issuedAt: new Date().toISOString(), kid: "e2e-unpinned",
            ...((this as unknown as { _test?: boolean })._test ? { testMode: true } : {}),
          },
          signature: "AAAA",
        };
        return { attestationId, noteSha256, receipt };
      },
    } as unknown as TestWindow["__shieldE2EIdentity"];
  });
}

// Sign-on exactly as a person would do it: sign in, consent, ID check, sign the statement.
async function completeSignOn(page: Page): Promise<void> {
  await page.fill("#id-email", "pro@example.test");
  await page.fill("#id-pass", "correct-horse");
  await page.click('[data-act="id-signin"]');
  await page.check("#id-consent-bio");
  await page.check("#id-consent-stmt");
  await page.click('[data-act="id-start"]');
  await expect(page.locator('[data-act="id-check"]')).toBeVisible();
  await page.evaluate(() => ((window as unknown as TestWindow).__shieldE2EIdentity._status = "verified"));
  await page.click('[data-act="id-check"]');
  await page.click('[data-act="id-sign"]');
  await expect(page.locator('[data-act="native"]')).toBeVisible();
}

async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  if (await page.evaluate(() => "Capacitor" in window)) {
    await expect(page.locator("#id-h")).toBeVisible();
    await completeSignOn(page);
  }
}

async function lockBrief(page: Page): Promise<void> {
  await openApp(page);
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
  expect(packet.photographer.attestationId).toBe("55555555-5555-4555-8555-555555555555");
  expect(packet.photographer.receipt.payload.idCheck).toEqual({ provider: "stripe-identity", status: "verified" });
  expect(packet.photographer.note.payload.statement).toContain("I took each one myself");
  expect(packet.points[0].record.attestationId).toBe(packet.photographer.attestationId);

  await verifyFile(page, text);
  await expect(page.locator("pre", { hasText: "photographer-note-valid" })).toBeVisible();
  await expect(page.locator("pre", { hasText: "id-receipt-signer-unknown" })).toBeVisible();
  await expect(page.locator("pre", { hasText: "confirmed-by-service" })).toHaveCount(0);
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
  await openApp(page);
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
  await openApp(page);
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
  await openApp(page);
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-tab="capture"]');
  await page.click('[data-act="cam-flip"]');
  await expect(page.locator('[data-act="cam-flip"]')).toHaveText("USE BACK CAMERA");
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__shieldCalls)).toEqual(["back", "front"]);
});

test("a one-tap camera button is on every tab and seals without leaving the tab", async ({ page }) => {
  await asNativeApp(page);
  await openApp(page);
  for (const tab of ["capture", "jobs", "vault", "verify", "construction"]) {
    await page.click(`[data-tab="${tab}"]`);
    await expect(page.locator('[data-act="quick-capture"]')).toBeVisible();
  }
  await page.click('[data-tab="jobs"]');
  await page.click('[data-act="quick-capture"]');
  await expect(page.locator(".toast")).toContainText("Sealed");
  await expect(page.locator('[data-tab="jobs"]')).toHaveClass(/on/);
  await expect(page.locator(".thumb")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__shieldCalls)).toEqual(["back"]);

  await page.click('[data-act="toast-view"]');
  await expect(page.locator(".thumb")).toBeVisible();
});

test("a double tap on the one-tap camera button seals exactly one photo", async ({ page }) => {
  await asNativeApp(page);
  await openApp(page);
  await page.click('[data-tab="verify"]');
  await page.locator('[data-act="quick-capture"]').waitFor();
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-act="quick-capture"]')!;
    b.click();
    b.click();
  });
  await expect(page.locator(".toast")).toContainText("Sealed");
  expect(await page.evaluate(() => (window as unknown as TestWindow).__shieldCalls.length)).toBe(1);
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(1);
});

test("a denied camera seals nothing", async ({ page }) => {
  await asNativeApp(page);
  await page.addInitScript(() => {
    (window as unknown as TestWindow).__shieldE2ECamera = async () => {
      throw new Error("User denied camera permission");
    };
  });
  await openApp(page);
  await page.click('[data-act="native"]');
  await expect(page.locator(".foot-note", { hasText: "Camera access is off" })).toBeVisible();
  await page.click('[data-tab="vault"]');
  await expect(page.locator("[data-open]")).toHaveCount(0);
});

test("a browser cannot capture: no camera, gallery or file path exists", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("h1", { hasText: "Capture needs the app" })).toBeVisible();
  for (const sel of ['[data-act="native"]', '[data-act="quick-capture"]', '[data-act="webcam"]', '[data-act="arrival"]', '[data-act="shutter"]', "#file-arrival", "video"]) {
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
  await openApp(page);
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

test("an unverified phone cannot seal: sign-on comes first, step by step", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await expect(page.locator("#id-h")).toBeVisible();
  await expect(page.locator("#id-notice")).toContainText("once, while you have signal, before you head to the job");
  for (const sel of ['[data-act="native"]', '[data-act="quick-capture"]', "[data-slot]"]) await expect(page.locator(sel)).toHaveCount(0);

  // Checking other people's records needs no sign-on.
  await page.click('[data-tab="verify"]');
  await expect(page.locator("#expected-signer")).toBeVisible();
  await page.click('[data-tab="capture"]');

  await page.fill("#id-email", "pro@example.test");
  await page.fill("#id-pass", "wrong");
  await page.click('[data-act="id-signin"]');
  await expect(page.locator(".foot-note", { hasText: "not accepted" })).toBeVisible();
  // A wrong password keeps what was typed, and SHOW lets the person see it to fix it.
  await expect(page.locator("#id-email")).toHaveValue("pro@example.test");
  await expect(page.locator("#id-pass")).toHaveValue("wrong");
  await expect(page.locator("#id-pass")).toHaveAttribute("type", "password");
  await page.click('[data-pw-toggle="id-pass"]');
  await expect(page.locator("#id-pass")).toHaveAttribute("type", "text");
  await expect(page.locator("#id-pass")).toHaveValue("wrong");
  await page.click('[data-pw-toggle="id-pass"]');
  await expect(page.locator("#id-pass")).toHaveAttribute("type", "password");
  await page.fill("#id-pass", "correct-horse");
  await page.click('[data-act="id-signin"]');

  // No consent, no ID check.
  await page.click('[data-act="id-start"]');
  await expect(page.locator(".foot-note", { hasText: "Both boxes" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__idCalls)).not.toContain("start");

  await page.check("#id-consent-bio");
  await page.check("#id-consent-stmt");
  await page.click('[data-act="id-start"]');
  await expect(page.locator('[data-act="id-check"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as TestWindow).__opened)).toEqual(["https://verify.example.test/s/vs_e2e"]);

  // The check has not passed, so there is nothing to sign yet.
  await page.click('[data-act="id-check"]');
  await expect(page.locator(".foot-note", { hasText: "Not verified yet" })).toBeVisible();
  await expect(page.locator('[data-act="id-sign"]')).toHaveCount(0);
  await expect(page.locator('[data-act="native"]')).toHaveCount(0);

  await page.evaluate(() => ((window as unknown as TestWindow).__shieldE2EIdentity._status = "verified"));
  await page.click('[data-act="id-check"]');
  await expect(page.locator(".statement")).toContainText("I took each one myself");
  await page.click('[data-act="id-sign"]');
  await expect(page.locator('[data-act="native"]')).toBeVisible();
  await expect(page.locator(".ready")).toContainText("Signal.");
  await expect(page.locator(".ready")).not.toContainText("No signal");
  await expect(page.locator(".chip", { hasText: "SIGNED NOTE ON FILE" })).toBeVisible();

  // The signed note survives a restart, and the first photo it allows is bound to it.
  await page.reload();
  await expect(page.locator('[data-act="native"]')).toBeVisible();
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-act="export"]');
});

test("a forgotten password is reset with an emailed code, from the sign-on screen", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.fill("#id-email", "pro@example.test");
  await page.click('[data-act="rs-open"]');
  await expect(page.locator("#rs-email")).toHaveValue("pro@example.test");
  await page.click('[data-act="rs-send"]');
  await expect(page.locator('[data-act="rs-confirm"]')).toBeVisible();
  // A wrong code says so in place and keeps what was typed.
  await page.fill("#rs-code", "00000000");
  await page.fill("#rs-new", "a-long-new-password");
  await page.fill("#rs-new2", "a-long-new-password");
  await page.click('[data-act="rs-confirm"]');
  await expect(page.locator("[data-reset-status]")).toContainText("wrong or has expired");
  await expect(page.locator("#rs-new")).toHaveValue("a-long-new-password");
  await page.fill("#rs-code", "1234 5678");
  await page.click('[data-act="rs-confirm"]');
  await expect(page.locator(".fine", { hasText: "Password changed" })).toBeVisible();
  // Back on the sign-in screen, with the notice shown.
  await expect(page.locator('[data-act="id-signin"]')).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as TestWindow).__idCalls);
  expect(calls).toEqual(["requestReset:pro@example.test", "confirmReset:pro@example.test", "confirmReset:pro@example.test"]);
});

test("an invite code makes an account and signs in, and a mistake keeps what was typed", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.click('[data-act="su-open"]');
  await page.fill("#su-invite", "WRONG-CODE-0000");
  await page.fill("#su-email", "new@example.test");
  await page.fill("#su-pass", "correct-horse");
  await page.fill("#su-pass2", "correct-horsX");
  // Checked on the phone first: nothing is sent for a form that cannot be right.
  await page.click('[data-act="su-create"]');
  await expect(page.locator("[data-su-status]")).toContainText("do not match");
  await page.fill("#su-pass2", "correct-horse");
  await page.click('[data-act="su-create"]');
  await expect(page.locator("[data-su-status]")).toContainText("wrong, already used, or has expired");
  // Everything typed is still there to fix, and SHOW reveals the password.
  await expect(page.locator("#su-email")).toHaveValue("new@example.test");
  await expect(page.locator("#su-pass")).toHaveValue("correct-horse");
  await page.click('[data-pw-toggle="su-pass"]');
  await expect(page.locator("#su-pass")).toHaveAttribute("type", "text");
  await page.fill("#su-invite", "abcd efgh-jkmn");
  await page.click('[data-act="su-create"]');
  // The new account is signed in and goes straight to the ID check.
  await expect(page.locator('[data-act="id-start"]')).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as TestWindow).__idCalls);
  expect(calls).toEqual(["signUp:new@example.test", "signUp:new@example.test", "signIn"]);
});

test("an email that already has an account is told so, and can go back to sign in", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.click('[data-act="su-open"]');
  await page.fill("#su-invite", "ABCD-EFGH-JKMN");
  await page.fill("#su-email", "taken@example.test");
  await page.fill("#su-pass", "correct-horse");
  await page.fill("#su-pass2", "correct-horse");
  await page.click('[data-act="su-create"]');
  await expect(page.locator("[data-su-status]")).toContainText("already has an account");
  await page.click('[data-act="su-close"]');
  await expect(page.locator('[data-act="id-signin"]')).toBeVisible();
});

test("sign-on offers sign-up only with an invite code, and an ended sign-in sends the person back to sign in", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await expect(page.locator('[data-act="id-signin"]')).toBeVisible();
  await expect(page.locator('[data-act="id-mode-create"]')).toHaveCount(0);
  await expect(page.locator('[data-act="id-signup"]')).toHaveCount(0);
  await expect(page.locator("#id-pass2")).toHaveCount(0);
  await expect(page.locator(".fine", { hasText: "invite code from the person who runs Shield" })).toBeVisible();
  // No ID check or sealing is reachable without signing in.
  await expect(page.locator('[data-act="id-start"]')).toHaveCount(0);
  await page.fill("#id-email", "pro@example.test");
  await page.fill("#id-pass", "correct-horse");
  await page.click('[data-act="id-signin"]');
  await expect(page.locator('[data-act="id-start"]')).toBeVisible();
});

test("a test-mode ID check is labelled and never shown as a signed, confirmed note", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.evaluate(() => ((window as unknown as { __shieldE2EIdentity: { _test: boolean } }).__shieldE2EIdentity._test = true));
  await completeSignOn(page);
  await expect(page.locator(".chip", { hasText: "TEST ID CHECK" })).toBeVisible();
  await expect(page.locator(".chip", { hasText: "SIGNED NOTE ON FILE" })).toHaveCount(0);
  // The owner can still try the whole flow: a photo seals, and the record still verifies.
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
});

test("sign-on warns when the phone is offline, and says so again when signal returns", async ({ page, context }) => {
  await asNativeApp(page);
  await page.goto("/");
  await expect(page.locator("#id-notice")).toContainText("once, while you have signal");
  await page.fill("#id-email", "pro@example.test");

  await context.setOffline(true);
  await expect(page.locator("#id-notice")).toContainText("You are offline");
  await expect(page.locator("#id-notice")).toContainText("cannot seal photos until it is done");
  // Updating the notice must not wipe what the person already typed.
  await expect(page.locator("#id-email")).toHaveValue("pro@example.test");
  await expect(page.locator('[data-act="native"]')).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.locator("#id-notice")).toContainText("once, while you have signal");
});

test("a signed-on phone keeps working with the network off from the start of a session", async ({ page, context }) => {
  await asNativeApp(page);
  await openApp(page);
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await expect(page.locator(".ready")).toContainText("No signal. Photos, sealing, closing a job and verifying records still work.");
  await page.click('[data-act="native"]');
  await expect(page.locator(".thumb")).toBeVisible();
  await page.click('[data-act="rehash"]');
  await expect(page.locator(".foot-note", { hasText: "record-signature-valid" })).toBeVisible();
  // Sign-on is not asked for again, and no warning about being offline appears.
  await expect(page.locator("#id-h")).toHaveCount(0);
});

test("an ID check left unfinished can be started over, and consent is asked for again", async ({ page }) => {
  await asNativeApp(page);
  await page.goto("/");
  await page.fill("#id-email", "pro@example.test");
  await page.fill("#id-pass", "correct-horse");
  await page.click('[data-act="id-signin"]');
  await page.check("#id-consent-bio");
  await page.check("#id-consent-stmt");
  await page.click('[data-act="id-start"]');
  await expect(page.locator('[data-act="id-check"]')).toBeVisible();
  await expect(page.locator('[data-act="id-open"]')).toBeVisible();

  await page.click('[data-act="id-restart"]');
  // Back at consent, with the boxes cleared: starting again needs fresh consent.
  await expect(page.locator('[data-act="id-start"]')).toBeVisible();
  await expect(page.locator("#id-consent-bio")).not.toBeChecked();
  await page.click('[data-act="id-start"]');
  await expect(page.locator(".foot-note", { hasText: "Both boxes" })).toBeVisible();
  expect((await page.evaluate(() => (window as unknown as TestWindow).__idCalls)).filter((c: string) => c === "start")).toHaveLength(1);

  await page.check("#id-consent-bio");
  await page.check("#id-consent-stmt");
  await page.click('[data-act="id-start"]');
  await expect(page.locator('[data-act="id-check"]')).toBeVisible();
  expect((await page.evaluate(() => (window as unknown as TestWindow).__idCalls)).filter((c: string) => c === "start")).toHaveLength(2);
});
