import { codesForTrade, CODE_CHECKPOINTS, CODE_TRADE_ORDER, toCodeRef, type CodeCheckpoint } from "../construction/codes";
import { buildCloseoutPacket, downloadPacketFiles, missingPoints, submitCloseout } from "../construction/closeout";
import { generatePoints, lockedNarrative } from "../construction/points";
import { neededQuestions, type Question } from "../construction/questions";
import { BRIEF_READY_SCORE, scoreBrief } from "../construction/score";
import { detectTrade, labelForTrade, TRADES } from "../construction/trades";
import { feeForBudget } from "../pricing";
import { getCloseout, getMeta, putCloseout, putJob, setMeta } from "../store/db";
import type { BudgetBand, BriefRole, CloseoutPacket, ConstructionBrief, ConstructionBriefDraft, Job, TradeId, VaultItem } from "../types";

export interface ConstructionCtx {
  jobs(): Job[];
  vault(): VaultItem[];
  activeId(): string | null;
  setActive(id: string): Promise<void>;
  reload(): Promise<void>;
  render(): void;
}

type CView = "brief" | "points" | "codes" | "close";
type Phase = "intake" | "questions";

const API_BASE = "https://tradedeck-api.onrender.com";
const DRAFT_KEY = "construction:draft";

const BUDGET_USD: Record<BudgetBand, number> = { "": 0, under15: 5000, "15to50": 20000, over50: 50000 };

let cview: CView = "brief";
let phase: Phase = "intake";
let draft: ConstructionBriefDraft = emptyDraft();
let pickingFor: string | null = null;
let showAllCodes = false;
let closeRole = "homeowner";
let closeNotes = "";
let allowMissing = false;
let downloadHtml = false;
let closeStatus = "";
let lastPacket: CloseoutPacket | null = null;
let briefStatus = "";

function emptyDraft(): ConstructionBriefDraft {
  return { role: "homeowner", title: "", trade: "", budgetBand: "", description: "", include: "", exclude: "", answers: {} };
}

export async function initConstruction(): Promise<void> {
  const saved = await getMeta<ConstructionBriefDraft>(DRAFT_KEY);
  if (saved) draft = { ...emptyDraft(), ...saved };
}

async function saveDraft(): Promise<void> {
  await setMeta(DRAFT_KEY, draft);
}

