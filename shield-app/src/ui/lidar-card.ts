import { esc } from "../esc";
import { depthProbeLines, isDepthProbeAvailable, runDepthProbe } from "../native/depth-probe";

/** "LiDAR check" on the Account tab (iPhone only): one test shot that shows whether iOS gives this phone a depth map. */
let busy = false;
let lines: string[] = [];

export function lidarCardHtml(): string {
  if (!isDepthProbeAvailable()) return "";
  return `
    <section class="finder signon" aria-labelledby="lidar-h">
      <div class="finder-top"><span class="chip">TEST</span></div>
      <h1 id="lidar-h">LiDAR check</h1>
      <p class="fine">Takes one test shot and reports what depth information iOS gives Shield with it. The shot is not kept: nothing is saved, signed or sent.</p>
      <div class="actions"><button class="btn small" data-lidar="run"${busy ? " disabled" : ""}>${busy ? "CHECKING…" : "RUN LIDAR CHECK"}</button></div>
      ${lines.length ? `<div class="list" role="status" data-lidar-result>${lines.map((l) => `<p class="fine">${esc(l)}</p>`).join("")}</div>` : ""}
    </section>`;
}

export function bindLidarCard(root: ParentNode, rerender: () => void): void {
  root.querySelector('[data-lidar="run"]')?.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    lines = [];
    rerender();
    void runDepthProbe()
      .then((result) => {
        lines = depthProbeLines(result);
      })
      .catch((err: unknown) => {
        lines = [`The check could not run: ${String((err as { message?: string })?.message ?? err).slice(0, 120)}.`];
      })
      .finally(() => {
        busy = false;
        rerender();
      });
  });
}
