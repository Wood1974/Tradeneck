import { arrivalHashFile, captureNative, sealWebCameraFrame } from "../capture/capture";
import { deviceSealId } from "../crypto/seal";
import { makeCheckpoints, PACK_ORDER } from "../packs";
import { isNativeOriginAvailable } from "../platform";
import { feeForBudget, PRICING_EFFECTIVE } from "../pricing";
import {
  activeJobId,
  getJob,
  listJobs,
  listVault,
  putJob,
  setActiveJobId,
} from "../store/db";
import type { Job, PackKind, VaultItem } from "../types";
import { parseBundle, verifyBundle, verifyItemOriginal } from "../verify/verify";
import { parseCloseoutPacket, verifyCloseoutPacket, type PacketVerdict } from "../construction/closeout";
import type { CloseoutPacket } from "../types";
import { bindConstruction, constructionView, initConstruction, restoreLastPacket, type ConstructionCtx } from "./construction";

type Tab = "capture" | "jobs" | "vault" | "verify" | "construction";

const root = () => document.getElementById("app")!;

let tab: Tab = "capture";
let specOpen = false;
let sealId = "········";
let jobs: Job[] = [];
let vault: VaultItem[] = [];
let activeId: string | null = null;
let openVaultId: string | null = null;
let status = "";
let selectedPack: PackKind = "remodel";
let customCount = 8;
let budget = 15000;
let pinLat = "";
let pinLng = "";
let pinR = "200";
let verifyOut = "";
let camStream: MediaStream | null = null;
let packetOut: { verdict: PacketVerdict; reasons: string[]; packet: CloseoutPacket } | null = null;

const ctx: ConstructionCtx = {
  jobs: () => jobs,
  vault: () => vault,
  activeId: () => activeId,
  setActive: (id) => setActiveJobId(id),
  reload,
  render,
};

export async function start(): Promise<void> {
  sealId = await deviceSealId();
  await initConstruction();
  await reload();
  await restoreLastPacket(activeId);
  render();
}

async function reload(): Promise<void> {
  jobs = await listJobs();
  vault = await listVault();
  activeId = await activeJobId();
}

function activeJob(): Job | undefined {
  return jobs.find((j) => j.id === activeId);
}

function clock(): string {
  return new Date().toISOString().slice(11, 19) + " UTC";
}

export function render(): void {
  const native = isNativeOriginAvailable();
  const job = activeJob();
  root().innerHTML = `
    <header class="top">
      <div>
        <div class="brand">SHIELD</div>
        <div class="sub">TRADEDECK · STANDALONE</div>
      </div>
      <div class="top-right">
        <button class="spec-btn" data-act="spec">SPEC</button>
        <div class="seal-id">DEVICE SEAL<br>${sealId}</div>
      </div>
    </header>
    <main>${specOpen ? specView() : view(native, job)}</main>
    <nav class="tabs">
      <button class="${tab === "capture" ? "on" : ""}" data-tab="capture">Capture</button>
      <button class="${tab === "jobs" ? "on" : ""}" data-tab="jobs">Jobs</button>
      <button class="${tab === "vault" ? "on" : ""}" data-tab="vault">Vault</button>
      <button class="${tab === "verify" ? "on" : ""}" data-tab="verify">Verify</button>
      <button class="${tab === "construction" ? "on" : ""}" data-tab="construction">Build</button>
    </nav>
    <input class="hidden-file" id="file-arrival" type="file" accept="image/*" />
    <input class="hidden-file" id="file-bundle" type="file" accept="application/json,.json,.shield.json,.shield-record.json" />
  `;
  bind();
}

function view(native: boolean, job: Job | undefined): string {
  if (tab === "jobs") return jobsView(job);
  if (tab === "vault") return vaultView();
  if (tab === "verify") return verifyView();
  if (tab === "construction") return constructionView(ctx);
  return captureView(native, job);
}

