import type { CodeRef, TradeId } from "../types";

export type CodeTrade = "Framing" | "Roofing" | "Electrical" | "Plumbing" | "HVAC" | "Concrete" | "General";

/** The model-code edition the section numbers below refer to. Utah adopts it with state amendments, so Utah's own text can differ. */
export const CODE_EDITION = "2021 IRC";

/**
 * Bundled locally so the Codes view and code suggestions work with no network. Section numbers, topics and the
 * figures in descriptions were taken from ICC's published 2021 IRC text, relayed through research notes rather than
 * read first-hand, and no inspector has reviewed them. Descriptions are summaries, not code text. Utah's amendments
 * (Utah Code 15A-3-202 to -206 and -601, pages dated 7/1/2026 or 7/1/2025) were searched by section number: only
 * R403.1.6 (exception added) and R403.1.3.5.3 are amended; the other cited sections are not mentioned by number.
 * Not checked: IPC/IMC/NEC amendments that Utah applies to "corresponding" IRC sections, and the 1/1/2027 version
 * of 15A-2-103. Keep figures tied to a source when editing.
 * (The tradedeck-api seed migration still carries the older, uncorrected rows.)
 */
export interface CodeCheckpoint {
  trade: CodeTrade;
  name: string;
  irc: string | null;
  ibc: string | null;
  /** What the cited section covers, so the number can be checked against the book. */
  topic: string | null;
  description: string;
  photoGuidance: string;
  requiredBeforeConcealment: boolean;
  keywords: string[];
}

