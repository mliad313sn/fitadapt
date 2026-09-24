# Substantiation file (L1)

> **DRAFT — requires counsel review.** The evidence behind every marketing and in-app claim, and the exact disclaimers the claims linter allows. `pnpm legal:claims` fails on any deny-rule hit (FR/EN: diagnose, treat, cure, prevent disease, guaranteed results, burn fat fast, lose N kg in N days, and French equivalents) **unless the matching phrase is listed below with evidence**. An entry does not make a claim lawful: counsel reviews each one (`Counsel review` stays `pending` until counsel signs; engineering never changes it). Claims marked "not yet built" must not be published before the evidence exists.

| ID | Phrase | Locale | Kind | Evidence | Scope | Counsel review |
|---|---|---|---|---|---|---|
| SUB-D1 | "does not diagnose, treat, cure or prevent any disease" | en | disclaimer | Wellness positioning required by L1 (docs/specs/00-legal-framework.md); negative statement, no claim | Terms of Use, AI coach notice | pending |
| SUB-D2 | "we do not guarantee any particular result" | en | disclaimer | L1 forbids guaranteed results; negative statement | Terms of Use | pending |
| SUB-D3 | "ne pose pas de diagnostic et ne traite, ne guérit ni ne prévient aucune maladie" | fr | disclaimer | Positionnement bien-être exigé par L1 ; énoncé négatif | Conditions d'utilisation, notice du coach IA | pending |
| SUB-D4 | "nous ne garantissons aucun résultat particulier" | fr | disclaimer | L1 interdit les résultats garantis ; énoncé négatif | Conditions d'utilisation | pending |
| SUB-D5 | "estimate, not a guarantee" | en | disclaimer | L1 forbids guaranteed results; M04 labels every milestone forecast with this negative statement (component test `apps/mobile/__tests__/progress.test.tsx`, docs/status/M04.md) | Progress dashboard: milestone forecasts | pending |
| SUB-D6 | "estimation, pas une garantie" | fr | disclaimer | L1 interdit les résultats garantis ; M04 affiche cet énoncé négatif sur chaque estimation d'étape (même test) | Tableau de progression : estimations d'étapes | pending |
| SUB-D7 | "do not offer medical, rehabilitation or medical-nutrition advice" | en | disclaimer | Negative statement bounding the AI coach (L3, S6); flagged by the FIX-B rule en.rehab (B pre-review §3.6), allowed only as this exact refusal | AI-coach legal preamble (packages/legal/prompts) | pending |
| SUB-C1 | "Sessions work offline" | en | claim | Offline outbox and sync tests: packages/sync, apps/mobile (M00 goal condition 3, docs/status/M00.md) | Store listing, home screen | pending |
| SUB-C2 | "Les séances fonctionnent hors ligne" | fr | claim | Same evidence as SUB-C1 | Store listing | pending |
| SUB-C3 | "Every recommendation explains itself" | en | claim | Not yet built: reason codes with FR/EN explanations (CLAUDE.md rule 3, M02). Do not publish before M02 evidence exists | Store listing | pending |
| SUB-C4 | "Chaque recommandation s'explique" | fr | claim | Same as SUB-C3 (not yet built) | Store listing | pending |
| SUB-C5 | "Train alone or with a partner of a different level on the same phone" | en | claim | Not yet built: Fair Pair single-device mode (M09). Do not publish before M09 evidence exists | Store listing | pending |
| SUB-C6 | "Entraînez-vous seul ou avec un partenaire d'un autre niveau sur le même téléphone" | fr | claim | Same as SUB-C5 (not yet built) | Store listing | pending |
| SUB-C7 | "No video leaves your device" | en | claim | Not yet built: on-device motion sensing (M14). Evidence needed: network test of camera mode | Camera notice | pending |
| SUB-C8 | "Aucune vidéo ne quitte votre appareil" | fr | claim | Same as SUB-C7 (not yet built) | Notice caméra | pending |
