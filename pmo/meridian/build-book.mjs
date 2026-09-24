#!/usr/bin/env node
/**
 * Builds the FitAdapt book for Meridian 5.36+ (https://github.com/mliad313sn/Meridian).
 *
 * The output, fitadapt-book.json, is the book as it stood when the v2.1
 * plan was written: the plan, the registers and the governance. It is in
 * the shape Meridian's whole-book import reads (POST /api/admin/import,
 * body { db: <book> }), and it is imported ONCE, by bootstrap.mjs, on an
 * empty instance. Everything that happened since — actual dates, progress,
 * evidence, references, human acts, the council backlog — is laid on top
 * by drive.mjs through the API, never by re-importing this file.
 *
 * Repo truth this file reads (and refuses to build if they disagree):
 *   - GOALS.md: the module order, which phase each module belongs to, and
 *     the text of Gate 0 … Gate 4 (the programme's gate ladder);
 *   - the v2.1 plan below (weeks, owners, dependencies): the plan exists
 *     only here, and bootstrap.mjs freezes it as the named baseline
 *     "v2.1 plan" before drive.mjs adds any actual.
 *
 * Rules this file keeps:
 *   - no real people: every person row is a role or an open council seat (L8, L12);
 *   - no invented money: budgets stay 0 until the sponsor baselines them at Gate 0;
 *   - risk scores are the Product Owner's opening scores, for the council to challenge;
 *   - nothing is approved, validated or counsel-approved here.
 *
 * Usage: node pmo/meridian/build-book.mjs [--start 2026-09-28] [--status 2026-09-23]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const START = arg("--start", "2026-09-28"); // Monday of programme week 1 (v2.1 plan)
const STATUS = arg("--status", "2026-09-23"); // the day the v2.1 plan was written

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const weekStart = (n) => iso(Date.parse(START) + (n - 1) * 7 * DAY); // Monday
const weekEnd = (n) => iso(Date.parse(START) + ((n - 1) * 7 + 4) * DAY); // Friday
const PLAN_WEEKS = 36;

/* ── GOALS.md: module order, phases and the gate ladder ─────────────── */

export function readGoals(text) {
  const modules = [];
  const gates = [];
  let phase = 0;
  for (const line of text.split("\n")) {
    const m = /^\d+\.\s+\*\*(M\d{2})\s+—\s+(.+?)\*\*/.exec(line);
    if (m) { modules.push({ id: m[1], name: m[2].trim(), phase }); continue; }
    const g = /^>\s*\*\*Gate\s+(\d)\s+—\s+([^:]+):\s*(.+?)\*\*\s*$/.exec(line);
    if (g) {
      gates.push({ k: Number(g[1]), title: g[2].trim(), text: g[3].trim().replace(/\.$/, "") });
      phase = Number(g[1]) + 1;
    }
  }
  return { modules, gates };
}
const GOALS = readGoals(readFileSync(join(ROOT, "GOALS.md"), "utf8"));
if (GOALS.gates.length !== 5) throw new Error(`GOALS.md: expected Gate 0 … Gate 4, found ${GOALS.gates.length}`);

/* ── reference ─────────────────────────────────────────────────────── */

/* A team, not a place (Meridian 5.28.0, #18 · DF-12): no city, no timezone,
   absent from Locations and from plant windows, still the unit of authority. */
const SITES = [
  { id: "HQ", kind: "team", city: "FitAdapt core team", region: "Distributed", tz: null, tzName: null,
    headcount: 14, fte: 12, calendar: "CAL-FAD",
    role: "The single delivery team. A Meridian team (site kind 'team'), not a place: it is distributed and has no office." },
];

/* Working days only; no holiday is typed because none has been agreed. */
const CALENDARS = [
  { id: "CAL-FAD", name: "FitAdapt — Monday to Friday", workdays: 62, isDefault: true, holidays: [],
    note: "Five working days. No public holidays are declared until the team agrees its calendar." },
];

/* Roles, not people. The founder replaces each name with the appointee's
   once the appointment is signed (docs/governance/01-product-owner-charter.md). */
