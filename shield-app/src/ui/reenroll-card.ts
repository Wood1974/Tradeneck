import { esc } from "../esc";
import { identityApi } from "../identity/client";
import { enrollDevice, enrollErrorText, enrollStepText, reasonOf } from "../native/appattest";
import { detectPlatform } from "../platform";

/** "Apple device check" on the Account tab (iPhone, signed in): make a new Apple key for this phone and send its proof to the Shield server.
 *  The flow is the one the first enrolment uses: nothing changes on the phone until the server accepts Apple's proof. */
let busy = false;
let message = "";

export const reenrollDone = (keyId: string): string =>
  `Enrolled. The Shield server accepted Apple's proof for the new key (${keyId.slice(0, 8)}…). Photos taken from now on carry it.`;

export function reenrollCardHtml(): string {
  if (detectPlatform() !== "ios" || !identityApi().signedIn()) return "";
  return `
    <section class="finder signon" aria-labelledby="re-h">
      <div class="finder-top"><span class="chip">APPLE DEVICE CHECK</span></div>
      <h1 id="re-h">Enrol this phone again</h1>
      <p class="fine">Makes a new Apple key for this phone and sends Apple's proof to the Shield server. Needs signal and takes up to a minute and a half. Photos taken from now on carry the new key; photos already taken keep the key they were made with. If this phone already has a key, it stays listed under YOUR PHONES until you withdraw it.</p>
      <div class="actions"><button class="btn small" data-reenroll="run"${busy ? " disabled" : ""}>${busy ? "ENROLLING…" : "ENROL AGAIN"}</button></div>
      <p class="foot-note" role="status" data-reenroll-status>${esc(message)}</p>
    </section>`;
}

export function bindReenrollCard(root: ParentNode, rerender: () => void, done: () => void): void {
  root.querySelector('[data-reenroll="run"]')?.addEventListener("click", (e) => {
    if (busy) return;
    busy = true;
    message = "";
    const button = e.currentTarget as HTMLButtonElement;
    button.setAttribute("disabled", "");
    button.textContent = "ENROLLING…";
    const line = root.querySelector("[data-reenroll-status]");
    const started = Date.now();
    let doing = "Starting";
    const show = () => {
      if (line) line.textContent = `${doing}… ${Math.round((Date.now() - started) / 1000)} s`;
    };
    const ticker = setInterval(show, 1000);
    show();
    void enrollDevice((step) => {
      doing = enrollStepText(step);
      show();
    })
      .then((result) => {
        message = result.ok ? reenrollDone(result.keyId) : enrollErrorText(result.reason);
        if (result.ok) done();
      })
      .catch((err: unknown) => {
        message = enrollErrorText(reasonOf(err));
      })
      .finally(() => {
        clearInterval(ticker);
        busy = false;
        rerender();
      });
  });
}
