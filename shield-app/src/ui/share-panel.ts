import { esc } from "../esc";
import type { ShareInfo, ShareMade } from "../identity/client";
import { DEFAULT_SHARE_DAYS, SHARE_DAYS, canShare, describeShare, makeShare, shareMessage, sharesFor, shareText, withdrawShare } from "../native/share";

/** The Share section of a photo's detail view: make a code, copy it once, see and withdraw the codes already made. */
interface ShareState {
  open: boolean;
  busy: boolean;
  days: number;
  made: ShareMade | null;
  shares: ShareInfo[];
  message: string;
}

const closed = (): ShareState => ({ open: false, busy: false, days: DEFAULT_SHARE_DAYS, made: null, shares: [], message: "" });
let state: ShareState = closed();

/** Forget everything about the last photo's share panel, including a code that was on screen. */
export function resetShare(): void {
  state = closed();
}

export function sharePanelHtml(photoSha256: string): string {
  if (!canShare(photoSha256)) return `<p class="fine">Share is available once this photo has reached the server.</p>`;
  if (!state.open) return `<div class="actions"><button class="btn ghost small" data-share="open">SHARE</button></div>`;
  const made = state.made
    ? `<div class="card"><p class="meta">Your code (shown once, copy it now)</p><pre style="font-size:20px;color:var(--ink,#fff)">${esc(state.made.code)}</pre>
        <p class="fine">Works until ${esc(state.made.expires_at.slice(0, 10))}.</p>
        <div class="actions"><button class="btn small" data-share="copy">COPY</button></div></div>`
    : "";
  const list = state.shares.length
    ? `<div class="list">${state.shares
        .map((s) => `<div class="card"><div class="meta">${esc(describeShare(s))}</div>${s.active ? `<button class="btn ghost small" data-share="withdraw" data-share-id="${esc(s.id)}" ${state.busy ? "disabled" : ""}>WITHDRAW</button>` : ""}</div>`)
        .join("")}</div>`
    : `<p class="fine">No codes made for this photo yet.</p>`;
  return `
    <div class="card" id="share-panel">
      <div class="row"><h2>Share</h2><button class="btn ghost small" data-share="close">CLOSE</button></div>
      <p class="fine">A code lets whoever holds it check a photo file against the copy stored on the Shield server. They learn whether the file matches, when it was uploaded, and whether the photographer passed the ID check. They do not see your name, email or other photos. The code works only for this photo, stops on the date shown, and you can withdraw it at any time. Nothing is sent from this phone: you choose who gets it.</p>
      <label class="meta" for="share-days">LASTS</label>
      <select id="share-days" ${state.busy ? "disabled" : ""}>${SHARE_DAYS.map((d) => `<option value="${d}" ${d === state.days ? "selected" : ""}>${d} days</option>`).join("")}</select>
      <div class="actions"><button class="btn small" data-share="make" ${state.busy ? "disabled" : ""}>${state.busy ? "WORKING…" : "MAKE A CODE"}</button></div>
      ${made}
      ${state.message ? `<p class="fine" role="status">${esc(state.message)}</p>` : ""}
      <p class="meta">CODES ALREADY MADE</p>
      ${list}
    </div>`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Wires the Share buttons that sharePanelHtml put on screen. `rerender` redraws the screen; `photoSha256` is the open photo. */
export function bindSharePanel(root: ParentNode, photoSha256: string, rerender: () => void): void {
  const run = async (fn: () => Promise<void>): Promise<void> => {
    state.busy = true;
    state.message = "";
    rerender();
    try {
      await fn();
    } catch (err) {
      state.message = shareMessage(err);
    }
    state.busy = false;
    rerender();
  };
  root.querySelectorAll("[data-share]").forEach((el) => {
    const act = (el as HTMLElement).dataset.share;
    el.addEventListener("click", () => {
      if (act === "open") {
        state.open = true;
        void run(async () => void (state.shares = await sharesFor(photoSha256)));
      } else if (act === "close") {
        resetShare();
        rerender();
      } else if (act === "make") {
        const picked = Number((document.getElementById("share-days") as HTMLSelectElement | null)?.value);
        state.days = (SHARE_DAYS as readonly number[]).includes(picked) ? picked : DEFAULT_SHARE_DAYS;
        void run(async () => {
          state.made = await makeShare(photoSha256, state.days);
          state.shares = await sharesFor(photoSha256);
        });
      } else if (act === "copy" && state.made) {
        const text = shareText(state.made);
        void copyToClipboard(text).then((ok) => {
          state.message = ok ? "Copied. Paste it where you want to send it." : "Could not copy. Select the code above and copy it by hand.";
          rerender();
        });
      } else if (act === "withdraw") {
        const id = (el as HTMLElement).dataset.shareId;
        if (id) void run(async () => {
          await withdrawShare(id);
          state.shares = await sharesFor(photoSha256);
          state.message = "Withdrawn. That code no longer works.";
        });
      }
    });
  });
}