const PEOPLE = [
  ["PE-01", "Founder (sponsor)", "Sponsor & company director"],
  ["PE-02", "Product Owner (to appoint)", "Product owner"],
  ["PE-03", "Tech lead (to appoint)", "Tech lead & architect"],
  ["PE-04", "Engine engineer (to appoint)", "Engine & safety engineer"],
  ["PE-05", "Mobile engineer (to appoint)", "Mobile engineer"],
  ["PE-06", "Backend engineer (to appoint)", "Backend & sync engineer"],
  ["PE-07", "AI engineer (to appoint)", "Data/ML & AI-safety engineer"],
  ["PE-08", "QA lead (to appoint)", "QA & test automation lead"],
  ["PE-09", "Designer (to appoint)", "Product designer & UX researcher"],
  ["PE-10", "Content lead (to appoint)", "Content, library & localisation lead"],
  ["PE-11", "Security engineer (to appoint)", "DevOps, security & privacy engineer"],
  ["PE-12", "Compliance coordinator (to appoint)", "Legal & compliance coordinator"],
  ["PE-13", "Growth lead (to appoint)", "Growth & go-to-market lead"],
  ["PE-14", "Delivery lead (to appoint)", "Delivery lead & Meridian champion"],
  // Expert Advisory Council — open seats (docs/governance/03-expert-advisory-council.md)
  ["PE-21", "Council seat A1 — physician (open)", "Council: sports & exercise medicine physician"],
  ["PE-22", "Council seat A2 — physiotherapist (open)", "Council: sports physiotherapist"],
  ["PE-23", "Council seat A3 — S&C coach (open)", "Council: strength & conditioning coach"],
  ["PE-24", "Council seat A4 — dietitian (open)", "Council: registered sports dietitian"],
  ["PE-25", "Council seat A5 — exercise physiologist (open)", "Council: exercise physiologist"],
  ["PE-26", "Council seat A6 — behavioural scientist (open)", "Council: behavioural scientist"],
  ["PE-27", "Council seat B1 — privacy counsel (open)", "Council: privacy & regulatory counsel"],
  ["PE-28", "Council seat B2 — product-liability counsel (open)", "Council: consumer & product-liability counsel"],
  ["PE-29", "Council seat B3 — IP counsel (open)", "Council: IP & trademark counsel"],
  ["PE-30", "Council seat B4 — device-regulatory specialist (open)", "Council: medical-device regulatory specialist"],
  ["PE-31", "Council seat C1 — insurance broker (open)", "Council: insurance adviser (non-voting)"],
].map(([id, name, role]) => ({ id, name, role, site: "HQ", rate: 0 }));

/* The council seats as Meridian seats (052, D-36.12). Every seat is open:
   no holder is recorded. A document names the seat it waits on, so the
   gate reads "waiting on seat A1". A and B seats may stop a release on a
   safety or legal ground (03 §2) — a veto domain that names no gate holds
   every gate; C1 is non-voting. */
export const SEATS = [
  ["A1", "PE-21", "Screening wording and flags (S1), red-flag stop (S3), special populations (S7), M11 medical boundary"],
  ["A2", "PE-22", "Pain model and thresholds (S2), substitutions, joint-load profiles (M06)"],
  ["A3", "PE-23", "Progression rules, increments, load ceiling (S5), assessments, periodization, Fair Pair scaling"],
  ["A4", "PE-24", "Energy and protein targets, nutrition floors (S4), disordered-eating guardrails, food data"],
  ["A5", "PE-25", "Relative-load coefficients, e1RM models, HR zones, WHO weekly minutes, evidence references"],
  ["A6", "PE-26", "Notifications, streaks, community mechanics, dark-pattern check (L4, L8)"],
  ["B1", "PE-27", "DPIA, health-data consent (L9), filings, transfers, store privacy labels"],
  ["B2", "PE-28", "Terms, risk acknowledgment (L2), point-of-risk notices (L3), subscription terms (L8), coach agreement (L10)"],
  ["B3", "PE-29", "Name clearance (L7), licences (L6), IP assignments"],
  ["B4", "PE-30", "Wellness vs medical-device boundary for M05, M10, M11 (L1)"],
  ["C1", "PE-31", "Product/professional liability, cyber, D&O (non-voting)"],
].map(([id, row, domain]) => ({
  id: "SEAT-" + id, code: id, seatPerson: row,
  name: `Council seat ${id} (open)`, person: null, domain,
  vetoDomain: id === "C1" ? null : "safety and legal sign-off (every gate)",
  observer: id === "C1", active: true,
}));

/* FitAdapt's own ladder on programme FAD (Meridian 5.17 D-36.02, #3/#15).
   Gate k of GOALS.md is rung k+1. Every rung is PROGRAMME-scoped: it clears
   only when the evidence of every project of FAD for it is approved and no
   standing human act (5.27) holds it — "Gate 0 must clear before Phase 1"
   is one gate for the programme, not one per project. `at` is where the
   gate sits in the 36-week window (Meridian needs it for scaffolding). */
const GATE_OWNER = ["Sponsor", "Sponsor + council A1–A5", "Sponsor + council A1, A4, B4", "Sponsor + counsel B1, B2", "Sponsor + all seats + local counsel"];
const EXIT_WEEK = [3, 14, 22, 29, 36];
export const LADDER = GOALS.gates.map((g) => ({
  k: g.k, n: g.k + 1,
  name: `Gate ${g.k} — ${g.title}`,
  owner: GATE_OWNER[g.k],
  evidence: g.text,
  at: Math.min(0.99, Math.round((EXIT_WEEK[g.k] / PLAN_WEEKS) * 1000) / 1000),
  week: EXIT_WEEK[g.k],
}));

const PROGRAMMES = [
  { id: "FAD", name: "FitAdapt (codename) — to market readiness", sponsor: "Founder", managerId: "PE-02",
    gateModel: LADDER.map(({ name, owner, evidence, at }) => ({ name, owner, evidence, at, scope: "programme" }))
      .map((r, i) => ({ n: i + 1, ...r })) },
];

