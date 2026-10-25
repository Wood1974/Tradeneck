import { esc } from "../esc";
import { IdentityError, identityApi } from "../identity/client";
import { uploadLine, uploadPending } from "../native/uploader";
import { phonesPanelHtml, resetPhones } from "./devices-panel";
import { bindPasswordToggles, EMAIL_ATTRS, passwordField } from "./fields";
import { resetEntry, resetOpen, resetView } from "./reset";
import { resetShare } from "./share-panel";

// The Account tab: sign in, sign out, and what depends on being signed in. A sign-in lives in memory only, so every app
// restart ends it, and SIGN OUT ends it on purpose. Photos are sealed only while signed in, so one login is not shared.

let email = "";
let busy = false;
let message = "";

const ERRORS: Record<string, string> = {
  "bad-credentials": "That email or password was not accepted.",
  network: "Could not reach the Shield server. Signing in needs a connection.",
  "rate-limited": "Too many tries just now. Wait a few minutes, then try again.",
};
const codeOf = (err: unknown): string => (err instanceof IdentityError ? err.code : typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "network");
export const accountErrorText = (code: string): string => ERRORS[code] ?? `Something went wrong (${code}).`;

export function accountView(): string {
  if (identityApi().signedIn()) {
    return `
      <section class="finder signon" aria-labelledby="ac-h">
        <div class="finder-top"><span class="chip">ACCOUNT</span><span class="chip ok">SIGNED IN</span></div>
        <h1 id="ac-h">Signed in</h1>
        <p class="fine">You can take photos and they copy to the Shield server. This sign-in ends when you tap SIGN OUT or when the app restarts, so a login is not shared between people.</p>
        <p class="fine" id="acct-upload" role="status">${esc(uploadLine() || "No photos on this phone yet.")}</p>
        <div class="actions">
          <button class="btn small" data-act="acct-sync"${busy ? " disabled" : ""}>COPY TO SERVER NOW</button>
          <button class="btn ghost small" data-act="acct-signout"${busy ? " disabled" : ""}>SIGN OUT</button>
        </div>
        <p class="foot-note" role="status" data-acct-status>${esc(message)}</p>
        <p class="foot-note">Signing out does not delete anything: photos, the Vault and your signed statement stay on this phone, and photos not yet copied go up after the next sign-in. The server keeps a sign-in until it expires on its own (12 hours); signing out here removes it from this phone.</p>
      </section>
      ${phonesPanelHtml()}`;
  }
  return `
    <section class="finder signon" aria-labelledby="ac-h">
      <div class="finder-top"><span class="chip">ACCOUNT</span><span class="chip warn">SIGNED OUT</span></div>
      <h1 id="ac-h">Sign in</h1>
      ${
        resetOpen()
          ? resetView()
          : `<p class="fine">Shield seals photos only while you are signed in, and copies them to the server for your account. Signing in needs a connection. It ends when the app restarts or you sign out.</p>
      <label for="acct-email">Email</label>
      <input id="acct-email" type="email" autocomplete="username" ${EMAIL_ATTRS} value="${esc(email)}" />
      <label for="acct-pass">Password</label>
      ${passwordField("acct-pass", "current-password")}
      <div class="actions"><button class="btn" data-act="acct-signin"${busy ? " disabled" : ""}>SIGN IN</button></div>
      <p class="foot-note" role="status" data-acct-status>${esc(message)}</p>
      ${resetEntry()}`
      }
    </section>`;
}

export function bindAccount(root: HTMLElement, rerender: () => void): void {
  bindPasswordToggles(root);
  const emailEl = root.querySelector<HTMLInputElement>("#acct-email");
  if (emailEl) emailEl.oninput = () => (email = emailEl.value.trim());

  root.querySelector('[data-act="acct-signin"]')?.addEventListener("click", (e) => {
    if (busy) return;
    const button = e.currentTarget as HTMLButtonElement;
    const pass = root.querySelector<HTMLInputElement>("#acct-pass")?.value ?? "";
    const typed = root.querySelector<HTMLInputElement>("#acct-email")?.value.trim() ?? email;
    email = typed;
    const line = root.querySelector("[data-acct-status]");
    if (!typed || !pass) {
      message = "Enter the email and password of your Shield account.";
      if (line) line.textContent = message;
      return;
    }
    busy = true;
    message = "";
    // Disable in place: a re-render would wipe what was typed.
    button.setAttribute("disabled", "");
    void identityApi()
      .signIn(typed, pass)
      .then(() => {
        busy = false;
        // Photos that were waiting go up now, without another tap.
        void uploadPending(true).finally(rerender);
        rerender();
      })
      .catch((err: unknown) => {
        busy = false;
        message = accountErrorText(codeOf(err));
        button.removeAttribute("disabled");
        if (line) line.textContent = message;
      });
  });

  root.querySelector('[data-act="acct-signout"]')?.addEventListener("click", () => {
    identityApi().signOut();
    // Nothing from this session stays on screen: a code just made, the list of phones.
    resetShare();
    resetPhones();
    email = "";
    message = "";
    rerender();
  });

  root.querySelector('[data-act="acct-sync"]')?.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    message = "";
    rerender();
    void uploadPending(true).finally(() => {
      busy = false;
      message = "";
      rerender();
    });
  });
}
