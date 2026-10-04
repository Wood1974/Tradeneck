import type { ConstructionBriefDraft, TradeId } from "../types";
import { scoreBrief } from "./score";
import { detectTrade } from "./trades";

export interface Question {
  id: string;
  q: string;
  why: string;
  options?: string[];
  type?: "text";
  placeholder?: string;
  multi?: boolean;
}

export const QUESTIONS: Record<TradeId, Question[]> = {
  roofing: [
    { id: "scope", q: "What is being done to the roof?", why: "Tear-off vs overlay vs repair changes every checkpoint.", options: ["Full tear-off and reroof", "Overlay / recover", "Partial repair / leak", "New construction roof"] },
    { id: "material", q: "Roofing material?", why: "Photo rubric is different for shingle, metal, tile, TPO.", options: ["Asphalt shingles", "Metal", "Tile", "Flat / TPO / membrane", "Other / mixed"] },
    { id: "squares", q: "Approximate size (squares or sq ft)?", why: "Size locks the job and the close-out photo.", type: "text", placeholder: "e.g. 24 squares" },
    { id: "layers", q: "How many layers come off?", why: "Tear-off photos must show deck after the last layer.", options: ["1", "2", "3+", "Unknown", "New — nothing to tear off"] },
    { id: "extras", q: "What else is in the contract?", why: "Skylights, vents, and valleys are the usual dispute points.", options: ["Skylights", "New vents / pipe jacks", "Valleys / chimneys / wall flashing", "Gutters / drip edge only", "Deck repair if rotten", "None / unknown"], multi: true },
  ],
  kitchen: [
    { id: "scope", q: "Kitchen scope?", why: "Layout change vs cabinet swap changes rough-in points.", options: ["Full gut remodel", "Cabinet + counter swap", "Island / layout change", "Appliance + finish only"] },
    { id: "layout", q: "Are walls, plumbing, or electrical moving?", why: "Moved utilities need an open-wall checkpoint.", options: ["Yes — plumbing and/or electrical move", "Electrical only", "Plumbing only", "No — same layout"] },
    { id: "surfaces", q: "What surfaces are new?", why: "Counters, cabinets, and backsplash each need a photo.", options: ["Cabinets", "Counters", "Backsplash", "Flooring", "Lighting"], multi: true },
    { id: "permit", q: "Permit / inspection expected?", why: "Inspection is often one of the 5 points.", options: ["Yes", "No", "Not sure"] },
  ],
  bathroom: [
    { id: "scope", q: "Bathroom scope?", why: "Shower pan vs vanity-only are different jobs.", options: ["Full gut", "Shower / tub surround", "Vanity + fixture swap", "Tile + finish only"] },
    { id: "wet", q: "Is the shower pan or tub being replaced?", why: "Waterproofing is the #1 bathroom dispute.", options: ["New pan / liner", "Tub swap", "Neither — tile over existing", "Not sure"] },
    { id: "waterproof", q: "Waterproofing system specified?", why: "Need a photo of membrane before tile.", options: ["Yes — named system", "Installer standard", "Unknown"] },
    { id: "layout", q: "Plumbing layout changing?", why: "Moved drains need an in-wall / in-floor shot.", options: ["Yes", "No", "Not sure"] },
  ],
  electrical: [
    { id: "scope", q: "Electrical scope?", why: "Panel vs branch circuits vs low-voltage.", options: ["Service / panel upgrade", "Rewire / add circuits", "Fixtures + devices only", "EV charger / specialty"] },
    { id: "panel", q: "Panel work?", why: "Dead-front off is a required checkpoint if the panel is touched.", options: ["New panel", "Same panel, new breakers", "No panel work"] },
    { id: "walls", q: "Open walls required?", why: "Rough-in photo only exists if walls open.", options: ["Yes", "No", "Partial"] },
    { id: "permit", q: "Permit / utility inspect?", why: "Final inspect is usually point 5.", options: ["Yes", "No", "Not sure"] },
  ],
  plumbing: [
    { id: "scope", q: "Plumbing scope?", why: "Repipe vs fixture swap.", options: ["Repipe", "Water heater / boiler", "Drain / sewer", "Fixture swap", "Mix"] },
    { id: "walls", q: "In-wall or in-slab work?", why: "Covered work needs a photo before close-up.", options: ["In-wall", "In-slab / under floor", "Both", "Neither"] },
    { id: "material", q: "Pipe material specified?", why: "Material is part of the contract record.", options: ["PEX", "Copper", "PVC / ABS", "Other / mix", "Unknown"] },
    { id: "permit", q: "Pressure test or inspect required?", why: "Test photo is a checkpoint.", options: ["Yes", "No", "Not sure"] },
  ],
  hvac: [
    { id: "scope", q: "HVAC scope?", why: "Changeout vs new ducts.", options: ["Furnace / AC changeout", "Heat pump / mini-split", "New ducts", "Repair only"] },
    { id: "equipment", q: "Equipment specified (tonnage / model)?", why: "Nameplate photo is a checkpoint.", type: "text", placeholder: "e.g. 3-ton heat pump, model unknown" },
    { id: "line", q: "Line set / pad / flue changing?", why: "Those are the leak and code points.", options: ["Yes", "No", "Not sure"] },
  ],
  concrete: [
    { id: "scope", q: "Concrete / foundation scope?", why: "Footings vs slab vs wall.", options: ["Footings", "Slab on grade", "Foundation wall / stem", "Flatwork (drive / patio)", "Repair / underpin"] },
    { id: "rebar", q: "Will rebar / mesh be inspected before pour?", why: "Steel-in-place is the photo that matters.", options: ["Yes", "No", "Not sure"] },
    { id: "yards", q: "Approx yards or sq ft?", why: "Locks size.", type: "text", placeholder: "e.g. 18 yards / 600 sf" },
  ],
  framing: [
    { id: "scope", q: "Framing scope?", why: "Load path vs cosmetic walls.", options: ["New structure / addition", "Load-bearing change", "Interior walls only", "Roof structure", "Repair"] },
    { id: "load", q: "Any beam, post, or bearing wall change?", why: "That change needs its own photo.", options: ["Yes", "No", "Not sure"] },
    { id: "inspect", q: "Framing inspection expected before cover?", why: "Inspection is usually a checkpoint.", options: ["Yes", "No", "Not sure"] },
  ],
  siding: [
    { id: "scope", q: "Exterior scope?", why: "Wrap vs siding-only.", options: ["Full reside + wrap", "Siding only", "Repair / elevation", "Soffit / fascia"] },
    { id: "wrap", q: "Housewrap / WRB in the contract?", why: "WRB photo before siding is the dispute shot.", options: ["Yes", "No", "Not sure"] },
    { id: "windows", q: "Window flashing included?", why: "Pan flashing is its own point if yes.", options: ["Yes", "No", "Not sure"] },
  ],
  windows: [
    { id: "count", q: "How many openings?", why: "Count locks the close-out.", type: "text", placeholder: "e.g. 8 windows, 1 slider" },
    { id: "flash", q: "Who does pan flashing / wrap?", why: "Flashing photo is the checkpoint.", options: ["This crew", "Other trade", "Unknown"] },
    { id: "type", q: "Unit type?", why: "Retrofit vs full-frame.", options: ["Full-frame replacement", "Insert / retrofit", "New construction", "Mix"] },
  ],
  flooring: [
    { id: "material", q: "Floor product?", why: "Different photos for tile vs LVP vs hardwood.", options: ["Tile", "LVP / laminate", "Hardwood", "Carpet", "Mix"] },
    { id: "sub", q: "Subfloor / leveling in scope?", why: "Subfloor is covered work.", options: ["Yes", "No", "If needed", "Unknown"] },
  ],
  paint: [
    { id: "scope", q: "Paint / drywall scope?", why: "Repair vs full spray.", options: ["Full interior", "Exterior", "Repairs + paint", "Cabinets"] },
    { id: "prep", q: "Who owns prep, prime, and caulk?", why: "Prep is the usual fight.", options: ["This crew, specified", "This crew, “make it look good”", "Owner prep", "Unknown"] },
  ],
  adu: [
    { id: "type", q: "What is being built?", why: "ADU vs addition vs conversion.", options: ["Detached ADU", "Attached addition", "Garage / basement conversion"] },
    { id: "permit", q: "Permit set and inspections?", why: "Inspection sequence becomes the 5 points.", options: ["Yes — full permit", "Owner-builder / unclear", "No permit"] },
    { id: "trades", q: "Which trades are in THIS Shield job?", why: "Do not generate roof points for an electrical-only package.", options: ["Foundation", "Framing", "Roof", "MEP", "Finish"], multi: true },
  ],
  general: [
    { id: "scope", q: "In one sentence, what is finished when this job is done?", why: "Need a completion definition.", type: "text", placeholder: "e.g. detached garage framed, dried in, no finish" },
    { id: "hidden", q: "What work will be covered up (walls, soil, finish)?", why: "Covered work must have a checkpoint.", type: "text", placeholder: "e.g. underground conduit, insulation" },
    { id: "permit", q: "Inspections or third-party reviews?", why: "Those are natural points.", options: ["Yes", "No", "Not sure"] },
  ],
};

export const SHARED_QUESTIONS: Question[] = [
  { id: "where", q: "Where is the work?", why: "Address or elevation stops “that wasn't this house” fights.", type: "text", placeholder: "Street, unit, and side of building" },
  { id: "include", q: "What is explicitly included?", why: "Included work gets a checkpoint.", type: "text", placeholder: "Materials, assemblies, allowances" },
  { id: "exclude", q: "What is explicitly excluded?", why: "Stops scope creep photos being treated as contract work.", type: "text", placeholder: "e.g. paint, haul-off, permits, landscaping" },
];

export function neededQuestions(draft: ConstructionBriefDraft): { trade: TradeId; list: Question[] } {
  const trade = draft.trade || detectTrade(draft.description);
  const list = [...QUESTIONS[trade]];
  const { chips } = scoreBrief(draft);
  const miss = new Set(chips.filter((c) => !c.ok).map((c) => c.label));
  if (miss.has("No location")) list.push(SHARED_QUESTIONS[0]);
  if (miss.has("Too short") || miss.has("No material")) list.push(SHARED_QUESTIONS[1]);
  list.push(SHARED_QUESTIONS[2]);
  return { trade, list };
}