const COLUMNS = [
  { id: "backlog", name: "Backlog", wip: 0 },
  { id: "progress", name: "In progress", wip: 4 },
  { id: "review", name: "In review", wip: 4 },
  { id: "ready", name: "Ready to release", wip: 3 },
  { id: "done", name: "Done", wip: 0 },
];

/* ── delivery: the v2.1 plan, one project per phase, one stage per module ── */

// [module, name, fromWeek, toWeek, owner, deps(module ids within the project; see addProject)]
export const PHASES = [
  {
    id: "PRJ-201", name: "Phase 0 — Foundation", weeks: [1, 3], k: 0,
    desc: "M00 platform, M17 privacy baseline, M20 legal framework. Exit: architecture review and Gate 0 (docs/governance/03, §6).",
    modules: [
      ["M00", "Platform Foundation & Design System", 1, 2, "PE-03", []],
      ["M17a", "Privacy, Security & Compliance — baseline", 2, 3, "PE-11", ["M00"]],
      ["M20", "Legal Framework, Claims Control & Defensibility", 3, 3, "PE-12", ["M00", "M17a"]],
    ],
  },
  {
    id: "PRJ-202", name: "Phase 1 — Safe MVP", weeks: [4, 14], k: 1,
    desc: "A single user can onboard, get assessed, follow a periodized home/gym program offline and see progress. Exit: council sign-off on screening wording, engine coefficients and pain model; internal alpha with the six personas.",
    modules: [
      ["M06", "Exercise Library & Knowledge Graph", 4, 5, "PE-10", []],
      ["M01", "Onboarding, Health Screening & Dynamic Profile", 5, 6, "PE-05", ["M06"]],
      ["M07", "Assessment & Benchmark Testing", 7, 7, "PE-04", ["M01"]],
      ["M08", "Program Architect — Periodization & Scheduling", 8, 9, "PE-04", ["M07"]],
      ["M02", "Adaptive Training Engine & Session Execution", 9, 11, "PE-04", ["M08"]],
      ["M05", "Recovery, Mobility & Pain-Monitored Safety", 12, 12, "PE-04", ["M02"]],
      ["M03", "Cardio & Conditioning Suite", 13, 13, "PE-05", ["M02"]],
      ["M04", "Tracking, Analytics & Progress Dashboard", 13, 14, "PE-05", ["M02"]],
    ],
  },
  {
    id: "PRJ-203", name: "Phase 2 — Differentiation", weeks: [15, 22], k: 2,
    desc: "Fair Pair, nutrition with guardrails, AI coach, wearables. Exit: dietitian and physician review M10 guardrails and M11 eval results; closed beta of Fair Pair.",
    modules: [
      ["M09", "Fair Pair — Partner & Group Training", 15, 17, "PE-06", []],
      ["M10", "Nutrition & Energy Balance", 16, 18, "PE-04", []],
      ["M11", "AI Coach (grounded, safety-bounded)", 18, 20, "PE-07", ["M10"]],
      ["M12", "Wearables & Health Integrations", 20, 21, "PE-06", []],
    ],
  },
  {
    id: "PRJ-204", name: "Phase 3 — Business & scale", weeks: [23, 29], k: 3,
    desc: "Engagement loops, subscriptions, analytics/CMS, coach portal. Exit: counsel reviews pricing, payment flows, claims and consent texts.",
    modules: [
      ["M13", "Engagement, Habits & Community", 23, 24, "PE-09", []],
      ["M16", "Monetization & Subscriptions", 24, 25, "PE-06", []],
      ["M18", "Analytics, Experimentation & Admin CMS", 26, 27, "PE-07", []],
      ["M15", "Coach Portal (B2B)", 27, 29, "PE-06", ["M16"]],
    ],
  },
  {
    id: "PRJ-205", name: "Phase 4 — Innovation & launch", weeks: [30, 36], k: 4,
    desc: "Voice and camera execution, full privacy/security programme with pen-test, store launch. Exit: launch:check green including legal gates, pen-test findings closed, council and counsel sign-off for every launch jurisdiction.",
    modules: [
      ["M14", "Smart Execution — Voice Coach & On-Device Motion Sensing", 30, 32, "PE-07", []],
      ["M17b", "Privacy, Security & Compliance — completion & pen-test", 32, 34, "PE-11", []],
      ["M19", "Launch Readiness & Go-to-Market", 34, 36, "PE-13", ["M14", "M17b"]],
    ],
  },
];

