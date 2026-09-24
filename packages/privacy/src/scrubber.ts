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
 * Detection is by key name (e.g. `email`, `weightKg`, `painScore`, `note`,
 * any key ending in `name`) and by value pattern (email addresses, also
 * percent-encoded or with an internationalised domain; weights with a unit;
 * pain wording or "n/10" scores; capitalised full names, also hyphenated,
 * with an apostrophe, in capitals or followed by punctuation, and runs of
 * such names inside sentences and developer messages; free-text sentences;
 * bearer tokens, JWTs and common API key prefixes; phone numbers in
 * international or French national format; IPv4 and IPv6 addresses).
 * PKG-04 widened each of these.
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
  // PKG-04: any key ending in name / nom / prénom (ownerName, partnerName, guest_nom…); technical names are allowlisted below.
  [/(?:name|nom|prenom|prénom)$/i, 'name'],
  [/weight|body[-_]?mass|\bbmi\b|^bmi|kilos?$|kg$|lbs?$|pounds|poids/i, 'weight'],
  [/pain|symptom|injur|douleur|blessure/i, 'pain'],
  [/note|comment|message|free[-_]?text|description|reply|prompt|answer|feedback|^bio$|^text$|^content$|^body$|transcript/i, 'free_text'],
  [/token|secret|password|passwd|authorization|cookie|pepper|^otp$|^code$|api[-_]?key|credential/i, 'secret'],
  [/phone|msisdn|telephone|téléphone/i, 'phone'],
  [/^ip$|ip[-_]?addr|remote[-_]?addr|^ips$/i, 'ip'],
];

/**
 * Keys that end in "name" but hold a technical identifier, never a person's
 * name. Compared in lower case without '-' and '_'. A device name ("Jeanne's
 * phone"), a display name or a user name is personal and is NOT listed.
 */
const TECHNICAL_NAME_KEYS: ReadonlySet<string> = new Set([
  'eventname',
  'routename',
  'screenname',
  'filename',
  'hostname',
  'pathname',
  'typename',
  'classname',
  'tablename',
  'columnname',
  'fieldname',
  'keyname',
  'metricname',
  'servicename',
  'appname',
  'packagename',
  'modulename',
  'functionname',
  'methodname',
  'rulename',
  'tagname',
  'queuename',
  'jobname',
  'stepname',
  'featurename',
  'flagname',
  'experimentname',
  'testname',
  'suitename',
  'exercisename',
  'templatename',
  'collectionname',
  'schemaname',
  'indexname',
  'constraintname',
  'channelname',
  'platformname',
  'osname',
  'browsername',
  'errorname',
  'buildname',
  'bundlename',
]);

