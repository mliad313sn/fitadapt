/**
 * Text folding for the deterministic classifiers: lower case, accents removed,
 * typographic apostrophes and dashes made plain, whitespace collapsed. Every
 * pattern in this package is written against folded text.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u00a0\u202f\s]+/g, ' ')
    .trim();
}

/** Words of folded text (letters and digits), for keyword retrieval. */
export function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

export function anyMatch(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}
