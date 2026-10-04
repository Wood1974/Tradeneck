import type { CodeRef, TradeId } from "../types";

export type CodeTrade = "Framing" | "Roofing" | "Electrical" | "Plumbing" | "HVAC" | "Concrete" | "General";

/**
 * Mirrors tradedeck-api/supabase/migrations/20261002000000_shield_checkpoints_scaffolding.sql.
 * Bundled locally so the Codes view and code suggestions work with no network.
 */
export interface CodeCheckpoint {
  trade: CodeTrade;
  name: string;
  irc: string | null;
  ibc: string | null;
  description: string;
  photoGuidance: string;
  requiredBeforeConcealment: boolean;
  keywords: string[];
}

export const CODE_CHECKPOINTS: CodeCheckpoint[] = [
  { trade: "Framing", name: "Foundation Sill Plate & Anchor Bolts", irc: "R403.1.6", ibc: null, description: "Sill plate installed with ≥½\" anchor bolts at 6\" on center maximum", photoGuidance: "Wide shot of sill plate with anchor bolts visible", requiredBeforeConcealment: true, keywords: ["sill", "anchor", "bolt", "plate"] },
  { trade: "Framing", name: "Header Beam Installation", irc: "R603.7.1", ibc: null, description: "Proper header sizing and bearing on supports", photoGuidance: "Close-up of header bearing point and fasteners", requiredBeforeConcealment: true, keywords: ["header", "beam", "bearing", "load path", "post"] },
  { trade: "Framing", name: "Joist Notching", irc: "R502.8", ibc: null, description: "Notches limited to 1/6 of joist depth, no cutting in middle 1/3 of span", photoGuidance: "Detail showing maximum notch depth measurement", requiredBeforeConcealment: true, keywords: ["joist", "notch", "bore"] },
  { trade: "Framing", name: "Interior Wall Framing", irc: "R602.3", ibc: null, description: "Studs properly spaced and aligned", photoGuidance: "Wide shot of wall framing showing spacing", requiredBeforeConcealment: true, keywords: ["stud", "wall", "open framing", "rafter", "layout", "shear", "hardware", "blocking"] },
  { trade: "Roofing", name: "Roof Decking", irc: "R902.1", ibc: null, description: "Decking fastened per manufacturer specifications and code requirements", photoGuidance: "Wide angle showing decking fastening pattern", requiredBeforeConcealment: true, keywords: ["deck", "sheathing", "tear-off", "exposed"] },
  { trade: "Roofing", name: "Underlayment Installation", irc: "R905.2.8", ibc: null, description: "Underlayment properly lapped and fastened, minimum 4\" overlap", photoGuidance: "Detail of lap and fastening", requiredBeforeConcealment: true, keywords: ["underlayment", "ice-and-water", "field installed", "courses", "drip edge"] },
  { trade: "Roofing", name: "Flashing Installation", irc: "R903.2", ibc: null, description: "Flashing at valleys, ridges, and penetrations properly sealed", photoGuidance: "Detail of flashing and sealing", requiredBeforeConcealment: true, keywords: ["flashing", "valley", "chimney", "penetration", "skylight"] },
  { trade: "Electrical", name: "Rough-in Inspection", irc: "E3401.1", ibc: null, description: "Wiring secured at regular intervals, no damage to insulation", photoGuidance: "Wide shot of rough-in run", requiredBeforeConcealment: true, keywords: ["rough", "wire", "cable", "homerun", "staple"] },
  { trade: "Electrical", name: "Box Installation", irc: "E3404.2", ibc: null, description: "Electrical boxes properly secured and positioned", photoGuidance: "Detail of box mounting and accessibility", requiredBeforeConcealment: true, keywords: ["box", "device", "fixture", "panel", "breaker", "connection", "dead front"] },
  { trade: "Plumbing", name: "Rough-in Inspection", irc: "P2603.2", ibc: null, description: "Pipe support and slope requirements met", photoGuidance: "Detail of pipe support and slope", requiredBeforeConcealment: true, keywords: ["rough", "pipe", "piping", "support", "slope", "pex", "copper", "in-wall", "in-slab"] },
  { trade: "Plumbing", name: "Vent Stack Installation", irc: "P3101.1", ibc: null, description: "Vent stacks properly installed with correct pitch and clearance", photoGuidance: "Wide shot of vent stack installation", requiredBeforeConcealment: true, keywords: ["vent", "stack", "drain", "pressure", "test"] },
  { trade: "HVAC", name: "Duct Sealing", irc: "M1601.4", ibc: null, description: "Duct seams sealed with mastic, connections tight", photoGuidance: "Close-up of duct sealing", requiredBeforeConcealment: true, keywords: ["duct", "seal", "mastic", "line set", "line-set"] },
  { trade: "HVAC", name: "Equipment Installation", irc: "M1401.2", ibc: null, description: "HVAC equipment properly secured and accessible for maintenance", photoGuidance: "Wide shot of equipment installation", requiredBeforeConcealment: true, keywords: ["equipment", "unit", "nameplate", "furnace", "condenser", "startup", "placement"] },
  { trade: "Concrete", name: "Foundation Pour", irc: "R403.1", ibc: null, description: "Concrete strength and finishes per specifications", photoGuidance: "Wide shot of foundation with reference scale", requiredBeforeConcealment: true, keywords: ["pour", "placement", "screed", "finish", "slab", "footing", "form", "excavation"] },
  { trade: "Concrete", name: "Reinforcement Installation", irc: "R403.1.1", ibc: null, description: "Rebar spacing and placement per specifications", photoGuidance: "Detail of rebar grid and spacing", requiredBeforeConcealment: true, keywords: ["rebar", "steel", "reinforc", "mesh", "dowel", "chairs"] },
  { trade: "General", name: "Site Condition Documentation", irc: "General", ibc: null, description: "General site condition and progress documentation", photoGuidance: "Wide angle showing overall condition", requiredBeforeConcealment: false, keywords: ["existing", "site", "condition", "before", "completion", "done", "finished", "complete"] },
];