function captureView(native: boolean, job: Job | undefined): string {
  const originChip = native ? `<span class="chip ok">NATIVE</span>` : `<span class="chip warn">WEB · NO ORIGIN</span>`;
  const camChip = native
    ? `<span class="chip">CAMERA READY · ${clock()}</span>`
    : camStream
      ? `<span class="chip ok">WEB CAMERA · LIVE</span>`
      : `<span class="chip">CAMERA OFF · ${clock()}</span>`;
  const slotLabel = pendingSlot ? job?.checkpoints.find((c) => c.id === pendingSlot)?.label ?? pendingSlot : null;
  const finderBody = !native && camStream
    ? `<video id="cam" class="cam" autoplay playsinline muted></video>
      ${slotLabel ? `<p class="lede">Sealing “${esc(slotLabel)}”</p>` : ""}
      <div class="actions">
        <button class="btn" data-act="shutter">SHUTTER</button>
        <button class="btn ghost small" data-act="cam-off">CANCEL</button>
      </div>`
    : `<div class="icon-aperture"><span></span></div>
      <h1>${native ? "Native camera" : "Browser camera"}</h1>
      <p class="lede">${native
        ? "Rear camera only. Hash on arrival. Attest binds later."
        : "Live sensor, hashed at the shutter. Camera vs. virtual device is not proven on web."}</p>
      <div class="actions">
        <button class="btn" data-act="${native ? "native" : "webcam"}">${native ? "SEAL FRAME" : "OPEN CAMERA"}</button>
        <button class="btn ghost small" data-act="arrival">ARRIVAL HASH</button>
      </div>`;
  return `
    <div class="banner">
      <strong>${job ? "LOCKED LIST" : "NO LOCKED LIST"}</strong>
      ${job ? `${job.brief ? esc(job.brief.title || "CONSTRUCTION") : job.pack.toUpperCase()} · $${job.feeUsd} ${job.feeTier}${job.pin ? " · pin set" : ""}` : "Lock a pack to attach pin score and fee."}
      <div><button data-act="goto-jobs">${job ? "Change pack" : "Lock a pack"}</button> <button data-act="goto-construction">Construction brief</button></div>
    </div>
    <section class="finder">
      <div class="finder-top">${originChip}${camChip}</div>
      ${finderBody}
      ${status ? `<p class="foot-note">${esc(status)}</p>` : ""}
    </section>
    ${job ? slots(job) : packChips()}
    <p class="foot-note">Bytes received. Origin proven: ${native ? "device path only" : "no"}.</p>
  `;
}

function packChips(): string {
  return `<div class="packs">${PACK_ORDER.map((p) =>
    `<button data-pack="${p}" class="${selectedPack === p ? "on" : ""}">${p.toUpperCase()}</button>`,
  ).join("")}</div>`;
}

function slots(job: Job): string {
  return `<div class="slots">${job.checkpoints
    .map((c) => {
      const filled = vault.find((v) => v.record.id === c.shotId);
      return `<div class="slot">
        <div>
          <div>${esc(c.label)}</div>
          <div class="meta">${filled ? filled.record.captureKind : "empty"}</div>
        </div>
        <button class="btn small ghost" data-slot="${c.id}">${filled ? "VIEW" : "SEAL"}</button>
      </div>`;
    })
    .join("")}</div>`;
}

function jobsView(job: Job | undefined): string {
  const fee = feeForBudget(budget);
  return `
    <div class="banner">
      <strong>LOCK FIRST</strong>
      Fee is set from budget before any shot. Verdict does not change the fee.
    </div>
    <div class="form">
      <label>PACK</label>
      <select id="pack-sel">${PACK_ORDER.map((p) => `<option value="${p}" ${p === selectedPack ? "selected" : ""}>${p}</option>`).join("")}</select>
      ${selectedPack === "custom" ? `<label>CUSTOM COUNT 5–20</label><input id="custom-n" type="number" min="5" max="20" value="${customCount}" />` : ""}
      <label>JOB BUDGET USD</label>
      <input id="budget" type="number" min="0" step="1" value="${budget}" />
      <div class="meta">${fee.feeTier} · $${fee.feeUsd} · effective ${PRICING_EFFECTIVE}</div>
      <label>LOCKED PIN (optional)</label>
      <input id="pin-lat" placeholder="lat" value="${pinLat}" />
      <input id="pin-lng" placeholder="lng" value="${pinLng}" />
      <input id="pin-r" placeholder="radius m" value="${pinR}" />
      <button class="btn" data-act="lock">LOCK PACK</button>
    </div>
    <div class="list">${jobs
      .map(
        (j) => `<div class="card">
          <div class="row">
            <h2>${j.brief ? esc(j.brief.title || "construction") : j.pack} · $${j.feeUsd}</h2>
            <button class="btn small ghost" data-activate="${j.id}">${j.id === activeId ? "ACTIVE" : "USE"}</button>
          </div>
          <div class="meta">${j.checkpoints.filter((c) => c.shotId).length}/${j.checkpoints.length} sealed · ${j.pin ? "pin on" : "no pin"}</div>
        </div>`,
      )
      .join("")}${jobs.length ? "" : `<p class="meta">No locked lists.</p>`}</div>
    ${job ? "" : ""}
  `;
}

