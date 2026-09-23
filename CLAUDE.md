# CLAUDE.md — FitAdapt

## What we are building
FitAdapt is a bilingual (FR/EN), offline-first training companion that turns one person's — or two partners' — goals, equipment and daily readiness into a safe, explainable session, and gets smarter with every logged set.
Specs live in docs/specs (start with 00-product-vision.md). Each module has its own spec; work on one module per branch.

## Stack (ADR-001)
- pnpm + Turborepo monorepo, TypeScript strict everywhere.
- apps/mobile: Expo (React Native), expo-router, expo-sqlite + Drizzle (local-first), Zustand, TanStack Query.
- apps/api: Fastify, zod, OpenAPI, PostgreSQL (Drizzle), Redis (queues, rate limits — never timer state), WebSocket only for multi-device Fair Pair.
- apps/coach-web: Next.js (coach portal + admin CMS).
- packages/engine: pure, deterministic TypeScript used on device and server. No I/O, no network, injected clock and seed.
- packages/shared (zod schemas + types), packages/ui (design system), packages/i18n (FR/EN), packages/sync, packages/safety, packages/integrations, packages/motion.
- Tests: Vitest (packages, api), Jest + React Native Testing Library (mobile), fast-check (property tests), Maestro (mobile E2E), Playwright (web E2E).

## Commands
- pnpm install · pnpm dev · pnpm -w typecheck · pnpm -w lint · pnpm -w test
- pnpm --filter api test:integration (needs docker compose up -d)
- pnpm --filter api eval (AI coach evals, M11)
- pnpm launch:check (M19)

## Non-negotiable rules
1. Safety invariants S1–S7 (docs/specs/00-product-vision.md) are enforced in packages/engine and packages/safety and covered by property tests. Never weaken them, never make them configurable.
2. The engine is the only source of training prescriptions. UI, coach portal and AI coach go through engine APIs.
3. Every prescription carries reason codes with FR and EN explanations.
4. Every numeric coefficient or threshold lives in a config file with `source` and `validated` fields. Never invent a source; if unsure, set validated:false and list it in the module status file. Never change validated:false to true yourself: that needs a council sign-off record, and the PR must add `validatedBy` (seat) and `signOff` (record file) beside it (docs/governance/03-expert-advisory-council.md §5).
5. No user-facing string outside packages/i18n; FR and EN must both exist.
6. Offline first: workout features must work in airplane mode.
7. No personal or health data in logs or analytics. Progress photos stay encrypted on device unless backup is enabled.
8. Copy: no diagnosis, no medical claims, no 'fat-burning zone', no body-shaming, no guilt messaging.
9. Accessibility: labels on all interactive elements, touch targets ≥ 48 dp (56 dp in gym mode), WCAG 2.2 AA contrast.

## Legal rules (L1–L12, docs/specs/00-legal-framework.md)
1. No copy — UI, store, AI prompts, marketing — may claim to diagnose, treat, cure or prevent disease or guarantee results. Run 'pnpm legal:claims'.
2. Never bypass recorded acceptance (Terms, Privacy, health consent, exercise-risk acknowledgment) or point-of-risk notices.
3. The AI coach always discloses it is an AI and never claims to be a human or licensed professional.
4. Only add assets, fonts, sounds, datasets or dependencies with a recorded commercial-compatible licence. Run 'pnpm legal:licences'.
5. Legal texts are drafts marked 'requires counsel review'; never mark anything counsel-approved.
6. Write safety events, acceptances, notices and engine versions to the defensibility log.
7. 'FitAdapt' is a codename: never place it in store metadata or public assets.
8. Use fictional data only in fixtures; never real people's names, photos or voices.

## Definition of done (every module)
- Acceptance criteria of the module spec met and demonstrated with command output.
- typecheck, lint, test green; coverage ≥ 95% lines in packages/engine and packages/safety, ≥ 80% elsewhere.
- docs/status/<MODULE>.md updated; ADRs written for significant decisions.
- No deleted, skipped or loosened tests.

## Governance
Product Owner, team, Expert Advisory Council and the Meridian operating model: docs/governance/. Delivery is tracked on Meridian (pmo/meridian/); friction with Meridian is logged in pmo/meridian/dogfood-log.md and contributed upstream.

## Conventions
Conventional commits; small PRs per module; zod at boundaries; append-only set logs; metric internally, display units per user preference.
