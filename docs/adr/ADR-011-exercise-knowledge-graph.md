# ADR-011 — Exercise knowledge graph, substitution and offline library

- Status: Accepted (M06)
- Date: 2026-09-23
- Deciders: M06 engineer; content and coefficients pending review by seats A2 (physiotherapist) and A3 (S&C coach)

## Context

M06 must be the single, reviewed, versioned source of exercises, variants, substitutions, equipment and joint-load profiles (decision C6). M02 needs movement-pattern slots and variant ladders, M05 needs joint-load profiles for the S2 pain gate, M09 needs relative-effort data (ladder rank, %-bodyweight), M01 needs an equipment taxonomy for per-location profiles, and the app must work offline. CLAUDE.md requires wording in `packages/i18n`, prescriptions only from the engine, and `source`/`validated` on every coefficient.

## Decision

- **Contracts in `packages/shared`** (`exercise.ts`): `Exercise`, `ExerciseEdge` (discriminated on `PROGRESSES_TO`, `REGRESSES_TO`, `SUBSTITUTES` with similarity 0–1, `REQUIRES` with a requirement group), `Equipment`, `Muscle`, `MediaAsset`, `PublishedMediaAsset`, `ContentVersion`, `CustomExercise`, plus the inputs substitution needs: `JointFlags` (M05 traffic light) and a minimal `SafetyProfile` (M01 owns the screening that fills it). The joint-load profile is a strict object with all seven joints, so a missing rating cannot pass the pain gate. `validated: true` needs `validatedBy`, `signOff` and the physio review; `approved` needs both reviews.
- **Wording in `packages/i18n`** (`catalogues/exercises/*.ts`, FR and EN side by side, flattened to `exercise.<id>.name|cue.<n>|mistake.<n>`). Exercises reference keys. The claims linter and the FR/EN parity tests therefore cover all exercise text.
- **Structure in a new package `packages/exercise-library`**: the seed (152 exercises), ladders, the equipment taxonomy and presets (bodyweight-only, home-basic, full-gym, park, travel), graph integrity checks, in-memory search, the L6 media publishing gate, the content workflow and a production release guard. The seed is data with a compact authoring helper; it is validated against the schema when the module loads.
- **Edges are derived, not hand-listed.** Ladders (ordered steps, branches allowed) generate each `PROGRESSES_TO` and its `REGRESSES_TO`; `REQUIRES` edges come from the exercise's equipment groups; `SUBSTITUTES` edges come from a stimulus-similarity model (pattern, primary and all muscles, laterality, skill) whose weights and threshold are config values (`validated: false`). Cross-pattern substitutes are allowed only among strength patterns; balance, mobility and locomotion substitute within their own pattern.
- **Substitution lives in `packages/engine`** (`substitution.ts`), pure and deterministic over a graph passed in: it returns the highest-scoring valid `SUBSTITUTES` neighbour, where valid means every equipment group satisfied, no red joint loaded at medium or high (S2), impact within the SafetyProfile ceiling, no avoided movement tag, not excluded by the user, and at most one skill level above the original. Amber joints lower the score. It returns reason codes (FR/EN in i18n) and an S2 `safety.event` payload for the defensibility log. These are hard filters: nothing configures them away. `packages/exercise-library` binds it to the seed as `substitute(exercise, equipment, jointFlags, safetyProfile)`.
- **Offline on device**: `apps/mobile/src/library/library-store.ts` installs the bundled library into the on-device SQLite database (exercises, muscles, requirements, edges, per-locale normalised names) on start, and reinstalls only when the library content hash changes. Search and filters run in SQL; favourites and custom exercises are device-local user data, kept across content refreshes and removed by the account wipe.
- **Review and publishing**: every seed entry is `validated: false`, `reviewStatus: 'pending'`, with the physio and coach review marks null. `publishContent` needs a physio (A2) and a coach (A3) approval by two different reviewers; each approval yields a `content.approved` defensibility payload. A production build (`apps/mobile/app.config.js`) refuses to ship any exercise without both reviews and validation.
- **Media (L6)**: no media ships. `publishMediaAsset` refuses an asset without a licence on the asset allowlist (kept equal to `tooling/legal/licence-policy.json` by a test), a source and a rights holder.

## Alternatives considered

- **A graph database or graph library**: unnecessary at this size (a few thousand edges); adjacency maps in TypeScript run on device and on server, with p95 well under 1 ms.
- **Hand-authored SUBSTITUTES edges with expert similarity scores**: better once the council exists, but thousands of pairs cannot be written or reviewed now; the model makes every edge reproducible and reviewable through a handful of weights. Expert overrides can later be added as explicit edges.
- **Text inside the exercise records**: simpler for a CMS, but breaks CLAUDE.md rule 5 and the claims linter's coverage. The M18 CMS will edit the i18n catalogues through the same review.
- **Bundle-only library (no SQLite)**: would work offline too, but the goal asks for SQLite, and SQLite gives the future CMS-delivered updates and user data (favourites, custom exercises) one home.

## Consequences

- Wording changes go through i18n (parity tests, claims lint) and bump the content hash, so devices refresh their copy.
- The seed's joint-load profiles, contraindication tags, ladders, skill levels, %-bodyweight coefficients and similarity weights are the author's classification and are not expert-validated; the release guard keeps them out of production until A2 and A3 sign off.
- Carries have no load-free equivalent, so bodyweight-only coverage is below 100% (98%).
- `SafetyProfile` is defined here with the fields substitution needs; M01 must extend, not fork, it.
