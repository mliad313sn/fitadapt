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
 * Evaluates an SPDX licence expression (PKG-08): parentheses, `AND` binding
 * tighter than `OR`, `WITH` exceptions. `OR` = any branch allowed, `AND` =
 * every operand allowed. `A WITH B` is allowed only if the whole
 * `A WITH B` string is listed. Operators are upper case, as SPDX requires.
 * Anything malformed (unbalanced parentheses, a dangling operator, an empty
 * expression) is not allowed: the gate fails closed.
 * @param {string} expression
 * @param {Set<string>} allowed
 * @returns {boolean}
 */
export function isAllowed(expression, allowed) {
  const tokens = tokenizeSpdx(expression);
  if (!tokens) return false;
  let at = 0;
  /** @returns {boolean | null} null = malformed */
  const parseOr = () => {
    let value = parseAnd();
    while (value !== null && tokens[at] === 'OR') {
      at += 1;
      const right = parseAnd();
      value = right === null ? null : value || right;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (value !== null && tokens[at] === 'AND') {
      at += 1;
      const right = parseAtom();
      value = right === null ? null : value && right;
    }
    return value;
  };
  /** @returns {boolean | null} */
  const parseAtom = () => {
    const token = tokens[at];
    if (token === '(') {
      at += 1;
      const inner = parseOr();
      if (inner === null || tokens[at] !== ')') return null;
      at += 1;
      return inner;
    }
    if (token === undefined || SPDX_OPERATORS.has(token)) return null;
    at += 1;
    if (tokens[at] === 'WITH') {
      const exception = tokens[at + 1];
      if (exception === undefined || SPDX_OPERATORS.has(exception)) return null;
      at += 2;
      return allowed.has(`${token} WITH ${exception}`);
    }
    return allowed.has(token);
  };
  const result = parseOr();
  return result === true && at === tokens.length;
}

const SPDX_OPERATORS = new Set(['AND', 'OR', 'WITH', '(', ')']);

/** @param {string} expression @returns {string[] | null} */
function tokenizeSpdx(expression) {
  const tokens = expression.replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // Licence ids and LicenseRef-/DocumentRef- references only (letters, digits, '.', '-', '+', ':').
  return tokens.every((t) => SPDX_OPERATORS.has(t) || /^[A-Za-z0-9.+:-]+$/.test(t)) ? tokens : null;
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