// Every pattern below runs on untrusted input (log values, analytics props), so
// each has a star height of 1 (no nested quantifiers) to rule out catastrophic
// backtracking (ReDoS). Names and sentences are recognised by tokenising instead.
// Emails are found from each "@" outwards within the RFC 5321 length limits
// (local part ≤ 64, domain ≤ 255 characters), which keeps the scan linear.
const LOCAL_PART_MAX = 64;
const DOMAIN_MAX = 255;
// Letters and digits of any script: internationalised local parts and domains (PKG-04).
const LOCAL_CHAR = /[\p{L}\p{N}._%+-]/u;
const DOMAIN_AT_START = /^[\p{L}\p{N}-][\p{L}\p{N}.-]{0,252}\.\p{L}{2,24}/u;
/** "@", its fullwidth form, and "%40" (an address inside a URL or query string). */
const AT_SIGNS = /@|＠|%40/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Common API key and token prefixes: sk-… keys, GitHub tokens, Slack tokens, AWS access key ids. */
const KEY_PREFIX = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/g;
const WEIGHT = /\b\d{1,3}[.,]?\d{0,3}\s{0,3}(?:kgs?|kilos?|kilogrammes?|kilograms?|lbs?|pounds?|livres?)\b/gi;
const PHONE = /\+\d[\d\s.-]{7,18}\d\b/g;
/** French national format: 06 12 34 56 78, 06.12.34.56.78, 0612345678 (PKG-04). */
const PHONE_FR = /(?<![\d.-])0[1-9](?:[ .-]?\d\d)(?:[ .-]?\d\d)(?:[ .-]?\d\d)(?:[ .-]?\d\d)(?![\d-]|\.\d)/g;
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
/** IPv6 candidates (hex digits and colons); each one is confirmed by `isIpv6`. */
const IPV6_CANDIDATE = /(?<![\w:])[0-9A-Fa-f:]{2,39}(?![\w:])/g;
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;
const PAIN = /\b(?:pain|painful|hurts?|hurting|ache|aching|sore|douleurs?|douloureux|douloureuse|mal au|mal aux|mal à la|mal a la|mal à l'|mal au niveau)\b|\b(?:10|\d)\s?\/\s?10\b/i;
const WORD = /^\p{L}{2,}$/u;
const SEPARATORS = /[\s,;:!?.'’]+/u;

/** Name parts: "Jeanne", "O" (of O'Brien), "McDonald", all capitals ("TESTEUR"). */
const NAME_PART = /^\p{Lu}\p{Ll}*$/u;
const NAME_PART_INNER_CAPITAL = /^\p{Lu}\p{Ll}+\p{Lu}\p{Ll}+$/u;
const NAME_PART_CAPITALS = /^\p{Lu}{2,}$/u;
const NAME_TAIL = /^\p{Lu}?\p{Ll}+$/u;
const LEADING_PUNCTUATION = /^[("«“‘']+/u;
const TRAILING_PUNCTUATION = /[)"»”’',.;:!?]+$/u;
const ENDS_A_NAME = /[,.;:!?)]$/u;
const NAME_JOINERS = /[-'’]/u;
/** Same leading punctuation as LEADING_PUNCTUATION, then a capital: the one shape every name word has. */
const NAME_START = /^[("«“‘']*\p{Lu}/u;
const SIMPLE_NAME_WORD = /^\p{Lu}\p{Ll}+$/u;
const ANY_CAPITAL = /\p{Lu}/u;

/**
 * One capitalised name word, tokenised rather than matched by one nested
 * regex (ReDoS): hyphenated (Marie-Claire), with an apostrophe (O'Brien,
 * D’Artagnan), with an inner capital (McDonald), in capitals (TESTEUR,
 * MARIE-CLAIRE), with edge punctuation stripped ("Testeur," "(Jeanne").
 * A single all-capitals word alone (an acronym such as "GET") is not a name
 * word unless it is part of a run with another name word (see `nameRuns`).
 */
function nameWordKind(raw: string): 'word' | 'capitals' | null {
  // Every name word starts with a capital once leading punctuation is stripped: reject the rest cheaply.
  if (!NAME_START.test(raw)) return null;
  // The common case ("Jeanne"): one capital then lower case, no punctuation or joiner. Same answer as below, cheaper.
  if (SIMPLE_NAME_WORD.test(raw)) return 'word';
  const token = raw.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '');
  if (token.length < 2) return null;
  const parts = token.split(NAME_JOINERS);
  if (parts.length > 4 || parts.some((p) => p === '')) return null;
  if (parts.every((p) => NAME_PART_CAPITALS.test(p))) return 'capitals';
  const [first, ...rest] = parts as [string, ...string[]];
  if (!NAME_PART.test(first) && !NAME_PART_INNER_CAPITAL.test(first)) return null;
  if (rest.length === 0) return first.length >= 2 ? 'word' : null;
  return rest.every((p) => NAME_TAIL.test(p) || NAME_PART.test(p)) ? 'word' : null;
}

/**
 * A sequence of name words reads as a person's name unless it is made only of
 * all-capitals words and one of them is shorter than 4 letters: "JEANNE
 * TESTEUR" is a name, "HTTP GET" and "S3 BLOCK" are not.
 */
function plausibleName(words: readonly string[], known?: ReadonlyArray<'word' | 'capitals' | null>): boolean {
  if (words.length < 2) return false;
  const kinds = known ?? words.map(nameWordKind);
  if (kinds.some((k) => k === null)) return false;
  return kinds.some((k) => k === 'word') || words.every((w) => w.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '').length >= 4);
}

/** [start, end) ranges of runs of two or more name words in free text ("invite sent to Jeanne Testeur"), ending at punctuation. */
function nameRuns(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // No capital letter, no name word: skip the tokenisation.
  if (!ANY_CAPITAL.test(value)) return ranges;
  // Each word's kind is computed once and reused for the run (the scan stays linear and cheap on hostile input).
  let run: RegExpMatchArray[] = [];
  let kinds: Array<'word' | 'capitals'> = [];
  const close = () => {
    if (plausibleName(run.map((w) => w[0]), kinds)) {
      const last = run[run.length - 1]!;
      ranges.push([run[0]!.index!, last.index! + last[0].length]);
    }
    run = [];
    kinds = [];
  };
  for (const w of value.matchAll(/\S+/gu)) {
    const kind = nameWordKind(w[0]);
    if (kind === null) {
      close();
      continue;
    }
    run.push(w);
    kinds.push(kind);
    if (ENDS_A_NAME.test(w[0])) close();
  }
  close();
  return ranges;
}

/** [start, end) ranges of email addresses in `value`, around "@", "＠" or "%40". */
function emailRanges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const sign of value.matchAll(reset(AT_SIGNS))) {
    const at = sign.index;
    const after = at + sign[0].length;
    // The domain first: it fails at once on most hostile input, and the local-part scan is then skipped.
    const domain = DOMAIN_AT_START.exec(value.slice(after, after + DOMAIN_MAX));
    if (!domain) continue;
    let start = at;
    while (start > 0 && at - start < LOCAL_PART_MAX && LOCAL_CHAR.test(value.charAt(start - 1))) start -= 1;
    if (start < at) ranges.push([start, after + domain[0].length]);
  }
  return ranges;
}

/** An IPv6 address: 8 groups, or fewer around one "::"; each group 1–4 hex digits. Times ("12:30:45") have no "::" and 3 groups. */
function isIpv6(candidate: string): boolean {
  const compressed = candidate.indexOf('::');
  if (compressed !== candidate.lastIndexOf('::')) return false;
  const groups = candidate.split(':');
  if (compressed === -1) return groups.length === 8 && groups.every((g) => HEX_GROUP.test(g));
  const filled = groups.filter((g) => g !== '');
  return groups.length >= 3 && filled.length <= 7 && filled.every((g) => HEX_GROUP.test(g));
}

function ipv6Ranges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of value.matchAll(reset(IPV6_CANDIDATE))) if (isIpv6(m[0])) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function replaceRanges(value: string, ranges: Array<[number, number]>, replacement: string): string {
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out += value.slice(cursor, start) + replacement;
    cursor = end;
  }
  return out + value.slice(cursor);
}