/* The plan and GOALS.md must describe the same programme. */
{
  const planned = new Map(PHASES.flatMap((ph) => ph.modules.map(([key]) => [key.replace(/[ab]$/, ""), ph.k])));
  const bad = [];
  for (const m of GOALS.modules) {
    if (!planned.has(m.id)) bad.push(`${m.id} is in GOALS.md but not in the plan`);
    else if (m.id !== "M17" && planned.get(m.id) !== m.phase) bad.push(`${m.id}: GOALS.md puts it in Phase ${m.phase}, the plan in Phase ${planned.get(m.id)}`);
  }
  if (bad.length) throw new Error("GOALS.md and the v2.1 plan disagree:\n  " + bad.join("\n  "));
}
const goalName = new Map(GOALS.modules.map((m) => [m.id, m.name]));

/* Governance: Gate 0 founder protections and the Expert Advisory Council. */
const GOVERNANCE = {
  id: "PRJ-206", name: "Governance — Gate 0, counsel & Expert Advisory Council", weeks: [1, 36],
  desc: "Founder protections (Gate 0), counsel per launch market, and the real advisory board required by decision C10. Owns every sign-off of a validated:false item, and the standing human acts that hold each gate.",
  activities: [
    ["G01", "Appoint the Product Owner and sign the appointment", 1, 1, "PE-01", []],
    ["G02", "Founder employment-contract check (IP, outside activity)", 1, 1, "PE-01", []],
    ["G03", "Incorporate the limited-liability company", 1, 3, "PE-01", ["G02"]],
    ["G04", "IP assignment from every contributor; start the register", 2, 36, "PE-12", [["G03", "SS", 10]]],
    ["G05", "Engage counsel for the primary jurisdiction and launch markets", 1, 3, "PE-12", []],
    ["G06", "Trademark clearance search (Nice 9, 41, 42, 44) and two fallback names", 2, 8, "PE-12", ["G05"]],
    ["G07", "Insurance quotes: product/professional liability, cyber", 2, 6, "PE-12", ["G03"]],
    ["G08", "Data-protection filings plan per jurisdiction", 3, 12, "PE-12", ["G05"]],
    ["G09", "Recruit and seat the Expert Advisory Council (11 seats)", 1, 6, "PE-02", ["G01"]],
    ["G10", "Advisory-board agreements drafted and reviewed by counsel", 2, 6, "PE-12", ["G05"]],
    ["G11", "Council review — Gate 1 (screening, coefficients, pain model)", 13, 14, "PE-21", ["G09"]],
    ["G12", "Council review — Gate 2 (M10 guardrails, M11 evals)", 21, 22, "PE-24", ["G11"]],
    ["G13", "Counsel review — Gate 3 (pricing, payments, claims, consent)", 28, 29, "PE-28", ["G12"]],
    ["G14", "Launch sign-off — Gate 4, every launch jurisdiction", 35, 36, "PE-27", ["G13"]],
  ],
};

/* Dogfooding: running FitAdapt on Meridian and contributing back. */
const DOGFOOD = {
  id: "PRJ-207", name: "Meridian dogfooding & contribution", weeks: [1, 36],
  desc: "FitAdapt is run on Meridian. Friction found in daily use is logged, triaged weekly and contributed back to github.com/mliad313sn/Meridian (docs/governance/05-dogfooding-loop.md).",
  activities: [
    ["D01", "Stand up the FitAdapt Meridian instance and import this book", 1, 1, "PE-14", []],
    ["D02", "Backup, restore test and second instance (Meridian SECURITY.md blockers)", 1, 3, "PE-11", ["D01"]],
    ["D03", "Weekly feedback triage (delivery review agenda item)", 2, 36, "PE-14", ["D01"]],
    ["D04", "Monthly contribution cycle: PRs to Meridian, npm run verify green", 4, 36, "PE-14", [["D03", "SS", 10]]],
    ["D05", "Quarterly dogfooding retrospective to the council and sponsor", 13, 36, "PE-02", [["D03", "SS", 55]]],
  ],
};

/* ── registers ─────────────────────────────────────────────────────── */

