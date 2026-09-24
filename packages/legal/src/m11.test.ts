import { describe, expect, it } from 'vitest';
import { AI_PERSISTENT_LABEL, DefensibilityPayloads, NOTICES, buildLegalHoldExport, chainEvent, noticesToShow, verifyChain } from './index.js';

describe('M11 defensibility events and the AI disclosure', () => {
  const call = { tool: 'adjustSessionTime', status: 'proposed', reasonCode: 'coach.time.proposed', engineVersion: '0.4.0' };

  it('a coach tool call is logged by tool, outcome, reason and engine version; never its input or any text', () => {
    expect(DefensibilityPayloads['coach.tool_call'].safeParse(call).success).toBe(true);
    expect(DefensibilityPayloads['coach.tool_call'].safeParse({ ...call, tool: 'unknown', status: 'invalid' }).success).toBe(true);
    for (const extra of [{ input: { minutes: 30 } }, { text: 'my knee hurts' }, { joint: 'knee' }, { score: 7 }]) expect(DefensibilityPayloads['coach.tool_call'].safeParse({ ...call, ...extra }).success).toBe(false);
    expect(DefensibilityPayloads['coach.tool_call'].safeParse({ ...call, tool: 'setLoad' }).success).toBe(false);
  });

  it('a blocked model reply is an S6 safety event', () => {
    expect(DefensibilityPayloads['safety.event'].safeParse({ invariant: 'S6', reasonCode: 'coach.guard.impersonation', action: 'blocked', engineVersion: '0.4.0' }).success).toBe(true);
  });

  it('the legal-hold export has a coach section and counts its engine version', () => {
    const e1 = chainEvent(undefined, { type: 'coach.tool_call', chain: 'subject', occurredAt: '2026-09-28T07:00:00.000Z', payload: call as never }, 'e1');
    expect(verifyChain([e1]).ok).toBe(true);
    const exported = buildLegalHoldExport('subject', [e1], '2026-09-28T08:00:00.000Z');
    expect(exported.coachToolCalls).toEqual([e1]);
    expect(exported.engineVersions).toEqual([{ engineVersion: '0.4.0', firstSeen: e1.occurredAt, lastSeen: e1.occurredAt, events: 1 }]);
  });

  it('L5: the AI notice is shown at the start of every conversation (not once), with a persistent label', () => {
    const shown = [{ noticeId: 'ai_coach', version: 1, kind: 'shown' as const, locale: 'en' as const, jurisdiction: 'GB', occurredAt: '2026-09-28T07:00:00.000Z' }];
    expect(noticesToShow('ai_coach.conversation_start', shown, NOTICES).map((n) => n.id)).toEqual(['ai_coach']);
    expect(AI_PERSISTENT_LABEL).toBe('legal.notice.aiCoach.label');
  });
});
