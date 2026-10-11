import { describe, expect, it } from "vitest";
import type { ConstructionBriefDraft } from "../types";
import { CODE_CHECKPOINTS, codesForTrade, suggestCode } from "./codes";
import { generatePoints, lockedNarrative } from "./points";
import { neededQuestions } from "./questions";
import { scoreBrief } from "./score";
import { detectTrade, TRADES } from "./trades";

function draft(over: Partial<ConstructionBriefDraft> = {}): ConstructionBriefDraft {
  return { role: "homeowner", title: "", trade: "", budgetBand: "", description: "", include: "", exclude: "", answers: {}, ...over };
}

describe("detectTrade", () => {
  it("picks roofing for a tear-off description", () => {
    expect(detectTrade("Full tear-off, new shingle roof with ice and water in valleys")).toBe("roofing");
  });
  it("falls back to general", () => {
    expect(detectTrade("do the thing")).toBe("general");
  });
});

describe("scoreBrief", () => {
  it("is not ready for a one-liner", () => {
    const s = scoreBrief(draft({ description: "fix roof" }));
    expect(s.score).toBeLessThan(70);
    expect(s.ready).toBe(false);
    expect(s.chips.find((c) => c.label === "Too short")?.ok).toBe(false);
  });
  it("is ready for a full brief", () => {
    const s = scoreBrief(
      draft({
        title: "Tear-off reroof — 872 High Country Ln",
        description: "Tear off 2 layers of asphalt shingle on the main roof, 24 squares, install ice and water in valleys, replace rotten decking, new drip edge on the east and west elevations.",
        exclude: "gutters, skylights",
      }),
    );
    expect(s.score).toBeGreaterThanOrEqual(70);
    expect(s.ready).toBe(true);
  });
});

describe("neededQuestions", () => {
  it("adds the shared location question when location is missing", () => {
    const { trade, list } = neededQuestions(draft({ description: "repipe with pex" }));
    expect(trade).toBe("plumbing");
    expect(list.some((q) => q.id === "where")).toBe(true);
    expect(list[list.length - 1]!.id).toBe("exclude");
  });
});

describe("generatePoints", () => {
  it("returns exactly five construction-N checkpoints for every trade", () => {
    for (const t of TRADES) {
      const pts = generatePoints(draft({ trade: t.id }));
      expect(pts).toHaveLength(5);
      expect(pts.map((p) => p.id)).toEqual(["construction-1", "construction-2", "construction-3", "construction-4", "construction-5"]);
      for (const p of pts) {
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.description!.length).toBeGreaterThan(0);
        expect(p.shotId).toBeNull();
        expect(p.required).toBe(true);
      }
    }
  });
  it("adapts to answers", () => {
    const pts = generatePoints(draft({ trade: "concrete", answers: { rebar: "No" } }));
    expect(pts[1]!.description).toContain("dowels");
  });
  it("suggests IRC sections on construction points", () => {
    const pts = generatePoints(draft({ trade: "concrete" }));
    expect(pts[1]!.code?.irc).toBe("R403.1.3");
    expect(pts[2]!.code?.irc).toBe("R402.2");
  });
});

describe("lockedNarrative", () => {
  it("includes answers and exclusions", () => {
    const text = lockedNarrative(draft({ trade: "roofing", title: "Reroof", description: "tear off", exclude: "gutters", answers: { material: "Metal" } }));
    expect(text).toContain("Title: Reroof");
    expect(text).toContain("Roofing material? Metal");
    expect(text).toContain("Excluded: gutters");
  });
});

describe("codes", () => {
  it("carries all 16 migration rows", () => {
    expect(CODE_CHECKPOINTS).toHaveLength(16);
    expect(CODE_CHECKPOINTS.filter((c) => c.trade === "Framing")).toHaveLength(4);
  });
  it("suggests reinforcement for steel in place", () => {
    expect(suggestCode("concrete", "Steel in place")?.irc).toBe("R403.1.3");
  });
  it("maps generated roofing points to decking and the general site row", () => {
    expect(suggestCode("roofing", "Deck exposed", "After tear-off: exposed deck, rotten wood marked.")?.irc).toBe("R803.2");
    expect(suggestCode("roofing", "Existing condition", "roof elevation before tear-off")?.name).toBe("Site Condition Documentation");
  });
  it("keeps the citation table well formed", () => {
    const IRC = /^(R|E|P|M)\d{3,4}(\.\d+)*$/;
    const seen = new Set<string>();
    for (const c of CODE_CHECKPOINTS) {
      expect(c.ibc).toBeNull();
      if (c.irc === null) {
        expect(c.trade).toBe("General");
        expect(c.topic).toBeNull();
      } else {
        expect(c.irc).toMatch(IRC);
        expect(c.topic && c.topic.length > 0).toBe(true);
      }
      const key = `${c.trade}|${c.name}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
  it("does not use sections found to be wrong for these topics", () => {
    const cited = new Set(CODE_CHECKPOINTS.map((c) => c.irc));
    for (const wrong of ["R603.7.1", "R902.1", "R905.2.8", "E3401.1", "E3404.2", "P2603.2", "R403.1", "R403.1.1", "General"]) {
      expect(cited.has(wrong)).toBe(false);
    }
  });
  it("returns null when nothing matches", () => {
    expect(suggestCode("paint", "Prime / first coat")).toBeNull();
  });
  it("scopes rows to trade plus General", () => {
    const rows = codesForTrade("hvac");
    expect(rows.every((r) => r.trade === "HVAC" || r.trade === "General")).toBe(true);
    expect(rows).toHaveLength(3);
    expect(codesForTrade("paint").map((r) => r.trade)).toEqual(["General"]);
  });
});
