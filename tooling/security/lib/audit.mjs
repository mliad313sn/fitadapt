// @ts-check
/**
 * Dependency-audit gate (M17, ADR-007). Reads a `pnpm audit --json` report and
 * fails on any high or critical advisory. A report that cannot be read fails
 * closed: an audit that did not run is not a clean audit.
 */

/** Severities that fail the pipeline. */
export const BLOCKING_SEVERITIES = /** @type {const} */ (['high', 'critical']);

/**
 * @param {unknown} report parsed `pnpm audit --json` output
 * @returns {{ ok: boolean, counts: Record<string, number>, blocking: { id: string, module: string, severity: string, title: string }[], error?: string }}
 */
export function evaluateAudit(report) {
  const r = /** @type {{ metadata?: { vulnerabilities?: Record<string, number> }, advisories?: Record<string, { module_name?: string, severity?: string, title?: string }>, error?: { code?: string } }} */ (report ?? {});
  if (r.error) return { ok: false, counts: {}, blocking: [], error: `audit failed: ${r.error.code ?? 'unknown error'}` };
  const counts = r.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') return { ok: false, counts: {}, blocking: [], error: 'audit report has no vulnerability summary' };
  const blocking = Object.entries(r.advisories ?? {})
    .filter(([, a]) => BLOCKING_SEVERITIES.includes(/** @type {'high' | 'critical'} */ (a.severity)))
    .map(([id, a]) => ({ id, module: a.module_name ?? '?', severity: a.severity ?? '?', title: a.title ?? '' }));
  const blockingCount = BLOCKING_SEVERITIES.reduce((n, s) => n + (Number(counts[s]) || 0), 0);
  return { ok: blockingCount === 0 && blocking.length === 0, counts, blocking };
}

/** @param {ReturnType<typeof evaluateAudit>} result */
export function formatAudit(result) {
  if (result.error) return `Dependency audit: FAILED (${result.error}).`;
  const summary = ['critical', 'high', 'moderate', 'low', 'info'].map((s) => `${s} ${result.counts[s] ?? 0}`).join(', ');
  const lines = [`Dependency audit: ${summary}.`];
  for (const b of result.blocking) lines.push(`  ${b.severity.toUpperCase()} ${b.module}: ${b.title} (advisory ${b.id})`);
  lines.push(result.ok ? 'No high or critical findings.' : 'High or critical findings: failing.');
  return lines.join('\n');
}
