import { esc } from "../esc";
import { identityApi } from "../identity/client";

// Forgot password: an emailed one-time code. Shared by the two places a signed-out person can be: the sign-on
// screen and the enroll card. The server answers the same whether or not the email has an account, so this screen
// never says whether an account exists either.

type Step = "closed" | "email" | "code";

let step: Step = "closed";
let email = "";
let message = "";
let notice = "";
let busy = false;

export const resetOpen = (): boolean => step !== "closed";

export function openReset(prefillEmail = ""): void {
  step = "email";
  if (prefillEmail) email = prefillEmail.trim();
  message = "";
  notice = "";
}

export function closeReset(): void {
  step = "closed";
  message = "";
}

/** Shown on the sign-in screen after a successful reset. */
export const resetNotice = (): string => notice;

const ERRORS: Record<string, string> = {
  email_not_configured: "Reset by email is not set up on the Shield server yet. Ask the Shield administrator.",
  invalid_or_expired_code: "That code is wrong or has expired. Check it, or send a new one.",
  password_length_invalid: "The new password needs at least 12 characters.",
  admin_locked: "This account can no longer be reset.",
  "rate-limited": "Too many tries just now. Wait a minute, then try again.",
  rate_limit_exceeded: "Too many tries just now. Wait a minute, then try again.",
  network: "Could not reach the Shield server. Check your connection and try again.",
};
const codeOf = (err: unknown): string => (typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "network");
export const resetErrorText = (code: string): string => ERRORS[code] ?? `Something went wrong (${code}).`;

export function validateNewPassword(password: string, again: string): string | null {
  if (password.length < 12) return ERRORS.password_length_invalid;
  if (password !== again) return "The two passwords do not match.";
  return null;
}

export async function sendCode(address: string): Promise<void> {
  const wanted = address.trim();
  if (!wanted || !wanted.includes("@")) {
    message = "Enter the email address of your Shield account.";
    return;
  }
  email = wanted;
  try {
    await identityApi().requestReset(wanted);
    step = "code";
    message = "If that email has a Shield account, a code is on its way. It lasts 15 minutes.";
  } catch (err) {
    message = resetErrorText(codeOf(err));
  }
}

export async function setNewPassword(address: string, code: string, password: string, again: string): Promise<boolean> {
  const bad = validateNewPassword(password, again);
  if (bad) {
    message = bad;
    return false;
  }
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 8) {
    message = "The code is 8 digits. Check the email.";
    return false;
  }
  try {
    await identityApi().confirmReset(address.trim() || email, digits, password);
  } catch (err) {
    message = resetErrorText(codeOf(err));
    return false;
  }
  step = "closed";
  message = "";
  notice = "Password changed. Sign in with the new password.";
  return true;
}

export function resetView(): string {
  const status = `<p class="foot-note" role="status" data-reset-status>${esc(message)}</p>`;
  if (step === "code") {
    return `
      <p class="lede">Enter the 8-digit code from the email, then choose a new password (at least 12 characters).</p>
      <label for="rs-email">Email</label>
      <input id="rs-email" type="email" autocomplete="username" value="${esc(email)}" />
      <label for="rs-code">Code</label>
      <input id="rs-code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" />
      <label for="rs-new">New password</label>
      <input id="rs-new" type="password" autocomplete="new-password" />
      <label for="rs-new2">New password again</label>
      <input id="rs-new2" type="password" autocomplete="new-password" />
      <div class="actions">
        <button class="btn" data-act="rs-confirm"${busy ? " disabled" : ""}>SET NEW PASSWORD</button>
        <button class="btn ghost small" data-act="rs-again"${busy ? " disabled" : ""}>SEND A NEW CODE</button>
        <button class="btn ghost small" data-act="rs-close">BACK TO SIGN IN</button>
      </div>
      ${status}`;
  }
  return `
    <p class="lede">Forgot your password? Enter your account email. If it has a Shield account, a one-time code is emailed to it.</p>
    <label for="rs-email">Email</label>
    <input id="rs-email" type="email" autocomplete="username" value="${esc(email)}" />
    <div class="actions">
      <button class="btn" data-act="rs-send"${busy ? " disabled" : ""}>SEND CODE</button>
      <button class="btn ghost small" data-act="rs-have">I ALREADY HAVE A CODE</button>
      <button class="btn ghost small" data-act="rs-close">BACK TO SIGN IN</button>
    </div>
    ${status}`;
}

/** The button that opens the panel, and the notice shown after a reset. Placed under a sign-in form. */
export function resetEntry(): string {
  return `${notice ? `<p class="fine ready" role="status">${esc(notice)}</p>` : ""}<div class="actions"><button class="btn ghost small" data-act="rs-open">FORGOT PASSWORD?</button></div>`;
}

const value = (root: ParentNode, sel: string): string => (root.querySelector<HTMLInputElement>(sel)?.value ?? "").toString();

export function bindReset(root: ParentNode, rerender: () => void): void {
  const on = (act: string, fn: () => Promise<void> | void) =>
    root.querySelector(`[data-act="${act}"]`)?.addEventListener("click", (e) => {
      if (busy) return;
      const button = e.currentTarget as HTMLButtonElement;
      busy = true;
      // Disable in place: a re-render would wipe what was typed.
      button.setAttribute("disabled", "");
      const before = `${step}|${notice}`;
      void Promise.resolve(fn()).finally(() => {
        busy = false;
        if (`${step}|${notice}` !== before) {
          rerender();
          return;
        }
        // Nothing moved on (a wrong code, a typo): say so in place, so the person does not retype everything.
        button.removeAttribute("disabled");
        const line = root.querySelector("[data-reset-status]");
        if (line) line.textContent = message;
        else rerender();
      });
    });
  const keepEmail = root.querySelector<HTMLInputElement>("#rs-email");
  if (keepEmail) keepEmail.oninput = () => (email = keepEmail.value.trim());

  on("rs-open", () => openReset(value(root, "#id-email") || value(root, "#aa-email")));
  on("rs-close", () => closeReset());
  on("rs-have", () => {
    email = value(root, "#rs-email").trim() || email;
    step = "code";
    message = "";
  });
  on("rs-send", () => sendCode(value(root, "#rs-email")));
  on("rs-again", () => sendCode(value(root, "#rs-email")));
  on("rs-confirm", async () => {
    await setNewPassword(value(root, "#rs-email"), value(root, "#rs-code"), value(root, "#rs-new"), value(root, "#rs-new2"));
  });
}