function vaultView(): string {
  const open = vault.find((v) => v.record.id === openVaultId);
  if (open) {
    const rec = open.record;
    return `
      <button class="btn ghost small" data-act="vault-back">BACK</button>
      <img class="thumb" alt="" src="data:${rec.mime};base64,${open.originalB64}" />
      <div class="card">
        <div class="row"><h2>${rec.captureKind}</h2><span class="chip">${rec.platform}</span></div>
        <pre>${rec.sha256}
${rec.createdAt}
job ${rec.jobId ?? "—"} · ${rec.checkpointId ?? "unbound"}
attest ${rec.attest.kind}${rec.attest.tokenPresent ? " · token" : ""}</pre>
        <div class="actions">
          <button class="btn small" data-act="rehash">REHASH</button>
          <button class="btn ghost small" data-act="export">EXPORT</button>
        </div>
        ${status ? `<p class="foot-note">${esc(status)}</p>` : ""}
      </div>
    `;
  }
  return `
    <div class="banner"><strong>VAULT</strong>Originals stay on this device. Rehash checks bytes only.</div>
    <div class="list">${vault
      .map(
        (v) => `<button class="card" data-open="${v.record.id}" style="width:100%;text-align:left">
          <div class="row"><h2>${v.record.captureKind}</h2><span class="chip">${v.record.platform}</span></div>
          <div class="meta">${v.record.sha256.slice(0, 16)}… · ${v.record.createdAt}</div>
        </button>`,
      )
      .join("")}${vault.length ? "" : `<p class="meta">Empty.</p>`}</div>
  `;
}

function verifyView(): string {
  return `
    <div class="banner"><strong>VERIFY</strong>Drop a photo bundle (.shield.json) or a close-out record (.shield-record.json). Everything is recomputed on this device.</div>
    <div class="drop" data-act="pick-bundle">Drop a file or tap to choose</div>
    ${verifyOut ? `<div class="card"><pre>${esc(verifyOut)}</pre></div>` : ""}
    ${packetOut ? packetResultView(packetOut) : ""}
  `;
}

function packetResultView(r: NonNullable<typeof packetOut>): string {
  const p = r.packet;
  const ok = r.verdict === "PACKET-SEALED";
  const points = p.points
    .map((pt) => {
      const code = pt.code ? (pt.code.irc ? `IRC ${pt.code.irc}` : pt.code.ibc ? `IBC ${pt.code.ibc}` : pt.code.name) : "no code";
      const rec = pt.record;
      const chip = rec
        ? rec.captureKind === "native-camera"
          ? `<span class="chip ok">SEALED</span>`
          : rec.captureKind === "web-camera"
            ? `<span class="chip warn">WEB CAMERA</span>`
            : `<span class="chip warn">ARRIVAL-ONLY</span>`
        : `<span class="chip bad">MISSING</span>`;
      return `<div class="slot"><div><div>${esc(pt.label)}</div><div class="meta">${esc(code)}${rec ? ` · ${esc(rec.sha256.slice(0, 16))}…` : ""}</div></div>${chip}</div>`;
    })
    .join("");
  return `
    <div class="card">
      <div class="row"><h2>${ok ? "Record intact" : r.verdict === "PACKET-TAMPERED" ? "Record altered" : "Not a Shield record"}</h2><span class="chip ${ok ? "ok" : "bad"}">${esc(r.verdict)}</span></div>
      <pre>${esc(r.reasons.join("\n"))}
hash   ${esc(p.integrity.hash)}
closed ${esc(p.closedAt)} by ${esc(p.closedBy.role)}
job    ${esc(p.job.title || p.job.id)} · ${esc(p.job.trade)}
device ${esc(p.deviceSealId)}</pre>
      <div class="slots">${points}</div>
      <p class="foot-note">Hash and signature recomputed from the file. ${ok ? "No field in this record has changed since it was frozen." : "Do not rely on this record."}</p>
    </div>
  `;
}

function specView(): string {
  return `
    <div class="card">
      <h2>Spec</h2>
      <div class="meta">
        Proven: SHA-256 on arrival · unmodified original · hash chain<br>
        Corroborated: locked pin score · motion later<br>
        Not proven: web origin · EXIF · unstaged scene · GPS anti-spoof<br>
        Fee does not move with verdict<br>
        standard $79 · extended $129 · major $199 · ${PRICING_EFFECTIVE}
      </div>
    </div>
    <p class="foot-note">Copy is a placeholder. Decide wording after you run the paths.</p>
    <button class="btn ghost" data-act="spec" style="margin-top:12px">CLOSE</button>
  `;
}

