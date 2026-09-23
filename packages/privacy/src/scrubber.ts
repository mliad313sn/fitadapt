/**
 * Personal-data detector and scrubber for logs and analytics (CLAUDE.md rule 7,
 * docs/adr/ADR-007-security-gates-and-telemetry-hygiene.md).
 *
 * Two layers:
 *  - `scrubLogRecord` / `scrubText` redact what they recognise before a log
 *    line is written (defence in depth; the first defence is not logging such
 *    data at all);
 *  - `findPersonalData` / `findPersonalDataInLogLines` detect what got
 *    through. Tests run it over captured log output and analytics events and
 *    fail on any finding.
 *
 * Detection is by key name (e.g. `email`, `weightKg`, `painScore`, `note`) and
 * by value pattern (email addresses, weights with a unit, pain wording or
 * "n/10" scores, capitalised full names, free-text sentences, bearer tokens,
 * phone numbers in international format, IPv4 addresses).
 */
export type PersonalDataCategory = 'email' | 'name' | 'weight' | 'pain' | 'free_text' | 'secret' | 'phone' | 'ip';

export interface PersonalDataFinding {
  readonly category: PersonalDataCategory;
  /** Dotted path of the offending key, e.g. "user.email" or "events[0].props.note". */
  readonly path: string;
  /** How it was recognised. Never the value itself. */
  readonly by: 'key' | 'value';
}

export const REDACTED = '[redacted]';

