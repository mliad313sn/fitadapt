import { readFileSync } from 'node:fs';
import { en, fr } from '@fitadapt/i18n';
import type { ContentApproval, MediaAsset } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import {
  approveContent,
  ASSET_LICENCE_ALLOWLIST,
  assertLibraryReleaseReady,
  contentApprovalEvents,
  contentId,
  createContentVersion,
  MediaPublishError,
  mediaPack,
  mediaPublishProblems,
  normaliseSearchText,
  publishContent,
  publishMediaAsset,
  searchExercises,
  seedLibrary,
  submitForReview,
  unreleasableExercises,
  EQUIPMENT_PRESETS,
} from './index.js';

const lib = seedLibrary();

// Fictional placeholder asset (no file exists; nothing is shipped).
const asset: MediaAsset = {
  id: 'push_up_diagram',
  exerciseId: 'push_up',
  kind: 'diagram',
  path: 'media/push_up_diagram.svg',
  bytes: 2048,
  lowBandwidth: true,
  packs: ['home_basic'],
  licence: 'Owned',
  source: 'Drawn for the company (fictional test fixture)',
  rightsHolder: 'The company (to be incorporated)',
  status: 'draft',
};

describe('L6: media assets', () => {
  it('publishing a MediaAsset without licence, source and rightsHolder fails', () => {
    const bare = { ...asset, licence: null, source: null, rightsHolder: null };
    expect(() => publishMediaAsset(bare)).toThrow(MediaPublishError);
    expect(mediaPublishProblems(bare)).toEqual(['licence_missing', 'source_missing', 'rights_holder_missing']);
    expect(() => publishMediaAsset({ ...asset, licence: null })).toThrow(/licence_missing/);
    expect(() => publishMediaAsset({ ...asset, source: null })).toThrow(/source_missing/);
    expect(() => publishMediaAsset({ ...asset, rightsHolder: null })).toThrow(/rights_holder_missing/);
    expect(() => publishMediaAsset({ ...asset, rightsHolder: '  ' })).toThrow(/rights_holder_missing/);
  });

  it('refuses licences outside the asset allowlist (share-alike, non-commercial)', () => {
    for (const licence of ['CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'ODbL-1.0', 'unknown']) {
      expect(mediaPublishProblems({ ...asset, licence })).toEqual(['licence_not_allowed']);
    }
    expect(mediaPublishProblems({ ...asset, bytes: -1 })).toContain('invalid_asset');
  });

  it('publishes a fully licensed asset', () => {
    const published = publishMediaAsset(asset);
    expect(published.status).toBe('published');
    expect(mediaPack([published, asset], 'home_basic', { lowBandwidth: true }).map((a) => a.id)).toEqual(['push_up_diagram']);
    expect(mediaPack([published], 'home_basic', { lowBandwidth: false })).toEqual([]);
    expect(mediaPack([published], 'full_gym', { lowBandwidth: true })).toEqual([]);
  });

  it('the allowlist equals the asset policy of `pnpm legal:licences`', () => {
    const policy = JSON.parse(readFileSync(new URL('../../../tooling/legal/licence-policy.json', import.meta.url), 'utf8')) as { assets: { allowed: string[] } };
    expect([...ASSET_LICENCE_ALLOWLIST].sort()).toEqual([...policy.assets.allowed].sort());
  });
});

const physio: ContentApproval = { role: 'physio', reviewerRef: 'reviewer-a2-1', seat: 'A2', signOff: 'docs/governance/sign-offs/2027-01-12-A2-library.md', approvedAt: '2027-01-12T10:00:00.000Z' };
const coach: ContentApproval = { role: 'coach', reviewerRef: 'reviewer-a3-1', seat: 'A3', signOff: 'docs/governance/sign-offs/2027-01-12-A3-library.md', approvedAt: '2027-01-12T11:00:00.000Z' };

describe('content workflow: versioning and two-person approval (fictional sign-offs)', () => {
  const exercise = lib.byId.get('push_up')!;
  const draft = createContentVersion({ entityType: 'exercise', value: exercise }, 1, '2026-09-23T10:00:00.000Z');

  it('versions content with a hash of the canonical entity', () => {
    expect(draft).toMatchObject({ contentId: 'exercise.push_up', entityType: 'exercise', version: 1, status: 'draft', approvals: [] });
    expect(draft.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const changed = createContentVersion({ entityType: 'exercise', value: { ...exercise, skill: 'intermediate' } }, 2, '2026-09-24T10:00:00.000Z');
    expect(changed.contentHash).not.toBe(draft.contentHash);
    const edge = lib.edges.find((e) => e.type === 'SUBSTITUTES')!;
    expect(contentId({ entityType: 'edge', value: edge })).toMatch(/^edge\.substitutes\./);
    expect(contentId({ entityType: 'media', value: asset })).toBe('media.push_up_diagram');
  });

  it('cannot be published without both the physio (A2) and the coach (A3) review', () => {
    expect(() => publishContent(draft)).toThrow(/physio review/);
    const inReview = submitForReview(draft);
    expect(() => submitForReview(inReview)).toThrow(/only a draft/);
    expect(() => approveContent(draft, physio)).toThrow(/not in review/);
    const onePerson = approveContent(inReview, physio);
    expect(onePerson.status).toBe('in_review');
    expect(() => publishContent(onePerson)).toThrow(/physio review/);
    expect(() => approveContent(onePerson, physio)).toThrow(/already approved/);
    expect(() => approveContent(onePerson, { ...coach, reviewerRef: physio.reviewerRef })).toThrow(/same reviewer/);
    expect(() => approveContent(inReview, { ...physio, seat: 'A3' })).toThrow(/seat A2/);
    const both = approveContent(onePerson, coach);
    expect(both.status).toBe('approved');
    expect(publishContent(both).status).toBe('published');
  });

  it('each approval becomes a content.approved defensibility event (L11)', () => {
    const approved = approveContent(approveContent(submitForReview(draft), physio), coach);
    expect(contentApprovalEvents(approved)).toEqual([
      { contentId: 'exercise.push_up', contentVersion: 1, reviewerSeat: 'A2', signOffRecord: physio.signOff },
      { contentId: 'exercise.push_up', contentVersion: 1, reviewerSeat: 'A3', signOffRecord: coach.signOff },
    ]);
  });
});

describe('release guard: no exercise is published without the physio-review flag', () => {
  it('refuses a production build while any exercise is unreviewed; dev builds keep drafts', () => {
    expect(unreleasableExercises(lib.exercises)).toHaveLength(lib.exercises.length);
    expect(() => assertLibraryReleaseReady({ production: true }, lib.exercises)).toThrow(/Production build refused: \d+ exercise\(s\) lack the physio review/);
    expect(() => assertLibraryReleaseReady({ production: false }, lib.exercises)).not.toThrow();
    const reviewed = {
      ...lib.byId.get('push_up')!,
      validated: true,
      validatedBy: 'A2',
      signOff: 'docs/governance/sign-offs/fictional.md',
      reviewStatus: 'approved' as const,
      review: { physio: { seat: 'A2', signOff: 'fictional-a2.md', reviewedAt: '2027-01-12T10:00:00.000Z' }, coach: { seat: 'A3', signOff: 'fictional-a3.md', reviewedAt: '2027-01-12T10:00:00.000Z' } },
    };
    expect(() => assertLibraryReleaseReady({ production: true }, [reviewed])).not.toThrow();
    expect(unreleasableExercises([{ ...reviewed, review: { ...reviewed.review, physio: null } }])).toEqual(['push_up']);
  });
});

describe('search and filters (in memory)', () => {
  const nameEn = (e: { nameKey: string }) => en[e.nameKey as keyof typeof en];
  const nameFr = (e: { nameKey: string }) => fr[e.nameKey as keyof typeof fr];

  it('normalises accents and punctuation', () => {
    expect(normaliseSearchText('  Pompe inclinée — HAUTE ')).toBe('pompe inclinee haute');
  });

  it('filters by text, pattern, muscle and equipment', () => {
    expect(searchExercises(lib.exercises, { text: 'push-up' }, nameEn).length).toBeGreaterThan(5);
    expect(searchExercises(lib.exercises, { text: 'pompe inclinee' }, nameFr).map((e) => e.id)).toEqual(['incline_push_up_low', 'incline_push_up_high'].sort((a, b) => nameFr(lib.byId.get(a)!).localeCompare(nameFr(lib.byId.get(b)!))));
    const pulls = searchExercises(lib.exercises, { pattern: 'vertical_pull' }, nameEn);
    expect(pulls.every((e) => e.pattern === 'vertical_pull')).toBe(true);
    const glutesPrimary = searchExercises(lib.exercises, { muscle: 'glutes', primaryMuscleOnly: true }, nameEn);
    expect(glutesPrimary.every((e) => e.primaryMuscles.includes('glutes'))).toBe(true);
    expect(searchExercises(lib.exercises, { muscle: 'glutes' }, nameEn).length).toBeGreaterThan(glutesPrimary.length);
    const bodyweight = searchExercises(lib.exercises, { equipment: [] }, nameEn);
    expect(bodyweight.every((e) => e.equipment.length === 0)).toBe(true);
    const home = searchExercises(lib.exercises, { equipment: EQUIPMENT_PRESETS.home_basic, pattern: 'vertical_pull' }, nameEn).map((e) => e.id);
    expect(home).toEqual(expect.arrayContaining(['band_assisted_pull_up', 'pull_up', 'dead_hang']));
    expect(home).not.toContain('lat_pulldown');
  });
});
