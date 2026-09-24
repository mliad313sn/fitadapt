import { describe, expect, it } from 'vitest';
import { chainEvent, DefensibilityPayloads, JURISDICTION_MATRIX, notice, renderNotice, verifyChain, type DefensibilityEvent } from './index.js';

/** M05: the red-flag stop reads emergency guidance from the per-jurisdiction config, and its events go to the defensibility log. */
describe('M05 red-flag guidance per jurisdiction (goal condition 7)', () => {
  it('shows the configured number only for FR (112), GB (999) and US (911); every other market gets generic guidance, never an invented number', () => {
    const seek = notice('seek_care');
    expect(seek).toMatchObject({ trigger: 'safety.red_flag', frequency: 'every_time', emergencyGuidance: true, requiresAcknowledgement: true });
    expect(renderNotice(seek, 'en', 'FR').emergency).toBe('If this is an emergency, call 112 now.');
    expect(renderNotice(seek, 'en', 'GB').emergency).toBe('If this is an emergency, call 999 now.');
    expect(renderNotice(seek, 'en', 'US').emergency).toBe('If this is an emergency, call 911 now.');
    for (const j of ['SN', 'CI', 'ZZ', 'DE']) expect(renderNotice(seek, 'en', j).emergency).toBe('If this is an emergency, call your local emergency number now.');
    const numbers = Object.fromEntries(Object.entries(JURISDICTION_MATRIX).map(([k, p]) => [k, p.emergency.number]));
    expect(numbers).toEqual({ FR: '112', GB: '999', US: '911', SN: null, CI: null, ZZ: null });
    // Two jurisdictions render two different, hash-distinct notices (what the person saw is provable).
    expect(renderNotice(seek, 'fr', 'FR').contentHash).not.toBe(renderNotice(seek, 'fr', 'GB').contentHash);
  });

  it('S2 joint flags, S3 stops and attestations are valid defensibility payloads and chain', () => {
    const events: DefensibilityEvent[] = [];
    const add = (type: 'safety.event' | 'safety.attested', payload: object) => events.push(chainEvent(events.at(-1), { chain: 'device', type, occurredAt: '2026-10-01T08:00:00.000Z', payload } as never, `00000000-0000-4000-8000-00000000000${events.length + 1}`));
    add('safety.event', { invariant: 'S2', reasonCode: 'safety.s2.joint_red.knee', action: 'joint_flagged', engineVersion: '0.3.0' });
    add('safety.event', { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_pressure', action: 'session_ended', engineVersion: '0.3.0' });
    add('safety.event', { invariant: 'S3', reasonCode: 'safety.s3.intensity_locked', action: 'intensity_locked', engineVersion: '0.3.0' });
    add('safety.attested', { invariant: 'S3', reasonCode: 'safety.s3.medical_review_attested', engineVersion: '0.3.0' });
    expect(verifyChain(events).ok).toBe(true);
    // No free text or health values in the payload.
    expect(DefensibilityPayloads['safety.event'].safeParse({ invariant: 'S2', reasonCode: 'safety.s2.joint_red.knee', action: 'joint_flagged', engineVersion: '0.3.0', score: 7 }).success).toBe(false);
  });
});
