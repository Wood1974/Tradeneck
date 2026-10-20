import { esc } from "../esc";
import { identityApi } from "../identity/client";
import { bindPasswordToggles, EMAIL_ATTRS, passwordField } from "./fields";

// Sign-up with an invite code. There is no open sign-up: whoever runs Shield hands out single-use codes, and a code
// makes a normal account. The screen never says more about a bad code than that it is wrong, used or expired.

let open = false;
let message = "";
let busy = false;

export const signupOpen = (): boolean => open;

export function openSignup(): void {
  open = true;
  message = "";
}

export function closeSignup(): void {
  open = false;
  message = "";
}

const ERRORS: Record<string, string> = {
  invalid_or_expired_invite: "That invite code is wrong, already used, or has expired. Ask the person who runs Shield for a new one.",
  account_already_exists: "That email already has an account. Go back and sign in, or reset the password.",
  password_length_invalid: "The password needs at least 12 characters.",
  invalid_email: "That does not look like an email address.",
  "rate-limited": "Too many tries just now. Wait a minute, then try again.",
  rate_limit_exceeded: "Too many tries just now. Wait a minute, then try again.",
  network: "Could not reach the Shield server. Check your connection and try again.",
};
const codeOf = (err: unknown): string => (typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "network");
export const signupErrorText = (code: string): string => ERRORS[code] ?? `Something went wrong (${code}).`;

export interface SignupFields {
  invite: string;
  email: string;
  password: string;
  again: string;
}

/** What can be checked without the server. Returns a message, or null when the form is complete. */
export function validateSignup(f: SignupFields): string | null {
  if (f.invite.replace(/[^A-Za-z0-9]/g, "").length < 8) return "Enter the invite code you were given.";
  if (!f.email.trim().includes("@")) return ERRORS.invalid_email!;
  if (f.password.length < 12) return ERRORS.password_length_invalid!;
  if (f.password !== f.again) return "The two passwords do not match.";
  return null;
}

/** Asks the server to make the account. True when it did. A failure leaves its reason in `message`. */
export async function submitSignup(f: SignupFields): Promise<boolean> {
  const bad = validateSignup(f);
  if (bad) {
    message = bad;
    return false;
  }
  try {
    await identityApi().signUp(f.email.trim(), f.password, f.invite.trim());
  } catch (err) {
    message = signupErrorText(codeOf(err));
    return false;
  }
  message = "";
  return true;
}

export function signupView(): string {
  return `
    <p class="lede">Make your account. You need an invite code from the person who runs Shield. Each code works once.</p>
    <label for="su-invite">Invite code</label>
    <input id="su-invite" autocapitalize="characters" autocorrect="off" spellcheck="false" autocomplete="off" maxlength="24" />
    <label for="su-email">Email</label>
    <input id="su-email" type="email" autocomplete="username" ${EMAIL_ATTRS} />
    <label for="su-pass">Password (at least 12 characters)</label>
    ${passwordField("su-pass", "new-password")}
    <label for="su-pass2">Password again</label>
    ${passwordField("su-pass2", "new-password")}
    <div class="actions">
      <button class="btn" data-act="su-create"${busy ? " disabled" : ""}>CREATE ACCOUNT</button>
      <button class="btn ghost small" data-act="su-close">BACK TO SIGN IN</button>
    </div>
    <p class="foot-note" role="status" data-su-status>${esc(message)}</p>`;
}

/** The button under the sign-in form that opens the panel. */
export function signupEntry(): string {
  return `<div class="actions"><button class="btn ghost small" data-act="su-open">I HAVE AN INVITE CODE</button></div>`;
}

const value = (root: ParentNode, sel: string): string => (root.querySelector<HTMLInputElement>(sel)?.value ?? "").toString();

export interface SignupHooks {
  /** Runs once the account exists: the caller signs in with it. Throws if it cannot. */
  afterCreate(email: string, password: string): Promise<void>;
}

export function bindSignup(root: ParentNode, rerender: () => void, hooks: SignupHooks): void {
  bindPasswordToggles(root);
  const button = (act: string) => root.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);

  button("su-open")?.addEventListener("click", () => {
    openSignup();
    rerender();
  });
  button("su-close")?.addEventListener("click", () => {
    closeSignup();
    rerender();
  });
  const create = button("su-create");
  create?.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    // Disable in place: a re-render would wipe what was typed, and a mistyped field must be fixable.
    create.setAttribute("disabled", "");
    const fields: SignupFields = {
      invite: value(root, "#su-invite"),
      email: value(root, "#su-email"),
      password: value(root, "#su-pass"),
      again: value(root, "#su-pass2"),
    };
    const created = await submitSignup(fields);
    if (!created) {
      // Say so under the form and keep everything typed.
      busy = false;
      create.removeAttribute("disabled");
      const line = root.querySelector("[data-su-status]");
      if (line) line.textContent = message;
      else rerender();
      return;
    }
    closeSignup();
    try {
      await hooks.afterCreate(fields.email.trim(), fields.password);
    } catch {
      // The account exists; the person signs in with it on the screen that comes back.
    }
    // Cleared before drawing, or the next screen would be drawn with its buttons disabled.
    busy = false;
    rerender();
  });
}
