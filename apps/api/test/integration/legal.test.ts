import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_REGISTRY,
  LegalRegistry,
  legalValue,
  notice,
  renderNotice,
  sha256Hex,
  verifyChain,
  type LegalDocument,
  type LegalHoldExport,
} from '@fitadapt/legal';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLocalEnv, parseExportArgs, runLegalHoldExport, summarise } from '../../src/legal/cli.js';
import { bearer, createHarness, signIn, truncateAll, uniqueEmail, type Harness } from './harness.js';

/** Terms with a material v2 published now and effective in 31 days (fixture, drafts only). */
function registryWithMaterialChange(now: Date): LegalRegistry {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const base = DEFAULT_REGISTRY.get('terms')!;
  const v1 = base.versions[0]!;
  const terms: LegalDocument = { ...base, versions: [{ ...v1, publishedOn: day(-10), effectiveFrom: day(-10) }, { ...v1, version: 2, material: true, publishedOn: day(0), effectiveFrom: day(31), changeSummary: 'fixture' }] };
  return new LegalRegistry(DEFAULT_REGISTRY.documents.map((d) => (d.id === 'terms' ? terms : d)));
}

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => truncateAll(h));

const doc = async (id: string, locale = 'fr', jurisdiction = 'FR', harness = h) =>
  (await harness.app.inject({ method: 'GET', url: `/v1/legal/documents/${id}?locale=${locale}&jurisdiction=${jurisdiction}` })).json() as { version: number; contentHash: string; draftBanner: string; title: string; variant: string; sections: { key: string }[] };
const accept = async (token: string, documentId: string, locale = 'fr', jurisdiction = 'FR', harness = h) => {
  const d = await doc(documentId, locale, jurisdiction, harness);
  return harness.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(token), payload: { documentId, version: d.version, locale, jurisdiction, source: 'mobile', contentHash: d.contentHash } });
};
const status = async (token: string, jurisdiction = 'FR', harness = h) =>
  (await harness.app.inject({ method: 'GET', url: `/v1/legal/status?jurisdiction=${jurisdiction}`, headers: bearer(token) })).json() as {
    documents: { documentId: string; status: string; upcomingVersion: number | null }[];
    firstWorkout: { allowed: boolean; missing: string[] };
  };
const grantHealth = (token: string) =>
  h.app.inject({ method: 'POST', url: '/v1/privacy/consents', headers: bearer(token), payload: { dataType: 'health', decision: 'granted', version: 1, locale: 'fr', jurisdiction: 'FR', source: 'mobile' } });
const subjectOf = (userId: string) => h.app.services.legal.subjectRef(userId);

