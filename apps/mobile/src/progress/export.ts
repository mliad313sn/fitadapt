import {
  ASSESSMENT_COLLECTION,
  AssessmentRecordSchema,
  BodyMetricSchema,
  ExecutionLogSchema,
  IsoDateTimeSchema,
  MeasurementSchema,
  PROGRAM_COLLECTIONS,
  PROGRESS_COLLECTIONS,
  ProgramRecordSchema,
  ProgressPhotoSchema,
  RECOVERY_COLLECTIONS,
  ReadinessCheckSchema,
  ReflowRecordSchema,
  SESSION_COLLECTIONS,
  SetLogSchema,
  UuidSchema,
  WorkoutSessionRecordSchema,
} from '@fitadapt/shared';
import { z } from 'zod';
import { fromBase64, toBase64 } from './photo-crypto';

/**
 * Export of all training and body data (M04 Scope: "Export of all training
 * and body data (CSV and JSON)", GDPR Art. 20 portability), made on the
 * device from the local records, offline. JSON is complete and lossless;
 * CSV holds the same records: flat columns for sets and body data, and the
 * nested prescriptions (sessions, programs, assessments, events) as JSON in
 * one `record_json` column so the importer can rebuild them exactly. Both
 * round-trip through `parseExport` + the importer. Progress photos are
 * included only on request and only in JSON (they are then unencrypted in
 * the file: the screen says so).
 */
export const EXPORT_FORMAT = 'training-body-export';
export const EXPORT_SCHEMA_VERSION = 1;

const rec = <T extends z.ZodType>(data: T) => z.array(z.strictObject({ id: UuidSchema, data }));

/** Every collection of training and body data, in export order. */
export const EXPORT_COLLECTIONS = {
  [SESSION_COLLECTIONS.workoutSessions]: WorkoutSessionRecordSchema,
  [SESSION_COLLECTIONS.setLogs]: SetLogSchema,
  [SESSION_COLLECTIONS.executionLogs]: ExecutionLogSchema,
  [RECOVERY_COLLECTIONS.readinessChecks]: ReadinessCheckSchema,
  [ASSESSMENT_COLLECTION]: AssessmentRecordSchema,
  [PROGRAM_COLLECTIONS.programs]: ProgramRecordSchema,
  [PROGRAM_COLLECTIONS.reflows]: ReflowRecordSchema,
  [PROGRESS_COLLECTIONS.bodyMetrics]: BodyMetricSchema,
  [PROGRESS_COLLECTIONS.measurements]: MeasurementSchema,
} as const;
export type ExportCollection = keyof typeof EXPORT_COLLECTIONS;
export const EXPORT_COLLECTION_NAMES = Object.keys(EXPORT_COLLECTIONS) as ExportCollection[];

export const ExportBundleSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: IsoDateTimeSchema,
  engineVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  collections: z.strictObject({
    workout_sessions: rec(WorkoutSessionRecordSchema),
    set_logs: rec(SetLogSchema),
    execution_logs: rec(ExecutionLogSchema),
    readiness_checks: rec(ReadinessCheckSchema),
    assessments: rec(AssessmentRecordSchema),
    programs: rec(ProgramRecordSchema),
    program_reflows: rec(ReflowRecordSchema),
    body_metrics: rec(BodyMetricSchema),
    measurements: rec(MeasurementSchema),
  }),
  photos: z.array(z.strictObject({ meta: ProgressPhotoSchema, imageBase64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) })),
});
export type ExportBundle = z.infer<typeof ExportBundleSchema>;
export type ExportRecords = ExportBundle['collections'];

export interface ExportPhoto {
  readonly meta: z.infer<typeof ProgressPhotoSchema>;
  readonly image: Uint8Array;
}

/** Sorted by id so the same records always give the same file (and round trips compare equal). */
export function buildExport(collections: ExportRecords, meta: { exportedAt: string; engineVersion: string }, photos: readonly ExportPhoto[] = []): ExportBundle {
  const sorted = Object.fromEntries(EXPORT_COLLECTION_NAMES.map((c) => [c, [...collections[c]].sort((a, b) => a.id.localeCompare(b.id))])) as ExportRecords;
  return ExportBundleSchema.parse({
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: meta.exportedAt,
    engineVersion: meta.engineVersion,
    collections: sorted,
    photos: [...photos].sort((a, b) => a.meta.id.localeCompare(b.meta.id)).map((p) => ({ meta: p.meta, imageBase64: toBase64(p.image) })),
  });
}

export const toJson = (bundle: ExportBundle) => `${JSON.stringify(bundle, null, 2)}\n`;

// ------------------------------------------------------------------- CSV

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (values: readonly unknown[]) => values.map(cell).join(',');

