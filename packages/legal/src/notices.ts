import { createTranslator, type MessageKey } from '@fitadapt/i18n';
import type { Locale } from '@fitadapt/shared';
import type { CounselApproval } from './documents.js';
import { DOCUMENT_VARIANTS, JURISDICTION_MATRIX, jurisdictionProfile } from './jurisdictions.js';
import { sha256Hex } from './sha256.js';

/**
 * Point-of-risk notice registry (L3, L5). Notices are shown where the risk is,
 * not buried in the terms. Wording: packages/i18n `legal.notice.*` (drafts,
 * require counsel review).
 */
export const NOTICE_IDS = ['first_workout', 'first_hiit', 'assessment', 'nutrition_deficit', 'ai_coach', 'camera_mode', 'seek_care', 'pair_challenge'] as const;
export type NoticeId = (typeof NOTICE_IDS)[number];

export const NOTICE_TRIGGERS = [
  'workout.start',
  'hiit.start',
  'assessment.start',
  'nutrition.deficit_setup',
  'ai_coach.conversation_start',
  'camera.start',
  'safety.red_flag',
  /** M09: a Fair Challenge between partners is a point of risk (legal risk register: injury during a partner challenge). */
  'pair.challenge.start',
] as const;
export type NoticeTrigger = (typeof NOTICE_TRIGGERS)[number];

/**
 * - once_per_version: until acknowledged for the current version (re-shown when the notice changes);
 * - every_time: at every trigger (AI disclosure at the start of every conversation, L5; every assessment; S3 seek-care).
 */
export type NoticeFrequency = 'once_per_version' | 'every_time';

export interface NoticeDefinition {
  readonly id: NoticeId;
  readonly trigger: NoticeTrigger;
  readonly frequency: NoticeFrequency;
  readonly version: number;
  readonly title: MessageKey;
  readonly body: MessageKey;
  /** The user must tap "I understand" before continuing. */
  readonly requiresAcknowledgement: boolean;
  /** Adds the jurisdiction's emergency guidance under the body. */
  readonly emergencyGuidance: boolean;
  readonly approvals: readonly CounselApproval[];
}

const pending = (): readonly CounselApproval[] => DOCUMENT_VARIANTS.map((variant) => ({ variant, status: 'pending' as const }));

export const NOTICES: readonly NoticeDefinition[] = Object.freeze([
  { id: 'first_workout', trigger: 'workout.start', frequency: 'once_per_version', version: 1, title: 'legal.notice.firstWorkout.v1.title', body: 'legal.notice.firstWorkout.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
  { id: 'first_hiit', trigger: 'hiit.start', frequency: 'once_per_version', version: 1, title: 'legal.notice.firstHiit.v1.title', body: 'legal.notice.firstHiit.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
  { id: 'assessment', trigger: 'assessment.start', frequency: 'every_time', version: 1, title: 'legal.notice.assessment.v1.title', body: 'legal.notice.assessment.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
  { id: 'nutrition_deficit', trigger: 'nutrition.deficit_setup', frequency: 'once_per_version', version: 1, title: 'legal.notice.nutritionDeficit.v1.title', body: 'legal.notice.nutritionDeficit.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
  { id: 'ai_coach', trigger: 'ai_coach.conversation_start', frequency: 'every_time', version: 1, title: 'legal.notice.aiCoach.v1.title', body: 'legal.notice.aiCoach.v1.body', requiresAcknowledgement: false, emergencyGuidance: false, approvals: pending() },
  { id: 'camera_mode', trigger: 'camera.start', frequency: 'once_per_version', version: 1, title: 'legal.notice.camera.v1.title', body: 'legal.notice.camera.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
  { id: 'seek_care', trigger: 'safety.red_flag', frequency: 'every_time', version: 1, title: 'legal.notice.seekCare.v1.title', body: 'legal.notice.seekCare.v1.body', requiresAcknowledgement: true, emergencyGuidance: true, approvals: pending() },
  // M09: shown to each participant (in their own ledger) before a Fair Challenge; once per version until acknowledged.
  { id: 'pair_challenge', trigger: 'pair.challenge.start', frequency: 'once_per_version', version: 1, title: 'legal.notice.pairChallenge.v1.title', body: 'legal.notice.pairChallenge.v1.body', requiresAcknowledgement: true, emergencyGuidance: false, approvals: pending() },
] satisfies NoticeDefinition[]);

/** L5: persistent label shown on every AI coach screen, in addition to the conversation-start notice. */
export const AI_PERSISTENT_LABEL: MessageKey = 'legal.notice.aiCoach.label';

export interface NoticeImpression {
  readonly noticeId: NoticeId;
  readonly version: number;
  readonly kind: 'shown' | 'acknowledged';
  readonly locale: Locale;
  readonly jurisdiction: string;
  readonly occurredAt: string;
}

export function notice(id: NoticeId): NoticeDefinition {
  return NOTICES.find((n) => n.id === id)!;
}

/**
 * Notices to show now for a trigger. Fails safe: a notice whose
 * acknowledgement was never recorded is shown again.
 */
export function noticesToShow(trigger: NoticeTrigger, impressions: readonly NoticeImpression[], notices: readonly NoticeDefinition[] = NOTICES): NoticeDefinition[] {
  return notices.filter((n) => {
    if (n.trigger !== trigger) return false;
    if (n.frequency === 'every_time') return true;
    const doneKind = n.requiresAcknowledgement ? 'acknowledged' : 'shown';
    return !impressions.some((i) => i.noticeId === n.id && i.version === n.version && i.kind === doneKind);
  });
}

export interface RenderedNotice {
  readonly noticeId: NoticeId;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly emergency: string | null;
  readonly draftBanner: string;
  readonly contentHash: string;
}

export function renderNotice(n: NoticeDefinition, locale: Locale, jurisdiction: string, matrix = JURISDICTION_MATRIX): RenderedNotice {
  const t = createTranslator(locale);
  const number = jurisdictionProfile(jurisdiction, matrix).emergency.number;
  const emergency = n.emergencyGuidance ? (number ? t.t('legal.emergency.withNumber', { number }) : t.t('legal.emergency.generic')) : null;
  const title = t.t(n.title);
  const body = t.t(n.body);
  const draftBanner = t.t('legal.draft.banner');
  const contentHash = sha256Hex([draftBanner, title, body, emergency ?? ''].join('\n\n'));
  return { noticeId: n.id, version: n.version, title, body, emergency, draftBanner, contentHash };
}
