import { EQUIPMENT_PRESETS } from '@fitadapt/exercise-library';
import { isAtLeastAsStrict, notScreenedSafetyProfile, REJECTED_SCREENING_REASON } from '@fitadapt/safety';
import { SCREENING_QUESTION_IDS, type ScreeningQuestionId, type ScreeningResponses } from '@fitadapt/shared';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { randomUUID } from 'node:crypto';
import { createConsentStore } from '../src/privacy/consents';
import { createProfileStore, unresolvedHealthRejections } from '../src/profile/profile-store';
import { selectRescreen, selectSafetyProfile } from '../src/profile/selectors';
import { MemoryKeyValueStore } from '../src/storage/app-state';

/**
 * Integration FIX-B × FIX-E: a screening (or assessment) the server rejects is
 * removed by sync; the device then treats the profile as `screeningRejected`
 * (at least as strict as "not screened" and as the older accepted screening),
 * asks for a re-screen, and clears it only when the user answers again.
 * Fictional user only.
 */
const NOW = new Date('2026-09-24T12:00:00.000Z');

function answers(yes: ScreeningQuestionId[] = []) {
  return Object.fromEntries(SCREENING_QUESTION_IDS.map((q) => [q, yes.includes(q) ? 'yes' : 'no'])) as ScreeningResponses['answers'];
}

function device(reject: (collection: string, data: unknown) => string | null) {
  const server = new SyncServer({ store: new MemoryServerStore(), validate: (_user, m) => reject(m.collection, m.data) });
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport: new InMemoryTransport(server, 'user-1'), newId: randomUUID, now: () => NOW });
  const kv = new MemoryKeyValueStore();
  const consents = createConsentStore({ kv, newId: randomUUID, jurisdiction: 'GB', now: () => NOW });
  const profile = createProfileStore({ sync: client, kv, now: () => NOW });
  consents.getState().decide('health', true, 'en');
  profile.getState().saveEquipment('home', [...EQUIPMENT_PRESETS.home_basic]);
  const screen = (yes: ScreeningQuestionId[]) => {
    profile.getState().updateDraft({ answers: answers(yes), birthDate: { year: 1988, month: 3, day: 14 } });
    profile.getState().saveScreening('annual', { year: 2026, month: 9, day: 24 });
  };
  const safety = () => selectSafetyProfile(profile.getState().screenings, consents.getState().records, profile.getState().screeningRejected);
  return { client, kv, profile, consents, screen, safety };
}

/** The server refuses any screening that answers "no" to chest_discomfort after the first one (a looser re-screen). */
const looserScreeningRejected = () => {
  let seen = 0;
  return (collection: string, data: unknown) => {
    if (collection !== 'screenings') return null;
    const yes = (data as { responses?: { answers?: Record<string, string> } }).responses?.answers?.chest_discomfort === 'yes';
    return seen++ > 0 && !yes ? 'screening.profile_mismatch' : null;
  };
};

describe('integration FIX-B × FIX-E: a server-rejected screening makes the device fail closed', () => {
  it('the rejected looser re-screen never lets the older accepted one count as it is; a re-screen is due; answering again clears it', async () => {
    const d = device(looserScreeningRejected());
    d.screen(['chest_discomfort']);
    await d.client.sync();
    const accepted = d.safety();
    expect(d.profile.getState().screeningRejected).toBe(false);

    d.screen([]);
    await d.client.sync();
    expect(d.client.rejectedMutations()).toMatchObject([{ collection: 'screenings', reason: 'screening.profile_mismatch' }]);
    d.profile.getState().reload();
    expect(d.profile.getState().screeningRejected).toBe(true);
    const p = d.safety();
    expect(p.reasonCodes).toContain(REJECTED_SCREENING_REASON);
    expect(isAtLeastAsStrict(p, accepted)).toBe(true);
    expect(isAtLeastAsStrict(p, notScreenedSafetyProfile(REJECTED_SCREENING_REASON))).toBe(true);
    expect(selectRescreen(d.profile.getState().screenings, null, NOW, d.profile.getState().screeningRejected)).toMatchObject({ status: 'due', reason: 'rejected' });

    // The user answers again (here with the flag): that answers the rejection; it survives a reload (kv).
    d.screen(['chest_discomfort']);
    expect(d.profile.getState().screeningRejected).toBe(false);
    expect(unresolvedHealthRejections(d.client, d.kv)).toEqual([]);
    const reopened = createProfileStore({ sync: d.client, kv: d.kv, now: () => NOW });
    expect(reopened.getState().screeningRejected).toBe(false);
    expect(d.safety().reasonCodes).not.toContain(REJECTED_SCREENING_REASON);
  });

  it('a rejected assessment also fails closed until a new assessment is saved; other collections do not', async () => {
    const d = device((collection) => (collection === 'assessments' || collection === 'readiness_checks' ? 'assessment.invalid' : null));
    d.screen([]);
    d.client.insert('readiness_checks', { any: 1 });
    await d.client.sync();
    d.profile.getState().reload();
    expect(d.profile.getState().screeningRejected).toBe(false);
    d.client.insert('assessments', { any: 1 });
    await d.client.sync();
    d.profile.getState().reload();
    expect(d.profile.getState().screeningRejected).toBe(true);
    expect(d.safety().reasonCodes).toContain(REJECTED_SCREENING_REASON);
    // Without the rejection flag the same history is not treated as rejected (the selector's default is unchanged).
    expect(selectSafetyProfile(d.profile.getState().screenings, d.consents.getState().records).reasonCodes).not.toContain(REJECTED_SCREENING_REASON);
  });
});