export const CODE_CHECKPOINTS: CodeCheckpoint[] = [
  { trade: "Framing", name: "Foundation Sill Plate & Anchor Bolts", irc: "R403.1.6", ibc: null, topic: "Foundation anchorage", description: "Sill plate anchored with at least ½\" bolts at 6 ft on center maximum, 7\" embedded, one within 12\" of each plate end, 2 bolts minimum per plate section, each with nut and washer. Utah exception: where bolt spacing is no more than 32\", two bolts per plate section at least 4\" from each end are allowed", photoGuidance: "Wide shot of the sill plate and bolts, plus a close-up of one bolt with nut and washer", requiredBeforeConcealment: true, keywords: ["sill", "anchor", "bolt", "plate"] },
  { trade: "Framing", name: "Header Beam Installation", irc: "R602.7", ibc: null, topic: "Headers (supports: R602.7.5)", description: "Header sized from the R602.7 span tables and supported at each end by jack studs or approved framing anchors", photoGuidance: "Close-up of the header bearing point, jack studs and fasteners", requiredBeforeConcealment: true, keywords: ["header", "beam", "bearing", "load path", "post"] },
  { trade: "Framing", name: "Joist Notching", irc: "R502.8", ibc: null, topic: "Cutting, drilling and notching of floor framing", description: "Notches no deeper than 1/6 of the joist depth, no longer than 1/3 of the depth, and not in the middle third of the span; end notches up to 1/4; holes up to 1/3 of the depth; engineered joists only as the manufacturer allows", photoGuidance: "Detail showing the notch with a depth measurement", requiredBeforeConcealment: true, keywords: ["joist", "notch", "bore"] },
  { trade: "Framing", name: "Wall Framing (Studs)", irc: "R602.3.1", ibc: null, topic: "Stud size, height and spacing (Table R602.3(5)); interior walls R602.4 and R602.5", description: "Studs sized and spaced per Table R602.3(5); interior bearing walls per R602.4, nonbearing per R602.5", photoGuidance: "Wide shot of the wall framing showing stud spacing", requiredBeforeConcealment: true, keywords: ["stud", "wall", "open framing", "rafter", "layout", "shear", "hardware", "blocking"] },
  { trade: "Roofing", name: "Roof Decking", irc: "R803.2", ibc: null, topic: "Wood structural panel roof sheathing", description: "Wood structural panel decking fastened per Table R602.3(1); asphalt shingles require solid decking (R905.2.1)", photoGuidance: "Wide angle showing the decking fastening pattern", requiredBeforeConcealment: true, keywords: ["deck", "sheathing", "tear-off", "exposed"] },
  { trade: "Roofing", name: "Underlayment Installation", irc: "R905.1.1", ibc: null, topic: "Roof underlayment", description: "Underlayment lapped 2\" on slopes 4:12 and up; two layers with 19\" laps on slopes from 2:12 to under 4:12; end laps 4\", offset 6 ft", photoGuidance: "Detail of the laps and fasteners", requiredBeforeConcealment: true, keywords: ["underlayment", "ice-and-water", "field installed", "courses", "drip edge"] },
  { trade: "Roofing", name: "Flashing Installation", irc: "R903.2", ibc: null, topic: "Roof flashing (locations: R903.2.1)", description: "Corrosion-resistant metal flashing, at least 0.019\" thick, at wall and roof intersections, changes in slope and roof openings", photoGuidance: "Detail of the flashing at each location", requiredBeforeConcealment: true, keywords: ["flashing", "valley", "chimney", "penetration", "skylight"] },
  { trade: "Electrical", name: "Cable Support & Protection", irc: "E3802.6", ibc: null, topic: "Securing and supporting cable (Table E3802.1)", description: "NM cable stapled or strapped within 12\" of each box and at most 4.5 ft apart (Table E3802.1), with no damage to the cable or its insulation", photoGuidance: "Wide shot of the cable run showing staples or straps", requiredBeforeConcealment: true, keywords: ["rough", "wire", "cable", "homerun", "staple"] },
  { trade: "Electrical", name: "Box Installation", irc: "E3906.8", ibc: null, topic: "Support of boxes and enclosures (cable to box: E3905.3.1)", description: "Boxes rigidly supported (E3906.8) and cables secured to the box (E3905.3.1)", photoGuidance: "Detail of the box mounting and cable entry", requiredBeforeConcealment: true, keywords: ["box", "device", "fixture", "panel", "breaker", "connection", "dead front"] },
  { trade: "Plumbing", name: "Pipe Support & Drain Slope", irc: "P2605.1", ibc: null, topic: "Pipe supports (Table P2605.1); drain slope P3005.3", description: "Pipe supported at the required intervals; drain slope at least ¼\" per ft for pipe 2½\" and smaller, ⅛\" per ft for 3\" and larger (P3005.3)", photoGuidance: "Detail of the pipe supports and the slope", requiredBeforeConcealment: true, keywords: ["rough", "pipe", "piping", "support", "slope", "pex", "copper", "in-wall", "in-slab"] },
  { trade: "Plumbing", name: "Vent Grade & Terminals", irc: "P3104.2", ibc: null, topic: "Vent grade and support (terminals: P3103.5)", description: "Vents graded to drain back by gravity; terminals clear of openings per P3103.5", photoGuidance: "Wide shot of the vent run and where it terminates", requiredBeforeConcealment: true, keywords: ["vent", "stack", "drain", "pressure", "test"] },
  { trade: "HVAC", name: "Duct Sealing", irc: "M1601.4.1", ibc: null, topic: "Duct joints, seams and connections", description: "Joints, seams and connections fastened and sealed with welds, gaskets, mastic, mastic with fabric, liquid sealant or tape; tapes and mastics UL 181A or 181B marked", photoGuidance: "Close-up of the sealed duct joints", requiredBeforeConcealment: true, keywords: ["duct", "seal", "mastic", "line set", "line-set"] },
  { trade: "HVAC", name: "Equipment Installation", irc: "M1401.1", ibc: null, topic: "Installation per manufacturer's instructions (access: M1401.2)", description: "Equipment installed per the manufacturer's instructions (M1401.1) with access for servicing and replacement (M1401.2)", photoGuidance: "Wide shot of the equipment and its service access", requiredBeforeConcealment: true, keywords: ["equipment", "unit", "nameplate", "furnace", "condenser", "startup", "placement"] },
  { trade: "Concrete", name: "Foundation Pour", irc: "R402.2", ibc: null, topic: "Minimum concrete strength (Table R402.2); inspection before placing: R109.1.1", description: "Mix meets the Table R402.2 minimum strength for its exposure; forms erected and any required reinforcing in place before placing concrete (R109.1.1)", photoGuidance: "Wide shot of the foundation with a reference scale", requiredBeforeConcealment: true, keywords: ["pour", "placement", "screed", "finish", "slab", "footing", "form", "excavation"] },
  { trade: "Concrete", name: "Reinforcement Installation", irc: "R403.1.3", ibc: null, topic: "Footing and stem wall reinforcement (seismic design categories D0, D1, D2)", description: "Reinforcing steel in place, supported and tied before the pour (R109.1.1); footing and stem wall reinforcement is required in seismic design categories D0, D1 and D2. Utah allows vertical steel in footings to be placed while the concrete is still plastic (R403.1.3.5.3 exception)", photoGuidance: "Detail of the rebar grid, supports and spacing", requiredBeforeConcealment: true, keywords: ["rebar", "steel", "reinforc", "mesh", "dowel", "chairs"] },
  { trade: "General", name: "Site Condition Documentation", irc: null, ibc: null, topic: null, description: "General site condition and progress documentation (no code section)", photoGuidance: "Wide angle showing the overall condition", requiredBeforeConcealment: false, keywords: ["existing", "site", "condition", "before", "completion", "done", "finished", "complete"] },
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
  return { irc: c.irc, ibc: c.ibc, name: c.name, ...(c.topic ? { topic: c.topic } : {}) };
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
