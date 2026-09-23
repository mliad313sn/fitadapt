import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retentionConfig } from '@fitadapt/privacy';
import { describe, expect, it } from 'vitest';
import { checkCompliance, markdownTables, MATRIX_JURISDICTIONS, REQUIRED_DOCUMENTS } from '../lib/compliance.mjs';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/compliance');
const retentionKeys = Object.keys(retentionConfig);

function realDocs(): Record<string, string | undefined> {
  const docs: Record<string, string | undefined> = {};
  for (const name of REQUIRED_DOCUMENTS) docs[name] = existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : undefined;
  return docs;
}

describe('docs/compliance (goal conditions 5 and 7)', () => {
  it('the repository documents pass every check', () => {
    expect(checkCompliance(realDocs(), { retentionKeys })).toEqual([]);
  });

  it('records of processing give lawful basis, transfer mechanism and filing status for every matrix jurisdiction', () => {
    const table = markdownTables(realDocs()['records-of-processing.md']!).find((t) => t.header.includes('Authority filing status'))!;
    expect(table.header).toEqual(['Jurisdiction', 'Lawful basis', 'Transfer mechanism', 'Authority filing status']);
    for (const jurisdiction of MATRIX_JURISDICTIONS) {
      const row = table.rows.find((r) => r[0]!.includes(jurisdiction));
      expect({ jurisdiction, cells: row?.slice(1).every((c) => c.length > 20) }).toEqual({ jurisdiction, cells: true });
    }
  });

  it('flags a missing document, a missing draft marker and a claim of counsel approval', () => {
    const docs = realDocs();
    const problems = checkCompliance(
      { ...docs, 'dpia.md': undefined, 'breach-runbook.md': '# Runbook', 'README.md': `${docs['README.md']}\nThis file is counsel-approved.` },
      { retentionKeys },
    );
    expect(problems).toEqual([
      'README.md: claims counsel approval (L5 forbids it)',
      'dpia.md: missing',
      'breach-runbook.md: not marked "requires counsel review"',
    ]);
  });

  it('flags a jurisdiction without a transfer mechanism or filing status, or missing entirely', () => {
    const docs = realDocs();
    const ropa = docs['records-of-processing.md']!
      .split('\n')
      .map((line) => (line.startsWith('| Senegal |') ? '| Senegal | consent | TBD |  |' : line))
      .filter((line) => !line.startsWith('| United Kingdom |'))
      .join('\n');
    expect(checkCompliance({ ...docs, 'records-of-processing.md': ropa }, { retentionKeys })).toEqual([
      'records-of-processing.md: no row for United Kingdom',
      'records-of-processing.md: Senegal has no transfer mechanism',
      'records-of-processing.md: Senegal has no authority filing status',
    ]);
    const noTable = checkCompliance({ ...docs, 'records-of-processing.md': 'requires counsel review\n| a | b |\n|---|---|\n| 1 | 2 |' }, { retentionKeys });
    expect(noTable).toEqual(['records-of-processing.md: no table with columns Jurisdiction, Lawful basis, Transfer mechanism, Authority filing status']);
  });

  it('flags checklist items without a valid status, and a checklist missing MASVS or ASVS', () => {
    const docs = realDocs();
    const checklist = docs['masvs-asvs-checklist.md']!.replace('| MASVS-NETWORK-2 | Identity pinning for own endpoints | Deferred |', '| MASVS-NETWORK-2 | Identity pinning for own endpoints | maybe later |');
    expect(checkCompliance({ ...docs, 'masvs-asvs-checklist.md': checklist }, { retentionKeys })).toEqual([
      'masvs-asvs-checklist.md: MASVS-NETWORK-2 has status "maybe later" (expected one of Implemented, Partial, Planned, Deferred, Not applicable)',
    ]);
    const empty = checkCompliance({ ...docs, 'masvs-asvs-checklist.md': 'requires counsel review' }, { retentionKeys });
    expect(empty).toEqual(['masvs-asvs-checklist.md: no MASVS items', 'masvs-asvs-checklist.md: no ASVS items']);
  });

  it('flags a retention period in code that the schedule does not list', () => {
    expect(checkCompliance(realDocs(), { retentionKeys: [...retentionKeys, 'photoBackupRetentionDays'] })).toEqual([
      'retention-schedule.md: retention period `photoBackupRetentionDays` is not listed',
    ]);
  });

  it('parses markdown tables', () => {
    expect(markdownTables('text\n| a | b |\n|---|:--|\n| 1 | 2 |\n| 3 | 4 |\nafter')).toEqual([{ header: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }]);
    expect(markdownTables('| not a table |\nno separator')).toEqual([]);
  });
});
