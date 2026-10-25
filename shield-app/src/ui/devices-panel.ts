import { esc } from "../esc";
import type { PhoneKey } from "../identity/client";
import { appAttestState } from "../native/appattest";
import { canWithdraw, describePhone, listPhones, phonesMessage, withdrawPhone } from "../native/devices";

/** "Your phones" in the Vault: the phones this account has enrolled, and a way to withdraw one that is lost or retired. */
interface PhonesState {
  open: boolean;
  busy: boolean;
  phones: PhoneKey[];
  thisKeyId: string | null;
  message: string;
}

const closed = (): PhonesState => ({ open: false, busy: false, phones: [], thisKeyId: null, message: "" });
let state: PhonesState = closed();

export function resetPhones(): void {
  state = closed();
}

export function phonesPanelHtml(): string {
  if (!state.open) return `<div class="actions"><button class="btn ghost small" data-phones="open">YOUR PHONES</button></div>`;
  const list = state.phones.length
    ? `<div class="list">${state.phones
        .map((p) => `<div class="card"><div class="meta">${esc(describePhone(p, state.thisKeyId))}</div>${canWithdraw(p, state.thisKeyId) ? `<button class="btn ghost small" data-phones="withdraw" data-phone-id="${esc(p.id)}" ${state.busy ? "disabled" : ""}>WITHDRAW</button>` : ""}</div>`)
        .join("")}</div>`
    : `<p class="fine">${state.busy ? "Loading…" : "No phones enrolled for this account."}</p>`;
  return `
    <div class="card" id="phones-panel">
      <div class="row"><h2>Your phones</h2><button class="btn ghost small" data-phones="close">CLOSE</button></div>
      <p class="fine">These are the phones you have set up with Apple's device check. Only you see this list. If one is lost or retired, withdraw it: photos it sends later stop showing as Apple-checked, and it cannot be set up again. Photos already stored keep the result they had. The phone you are using now cannot be withdrawn here.</p>
      ${state.message ? `<p class="fine" role="status">${esc(state.message)}</p>` : ""}
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
    const here = await appAttestState();
    state.thisKeyId = here.state === "enrolled" ? here.keyId : null;
    state.phones = await listPhones();
  };
  root.querySelectorAll("[data-phones]").forEach((el) => {
    const act = (el as HTMLElement).dataset.phones;
    el.addEventListener("click", () => {
      if (act === "open") {
        state.open = true;
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
