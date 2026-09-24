# ADR-007 — Security gates in CI and telemetry hygiene

- Status: Accepted (M17 baseline)
- Date: 2026-09-23
- Deciders: M17 engineer (PE-11 role)

## Context

Security must be tested, not asserted (M17 spec). CI has to run dependency audit, secret scanning and static analysis and fail on high or critical findings. Separately, no personal or health data may reach logs or analytics (CLAUDE.md rule 7); M00 already kept request logs to route and status and redacted known keys, but anything logged explicitly, interpolated into a message or bound to a child logger could still leak.

## Decision

### Telemetry hygiene

- **Scrubber** (`packages/privacy/src/scrubber.ts`): detects personal data by **key** (e.g. `email`, `firstName`, `weightKg`, `painScore`, `note`, `token`) and by **value** (email addresses, weights with a unit, pain wording or "n/10", capitalised full names, sentences of three or more words, bearer tokens and JWTs, international phone numbers, IPv4 addresses). *Widened by FIX-packages-tooling (PKG-04):* any key ending in `name`/`nom`/`prénom` except an allowlist of technical keys; hyphenated, apostrophe, inner-capital, all-capitals and punctuated names, and runs of two or more such names inside sentences and the pino `msg`; `%40`, fullwidth-`@` and internationalised emails; French national phone numbers; IPv6; `sk-`, GitHub, Slack and AWS key prefixes. All patterns are linear-time on hostile input (no nested quantifiers; emails found from each "@" within RFC 5321 limits); a test bounds the time on 50k-character inputs.
- **Wired into the API logger** at every entry point: pino `formatters.log` (each record), `formatters.bindings` and `onChild` (child-logger bindings, which pino otherwise never formats), and `hooks.logMethod` (the message keeps its developer text with embedded data redacted; printf arguments get the strict check; `log.error(err)` no longer turns the error message into the log message). Errors are logged as type and machine code only. M00's redaction paths stay as a second layer.
- **Detector in tests**: `findPersonalDataInLogLines` scans captured log output. The API unit test logs every category through the real logger; a control test shows the detector catches them without the scrubber; an integration test runs a full privacy journey at trace level. Any finding fails the test.
- **Analytics allowlist** (`packages/privacy/src/analytics.ts`): strict schemas per event, properties only enums, booleans or bucketed counts; unknown events or properties are rejected, not stripped; a personal-data scan runs as a second check. Events carry no user or device id. Sending requires the `analytics` consent on the device and on the server (ADR-004).

### CI gates (job *Security scans and compliance documents*, on every pull request, on `main` and weekly)

| Gate | Tool | Fails on |
|---|---|---|
| `pnpm security:audit` | `pnpm audit` via `tooling/security/scripts/audit-gate.mjs` | any high or critical advisory; also when the audit cannot run (fails closed) |
| `pnpm security:secrets` | gitleaks 8.28.0 (MIT), downloaded at a pinned version and verified by SHA-256, over the **full history** (`fetch-depth: 0`) | any finding; reviewed false positives only via fingerprints in `.gitleaksignore`, each with a reason |
| `pnpm security:sast` | ESLint with `eslint-plugin-security` (Apache-2.0) and core rules against code injection, raw HTML injection | any finding: every rule is an error; a finding is accepted only by an inline suppression with a written reason |
| `pnpm compliance:check` | `tooling/security/scripts/compliance-check.mjs` | missing compliance documents or incomplete records (ADR-005, goal conditions 5 and 7) |

Dependabot opens weekly update pull requests for npm packages and GitHub Actions; they pass the same gates and the licence gate.

SAST scope is shipped code and build scripts. Tests and test-runner configs are excluded: they never run in production and legitimately build regexes and read fixture paths.

## Alternatives considered

- **CodeQL**: strong semantic analysis and free for public repositories; private repositories need GitHub Advanced Security, which we cannot assume. Can be added as a second SAST layer if the repository is public or the licence is bought.
- **Semgrep**: the engine is LGPL-2.1 and the registry rules come under their own rules licence with use restrictions; needs review by seat B3 before adoption.
- **gitleaks GitHub Action**: requires a licence key for organisation accounts; running the MIT binary directly avoids it and works locally the same way.
- **trufflehog**: AGPL-3.0; avoided under the permissive-only policy (L6) even for tooling.
- **`npm audit` / Snyk / OSV-Scanner**: `pnpm audit` reads our lockfile directly and needs no account; OSV-Scanner is a good addition later.
- **Scrubbing by allowlisted log fields only**: strongest, but brittle while modules are being built; the key+value scrubber plus failing tests catches mistakes without blocking development.

## Consequences

- A new log statement cannot leak an email, name, weight, pain report or sentence without a test failing, provided the flow is exercised by a test; the detector is heuristic: a name inside a sentence is caught when it is two or more capitalised words (PKG-04); a single first name inside a message ("sent to Jeanne") and an all-capitals name with a word under 4 letters are not.
- Some legitimate values are redacted (e.g. a capitalised two-word label). Prefer codes over sentences in logs.
- The high/critical threshold is the audit tool's severity, not a number we chose.
- Local runs download gitleaks once into `node_modules/.cache/gitleaks`; `GITLEAKS_BIN` can point at a verified binary instead.
