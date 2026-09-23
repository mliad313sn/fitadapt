# M15 — Coach Portal (B2B)

| Status | Phase | Depends on |
|---|---|---|
| New | Phase 3 | M00, M02, M05, M08, M16, M17 |

## Purpose
A web workspace for personal trainers and gyms to program, monitor and message clients — with human oversight built on the same engine.

## Why (committee review)
Sam: B2B is a second revenue line and a distribution channel. Karim: coaches need to see pain flags and adherence, not only logs. Dr. Amina: coaches must not override safety caps.

## Scope
- Next.js web app: client roster, program assignment and editing through the engine, log and pain-flag review, adherence views, messaging, templates.
- Client invitations and consent to share data with a coach.
- Roles and permissions (owner, coach, assistant); audit log.
- Coach plans and billing via M16.

## Rules
- Coaches adjust within SafetyProfile caps; they can request a client re-screen but not lift caps.
- Clients choose what a coach can see and can revoke access at any time.
- L10: coaches accept the Coach Agreement and upload credentials before accessing clients; verification status is shown to clients; the platform states that coaches are independent professionals.

## Core data entities
Organisation, Coach, ClientLink, SharedScope, Message, AuditEntry

## Acceptance criteria
- RBAC tests; engine validation on coach edits; Playwright E2E for core flows.

## KPIs
- Paying coach accounts
- Clients per coach
- Coach-assigned program adherence

## Out of scope
- Marketplace discovery of coaches (v2)
