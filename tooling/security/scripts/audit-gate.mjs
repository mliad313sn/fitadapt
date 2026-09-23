#!/usr/bin/env node
// @ts-check
/** `pnpm security:audit` — fails on high/critical advisories (ADR-007). `--input <file>` reads a saved report. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluateAudit, formatAudit } from '../lib/audit.mjs';

const inputIndex = process.argv.indexOf('--input');
let raw;
if (inputIndex > -1) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CI input path given by the operator
  raw = readFileSync(/** @type {string} */ (process.argv[inputIndex + 1]), 'utf8');
} else {
  try {
    raw = execFileSync('pnpm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // pnpm audit exits non-zero whenever it finds anything; the report is still on stdout.
    raw = /** @type {{ stdout?: string }} */ (error).stdout ?? '';
  }
}
let report;
try {
  report = JSON.parse(raw);
} catch {
  report = { error: { code: 'unreadable audit output' } };
}
const result = evaluateAudit(report);
console.log(formatAudit(result));
process.exit(result.ok ? 0 : 1);