/** Flat columns per collection (the rest of a record, if any, is in `record_json`). */
const SET_COLUMNS = ['id', 'planId', 'exerciseIndex', 'exerciseId', 'setIndex', 'status', 'reps', 'seconds', 'loadKg', 'rir', 'loggedAt', 'correctionOf'] as const;
const BODY_COLUMNS = ['id', 'kind', 'value', 'measuredOn', 'at', 'correctionOf'] as const;
const MEASUREMENT_COLUMNS = ['id', 'site', 'valueCm', 'measuredOn', 'at', 'correctionOf'] as const;
const NESTED_COLUMNS = ['id', 'summary_date', 'record_json'] as const;

function nestedDate(collection: ExportCollection, data: unknown): string {
  const d = data as Record<string, unknown>;
  if (collection === 'workout_sessions') return String(d.startedAt);
  if (collection === 'execution_logs' || collection === 'readiness_checks') return String(d.at);
  if (collection === 'assessments') return String((d.capacity as Record<string, unknown>).assessedAt);
  if (collection === 'programs') return String((d.program as Record<string, unknown>).generatedAt);
  return String(d.decidedAt);
}

export function toCsv(bundle: ExportBundle): string {
  const lines: string[] = [row(['# export', bundle.format, bundle.schemaVersion, bundle.exportedAt, bundle.engineVersion])];
  for (const collection of EXPORT_COLLECTION_NAMES) {
    lines.push(row(['# section', collection]));
    if (collection === 'set_logs') {
      lines.push(row(SET_COLUMNS));
      for (const { id, data: d } of bundle.collections.set_logs) lines.push(row([id, d.planId, d.exerciseIndex, d.exerciseId, d.set.index, d.set.status, d.set.reps, d.set.seconds, d.set.loadKg, d.set.rir, d.loggedAt, d.correctionOf]));
    } else if (collection === 'body_metrics') {
      lines.push(row(BODY_COLUMNS));
      for (const { id, data: d } of bundle.collections.body_metrics) lines.push(row([id, d.kind, d.value, d.measuredOn, d.at, d.correctionOf]));
    } else if (collection === 'measurements') {
      lines.push(row(MEASUREMENT_COLUMNS));
      for (const { id, data: d } of bundle.collections.measurements) lines.push(row([id, d.site, d.valueCm, d.measuredOn, d.at, d.correctionOf]));
    } else {
      lines.push(row(NESTED_COLUMNS));
      for (const { id, data } of bundle.collections[collection]) lines.push(row([id, nestedDate(collection, data), JSON.stringify(data)]));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** RFC 4180 parser (quoted fields, doubled quotes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let current: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      current.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));
const str = (s: string | undefined) => (s === undefined || s === '' ? null : s);

function fromCsv(text: string): unknown {
  const rows = parseCsv(text);
  const head = rows[0];
  if (!head || head[0] !== '# export' || head[1] !== EXPORT_FORMAT) throw new ExportFormatError();
  const collections: Record<string, { id: string; data: unknown }[]> = Object.fromEntries(EXPORT_COLLECTION_NAMES.map((c) => [c, []]));
  let section: string | null = null;
  let header = true;
  for (const r of rows.slice(1)) {
    if (r[0] === '# section') {
      section = r[1] ?? null;
      if (!section || !(section in collections)) throw new ExportFormatError();
      header = true;
      continue;
    }
    if (section === null) throw new ExportFormatError();
    if (header) {
      header = false;
      continue;
    }
    const [id, ...v] = r;
    let data: unknown;
    if (section === 'set_logs') {
      data = { schemaVersion: 1, planId: v[0], exerciseIndex: num(v[1]), exerciseId: v[2], set: { index: num(v[3]), status: v[4], reps: num(v[5]), seconds: num(v[6]), loadKg: num(v[7]), rir: num(v[8]) }, loggedAt: v[9], correctionOf: str(v[10]) };
    } else if (section === 'body_metrics') {
      data = { schemaVersion: 1, kind: v[0], value: num(v[1]), measuredOn: v[2], at: v[3], correctionOf: str(v[4]) };
    } else if (section === 'measurements') {
      data = { schemaVersion: 1, site: v[0], valueCm: num(v[1]), measuredOn: v[2], at: v[3], correctionOf: str(v[4]) };
    } else {
      data = JSON.parse(v[1] ?? 'null');
    }
    collections[section]!.push({ id: id!, data });
  }
  return { format: EXPORT_FORMAT, schemaVersion: Number(head[2]), exportedAt: head[3], engineVersion: head[4], collections, photos: [] };
}

export class ExportFormatError extends Error {
  constructor() {
    super('not an export of this app');
    this.name = 'ExportFormatError';
  }
}

/** Reads a JSON or CSV export (zod-validated at the boundary). Throws ExportFormatError on anything else. */
export function parseExport(text: string): ExportBundle {
  const trimmed = text.trimStart();
  try {
    const raw = trimmed.startsWith('{') ? JSON.parse(trimmed) : fromCsv(text);
    return ExportBundleSchema.parse(raw);
  } catch (error) {
    if (error instanceof ExportFormatError) throw error;
    throw new ExportFormatError();
  }
}

export const photoImage = (p: ExportBundle['photos'][number]) => fromBase64(p.imageBase64);
