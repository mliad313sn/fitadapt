// @ts-check
/* eslint-disable security/detect-non-literal-fs-filename -- read-only walk of fixed repository directories (TEXT_DIRECTORIES, PUBLIC_DIRECTORIES) and files named on the command line by the developer or CI */
/**
 * `pnpm legal:claims` (L1, L7): lints i18n catalogues, store/ metadata,
 * AI-coach prompts, marketing copy and any extra file (AI eval outputs)
 * against the FR/EN denylists in @fitadapt/legal, allowing only phrases in
 * docs/legal/substantiation-file.md that carry evidence. Also checks that
 * the codename never appears in store metadata or public assets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { catalogueTargets, findCodename, lintClaims, validateSubstantiation } from '@fitadapt/legal';
import { tableRows } from './markdown.mjs';

export const SUBSTANTIATION_FILE = 'docs/legal/substantiation-file.md';
export const SUBSTANTIATION_COLUMNS = ['ID', 'Phrase', 'Locale', 'Kind', 'Evidence', 'Scope', 'Counsel review'];
/** Directories whose text files are linted (created by later modules: M11 prompts, M19 marketing). */
export const TEXT_DIRECTORIES = ['store/metadata', 'packages/legal/prompts', 'apps/api/src/ai-coach/prompts', 'marketing'];
/** L7: where the codename must never appear. */
export const PUBLIC_DIRECTORIES = ['store', 'apps/mobile/assets', 'apps/coach-web/public'];
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.html', '.svg', '.xml', '.yaml', '.yml']);

/**
 * @param {string} markdown
 * @returns {{ entries: import('@fitadapt/legal').SubstantiationEntry[], problems: string[] }}
 */
export function parseSubstantiation(markdown) {
  const rows = tableRows(markdown, SUBSTANTIATION_COLUMNS);
  if (!rows) return { entries: [], problems: [`${SUBSTANTIATION_FILE}: no table with columns ${SUBSTANTIATION_COLUMNS.join(', ')}`] };
  const entries = rows.map((r) => ({
    id: r.ID ?? '',
    phrase: (r.Phrase ?? '').replace(/^"|"$/g, ''),
    locale: /** @type {any} */ (r.Locale ?? ''),
    kind: /** @type {any} */ (r.Kind ?? ''),
    evidence: r.Evidence ?? '',
    scope: r.Scope ?? '',
    review: r['Counsel review'] ?? '',
  }));
  return { entries, problems: validateSubstantiation(entries).map((p) => `${SUBSTANTIATION_FILE}: ${p}`) };
}

/**
 * @param {string} dir absolute
 * @returns {string[]}
 */
export function walk(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** @param {string} path */
export function localeOf(path) {
  const p = path.toLowerCase();
  if (/(^|[/._-])fr([/._-]|$)/.test(p)) return 'fr';
  if (/(^|[/._-])en([/._-]|$)/.test(p)) return 'en';
  return 'any';
}

/**
 * @param {string} root repository root
 * @param {{ catalogues: { en: Record<string, string>, fr: Record<string, string> }, extraFiles?: string[], substantiationMarkdown?: string }} options
 */
export function runClaimsLint(root, { catalogues, extraFiles = [], substantiationMarkdown }) {
  const markdown = substantiationMarkdown ?? readFileSync(join(root, SUBSTANTIATION_FILE), 'utf8');
  const { entries, problems } = parseSubstantiation(markdown);
  /** @type {import('@fitadapt/legal').LintTarget[]} */
  const targets = [...catalogueTargets('packages/i18n (en)', 'en', catalogues.en), ...catalogueTargets('packages/i18n (fr)', 'fr', catalogues.fr)];
  const files = [...TEXT_DIRECTORIES.flatMap((d) => walk(join(root, d))), ...extraFiles.map((f) => join(root, f))];
  for (const file of files) {
    if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    targets.push({ source: relative(root, file), locale: /** @type {any} */ (localeOf(relative(root, file))), text: readFileSync(file, 'utf8') });
  }
  const findings = lintClaims(targets, entries);

  /** @type {string[]} */
  const codename = [];
  const publicFiles = PUBLIC_DIRECTORIES.flatMap((d) => walk(join(root, d)));
  for (const file of publicFiles) {
    const rel = relative(root, file);
    if (findCodename(basename(file)).length) codename.push(`${rel}: file name contains the codename`);
    if (TEXT_EXTENSIONS.has(extname(file).toLowerCase()) && findCodename(readFileSync(file, 'utf8')).length) codename.push(`${rel}: contains the codename`);
  }
  const appJson = join(root, 'apps/mobile/app.json');
  if (existsSync(appJson)) {
    const expo = JSON.parse(readFileSync(appJson, 'utf8')).expo ?? {};
    for (const [field, value] of Object.entries({ name: expo.name, slug: expo.slug, scheme: expo.scheme, ios: expo.ios?.bundleIdentifier, android: expo.android?.package })) {
      if (typeof value === 'string' && findCodename(value).length) codename.push(`apps/mobile/app.json: expo.${field} contains the codename (store metadata)`);
    }
  }
  for (const t of targets.filter((x) => x.key)) {
    if (findCodename(t.text).length) codename.push(`${t.source}: ${t.key} (user-facing text) contains the codename`);
  }
  return { findings, problems, codename, filesScanned: files.length, messagesScanned: targets.length - files.length, entries: entries.length };
}
