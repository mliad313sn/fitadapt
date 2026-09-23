import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en, fr } from '@fitadapt/i18n';
import { describe, expect, it } from 'vitest';
import { localeOf, parseSubstantiation, runClaimsLint, SUBSTANTIATION_FILE } from '../lib/claims.mjs';
import { checkLegalDocs, draftFiles, LEGAL_DIR, REQUIRED_DOCUMENTS, replaceBlock, TRACKER_END, TRACKER_START, trackerTable } from '../lib/docs.mjs';
import { ASSET_REGISTER, buildSbom, checkAssetRegister, dependencyReport, isAllowed, loadPolicy } from '../lib/licences.mjs';
import { markdownTables, tableRows } from '../lib/markdown.mjs';
import { storeMetadataFiles } from '../lib/store.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const catalogues = { en, fr };
const fixture = (name: string) => `tooling/legal/test/fixtures/claims/${name}`;
const substantiation = readFileSync(join(root, SUBSTANTIATION_FILE), 'utf8');

describe('pnpm legal:claims (L1, L7)', () => {
  it('the repository passes: catalogues, store metadata and prompts contain no claim outside the substantiation file', () => {
    const r = runClaimsLint(root, { catalogues });
    expect({ findings: r.findings, problems: r.problems, codename: r.codename }).toEqual({ findings: [], problems: [], codename: [] });
    expect(r.filesScanned).toBeGreaterThanOrEqual(11);
    expect(r.messagesScanned).toBe(Object.keys(en).length * 2);
  });

  it('fails on a fixture with forbidden EN and FR claims', () => {
    const r = runClaimsLint(root, { catalogues, extraFiles: [fixture('forbidden-claim.en.txt'), fixture('forbidden-claim.fr.txt')] });
    expect(r.findings.map((f) => `${f.source.split('/').pop()}:${f.ruleId}`).sort()).toEqual([
      'forbidden-claim.en.txt:en.burn_fat',
      'forbidden-claim.en.txt:en.guarantee',
      'forbidden-claim.fr.txt:fr.bruler_graisses',
      'forbidden-claim.fr.txt:fr.garanti',
      'forbidden-claim.fr.txt:fr.perdre_x_en_y',
    ]);
  });

  it('passes a fixture whose phrase is an entry of the substantiation file, and fails it without that entry', () => {
    expect(runClaimsLint(root, { catalogues, extraFiles: [fixture('substantiated-disclaimer.en.txt')] }).findings).toEqual([]);
    const without = substantiation.split('\n').filter((l) => !l.startsWith('| SUB-D1 ')).join('\n');
    const r = runClaimsLint(root, { catalogues, extraFiles: [fixture('substantiated-disclaimer.en.txt')], substantiationMarkdown: without });
    expect(new Set(r.findings.filter((f) => f.source.endsWith('substantiated-disclaimer.en.txt')).map((f) => f.ruleId))).toEqual(new Set(['en.diagnose', 'en.treat', 'en.cure', 'en.prevent_disease']));
  });

  it('a catalogue message with a forbidden claim fails', () => {
    const r = runClaimsLint(root, { catalogues: { en: { ...en, 'x.promo': 'Treats back pain in days' }, fr: { ...fr, 'x.promo': 'Soigne le mal de dos' } } });
    expect(r.findings.map((f) => [f.key, f.ruleId])).toEqual([['x.promo', 'en.treat'], ['x.promo', 'fr.soigner']]);
  });

  it('reports a malformed substantiation file', () => {
    expect(parseSubstantiation('requires counsel review, no table').problems).toEqual([`${SUBSTANTIATION_FILE}: no table with columns ID, Phrase, Locale, Kind, Evidence, Scope, Counsel review`]);
    const bad = substantiation.replace('| SUB-D2 | "we do not guarantee any particular result" | en | disclaimer | L1 forbids guaranteed results; negative statement | Terms of Use | pending |', '| SUB-D2 | "we do not guarantee any particular result" | en | disclaimer |  | Terms of Use | approved |');
    expect(parseSubstantiation(bad).problems).toEqual([
      `${SUBSTANTIATION_FILE}: SUB-D2: missing evidence (an entry without evidence does not allow anything)`,
      `${SUBSTANTIATION_FILE}: SUB-D2: review status "approved" — only counsel can approve (L5); use "pending"`,
    ]);
  });

  it('finds the codename in store metadata, public assets, the app identity and user-facing strings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'claims-'));
    mkdirSync(join(tmp, 'docs/legal'), { recursive: true });
    writeFileSync(join(tmp, SUBSTANTIATION_FILE), substantiation);
    mkdirSync(join(tmp, 'store/metadata/en-US'), { recursive: true });
    writeFileSync(join(tmp, 'store/metadata/en-US/name.txt'), 'FitAdapt — train smarter\n');
    mkdirSync(join(tmp, 'apps/coach-web/public'), { recursive: true });
    writeFileSync(join(tmp, 'apps/coach-web/public/fitadapt-logo.png'), 'binary');
    mkdirSync(join(tmp, 'apps/mobile'), { recursive: true });
    writeFileSync(join(tmp, 'apps/mobile/app.json'), JSON.stringify({ expo: { name: 'Fit Adapt', slug: 'companion', ios: { bundleIdentifier: 'com.fitadapt.app' } } }));
    const r = runClaimsLint(tmp, { catalogues: { en: { 'home.title': 'Welcome to FitAdapt' }, fr: { 'home.title': 'Bienvenue' } } });
    expect(r.codename.sort()).toEqual([
      'apps/coach-web/public/fitadapt-logo.png: file name contains the codename',
      'apps/mobile/app.json: expo.ios contains the codename (store metadata)',
      'apps/mobile/app.json: expo.name contains the codename (store metadata)',
      'packages/i18n (en): home.title (user-facing text) contains the codename',
      'store/metadata/en-US/name.txt: contains the codename',
    ]);
  });

  it('lints marketing copy with both languages, skips binary files and works without an app.json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'claims-any-'));
    mkdirSync(join(tmp, 'docs/legal'), { recursive: true });
    writeFileSync(join(tmp, SUBSTANTIATION_FILE), substantiation);
    mkdirSync(join(tmp, 'marketing'), { recursive: true });
    writeFileSync(join(tmp, 'marketing/landing.md'), 'Maigrir vite and melt away fat.');
    writeFileSync(join(tmp, 'marketing/hero.png'), 'Burn fat fast');
    mkdirSync(join(tmp, 'store/assets'), { recursive: true });
    writeFileSync(join(tmp, 'store/assets/icon.png'), 'png');
    const r = runClaimsLint(tmp, { catalogues: { en: {}, fr: {} } });
    expect(r.findings.map((f) => f.ruleId).sort()).toEqual(['en.melt_fat', 'fr.maigrir_vite']);
    expect(r.codename).toEqual([]);
    expect(r.filesScanned).toBe(2);
  });

  it('guesses the locale from the path', () => {
    expect(localeOf('store/metadata/fr-FR/name.txt')).toBe('fr');
    expect(localeOf('prompts/system.en.md')).toBe('en');
    expect(localeOf('evals/output.json')).toBe('any');
  });

  it('store metadata is generated from the catalogues and in sync', () => {
    const files = storeMetadataFiles(catalogues);
    expect(Object.keys(files)).toHaveLength(10);
    for (const [path, content] of Object.entries(files)) expect(readFileSync(join(root, path), 'utf8')).toBe(content);
    expect(() => storeMetadataFiles({ en: {}, fr: {} })).toThrow(/missing catalogue key/);
  });
});

