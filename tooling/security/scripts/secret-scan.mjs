#!/usr/bin/env node
// @ts-check
/**
 * `pnpm security:secrets [repo-path]` — scans the whole git history with the
 * pinned gitleaks release (checksum-verified) and fails on any finding.
 * GITLEAKS_BIN may point at an already verified binary.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitleaksAsset, GITLEAKS_VERSION, interpretGitleaksExit } from '../lib/gitleaks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = resolve(process.argv[2] ?? root);

async function ensureBinary() {
  if (process.env.GITLEAKS_BIN) return process.env.GITLEAKS_BIN;
  const asset = gitleaksAsset(process.platform, process.arch);
  const dir = join(root, 'node_modules', '.cache', 'gitleaks', GITLEAKS_VERSION);
  const bin = join(dir, 'gitleaks');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- cache path under the repository's node_modules
  if (existsSync(bin)) return bin;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same cache directory
  mkdirSync(dir, { recursive: true });
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== asset.sha256) throw new Error(`gitleaks checksum mismatch (${digest})`);
  const tgz = join(dir, 'gitleaks.tar.gz');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same cache directory; archive checksum verified above
  writeFileSync(tgz, archive);
  execFileSync('tar', ['-xzf', tgz, '-C', dir, 'gitleaks']);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same cache directory
  chmodSync(bin, 0o755);
  return bin;
}

const bin = await ensureBinary();
const config = join(root, '.gitleaks.toml');
const args = ['git', '--redact', '--verbose', '--no-banner', '--exit-code', '1', ...(existsSync(config) ? ['--config', config] : []), target];
const run = spawnSync(bin, args, { stdio: 'inherit' });
const verdict = interpretGitleaksExit(run.status);
console.log(verdict.message);
process.exit(verdict.ok ? 0 : 1);
