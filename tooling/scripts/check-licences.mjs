#!/usr/bin/env node
// @ts-check
/**
 * Dependency licence gate (L6, M00). Since M20 this is the dependency part of
 * `pnpm legal:licences`: same engine (tooling/legal/lib/licences.mjs) and the
 * same policy (tooling/legal/licence-policy.json), so the two can never
 * disagree. `pnpm legal:licences` adds the SBOM and the asset register.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../legal/scripts/licences.mjs'), '--deps-only'], { stdio: 'inherit' });