const policy = loadPolicy();

describe('pnpm legal:licences (L6)', () => {
  const pnpmJson = {
    MIT: [{ name: 'left-pad', versions: ['1.3.0'], homepage: 'https://example.test' }, { name: '@fitadapt/ui', versions: ['0.0.0'] }],
    'MPL-2.0': [{ name: 'lightningcss', versions: ['1.33.0'] }],
    'GPL-3.0-only': [{ name: 'copyleft-lib', versions: ['2.0.0'] }],
    '(MIT OR GPL-3.0)': [{ name: 'dual', versions: ['1.0.0'] }],
    'MIT AND GPL-3.0': [{ name: 'both', versions: ['1.0.0'] }],
    'FSL-1.1': [{ name: '@scope/cli', versions: ['1.0.0', '1.1.0'] }],
  };

  it('fails on licences outside the allowlist, accepts reviewed exceptions and allowed alternatives', () => {
    const r = dependencyReport(pnpmJson, policy);
    expect(r.total).toBe(6);
    expect(r.exceptions).toHaveLength(1);
    expect(r.failures).toEqual(['  copyleft-lib@2.0.0 [GPL-3.0-only]', '  both@1.0.0 [MIT AND GPL-3.0]', '  @scope/cli@1.0.0,1.1.0 [FSL-1.1]']);
    expect(isAllowed('(Apache-2.0 OR MIT)', new Set(policy.dependencies.allowed))).toBe(true);
  });

  it('keeps the M00 policy: same allowlist and the same reviewed exceptions', () => {
    expect(policy.dependencies.allowed).toEqual(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'BlueOak-1.0.0', 'Unlicense', 'CC0-1.0', 'Python-2.0', 'Zlib']);
    expect(Object.keys(policy.dependencies.exceptions).sort()).toEqual(['caniuse-lite', 'lightningcss', 'lightningcss-darwin-arm64', 'lightningcss-darwin-x64', 'lightningcss-linux-x64-gnu', 'lightningcss-linux-x64-musl']);
    expect(readFileSync(join(root, 'tooling/scripts/check-licences.mjs'), 'utf8')).toContain('../legal/scripts/licences.mjs');
  });

  it('generates a CycloneDX SBOM of third-party components with licences and purls', () => {
    const sbom = buildSbom(pnpmJson, { timestamp: '2026-09-23T00:00:00.000Z', serial: 'urn:uuid:test' });
    expect(sbom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: 'urn:uuid:test' });
    expect(sbom.components.map((c) => c.purl)).toEqual([
      'pkg:npm/%40scope/cli@1.0.0', 'pkg:npm/%40scope/cli@1.1.0', 'pkg:npm/both@1.0.0', 'pkg:npm/copyleft-lib@2.0.0', 'pkg:npm/dual@1.0.0', 'pkg:npm/left-pad@1.3.0', 'pkg:npm/lightningcss@1.33.0',
    ]);
    expect(sbom.components.find((c) => c.name === 'dual')!.licenses).toEqual([{ expression: '(MIT OR GPL-3.0)' }]);
    expect(sbom.components.find((c) => c.name === 'left-pad')!).toMatchObject({ licenses: [{ license: { id: 'MIT' } }], externalReferences: [{ type: 'website', url: 'https://example.test' }] });
  });

  it('validates the asset/dataset licence register of the repository', () => {
    const md = readFileSync(join(root, ASSET_REGISTER), 'utf8');
    expect(checkAssetRegister(md, [], () => true, policy)).toEqual({ problems: [], entries: 4 });
  });

  it('fails on unregistered files, share-alike or unknown licences, missing evidence and missing paths', () => {
    const md = readFileSync(join(root, ASSET_REGISTER), 'utf8').concat(
      '\n',
      [
        '| ID | Asset | Kind | Path | Licence | Commercial use | Evidence | Status |',
        '|---|---|---|---|---|---|---|---|',
        '| AST-900 | Food data | dataset | packages/legal/datasets/food.csv | ODbL-1.0 | yes | https://example.test | in_use |',
        '| AST-901 | Hero image | image | apps/coach-web/public/hero.png | CC-BY-4.0 | no | — | in_use |',
        '| AST-902 | Beep | sound | apps/mobile/assets/beep.mp3 | CC0-1.0 | yes | https://example.test | shipping |',
      ].join('\n'),
    );
    const own = tableRows(md.slice(md.lastIndexOf('| ID | Asset')), ['ID', 'Asset'])!;
    expect(own).toHaveLength(3);
    const r = checkAssetRegister(md.slice(md.lastIndexOf('| ID | Asset')), ['apps/mobile/assets/unknown.png', 'apps/coach-web/public/hero.png'], (p) => p !== 'apps/coach-web/public/hero.png', policy);
    expect(r.problems).toEqual([
      'AST-900: licence "ODbL-1.0" is not allowed for commercial use (allowed: CC0-1.0, CC-BY-4.0, OFL-1.1, MIT, Apache-2.0, BSD-3-Clause, Owned)',
      'AST-901: no licence evidence',
      'AST-901: commercial use not confirmed',
      'AST-901: path apps/coach-web/public/hero.png does not exist',
      'AST-902: status "shipping" (expected one of in_use, planned, not_in_use)',
      'apps/mobile/assets/unknown.png: asset without a licence record in docs/legal/asset-licence-register.md',
    ]);
    expect(checkAssetRegister(undefined, [], () => true, policy).problems).toEqual([`${ASSET_REGISTER}: missing`]);
    expect(checkAssetRegister('no table', [], () => true, policy).problems[0]).toMatch(/no table/);
  });
});

