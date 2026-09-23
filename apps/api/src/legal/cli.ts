import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UuidSchema } from '@fitadapt/shared';
import type { LegalHoldExport } from '@fitadapt/legal';
import type { LegalService } from './service.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Loads `.env`, or `.env.example` outside production, without overriding
 * variables already set (same rule as the integration tests).
 */
export function loadLocalEnv(root = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): void {
  for (const file of env.NODE_ENV === 'production' ? ['.env'] : ['.env', '.env.example']) {
    const path = join(root, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file names (.env, .env.example) at the repository root
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}

export interface ExportArgs {
  userId: string;
  out: string | null;
  actor: string;
}

export function parseExportArgs(argv: readonly string[]): ExportArgs {
  let userId: string | undefined;
  let out: string | null = null;
  let actor = 'legal_counsel_cli';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    const value = argv[i + 1];
    if (arg === '--user' && value) userId = argv[++i];
    else if (arg === '--out' && value) out = argv[++i]!;
    else if (arg === '--actor' && value) actor = argv[++i]!;
    else throw new Error(`Unknown or incomplete argument "${arg}". Usage: pnpm legal:export --user <user-id> [--out <file>] [--actor <role>]`);
  }
  if (!userId || !UuidSchema.safeParse(userId).success) throw new Error('--user <user-id> (a UUID) is required');
  if (!/^[a-z0-9_.-]{1,80}$/.test(actor)) throw new Error('--actor must be a role code such as legal_counsel_cli');
  return { userId, out, actor };
}

/** Runs the export and writes it; returns the path and the export. */
export async function runLegalHoldExport(legal: LegalService, args: ExportArgs, cwd = process.env.INIT_CWD ?? process.cwd()): Promise<{ path: string; result: LegalHoldExport }> {
  const result = await legal.legalHoldExport(args.userId, args.actor);
  const stamp = result.generatedAt.replace(/[:.]/g, '-');
  const path = args.out ? (isAbsolute(args.out) ? args.out : resolve(cwd, args.out)) : join(REPO_ROOT, 'reports/legal', `legal-hold-${result.subjectRef.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}-${stamp}.json`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- output path chosen by the operator running the CLI (--out) or reports/legal
  mkdirSync(dirname(path), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same operator-chosen output path
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return { path, result };
}

export function summarise(path: string, r: LegalHoldExport): string {
  const integrity = r.integrity.ok ? `chain verified (${r.integrity.length} events, head ${r.integrity.head.slice(0, 16)}…)` : `CHAIN BROKEN at event ${r.integrity.brokenAt} (${r.integrity.reason})`;
  return [
    `Legal-hold export written to ${path}`,
    `  subject: ${r.subjectRef} (pseudonymous)`,
    `  integrity: ${integrity}`,
    `  acceptances: ${r.acceptances.length}, consents: ${r.consents.length}, notices: ${r.notices.length}, safety events: ${r.safetyEvents.length}, prescriptions: ${r.prescriptions.length}, program events: ${r.programs.length}`,
    `  engine versions: ${r.engineVersions.map((v) => `${v.engineVersion} (${v.events})`).join(', ') || 'none'}`,
    `  legal holds: ${r.legalHolds.length}, access log entries: ${r.accessLog.length}`,
  ].join('\n');
}
