#!/usr/bin/env node
// @ts-check
/**
 * `pnpm legal:licences` (L6): dependency licences against the allowlist (the
 * same engine and policy as `pnpm licences:check`), a CycloneDX SBOM in
 * reports/legal/sbom.cdx.json, and the asset/dataset licence register.
 * `--deps-only` runs the dependency check alone (used by licences:check).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from '../lib/claims.mjs';
import { ASSET_REGISTER, buildSbom, checkAssetRegister, dependencyReport, loadPolicy } from '../lib/licences.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const depsOnly = process.argv.includes('--deps-only');
const policy = loadPolicy();
const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: root });
const byLicence = JSON.parse(raw);

let failed = false;
const deps = dependencyReport(byLicence, policy);
console.log(`Checked ${deps.total} third-party packages.`);
if (deps.exceptions.length) console.log(`Reviewed exceptions (${deps.exceptions.length}):\n${deps.exceptions.join('\n')}`);
if (deps.failures.length) {
  console.error(`Licences not on the allowlist (${deps.failures.length}):\n${deps.failures.join('\n')}`);
  failed = true;
} else console.log('All dependency licences are on the allowlist or reviewed.');

if (!depsOnly) {
  const sbom = buildSbom(byLicence, { timestamp: new Date().toISOString() });
  const out = join(root, 'reports/legal/sbom.cdx.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
  console.log(`SBOM: ${sbom.components.length} components (CycloneDX ${sbom.specVersion}) written to ${relative(root, out)}.`);

  const files = policy.assets.scannedDirectories.flatMap((d) => walk(join(root, d))).map((f) => relative(root, f));
  const registerPath = join(root, ASSET_REGISTER);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths from the licence policy and register
  const exists = (/** @type {string} */ p) => existsSync(join(root, p));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed register path under docs/legal
  const assets = checkAssetRegister(existsSync(registerPath) ? readFileSync(registerPath, 'utf8') : undefined, files, exists, policy);
  if (assets.problems.length) {
    console.error(`Asset/dataset licence register: ${assets.problems.length} problem(s):\n${assets.problems.map((p) => `  - ${p}`).join('\n')}`);
    failed = true;
  } else {
    console.log(`Asset/dataset licence register: ${assets.entries} entries valid; ${files.length} files in ${policy.assets.scannedDirectories.join(', ')} all registered.`);
  }
}
if (failed) process.exit(1);
