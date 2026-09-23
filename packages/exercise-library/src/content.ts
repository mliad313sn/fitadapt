import { canonicalJson, parsePayload, sha256Hex, type DefensibilityPayload } from '@fitadapt/legal';
import { ContentApprovalSchema, ContentVersionSchema, type ContentApproval, type ContentVersion, type Exercise, type ExerciseEdge, type MediaAsset } from '@fitadapt/shared';

/**
 * Content workflow (M06 → admin CMS in M18): versioned content with
 * two-person approval, one physiotherapist (seat A2) and one strength &
 * conditioning coach (seat A3), by two different reviewers, each with a
 * council sign-off record. Engineering never approves content: approvals are
 * data entered from a sign-off record (docs/governance/03 §5).
 * Each approval yields a `content.approved` defensibility event (L11).
 */

export const APPROVAL_SEATS: Readonly<Record<ContentApproval['role'], string>> = Object.freeze({ physio: 'A2', coach: 'A3' });

export type ContentEntity = { entityType: 'exercise'; value: Exercise } | { entityType: 'edge'; value: ExerciseEdge } | { entityType: 'media'; value: MediaAsset };

export function contentId(entity: ContentEntity): string {
  const v = entity.value;
  if (entity.entityType === 'edge') {
    const e = v as ExerciseEdge;
    return `edge.${e.type.toLowerCase()}.${e.from}.${e.to}`.slice(0, 80);
  }
  return `${entity.entityType}.${(v as Exercise | MediaAsset).id}`;
}

export function createContentVersion(entity: ContentEntity, version: number, createdAt: string): ContentVersion {
  return ContentVersionSchema.parse({
    contentId: contentId(entity),
    entityType: entity.entityType,
    version,
    contentHash: sha256Hex(canonicalJson(entity.value)),
    createdAt,
    status: 'draft',
    approvals: [],
  });
}

export function submitForReview(version: ContentVersion): ContentVersion {
  if (version.status !== 'draft') throw new Error(`${version.contentId} v${version.version}: only a draft can be submitted (status ${version.status})`);
  return { ...version, status: 'in_review' };
}

/** Records one reviewer's approval. The seat must match the role; one reviewer cannot approve twice. */
export function approveContent(version: ContentVersion, approval: ContentApproval): ContentVersion {
  const a = ContentApprovalSchema.parse(approval);
  if (version.status !== 'in_review') throw new Error(`${version.contentId} v${version.version}: not in review`);
  if (APPROVAL_SEATS[a.role] !== a.seat) throw new Error(`${a.role} approval must come from seat ${APPROVAL_SEATS[a.role]}, not ${a.seat}`);
  if (version.approvals.some((x) => x.role === a.role)) throw new Error(`${version.contentId} v${version.version}: already approved by a ${a.role}`);
  if (version.approvals.some((x) => x.reviewerRef === a.reviewerRef)) throw new Error('two-person approval: the same reviewer cannot approve in two roles');
  const approvals = [...version.approvals, a];
  const complete = approvals.some((x) => x.role === 'physio') && approvals.some((x) => x.role === 'coach');
  return { ...version, approvals, status: complete ? 'approved' : 'in_review' };
}

/** Publishing requires the physio review and the coach review (two different people). */
export function publishContent(version: ContentVersion): ContentVersion {
  const physio = version.approvals.find((a) => a.role === 'physio');
  const coach = version.approvals.find((a) => a.role === 'coach');
  if (version.status !== 'approved' || !physio || !coach || physio.reviewerRef === coach.reviewerRef) {
    throw new Error(`${version.contentId} v${version.version}: cannot be published without the physio review (A2) and the coach review (A3)`);
  }
  return { ...version, status: 'published' };
}

/** Defensibility payloads (`content.approved`, packages/legal) for each approval of a version. */
export function contentApprovalEvents(version: ContentVersion): DefensibilityPayload<'content.approved'>[] {
  return version.approvals.map((a) => parsePayload('content.approved', { contentId: version.contentId, contentVersion: version.version, reviewerSeat: a.seat, signOffRecord: a.signOff }));
}
