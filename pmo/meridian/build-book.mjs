#!/usr/bin/env node
/**
 * Builds the FitAdapt book for Meridian (https://github.com/mliad313sn/Meridian).
 *
 * The output, fitadapt-book.json, is in the shape Meridian's whole-book
 * import reads (POST /api/admin/import with body { db: <book> }). It is
 * generated from the tables below, and those tables come from
 * GOALS.md, docs/specs/00-legal-framework.md and docs/governance/, so the
 * portfolio and the repository describe the same plan.
 *
 * Rules this file keeps:
 *   - no real people: every person row is a role or an open council seat (L8, L12);
 *   - no invented money: budgets stay 0 until the sponsor baselines them at Gate 0;
 *   - risk scores are the Product Owner's opening scores, for the council to challenge.
 *
 * Usage: node pmo/meridian/build-book.mjs [--start 2026-09-28] [--status 2026-09-23]
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const START = arg("--start", "2026-09-28"); // Monday of programme week 1
const STATUS = arg("--status", "2026-09-23");

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const weekStart = (n) => iso(Date.parse(START) + (n - 1) * 7 * DAY); // Monday
const weekEnd = (n) => iso(Date.parse(START) + ((n - 1) * 7 + 4) * DAY); // Friday

/* ── reference ─────────────────────────────────────────────────────── */

