# FitAdapt — /goal development pack

This pack turns the committee-reviewed, legal-hardened specification (v2.1) into a sequence of Claude Code `/goal` runs, from empty repository to a launch-ready product.

## Contents
- CLAUDE.md — project rules Claude Code reads automatically.
- docs/specs/00-product-vision.md — vision, principles, safety invariants S1–S7, personas, KPIs, references.
- docs/specs/00-legal-framework.md — legal invariants L1–L12, Gate 0, risk register, jurisdiction matrix, legal documents.
- docs/specs/M00…M20 — one detailed spec per module.
- goals/*.goal.txt — one ready-to-paste /goal per module (each under the 4,000-character limit, with a turn cap).
- GOALS.md — execution order and human validation gates.

## How to run
1. Create an empty git repository and copy CLAUDE.md, docs/ and GOALS.md into it.
2. Open Claude Code in the repository and accept the workspace-trust prompt (/goal relies on hooks; it is unavailable if hooks are disabled by settings).
3. Create a branch for the first module in GOALS.md and paste the matching goals/*.goal.txt content.
4. When the goal completes (or stops at its turn cap), review docs/status/<MODULE>.md, open a PR, review and merge. Re-running the same goal continues from the status file.
5. Stop at each Gate in GOALS.md for human and expert review before continuing.

## Why the goals look like this
A /goal is a completion condition checked by a separate evaluator, so each one lists verifiable conditions (tests, files, command output) rather than instructions. The detailed "what to build" lives in docs/specs, which keeps every goal short enough for the limit.

## Legal
Version 2.1 adds legal invariants L1–L12 (docs/specs/00-legal-framework.md), module M20 and Gate 0. Complete Gate 0 (company, IP, employment check, counsel, name clearance, insurance) before any public beta. These files are engineering mechanisms and drafts, not legal advice: have counsel review every legal text and the jurisdiction matrix.

## Important
The expert committee is a simulated panel. Items marked validated:false (coefficients, screening wording, food data, pain thresholds) must be signed off by qualified professionals before public launch (decision C10).
