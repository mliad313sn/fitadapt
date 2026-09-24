import { buildCapacityModel } from '@fitadapt/exercise-library';
import type { AssessmentResult, ExecutionLog, ReadinessCheck, ReflowRecord } from '@fitadapt/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { createAgeGateStore } from '../src/privacy/age-gate';
import { buildExport, EXPORT_COLLECTION_NAMES, parseCsv, parseExport, toCsv, toJson, ExportFormatError, type ExportRecords } from '../src/progress/export';
import { importBundle } from '../src/progress/import';
import { expoPhotoFiles, PhotoVault } from '../src/progress/photo-vault';
import { ProgressScreen } from '../src/screens/ProgressScreen';
import { MemoryDeviceKeyStore } from '../src/storage/device-keys';
import { tr } from './helpers';
import { closeReferenceDevices, referenceDevice, seedReferenceData, type ReferenceDevice } from './progress-seed';

/**
 * Goal condition 5: the CSV and JSON exports hold ALL training and body data
 * (every collection: started sessions, set logs, execution logs incl. pain,
 * cardio and session ends, readiness checks, assessments, programs and
 * reflows, body metrics incl. body-fat estimates and corrections,
 * measurements; photos on request in JSON) and round-trip through the
 * importer onto another device, exactly (same ids, same records). Both are
 * made on the device, offline, through the share sheet; the importer reads a
 * picked file. The export file is deleted from the cache after sharing.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileSystem = require('expo-file-system') as { __files: Map<string, Uint8Array> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sharing = require('expo-sharing') as { shareAsync: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DocumentPicker = require('expo-document-picker') as { __queue: { uri: string }[] };

const TODAY = '2026-09-24';
const rand = (n: number) => new Uint8Array(randomBytes(n));
let fetchSpy: jest.SpyInstance;
/** What the share sheet received: the file's name, type and content at the moment it was shared. */
const shared: { uri: string; mimeType: string; content: string }[] = [];
beforeEach(() => {
  FileSystem.__files.clear();
  DocumentPicker.__queue.length = 0;
  shared.length = 0;
  Sharing.shareAsync.mockImplementation(async (uri: string, options: { mimeType: string }) => {
    shared.push({ uri, mimeType: options.mimeType, content: new TextDecoder().decode(FileSystem.__files.get(uri)) });
  });
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  closeReferenceDevices();
});

const gymResult: AssessmentResult = {
  protocolId: 'gym',
  protocolVersion: 1,
  stopRir: 2,
  startedAt: '2026-06-01T17:00:00.000Z',
  completedAt: '2026-06-01T17:30:00.000Z',
  tests: [
    { status: 'done', testId: 'squat_load', exerciseId: 'barbell_back_squat', loadKg: 60, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'press_load', exerciseId: 'barbell_bench_press', loadKg: 40, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'pulldown_load', exerciseId: 'lat_pulldown', loadKg: 35, reps: 10, rir: 2, seconds: null },
    { status: 'done', testId: 'row_load', exerciseId: 'barbell_row', loadKg: 35, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'hinge_load', exerciseId: 'barbell_romanian_deadlift', loadKg: 50, reps: 8, rir: 2, seconds: null },
    { status: 'done', testId: 'plank_hold', exerciseId: 'front_plank', loadKg: null, reps: null, seconds: 40, rir: null },
  ],
};

/** Twelve weeks of the reference user, plus one record of every other kind of training and body data. */
function fullDevice() {
  const d = referenceDevice();
  seedReferenceData(d, { endDate: TODAY, weeks: 12 });
  const planId = d.profile.getState().workouts.at(-1)!.data.plan.planId;
  const logs: ExecutionLog[] = [
    { kind: 'pain', planId, joint: 'knee', score: 3, at: '2026-09-23T07:30:00.000Z', phase: 'during', settled: false },
    { kind: 'cardio_done', planId, protocol: 'steady', moderateSeconds: 540, vigorousSeconds: 0, completedWork: 1, totalWork: 1, rounds: null, endedEarly: false, at: '2026-09-23T07:50:00.000Z' },
  ];
  for (const log of logs) d.client.insert('execution_logs', log);
  const readiness: ReadinessCheck = { schemaVersion: 1, date: '2026-09-23', at: '2026-09-23T06:00:00.000Z', sleep: 4, soreness: 2, stress: 3, energy: 4, wearable: null };
  d.client.insert('readiness_checks', readiness);
  d.client.insert('assessments', { reason: 'first', result: gymResult, capacity: buildCapacityModel(gymResult), cappedByS1: false });
  const programId = d.profile.getState().programs.at(-1)!.data.program.programId;
  const reflow: ReflowRecord = { programId, sessionId: 'w01.s2', reportedOn: '2026-08-30', outcome: { kind: 'skipped' }, engineVersion: '0.4.0', decidedAt: '2026-08-30T09:00:00.000Z', reasonCodes: ['program.reflow.skipped'] };
  d.client.insert('program_reflows', reflow);
  d.progress.getState().logBodyMetric('body_fat', 24.5, '2026-09-20');
  const last = d.progress.getState().bodyMetrics.find((m) => m.data.kind === 'weight' && m.data.measuredOn === '2026-09-22')!;
  d.progress.getState().correctBodyMetric(last.id, 59.9, '2026-09-22');
  d.progress.getState().logMeasurement('hips', 94.5, '2026-09-21');
  d.profile.getState().reload();
  d.progress.getState().reload();
  return d;
}