describe('legal documents and acceptance (L2)', () => {
  it('serves drafts per locale and jurisdiction with the draft banner and a content hash', async () => {
    const fr = await doc('terms', 'fr', 'FR');
    const gb = await doc('terms', 'en', 'GB');
    expect(fr.draftBanner).toMatch(/requires counsel review/);
    expect([fr.variant, gb.variant]).toEqual(['EU_FR', 'GB']);
    expect(fr.contentHash).not.toBe(gb.contentHash);
    expect((await h.app.inject({ method: 'GET', url: '/v1/legal/documents/nope?locale=fr&jurisdiction=FR' })).statusCode).toBe(404);
  });

  it('blocks the first workout until Terms, Privacy, health consent and exercise risk are accepted', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const t = tokens.accessToken;
    expect((await status(t)).firstWorkout).toEqual({ allowed: false, missing: ['terms', 'privacy', 'consent.health', 'exercise_risk'] });
    for (const id of ['terms', 'privacy', 'exercise_risk']) expect((await accept(t, id)).statusCode).toBe(201);
    expect((await status(t)).firstWorkout).toEqual({ allowed: false, missing: ['consent.health'] });
    expect((await grantHealth(t)).statusCode).toBe(201);
    expect((await status(t)).firstWorkout).toEqual({ allowed: true, missing: [] });
    // Acceptances count only in their jurisdiction variant.
    expect((await status(t, 'GB')).firstWorkout.missing).toEqual(['terms', 'privacy', 'exercise_risk']);
    const { user } = await signIn(h, uniqueEmail());
    await expect(h.app.services.legal.requireFirstWorkoutAcceptance(user.id, 'FR')).rejects.toMatchObject({ statusCode: 403, code: 'legal.acceptance_required' });
  });

  it('refuses an acceptance whose hash is not the text shown, an unknown document or a consent document', async () => {
    const { tokens } = await signIn(h, uniqueEmail());
    const t = tokens.accessToken;
    const d = await doc('terms');
    const post = (payload: object) => h.app.inject({ method: 'POST', url: '/v1/legal/acceptances', headers: bearer(t), payload: { documentId: 'terms', version: d.version, locale: 'fr', jurisdiction: 'FR', contentHash: d.contentHash, ...payload } });
    expect((await post({ contentHash: 'f'.repeat(64) })).json()).toEqual({ error: { code: 'legal.content_mismatch' } });
    expect((await post({ locale: 'en' })).json()).toEqual({ error: { code: 'legal.content_mismatch' } });
    expect((await post({ version: 9 })).json()).toEqual({ error: { code: 'legal.version_not_acceptable' } });
    expect((await post({ documentId: 'nope' })).statusCode).toBe(404);
    expect((await post({ documentId: 'consent.health' })).json()).toEqual({ error: { code: 'legal.not_acceptable' } });
    expect((await h.app.inject({ method: 'GET', url: '/v1/legal/status?jurisdiction=FR' })).statusCode).toBe(401);
  });

  it('requires re-acceptance once a material change is in force, after the advance notice period', async () => {
    const h2 = await createHarness({ legalRegistry: registryWithMaterialChange(new Date()) });
    try {
      const email = uniqueEmail();
      const { tokens } = await signIn(h2, email);
      let t = tokens.accessToken;
      const first = await accept(t, 'terms', 'fr', 'FR', h2);
      expect({ code: first.statusCode, body: first.json() }).toMatchObject({ code: 201 });
      const s0 = await h2.app.inject({ method: 'GET', url: '/v1/legal/status?jurisdiction=FR', headers: bearer(t) });
      expect({ code: s0.statusCode, body: s0.body }).toMatchObject({ code: 200 });
      expect((await status(t, 'FR', h2)).documents.find((d) => d.documentId === 'terms')).toMatchObject({ status: 'accepted', upcomingVersion: 2 });
      h2.clock.advance((legalValue('materialChangeNoticeDays') + 2) * 86_400);
      t = (await signIn(h2, email)).tokens.accessToken; // the old access token has expired
      expect((await status(t, 'FR', h2)).documents.find((d) => d.documentId === 'terms')).toMatchObject({ status: 'needs_reacceptance' });
      expect((await accept(t, 'terms', 'fr', 'FR', h2)).json()).toMatchObject({ acceptance: { status: 'accepted', acceptedVersion: 2 } });
    } finally {
      await h2.close();
    }
  });

  it('records notices shown and acknowledged, checking the version and the text', async () => {
    const { tokens, user } = await signIn(h, uniqueEmail());
    const n = notice('first_hiit');
    const post = (payload: object) => h.app.inject({ method: 'POST', url: '/v1/legal/notices', headers: bearer(tokens.accessToken), payload: { noticeId: n.id, version: 1, kind: 'shown', locale: 'en', jurisdiction: 'GB', contentHash: renderNotice(n, 'en', 'GB').contentHash, ...payload } });
    expect((await post({})).statusCode).toBe(204);
    expect((await post({ kind: 'acknowledged' })).statusCode).toBe(204);
    expect((await post({ version: 2 })).json()).toEqual({ error: { code: 'legal.version_not_acceptable' } });
    expect((await post({ contentHash: '0'.repeat(64) })).json()).toEqual({ error: { code: 'legal.content_mismatch' } });
    expect((await post({ noticeId: 'nope' })).statusCode).toBe(400);
    await expect(h.app.services.legal.recordNotice(user.id, { noticeId: 'nope', version: 1, kind: 'shown', locale: 'en', jurisdiction: 'GB', contentHash: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 404 });
    const chain = await h.app.services.legal.log.chain(subjectOf(user.id));
    expect(chain.map((e) => e.type)).toEqual(['notice.shown', 'notice.acknowledged']);
  });
});

