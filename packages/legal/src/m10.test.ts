import { describe, expect, it } from 'vitest';
import { DefensibilityPayloads, NOTICES, buildLegalHoldExport, chainEvent, noticesToShow, verifyChain } from './index.js';

describe('M10 defensibility events and the nutrition-deficit notice', () => {
  const target = { targetId: '8f0c6c64-3a2b-4f5e-9d6a-1b2c3d4e5f60', engineVersion: '0.4.0', rulesVersion: '0.1.0', mode: 'numeric', reason: 'setup', deficitAllowed: true, reasonCodes: ['nutrition.goal.fat_loss', 'nutrition.energy.bmr_mifflin'] };

  it('a nutrition target is logged with versions, mode and reason codes, never a calorie, weight or intake value', () => {
    expect(DefensibilityPayloads['nutrition.target_set'].safeParse(target).success).toBe(true);
    for (const extra of [{ targetKcal: 2270 }, { weightKg: 120 }, { intakeKcal: 1800 }, { goalWeightKg: 90 }]) expect(DefensibilityPayloads['nutrition.target_set'].safeParse({ ...target, ...extra }).success).toBe(false);
    expect(DefensibilityPayloads['nutrition.target_set'].safeParse({ ...target, mode: 'strict' }).success).toBe(false);
  });

  it('the guardrail reduction is an S4 safety event (deficit_reduced)', () => {
    expect(DefensibilityPayloads['safety.event'].safeParse({ invariant: 'S4', reasonCode: 'safety.s4.sustained_loss_pause', action: 'deficit_reduced', engineVersion: '0.4.0' }).success).toBe(true);
  });

  it('the legal-hold export has a nutrition section and counts its engine version', () => {
    const e1 = chainEvent(undefined, { type: 'nutrition.target_set', chain: 'subject', occurredAt: '2026-09-24T08:00:00.000Z', payload: target as never }, 'e1');
    const e2 = chainEvent(e1, { type: 'safety.event', chain: 'subject', occurredAt: '2026-09-24T08:00:01.000Z', payload: { invariant: 'S4', reasonCode: 'safety.s4.bmr_floor', action: 'capped', engineVersion: '0.4.0' } }, 'e2');
    expect(verifyChain([e1, e2]).ok).toBe(true);
    const exported = buildLegalHoldExport('subject', [e1, e2], '2026-09-24T09:00:00.000Z');
    expect(exported.nutritionTargets).toEqual([e1]);
    expect(exported.engineVersions).toEqual([{ engineVersion: '0.4.0', firstSeen: e1.occurredAt, lastSeen: e2.occurredAt, events: 2 }]);
  });

  it('the nutrition deficit set-up is a point-of-risk notice that must be acknowledged, once per version (L3)', () => {
    const [notice] = noticesToShow('nutrition.deficit_setup', [], NOTICES);
    expect(notice).toMatchObject({ id: 'nutrition_deficit', requiresAcknowledgement: true, frequency: 'once_per_version' });
    expect(noticesToShow('nutrition.deficit_setup', [{ noticeId: 'nutrition_deficit', version: notice!.version, kind: 'acknowledged', locale: 'en', jurisdiction: 'GB', occurredAt: '2026-09-24T08:00:00.000Z' }], NOTICES)).toEqual([]);
  });
});