function realLegalDocs(): Record<string, string | undefined> {
  const docs: Record<string, string | undefined> = {};
  for (const p of [...REQUIRED_DOCUMENTS.map((d) => `${LEGAL_DIR}/${d}`), ...Object.keys(draftFiles())]) docs[p] = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined;
  return docs;
}

describe('pnpm legal:docs (goal condition 6)', () => {
  it('docs/legal passes every check and every generated part is in sync', () => {
    expect(checkLegalDocs(realLegalDocs())).toEqual([]);
  });

  it('every counsel sign-off entry is pending and every Gate 0 item is open', () => {
    const docs = realLegalDocs();
    const tracker = tableRows(docs[`${LEGAL_DIR}/counsel-signoff-tracker.md`]!, ['Text', 'Status'])!;
    expect(tracker.length).toBeGreaterThan(60);
    expect(new Set(tracker.map((r) => [r.Status, r.Reviewer, r['Approval record'], r.Date].join('|')))).toEqual(new Set(['pending|—|—|—']));
    const founder = tableRows(docs[`${LEGAL_DIR}/founder-checklist.md`]!, ['Item', 'Status'])!;
    expect(founder.map((r) => r.Status)).toEqual(Array(8).fill('open'));
  });

  it('flags a closed Gate 0 item, a hand-edited approval, a missing marker, an approval claim and stale drafts', () => {
    const docs = realLegalDocs();
    const f = `${LEGAL_DIR}/founder-checklist.md`;
    const t = `${LEGAL_DIR}/counsel-signoff-tracker.md`;
    const edited = {
      ...docs,
      [f]: docs[f]!.replace('| Before beta | Founder with corporate counsel | open |', '| Before beta | Founder with corporate counsel | done |'),
      [t]: docs[t]!.replace('| `terms` | 1 | EU_FR | pending | — | — | — |', '| `terms` | 1 | EU_FR | approved | — | — | — |'),
      [`${LEGAL_DIR}/risk-register.md`]: 'no marker',
      [`${LEGAL_DIR}/incident-procedure.md`]: `${docs[`${LEGAL_DIR}/incident-procedure.md`]}\nThis procedure is counsel-approved.`,
      [`${LEGAL_DIR}/drafts/terms.md`]: `${docs[`${LEGAL_DIR}/drafts/terms.md`]}\nextra`,
      [`${LEGAL_DIR}/trademark-register.md`]: undefined,
    };
    expect(checkLegalDocs(edited)).toEqual([
      'docs/legal/risk-register.md: not marked "requires counsel review"',
      'docs/legal/trademark-register.md: missing',
      'docs/legal/incident-procedure.md: claims counsel approval (L5 forbids it)',
      'docs/legal/drafts/terms.md: out of date (run pnpm legal:docs --write)',
      'founder-checklist.md: "Company structure" has status "done"; only a human with evidence may close a Gate 0 item, and this file starts every item as "open"',
      'counsel-signoff-tracker.md: out of date with packages/legal approvals (run pnpm legal:docs --write)',
      ...[
        'Personal injury / negligence', 'Medical-device regulation', 'Regulated professions', 'Data protection', 'AI regulation and AI harm', 'Consumer and subscription law', 'Misleading advertising', 'Copyright and licences',
        'Trademark conflict', 'Third-party coaches', 'User-generated content', 'Minors', 'Accessibility', 'Store policies', 'Founder personal exposure', 'Tax',
      ].map((d) => `risk-register.md: domain "${d}" missing`),
    ]);
  });

  it('flags a missing Gate 0 item, a codename recorded as cleared, missing incident steps and missing drafts in the list', () => {
    const docs = realLegalDocs();
    const f = `${LEGAL_DIR}/founder-checklist.md`;
    const problems = checkLegalDocs({
      ...docs,
      [f]: docs[f]!.split('\n').filter((l) => !l.startsWith('| Insurance |')).join('\n'),
      [`${LEGAL_DIR}/trademark-register.md`]: docs[`${LEGAL_DIR}/trademark-register.md`]!.replace('Codename only; not for public use; no search made', 'cleared'),
      [`${LEGAL_DIR}/incident-procedure.md`]: 'requires counsel review\n## 1. Injury report intake',
      [`${LEGAL_DIR}/document-list.md`]: docs[`${LEGAL_DIR}/document-list.md`]!.replace('[drafts/terms.md](drafts/terms.md)', 'none').replace('Draft v1 — requires counsel review |\n| Privacy', 'Final |\n| Privacy'),
      [`${LEGAL_DIR}/jurisdiction-matrix.md`]: 'requires counsel review, markers removed',
    });
    expect(problems).toEqual([
      'founder-checklist.md: Gate 0 item "Insurance" missing',
      'jurisdiction-matrix.md: generated block markers missing',
      'document-list.md: no row linking drafts/terms.md',
      'document-list.md: "Terms of Use" has no draft link',
      'document-list.md: "Terms of Use" status must say "requires counsel review"',
      'trademark-register.md: the codename must be recorded as a codename, not cleared',
      ...['Escalation', 'Legal hold', 'Regulator notification', 'Insurer notification', 'Complaint'].map((s) => `incident-procedure.md: no section for "${s}"`),
    ]);
  });

  it('flags an unknown tracker status, a draft link to a missing file and a missing codename row', () => {
    const docs = realLegalDocs();
    const t = `${LEGAL_DIR}/counsel-signoff-tracker.md`;
    const l = `${LEGAL_DIR}/document-list.md`;
    const problems = checkLegalDocs({
      ...docs,
      [t]: docs[t]!.replace('| `privacy` | 1 | GB | pending |', '| `privacy` | 1 | GB | reviewed |'),
      [l]: docs[l]!.replace('[drafts/coach-agreement.md](drafts/coach-agreement.md)', '[drafts/missing.md](drafts/missing.md)'),
      [`${LEGAL_DIR}/trademark-register.md`]: 'requires counsel review\n| Mark | Role | Classes | Markets | Status |\n|---|---|---|---|---|\n| Other | brand | 9 | EU | open |',
    });
    expect(problems).toContain('counsel-signoff-tracker.md: out of date with packages/legal approvals (run pnpm legal:docs --write)');
    expect(problems).toContain('counsel-signoff-tracker.md: `privacy` GB has unknown status "reviewed"'.replace(/`/g, ''));
    expect(problems).toContain('document-list.md: "Coach Agreement + data-processing terms" links a missing draft drafts/missing.md');
    expect(problems).toContain('trademark-register.md: the codename row is missing');
    expect(checkLegalDocs({ ...docs, [`${LEGAL_DIR}/founder-checklist.md`]: 'requires counsel review' })).toContain('founder-checklist.md: no table with Item, Action, Status');
    expect(checkLegalDocs({ ...docs, [t]: 'requires counsel review' })).toContain('counsel-signoff-tracker.md: generated block markers missing');
  });

  it('regenerates blocks and parses tables', () => {
    expect(replaceBlock(`a\n${TRACKER_START}\nold\n${TRACKER_END}\nb`, TRACKER_START, TRACKER_END, 'new')).toBe(`a\n${TRACKER_START}\nnew\n${TRACKER_END}\nb`);
    expect(replaceBlock('no markers', TRACKER_START, TRACKER_END, 'x')).toBeNull();
    expect(trackerTable().split('\n')[0]).toContain('| Text | Version | Jurisdiction variant | Status |');
    expect(markdownTables('| a |\n|---|\n| 1 |')).toEqual([{ header: ['a'], rows: [['1']] }]);
    expect(tableRows('nothing', ['a'])).toBeNull();
  });
});
