import { describe, expect, it } from 'vitest';
import { ExecutionLogSchema, PREGNANCY_WARNING_SIGNS, RED_FLAG_SYMPTOMS, URGENT_MSK_SIGNS } from '@fitadapt/shared';
import { chainEvent, DefensibilityPayloads, JURISDICTION_MATRIX, notice, renderNotice, stopNoticeFor, verifyChain, type DefensibilityEvent } from './index.js';

/** M05: the red-flag stop reads emergency guidance from the per-jurisdiction config, and its events go to the defensibility log. */
describe('M05 red-flag guidance per jurisdiction (goal condition 7)', () => {
  it('shows the configured number only for FR (112), GB (999) and US (911); every other market gets generic guidance, never an invented number', () => {
    const seek = notice('seek_care');
    expect(seek).toMatchObject({ trigger: 'safety.red_flag', frequency: 'every_time', emergencyGuidance: true, requiresAcknowledgement: true });
    // FIX-B (CS-2, CS-6): unconditional; France adds 15 (SAMU) before 112.
    expect(renderNotice(seek, 'en', 'FR').emergency).toBe('Emergency number: call 15 (medical emergencies) or 112.');
    expect(renderNotice(seek, 'en', 'GB').emergency).toBe('Emergency number: call 999.');
    expect(renderNotice(seek, 'en', 'US').emergency).toBe('Emergency number: call 911.');
    // Senegal and Côte d'Ivoire: unconfirmed SAMU numbers (validated:false), always with the generic guidance.
    expect(renderNotice(seek, 'en', 'SN').emergency).toBe('Emergency number: call 1515 or 15 (medical emergencies). If you cannot get through, call your local emergency number.');
    expect(renderNotice(seek, 'en', 'CI').emergency).toBe('Emergency number: call 185 (medical emergencies). If you cannot get through, call your local emergency number.');
    for (const j of ['ZZ', 'DE']) expect(renderNotice(seek, 'en', j).emergency).toBe('Emergency number: call your local emergency number.');
    const numbers = Object.fromEntries(Object.entries(JURISDICTION_MATRIX).map(([k, p]) => [k, p.emergency.number]));
    expect(numbers).toEqual({ FR: '112', GB: '999', US: '911', SN: null, CI: null, ZZ: null });
    // Every medical number is unvalidated and cites its pre-review; none is marked confirmed.
    const medical = Object.fromEntries(Object.entries(JURISDICTION_MATRIX).flatMap(([k, p]) => (p.emergency.medical ? [[k, p.emergency.medical.numbers]] : [])));
    expect(medical).toEqual({ FR: ['15'], SN: ['1515', '15'], CI: ['185'] });
    for (const p of Object.values(JURISDICTION_MATRIX)) if (p.emergency.medical) expect(p.emergency.medical).toMatchObject({ validated: false, source: expect.stringContaining('ai-reviews/A1-A2-clinical-safety.md') });
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

describe('FIX-B: seek-care copy says when to call now (CS-2), and each stop sign has its guidance (CS-3, CS-4, CS-5)', () => {
  it('the seek-care body names the emergency triggers and "do not drive yourself", in EN and FR, without naming a condition', () => {
    const en = renderNotice(notice('seek_care'), 'en', 'GB').body;
    for (const phrase of ['does not ease within a few minutes of rest', 'arm, jaw, neck or back', 'face droops', 'speech is slurred', 'sudden severe headache', 'change in your vision', 'fainted', 'Do not drive yourself']) expect(en).toContain(phrase);
    const fr = renderNotice(notice('seek_care'), 'fr', 'FR').body;
    for (const phrase of ['ne passe pas après quelques minutes de repos', 'bras, à la mâchoire, au cou ou au dos', 'visage s’affaisse', 'mal à parler', 'mal de tête soudain et intense', 'trouble soudain de la vue', 'perdu connaissance', 'Ne conduisez pas vous-même']) expect(fr).toContain(phrase);
    for (const text of [en, fr]) expect(text).not.toMatch(/heart attack|stroke|infarctus|AVC|diagnos/i);
  });

  it('routes every stop sign to its notice: general → seek care, pregnancy → midwife or doctor now, joint or back → urgent care; all show the emergency line', () => {
    for (const s of RED_FLAG_SYMPTOMS) expect(stopNoticeFor(s).id).toBe('seek_care');
    for (const s of PREGNANCY_WARNING_SIGNS) expect(stopNoticeFor(s).id).toBe('pregnancy_warning');
    for (const s of URGENT_MSK_SIGNS) expect(stopNoticeFor(s).id).toBe('urgent_care');
    for (const id of ['pregnancy_warning', 'urgent_care'] as const) {
      expect(notice(id)).toMatchObject({ frequency: 'every_time', requiresAcknowledgement: true, emergencyGuidance: true });
      expect(notice(id).approvals.every((a) => a.status === 'pending')).toBe(true);
      for (const locale of ['en', 'fr'] as const) expect(renderNotice(notice(id), locale, 'FR').emergency).toContain('15');
    }
    expect(renderNotice(notice('pregnancy_warning'), 'en', 'GB').body).toContain('midwife');
    expect(renderNotice(notice('urgent_care'), 'en', 'GB').body).toContain('urgent care');
  });

  it('the S3 list includes the stroke signs, a sudden severe headache and a sudden vision change, and every stop sign is a valid red-flag log', () => {
    expect(RED_FLAG_SYMPTOMS).toEqual(expect.arrayContaining(['face_drooping_speech', 'sudden_severe_headache', 'sudden_vision_change']));
    for (const s of [...RED_FLAG_SYMPTOMS, ...PREGNANCY_WARNING_SIGNS, ...URGENT_MSK_SIGNS]) {
      expect(ExecutionLogSchema.safeParse({ kind: 'red_flag', planId: null, symptom: s, at: '2026-10-01T08:00:00.000Z' }).success).toBe(true);
    }
  });
});
