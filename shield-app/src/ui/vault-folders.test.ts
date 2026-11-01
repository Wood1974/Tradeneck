import { describe, expect, it } from "vitest";
import { folderCardsHtml, folderTitle, groupVault } from "./vault-folders";
import type { Job, VaultItem } from "../types";

const job = (id: string, over: Partial<Job> = {}): Job => ({ id, pack: "remodel", customCount: 0, budgetUsd: 0, lockedAt: "2026-10-01T00:00:00Z", checkpoints: [], closedAt: null, ...over });
const photo = (id: string, jobId: string | null): VaultItem => ({ record: { id, jobId, createdAt: "2026-10-02T00:00:00Z" } } as unknown as VaultItem);

describe("completed jobs get a folder; everything else stays in the open list", () => {
  it("files photos of a closed job under that job and leaves the rest open", () => {
    const vault = [photo("a", "j1"), photo("b", "j2"), photo("c", null), photo("d", "j1")];
    const { open, folders } = groupVault(vault, [job("j1", { closedAt: "2026-10-05T00:00:00Z" }), job("j2")]);
    expect(open.map((v) => v.record.id)).toEqual(["b", "c"]);
    expect(folders).toHaveLength(1);
    expect(folders[0]!.job.id).toBe("j1");
    expect(folders[0]!.items.map((v) => v.record.id)).toEqual(["a", "d"]);
  });
  it("keeps a photo whose job this phone does not know in the open list instead of losing it", () => {
    const { open, folders } = groupVault([photo("a", "gone")], [job("j1", { closedAt: "2026-10-05T00:00:00Z" })]);
    expect(open.map((v) => v.record.id)).toEqual(["a"]);
    expect(folders[0]!.items).toEqual([]);
  });
  it("lists the most recently completed job first", () => {
    const { folders } = groupVault([], [job("old", { closedAt: "2026-09-01T00:00:00Z" }), job("new", { closedAt: "2026-10-20T00:00:00Z" })]);
    expect(folders.map((f) => f.job.id)).toEqual(["new", "old"]);
  });
  it("never drops or duplicates a photo", () => {
    const vault = [photo("a", "j1"), photo("b", null), photo("c", "j2")];
    const { open, folders } = groupVault(vault, [job("j1", { closedAt: "2026-10-05T00:00:00Z" }), job("j2", { closedAt: "2026-10-06T00:00:00Z" })]);
    const all = [...open, ...folders.flatMap((f) => f.items)].map((v) => v.record.id).sort();
    expect(all).toEqual(["a", "b", "c"]);
  });
});

describe("folder names and cards", () => {
  it("is named by the job's title, else by its kind and id", () => {
    expect(folderTitle(job("1234567890", { brief: { title: "  Smith kitchen " } as Job["brief"] }))).toBe("Smith kitchen");
    expect(folderTitle(job("1234567890"))).toBe("REMODEL job 12345678");
  });
  it("escapes a job title and counts photos", () => {
    const html = folderCardsHtml([{ job: job("j1"), title: "<b>x</b>", closedAt: "2026-10-05T00:00:00Z", items: [photo("a", "j1")] }]);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("1 photo ·");
    expect(html).toContain('data-folder="j1"');
  });
  it("shows no heading when there are no completed jobs", () => {
    expect(folderCardsHtml([])).toBe("");
  });
});
