import type { Exercise } from '@fitadapt/shared';

/**
 * "No exercise is published without a physio-review flag" (M06 Rules).
 * A production build refuses to ship any exercise that lacks the physio
 * review (seat A2) or the coach review (seat A3) or is still validated:false.
 * Today every seed exercise is pending, so production builds fail on purpose
 * (apps/mobile/app.config.js), as they do for unapproved legal texts (M20).
 */
export function unreleasableExercises(exercises: readonly Exercise[]): string[] {
  return exercises.filter((e) => e.review.physio === null || e.review.coach === null || !e.validated || e.reviewStatus !== 'approved').map((e) => e.id);
}

export function assertLibraryReleaseReady(profile: { production: boolean }, exercises: readonly Exercise[]): void {
  if (!profile.production) return;
  const blocked = unreleasableExercises(exercises);
  if (blocked.length > 0) {
    throw new Error(`Production build refused: ${blocked.length} exercise(s) lack the physio review (A2), the coach review (A3) or validation`);
  }
}
