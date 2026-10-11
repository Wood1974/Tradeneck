import { esc } from "../esc";
import { getIdSession, putIdSession } from "../store/db";
import { IdentityError, identityApi, type IdStatus } from "../identity/client";
import { NOTE_STATEMENT, noteSha256, signNote, type Attestation } from "../identity/note";
import { checkReceipt } from "../identity/receipt";
import { currentAttestation, saveAttestation } from "../identity/store";

// Sign-on: account sign-in, then an ID check run by Stripe Identity (photo ID plus a live selfie match),
// then a statement signed with this device's key. Nothing can be sealed until all three are done.

let attested: Attestation | null = null;
let sessionId: string | null = null;
let idStatus: IdStatus = "none";
let checkUrl: string | null = null;
let busy = false;
let message = "";
let email = "";
let listening = false;

export const isAttested = (): boolean => attested !== null;
export const attestation = (): Attestation | null => attested;

export async function loadIdentity(): Promise<void> {
  attested = await currentAttestation();
  sessionId = (await getIdSession()) ?? null;
}

type Step = "signin" | "consent" | "waiting" | "sign";

function step(): Step {
  if (!identityApi().signedIn()) return "signin";
  if (idStatus === "verified") return "sign";
  if (sessionId && (idStatus === "requires_input" || idStatus === "processing")) return "waiting";
  return "consent";
}

const ERRORS: Record<string, string> = {
  "bad-credentials": "That email or password was not accepted.",
  network: "Could not reach the service. Sign-on needs a connection. Check it and try again.",
  "not-signed-in": "Sign in first.",
  "consent-required": "Both boxes need to be ticked first.",
  "id-check-unavailable": "The ID check service is unavailable right now. Try again shortly.",
  "id-check-not-verified": "The ID check has not passed yet.",
  "no-id-check": "Start the ID check first.",
  "receipt-missing": "The service did not return a signed receipt. Try again, or contact support.",
  "receipt-invalid": "The service's receipt did not check out, so the note was not saved. Try again.",
  "receipt-key-not-configured": "The service is not ready to issue receipts yet. Try again later.",
  "clock-skew": "This phone's clock is off by more than a few minutes. Fix the date and time, then try again.",
};
const codeOf = (err: unknown): string => (typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "network");
const errorText = (code: string): string => ERRORS[code] ?? `Something went wrong (${code}).`;

const ONLINE_NOTE = "Do this once, while you have signal, before you head to the job. After sign-on Shield works with no signal.";
const OFFLINE_NOTE = "You are offline. Sign-on needs a connection, and Shield cannot seal photos until it is done. Connect, then come back.";

function noticeText(): string {
  return typeof navigator !== "undefined" && navigator.onLine === false ? OFFLINE_NOTE : ONLINE_NOTE;
}

export function identityView(): string {
  const s = step();
  const body: Record<Step, string> = {
    signin: `
      <p class="lede">Shield checks who is taking the photos, once, before it will seal any. Sign in with your TradeDeck account.</p>
      <label for="id-email">Email</label>
      <input id="id-email" type="email" autocomplete="username" value="${esc(email)}" />
      <label for="id-pass">Password</label>
      <input id="id-pass" type="password" autocomplete="current-password" />
      <div class="actions"><button class="btn" data-act="id-signin"${busy ? " disabled" : ""}>SIGN IN</button></div>`,
    consent: `
      <p class="lede">Step 2 of 3: an ID check. Stripe Identity will ask you to photograph a government photo ID and take a live selfie, then check that the face matches the ID.</p>
      <p class="fine">Stripe, not Shield, receives and keeps the ID and selfie images. Shield keeps only the result, your signed statement and the time. No ID or selfie image is stored on this phone or in TradeDeck.</p>
      <label class="check"><input id="id-consent-bio" type="checkbox" /> I agree to Stripe processing my ID and a face scan to check they match.</label>
      <label class="check"><input id="id-consent-stmt" type="checkbox" /> I have read the statement below and will sign it.</label>
      <blockquote class="statement">${esc(NOTE_STATEMENT)}</blockquote>
      <div class="actions"><button class="btn" data-act="id-start"${busy ? " disabled" : ""}>START ID CHECK</button></div>`,
    waiting: `
      <p class="lede">Finish the ID check in the browser window, then come back here.</p>
      <div class="actions">
        ${checkUrl ? `<button class="btn ghost small" data-act="id-open">REOPEN ID CHECK</button>` : ""}
        <button class="btn" data-act="id-check"${busy ? " disabled" : ""}>I FINISHED. CHECK STATUS</button>
      </div>
      <p class="fine">Status: ${esc(idStatus.replace("_", " "))}</p>`,
    sign: `
      <p class="lede">Step 3 of 3: the ID check passed. Sign the statement with this phone.</p>
      <blockquote class="statement">${esc(NOTE_STATEMENT)}</blockquote>
      <div class="actions"><button class="btn" data-act="id-sign"${busy ? " disabled" : ""}>SIGN STATEMENT</button></div>`,
  };
  return `
    <section class="finder signon" aria-labelledby="id-h">
      <div class="finder-top"><span class="chip">SIGN-ON</span><span class="chip">${s === "signin" ? "1" : s === "sign" ? "3" : "2"} OF 3</span></div>
      <h1 id="id-h">Verify the photographer</h1>
      <p class="fine notice" id="id-notice" role="status">${esc(noticeText())}</p>
      ${body[s]}
      <p class="foot-note" role="status">${esc(message)}</p>
    </section>
    <p class="foot-note">A signed note ties photos to a person who passed an ID check. It does not show that what a photo shows is true. You can still verify other people's records without signing on.</p>`;
}

