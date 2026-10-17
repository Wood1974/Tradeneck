import { esc } from "../esc";

// Sign-on form fields. A phone keyboard capitalises and "corrects" an email, and a masked password cannot be
// checked by eye, so every email box gets EMAIL_ATTRS and every password box gets a Show/Hide button.

export const EMAIL_ATTRS = 'autocapitalize="none" autocorrect="off" spellcheck="false"';

export function passwordField(id: string, autocomplete: "current-password" | "new-password"): string {
  return `<div class="pw"><input id="${esc(id)}" type="password" autocomplete="${autocomplete}" ${EMAIL_ATTRS} /><button type="button" class="pw-toggle" data-pw-toggle="${esc(id)}" aria-controls="${esc(id)}" aria-pressed="false" aria-label="Show password">SHOW</button></div>`;
}

/** Flips a password box between hidden and visible in place. A re-render would wipe what was typed. */
export function bindPasswordToggles(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-pw-toggle]").forEach((button) => {
    button.onclick = () => {
      const input = root.querySelector<HTMLInputElement>(`#${button.dataset.pwToggle}`);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "HIDE" : "SHOW";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    };
  });
}
