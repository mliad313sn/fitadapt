#!/usr/bin/env node
/**
 * Stands up the FitAdapt book on an EMPTY Meridian 5.36+ instance. Run it once.
 *
 *   1. dry-run, then import fitadapt-book.json (a REPLACE: it erases the
 *      whole book, meeting register included — which is why it runs once);
 *   2. settings: github.com as the trusted evidence host, the gate lock on;
 *   3. the named baseline "v2.1 plan" on every project, taken BEFORE any
 *      actual is recorded, so Meridian can compare the plan with what happened;
 *   4. one account per role and per council seat, all INACTIVE with an
 *      unusable random password, linked to their person row. A council seat
 *      carries an evidence-review grant on programme FAD (C1, non-voting:
 *      on the governance project only) (Meridian 5.26,
 *      #16 · DF-10): the member approves sign-off records in their own name.
 *      The administrator activates an account when the role is filled
 *      (docs/governance/04 §3) — nobody can sign in as an open seat.
 *
 * Then run drive.mjs, which lays the repository's truth on top through the
 * API (never through another import).
 *
 *   MERIDIAN_URL=http://localhost:4173 MERIDIAN_EMAIL=… MERIDIAN_PASSWORD=… \
 *     node pmo/meridian/bootstrap.mjs [--yes]
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEATS } from "./build-book.mjs";
import { session } from "./meridian-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const api = await session();

const existing = await api.call("GET", "/api/admin/export");
const held = existing.projects ?? [];
if (held.length && !process.argv.includes("--yes")) {
  const foreign = held.filter((p) => !String(p.id).startsWith("PRJ-2"));
  const meetings = (existing.meetings ?? []).length + (existing.decisions ?? []).length;
  console.error(`This instance already holds ${held.length} project(s)` +
    (foreign.length ? `, ${foreign.length} of them not FitAdapt's` : "") +
    (meetings ? ` and ${meetings} meeting/decision row(s)` : "") +
    ". The import replaces everything. To keep an instance in step, run drive.mjs instead." +
    " Re-run with --yes to replace it anyway.");
  process.exit(1);
}

const book = JSON.parse(readFileSync(join(HERE, "fitadapt-book.json"), "utf8"));
const dry = await api.call("POST", "/api/admin/import?dryRun=1", book);
if (dry.rejects?.length) {
  console.error("The dry run refused rows — nothing was written:");
  for (const r of dry.rejects) console.error(`  ${r.table} ${r.id}: ${r.reason}`);
  process.exit(1);
}
if (dry.wouldErase && Object.values(dry.wouldErase).some((n) => n > 0)) {
  console.log("the replace erases:", JSON.stringify(dry.wouldErase));
}
const imported = await api.call("POST", "/api/admin/import", book);
if (imported.rejects?.length) {
  for (const r of imported.rejects) console.error(`  refused ${r.table} ${r.id}: ${r.reason}`);
  process.exit(1);
}
console.log("imported", JSON.stringify(imported.counts));

await api.call("PATCH", "/api/admin/settings", { documentHosts: "github.com", gateLock: true });
console.log("documentHosts = github.com, gateLock on");

for (const p of book.db.projects) {
  const out = await api.call("POST", `/api/projects/${p.id}/baselines`, {
    name: "v2.1 plan",
    reason: "The original 36-week plan of goal pack v2.1 (GOALS.md), frozen before any actual date was recorded.",
  });
  console.log(`baseline ${out.id} "v2.1 plan" on ${p.id}`);
}

/* Accounts: roles and seats, inactive. The password is random and not
   kept: activating an account is the administrator setting a password the
   holder must change at first sign-in. */
const ACCOUNTS = [
  { person: "PE-01", email: "sponsor@fitadapt.example", role: "group", grants: [{ kind: "programme", target: "FAD" }] },
  { person: "PE-02", email: "product-owner@fitadapt.example", role: "group", grants: [{ kind: "programme", target: "FAD" }] },
  ...["PE-03", "PE-04", "PE-05", "PE-06", "PE-07", "PE-08", "PE-09", "PE-10", "PE-11", "PE-12", "PE-13"].map((pe) => (
    { person: pe, email: `${pe.toLowerCase()}@fitadapt.example`, role: "site", grants: [{ kind: "site", target: "HQ" }] })),
  { person: "PE-14", email: "delivery-lead@fitadapt.example", role: "admin", grants: [] },
  ...SEATS.map((s) => ({ person: s.seatPerson, email: `council-${s.code.toLowerCase()}@fitadapt.example`, role: "viewer",
    /* C1 is non-voting: it reviews the insurance record on governance only. */
    grants: [], review: s.code === "C1" ? { kind: "project", target: "PRJ-206" } : { kind: "programme", target: "FAD" } })),
];
const people = new Map(book.db.people.map((p) => [p.id, p.name]));
const { users } = await api.call("GET", "/api/admin/users");
for (const a of ACCOUNTS) {
  let u = users.find((x) => x.email.toLowerCase() === a.email);
  if (!u) {
    const { id } = await api.call("POST", "/api/admin/users", {
      email: a.email, displayName: people.get(a.person), role: a.role, personId: a.person,
      password: randomBytes(24).toString("base64url"), grants: a.grants,
    });
    u = (await api.call("GET", "/api/admin/users")).users.find((x) => x.id === id);
  }
  if (a.review) await api.call("POST", `/api/admin/users/${u.id}/grants`, { ...a.review, power: "review" });
  if (u.active) await api.call("PATCH", `/api/admin/users/${u.id}`, { active: false, version: u.version });
  console.log(`account ${a.email} (${a.role}${a.review ? ", review grant on " + a.review.target : ""}) — inactive until the role is filled`);
}

console.log("Done. Next: node pmo/meridian/drive.mjs (docs/governance/04 §6).");
