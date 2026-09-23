#!/usr/bin/env node
// @ts-check
/** `pnpm legal:docs [--write]` — checks docs/legal (see lib/docs.mjs); --write regenerates its generated parts. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLegalDocs, draftFiles, LEGAL_DIR, MATRIX_END, MATRIX_START, matrixTable, replaceBlock, REQUIRED_DOCUMENTS, TRACKER_END, TRACKER_START, trackerTable } from '../lib/docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed document names under docs/legal
const read = (/** @type {string} */ p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed document names under docs/legal
const write = (/** @type {string} */ p, /** @type {string} */ c) => (mkdirSync(dirname(join(root, p)), { recursive: true }), writeFileSync(join(root, p), c));

const generated = draftFiles();
if (process.argv.includes('--write')) {
  for (const [path, content] of Object.entries(generated)) write(path, content);
  for (const [file, start, end, body] of /** @type {[string, string, string, string][]} */ ([
    ['counsel-signoff-tracker.md', TRACKER_START, TRACKER_END, trackerTable()],
    ['jurisdiction-matrix.md', MATRIX_START, MATRIX_END, matrixTable()],
  ])) {
    const path = `${LEGAL_DIR}/${file}`;
    const next = replaceBlock(read(path) ?? '', start, end, body);
    if (next === null) throw new Error(`${path}: generated block markers missing`);
    write(path, next);
  }
  console.log(`Regenerated ${Object.keys(generated).length} drafts, the counsel sign-off tracker and the jurisdiction matrix.`);
}
/** @type {Record<string, string | undefined>} */
const docs = {};
for (const p of [...REQUIRED_DOCUMENTS.map((d) => `${LEGAL_DIR}/${d}`), ...Object.keys(generated)]) docs[p] = read(p);
const problems = checkLegalDocs(docs);
if (problems.length) {
  console.error(`docs/legal: ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `docs/legal: ${Object.keys(docs).length} documents present, every one marked "requires counsel review" and none claiming approval; Gate 0 checklist complete with every item open; counsel sign-off tracker in sync with packages/legal (every entry pending); jurisdiction matrix in sync with config; drafts in sync with packages/i18n.`,
);