// Legal risk register (00-legal-framework.md) + section 11 risks of the committee review.
// [id, project, title, p, i, response, owner, detail, gateRung?]
const RAID = [
  ["RSK-01", "PRJ-202", "Personal injury following a prescription or partner challenge", 3, 5, "Mitigate", "PE-04",
    "Controls: S1–S7, L3, L4, conservative defaults, expert-validated content, L11 audit trail, insurance, terms with lawful limitation clauses. Modules M01–M05, M09, M20."],
  ["RSK-02", "PRJ-201", "Features or copy imply a medical purpose (medical-device rules)", 2, 5, "Avoid", "PE-12",
    "L1 claims linter, no diagnosis, no condition-specific programs, regulatory review of screening, pain and nutrition copy. Modules M05, M10, M11, M20."],
  ["RSK-03", "PRJ-203", "Nutrition or rehab guidance treated as unlicensed professional practice", 2, 4, "Avoid", "PE-24",
    "General guidance only, no medical nutrition therapy or rehab plans, referral to professionals, coach credential checks. Modules M05, M10, M15."],
  ["RSK-04", "PRJ-201", "Unlawful health-data processing, breach, missing filings or transfers", 3, 5, "Mitigate", "PE-11",
    "M17 + L9, DPIA, consent records, encryption, authority filings, transfer mechanisms, breach runbook. Modules M17, M12, M04."],
  ["RSK-05", "PRJ-203", "Missing AI disclosure or harmful AI advice", 3, 5, "Mitigate", "PE-07",
    "L5 disclosure, S6 tool-only changes, safety evals at 100%, grounded retrieval, human-reviewed red-team set. Modules M11, M14."],
  ["RSK-06", "PRJ-204", "Hard-to-cancel subscriptions, unclear prices, withdrawal rights ignored", 2, 4, "Avoid", "PE-06",
    "L8, store-managed billing, cancellation parity test, trial reminders, withdrawal-waiver capture. Module M16."],
  ["RSK-07", "PRJ-205", "Unsubstantiated claims, fake reviews or unconsented before/after photos", 2, 4, "Avoid", "PE-13",
    "L1, L8, L12, substantiation file for every marketing claim, testimonial consent records. Modules M19, M20."],
  ["RSK-08", "PRJ-202", "Unlicensed media, questionnaire wording, fonts, datasets or code", 3, 3, "Mitigate", "PE-10",
    "L6 asset register, SBOM, OSS licence allowlist in CI, licence check before verbatim use (e.g. PAR-Q+). Modules M06, M10, M20."],
  ["RSK-09", "PRJ-206", "Product or feature names infringe an existing mark", 3, 4, "Avoid", "PE-12",
    "L7 clearance before public use; 'FitAdapt' stays a codename; two fallback names. Modules M19, M20."],
  ["RSK-10", "PRJ-204", "A coach on the platform gives harmful advice", 2, 4, "Transfer", "PE-06",
    "L10 coach agreement with indemnity, credential verification, engine caps coaches cannot lift, reporting channel. Module M15."],
  ["RSK-11", "PRJ-204", "Harassment or unlawful user-generated content", 2, 3, "Mitigate", "PE-09",
    "Report/block, moderation queue, notice-and-action procedure, community guidelines. Module M13."],
  ["RSK-12", "PRJ-202", "Under-age users, or minors exposed to calorie restriction", 2, 5, "Avoid", "PE-05",
    "Age gate at 16 (higher where local law requires), no targeting of minors, deficit features off under 18. Modules M01, M10."],
  ["RSK-13", "PRJ-201", "Non-compliance with accessibility law (EAA)", 2, 3, "Mitigate", "PE-09",
    "WCAG 2.2 AA design system and audits. Modules M00, M19."],
  ["RSK-14", "PRJ-205", "Store removal over health-data, payments or account-deletion rules", 3, 4, "Mitigate", "PE-13",
    "Store compliance checklists, in-app account deletion, accurate privacy labels. Modules M16, M17, M19."],
  ["RSK-15", "PRJ-206", "Founder personal exposure or employer IP conflict", 3, 5, "Avoid", "PE-01",
    "C12: company structure, IP assignments, employment-contract check, insurance. Gate 0.", 1],
  ["RSK-16", "PRJ-204", "Cross-border VAT on digital services", 2, 3, "Transfer", "PE-06",
    "Stores as merchant of record for in-app sales; merchant-of-record provider for web checkout. Module M16."],
  ["RSK-17", "PRJ-202", "Engine coefficients or thresholds inaccurate", 3, 5, "Mitigate", "PE-25",
    "Every value carries source + validated flag; remote-config versioning with rollback (M18); council sign-off before public launch (C10).", 2],
  ["RSK-18", null, "Scope creep across 21 modules", 3, 3, "Mitigate", "PE-02",
    "Phase gates; each /goal has a turn cap and a status file; later modules can slip without blocking the MVP. Change requests go through Meridian change control."],
  ["RSK-19", "PRJ-203", "LLM running cost exceeds plan", 3, 3, "Mitigate", "PE-07",
    "Tier-based rate limits, routing to smaller models, caching, offline deterministic fallback."],
  ["RSK-20", "PRJ-202", "Poor experience on low connectivity and low-end devices", 3, 3, "Mitigate", "PE-03",
    "Offline-first architecture, performance budgets, downloadable media packs."],
  ["ISS-01", "PRJ-206", "Product Owner not yet named", 5, 4, "Fix", "PE-01",
    "The appointment instrument is drafted (docs/governance/01). Until it is signed the founder acts as interim Product Owner."],
  ["ISS-02", "PRJ-206", "All eleven council seats are open", 5, 5, "Fix", "PE-02",
    "No validated:false item can be signed off until the seats are filled. Recruitment brief: docs/governance/03, §4. Each seat has a Meridian seat and a review-grant account, inactive until the seat is filled."],
  ["ASM-01", null, "The v2.1 committee was a simulated panel", 5, 5, "Monitor", "PE-02",
    "Its findings are hypotheses. Every item marked validated:false needs a real, qualified council member's signature before public launch (C10)."],
  ["ASM-02", null, "Timings are indicative and assume a small team driving Claude Code /goal runs", 3, 3, "Monitor", "PE-14",
    "Re-plan and re-baseline after Phase 0, using the turn counts and status files of M00, M17 and M20. The named baseline 'v2.1 plan' keeps the original 36 weeks for comparison."],
  ["ASM-03", null, "Budget is not yet baselined", 5, 3, "Monitor", "PE-01",
    "Budgets in this book are zero on purpose. The sponsor sets them at Gate 0; until then earned value is not meaningful."],
  ["DEP-01", "PRJ-202", "Gate 0 must clear before Phase 1 starts (GOALS.md)", 3, 4, "Monitor", "PE-01",
    "Company, IP, employment check, counsel, name clearance started, insurance quotes, advisory-board agreements drafted. The acts themselves are the standing human acts that hold Gate 0.", 1],
  ["DEP-02", "PRJ-206", "Council seated before the Gate 1 review", 3, 5, "Mitigate", "PE-02",
    "Seats A1, A2, A3 and A5 at minimum must be filled and under agreement by week 12 to review screening wording, coefficients and pain model. Standing human act: it holds Gate 1 until the seats sit.", 2, true],
  ["DEP-03", "PRJ-207", "Meridian's three operational blockers are ours to close", 3, 3, "Mitigate", "PE-11",
    "A tested backup, a second instance and a written security policy (Meridian SECURITY.md). Closed by activity D02."],
];