const SITES = [
  { id: "HQ", city: "Distributed team", region: "FitAdapt core", tz: 0, tzName: "UTC", headcount: 14, fte: 12,
    role: "Single delivery unit. Meridian models authority by site; FitAdapt has one team, so one site (see pmo/meridian/dogfood-log.md, DF-12)." },
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

const PROGRAMMES = [
  { id: "FAD", name: "FitAdapt (codename) — to market readiness", sponsor: "Founder", managerId: "PE-02" },
];

const COLUMNS = [
  { id: "backlog", name: "Backlog", wip: 0 },
  { id: "progress", name: "In progress", wip: 4 },
  { id: "review", name: "In review", wip: 4 },
  { id: "ready", name: "Ready to release", wip: 3 },
  { id: "done", name: "Done", wip: 0 },
];

/* ── delivery: one project per phase, one activity per module ─────── */

// [module, name, fromWeek, toWeek, owner, deps(module ids within the project)]
const PHASES = [
  {
    id: "PRJ-201", name: "Phase 0 — Foundation", weeks: [1, 3], exitGate: "Gate 0 — Legal foundation",
    desc: "M00 platform, M17 privacy baseline, M20 legal framework. Exit: architecture review and Gate 0 (docs/governance/03, §6).",
    modules: [
      ["M00", "Platform Foundation & Design System", 1, 2, "PE-03", []],
      ["M17a", "Privacy, Security & Compliance — baseline", 2, 3, "PE-11", ["M00"]],
      ["M20", "Legal Framework, Claims Control & Defensibility", 3, 3, "PE-12", ["M00", "M17a"]],
    ],
  },
  {
    id: "PRJ-202", name: "Phase 1 — Safe MVP", weeks: [4, 14], exitGate: "Gate 1 — Safe MVP",
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
    id: "PRJ-203", name: "Phase 2 — Differentiation", weeks: [15, 22], exitGate: "Gate 2 — Differentiation",
    desc: "Fair Pair, nutrition with guardrails, AI coach, wearables. Exit: dietitian and physician review M10 guardrails and M11 eval results; closed beta of Fair Pair.",
    modules: [
      ["M09", "Fair Pair — Partner & Group Training", 15, 17, "PE-06", []],
      ["M10", "Nutrition & Energy Balance", 16, 18, "PE-04", []],
      ["M11", "AI Coach (grounded, safety-bounded)", 18, 20, "PE-07", ["M10"]],
      ["M12", "Wearables & Health Integrations", 20, 21, "PE-06", []],
    ],
  },
  {
    id: "PRJ-204", name: "Phase 3 — Business & scale", weeks: [23, 29], exitGate: "Gate 3 — Business",
    desc: "Engagement loops, subscriptions, analytics/CMS, coach portal. Exit: counsel reviews pricing, payment flows, claims and consent texts.",
    modules: [
      ["M13", "Engagement, Habits & Community", 23, 24, "PE-09", []],
      ["M16", "Monetization & Subscriptions", 24, 25, "PE-06", []],
      ["M18", "Analytics, Experimentation & Admin CMS", 26, 27, "PE-07", []],
      ["M15", "Coach Portal (B2B)", 27, 29, "PE-06", ["M16"]],
    ],
  },
  {
    id: "PRJ-205", name: "Phase 4 — Innovation & launch", weeks: [30, 36], exitGate: "Gate 4 — Launch go/no-go",
    desc: "Voice and camera execution, full privacy/security programme with pen-test, store launch. Exit: launch:check green including legal gates, pen-test findings closed, council and counsel sign-off for every launch jurisdiction.",
    modules: [
      ["M14", "Smart Execution — Voice Coach & On-Device Motion Sensing", 30, 32, "PE-07", []],
      ["M17b", "Privacy, Security & Compliance — completion & pen-test", 32, 34, "PE-11", []],
      ["M19", "Launch Readiness & Go-to-Market", 34, 36, "PE-13", ["M14", "M17b"]],
    ],
  },
];

/* Governance: Gate 0 founder protections and the Expert Advisory Council. */
const GOVERNANCE = {
  id: "PRJ-206", name: "Governance — Gate 0, counsel & Expert Advisory Council", weeks: [1, 36],
  desc: "Founder protections (Gate 0), counsel per launch market, and the real advisory board required by decision C10. Owns every sign-off of a validated:false item.",
  activities: [
    ["G01", "Appoint the Product Owner and sign the appointment", 1, 1, "PE-01", []],
    ["G02", "Founder employment-contract check (IP, outside activity)", 1, 1, "PE-01", []],
    ["G03", "Incorporate the limited-liability company", 1, 3, "PE-01", ["G02"]],
    ["G04", "IP assignment from every contributor; start the register", 2, 36, "PE-12", ["G03"]],
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
    ["D04", "Monthly contribution cycle: PRs to Meridian, npm run verify green", 4, 36, "PE-14", ["D03"]],
    ["D05", "Quarterly dogfooding retrospective to the council and sponsor", 13, 36, "PE-02", ["D03"]],
  ],
};

/* ── registers ─────────────────────────────────────────────────────── */

// Legal risk register (00-legal-framework.md) + section 11 risks of the committee review.
// [id, project, title, p, i, response, owner, detail]
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
    "C12: company structure, IP assignments, employment-contract check, insurance. Gate 0."],
  ["RSK-16", "PRJ-204", "Cross-border VAT on digital services", 2, 3, "Transfer", "PE-06",
    "Stores as merchant of record for in-app sales; merchant-of-record provider for web checkout. Module M16."],
  ["RSK-17", "PRJ-202", "Engine coefficients or thresholds inaccurate", 3, 5, "Mitigate", "PE-25",
    "Every value carries source + validated flag; remote-config versioning with rollback (M18); council sign-off before public launch (C10)."],
  ["RSK-18", null, "Scope creep across 21 modules", 3, 3, "Mitigate", "PE-02",
    "Phase gates; each /goal has a turn cap and a status file; later modules can slip without blocking the MVP. Change requests go through Meridian change control."],
  ["RSK-19", "PRJ-203", "LLM running cost exceeds plan", 3, 3, "Mitigate", "PE-07",
    "Tier-based rate limits, routing to smaller models, caching, offline deterministic fallback."],
  ["RSK-20", "PRJ-202", "Poor experience on low connectivity and low-end devices", 3, 3, "Mitigate", "PE-03",
    "Offline-first architecture, performance budgets, downloadable media packs."],
  ["ISS-01", "PRJ-206", "Product Owner not yet named", 5, 4, "Fix", "PE-01",
    "The appointment instrument is drafted (docs/governance/01). Until it is signed the founder acts as interim Product Owner."],
  ["ISS-02", "PRJ-206", "All eleven council seats are open", 5, 5, "Fix", "PE-02",
    "No validated:false item can be signed off until the seats are filled. Recruitment brief: docs/governance/03, §4."],
  ["ASM-01", null, "The v2.1 committee was a simulated panel", 5, 5, "Monitor", "PE-02",
    "Its findings are hypotheses. Every item marked validated:false needs a real, qualified council member's signature before public launch (C10)."],
  ["ASM-02", null, "Timings are indicative and assume a small team driving Claude Code /goal runs", 3, 3, "Monitor", "PE-14",
    "Re-plan and re-baseline after Phase 0, using the turn counts and status files of M00, M17 and M20."],
  ["ASM-03", null, "Budget is not yet baselined", 5, 3, "Monitor", "PE-01",
    "Budgets in this book are zero on purpose. The sponsor sets them at Gate 0; until then earned value is not meaningful."],
  ["DEP-01", "PRJ-202", "Gate 0 must clear before Phase 1 starts (GOALS.md)", 3, 4, "Monitor", "PE-01",
    "Company, IP, employment check, counsel, name clearance started, insurance quotes, advisory-board agreements drafted."],
  ["DEP-02", "PRJ-202", "Council seated before the Gate 1 review", 3, 5, "Mitigate", "PE-02",
    "Seats A1–A5 at minimum must be filled and under agreement by week 12 to review screening wording, coefficients and pain model."],
  ["DEP-03", "PRJ-207", "Meridian's three operational blockers are ours to close", 3, 3, "Mitigate", "PE-11",
    "A tested backup, a second instance and a written security policy (Meridian SECURITY.md). Closed by activity D02."],
];

