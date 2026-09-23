#!/usr/bin/env node
// @ts-check
/** `pnpm compliance:check` — checks docs/compliance (see lib/compliance.mjs). */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retentionConfig } from '@fitadapt/privacy';
import { checkCompliance, REQUIRED_DOCUMENTS } from '../lib/compliance.mjs';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/compliance');
/** @type {Record<string, string | undefined>} */
const docs = {};
for (const name of REQUIRED_DOCUMENTS) {
  const path = join(dir, name);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed document names under the repository's docs/compliance
  docs[name] = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}
const problems = checkCompliance(docs, { retentionKeys: Object.keys(retentionConfig) });
if (problems.length) {
  console.error(`Compliance documents: ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Compliance documents: ${REQUIRED_DOCUMENTS.length} documents present, all drafts marked "requires counsel review"; records of processing complete for every matrix jurisdiction; every checklist item has a status; every retention period is scheduled.`);
