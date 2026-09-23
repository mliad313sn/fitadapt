# M00 — Platform Foundation & Design System

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 0 | — |

## Purpose
The rails every module runs on: monorepo, tooling, CI/CD, design system, internationalisation, authentication skeleton, local-first data layer and observability.

## Why (committee review)
Raj: the original stack table listed alternatives without deciding, and offline execution demands a local-first data layer from day one. Élise: bilingual FR/EN, accessibility and low-end Android performance are foundations, not features added later.

## Scope
- pnpm + Turborepo monorepo: apps/mobile (Expo React Native, expo-router), apps/api (Fastify + zod + OpenAPI), apps/coach-web (Next.js stub), packages/engine (pure TypeScript), packages/shared (types, zod schemas), packages/ui (design tokens + components), packages/i18n, packages/sync, packages/safety.
- Local-first data: expo-sqlite + Drizzle ORM on device; outbox pattern with revision-based pull/push to PostgreSQL; workout set logs are append-only so they never conflict.
- Authentication: email one-time code plus Sign in with Apple / Google; short-lived access token and rotating refresh token; library choice recorded in ADR-003.
- Design system: tokens (colour, type, spacing, radius), light/dark themes, 'gym mode' with large touch targets (≥ 56 dp) and glanceable numbers, WCAG 2.2 AA contrast.
- Internationalisation: FR/EN catalogues with ICU plurals from the first screen; metric/imperial units.
- CI/CD: GitHub Actions (typecheck, lint, test, build); EAS Build profiles dev/preview/production; docker compose for API + PostgreSQL + Redis.
- Observability: crash and performance monitoring (e.g., Sentry), structured logs with no personal or health data, OpenTelemetry traces on the API.

## Rules
- TypeScript strict mode everywhere; zod validation at every process boundary (API, sync, storage).
- No user-facing string outside i18n catalogues (enforced by a lint rule).
- Performance budget: cold start < 2.5 s on a reference low-end Android device (≈ 3 GB RAM class).
- All workout features work offline; only authentication and sync need the network.
- Legal texts are loaded per locale and jurisdiction from packages/legal (created by M20); the app never hard-codes legal wording.

## Core data entities
User, Device, Session (auth), SyncCursor, OutboxItem

## Acceptance criteria
- Fresh clone → install → dev runs the mobile app and API with PostgreSQL and Redis via docker compose.
- Sign-up and sign-in by one-time code work end to end (API integration tests).
- A record created offline is queued and synced on reconnect; duplicate pushes are idempotent.
- Switching FR/EN changes every visible string; the lint rule blocks hard-coded strings.

## KPIs
- CI duration < 10 min
- Cold start within budget
- Crash-free sessions ≥ 99.5% (from first beta)

## Out of scope
- Any fitness feature
- Production infrastructure-as-code (deferred to M19)