export const DOCS = [];
let docN = 0;
const doc = (project, name, type, gate, owner, extra = {}) =>
  DOCS.push({ id: "DOC-" + String(++docN).padStart(2, "0"), project, name, type, gate, owner, rev: "0.1",
    status: "Draft", updated: STATUS, ...extra });

// Governance (the documents in docs/governance), all Draft until the sponsor approves. Gate 0.
doc("PRJ-206", "Product Owner charter & appointment", "Charter", 1, "PE-01", { path: "docs/governance/01-product-owner-charter.md" });
doc("PRJ-206", "Execution team charter & RACI", "Charter", 1, "PE-02", { path: "docs/governance/02-execution-team.md" });
doc("PRJ-206", "Expert Advisory Council charter", "Charter", 1, "PE-02", { path: "docs/governance/03-expert-advisory-council.md" });
doc("PRJ-206", "Meridian operating model", "Operations", 1, "PE-14", { path: "docs/governance/04-meridian-operating-model.md" });
doc("PRJ-206", "Dogfooding & contribution loop", "Operations", 1, "PE-14", { path: "docs/governance/05-dogfooding-loop.md" });
// Legal drafts (00-legal-framework.md) — counsel review required, at the launch gate (rung 5)
// except the advisory-board agreement, which Gate 0 needs. Each waits on its counsel seat.
for (const [n, o, seat, gate, path] of [
  ["Terms of Use (requires counsel review)", "PE-12", "B2", 5, "docs/legal/document-list.md"],
  ["Privacy Policy + health-data consent (requires counsel review)", "PE-12", "B1", 5, "docs/legal/drafts/privacy.md"],
  ["Exercise-risk acknowledgment (requires counsel review)", "PE-12", "B2", 5, "docs/legal/drafts/exercise_risk.md"],
  ["Point-of-risk notices (requires counsel review)", "PE-12", "B2", 5, "docs/legal/drafts/point-of-risk-notices.md"],
  ["AI coach notice (requires counsel review)", "PE-12", "B4", 5, "docs/legal/drafts/ai_notice.md"],
  ["Subscription & refund terms (requires counsel review)", "PE-12", "B2", 4, "docs/legal/document-list.md"],
  ["Coach Agreement + data-processing terms (requires counsel review)", "PE-12", "B2", 4, "docs/legal/drafts/coach-agreement.md"],
  ["Community guidelines (requires counsel review)", "PE-12", "B2", 4, "docs/legal/drafts/community_guidelines.md"],
  ["Advisory-board agreement (requires counsel review)", "PE-12", "B2", 1, "docs/legal/drafts/advisory-board-agreement.md"],
  ["Substantiation file (requires counsel review)", "PE-12", "B4", 5, "docs/legal/substantiation-file.md"],
]) doc("PRJ-206", n, "Compliance", gate, o, { expectedSeat: "SEAT-" + seat, path });

// Council sign-off packs, one per gate and seat (03 §5). Evidence = the signed record
// under docs/governance/sign-offs/ once it exists. Each waits on its seat.
for (const [gate, seat, what] of [
  [1, "B3", "Gate 0 — counsel engagement and IP assignment approach"],
  [2, "A1", "Gate 1 — screening wording and flags (S1, S3, S7)"],
  [2, "A2", "Gate 1 — pain model and thresholds, exercise-library physio flags, substitutions"],
  [2, "A3", "Gate 1 — progression rules, increments, S5 load ceiling, assessments, periodization volume"],
  [2, "A5", "Gate 1 — relative-load coefficients, e1RM model, HR zones, weekly aerobic minutes"],
  [3, "A4", "Gate 2 — M10 guardrails, energy and protein formulas, food data"],
  [3, "A1", "Gate 2 — M11 eval results and red-team set (medical boundary)"],
  [3, "B4", "Gate 2 — wellness boundary of M05, M10, M11"],
  [4, "B2", "Gate 3 — pricing display, payment flows, cancellation parity, claims"],
  [4, "B1", "Gate 3 — consent texts"],
  [5, "A6", "Gate 4 — engagement mechanics, dark-pattern check"],
  [5, "C1", "Gate 4 — insurance bound (non-voting)"],
]) doc("PRJ-206", `Council sign-off record — ${what} (seat ${seat})`, "Assurance", gate, "PE-02", { expectedSeat: "SEAT-" + seat });