function activeConstructionJob(ctx: ConstructionCtx): Job | undefined {
  const job = ctx.jobs().find((j) => j.id === ctx.activeId());
  return job?.pack === "construction" ? job : undefined;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function opt(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
}

export function constructionView(ctx: ConstructionCtx): string {
  const job = activeConstructionJob(ctx);
  const nav = (["brief", "points", "codes", "close"] as CView[])
    .map((v) => `<button data-cview="${v}" class="${cview === v ? "on" : ""}">${v.toUpperCase()}</button>`)
    .join("");
  let body: string;
  if (cview === "points") body = pointsView(ctx, job);
  else if (cview === "codes") body = codesView(job);
  else if (cview === "close") body = closeView(ctx, job);
  else body = briefView(job);
  return `<div class="packs cnav">${nav}</div>${body}`;
}

/* ---------- Brief ---------- */

function briefView(job: Job | undefined): string {
  const scored = scoreBrief(draft);
  const detected = draft.trade || (draft.description ? detectTrade(draft.description) : "");
  const { list } = neededQuestions({ ...draft, trade: detected });
  const showQs = phase === "questions";
  const meterColor = scored.score >= BRIEF_READY_SCORE ? "var(--ok)" : scored.score >= 40 ? "var(--warn)" : "var(--bad)";

  const locked = job?.brief
    ? `<div class="banner"><strong>LOCKED BRIEF</strong>${esc(job.brief.title || "Untitled")} · ${esc(labelForTrade(job.brief.trade))} · $${job.feeUsd} ${job.feeTier}
        <div class="meta">Locked ${esc(job.brief.lockedAt.slice(0, 16).replace("T", " "))}. Re-locking below keeps sealed photos on their point numbers.</div>
        <div><button data-act="c-goto-points">Open the 5 points</button></div></div>`
    : `<div class="banner"><strong>PROTECT THE WORK</strong>Describe the job. Thin write-ups get locking questions. Locking generates 5 photo checkpoints with code references.</div>`;

  return `
    ${locked}
    <div class="form">
      <label>WHO IS WRITING THIS BRIEF</label>
      <div class="packs roles">${(["homeowner", "sub", "gc"] as BriefRole[])
        .map((r) => `<button data-role="${r}" class="${draft.role === r ? "on" : ""}">${r === "gc" ? "GENERAL CONTRACTOR" : r === "sub" ? "SUBCONTRACTOR" : "HOMEOWNER"}</button>`)
        .join("")}</div>
      <label>JOB TITLE</label>
      <input id="c-title" placeholder="e.g. Tear-off reroof — 872 High Country Ln" value="${esc(draft.title)}" />
      <label>TRADE</label>
      <select id="c-trade">${opt("", detected ? `Auto: ${labelForTrade(detected as TradeId)}` : "Auto-detect from description", draft.trade)}${TRADES.map((t) => opt(t.id, t.label, draft.trade)).join("")}</select>
      <label>BUDGET BAND (SETS SHIELD FEE)</label>
      <select id="c-budget">${opt("", "Not set", draft.budgetBand)}${opt("under15", "Under $15,000", draft.budgetBand)}${opt("15to50", "$15,000 – $50,000", draft.budgetBand)}${opt("over50", "Over $50,000", draft.budgetBand)}</select>
      <label>DESCRIBE THE WORK TO PROTECT</label>
      <textarea id="c-desc" rows="5" placeholder="What is being built or replaced, where, with what material, what comes out, what is finished when you are done.">${esc(draft.description)}</textarea>
      <div class="meter"><span style="width:${scored.score}%;background:${meterColor}"></span></div>
      <div class="meta">Brief strength ${scored.score}/100 — ${scored.ready ? "enough to generate checkpoints." : "need sharper detail before 5 points."}</div>
      <div class="chips">${scored.chips.map((c) => `<span class="chip ${c.ok ? "ok" : "warn"}">${esc(c.label)}</span>`).join("")}</div>
      ${showQs ? "" : `<button class="btn" data-act="c-next">${scored.ready ? (job ? "RE-LOCK & REGENERATE 5 POINTS" : "LOCK BRIEF & GENERATE 5 POINTS") : "ASK LOCKING QUESTIONS"}</button>`}
      ${briefStatus ? `<p class="foot-note">${esc(briefStatus)}</p>` : ""}
    </div>
    ${showQs ? questionsView(list, job) : ""}
  `;
}

function questionsView(list: Question[], job: Job | undefined): string {
  return `
    <div class="card" id="c-questions">
      <h2>Lock the exact work</h2>
      <div class="meta">The write-up is not specific enough for photo checkpoints. Answer these so homeowner, sub, and GC are pointing at the same job.</div>
      <div class="form">
        ${list.map(questionField).join("")}
        <button class="btn" data-act="c-lock">${job ? "RE-LOCK & REGENERATE 5 POINTS" : "GENERATE 5 SHIELD POINTS"}</button>
        <button class="btn ghost" data-act="c-back">BACK TO DESCRIPTION</button>
      </div>
    </div>`;
}

function questionField(q: Question): string {
  const current = draft.answers[q.id];
  const head = `<label>${esc(q.q.toUpperCase())}</label><div class="meta">${esc(q.why)}</div>`;
  if (q.type === "text" || !q.options) {
    const v = q.id === "include" ? draft.include : q.id === "exclude" ? draft.exclude : typeof current === "string" ? current : "";
    return `<div class="q">${head}<input data-q="${esc(q.id)}" placeholder="${esc(q.placeholder ?? "")}" value="${esc(v)}" /></div>`;
  }
  if (q.multi) {
    const set = new Set(Array.isArray(current) ? current : []);
    return `<div class="q">${head}${q.options
      .map((o) => `<label class="check"><input type="checkbox" data-qm="${esc(q.id)}" value="${esc(o)}" ${set.has(o) ? "checked" : ""}/> ${esc(o)}</label>`)
      .join("")}</div>`;
  }
  const v = typeof current === "string" ? current : "";
  return `<div class="q">${head}<select data-q="${esc(q.id)}">${opt("", "Select", v)}${q.options.map((o) => opt(o, o, v)).join("")}</select></div>`;
}

/* ---------- Points ---------- */

function pointsView(ctx: ConstructionCtx, job: Job | undefined): string {
  if (!job?.brief) {
    return `<div class="banner"><strong>NO LOCKED BRIEF</strong>Lock a brief first. The 5 points come from it.<div><button data-act="c-goto-brief">Open brief</button></div></div>`;
  }
  const vault = ctx.vault();
  const rows = job.checkpoints
    .map((c, i) => {
      const rec = c.shotId ? vault.find((v) => v.record.id === c.shotId)?.record : undefined;
      const chip = rec
        ? rec.captureKind === "native-camera"
          ? `<span class="chip ok">SEALED</span>`
          : `<span class="chip warn">ARRIVAL-ONLY</span>`
        : `<span class="chip">EMPTY</span>`;
      const code = c.code
        ? `${c.code.irc ? "IRC " + esc(c.code.irc) : c.code.ibc ? "IBC " + esc(c.code.ibc) : ""} · ${esc(c.code.name)}`
        : "NO CODE REFERENCE · TAP TO ASSIGN";
      return `<div class="card point">
        <div class="row"><h2>Point ${i + 1}</h2>${chip}</div>
        <input data-pt-label="${esc(c.id)}" value="${esc(c.label)}" />
        <textarea data-pt-desc="${esc(c.id)}" rows="3">${esc(c.description ?? "")}</textarea>
        <div class="row">
          <button class="code-chip" data-pick-code="${esc(c.id)}">${code}</button>
          <button class="btn small ${rec ? "ghost" : ""}" data-slot="${esc(c.id)}">${rec ? "VIEW" : "SEAL"}</button>
        </div>
        ${rec ? `<div class="meta">${esc(rec.sha256.slice(0, 16))}… · ${esc(rec.createdAt.slice(0, 16).replace("T", " "))}</div>` : ""}
      </div>`;
    })
    .join("");
  const sealed = job.checkpoints.filter((c) => c.shotId).length;
  return `
    <div class="banner"><strong>5 PHOTO CHECKPOINTS</strong>${esc(job.brief.title || "Untitled")} · ${esc(labelForTrade(job.brief.trade))} · ${sealed}/${job.checkpoints.length} sealed
      <div class="meta">Edit a label if a point is wrong. SEAL opens the camera on native, arrival hash on web. Each photo is hashed, chained, and signed by this device.</div>
    </div>
    <div class="list">${rows}</div>
    <div class="actions"><button class="btn ghost small" data-act="c-goto-close">CLOSE THIS JOB</button></div>
  `;
}

/* ---------- Codes ---------- */

function codesView(job: Job | undefined): string {
  const trade = job?.brief?.trade ?? draft.trade;
  const rows = showAllCodes || !trade ? CODE_CHECKPOINTS : codesForTrade(trade);
  const picking = pickingFor && job ? job.checkpoints.find((c) => c.id === pickingFor) : undefined;
  const groups = CODE_TRADE_ORDER.map((t) => {
    const items = rows.filter((r) => r.trade === t);
    if (!items.length) return "";
    return `<div class="card">
      <h2>${esc(t)}</h2>
      ${items.map((r) => codeRow(r, picking)).join("")}
    </div>`;
  }).join("");
  return `
    <div class="banner"><strong>${picking ? `ASSIGN CODE TO “${esc(picking.label).toUpperCase()}”` : "IRC / IBC CHECKPOINTS"}</strong>
      ${picking ? "Tap a section to attach it to the point." : "Code sections tied to what must be photographed before concealment. Offline table; same rows as the Shield database."}
      <div>${trade ? `<button data-act="c-toggle-codes">${showAllCodes ? `Only ${esc(labelForTrade(trade))}` : "All trades"}</button>` : ""}
      ${picking ? `<button data-act="c-clear-code">No code for this point</button> <button data-act="c-cancel-pick">Cancel</button>` : ""}</div>
    </div>
    <div class="list">${groups}</div>
  `;
}

function codeRow(r: CodeCheckpoint, picking: Job["checkpoints"][number] | undefined): string {
  const tag = r.irc && r.irc !== "General" ? `IRC ${esc(r.irc)}` : r.ibc ? `IBC ${esc(r.ibc)}` : "GENERAL";
  const attr = picking ? `data-assign-code="${esc(r.irc ?? "")}|${esc(r.name)}"` : "";
  const on = picking?.code?.name === r.name ? " on" : "";
  return `<button class="slot code-row${on}" ${attr} ${picking ? "" : "disabled"}>
    <div>
      <div><span class="chip ${r.requiredBeforeConcealment ? "warn" : ""}">${tag}</span> ${esc(r.name)}</div>
      <div class="meta">${esc(r.description)}</div>
      <div class="meta">Photo: ${esc(r.photoGuidance)}${r.requiredBeforeConcealment ? " · before concealment" : ""}</div>
    </div>
  </button>`;
}

/* ---------- Close ---------- */

function closeView(ctx: ConstructionCtx, job: Job | undefined): string {
  if (!job?.brief) {
    return `<div class="banner"><strong>NOTHING TO CLOSE</strong>Lock a brief and seal its points first.<div><button data-act="c-goto-brief">Open brief</button></div></div>`;
  }
  const vault = ctx.vault();
  const missing = missingPoints(job, (id) => vault.find((v) => v.record.id === id)?.record);
  const hasSb = Boolean((globalThis as { sb?: unknown }).sb);
  const packet = lastPacket && lastPacket.job.id === job.id ? lastPacket : null;
  return `
    <div class="banner"><strong>FREEZE A LOCKTIGHT RECORD</strong>Brief, 5 points, every sealed photo's hash and signature, counts and notes — hashed and signed by this device. The record stays on this device unless you send it.
      ${job.closedAt ? `<div class="meta">Already closed ${esc(job.closedAt.slice(0, 16).replace("T", " "))}. Freezing again issues a new packet.</div>` : ""}
    </div>
    <div class="form">
      <label>CLOSED BY</label>
      <select id="c-close-role">${opt("homeowner", "Homeowner", closeRole)}${opt("sub", "Subcontractor", closeRole)}${opt("gc", "General contractor", closeRole)}${opt("admin", "Admin", closeRole)}</select>
      <label>CLOSE NOTES</label>
      <textarea id="c-close-notes" rows="3" placeholder="Punch remaining, extras, who accepted the work.">${esc(closeNotes)}</textarea>
      <label class="check"><input type="checkbox" id="c-allow-missing" ${allowMissing ? "checked" : ""}/> Allow close with ${missing.length} unsealed point${missing.length === 1 ? "" : "s"} (gaps are filed as gaps)</label>
      <label class="check"><input type="checkbox" id="c-dl-html" ${downloadHtml ? "checked" : ""}/> Also save a readable HTML copy</label>
      <button class="btn" data-act="c-freeze">FREEZE RECORD</button>
      ${closeStatus ? `<p class="foot-note">${esc(closeStatus)}</p>` : ""}
    </div>
    ${packet ? `<div class="card">
      <h2>Record ${esc(packet.integrity.hash.slice(0, 12))}…</h2>
      <pre>${esc(packet.integrity.hash)}
closed ${esc(packet.closedAt)} by ${esc(packet.closedBy.role)}
${packet.counts.sealed}/${packet.counts.points} sealed · ${packet.counts.missing} missing
device ${esc(packet.deviceSealId)}</pre>
      <div class="actions">
        <button class="btn small ghost" data-act="c-download">DOWNLOAD AGAIN</button>
        ${hasSb ? `<button class="btn small ghost" data-act="c-send">SEND TO ADMIN</button>` : ""}
      </div>
    </div>` : ""}
  `;
}

/* ---------- Bind ---------- */

export function bindConstruction(ctx: ConstructionCtx): void {
  const root = document.getElementById("app")!;
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);

  root.querySelectorAll<HTMLElement>("[data-cview]").forEach((el) => {
    el.addEventListener("click", () => {
      cview = el.dataset.cview as CView;
      if (cview !== "codes") pickingFor = null;
      ctx.render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-role]").forEach((el) => {
    el.addEventListener("click", () => {
      draft.role = el.dataset.role as BriefRole;
      void saveDraft();
      ctx.render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-act]").forEach((el) => {
    const act = el.dataset.act!;
    if (!act.startsWith("c-")) return;
    el.addEventListener("click", () => void onAct(ctx, act));
  });

  const title = q<HTMLInputElement>("#c-title");
  if (title) title.oninput = () => { draft.title = title.value; void saveDraft(); };
  const trade = q<HTMLSelectElement>("#c-trade");
  if (trade) trade.onchange = () => { draft.trade = trade.value as TradeId | ""; void saveDraft(); ctx.render(); };
  const budget = q<HTMLSelectElement>("#c-budget");
  if (budget) budget.onchange = () => { draft.budgetBand = budget.value as BudgetBand; void saveDraft(); };
  const desc = q<HTMLTextAreaElement>("#c-desc");
  if (desc) {
    desc.oninput = () => { draft.description = desc.value; void saveDraft(); refreshMeter(root); };
  }

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-q]").forEach((el) => {
    el.oninput = () => setAnswer(el.dataset.q!, el.value);
    el.onchange = () => setAnswer(el.dataset.q!, el.value);
  });
  root.querySelectorAll<HTMLInputElement>("[data-qm]").forEach((el) => {
    el.onchange = () => {
      const id = el.dataset.qm!;
      const arr = new Set(Array.isArray(draft.answers[id]) ? (draft.answers[id] as string[]) : []);
      if (el.checked) arr.add(el.value);
      else arr.delete(el.value);
      draft.answers[id] = [...arr];
      void saveDraft();
    };
  });

  const job = activeConstructionJob(ctx);
  root.querySelectorAll<HTMLInputElement>("[data-pt-label]").forEach((el) => {
    el.onchange = () => void editPoint(ctx, job, el.dataset.ptLabel!, { label: el.value });
  });
  root.querySelectorAll<HTMLTextAreaElement>("[data-pt-desc]").forEach((el) => {
    el.onchange = () => void editPoint(ctx, job, el.dataset.ptDesc!, { description: el.value });
  });
  root.querySelectorAll<HTMLElement>("[data-pick-code]").forEach((el) => {
    el.addEventListener("click", () => {
      pickingFor = el.dataset.pickCode!;
      cview = "codes";
      ctx.render();
    });
  });
  root.querySelectorAll<HTMLElement>("[data-assign-code]").forEach((el) => {
    el.addEventListener("click", () => {
      const [irc, name] = el.dataset.assignCode!.split("|");
      const row = CODE_CHECKPOINTS.find((c) => c.name === name && (c.irc ?? "") === irc);
      if (!row || !pickingFor) return;
      void editPoint(ctx, job, pickingFor, { code: toCodeRef(row) }).then(() => {
        pickingFor = null;
        cview = "points";
        ctx.render();
      });
    });
  });

  const role = q<HTMLSelectElement>("#c-close-role");
  if (role) role.onchange = () => { closeRole = role.value; };
  const notes = q<HTMLTextAreaElement>("#c-close-notes");
  if (notes) notes.oninput = () => { closeNotes = notes.value; };
  const allow = q<HTMLInputElement>("#c-allow-missing");
  if (allow) allow.onchange = () => { allowMissing = allow.checked; };
  const dl = q<HTMLInputElement>("#c-dl-html");
  if (dl) dl.onchange = () => { downloadHtml = dl.checked; };
}

