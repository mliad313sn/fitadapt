/**
 * Every reason code the M04 analytics emit (forecasts, the guardrail), with
 * the parameters its FR/EN sentence needs (packages/i18n
 * `engine.reason.<code>`; none: the numbers are shown from the result). A
 * test renders every code in both languages.
 */
const codes = (list: readonly string[]) => Object.fromEntries(list.map((c) => [c, [] as readonly string[]]));

export const M04_REASON_PARAMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...codes(['linear_trend', 'estimate_only', 'achieved', 'insufficient_data', 'no_trend', 'beyond_horizon', 'confidence.low', 'confidence.medium', 'confidence.high'].map((c) => `progress.forecast.${c}`)),
  ...codes(['progress.guardrail.sustained_loss']),
});

export const M04_REASON_CODES: readonly string[] = Object.freeze(Object.keys(M04_REASON_PARAMS));