const DOCS = [];
let docN = 0;
const doc = (project, name, type, gate, owner) =>
  DOCS.push({ id: "DOC-" + String(++docN).padStart(2, "0"), project, name, type, gate, owner, rev: "0.1", status: "Draft", updated: STATUS });

// Governance (the documents in docs/governance), all Draft until the sponsor approves.
doc("PRJ-206", "Product Owner charter & appointment", "Charter", 1, "PE-01");
doc("PRJ-206", "Execution team charter & RACI", "Charter", 1, "PE-02");
doc("PRJ-206", "Expert Advisory Council charter", "Charter", 1, "PE-02");
doc("PRJ-206", "Meridian operating model", "Operations", 1, "PE-14");
doc("PRJ-206", "Dogfooding & contribution loop", "Operations", 1, "PE-14");
// Gate 0 legal documents (00-legal-framework.md) — counsel review required.
for (const [n, o] of [
  ["Terms of Use (requires counsel review)", "PE-28"],
  ["Privacy Policy + health-data consent (requires counsel review)", "PE-27"],
  ["Exercise-risk acknowledgment (requires counsel review)", "PE-28"],
  ["Point-of-risk notices (requires counsel review)", "PE-28"],
  ["AI coach notice (requires counsel review)", "PE-30"],
  ["Subscription & refund terms (requires counsel review)", "PE-28"],
  ["Coach Agreement + data-processing terms (requires counsel review)", "PE-28"],
  ["Community guidelines (requires counsel review)", "PE-28"],
  ["Advisory-board agreement (requires counsel review)", "PE-28"],
  ["Substantiation file (requires counsel review)", "PE-30"],
]) doc("PRJ-206", n, "Compliance", 2, o);
// Per-phase gate evidence.
for (const ph of PHASES) {
  doc(ph.id, `${ph.name}: plan and /goal files`, "Charter", 1, "PE-02");
  doc(ph.id, `${ph.name}: ADRs and module status files`, "Design", 2, "PE-03");
  doc(ph.id, `${ph.exitGate}: exit evidence and sign-off records`, "Assurance", 3, "PE-02");
  doc(ph.id, `${ph.name}: KPI review and lessons learned`, "Closure", 4, "PE-14");
}

/* Dogfooding backlog: the verified findings of the first session
   (pmo/meridian/dogfood-log.md), each tied to its upstream record on
   github.com/mliad313sn/Meridian. "review" = fix is in an open PR. */
const ITEMS = [
  ["WI-01", "done", "DF-01 Import answered 400 for every book ('\\D' in a template literal) — merged in Meridian 5.9.1 (PR #14)", "PE-14", 3, "P1"],
  ["WI-02", "done", "DF-02 Import dropped document uri, so imported evidence stopped counting — merged in Meridian 5.9.1 (PR #14)", "PE-14", 2, "P1"],
  ["WI-03", "done", "DF-03 Quick start seeded an in-memory database; nobody could sign in — merged in Meridian 5.9.1 (PR #14)", "PE-14", 2, "P1"],
  ["WI-04", "done", "DF-04 Import refused the bare book GET /export returns — merged in Meridian 5.9.1 (PR #14)", "PE-14", 1, "P2"],
  ["WI-05", "done", "DF-05 restart.sh worked on Windows only — merged in Meridian 5.9.1 (PR #14)", "PE-14", 2, "P2"],
  ["WI-06", "done", "DF-06 Unbudgeted project reported green and SPI/CPI 1.00 (MER-04 ported) — merged in Meridian 5.9.1 (PR #14)", "PE-14", 2, "P1"],
  ["WI-07", "done", "DF-07 A refused import did not say which row — merged in Meridian 5.9.1 (PR #14)", "PE-14", 1, "P2"],
  ["WI-08", "done", "DF-08 qs 6.15.3 moderate advisories on the request parsers — merged in Meridian 5.9.1 (PR #14)", "PE-14", 1, "P2"],
  ["WI-09", "backlog", "DF-09 main is behind three unmerged lines (gate ladder, MER-13) — issue #15", "PE-14", 5, "P1"],
  ["WI-10", "backlog", "DF-10 Council members cannot approve evidence without write authority — issue #16", "PE-14", 5, "P1"],
  ["WI-11", "backlog", "DF-11 No way to link a GitHub issue or PR to an activity or RAID row — issue #17", "PE-14", 5, "P2"],
  ["WI-12", "backlog", "DF-12 'Site' is the only unit of authority; teams must pretend to be places — issue #18", "PE-14", 3, "P3"],
];