const KEY_RULES: ReadonlyArray<readonly [RegExp, PersonalDataCategory]> = [
  [/e[-_]?mail|courriel/i, 'email'],
  [/^(?:first|last|full|given|family|display|nick|user|real|legal|middle|sur|pre)?[-_]?(?:name|nom|prenom|prénom)$/i, 'name'],
  [/weight|body[-_]?mass|\bbmi\b|^bmi|kilos?$|kg$|lbs?$|pounds|poids/i, 'weight'],
  [/pain|symptom|injur|douleur|blessure/i, 'pain'],
  [/note|comment|message|free[-_]?text|description|reply|prompt|answer|feedback|^bio$|^text$|^content$|^body$|transcript/i, 'free_text'],
  [/token|secret|password|passwd|authorization|cookie|pepper|^otp$|^code$|api[-_]?key|credential/i, 'secret'],
  [/phone|msisdn|telephone|téléphone/i, 'phone'],
  [/^ip$|ip[-_]?addr|remote[-_]?addr|^ips$/i, 'ip'],
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const WEIGHT = /\b\d{1,3}(?:[.,]\d+)?\s?(?:kg|kgs|kilo(?:gram(?:me)?)?s?|lbs?|pounds?|livres?)\b/gi;
const PHONE = /\+\d{1,3}[\s.-]?\d{1,4}(?:[\s.-]?\d{2,4}){2,4}\b/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const PAIN = /\b(?:pain|painful|hurts?|hurting|ache|aching|sore|douleurs?|douloureu(?:x|se)|mal\s+(?:au|aux|à la|a la|à l'|au niveau))\b|\b(?:10|\d)\s?\/\s?10\b/i;
/** Two or more capitalised words and nothing else, e.g. "Jeanne Testeur". */
const FULL_NAME = /^\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)+$/u;
/** Three or more words: a sentence someone typed rather than a code or an identifier. */
const FREE_TEXT = /(?:\p{L}{2,}[\s,;:!?.'’]+){2,}\p{L}{2,}/u;

function keyCategory(key: string): PersonalDataCategory | undefined {
  for (const [pattern, category] of KEY_RULES) if (pattern.test(key)) return category;
  return undefined;
}

const reset = (re: RegExp) => {
  re.lastIndex = 0;
  return re;
};

/** Categories a single string value matches (value patterns only). */
export function valueCategories(value: string, options: { allowSentences?: boolean } = {}): PersonalDataCategory[] {
  const found = new Set<PersonalDataCategory>();
  if (reset(EMAIL).test(value)) found.add('email');
  if (reset(JWT).test(value) || reset(BEARER).test(value)) found.add('secret');
  if (reset(WEIGHT).test(value)) found.add('weight');
  if (reset(PHONE).test(value)) found.add('phone');
  if (reset(IPV4).test(value)) found.add('ip');
  if (PAIN.test(value)) found.add('pain');
  if (!options.allowSentences) {
    if (FULL_NAME.test(value.trim())) found.add('name');
    else if (FREE_TEXT.test(value)) found.add('free_text');
  }
  return [...found];
}

/**
 * Redacts recognisable personal data inside a developer-written message
 * (e.g. a log message string). Sentences are allowed here: log messages are
 * constant text written by developers, but interpolated values are redacted.
 */
export function scrubText(text: string): string {
  let out = text
    .replace(reset(EMAIL), `${REDACTED}`)
    .replace(reset(JWT), REDACTED)
    .replace(reset(BEARER), REDACTED)
    .replace(reset(WEIGHT), REDACTED)
    .replace(reset(PHONE), REDACTED)
    .replace(reset(IPV4), REDACTED);
  if (PAIN.test(out)) out = REDACTED;
  return out;
}

const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export interface ScrubOptions {
  /** Top-level keys passed through untouched because a serializer makes them safe (e.g. Fastify `req`, `res`). */
  readonly passThroughKeys?: readonly string[];
}

/**
 * Returns a copy of a log record with personal data redacted. Errors keep only
 * their type and machine code (messages and stacks can quote user input).
 */
export function scrubLogRecord(record: Record<string, unknown>, options: ScrubOptions = {}): Record<string, unknown> {
  const pass = new Set(options.passThroughKeys ?? []);
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      return valueCategories(value).length > 0 ? REDACTED : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    if (depth >= MAX_DEPTH) return REDACTED;
    seen.add(value);
    if (value instanceof Error) {
      const code = (value as { code?: unknown }).code;
      return typeof code === 'string' && valueCategories(code).length === 0 ? { type: value.name, errorCode: code } : { type: value.name };
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    if (value instanceof Date) return value.toISOString();
    if (!isPlainObject(value)) return `[${value.constructor?.name ?? 'object'}]`;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = keyCategory(key) ? REDACTED : visit(inner, depth + 1);
    }
    return out;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (pass.has(key)) out[key] = value;
    else out[key] = keyCategory(key) ? REDACTED : visit(value, 1);
  }
  return out;
}

export interface DetectOptions {
  /**
   * Keys whose string values are developer-written sentences (the log `msg`).
   * They are still checked for emails, weights, pain wording, phones, IPs and
   * tokens, but not for sentence shape.
   */
  readonly messageKeys?: readonly string[];
}

/** Every place in `value` that holds personal data. Empty means clean. */
export function findPersonalData(value: unknown, options: DetectOptions = {}): PersonalDataFinding[] {
  const messageKeys = new Set(options.messageKeys ?? []);
  const findings: PersonalDataFinding[] = [];
  const seen = new WeakSet<object>();
  const visit = (node: unknown, path: string, key: string | undefined) => {
    if (typeof node === 'string') {
      if (node === REDACTED) return;
      const allowSentences = key !== undefined && messageKeys.has(key) && !path.includes('.');
      for (const category of valueCategories(node, { allowSentences })) findings.push({ category, path, by: 'value' });
      return;
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const entries = Array.isArray(node) ? node.map((v, i) => [`[${i}]`, v] as const) : Object.entries(node);
    for (const [k, inner] of entries) {
      const childPath = Array.isArray(node) ? `${path}${k}` : path ? `${path}.${k}` : k;
      const category = Array.isArray(node) ? undefined : keyCategory(k);
      if (category && inner !== REDACTED && inner !== undefined && inner !== null) {
        findings.push({ category, path: childPath, by: 'key' });
        continue;
      }
      visit(inner, childPath, Array.isArray(node) ? key : k);
    }
  };
  visit(value, '', undefined);
  return findings;
}

/**
 * Scans newline-delimited JSON log output (pino format). Lines that are not
 * JSON are scanned as plain text. The pino `msg` is treated as a developer message.
 */
export function findPersonalDataInLogLines(output: string | readonly string[]): PersonalDataFinding[] {
  const lines = (typeof output === 'string' ? output.split('\n') : output.flatMap((l) => l.split('\n'))).filter((l) => l.trim());
  const findings: PersonalDataFinding[] = [];
  lines.forEach((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = { msg: line };
    }
    for (const f of findPersonalData(parsed, { messageKeys: ['msg'] })) findings.push({ ...f, path: `line ${index + 1}: ${f.path}` });
  });
  return findings;
}