async function refreshStatus(rerender: () => void): Promise<void> {
  if (busy || !sessionId || !identityApi().signedIn()) return;
  busy = true;
  try {
    idStatus = (await identityApi().status()).status;
    message = idStatus === "canceled" ? "That ID check was cancelled. Start again." : "";
    if (idStatus === "canceled") {
      sessionId = null;
      await putIdSession(null);
    }
  } catch (err) {
    message = errorText(codeOf(err));
  } finally {
    busy = false;
    rerender();
  }
}

async function run(rerender: () => void, fn: () => Promise<void>, button: Element | null): Promise<void> {
  if (busy) return;
  busy = true;
  message = "";
  // Disable in place instead of re-rendering, which would wipe what was typed into the form.
  (button as HTMLButtonElement | null)?.setAttribute("disabled", "");
  try {
    await fn();
  } catch (err) {
    message = errorText(codeOf(err));
  } finally {
    busy = false;
    rerender();
  }
}

export function bindIdentity(root: HTMLElement, rerender: () => void): void {
  const emailEl = root.querySelector<HTMLInputElement>("#id-email");
  if (emailEl) emailEl.oninput = () => (email = emailEl.value.trim());
  if (!listening) {
    listening = true;
    // Update the notice in place when the connection changes: a re-render would wipe what was typed.
    const refreshNotice = () => {
      const el = document.getElementById("id-notice");
      if (el) el.textContent = noticeText();
    };
    window.addEventListener("online", refreshNotice);
    window.addEventListener("offline", refreshNotice);
    // Coming back from the browser: check the result without making the person tap anything.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && step() === "waiting") void refreshStatus(rerender);
    });
  }
  const on = (act: string, fn: () => Promise<void>) =>
    root.querySelector(`[data-act="${act}"]`)?.addEventListener("click", (e) => void run(rerender, fn, e.currentTarget as Element));

  on("id-signin", async () => {
    const pass = (document.getElementById("id-pass") as HTMLInputElement | null)?.value ?? "";
    if (!email || !pass) throw new IdentityError("bad-credentials");
    await identityApi().signIn(email, pass);
    if (sessionId) idStatus = (await identityApi().status()).status;
  });
  on("id-start", async () => {
    const bio = (document.getElementById("id-consent-bio") as HTMLInputElement | null)?.checked;
    const stmt = (document.getElementById("id-consent-stmt") as HTMLInputElement | null)?.checked;
    if (!bio || !stmt) throw new IdentityError("consent-required");
    const r = await identityApi().start();
    sessionId = r.sessionId;
    idStatus = r.status;
    checkUrl = r.url;
    await putIdSession(r.sessionId);
    if (r.url) window.open(r.url, "_blank", "noopener");
  });
  root.querySelector('[data-act="id-open"]')?.addEventListener("click", () => {
    if (checkUrl) window.open(checkUrl, "_blank", "noopener");
  });
  on("id-check", async () => {
    idStatus = (await identityApi().status()).status;
    if (idStatus !== "verified") message = idStatus === "canceled" ? "That ID check was cancelled. Start again." : "Not verified yet. Finish the check, then try again.";
    if (idStatus === "canceled") {
      sessionId = null;
      await putIdSession(null);
    }
  });
  on("id-sign", async () => {
    if (!sessionId) throw new IdentityError("no-id-check");
    const note = await signNote(sessionId);
    const local = await noteSha256(note.payload);
    const r = await identityApi().submitNote(note);
    if (r.noteSha256 !== local) throw new IdentityError("note-hash-mismatch");
    if (!r.receipt) throw new IdentityError("receipt-missing");
    const rc = await checkReceipt(r.receipt, { attestationId: r.attestationId, noteSha256: local, deviceSealId: note.payload.deviceSealId });
    if (rc.failed.length) throw new IdentityError("receipt-invalid");
    const att: Attestation = { attestationId: r.attestationId, noteSha256: local, note, receipt: r.receipt, idCheck: { provider: "stripe-identity" } };
    await saveAttestation(att);
    await putIdSession(null);
    attested = await currentAttestation();
    message = "";
  });
}
