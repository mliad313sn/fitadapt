#!/usr/bin/env node
// @ts-check
/** `pnpm legal:store --write` — regenerates store/metadata from the i18n catalogues (store.listing.*). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en, fr } from '@fitadapt/i18n';
import { storeMetadataFiles } from '../lib/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (!process.argv.includes('--write')) {
  console.error('Usage: pnpm legal:store --write (the check runs in pnpm legal:claims)');
  process.exit(2);
}
for (const [path, content] of Object.entries(storeMetadataFiles({ en, fr }))) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed store/metadata paths generated from constant tables
  mkdirSync(dirname(join(root, path)), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same fixed paths
  writeFileSync(join(root, path), content);
  console.log(`wrote ${path}`);
}
