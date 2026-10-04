import type { Checkpoint, ConstructionBriefDraft, TradeId } from "../types";
import { suggestCode } from "./codes";
import { neededQuestions } from "./questions";
import { detectTrade, labelForTrade } from "./trades";

const ROLE_LABEL: Record<string, string> = { homeowner: "Homeowner", sub: "Subcontractor", gc: "General contractor" };

const BUDGET_LABEL: Record<string, string> = { under15: "Under $15,000", "15to50": "$15,000 – $50,000", over50: "Over $50,000" };

export function lockedNarrative(draft: ConstructionBriefDraft): string {
  const a = draft.answers || {};
  const lines: Array<string | null> = [
    `${ROLE_LABEL[draft.role] ?? "Party"} brief for Shield protection.`,
    draft.title ? `Title: ${draft.title}` : null,
    draft.trade ? `Trade: ${labelForTrade(draft.trade)}` : null,
    draft.budgetBand ? `Budget band: ${BUDGET_LABEL[draft.budgetBand] ?? draft.budgetBand}` : null,
    "",
    (draft.description || "").trim(),
    "",
  ];
  const { list } = neededQuestions(draft);
  for (const q of list) {
    const v = a[q.id];
    if (v && String(v).trim()) lines.push(`${q.q} ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (draft.include) lines.push(`Included: ${draft.include}`);
  if (draft.exclude) lines.push(`Excluded: ${draft.exclude}`);
  return lines.filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type Pair = [string, string];

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

function templates(trade: TradeId, draft: ConstructionBriefDraft): Pair[] {
  const a = draft.answers || {};
  const s = (k: string) => str(a[k]);
  const all: Record<TradeId, Pair[]> = {
    roofing: [
      ["Existing condition", "Photo of the full roof elevation(s) in the contract before tear-off, including problem areas called out in the brief."],
      ["Deck exposed", `After ${s("layers") && s("layers") !== "New — nothing to tear off" ? "tear-off" : "prep"}: exposed deck, rotten wood marked, no new underlayment covering defects.`],
      ["Underlayment & flashing", `Ice-and-water / underlayment, valleys, wall and chimney flashing, and any ${s("extras").toLowerCase().includes("skylight") ? "skylight pans" : "penetration jacks"} before shingles or panels hide them.`],
      ["Field installed", `Material in place (${s("material") || "specified roofing"}) on the field — courses, fasteners, and drip edge as specified.`],
      ["Completion", "Finished elevations, debris gone, leftover material staged or hauled per exclusions. Close-up of completed flashings."],
    ],
    kitchen: [
      ["Existing / demo", "Kitchen as-is, then open walls if layout or MEP moves. Photo of anything being reused."],
      ["Rough MEP", s("layout").startsWith("Yes") ? "Relocated plumbing and electrical at rough, before cover." : "Any electrical or plumbing rough that will be covered."],
      ["Casework set", "Cabinets set, scribed, and fastened — before counters if counters are in scope."],
      ["Wet / counters", "Counters and backsplash substrate or finished surface per contract, seams and sink cutout."],
      ["Completion", "Finished kitchen: appliances in specified locations, hardware, and punch items visible."],
    ],
    bathroom: [
      ["Existing / demo", "Bath as-is; demo down to substrate if a gut or surround replacement."],
      ["Rough plumbing", s("layout") === "Yes" ? "Moved drains and supplies before cover." : "Supply and drain rough at the fixtures in the brief."],
      ["Waterproofing", s("wet").includes("pan") ? "New pan / liner and membrane before tile — corners, curb, and drain flashing." : "Any waterproofing or backing before finish tile or panels."],
      ["Finish surfaces", "Tile or surround, vanity set, fixtures on if in scope."],
      ["Completion", "Working water, sealed joints, and the completed room matching included scope."],
    ],
    electrical: [
      ["Existing gear", "Current panel, meter, and the work area before disturbance."],
      ["Rough-in", s("walls") === "No" ? "New homeruns and device locations before finish plates." : "Open-wall rough: boxes, cable, stapling, before drywall or covers."],
      ["Panel / connections", s("panel") && s("panel") !== "No panel work" ? "Panel interior: labeling, bonding, new breakers — dead front off." : "Make-up and connections that will be covered or plated."],
      ["Devices & fixtures", "Devices and fixtures in the locations listed in the brief."],
      ["Completion / inspect", s("permit") === "Yes" ? "Inspection sticker or passed final plus finished plates and labels." : "Finished installation, labels, and tested devices."],
    ],
    plumbing: [
      ["Existing / access", "Work area and existing fixtures or equipment before opening walls or slab."],
      ["Rough piping", `${s("material") || "Specified pipe"} laid out; in-wall or in-slab runs visible before cover.`],
      ["Test", s("permit") !== "No" ? "Pressure or drain test in progress or gauge reading." : "Open connections and supports before concealment."],
      ["Equipment / fixtures", s("scope").includes("heater") ? "Water heater / boiler nameplate, T&P, and connections." : "Fixtures or equipment set per brief."],
      ["Completion", "Restored finishes that this crew owns; leaks absent at the completed work."],
    ],
    hvac: [
      ["Existing equipment", "Nameplates and the pad / closet / attic location before removal."],
      ["Placement / connections", "New unit set; line set, flue, condensate, and electrical connections visible."],
      ["Duct or line work", s("scope").includes("duct") ? "New duct runs before concealment." : "Line-set penetration flashing and insulation."],
      ["Startup", "Nameplate of installed equipment matching the brief; filters and clearances."],
      ["Completion", "Finished location, debris removed, thermostat or controller working if in scope."],
    ],
    concrete: [
      ["Layout / excavation", "Forms, elevations, and excavation matching the brief before steel."],
      ["Steel in place", s("rebar") !== "No" ? "Rebar or mesh, chairs, and overlaps before pour." : "Forms and dowels before pour."],
      ["Pour", "Placement in progress or immediately after screed — no covered defects."],
      ["Finish / cure setup", "Finished surface and any specified control joints."],
      ["Completion", "Stripped forms, grade around work, and the completed element in context."],
    ],
    framing: [
      ["Existing / layout", "Area before bearing changes; layout marks for new walls or openings."],
      ["Load path", s("load") === "Yes" ? "New beam, post, or bearing wall with connections visible." : "Primary framing members in place."],
      ["Open framing", "Studs, joists, or rafters before insulation or drywall — openings framed."],
      ["Shear / hardware", "Hold-downs, straps, or shear if in the brief; otherwise blocking and connectors."],
      ["Completion / inspect", s("inspect") === "Yes" ? "Framing ready for inspection; no cover yet." : "Completed frame scope dry and plumb as specified."],
    ],
    siding: [
      ["Existing elevations", "Each contracted elevation before removal."],
      ["Substrate / wrap", s("wrap") !== "No" ? "WRB / housewrap, laps, and window flashing before siding." : "Sheathing repairs before new siding."],
      ["Openings", s("windows") === "Yes" ? "Window pans and head flashing before cladding." : "Penetrations flashed."],
      ["Cladding in progress", "Starter, corners, and field siding on at least one full elevation."],
      ["Completion", "Finished elevations, trim, and debris per exclusions."],
    ],
    windows: [
      ["Existing openings", "Each opening before removal, interior and exterior if accessible."],
      ["Rough / pans", "Sills and pan flashing before the unit goes in."],
      ["Unit set", "Unit shimmed and fastened; exterior flange or retrofit trim visible."],
      ["Air / water seal", "Sealant and wrap integration at the head and jambs."],
      ["Completion", `All ${s("count") || "contracted"} openings operating; interior casing only if included.`],
    ],
    flooring: [
      ["Subfloor", s("sub") === "Yes" || s("sub") === "If needed" ? "Subfloor or mud bed before finish flooring." : "Existing floor prep before product."],
      ["Layout", "Product acclimated / dry-laid or first course layout."],
      ["Field install", `${s("material") || "Specified flooring"} in the field, transitions started.`],
      ["Wet areas / transitions", "Bath, kitchen, or door transitions if those rooms are in scope."],
      ["Completion", "Finished floor, leftover material, and excluded base/paint left as stated."],
    ],
    paint: [
      ["Existing condition", "Rooms or elevations before work; defects called out in the brief."],
      ["Prep", s("prep").includes("specified") ? "Prep complete: filled, caulked, masked — before prime." : "Prep as agreed before first coat."],
      ["Prime / first coat", "Primer or first coat with coverage visible."],
      ["Finish coats", "Specified finish on the largest surfaces."],
      ["Completion", "Punch: misses, hardware reinstalled, floors protected or cleaned per scope."],
    ],
    adu: [
      ["Existing site / structure", "Site or host building before work in this Shield package."],
      ["Covered structure", s("trades").includes("Foundation") ? "Foundation / slab before backfill or framing." : "Framing or conversion framing before cover."],
      ["Weather / MEP rough", "Dry-in and/or MEP rough for the trades listed in this brief, before concealment."],
      ["Inspections", s("permit") === "Yes — full permit" ? "Passed inspections that apply to this package." : "In-progress assemblies before finish hides them."],
      ["Package complete", "This Shield package finished as defined — not the whole house if finish is excluded."],
    ],
    general: [
      ["Existing condition", "Work area before this crew starts, matching the location in the brief."],
      ["Open / covered work", s("hidden") ? `Work that will be hidden: ${s("hidden")}` : "Any assembly that will be covered — photo before concealment."],
      ["In-progress specified work", "Primary installation described in the brief, mid-install."],
      ["Quality / inspect", s("permit") === "Yes" ? "Inspection or third-party review evidence." : "Close-ups of the details most likely to be disputed."],
      ["Completion", s("scope") || draft.title ? `Done means: ${s("scope") || draft.title}. Photo of that finished state.` : "Finished contracted work only — exclusions left untouched."],
    ],
  };
  return all[trade];
}

export function generatePoints(draft: ConstructionBriefDraft): Checkpoint[] {
  const trade = draft.trade || detectTrade(draft.description);
  return templates(trade, draft).map(([label, description], i) => ({
    id: `construction-${i + 1}`,
    label,
    description,
    required: true,
    shotId: null,
    code: suggestCode(trade, label, description),
  }));
}