function refreshMeter(root: HTMLElement): void {
  const s = scoreBrief(draft);
  const bar = root.querySelector<HTMLElement>(".meter > span");
  if (bar) {
    bar.style.width = `${s.score}%`;
    bar.style.background = s.score >= BRIEF_READY_SCORE ? "var(--ok)" : s.score >= 40 ? "var(--warn)" : "var(--bad)";
  }
  const meta = bar?.parentElement?.nextElementSibling;
  if (meta) meta.textContent = `Brief strength ${s.score}/100 — ${s.ready ? "enough to generate checkpoints." : "need sharper detail before 5 points."}`;
  const chips = root.querySelector<HTMLElement>(".form .chips");
  if (chips) chips.innerHTML = s.chips.map((c) => `<span class="chip ${c.ok ? "ok" : "warn"}">${esc(c.label)}</span>`).join("");
  const next = root.querySelector<HTMLElement>('[data-act="c-next"]');
  if (next) next.textContent = s.ready ? "LOCK BRIEF & GENERATE 5 POINTS" : "ASK LOCKING QUESTIONS";
}

function setAnswer(id: string, value: string): void {
  draft.answers[id] = value;
  if (id === "include") draft.include = value;
  if (id === "exclude") draft.exclude = value;
  void saveDraft();
}

