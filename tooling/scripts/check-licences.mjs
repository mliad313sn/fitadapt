#!/usr/bin/env node
// @ts-check
/**
 * Dependency licence gate (L6). Every installed package (prod and dev) must be
 * under a permissive, commercial-compatible licence, or be listed below as a
 * reviewed exception with a reason. M20 replaces this with `pnpm legal:licences`
 * and a recorded licence register.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'BlueOak-1.0.0', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'Zlib',
]);

/** Reviewed exceptions: package name -> reason. Keep this list short and justified. */
const EXCEPTIONS = {
  lightningcss: 'MPL-2.0 (file-level copyleft), CSS tool used unmodified at build time by Vite/Metro; no source changes, no redistribution of modified files.',
  'lightningcss-linux-x64-gnu': 'Platform binary of lightningcss (MPL-2.0); same reasoning.',
  'lightningcss-linux-x64-musl': 'Platform binary of lightningcss (MPL-2.0); same reasoning.',
  'lightningcss-darwin-arm64': 'Platform binary of lightningcss (MPL-2.0); same reasoning.',
  'lightningcss-darwin-x64': 'Platform binary of lightningcss (MPL-2.0); same reasoning.',
  'caniuse-lite': 'CC-BY-4.0 browser-support data used by build tooling; commercial use allowed with attribution.',
};

/** Evaluates a simple SPDX expression: OR = any allowed, AND = all allowed. */
function isAllowed(expression) {
  const expr = expression.replace(/^\(|\)$/g, '').trim();
  if (expr.includes(' OR ')) return expr.split(' OR ').some((part) => isAllowed(part));
  if (expr.includes(' AND ')) return expr.split(' AND ').every((part) => isAllowed(part));
  return ALLOWED.has(expr);
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** @type {Record<string, { name: string; versions: string[] }[]>} */
const byLicence = JSON.parse(raw);

const failures = [];
const exceptions = [];
let total = 0;
for (const [licence, packages] of Object.entries(byLicence)) {
  for (const pkg of packages) {
    if (pkg.name.startsWith('@fitadapt/')) continue; // our own private workspace packages
    total += 1;
    if (isAllowed(licence)) continue;
    const reason = EXCEPTIONS[/** @type {keyof typeof EXCEPTIONS} */ (pkg.name)];
    if (reason) exceptions.push(`  ${pkg.name}@${pkg.versions.join(',')} [${licence}] — ${reason}`);
    else failures.push(`  ${pkg.name}@${pkg.versions.join(',')} [${licence}]`);
  }
}

console.log(`Checked ${total} third-party packages.`);
if (exceptions.length) console.log(`Reviewed exceptions (${exceptions.length}):\n${exceptions.join('\n')}`);
if (failures.length) {
  console.error(`Licences not on the allowlist (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('All dependency licences are on the allowlist or reviewed.');
