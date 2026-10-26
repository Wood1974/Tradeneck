import { esc } from "../esc";
import type { PhoneKey } from "../identity/client";
import { appAttestState } from "../native/appattest";
import { canWithdraw, describePhone, listPhones, phonesMessage, withdrawPhone } from "../native/devices";

/** "Your phones" on the Account tab: the phones this account has enrolled, and a way to withdraw one that is lost or retired. */
interface PhonesState {
  open: boolean;
  busy: boolean;
  phones: PhoneKey[];
  /** True only after the server answered with this account's list. Until then, nothing is known about which phones it holds. */
  loaded: boolean;
  thisKeyId: string | null;
  message: string;
}

const closed = (): PhonesState => ({ open: false, busy: false, phones: [], loaded: false, thisKeyId: null, message: "" });
let state: PhonesState = closed();

export function resetPhones(): void {
  state = closed();
}

export function phonesPanelHtml(): string {
  if (!state.open) return `<div class="actions"><button class="btn ghost small" data-phones="open">YOUR PHONES</button></div>`;
  let list: string;
  if (state.loaded && state.phones.length) {
    list = `<div class="list">${state.phones
      .map((p) => `<div class="card"><div class="meta">${esc(describePhone(p, state.thisKeyId))}</div>${canWithdraw(p, state.thisKeyId) ? `<button class="btn ghost small" data-phones="withdraw" data-phone-id="${esc(p.id)}" ${state.busy ? "disabled" : ""}>WITHDRAW</button>` : ""}</div>`)
      .join("")}</div>`;
  } else if (state.loaded) {
    list = `<p class="fine">No phones enrolled for this account.</p>`;
  } else if (state.busy) {
    list = `<p class="fine">Loading…</p>`;
  } else {
    // The list was not fetched, so nothing is said about which phones the account has.
    list = `<div class="actions"><button class="btn ghost small" data-phones="retry">TRY AGAIN</button></div>`;
  }
  // The phone's own record of an Apple key and the server's list are different facts. Say so when a real answer disagrees.
  const unlisted = state.loaded && state.thisKeyId !== null && !state.phones.some((p) => p.id === state.thisKeyId);
  const mismatch = unlisted
    ? `<p class="fine bad" role="status">This phone has an Apple key, but the Shield server does not list it under this account. It may have been set up under another account.</p>`
    : "";
  return `
    <div class="card" id="phones-panel">
      <div class="row"><h2>Your phones</h2><button class="btn ghost small" data-phones="close">CLOSE</button></div>
      <p class="fine">These are the phones you have set up with Apple's device check. Only you see this list. If one is lost or retired, withdraw it: photos it sends later stop showing as Apple-checked, and it cannot be set up again. Photos already stored keep the result they had. The phone you are using now cannot be withdrawn here.</p>
      ${state.message ? `<p class="fine" role="status">${esc(state.message)}</p>` : ""}
      ${mismatch}
      ${list}
    </div>`;
}

/** Wires the buttons that phonesPanelHtml put on screen. `rerender` redraws the screen. */
export function bindPhonesPanel(root: ParentNode, rerender: () => void): void {
  const run = async (fn: () => Promise<void>): Promise<void> => {
    state.busy = true;
    state.message = "";
    rerender();
    try {
      await fn();
    } catch (err) {
      state.message = phonesMessage(err);
    }
    state.busy = false;
    rerender();
  };
  const load = async (): Promise<void> => {
    state.loaded = false;
    const here = await appAttestState();
    state.thisKeyId = here.state === "enrolled" ? here.keyId : null;
    state.phones = await listPhones();
    state.loaded = true;
  };
  root.querySelectorAll("[data-phones]").forEach((el) => {
    const act = (el as HTMLElement).dataset.phones;
    el.addEventListener("click", () => {
      if (act === "open") {
        state.open = true;
        void run(load);
      } else if (act === "retry") {
        void run(load);
      } else if (act === "close") {
        resetPhones();
        rerender();
      } else if (act === "withdraw") {
        const id = (el as HTMLElement).dataset.phoneId;
        if (id)
          void run(async () => {
            await withdrawPhone(id);
            await load();
            state.message = "Withdrawn. That phone's later photos will not show as Apple-checked.";
          });
      }
    });
  });
}