async function editPoint(ctx: ConstructionCtx, job: Job | undefined, id: string, patch: Partial<Job["checkpoints"][number]>): Promise<void> {
  if (!job) return;
  job.checkpoints = job.checkpoints.map((c) => (c.id === id ? { ...c, ...patch } : c));
  await putJob(job);
  await ctx.reload();
}

async function lockBrief(ctx: ConstructionCtx): Promise<void> {
  const trade: TradeId = draft.trade || detectTrade(draft.description);
  const full = { ...draft, trade };
  const brief: ConstructionBrief = { ...full, lockedText: lockedNarrative(full), lockedAt: new Date().toISOString() };
  const points = generatePoints(full);
  const fee = feeForBudget(BUDGET_USD[draft.budgetBand]);
  const existing = activeConstructionJob(ctx);
  const job: Job = existing
    ? {
        ...existing,
        brief,
        feeUsd: fee.feeUsd,
        feeTier: fee.feeTier,
        budgetUsd: BUDGET_USD[draft.budgetBand],
        checkpoints: points.map((p, i) => ({ ...p, shotId: existing.checkpoints[i]?.shotId ?? null })),
      }
    : {
        id: crypto.randomUUID(),
        pack: "construction",
        customCount: 5,
        budgetUsd: BUDGET_USD[draft.budgetBand],
        feeUsd: fee.feeUsd,
        feeTier: fee.feeTier,
        lockedAt: brief.lockedAt,
        pin: null,
        checkpoints: points,
        brief,
        closedAt: null,
      };
  await putJob(job);
  await ctx.setActive(job.id);
  await ctx.reload();
  phase = "intake";
  briefStatus = "";
  cview = "points";
  ctx.render();
}

