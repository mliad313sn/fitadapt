#!/usr/bin/env node
// @ts-check
/**
 * `pnpm legal:claims [--file <path>]...` — claims linter (L1) and codename
 * check (L7). Extra files (e.g. AI-coach eval outputs, M11) are linted with
 * both languages' rules. Exit 1 on any finding.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en, fr } from '@fitadapt/i18n';
import { runClaimsLint } from '../lib/claims.mjs';
import { storeMetadataFiles } from '../lib/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
/** @type {string[]} */
const extraFiles = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) extraFiles.push(/** @type {string} */ (args[++i]));
  else if (args[i] !== '--') {
    console.error(`Unknown argument ${args[i]}. Usage: pnpm legal:claims [--file <path>]...`);
    process.exit(2);
  }
}

const result = runClaimsLint(root, { catalogues: { en, fr }, extraFiles });
const stale = Object.entries(storeMetadataFiles({ en, fr }))
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed store/metadata paths generated from constant tables
  .filter(([path, content]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== content)
  .map(([path]) => `${path}: out of date with packages/i18n store.listing.* (run pnpm legal:store --write)`);

const failures = [
  ...result.problems,
  ...stale,
  ...result.findings.map((f) => `${f.source}${f.key ? ` ${f.key}` : ''}: "${f.match}" (${f.ruleId}, ${f.category}) — reword, or add the phrase with evidence to docs/legal/substantiation-file.md`),
  ...result.codename.map((c) => `${c} (L7: the codename must not appear in store metadata or public assets)`),
];
console.log(`Claims lint: ${result.messagesScanned} catalogue messages and ${result.filesScanned} files (store metadata, prompts, marketing${extraFiles.length ? ', extra files' : ''}); ${result.entries} substantiation entries.`);
if (failures.length) {
  console.error(`Claims lint: ${failures.length} problem(s):\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Claims lint: no medical or results claim outside the substantiation file; codename absent from store metadata and public assets.');
