import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { evaluateAudit, formatAudit } from '../lib/audit.mjs';
import { gitleaksAsset, GITLEAKS_SHA256, interpretGitleaksExit } from '../lib/gitleaks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

const report = (vulnerabilities: Record<string, number>, advisories: Record<string, unknown> = {}) => ({
  advisories,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...vulnerabilities } },
});

describe('dependency audit gate (goal condition 4)', () => {
  it('passes with only low and moderate findings', () => {
    const result = evaluateAudit(report({ low: 2, moderate: 3 }, { 1: { module_name: 'uuid', severity: 'moderate', title: 'x' } }));
    expect(result.ok).toBe(true);
    expect(formatAudit(result)).toContain('No high or critical findings.');
  });

  it('fails on a high or a critical finding', () => {
    const high = evaluateAudit(report({ high: 1 }, { 42: { module_name: 'left-pad', severity: 'high', title: 'Prototype pollution' } }));
    expect(high.ok).toBe(false);
    expect(high.blocking).toEqual([{ id: '42', module: 'left-pad', severity: 'high', title: 'Prototype pollution' }]);
    expect(formatAudit(high)).toContain('HIGH left-pad: Prototype pollution (advisory 42)');
    expect(evaluateAudit(report({ critical: 1 })).ok).toBe(false);
    expect(evaluateAudit(report({}, { 7: { severity: 'critical' } })).ok).toBe(false);
  });

  it('fails closed when the audit could not run', () => {
    expect(evaluateAudit({ error: { code: 'ENOTFOUND' } })).toMatchObject({ ok: false, error: 'audit failed: ENOTFOUND' });
    expect(evaluateAudit({ error: {} }).error).toBe('audit failed: unknown error');
    expect(evaluateAudit({}).ok).toBe(false);
    expect(evaluateAudit(null).ok).toBe(false);
    expect(formatAudit(evaluateAudit({}))).toContain('FAILED');
  });

  it('the CLI exits 1 on a high finding and 0 on a clean report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'));
    const bad = join(dir, 'bad.json');
    const good = join(dir, 'good.json');
    const garbage = join(dir, 'garbage.json');
    writeFileSync(bad, JSON.stringify(report({ high: 1 }, { 9: { module_name: 'pkg', severity: 'high', title: 't' } })));
    writeFileSync(good, JSON.stringify(report({ moderate: 1 })));
    writeFileSync(garbage, 'not json');
    const script = join(root, 'tooling/security/scripts/audit-gate.mjs');
    expect(spawnSync('node', [script, '--input', bad]).status).toBe(1);
    expect(spawnSync('node', [script, '--input', good]).status).toBe(0);
    expect(spawnSync('node', [script, '--input', garbage]).status).toBe(1);
  });
});

describe('static analysis gate (goal condition 4)', () => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'tooling/security/eslint.security.config.mjs'), ignore: false });

  it('rejects injection, unsafe regexes and raw HTML', async () => {
    const [ts, tsx] = await eslint.lintFiles([join(here, 'fixtures/sast/vulnerable.ts'), join(here, 'fixtures/sast/vulnerable.tsx')]);
    const rules = new Set([...ts!.messages, ...tsx!.messages].map((m) => m.ruleId));
    for (const rule of [
      'security/detect-child-process',
      'no-eval',
      'security/detect-eval-with-expression',
      'no-new-func',
      'security/detect-non-literal-regexp',
      'security/detect-unsafe-regex',
      'no-implied-eval',
      'no-restricted-syntax',
    ]) {
      expect({ rule, found: rules.has(rule) }).toEqual({ rule, found: true });
    }
    // Every finding is an error (severity 2), so the pipeline fails.
    expect([...ts!.messages, ...tsx!.messages].every((m) => m.severity === 2)).toBe(true);
  });

  it('accepts ordinary code', async () => {
    const [clean] = await eslint.lintFiles([join(here, 'fixtures/sast/clean.ts')]);
    expect(clean!.messages).toEqual([]);
  });
});

describe('secret scanning (goal condition 4)', () => {
  it('pins a checksum-verified gitleaks build per platform', () => {
    expect(gitleaksAsset('linux', 'x64')).toEqual({
      key: 'linux_x64',
      url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/gitleaks_8.28.0_linux_x64.tar.gz',
      sha256: GITLEAKS_SHA256.linux_x64,
    });
    expect(gitleaksAsset('darwin', 'arm64').key).toBe('darwin_arm64');
    expect(() => gitleaksAsset('win32', 'x64')).toThrow('no pinned gitleaks build');
    expect(() => gitleaksAsset('linux', 'ia32')).toThrow('no pinned gitleaks build');
    expect(Object.values(GITLEAKS_SHA256).every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });

  it('fails on leaks and on scanner errors', () => {
    expect(interpretGitleaksExit(0).ok).toBe(true);
    expect(interpretGitleaksExit(1)).toMatchObject({ ok: false, message: expect.stringContaining('LEAKS FOUND') });
    expect(interpretGitleaksExit(126)).toMatchObject({ ok: false, message: expect.stringContaining('failed to run') });
    expect(interpretGitleaksExit(null).ok).toBe(false);
  });

  it('the CI workflow runs all three gates on every pull request', () => {
    const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    for (const step of ['pnpm security:audit', 'pnpm security:secrets', 'pnpm security:sast', 'pnpm compliance:check', 'fetch-depth: 0']) {
      expect(workflow).toContain(step);
    }
  });
});