function bind(): void {
  const cam = document.getElementById("cam") as HTMLVideoElement | null;
  if (cam && camStream && cam.srcObject !== camStream) cam.srcObject = camStream;

  root().querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      stopWebCamera();
      tab = (el as HTMLElement).dataset.tab as Tab;
      specOpen = false;
      status = "";
      render();
    });
  });
  root().querySelectorAll("[data-act]").forEach((el) => {
    const act = (el as HTMLElement).dataset.act!;
    if (act.startsWith("c-")) return;
    el.addEventListener("click", () => void onAct(act));
  });
  root().querySelectorAll("[data-pack]").forEach((el) => {
    el.addEventListener("click", () => {
      selectedPack = (el as HTMLElement).dataset.pack as PackKind;
      render();
    });
  });
  root().querySelectorAll("[data-activate]").forEach((el) => {
    el.addEventListener("click", async () => {
      await setActiveJobId((el as HTMLElement).dataset.activate!);
      await reload();
      tab = "capture";
      render();
    });
  });
  root().querySelectorAll("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      openVaultId = (el as HTMLElement).dataset.open!;
      status = "";
      render();
    });
  });
  root().querySelectorAll("[data-slot]").forEach((el) => {
    el.addEventListener("click", () => void onSlot((el as HTMLElement).dataset.slot!));
  });
  if (tab === "construction") bindConstruction(ctx);

  const packSel = document.getElementById("pack-sel") as HTMLSelectElement | null;
  if (packSel) packSel.onchange = () => {
    selectedPack = packSel.value as PackKind;
    render();
  };
  const budgetEl = document.getElementById("budget") as HTMLInputElement | null;
  if (budgetEl) budgetEl.oninput = () => {
    budget = Number(budgetEl.value);
  };
  const customEl = document.getElementById("custom-n") as HTMLInputElement | null;
  if (customEl) customEl.oninput = () => {
    customCount = Number(customEl.value);
  };
  const lat = document.getElementById("pin-lat") as HTMLInputElement | null;
  const lng = document.getElementById("pin-lng") as HTMLInputElement | null;
  const rad = document.getElementById("pin-r") as HTMLInputElement | null;
  if (lat) lat.oninput = () => {
    pinLat = lat.value;
  };
  if (lng) lng.oninput = () => {
    pinLng = lng.value;
  };
  if (rad) rad.oninput = () => {
    pinR = rad.value;
  };

  const arrival = document.getElementById("file-arrival") as HTMLInputElement;
  arrival.onchange = async () => {
    const file = arrival.files?.[0];
    arrival.value = "";
    if (!file) return;
    const slot = pendingSlot;
    pendingSlot = null;
    const item = await arrivalHashFile(file, slot);
    await reload();
    openVaultId = item.record.id;
    tab = "vault";
    status = "ARRIVAL-ONLY · not an origin seal";
    render();
  };

  const bundle = document.getElementById("file-bundle") as HTMLInputElement;
  bundle.onchange = async () => {
    const file = bundle.files?.[0];
    bundle.value = "";
    if (!file) return;
    const text = await file.text();
    verifyOut = "";
    packetOut = null;
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      verifyOut = "NO-ORIGIN\nfile-unreadable";
      render();
      return;
    }
    if ((raw as { schema?: unknown })?.schema === "tradedeck.shield.completion.v2") {
      try {
        const packet = parseCloseoutPacket(text);
        const result = await verifyCloseoutPacket(packet);
        packetOut = { ...result, packet };
      } catch {
        verifyOut = "PACKET-UNREADABLE\nbad-packet";
      }
      render();
      return;
    }
    try {
      const parsed = parseBundle(text);
      const result = await verifyBundle(parsed);
      verifyOut = `${result.verdict}\n${result.reasons.join("\n")}\n${result.computedSha ?? ""}`;
    } catch {
      verifyOut = "NO-ORIGIN\nbundle-unreadable";
    }
    render();
  };
}

let pendingSlot: string | null = null;

async function onSlot(id: string): Promise<void> {
  const job = activeJob();
  const cp = job?.checkpoints.find((c) => c.id === id);
  if (cp?.shotId) {
    openVaultId = cp.shotId;
    tab = "vault";
    render();
    return;
  }
  if (isNativeOriginAvailable()) {
    const res = await captureNative(id);
    if ("error" in res) {
      status = res.error;
      render();
      return;
    }
    await reload();
    openVaultId = res.item.record.id;
    tab = "vault";
    status = res.item.record.attest.kind === "none" ? "SEALED bytes · attest pending" : "SEALED";
    render();
    return;
  }
  await openWebCamera(id);
}