describe('defensibility log (L11)', () => {
  async function userWithHistory() {
    const { tokens, user } = await signIn(h, uniqueEmail());
    for (const id of ['terms', 'privacy', 'exercise_risk']) await accept(tokens.accessToken, id);
    await grantHealth(tokens.accessToken);
    await h.app.services.legal.recordPrescription(user.id, { prescriptionId: randomUUID(), engineVersion: '0.1.0', reasonCodes: ['load.hold'] });
    await h.app.services.legal.recordSafetyEvent(user.id, { invariant: 'S3', reasonCode: 'safety.s3.chest_pain_reported', action: 'session_ended', engineVersion: '0.1.0' });
    return { token: tokens.accessToken, userId: user.id };
  }

  it('writes acceptances, consents, notices, safety events and engine versions to one verified chain per subject', async () => {
    const { userId } = await userWithHistory();
    const chain = await h.app.services.legal.log.chain(subjectOf(userId));
    expect(chain.map((e) => e.type)).toEqual(['acceptance.recorded', 'acceptance.recorded', 'acceptance.recorded', 'consent.recorded', 'prescription.issued', 'safety.event']);
    expect(await h.app.services.legal.log.verify(subjectOf(userId))).toMatchObject({ ok: true, length: 6 });
    expect(JSON.stringify(chain)).not.toContain(userId);
  });

  it('is append-only in the database: UPDATE and DELETE are rejected', async () => {
    const { userId } = await userWithHistory();
    const n = notice('camera_mode');
    await h.app.services.legal.recordNotice(userId, { noticeId: n.id, version: 1, kind: 'shown', locale: 'fr', jurisdiction: 'FR', contentHash: renderNotice(n, 'fr', 'FR').contentHash });
    const rejected = async (query: Promise<unknown>) => {
      const error = await query.then(() => null, (e: unknown) => e as { message: string; cause?: { message: string } });
      return error?.cause?.message ?? error?.message ?? 'not rejected';
    };
    expect(await rejected(h.database.db.execute(sql`UPDATE defensibility_events SET payload = '{}'::jsonb`))).toMatch(/append-only/);
    expect(await rejected(h.database.db.execute(sql`DELETE FROM defensibility_events`))).toMatch(/append-only/);
    expect(await rejected(h.database.db.execute(sql`UPDATE legal_acceptances SET version = 9`))).toMatch(/append-only/);
    expect(await rejected(h.database.db.execute(sql`UPDATE notice_impressions SET version = 9`))).toMatch(/append-only/);
    expect((await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM defensibility_events`)).rows[0]!.n).toBe(7);
  });

  it('detects tampering by someone who bypasses the triggers', async () => {
    const { userId } = await userWithHistory();
    const subject = subjectOf(userId);
    // A table owner can disable triggers; the hash chain still exposes the edit.
    await h.database.db.execute(sql`ALTER TABLE defensibility_events DISABLE TRIGGER USER`);
    try {
      await h.database.db.execute(sql`UPDATE defensibility_events SET payload = jsonb_set(payload, '{invariant}', '"S2"') WHERE chain = ${subject} AND type = 'safety.event'`);
    } finally {
      await h.database.db.execute(sql`ALTER TABLE defensibility_events ENABLE TRIGGER USER`);
    }
    expect(await h.app.services.legal.log.verify(subject)).toEqual({ ok: false, brokenAt: 5, reason: 'hash_mismatch' });
    const out = await h.app.services.legal.legalHoldExport(userId, 'test_counsel');
    expect(out.integrity).toEqual({ ok: false, brokenAt: 5, reason: 'hash_mismatch' });
  });

  it('pnpm legal:export produces a legal-hold export, places a hold and audits the access; it survives account deletion', async () => {
    const { token, userId } = await userWithHistory();
    const dir = mkdtempSync(join(tmpdir(), 'legal-export-'));
    const args = parseExportArgs(['--', '--user', userId, '--out', 'hold.json', '--actor', 'test_counsel']);
    const { path } = await runLegalHoldExport(h.app.services.legal, args, dir);
    expect(path).toBe(join(dir, 'hold.json'));
    const file = JSON.parse(readFileSync(path, 'utf8')) as LegalHoldExport;
    expect(file.format).toBe('legal-hold-export');
    expect(file.integrity).toMatchObject({ ok: true, length: 8 });
    expect([file.acceptances.length, file.consents.length, file.safetyEvents.length, file.prescriptions.length, file.legalHolds.length, file.accessLog.length]).toEqual([3, 1, 1, 1, 1, 1]);
    expect(file.engineVersions).toMatchObject([{ engineVersion: '0.1.0', events: 2 }]);
    expect(file.accessLog[0]!.payload).toEqual({ actorRole: 'test_counsel', purpose: 'legal_hold_export', subjectDigest: sha256Hex(subjectOf(userId)), eventsReturned: 7 });
    expect(verifyChain(file.chain).ok).toBe(true);
    expect(summarise(path, file)).toContain('chain verified (8 events');

    const del = await h.app.inject({ method: 'POST', url: '/v1/privacy/deletion', headers: bearer(token), payload: { confirm: 'delete-my-account' } });
    expect(del.statusCode).toBe(202);
    const after = await h.app.services.legal.legalHoldExport(userId, 'test_counsel');
    // Same chain, still verified; the hold is not duplicated; one more access entry.
    expect(after.integrity).toMatchObject({ ok: true, length: 9 });
    expect([after.acceptances.length, after.legalHolds.length, after.accessLog.length]).toEqual([3, 1, 2]);
    const rows = await h.database.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM legal_acceptances`);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it('parses CLI arguments strictly and writes to reports/legal by default', async () => {
    expect(() => parseExportArgs([])).toThrow(/--user/);
    expect(() => parseExportArgs(['--user', 'not-a-uuid'])).toThrow(/UUID/);
    expect(() => parseExportArgs(['--user', randomUUID(), '--actor', 'Some Person'])).toThrow(/role code/);
    expect(() => parseExportArgs(['--bogus'])).toThrow(/Unknown/);
    const { userId } = await userWithHistory();
    const { path } = await runLegalHoldExport(h.app.services.legal, parseExportArgs(['--user', userId]));
    expect(path).toMatch(/reports\/legal\/legal-hold-.+\.json$/);
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    expect(() => loadLocalEnv(mkdtempSync(join(tmpdir(), 'noenv-')), env)).not.toThrow();
  });

  it('purges expired chains after the retention period, except under legal hold, and records the purge', async () => {
    const held = await userWithHistory();
    const expired = await userWithHistory();
    await h.app.services.legal.legalHoldExport(held.userId, 'test_counsel');
    const future = new Date(h.clock.now().getTime() + (legalValue('defensibilityRetentionDays') + 1) * 86_400_000);
    expect(await h.app.services.legal.log.purgeExpired(new Date())).toEqual({ purged: 0 });
    expect(await h.app.services.legal.log.purgeExpired(future)).toEqual({ purged: 1 });
    expect(await h.app.services.legal.log.chain(subjectOf(expired.userId))).toEqual([]);
    expect((await h.app.services.legal.log.chain(subjectOf(held.userId))).length).toBe(8);
    const global = await h.app.services.legal.log.chain('global');
    expect(global.map((e) => e.type)).toEqual(['retention.purged']);
    expect(global[0]!.payload).toMatchObject({ chainDigest: sha256Hex(subjectOf(expired.userId)), eventCount: 6 });
    expect(await h.app.services.legal.log.verify('global')).toMatchObject({ ok: true });
  });

  it('FIX-B (B pre-review): an incident report puts the subject under legal hold automatically, so retention never purges it', async () => {
    const reported = await userWithHistory();
    const chain = subjectOf(reported.userId);
    expect(await h.app.services.legal.log.isHeld(chain)).toBe(false);
    const incidentId = randomUUID();
    await h.app.services.legal.log.appendNow({ type: 'incident.recorded', chain, occurredAt: h.clock.now().toISOString(), payload: { incidentId, category: 'injury_report', step: 'received' } });
    expect(await h.app.services.legal.log.isHeld(chain)).toBe(true);
    // A later step of the same incident does not stack a second hold.
    await h.app.services.legal.log.appendNow({ type: 'incident.recorded', chain, occurredAt: h.clock.now().toISOString(), payload: { incidentId, category: 'injury_report', step: 'triaged' } });
    const events = await h.app.services.legal.log.chain(chain);
    expect(events.filter((e) => e.type === 'legal_hold.placed').map((e) => (e.payload as { reasonCode: string }).reasonCode)).toEqual(['legal_hold.auto.incident_reported']);
    expect(verifyChain(events)).toMatchObject({ ok: true });
    const future = new Date(h.clock.now().getTime() + (legalValue('defensibilityRetentionDays') + 1) * 86_400_000);
    expect(await h.app.services.legal.log.purgeExpired(future)).toEqual({ purged: 0 });
    expect((await h.app.services.legal.log.chain(chain)).length).toBe(events.length);
  });
});