// Per-phase exit evidence: the plan and the sign-off records of the exit gate.
for (const ph of PHASES) {
  const rung = ph.k + 1;
  doc(ph.id, `${ph.name}: plan and /goal files`, "Charter", rung, "PE-02", { path: "GOALS.md" });
  doc(ph.id, `${LADDER[ph.k].name}: exit evidence and sign-off records`, "Assurance", rung, "PE-02");
}

/* Dogfooding backlog: drive.mjs reads pmo/meridian/dogfood-log.md and writes
   one work item per finding (DF-nn) through PUT /api/v1/workitems. */

/* ── assemble ──────────────────────────────────────────────────────── */

const projects = [], activities = [], milestones = [], allocations = [], crossDeps = [];

/* Phase and dogfooding projects are governed at SITE (team) level, so the
   team (site grant on HQ) can update schedule, RAID and work items, while
   re-baselining, cost and gate-evidence approval stay with group level
   (PO, sponsor). Governance is group-governed: the team does not edit it,
   and council members approve its sign-off records under a review grant. */
function addProject(p, pm, list, governanceLevel = "site") {
  const [w0, w1] = p.weeks;
  projects.push({
    id: p.id, name: p.name, programme: "FAD", site: "HQ", governanceLevel, pm,
    method: "Agile", start: weekStart(w0), finish: weekEnd(w1), baselineFinish: weekEnd(w1),
    budget: 0, contingency: 0, contingencyUsed: 0, desc: p.desc, phase: "Initiation", gate: 0, closed: false,
    scaffoldedGates: LADDER.length, calendar: "CAL-FAD",
  });
  const ids = {};
  const weight = Math.round((1 / list.length) * 1000) / 1000;
  list.forEach(([key, name, a, b, owner, deps], stage) => {
    const id = `ACT-${p.id.slice(4)}-${String(stage + 1).padStart(2, "0")}`;
    ids[key] = { id, stage };
    const base = key.replace(/[ab]$/, "");
    const label = /^M\d/.test(key) ? `${base} — ${key === "M17a" || key === "M17b" ? name : goalName.get(base) ?? name}` : name;
    activities.push({
      id, project: p.id, name: label,
      stage, start: weekStart(a), end: weekEnd(b), baseStart: weekStart(a), baseEnd: weekEnd(b),
      weight, pct: 0, owner,
      /* A dependency is "KEY" (finish-to-start) or [KEY, type, lag in working days]
         (Meridian 5.29 typed links). The standing activities that run the whole
         programme start a fixed time after their predecessor starts (SS): the
         v2.1 plan drew them FS, which Meridian's critical path showed pushing
         the programme to 2028. */
      deps: deps.map((d) => ids[[d].flat()[0]].id),
      links: deps.map((d) => { const [k, type = "FS", lag = 0] = [d].flat(); return { pred: ids[k].id, type, lag }; }),
    });
  });
  return ids;
}

const phaseIds = PHASES.map((ph) => addProject(ph, "PE-02", ph.modules));
const govIds = addProject(GOVERNANCE, "PE-02", GOVERNANCE.activities, "group");
addProject(DOGFOOD, "PE-14", DOGFOOD.activities);

// Gate milestones: each rung is dated on the phase it closes, and on
// governance where the council or counsel reviews it.
for (const g of LADDER) {
  const ph = PHASES[g.k];
  milestones.push({ id: `MS-${ph.id.slice(4)}-G${g.n}`, project: ph.id, name: `${g.name} — phase exit`,
    date: weekEnd(g.week), gate: g.n, kind: "gate", owner: "PE-02", done: false });
  milestones.push({ id: `MS-206-G${g.n}`, project: "PRJ-206", name: `${g.name} — ${g.k === 0 ? "founder protections" : "council / counsel review"}`,
    date: weekEnd(g.week), gate: g.n, kind: "gate", owner: g.k === 0 ? "PE-01" : "PE-02", done: false });
}

// Cross-project links (FX-15, typed): finish-to-start, no lag, in Meridian's (project, stage) form.
const x = (fromP, fromIds, fromK, toP, toIds, toK, label) =>
  crossDeps.push({ from: fromP, fromStage: fromIds[fromK].stage, to: toP, toStage: toIds[toK].stage, label, type: "FS", lag: 0 });
