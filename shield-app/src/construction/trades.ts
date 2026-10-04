import type { TradeId } from "../types";

export const TRADES: Array<{ id: TradeId; label: string }> = [
  { id: "roofing", label: "Roofing" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "electrical", label: "Electrical" },
  { id: "plumbing", label: "Plumbing" },
  { id: "hvac", label: "HVAC" },
  { id: "concrete", label: "Concrete / foundation" },
  { id: "framing", label: "Framing / structural" },
  { id: "siding", label: "Siding / exterior" },
  { id: "windows", label: "Windows / doors" },
  { id: "flooring", label: "Flooring" },
  { id: "paint", label: "Paint / finish" },
  { id: "adu", label: "ADU / addition" },
  { id: "general", label: "General / other" },
];

export const TRADE_WORDS: Record<Exclude<TradeId, "general">, string[]> = {
  roofing: ["roof", "shingle", "underlayment", "flashing", "tear-off", "tear off", "decking", "valley", "drip edge", "ice and water"],
  kitchen: ["kitchen", "cabinet", "counter", "island", "backsplash", "appliance"],
  bathroom: ["bath", "shower", "tub", "vanity", "toilet", "tile"],
  electrical: ["electric", "panel", "breaker", "outlet", "wire", "service upgrade"],
  plumbing: ["plumb", "pipe", "water heater", "drain", "supply", "repipe"],
  hvac: ["hvac", "furnace", "ac", "condenser", "duct", "mini split", "heat pump"],
  concrete: ["concrete", "footer", "footing", "foundation", "slab", "rebar", "stem wall"],
  framing: ["fram", "joist", "truss", "beam", "load-bearing", "shear"],
  siding: ["siding", "stucco", "wrap", "housewrap", "soffit", "fascia"],
  windows: ["window", "door", "slider", "flashing tape"],
  flooring: ["floor", "lvp", "hardwood", "tile", "subfloor"],
  paint: ["paint", "primer", "drywall", "texture"],
  adu: ["adu", "addition", "garage conversion", "casita"],
};

export function detectTrade(text: string): TradeId {
  const t = (text || "").toLowerCase();
  let best: TradeId = "general";
  let score = 0;
  for (const [id, words] of Object.entries(TRADE_WORDS) as Array<[TradeId, string[]]>) {
    const n = words.reduce((acc, w) => acc + (t.includes(w) ? 1 : 0), 0);
    if (n > score) {
      score = n;
      best = id;
    }
  }
  return best;
}

export function labelForTrade(id: TradeId | ""): string {
  return TRADES.find((t) => t.id === id)?.label ?? String(id);
}
