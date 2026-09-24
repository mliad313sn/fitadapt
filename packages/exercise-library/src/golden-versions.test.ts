import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_VERSION } from '@fitadapt/engine';
import { describe, expect, it } from 'vitest';

/**
 * SAF-10: the persona golden files are the reviewed prescriptions of an
 * engine version. The server re-derives every session under its own code
 * with the same version string, so a prescription change without an
 * ENGINE_VERSION bump makes another build's sessions fail (session.mismatch)
 * — and a golden regenerated with `vitest -u` would otherwise pass silently.
 *
 * GOLDEN_DIGESTS maps each engine version to the SHA-256 of all golden files.
 * When a golden changes: bump ENGINE_VERSION (packages/engine/src/version.ts)
 * and ADD a line for the new version. An existing line is never edited — a
 * changed digest for an existing version is a prescription change without a
 * bump, and review must refuse it.
 */
const GOLDEN_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  // FIX-A (docs/status/FIX-A-engine-safety.md): goldens record their versions; P4's incline push-up coefficient 0.41 → 0.48.
  '0.5.0': '004563a7628f613e47f64688eb1608f93f715e8faa82183166b4f9493becec23',
});

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '__golden__');

function digest(): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(dir, f), 'utf8'));
  }
  return h.digest('hex');
}

const semver = (v: string) => v.split('.').map(Number) as [number, number, number];
const cmp = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe('SAF-10: the golden prescriptions are tied to ENGINE_VERSION', () => {
  it('the goldens on disk are the ones recorded for this engine version (a change needs a version bump)', () => {
    expect(GOLDEN_DIGESTS[ENGINE_VERSION], `no golden digest recorded for engine ${ENGINE_VERSION}: add one when bumping`).toBeDefined();
    expect(digest(), `golden files changed under engine ${ENGINE_VERSION}: bump ENGINE_VERSION and record the new digest`).toBe(GOLDEN_DIGESTS[ENGINE_VERSION]);
  });

  it('every golden file records the engine version it was produced with; the current version is the newest recorded', () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const body = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { engineVersion?: string; rulesVersion?: string };
      expect(body.engineVersion, f).toBe(ENGINE_VERSION);
      expect(body.rulesVersion, f).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const versions = Object.keys(GOLDEN_DIGESTS).sort(cmp);
    expect(versions.at(-1)).toBe(ENGINE_VERSION);
  });
});
