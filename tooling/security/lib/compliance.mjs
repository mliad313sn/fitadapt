// @ts-check
/**
 * Checks docs/compliance (M17 goal conditions 5 and 7): the required documents
 * exist, each is marked as a draft that requires counsel review (L5), the
 * records of processing give lawful basis, transfer mechanism and
 * authority-filing status for every jurisdiction in the legal-framework matrix,
 * every MASVS/ASVS checklist item has a status, and the retention schedule
 * lists every retention period in the code config.
 */

export const REQUIRED_DOCUMENTS = Object.freeze([
  'README.md',
  'dpia.md',
  'records-of-processing.md',
  'retention-schedule.md',
  'breach-runbook.md',
  'masvs-asvs-checklist.md',
]);

/** Jurisdictions of the matrix in docs/specs/00-legal-framework.md. */
export const MATRIX_JURISDICTIONS = Object.freeze([
  'EU (France)',
  'United Kingdom',
  'United States',
  'Senegal',
  "Côte d'Ivoire",
  'App stores',
]);

export const RECORD_COLUMNS = Object.freeze(['Jurisdiction', 'Lawful basis', 'Transfer mechanism', 'Authority filing status']);

export const CHECKLIST_STATUSES = Object.freeze(['Implemented', 'Partial', 'Planned', 'Deferred', 'Not applicable']);

const DRAFT_MARKER = /requires counsel review/i;
const FORBIDDEN_APPROVAL = /counsel[- ]approved|approved by counsel/i;

/**
 * Markdown tables in a document.
 * @param {string} markdown
 * @returns {{ header: string[], rows: string[][] }[]}
 */
export function markdownTables(markdown) {
  const tables = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(next)) continue;
    const cells = (/** @type {string} */ row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
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
 * @param {Record<string, string | undefined>} docs file name -> content (undefined = missing)
 * @param {{ retentionKeys: string[] }} options
 * @returns {string[]} problems; empty means compliant
 */
export function checkCompliance(docs, { retentionKeys }) {
  const problems = [];
  for (const name of REQUIRED_DOCUMENTS) {
    const content = docs[name];
    if (content === undefined) {
      problems.push(`${name}: missing`);
      continue;
    }
    if (!DRAFT_MARKER.test(content)) problems.push(`${name}: not marked "requires counsel review"`);
    if (FORBIDDEN_APPROVAL.test(content)) problems.push(`${name}: claims counsel approval (L5 forbids it)`);
  }

  const ropa = docs['records-of-processing.md'];
  if (ropa !== undefined) {
    const table = markdownTables(ropa).find((t) => RECORD_COLUMNS.every((c) => t.header.includes(c)));
    if (!table) {
      problems.push(`records-of-processing.md: no table with columns ${RECORD_COLUMNS.join(', ')}`);
    } else {
      const col = (/** @type {string} */ name) => table.header.indexOf(name);
      for (const jurisdiction of MATRIX_JURISDICTIONS) {
        const row = table.rows.find((r) => (r[col('Jurisdiction')] ?? '').includes(jurisdiction));
        if (!row) {
          problems.push(`records-of-processing.md: no row for ${jurisdiction}`);
          continue;
        }
        for (const column of RECORD_COLUMNS.slice(1)) {
          const value = (row[col(column)] ?? '').trim();
          if (value === '' || /^(tbd|todo|-|\?)$/i.test(value)) problems.push(`records-of-processing.md: ${jurisdiction} has no ${column.toLowerCase()}`);
        }
      }
    }
  }

  const checklist = docs['masvs-asvs-checklist.md'];
  if (checklist !== undefined) {
    const items = markdownTables(checklist)
      .filter((t) => t.header.includes('ID') && t.header.includes('Status'))
      .flatMap((t) => t.rows.map((r) => ({ id: r[t.header.indexOf('ID')] ?? '', status: r[t.header.indexOf('Status')] ?? '' })));
    const masvs = items.filter((i) => /^MASVS-/.test(i.id));
    const asvs = items.filter((i) => /^V\d[\d.]*$/.test(i.id));
    if (masvs.length === 0) problems.push('masvs-asvs-checklist.md: no MASVS items');
    if (asvs.length === 0) problems.push('masvs-asvs-checklist.md: no ASVS items');
    for (const item of items) {
      if (!CHECKLIST_STATUSES.includes(item.status.replace(/\*/g, '').trim())) {
        problems.push(`masvs-asvs-checklist.md: ${item.id || '(no id)'} has status "${item.status}" (expected one of ${CHECKLIST_STATUSES.join(', ')})`);
      }
    }
  }

  const retention = docs['retention-schedule.md'];
  if (retention !== undefined) {
    for (const key of retentionKeys) {
      if (!retention.includes(`\`${key}\``)) problems.push(`retention-schedule.md: retention period \`${key}\` is not listed`);
    }
  }
  return problems;
}
