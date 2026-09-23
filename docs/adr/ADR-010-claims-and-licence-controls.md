# ADR-010 — Claims linter, substantiation file and licence controls

- Status: Accepted (M20)
- Date: 2026-09-23
- Deciders: M20 engineer; claims review by counsel pending; licence policy owner seat B3

## Context

L1: no copy anywhere may claim to diagnose, treat, cure or prevent disease or guarantee results; the M20 spec asks for a linter over i18n catalogues, store metadata, AI-coach prompts and marketing copy (and AI eval outputs) with FR/EN denylists and a substantiation file. L6: every dependency, asset and dataset needs a commercial-compatible licence; M00 already had `pnpm licences:check`. L7: the codename must not reach public surfaces.

## Decision

- **Deny rules** are literal regular expressions in `packages/legal/src/claims.ts` (Unicode-aware boundaries, bounded quantifiers, safe-regex clean), per language and category (medical, results, fat loss). They are deliberately broad (e.g. any "treat", any "guarantee"). French rules that collide with privacy vocabulary ("traitement des données") only match with a medical noun nearby.
- **Substantiation file** is a Markdown table (`docs/legal/substantiation-file.md`) that counsel can read and the linter parses. An entry masks its exact phrase before the rules run, only if it has evidence and the locale matches. Disclaimers ("does not diagnose, treat, cure or prevent any disease") are entries too, so every allowed use of a forbidden word is a reviewed, exact phrase. Entries' counsel review stays `pending`; the linter refuses any other status that claims approval.
- **Scope of `pnpm legal:claims`**: both catalogues (every message), `store/metadata` (generated from `store.listing.*` i18n keys and checked in sync), `packages/legal/prompts`, `apps/api/src/ai-coach/prompts`, `marketing/`, plus `--file` for eval outputs. The same command checks the codename in `store/`, public asset folders, the Expo app identity and user-facing strings.
- **One licence engine and policy.** `tooling/legal/lib/licences.mjs` with `tooling/legal/licence-policy.json` (the M00 allowlist and exceptions, moved unchanged). `pnpm licences:check` runs its dependency part; `pnpm legal:licences` adds a CycloneDX 1.5 SBOM (`reports/legal/sbom.cdx.json`, CI artifact) and validates `docs/legal/asset-licence-register.md` against the files in the scanned asset folders.
- CI job "Legal gates" runs `legal:claims`, `legal:licences`, `legal:docs`.

## Alternatives considered

- **An NLP or LLM classifier**: catches paraphrases, but is non-deterministic and hard to audit; could be added later on top of the rules.
- **Inline suppression comments in catalogues**: scattered and easy to add without review; the substantiation file centralises every exception for counsel.
- **Third-party SBOM tools (e.g. CycloneDX CLI)**: another dependency with its own licence review; `pnpm licenses list` already has the data.

## Consequences

- Broad rules cost rewording (the linter already caught "treats your screening as…" in a consent text). A paraphrase that avoids every rule is not caught: counsel's copy review remains necessary.
- Store copy can only change through i18n (then `pnpm legal:store --write`).
- New asset folders must be added to the policy's `scannedDirectories`.