/** Two to six name words and nothing else, e.g. "Jeanne Testeur", "Marie-Claire DUPONT,", "Siobhan O'Brien". */
function isFullName(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length <= 6 && plausibleName(parts);
}

/** Three or more consecutive words: a sentence someone typed rather than a code or an identifier. */
function isFreeText(value: string): boolean {
  let run = 0;
  for (const token of value.split(SEPARATORS)) {
    run = WORD.test(token) ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

function keyCategory(key: string): PersonalDataCategory | undefined {
  for (const [pattern, category] of KEY_RULES) {
    if (!pattern.test(key)) continue;
    if (category === 'name' && TECHNICAL_NAME_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))) continue;
    return category;
  }
  return undefined;
}

function reset(re: RegExp): RegExp {
  re.lastIndex = 0;
  return re;
}

/** Categories a single string value matches (value patterns only). */
export function valueCategories(value: string, options: { allowSentences?: boolean } = {}): PersonalDataCategory[] {
  const found = new Set<PersonalDataCategory>();
  if (emailRanges(value).length > 0) found.add('email');
  if (reset(JWT).test(value) || reset(BEARER).test(value) || reset(KEY_PREFIX).test(value)) found.add('secret');
  if (reset(WEIGHT).test(value)) found.add('weight');
  if (reset(PHONE).test(value) || reset(PHONE_FR).test(value)) found.add('phone');
  if (reset(IPV4).test(value) || ipv6Ranges(value).length > 0) found.add('ip');
  if (PAIN.test(value)) found.add('pain');
  if (!options.allowSentences) {
    if (isFullName(value)) found.add('name');
    else if (isFreeText(value)) found.add('free_text');
  }
  // Names inside a sentence or a developer message ("pair with Jeanne Testeur"), PKG-04.
  if (!found.has('name') && nameRuns(value).length > 0) found.add('name');
  return [...found];
}

/**
 * Redacts recognisable personal data inside a developer-written message
 * (e.g. a log message string). Sentences are allowed here: log messages are
 * constant text written by developers, but interpolated values (including a
 * run of capitalised names) are redacted.
 */
export function scrubText(text: string): string {
  let out = replaceRanges(text, emailRanges(text), REDACTED)
    .replace(reset(JWT), REDACTED)
    .replace(reset(BEARER), REDACTED)
    .replace(reset(KEY_PREFIX), REDACTED)
    .replace(reset(WEIGHT), REDACTED)
    .replace(reset(PHONE), REDACTED)
    .replace(reset(PHONE_FR), REDACTED)
    .replace(reset(IPV4), REDACTED);
  out = replaceRanges(out, ipv6Ranges(out), REDACTED);
  out = replaceRanges(out, nameRuns(out), REDACTED);
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
   * They are still checked for emails, weights, pain wording, phones, IPs,
   * tokens and runs of capitalised names, but not for sentence shape.
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