export const CODE_TRADE_ORDER: CodeTrade[] = ["Framing", "Roofing", "Electrical", "Plumbing", "HVAC", "Concrete", "General"];

const TRADE_MAP: Record<TradeId, CodeTrade[]> = {
  framing: ["Framing"],
  roofing: ["Roofing"],
  electrical: ["Electrical"],
  plumbing: ["Plumbing"],
  hvac: ["HVAC"],
  concrete: ["Concrete"],
  kitchen: ["Plumbing", "Electrical"],
  bathroom: ["Plumbing", "Electrical"],
  adu: ["Concrete", "Framing", "Roofing", "Electrical", "Plumbing", "HVAC"],
  siding: [],
  windows: [],
  flooring: [],
  paint: [],
  general: [],
};

export function codeTradesFor(trade: TradeId | ""): CodeTrade[] {
  const base = trade ? TRADE_MAP[trade] : [];
  return [...base, "General"];
}

export function codesForTrade(trade: TradeId | ""): CodeCheckpoint[] {
  const allowed = new Set(codeTradesFor(trade));
  return CODE_CHECKPOINTS.filter((c) => allowed.has(c.trade));
}

export function toCodeRef(c: CodeCheckpoint): CodeRef {
  return { irc: c.irc, ibc: c.ibc, name: c.name };
}

/** Best keyword match for a generated point within the trade's code rows. Null when nothing fits. */
export function suggestCode(trade: TradeId | "", label: string, description = ""): CodeRef | null {
  const text = `${label} ${description}`.toLowerCase();
  let best: CodeCheckpoint | null = null;
  let bestScore = 0;
  for (const row of codesForTrade(trade)) {
    // Trade-specific rows are checked before General, so ties keep the specific row.
    const score = row.keywords.reduce((n, k) => n + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best ? toCodeRef(best) : null;
}

export function findCode(irc: string | null, name: string): CodeCheckpoint | undefined {
  return CODE_CHECKPOINTS.find((c) => c.name === name && c.irc === irc);
}
