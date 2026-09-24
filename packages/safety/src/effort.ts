/**
 * The RIR-based RPE scale (Zourdos et al. 2016, as listed in
 * docs/specs/00-product-vision.md): RPE 10 is a set with 0 reps in reserve,
 * so RPE = 10 − RIR. S1 (screeningGateCheck) caps effort on the RPE scale and
 * the engine prescribes reserves (RIR), so this anchor decides where the S1
 * reserve lands. It is part of the S1 invariant, not a coefficient (CS-8,
 * docs/governance/ai-reviews/A1-A2-clinical-safety.md M07-45): a lower anchor
 * would map a reserve to a lower RPE and loosen S1. The engine's
 * `rpeAtZeroRir` configuration may only raise it (stricter), never lower it.
 */
export const S1_RPE_AT_ZERO_RIR = 10 as const;
