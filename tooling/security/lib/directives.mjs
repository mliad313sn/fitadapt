// @ts-check
/**
 * Suppression hygiene for the SAST gate (PKG-09, ADR-007). A disable
 * directive in shipped code must name the rules it silences and give a
 * reason after `--`; an inline rule configuration comment (which can turn a
 * rule off for the whole file) is not accepted at all.
 *
 * Findings are added by a processor's postprocess step, after ESLint has
 * applied the directives, so a file-wide disable cannot silence them.
 * Comments are found with a scan of the raw text: a directive-like text in
 * a string literal is flagged too (the gate fails closed).
 */

export const RULE_ID = 'sast/justified-suppression';

// Line comments: the -line and -next-line forms of the disable directive.
const LINE_COMMENT = /\/\/[^\S\n]*(eslint-disable(?:-next-line|-line)?)(?![\w-])([^\n]*)/g;
// Block comments: eslint-disable, eslint-disable-line, eslint-disable-next-line, eslint-enable, or `eslint rule: value`.
const BLOCK_COMMENT = /\/\*\s*(eslint-disable(?:-next-line|-line)?|eslint-enable|eslint)(?![\w-])((?:[^*]|\*(?!\/))*)\*\//g;
const DESCRIPTION = /\s-{2,}\s/;

/**
 * @param {string} text
 * @returns {{ line: number, column: number, message: string }[]}
 */
export function unjustifiedDirectives(text) {
  /** @type {{ index: number, message: string }[]} */
  const found = [];
  const check = (/** @type {RegExpMatchArray} */ m, /** @type {boolean} */ block) => {
    const keyword = m[1] ?? '';
    const body = m[2] ?? '';
    if (keyword === 'eslint-enable') return;
    if (keyword === 'eslint') {
      if (block && /^\s+\S/.test(body)) found.push({ index: m.index ?? 0, message: 'Inline rule configuration is not allowed in shipped code; use a rule-specific eslint-disable with a reason.' });
      return;
    }
    const [rules = '', ...rest] = body.split(DESCRIPTION);
    const reason = rest.join(' ').trim();
    if (!rules.trim()) found.push({ index: m.index ?? 0, message: `A bare ${keyword} silences every rule, including the SAST rules: name the rules and give a reason after "--".` });
    else if (reason.length < 3) found.push({ index: m.index ?? 0, message: `${keyword} needs a reason after "--" (a justified suppression is the only way to accept a SAST finding).` });
  };
  for (const m of text.matchAll(LINE_COMMENT)) check(m, false);
  for (const m of text.matchAll(BLOCK_COMMENT)) check(m, true);
  found.sort((a, b) => a.index - b.index);
  return found.map(({ index, message }) => {
    const before = text.slice(0, index);
    const line = before.split('\n').length;
    return { line, column: index - before.lastIndexOf('\n'), message };
  });
}

/**
 * ESLint processor: lints the file unchanged and, after directives were
 * applied, adds an error for every unjustified directive.
 * @returns {import('eslint').Linter.Processor}
 */
export function suppressionProcessor() {
  /** @type {Map<string, string>} */
  const texts = new Map();
  return {
    meta: { name: 'sast-justified-suppression' },
    supportsAutofix: false,
    preprocess(text, filename) {
      texts.set(filename, text);
      return [text];
    },
    postprocess(messageLists, filename) {
      const text = texts.get(filename) ?? '';
      texts.delete(filename);
      /** @type {import('eslint').Linter.LintMessage[]} */
      const extra = unjustifiedDirectives(text).map((d) => ({ ruleId: RULE_ID, severity: 2, message: d.message, line: d.line, column: d.column, nodeType: null }));
      return [...messageLists.flat(), ...extra];
    },
  };
}