/** The records of every exported collection on a device, sorted by id (what must survive the round trip). */
function recordsOf(d: ReferenceDevice): ExportRecords {
  return Object.fromEntries(EXPORT_COLLECTION_NAMES.map((c) => [c, d.client.list(c).map((r) => ({ id: r.id, data: r.data })).sort((a, b) => a.id.localeCompare(b.id))])) as unknown as ExportRecords;
}

function renderProgress(d: ReferenceDevice, vault: PhotoVault | null = null) {
  return render(
    <AppProviders
      syncClient={d.client}
      initialLocale="en"
      profile={d.profile}
      legal={d.legal}
      progress={{ progress: d.progress, nutrition: d.nutrition, vault, randomBytes: rand }}
      privacy={{ ageGate: createAgeGateStore(d.kv), consents: d.consents, wipeLocalData: () => undefined }}
    >
      <ProgressScreen onExit={() => undefined} />
    </AppProviders>,
  );
}

const pickFile = (content: string, name: string) => {
  const uri = `file://cache/DocumentPicker/${name}`;
  FileSystem.__files.set(uri, new TextEncoder().encode(content));
  DocumentPicker.__queue.push({ uri });
  return uri;
};

describe('export of all training and body data, and the importer', () => {
  it.each(['json', 'csv'] as const)('%s: made on the device offline, holds every collection, and round-trips exactly onto another device', async (format) => {
    const source = fullDevice();
    const original = recordsOf(source);
    // Every kind of training and body data is present, so the round trip proves each one.
    for (const c of EXPORT_COLLECTION_NAMES) expect({ c, n: original[c].length > 0 }).toEqual({ c, n: true });
    expect(original.execution_logs.map((r) => r.data.kind).sort()).toEqual(expect.arrayContaining(['cardio_done', 'ended', 'pain']));
    expect(original.body_metrics.some((r) => r.data.correctionOf !== null)).toBe(true);

    renderProgress(source);
    fireEvent.press(screen.getByTestId(`progress-export-${format}`));
    await waitFor(() => expect(screen.getByTestId('progress-export-message').props.children).toBe(tr('en').t('progress.export.done')));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.uri).toMatch(new RegExp(`/training-export-${TODAY}\\.${format}$`));
    expect(shared[0]!.mimeType).toBe(format === 'json' ? 'application/json' : 'text/csv');
    // The temporary file does not stay in the cache.
    expect(FileSystem.__files.has(shared[0]!.uri)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    screen.unmount();

    const content = shared[0]!.content;
    if (format === 'csv') {
      const rows = parseCsv(content);
      expect(rows.filter((r) => r[0] === '# section').map((r) => r[1])).toEqual(EXPORT_COLLECTION_NAMES);
      // Sets and body data are flat columns a spreadsheet can use.
      expect(rows).toContainEqual(['id', 'planId', 'exerciseIndex', 'exerciseId', 'setIndex', 'status', 'reps', 'seconds', 'loadKg', 'rir', 'loggedAt', 'correctionOf']);
      expect(rows).toContainEqual(['id', 'kind', 'value', 'measuredOn', 'at', 'correctionOf']);
    }

    // Another phone of the same person (a fresh install): import through the screen.
    const target = referenceDevice();
    expect(recordsOf(target).set_logs).toEqual([]);
    renderProgress(target);
    pickFile(content, `export.${format}`);
    fireEvent.press(screen.getByTestId('progress-import'));
    const total = EXPORT_COLLECTION_NAMES.reduce((n, c) => n + original[c].length, 0);
    await waitFor(() => expect(screen.getByTestId('progress-export-message').props.children).toBe(tr('en').t('progress.import.done', { count: total })), { timeout: 60_000 });
    expect(FileSystem.__files.size).toBe(0);
    // Exactly the same records, collection by collection (same ids, same data).
    expect(recordsOf(target)).toEqual(original);
    // The imported data drives the dashboard like data logged here.
    expect(screen.getByTestId('progress-body-trend')).toBeTruthy();
    // Importing the same file again adds nothing (records keep their ids; nothing is overwritten).
    pickFile(content, `again.${format}`);
    fireEvent.press(screen.getByTestId('progress-import'));
    await waitFor(() => expect(screen.getByTestId('progress-export-message').props.children).toBe(tr('en').t('progress.import.done', { count: 0 })), { timeout: 60_000 });
    // Imported records are uploaded like local ones (the server validates them).
    expect(target.client.outbox('pending').length).toBeGreaterThanOrEqual(total);
  }, 120_000);

  it('JSON with photos (on request): the images come back, encrypted again under the new device key', async () => {
    const source = fullDevice();
    source.consents.getState().decide('photos', true, 'en');
    const vault = new PhotoVault({ db: source.db, files: expoPhotoFiles(), keys: new MemoryDeviceKeyStore(), randomBytes: rand, newId: randomUUID, now: () => new Date(`${TODAY}T12:00:00.000Z`) });
    const image = new Uint8Array([0xff, 0xd8, ...new TextEncoder().encode('EXPORT-PHOTO-CANARY'), ...rand(500)]);
    const meta = vault.add({ image, mimeType: 'image/jpeg', pose: 'front', takenOn: '2026-09-01' });
    renderProgress(source, vault);
    fireEvent.press(screen.getByTestId('progress-export-photos'));
    fireEvent.press(screen.getByTestId('progress-export-json'));
    await waitFor(() => expect(shared).toHaveLength(1));
    screen.unmount();
    const bundle = parseExport(shared[0]!.content);
    expect(bundle.photos.map((p) => p.meta.id)).toEqual([meta.id]);

    const target = referenceDevice();
    target.consents.getState().decide('photos', true, 'en');
    const targetVault = new PhotoVault({ db: target.db, files: expoPhotoFiles(), keys: new MemoryDeviceKeyStore(), randomBytes: rand, newId: randomUUID, now: () => new Date() });
    // (Both vaults share the in-memory file system of the stand-in: clear the source's files first.)
    FileSystem.__files.clear();
    expect(importBundle(bundle, target.client, targetVault)).toBeGreaterThan(1);
    expect(Buffer.compare(Buffer.from(targetVault.image(meta.id)), Buffer.from(image))).toBe(0);
    const stored = [...FileSystem.__files.values()];
    expect(stored).toHaveLength(1);
    expect(Buffer.from(stored[0]!).includes(Buffer.from('EXPORT-PHOTO-CANARY'))).toBe(false);
    expect(importBundle(bundle, target.client, targetVault)).toBe(0);
    // CSV never carries photos.
    expect(toCsv(bundle)).not.toContain(bundle.photos[0]!.imageBase64.slice(0, 40));
  }, 120_000);

  it('the formats round-trip awkward values (quotes, commas, new lines) and refuse anything that is not an export', () => {
    const records = recordsOf(fullDevice());
    const bundle = buildExport(records, { exportedAt: `${TODAY}T12:00:00.000Z`, engineVersion: '0.4.0' });
    expect(parseExport(toJson(bundle))).toEqual(bundle);
    expect(parseExport(toCsv(bundle))).toEqual(bundle);
    expect(parseExport(toCsv(bundle).replace(/\r\n/g, '\n'))).toEqual(bundle);
    expect(parseCsv('a,"b ""q"", c","line\nbreak"\r\nx')).toEqual([['a', 'b "q", c', 'line\nbreak'], ['x']]);
    for (const bad of ['', 'hello', '{"format":"other"}', '# export,other,1', '# export,training-body-export,1,2026-09-24T12:00:00.000Z,0.4.0\r\n# section,unknown\r\n', '{not json']) {
      expect(() => parseExport(bad)).toThrow(ExportFormatError);
    }
  });

  it('a file that is not an export is refused on the screen and nothing is imported', async () => {
    const d = referenceDevice();
    const before = recordsOf(d);
    renderProgress(d);
    pickFile('name,weight\nsomeone,70\n', 'other.csv');
    fireEvent.press(screen.getByTestId('progress-import'));
    await waitFor(() => expect(screen.getByTestId('progress-export-message').props.children).toBe(tr('en').t('progress.import.failed')));
    expect(recordsOf(d)).toEqual(before);
    // Cancelled picker: nothing happens.
    fireEvent.press(screen.getByTestId('progress-import'));
    expect(recordsOf(d)).toEqual(before);
  });
});