x("PRJ-201", phaseIds[0], "M20", "PRJ-202", phaseIds[1], "M06", "Phase 0 complete before Phase 1");
x("PRJ-206", govIds, "G10", "PRJ-202", phaseIds[1], "M06", "Gate 0: advisory-board agreements drafted");
x("PRJ-201", phaseIds[0], "M17a", "PRJ-203", phaseIds[2], "M11", "M11 depends on the M17 baseline");
x("PRJ-202", phaseIds[1], "M04", "PRJ-203", phaseIds[2], "M09", "M09 depends on M02 and M04");
x("PRJ-206", govIds, "G11", "PRJ-203", phaseIds[2], "M09", "Gate 1 sign-off before Phase 2");
x("PRJ-206", govIds, "G12", "PRJ-204", phaseIds[3], "M13", "Gate 2 sign-off before Phase 3");
x("PRJ-206", govIds, "G13", "PRJ-205", phaseIds[4], "M14", "Gate 3 review before Phase 4");

// Allocations: the core team across the phase projects, part-time roles on governance.
const core = ["PE-03", "PE-04", "PE-05", "PE-06", "PE-07", "PE-08", "PE-09", "PE-10", "PE-11"];
for (const ph of PHASES) {
  const p = projects.find((q) => q.id === ph.id);
  for (const pe of core) allocations.push({ person: pe, project: ph.id, from: p.start, to: p.finish, pct: 90 });
  allocations.push({ person: "PE-02", project: ph.id, from: p.start, to: p.finish, pct: 60 });
}
const gov = projects.find((q) => q.id === "PRJ-206");
const dog = projects.find((q) => q.id === "PRJ-207");
allocations.push({ person: "PE-01", project: gov.id, from: gov.start, to: gov.finish, pct: 20 });
allocations.push({ person: "PE-02", project: gov.id, from: gov.start, to: gov.finish, pct: 30 });
allocations.push({ person: "PE-12", project: gov.id, from: gov.start, to: gov.finish, pct: 80 });
allocations.push({ person: "PE-14", project: dog.id, from: dog.start, to: dog.finish, pct: 30 });
for (const pe of core) allocations.push({ person: pe, project: dog.id, from: dog.start, to: dog.finish, pct: 5 });
allocations.forEach((a, i) => { a.id = String(i + 1); }); // Meridian allocation ids are integers

export const book = {
  orgName: "FitAdapt (codename)",
  currencyUnit: "millions", // Meridian 5.17 D-36.04: money declares its unit; every budget is 0
  statusDate: STATUS,
  calendars: CALENDARS,
  sites: SITES,
  people: PEOPLE,
  programmes: PROGRAMMES,
  columns: COLUMNS,
  projects,
  activities,
  crossDeps,
  milestones,
  ledger: [],
  seats: SEATS.map(({ id, name, person, domain, vetoDomain, observer, active }) => ({ id, name, person, domain, vetoDomain, observer, active })),
  raid: RAID.map(([id, project, title, p, i, response, owner, detail, gate, blocksGate]) => ({
    id, project, type: { RSK: "Risk", ISS: "Issue", ASM: "Assumption", DEP: "Dependency" }[id.slice(0, 3)],
    title, detail, p, i, response, owner, opened: STATUS, review: weekEnd(3), status: "Open",
    gate: gate ?? null, blocksGate: blocksGate === true, category: blocksGate ? "Human act" : "",
  })),
  crs: [],
  /* The three meeting series of docs/governance/04 §4, in the book so a
     re-bootstrap does not depend on the order of API calls. */
  meetingSeries: [
    { id: "MS-FAD-WDR", name: "FitAdapt weekly delivery review", cadence: "weekly", scopeKind: "programme",
      programme: "FAD", chair: "PE-02", weekday: 1, startTime: "09:30", timeboxMin: 30, active: true },
    { id: "MS-FAD-EAC", name: "Expert Advisory Council — monthly session", cadence: "monthly", scopeKind: "programme",
      programme: "FAD", chair: "PE-02", weekday: 3, startTime: "16:00", timeboxMin: 90, active: true },
    { id: "MS-FAD-SST", name: "Sponsor steering — monthly", cadence: "monthly", scopeKind: "group",
      chair: "PE-01", weekday: 5, startTime: "11:00", timeboxMin: 45, active: true },
  ],
  allocations,
  docs: DOCS.map(({ path, ...d }) => d),
  items: [],
};

/* Written only when run, so drive.mjs can import the plan without side effects. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(HERE, "fitadapt-book.json");
  writeFileSync(out, JSON.stringify({ db: book }, null, 2) + "\n");
  console.log(`wrote ${out}: ${projects.length} projects, ${activities.length} activities, ` +
    `${milestones.length} gate milestones on a ${LADDER.length}-rung programme ladder, ${book.raid.length} RAID, ` +
    `${DOCS.length} documents, ${SEATS.length} council seats (all open), ${PEOPLE.length} roles/seats`);
}
