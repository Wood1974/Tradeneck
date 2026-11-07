// Completed jobs get a folder of their own in the Vault: the job's photos and its completion record in one place.
// A job counts as completed once it has been closed out (`closedAt` is set). Photos of jobs still open, and photos with no job,
// stay in the open list. Nothing here changes a stored record: it only decides where a photo is listed.
import { esc } from "../esc";
import type { Job, VaultItem } from "../types";
import { shownTime } from "./time-format";

export interface JobFolder {
  job: Job;
  title: string;
  closedAt: string;
  items: VaultItem[];
}

export function folderTitle(job: Job): string {
  const named = job.brief?.title?.trim();
  return named || `${job.pack.toUpperCase()} job ${job.id.slice(0, 8)}`;
}

/** Splits the Vault into photos still being worked on and one folder per completed job (most recently completed first). */
export function groupVault(vault: VaultItem[], jobs: Job[]): { open: VaultItem[]; folders: JobFolder[] } {
  const completed = new Map(jobs.filter((j) => j.closedAt).map((j) => [j.id, j]));
  const byJob = new Map<string, VaultItem[]>();
  const open: VaultItem[] = [];
  for (const item of vault) {
    const id = item.record.jobId;
    if (id && completed.has(id)) byJob.set(id, [...(byJob.get(id) ?? []), item]);
    else open.push(item);
  }
  const folders = [...completed.values()]
    .map((job) => ({ job, title: folderTitle(job), closedAt: job.closedAt as string, items: byJob.get(job.id) ?? [] }))
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  return { open, folders };
}

export function folderCardsHtml(folders: JobFolder[]): string {
  if (!folders.length) return "";
  return `<h2 class="meta" style="margin-top:18px">COMPLETED JOBS</h2><div class="list">${folders
    .map(
      (f) => `<button class="card" data-folder="${esc(f.job.id)}" style="width:100%;text-align:left">
          <div class="row"><h2>${esc(f.title)}</h2><span class="chip ok">COMPLETED</span></div>
          <div class="meta">${f.items.length} photo${f.items.length === 1 ? "" : "s"} · completed ${esc(shownTime(f.closedAt))}</div>
        </button>`,
    )
    .join("")}</div>`;
}

export function folderHeaderHtml(f: JobFolder): string {
  return `
    <button class="btn ghost small" data-act="folder-back">BACK TO VAULT</button>
    <div class="card">
      <div class="row"><h2>${esc(f.title)}</h2><span class="chip ok">COMPLETED</span></div>
      <div class="meta">${f.items.length} photo${f.items.length === 1 ? "" : "s"} · completed ${esc(shownTime(f.closedAt))}</div>
      <div class="actions"><button class="btn small" data-act="folder-record">DOWNLOAD COMPLETION RECORD</button></div>
    </div>`;
}
