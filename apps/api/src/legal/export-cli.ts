/** `pnpm legal:export --user <id> [--out <file>] [--actor <role>]` — legal-hold export of the defensibility file (L11). */
import { loadEnv } from '../config/env.js';
import { createDatabase } from '../db/client.js';
import { loadLocalEnv, parseExportArgs, runLegalHoldExport, summarise } from './cli.js';
import { LegalService } from './service.js';

loadLocalEnv();
const args = parseExportArgs(process.argv.slice(2));
const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
try {
  const legal = new LegalService({ db: database.db, pepper: env.AUTH_TOKEN_PEPPER, now: () => new Date() });
  const { path, result } = await runLegalHoldExport(legal, args);
  console.log(summarise(path, result));
  if (!result.integrity.ok) process.exitCode = 1;
} finally {
  await database.close();
}
