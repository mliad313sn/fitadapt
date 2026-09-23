# M06 — Exercise Library & Knowledge Graph

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 1 (first) | M00 |

## Purpose
The single, reviewed, versioned source of truth for exercises, variants, substitutions, equipment and joint-load profiles.

## Why (committee review)
Élise and Raj: every original module references exercises but none owns them. Léa: progressions are a graph, not a list. Thomas: substitution must understand joint load, not only muscles.

## Scope
- Launch target ≥ 250 exercises (MVP seed 120) with: movement pattern, primary/secondary muscles, equipment tags, joint-load profile (shoulder, elbow, wrist, lumbar, hip, knee, ankle: low/medium/high), impact level, skill level, %BW coefficient for bodyweight moves, unilateral flag, cues, common mistakes, contraindication tags.
- Typed edges: PROGRESSES_TO, REGRESSES_TO, SUBSTITUTES (stimulus similarity 0–1), REQUIRES (equipment).
- Media: short loops or animations cached offline in packs per equipment profile; low-bandwidth mode.
- Search, filters, favourites and user-defined custom exercises.
- Content workflow in the admin CMS (M18) with two-person approval (coach + physio) and versioning.

## Rules
- Substitution chooses the highest-similarity exercise that satisfies equipment, joint flags and SafetyProfile.
- No exercise is published without a physio-review flag; seed content is marked validated:false.
- Progression chains are acyclic.
- L6: every media asset records licence, source and rights holder; unlicensed assets cannot be published; exercise names avoid third-party trademarks.

## Core data entities
Exercise, ExerciseEdge, Equipment, Muscle, MediaAsset, ContentVersion

## Acceptance criteria
- Schema validation passes for the seed; graph integrity tests pass.
- Substitution queries are fast enough for on-device use.

## KPIs
- Share of swaps accepted
- Coverage: exercises with a valid substitute per equipment profile

## Out of scope
- Producing final video content (placeholders only)
