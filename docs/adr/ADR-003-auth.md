# ADR-003 — Authentication

- Status: Accepted (M00)
- Date: 2026-09-23

## Context

M00 needs sign-up and sign-in by email one-time code, plus Sign in with Apple and Google (App Store Review Guideline 4.8 expects a privacy-focused login option such as Sign in with Apple when third-party social logins are offered). Sessions must survive offline use (training never needs the network) but be revocable. The spec asks for a short-lived access token and a rotating refresh token, and for the library choice to be recorded here. No personal data may reach logs (rule 7).

## Decision

**Own a small implementation on vetted primitives** rather than adopting an auth framework:

- **jose** (MIT) signs and verifies access tokens: JWT, HS256, 15 minutes, claims `sub` (user), `sid` (session), `did` (device), fixed `iss`/`aud`. Verification also checks that the session is not revoked, so logout takes effect immediately.
- **Node `crypto`** for everything else: `randomInt` for the 6-digit code, 256-bit random refresh tokens, HMAC-SHA-256 with a server-side pepper (`AUTH_TOKEN_PEPPER`) for every stored secret, and `timingSafeEqual` for comparisons.

**One-time code flow**

1. `POST /v1/auth/otp/request {email, locale}` → `202`. Previous unused codes for the address are invalidated. The code is valid for 10 minutes and is handed to an injected `Mailer`. It is never logged, never returned by the API, and stored only as `HMAC(pepper, codeId, code)`. The email is stored in `otp_codes` only as a keyed hash.
2. `POST /v1/auth/otp/verify {email, code, device}` → tokens. After 5 wrong attempts the code is dead. On the first successful verification the account is created (`isNewUser: true`); afterwards the same call signs in. Each sign-in creates one **session**, which is one refresh-token family, for that device.
3. Rate limits in Redis (fixed windows of 15 minutes): 5 code requests per email, 20 per IP, 10 verifications per email. Redis keys contain only keyed hashes.

**Refresh-token rotation with reuse detection**

- `POST /v1/auth/refresh` marks the presented token used and issues a new pair in the same family (30-day refresh lifetime). The token row is locked (`SELECT … FOR UPDATE`) during rotation.
- Presenting a token that was **already rotated** is treated as theft: the request fails with `auth.refresh_token_reused` and the **whole family is revoked**, so the attacker's and the victim's newest tokens both stop working. The user signs in again.
- `POST /v1/auth/logout {refreshToken}` revokes the family. It is idempotent.
- Two concurrent refreshes with the same token count as reuse. That is strict; a grace window can be added if real clients hit it.

**Sign in with Apple / Google** — `POST /v1/auth/federated {provider, idToken, device}` exists, and so does the `IdentityProviderVerifier` interface. The only implementation today, `NotConfiguredIdentityVerifier`, answers `501 auth.provider_not_configured`. A real verifier must check the ID token's signature against the provider's JWKS, plus `iss`, `aud` (our client ids), `exp` and nonce. It then links a `user_identities(provider, subject)` row, and links to an existing account only through a verified email. That work needs Apple/Google developer credentials, which do not exist yet.

**Errors** are stable codes (`auth.invalid_code`, `auth.rate_limited`, `auth.invalid_refresh_token`, `auth.refresh_token_reused`, `auth.unauthorized`, `auth.provider_not_configured`). The app maps them to FR/EN copy in `packages/i18n`. Validation errors never echo input.

**Parameters** (TTLs, attempts, limits) live in `apps/api/src/config/auth.config.ts` with `source` pointing at this ADR and `validated: false`. They are engineering defaults awaiting M17 security review.

## Alternatives considered

- **Hosted identity (Auth0, Clerk, Supabase Auth, Firebase Auth, Cognito)**: less code and built-in social login, but a vendor processing emails of users in the EU and Senegal (transfer and filing questions for M17/L9), recurring cost, and weaker offline control. Can be revisited before launch.
- **Lucia / Better Auth / Auth.js**: Lucia is deprecated as a library. Auth.js targets web frameworks. Better Auth would fit, but brings its own schema and plugin surface for what is about 400 lines here.
- **Opaque access tokens with a lookup on every request**: simpler revocation, but no offline validity and more database load. We keep JWTs short and also check the session.
- **Magic links** instead of codes: links break across devices (email on a laptop, app on a phone), and a code is easier to type in a gym.

## Consequences

- We own security-critical code. It is covered by integration tests on real PostgreSQL and Redis: sign-up, sign-in, wrong, expired and superseded codes, attempt lockout, rate limits, rotation, reuse revoking the family, expiry, logout and log hygiene. M17 reviews it (threat model, key rotation, pepper management).
- `AUTH_JWT_SECRET` and `AUTH_TOKEN_PEPPER` must be real secrets per environment. `.env.example` holds development-only values.
- No mail provider is chosen. The server refuses to start with `NODE_ENV=production` until one is. Email wording will come from `packages/i18n`, and any legal footer from `packages/legal` (M20).
- On the device, refresh tokens must be kept in the OS keystore (expo-secure-store) when the sign-in screens arrive (M01).
