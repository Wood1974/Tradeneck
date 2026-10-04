import type { Checkpoint, PackKind } from "./types";

const PACKS: Record<Exclude<PackKind, "custom" | "construction">, string[]> = {
  remodel: ["Arrival", "Existing", "Demo", "Rough", "Closeout"],
  draw: ["Site", "Foundation", "Frame", "MEP", "Final"],
  unit: ["Exterior", "Entry", "Kitchen", "Bath", "Damage"],
  loss: ["Address", "Overview", "Cause", "Detail", "Adjacent"],
  shop: ["Arrival", "Material", "Install", "QC", "Done"],
};

export function packLabels(kind: PackKind, customCount = 8): string[] {
  if (kind === "construction") {
    throw new Error("construction checkpoints come from the brief engine, not a fixed pack");
  }
  if (kind === "custom") {
    const n = Math.min(20, Math.max(5, Math.round(customCount)));
    return Array.from({ length: n }, (_, i) => `Shot ${i + 1}`);
  }
  return PACKS[kind];
}

export function makeCheckpoints(kind: PackKind, customCount = 8): Checkpoint[] {
  return packLabels(kind, customCount).map((label, i) => ({
    id: `${kind}-${i + 1}`,
    label,
    required: true,
    shotId: null,
  }));
}

export const PACK_ORDER: PackKind[] = ["remodel", "draw", "unit", "loss", "shop", "custom"];
