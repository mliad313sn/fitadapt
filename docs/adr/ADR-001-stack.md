# ADR-001 — Stack and repository layout

- Status: Accepted (M00)
- Date: 2026-09-23
- Deciders: M00 engineer; to be confirmed by the Product Owner at the first weekly review

## Context

The v2.1 committee review found that the original stack table listed alternatives without deciding (Raj), and that offline execution, bilingual FR/EN, accessibility and low-end Android performance must be foundations (Élise). One pure engine has to run on the device and on the server. Every dependency needs a licence that allows commercial use (L6).

## Decision

**Monorepo.** pnpm 10 workspaces + Turborepo 2. TypeScript 5.9 in `strict` mode everywhere (plus `noUncheckedIndexedAccess`). Root scripts `pnpm -w build|typecheck|lint|test` fan out through turbo; `^build` builds workspace dependencies first.

| Path | Role | Key choices |
|---|---|---|
| `apps/mobile` | Expo app | Expo SDK 57 (React Native 0.86.3, React 19.2.3, versions from Expo's `bundledNativeModules.json`), expo-router, expo-sqlite + Drizzle, Zustand, NetInfo |
| `apps/api` | HTTP API | Fastify 5, zod 4 with `fastify-type-provider-zod`, OpenAPI 3.1 via `@fastify/swagger`, Drizzle on PostgreSQL 16 (`pg`), Redis 7 via ioredis (rate limits, later queues, never timer state), jose for JWTs; M09: `ws` (MIT) for the multi-device Fair Pair WebSocket only (ADR-021) |
| `apps/coach-web` | Coach portal stub | Next.js 16 (App Router) |
| `packages/engine` | Pure deterministic engine | No I/O; injected `Clock` and seeded `Rng`, enforced by lint rules |
| `packages/safety` | S1–S7 skeleton | Frozen registry, fail-closed evaluator |
| `packages/shared` | Contracts | zod schemas and inferred types used at every process boundary |
| `packages/ui` | Design system | Tokens (light/dark), 8 components, gym mode |
| `packages/i18n` | FR/EN | ICU MessageFormat (`intl-messageformat`), units helpers, React provider |
| `packages/sync` | Local-first sync | See ADR-002 |
| `packages/food-library` | M10 food seed | Original, estimated food data (270 items, `validated: false`), offline search, the engine's estimates on the seed (ADR-022); asset register DATA-004 |
| `packages/coach` | M11 AI coach turn | Pure (no I/O, injected model, clock and seed): the deterministic safety pre-screen, the knowledge registry, the engine-only tools, the output guard; the same code on the server (with the Claude API through `@anthropic-ai/sdk`, MIT, in `apps/api` only) and on the device offline (ADR-031) |
| `tooling/eslint-plugin` | Repo lint rules | `no-hardcoded-jsx-strings` (CLAUDE.md rule 5) |

**Tests.** Vitest 5 for packages, API and the lint rule; Jest 29 + `jest-expo` + React Native Testing Library 13 for `packages/ui` and `apps/mobile`; fast-check for property tests. The API has a unit suite (`test`) and an integration suite (`test:integration`) against real PostgreSQL and Redis.

**pnpm with the hoisted node linker** (`nodeLinker: hoisted`). Metro, jest-expo and several React Native packages still assume a flat `node_modules`; hoisting also guarantees a single React copy shared by mobile, ui, i18n and Next.

**Fonts and assets.** System fonts only. No bundled font, image or sound of our own. expo-router ships Material Symbols (Apache-2.0) for its built-in error screens.

**Licence gate.** `pnpm licences:check` fails on any installed package outside a permissive allowlist unless it is a reviewed exception. Consequences of applying it in M00:
- `sharp` (LGPL-3.0 libvips binaries, an optional dependency of Next.js) is excluded with `ignoredOptionalDependencies`; the coach portal sets `images.unoptimized`.
- `@sentry/node` 11 is not installed: it depends on the `sentry` CLI under FSL-1.1, which is source-available, not open source. The API loads the SDK only if it is installed and `SENTRY_DSN` is set.
- Reviewed exceptions: `lightningcss` (MPL-2.0, used unmodified by build tools) and `caniuse-lite` (CC-BY-4.0 data).

**TanStack Query** stays in the target stack but is not installed until a screen fetches server data (no such screen in M00).

## Alternatives considered

- **Nx / plain pnpm scripts** instead of Turborepo: Nx is heavier than we need; plain scripts lack caching and dependency-ordered pipelines.
- **pnpm isolated linker** (the default): cleaner dependency hygiene, but needs Metro and Jest resolver workarounds for React Native today. We can revisit when Expo's isolated-install support covers all our tools.
- **TypeScript 7 (native compiler)** or 6.0: TypeScript 7 is the current `latest`, but typescript-eslint 8.70 supports `<6.1`, and Expo/Next tooling is validated on 5.x. We stay on 5.9 until the lint toolchain supports 7.
- **NestJS / Express** for the API: Fastify has first-class schema validation and serialisation, lower overhead, and a mature zod type provider.
- **Prisma** instead of Drizzle: Drizzle runs on both expo-sqlite and PostgreSQL with one API and no binary engine on the device.
- **WatermelonDB / RxDB / PowerSync** for local-first data: see ADR-002.

## Consequences

- One `pnpm install` sets up every app and package; `pnpm -w build` builds them in dependency order.
- Packages publish compiled `dist/` (ESM); consumers need a build first (turbo does this; `test:integration` builds the API's dependencies itself).
- Hoisting lets a package import something it did not declare. Reviewers check `package.json` when a new import appears.
- Upgrading Expo means taking React/React Native versions from Expo's bundled list, never independently.
- Error reporting is off until someone completes a licence review of the Sentry SDK (or picks another provider).
