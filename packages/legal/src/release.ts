import { DEFAULT_REGISTRY, type CounselApproval, type LegalDocumentId, type LegalRegistry } from './documents.js';
import { DOCUMENT_VARIANTS, type DocumentVariant } from './jurisdictions.js';
import { NOTICES, type NoticeDefinition, type NoticeId } from './notices.js';

/**
 * Release guard (M20 rule: "unapproved texts cannot be enabled in production
 * builds"). Every enabled document version and notice needs a counsel
 * approval, with its record, for every enabled jurisdiction variant.
 * Development and preview builds show drafts with the draft banner.
 */
export type BuildProfile = 'dev' | 'preview' | 'production';

export interface LegalReleaseConfig {
  readonly variants: readonly DocumentVariant[];
  readonly documents: readonly LegalDocumentId[];
  readonly notices: readonly NoticeId[];
}

/** What a production build enables today: every text in every jurisdiction variant. */
export const DEFAULT_RELEASE: LegalReleaseConfig = Object.freeze({
  variants: DOCUMENT_VARIANTS,
  documents: DEFAULT_REGISTRY.documents.map((d) => d.id),
  notices: NOTICES.map((n) => n.id),
});

export function isApproved(approvals: readonly CounselApproval[], variant: DocumentVariant): boolean {
  const a = approvals.find((x) => x.variant === variant);
  return a?.status === 'approved' && a.approvedBy.trim() !== '' && a.approvalRecord.trim() !== '' && a.approvedOn.trim() !== '';
}

export interface UnapprovedText {
  readonly text: string;
  readonly variant: DocumentVariant;
}

export function unapprovedTexts(
  release: LegalReleaseConfig = DEFAULT_RELEASE,
  registry: LegalRegistry = DEFAULT_REGISTRY,
  notices: readonly NoticeDefinition[] = NOTICES,
): UnapprovedText[] {
  const out: UnapprovedText[] = [];
  for (const id of release.documents) {
    const doc = registry.get(id);
    if (!doc) throw new Error(`release enables unknown document ${id}`);
    for (const v of doc.versions) {
      for (const variant of release.variants) if (!isApproved(v.approvals, variant)) out.push({ text: `${id} v${v.version}`, variant });
    }
  }
  for (const id of release.notices) {
    const n = notices.find((x) => x.id === id);
    if (!n) throw new Error(`release enables unknown notice ${id}`);
    for (const variant of release.variants) if (!isApproved(n.approvals, variant)) out.push({ text: `notice ${id} v${n.version}`, variant });
  }
  return out;
}

export class LegalReleaseError extends Error {
  constructor(readonly unapproved: readonly UnapprovedText[]) {
    super(
      `Production build refused: ${unapproved.length} enabled legal text(s) lack counsel approval (L5), e.g. ${unapproved
        .slice(0, 3)
        .map((u) => `${u.text} [${u.variant}]`)
        .join(', ')}. See docs/legal/counsel-signoff-tracker.md.`,
    );
    this.name = 'LegalReleaseError';
  }
}

/** Throws for a production build while any enabled text lacks counsel approval. */
export function assertLegalReleaseReady(
  profile: BuildProfile,
  release: LegalReleaseConfig = DEFAULT_RELEASE,
  registry: LegalRegistry = DEFAULT_REGISTRY,
  notices: readonly NoticeDefinition[] = NOTICES,
): void {
  if (profile !== 'production') return;
  const unapproved = unapprovedTexts(release, registry, notices);
  if (unapproved.length) throw new LegalReleaseError(unapproved);
}

/**
 * Maps build environment variables (eas.json sets APP_VARIANT per profile;
 * EAS sets EAS_BUILD_PROFILE) to a profile. No variable = local development.
 * Any other value is treated as production (fails closed).
 */
export function buildProfileFrom(env: Record<string, string | undefined>): BuildProfile {
  const v = (env.APP_VARIANT || env.EAS_BUILD_PROFILE || 'dev').toLowerCase();
  if (v === 'dev' || v === 'development') return 'dev';
  if (v === 'preview') return 'preview';
  return 'production';
}
