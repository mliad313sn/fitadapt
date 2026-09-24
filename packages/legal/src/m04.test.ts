import { describe, expect, it } from 'vitest';
import { DefensibilityPayloads } from './index.js';

describe('M04 defensibility events', () => {
  it('a sustained-loss hand-off to the nutrition guardrails is an S4 safety event without any body value', () => {
    const event = { invariant: 'S4', reasonCode: 'progress.guardrail.sustained_loss', action: 'handed_off', engineVersion: '0.4.0' };
    expect(DefensibilityPayloads['safety.event'].safeParse(event).success).toBe(true);
    expect(DefensibilityPayloads['safety.event'].safeParse({ ...event, weightKg: 80 }).success).toBe(false);
    expect(DefensibilityPayloads['safety.event'].safeParse({ ...event, action: 'noticed' }).success).toBe(false);
  });
});
