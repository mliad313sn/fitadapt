// @ts-check
/**
 * Markdown tables in a document (same parser as tooling/security/lib/compliance.mjs).
 * @param {string} markdown
 * @returns {{ header: string[], rows: string[][] }[]}
 */
export function markdownTables(markdown) {
  const tables = [];
  const lines = markdown.split('\n');
  const cells = (/** @type {string} */ row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(next)) continue;
    const header = cells(line);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && (lines[j] ?? '').trim().startsWith('|')) {
      rows.push(cells(lines[j] ?? ''));
      j += 1;
    }
    tables.push({ header, rows });
    i = j - 1;
  }
  return tables;
}

/**
 * Rows of the first table that has every given column, as objects.
 * @param {string} markdown
 * @param {string[]} columns
 * @returns {Record<string, string>[] | null}
 */
export function tableRows(markdown, columns) {
  const table = markdownTables(markdown).find((t) => columns.every((c) => t.header.includes(c)));
  if (!table) return null;
  return table.rows.map((r) => Object.fromEntries(table.header.map((h, i) => [h, (r[i] ?? '').replace(/`/g, '').trim()])));
}

export const DRAFT_MARKER = /requires counsel review/i;
export const FORBIDDEN_APPROVAL = /counsel[- ]approved|approved by counsel|signed off by counsel/i;
