// @ts-check
/**
 * Licence compliance (L6). One engine for `pnpm licences:check` (M00,
 * dependencies only) and `pnpm legal:licences` (M20: dependencies + SBOM +
 * asset/dataset licence register). Policy: tooling/legal/licence-policy.json.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableRows } from './markdown.mjs';

export const POLICY_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'licence-policy.json');
export const ASSET_REGISTER = 'docs/legal/asset-licence-register.md';
export const ASSET_COLUMNS = ['ID', 'Asset', 'Kind', 'Path', 'Licence', 'Commercial use', 'Evidence', 'Status'];

/** @typedef {{ dependencies: { allowed: string[], exceptions: Record<string, string> }, assets: { allowed: string[], statuses: string[], scannedDirectories: string[] } }} LicencePolicy */
/** @typedef {Record<string, { name: string, versions: string[], license?: string, homepage?: string, author?: string }[]>} PnpmLicences */

/** @returns {LicencePolicy} */
export function loadPolicy(path = POLICY_PATH) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the policy file next to this module (tests may pass a fixture)
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Evaluates a simple SPDX expression: OR = any allowed, AND = all allowed.
 * @param {string} expression
 * @param {Set<string>} allowed
 * @returns {boolean}
 */
export function isAllowed(expression, allowed) {
  const expr = expression.replace(/^\(|\)$/g, '').trim();
  if (expr.includes(' OR ')) return expr.split(' OR ').some((part) => isAllowed(part, allowed));
  if (expr.includes(' AND ')) return expr.split(' AND ').every((part) => isAllowed(part, allowed));
  return allowed.has(expr);
}

/**
 * @param {PnpmLicences} byLicence output of `pnpm licenses list --json`
 * @param {LicencePolicy} policy
 */
export function dependencyReport(byLicence, policy) {
  const allowed = new Set(policy.dependencies.allowed);
  /** @type {string[]} */ const failures = [];
  /** @type {string[]} */ const exceptions = [];
  let total = 0;
  for (const [licence, packages] of Object.entries(byLicence)) {
    for (const pkg of packages) {
      if (pkg.name.startsWith('@fitadapt/')) continue; // our own private workspace packages
      total += 1;
      if (isAllowed(licence, allowed)) continue;
      const reason = Object.prototype.hasOwnProperty.call(policy.dependencies.exceptions, pkg.name) ? policy.dependencies.exceptions[pkg.name] : undefined;
      if (reason) exceptions.push(`  ${pkg.name}@${pkg.versions.join(',')} [${licence}] — ${reason}`);
      else failures.push(`  ${pkg.name}@${pkg.versions.join(',')} [${licence}]`);
    }
  }
  return { total, failures, exceptions };
}

/** @param {string} name @param {string} version */
const purl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;

/**
 * CycloneDX 1.5 JSON SBOM of every installed third-party package.
 * @param {PnpmLicences} byLicence
 * @param {{ timestamp: string, serial?: string }} meta
 */
export function buildSbom(byLicence, { timestamp, serial = `urn:uuid:${randomUUID()}` }) {
  const components = [];
  for (const [licence, packages] of Object.entries(byLicence)) {
    for (const pkg of packages) {
      if (pkg.name.startsWith('@fitadapt/')) continue;
      for (const version of pkg.versions) {
        components.push({
          type: 'library',
          'bom-ref': purl(pkg.name, version),
          name: pkg.name,
          version,
          purl: purl(pkg.name, version),
          licenses: [/^[A-Za-z0-9.+-]+$/.test(licence) ? { license: { id: licence } } : { expression: licence }],
          ...(pkg.homepage ? { externalReferences: [{ type: 'website', url: pkg.homepage }] } : {}),
        });
      }
    }
  }
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: serial,
    version: 1,
    metadata: { timestamp, component: { type: 'application', name: 'companion-app (codename withheld)', version: '0.0.0' }, tools: { components: [{ type: 'application', name: 'tooling/legal/scripts/licences.mjs' }] } },
    components,
  };
}

/**
 * Validates the asset/dataset licence register: every scanned file is
 * registered, every registered path exists, licences are allowed for
 * commercial use, evidence is recorded and statuses are known.
 * @param {string | undefined} markdown
 * @param {string[]} files repository-relative paths found in the scanned directories
 * @param {(path: string) => boolean} exists
 * @param {LicencePolicy} policy
 */
export function checkAssetRegister(markdown, files, exists, policy) {
  if (markdown === undefined) return { problems: [`${ASSET_REGISTER}: missing`], entries: 0 };
  const rows = tableRows(markdown, ASSET_COLUMNS);
  if (!rows) return { problems: [`${ASSET_REGISTER}: no table with columns ${ASSET_COLUMNS.join(', ')}`], entries: 0 };
  /** @type {string[]} */ const problems = [];
  const allowed = new Set(policy.assets.allowed);
  const registered = new Set();
  for (const r of rows) {
    const id = r.ID || '(no id)';
    const path = r.Path ?? '';
    registered.add(path);
    if (!policy.assets.statuses.includes(r.Status ?? '')) problems.push(`${id}: status "${r.Status}" (expected one of ${policy.assets.statuses.join(', ')})`);
    if (!(r.Evidence ?? '').trim() || /^(tbd|todo|-|—)$/i.test(r.Evidence ?? '')) problems.push(`${id}: no licence evidence`);
    if (r.Status === 'not_in_use') continue;
    if (!isAllowed(r.Licence ?? '', allowed)) problems.push(`${id}: licence "${r.Licence}" is not allowed for commercial use (allowed: ${policy.assets.allowed.join(', ')})`);
    if ((r['Commercial use'] ?? '').toLowerCase() !== 'yes') problems.push(`${id}: commercial use not confirmed`);
    if (r.Status === 'in_use' && !path.startsWith('npm:') && !exists(path)) problems.push(`${id}: path ${path} does not exist`);
  }
  for (const f of files) if (!registered.has(f)) problems.push(`${f}: asset without a licence record in ${ASSET_REGISTER}`);
  return { problems, entries: rows.length };
}