async function openWebCamera(slot: string | null): Promise<void> {
  pendingSlot = slot;
  tab = "capture";
  specOpen = false;
  if (!navigator.mediaDevices?.getUserMedia) {
    status = "No in-page camera in this browser. Using the system camera.";
    fallbackCameraInput();
    return;
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    status = "";
    render();
  } catch {
    camStream = null;
    status = "Camera permission denied or unavailable. Using the system camera.";
    render();
    fallbackCameraInput();
  }
}

// `capture` forces the OS camera on phones; it is set only for this click so ARRIVAL HASH stays a plain picker.
function fallbackCameraInput(): void {
  const input = document.getElementById("file-arrival") as HTMLInputElement;
  input.setAttribute("capture", "environment");
  input.click();
  setTimeout(() => input.removeAttribute("capture"), 0);
}

function stopWebCamera(): void {
  if (!camStream) return;
  for (const t of camStream.getTracks()) t.stop();
  camStream = null;
}

async function shutter(): Promise<void> {
  const v = document.getElementById("cam") as HTMLVideoElement | null;
  if (!v || !camStream || !v.videoWidth) {
    status = "Camera not ready yet.";
    render();
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext("2d")!.drawImage(v, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) {
    status = "Could not read the frame.";
    render();
    return;
  }
  const slot = pendingSlot;
  pendingSlot = null;
  stopWebCamera();
  const item = await sealWebCameraFrame(blob, slot);
  await reload();
  openVaultId = item.record.id;
  tab = "vault";
  status = "WEB CAMERA · bytes sealed at the shutter · origin not proven";
  render();
}

async function onAct(act: string): Promise<void> {
  if (act === "spec") {
    specOpen = !specOpen;
    render();
    return;
  }
  if (act === "goto-jobs") {
    tab = "jobs";
    specOpen = false;
    render();
    return;
  }
  if (act === "goto-construction") {
    tab = "construction";
    specOpen = false;
    render();
    return;
  }
  if (act === "native") {
    const res = await captureNative(null);
    if ("error" in res) {
      status = res.error === "not-native" ? "not-native · use arrival hash or the iOS/Android wrap" : res.error;
      render();
      return;
    }
    await reload();
    openVaultId = res.item.record.id;
    tab = "vault";
    render();
    return;
  }
  if (act === "arrival") {
    pendingSlot = null;
    (document.getElementById("file-arrival") as HTMLInputElement).click();
    return;
  }
  if (act === "webcam") {
    await openWebCamera(null);
    return;
  }
  if (act === "shutter") {
    await shutter();
    return;
  }
  if (act === "cam-off") {
    stopWebCamera();
    pendingSlot = null;
    status = "";
    render();
    return;
  }
  if (act === "lock") {
    const fee = feeForBudget(budget);
    const lat = Number(pinLat);
    const lng = Number(pinLng);
    const radiusM = Number(pinR);
    const pin =
      Number.isFinite(lat) && Number.isFinite(lng) && pinLat !== "" && pinLng !== ""
        ? { lat, lng, radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : 200 }
        : null;
    const job: Job = {
      id: crypto.randomUUID(),
      pack: selectedPack,
      customCount,
      budgetUsd: budget,
      feeUsd: fee.feeUsd,
      feeTier: fee.feeTier,
      lockedAt: new Date().toISOString(),
      pin,
      checkpoints: makeCheckpoints(selectedPack, customCount),
    };
    await putJob(job);
    await setActiveJobId(job.id);
    await reload();
    tab = "capture";
    status = `locked ${job.pack} · $${job.feeUsd}`;
    render();
    return;
  }
  if (act === "vault-back") {
    openVaultId = null;
    status = "";
    render();
    return;
  }
  if (act === "rehash" && openVaultId) {
    const item = vault.find((v) => v.record.id === openVaultId);
    if (!item) return;
    const result = await verifyItemOriginal(item.record, item.originalB64);
    status = `${result.verdict} · ${result.reasons.join(", ")}`;
    render();
    return;
  }
  if (act === "export" && openVaultId) {
    const item = vault.find((v) => v.record.id === openVaultId);
    if (!item) return;
    const bundle = { version: 1 as const, record: item.record, originalB64: item.originalB64 };
    const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${item.record.id}.shield.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  if (act === "pick-bundle") {
    (document.getElementById("file-bundle") as HTMLInputElement).click();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
