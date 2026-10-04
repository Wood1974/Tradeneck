import type { FeeTier } from "./types";

export const PRICING_EFFECTIVE = "2026-09-18";

export function feeForBudget(budgetUsd: number): { feeUsd: number; feeTier: FeeTier } {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    return { feeUsd: 79, feeTier: "standard" };
  }
  if (budgetUsd <= 5000) return { feeUsd: 79, feeTier: "standard" };
  if (budgetUsd <= 20000) return { feeUsd: 129, feeTier: "extended" };
  return { feeUsd: 199, feeTier: "major" };
}
