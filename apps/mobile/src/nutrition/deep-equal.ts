/** Structural equality of plain JSON data (records read back from storage); key order does not matter. */
export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => isDeepStrictEqual(v, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