/* ── assemble ──────────────────────────────────────────────────────── */

const projects = [], activities = [], milestones = [], allocations = [], crossDeps = [];

/* Phase and dogfooding projects are governed at SITE level, so the team
   (site grant on HQ) can update schedule, RAID and work items, while
   re-baselining, cost and gate-evidence approval stay with group level
   (PO, sponsor). Governance is group-governed: the team does not edit it. */
function addProject(p, pm, list, weight, governanceLevel = "site") {
  const [w0, w1] = p.weeks;
  projects.push({
    id: p.id, name: p.name, programme: "FAD", site: "HQ", governanceLevel, pm,
    method: "Agile", start: weekStart(w0), finish: weekEnd(w1), baselineFinish: weekEnd(w1),
    budget: 0, contingency: 0, contingencyUsed: 0, desc: p.desc, phase: "Initiation", gate: 0, closed: false,
  });
  const ids = {};
  list.forEach(([key, name, a, b, owner, deps], stage) => {
    const id = `ACT-${p.id.slice(4)}-${String(stage + 1).padStart(2, "0")}`;
    ids[key] = { id, stage };
    activities.push({
      id, project: p.id, name: /^M\d/.test(key) ? `${key.replace(/[ab]$/, "")} — ${name}` : name,
      stage, start: weekStart(a), end: weekEnd(b), weight: weight(list.length), pct: 0, owner,
      deps: deps.map((d) => ids[d].id),
    });
  });
  // Meridian's four gates per project (engine GATES): Mandate, Design authority, Readiness, Benefits.
  const span = w1 - w0;
  const gates = [
    [1, w0, "Gate 1 — Mandate: plan approved by the Product Owner"],
    [2, w0 + Math.max(0, Math.round(span * 0.25)), "Gate 2 — Design authority: ADRs reviewed by the tech lead"],
    [3, w1, p.exitGate ? `Gate 3 — Readiness: ${p.exitGate}` : "Gate 3 — Readiness"],
    [4, Math.min(36, w1 + 1), "Gate 4 — Benefits: KPI review and lessons"],
  ];
  for (const [g, w, name] of gates) {
    milestones.push({ id: `MS-${p.id.slice(4)}-G${g}`, project: p.id, name, date: weekEnd(w), gate: g, kind: "gate", owner: pm, done: false });
  }
  return ids;
}

const even = (n) => Math.round((1 / n) * 1000) / 1000;
const phaseIds = PHASES.map((ph) => addProject(ph, "PE-02", ph.modules, even));
const govIds = addProject(GOVERNANCE, "PE-02", GOVERNANCE.activities, even, "group");
addProject(DOGFOOD, "PE-14", DOGFOOD.activities, even);

// Cross-project dependencies, in Meridian's (project, stage) form.
const x = (fromP, fromIds, fromK, toP, toIds, toK, label) =>
  crossDeps.push({ from: fromP, fromStage: fromIds[fromK].stage, to: toP, toStage: toIds[toK].stage, label });
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

const book = {
  orgName: "FitAdapt (codename)",
  statusDate: STATUS,
  sites: SITES,
  people: PEOPLE,
  programmes: PROGRAMMES,
  columns: COLUMNS,
  projects,
  activities,
  crossDeps,
  milestones,
  ledger: [],
  raid: RAID.map(([id, project, title, p, i, response, owner, detail]) => ({
    id, project, type: { RSK: "Risk", ISS: "Issue", ASM: "Assumption", DEP: "Dependency" }[id.slice(0, 3)],
    title, detail, p, i, response, owner, opened: STATUS, review: weekEnd(3), status: "Open",
  })),
  crs: [],
  allocations,
  docs: DOCS,
  items: ITEMS.map(([id, column, title, assignee, points, priority]) => ({
    id, project: "PRJ-207", column, title, assignee, points, priority, created: STATUS,
  })),
};

const out = join(dirname(fileURLToPath(import.meta.url)), "fitadapt-book.json");
writeFileSync(out, JSON.stringify({ db: book }, null, 2) + "\n");
console.log(`wrote ${out}: ${projects.length} projects, ${activities.length} activities, ` +
  `${milestones.length} gate milestones, ${book.raid.length} RAID, ${DOCS.length} documents, ` +
  `${ITEMS.length} work items, ${PEOPLE.length} roles/seats`);
