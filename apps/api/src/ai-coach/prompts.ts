import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const stripComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').trim();

/**
 * The stable system prompt of every AI-coach request: the M20 legal preamble
 * FIRST (packages/legal/prompts, L1/L5/S6), then the coach rules
 * (src/ai-coach/prompts). Both files are linted by `pnpm legal:claims`. They
 * are read once at start; the text is identical for every user and turn, so
 * the provider can cache it.
 */
export function loadCoachSystemPrompt(): string {
  const require = createRequire(import.meta.url);
  const legalRoot = dirname(dirname(require.resolve('@fitadapt/legal')));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file inside the installed @fitadapt/legal package
  const preamble = readFileSync(join(legalRoot, 'prompts', 'ai-coach-legal-preamble.en.md'), 'utf8');
  // Same path from src/ (tsx, tests) and from dist/ (node): the prompts stay in src/ai-coach/prompts.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file in this package's source tree
  const rules = readFileSync(fileURLToPath(new URL('../../src/ai-coach/prompts/coach-system.en.md', import.meta.url)), 'utf8');
  return `${stripComments(preamble)}\n\n${stripComments(rules)}`;
}
