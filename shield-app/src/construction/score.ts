import type { ConstructionBriefDraft } from "../types";
import { TRADE_WORDS } from "./trades";

export interface BriefChip {
  ok: boolean;
  label: string;
}

export interface BriefScore {
  score: number;
  chips: BriefChip[];
  ready: boolean;
}

export const BRIEF_READY_SCORE = 70;

export function scoreBrief(draft: ConstructionBriefDraft): BriefScore {
  const text = `${draft.title || ""} ${draft.description || ""}`.trim();
  const lower = text.toLowerCase();
  const chips: BriefChip[] = [];
  let score = 0;

  const longEnough = text.replace(/\s+/g, " ").length >= 80;
  if (longEnough) {
    score += 20;
    chips.push({ ok: true, label: "Enough detail" });
  } else chips.push({ ok: false, label: "Too short" });

  const hasMeasure = /\d/.test(text) || /\b(sq|sf|square|squares|ton|amp|yard|lf|lin|ft)\b/i.test(text);
  if (hasMeasure) {
    score += 15;
    chips.push({ ok: true, label: "Size / quantity" });
  } else chips.push({ ok: false, label: "No size / quantity" });

  const hasMaterial = /\b(shingle|metal|tile|pex|copper|lvp|hardwood|wrap|membrane|quartz|granite|pvc|osb|plywood)\b/i.test(lower);
  if (hasMaterial) {
    score += 15;
    chips.push({ ok: true, label: "Material" });
  } else chips.push({ ok: false, label: "No material" });

  const hasPlace = /\b(roof|kitchen|bath|garage|east|west|north|south|front|rear|elevation|address|street)\b/i.test(lower);
  if (hasPlace) {
    score += 10;
    chips.push({ ok: true, label: "Location" });
  } else chips.push({ ok: false, label: "No location" });

  const hasAction = /\b(tear|replace|install|remove|repipe|rewire|frame|pour|flash|demo|build|convert)\b/i.test(lower);
  if (hasAction) {
    score += 15;
    chips.push({ ok: true, label: "Action" });
  } else chips.push({ ok: false, label: "No action verb" });

  const tradeHits = Object.values(TRADE_WORDS).flat().filter((w) => lower.includes(w)).length;
  if (tradeHits >= 2) {
    score += 15;
    chips.push({ ok: true, label: "Trade terms" });
  } else chips.push({ ok: false, label: "Vague trade" });

  if ((draft.exclude || "").trim().length > 3) {
    score += 10;
    chips.push({ ok: true, label: "Exclusions" });
  }

  for (const v of Object.values(draft.answers || {})) {
    if (v && String(v).trim()) score += 4;
  }

  score = Math.min(100, score);
  return { score, chips, ready: score >= BRIEF_READY_SCORE };
}