async function onAct(ctx: ConstructionCtx, act: string): Promise<void> {
  if (act === "c-goto-brief") { cview = "brief"; ctx.render(); return; }
  if (act === "c-goto-points") { cview = "points"; ctx.render(); return; }
  if (act === "c-goto-close") { cview = "close"; ctx.render(); return; }
  if (act === "c-back") { phase = "intake"; ctx.render(); return; }
  if (act === "c-toggle-codes") { showAllCodes = !showAllCodes; ctx.render(); return; }
  if (act === "c-cancel-pick") { pickingFor = null; cview = "points"; ctx.render(); return; }
  if (act === "c-clear-code") {
    const job = activeConstructionJob(ctx);
    if (pickingFor) await editPoint(ctx, job, pickingFor, { code: null });
    pickingFor = null;
    cview = "points";
    ctx.render();
    return;
  }
  if (act === "c-next") {
    if (!draft.description.trim()) {
      briefStatus = "Describe the work first.";
      ctx.render();
      return;
    }
    if (!scoreBrief(draft).ready) {
      phase = "questions";
      ctx.render();
      document.getElementById("c-questions")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    await lockBrief(ctx);
    return;
  }
  if (act === "c-lock") { await lockBrief(ctx); return; }
  if (act === "c-freeze") {
    const job = activeConstructionJob(ctx);
    if (!job) return;
    const vault = ctx.vault();
    const recordFor = (id: string) => vault.find((v) => v.record.id === id)?.record;
    const missing = missingPoints(job, recordFor);
    if (missing.length && !allowMissing) {
      closeStatus = `${missing.length} point${missing.length === 1 ? "" : "s"} unsealed. Seal them, or check “allow close” to file the gaps.`;
      ctx.render();
      return;
    }
    closeStatus = "Building packet…";
    ctx.render();
    try {
      const packet = await buildCloseoutPacket({ job, role: closeRole, notes: closeNotes, recordFor });
      await putCloseout(job.id, packet);
      job.closedAt = packet.closedAt;
      await putJob(job);
      await ctx.reload();
      lastPacket = packet;
      downloadPacketFiles(packet, downloadHtml);
      closeStatus = `Record frozen. Hash ${packet.integrity.hash.slice(0, 12)}… saved on this device and downloaded.`;
    } catch (err) {
      closeStatus = err instanceof Error ? err.message : "Could not build packet.";
    }
    ctx.render();
    return;
  }
  if (act === "c-download" && lastPacket) {
    downloadPacketFiles(lastPacket, downloadHtml);
    return;
  }
  if (act === "c-send" && lastPacket) {
    closeStatus = "Sending to admin…";
    ctx.render();
    const res = await submitCloseout(lastPacket, API_BASE);
    closeStatus = res.ok ? "Admin copy sent." : `Not sent (${res.error}). The record on this device is unchanged.`;
    ctx.render();
  }
}

export async function restoreLastPacket(jobId: string | null): Promise<void> {
  if (!jobId) return;
  const packet = (await getCloseout(jobId)) as CloseoutPacket | undefined;
  if (packet?.schema === "tradedeck.shield.completion.v2") lastPacket = packet;
}
