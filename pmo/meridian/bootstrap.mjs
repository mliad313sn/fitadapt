#!/usr/bin/env node
/**
 * Stands up the FitAdapt book on a Meridian instance, in the only order that works:
 *
 *   1. import fitadapt-book.json  (the import REPLACES the whole book, meetings included)
 *   2. create the three meeting series  (docs/governance/04-meridian-operating-model.md §4)
 *   3. allow github.com as an evidence host, so a document can point at a pinned commit
 *
 * Needs Meridian >= 5.9.1 (earlier versions answer 400 to every import:
 * https://github.com/mliad313sn/Meridian/pull/14). Run it once, on an empty instance.
 * Running it again wipes whatever the team has recorded since.
 *
 *   MERIDIAN_URL=http://localhost:4173 MERIDIAN_EMAIL=… MERIDIAN_PASSWORD=… \
 *     node pmo/meridian/bootstrap.mjs [--yes]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.MERIDIAN_URL ?? "http://localhost:4173";
const EMAIL = process.env.MERIDIAN_EMAIL;
const PASSWORD = process.env.MERIDIAN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set MERIDIAN_EMAIL and MERIDIAN_PASSWORD (an administrator account).");
  process.exit(2);
}

let cookie = "";
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    if (pair.startsWith("meridian_sid=")) cookie = pair;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.error ?? text}`);
  return json;
}

const health = await call("GET", "/api/health");
console.log(`Meridian ${health.version} on ${health.engine}`);
await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });

const existing = await call("GET", "/api/admin/export");
const foreign = (existing.projects ?? []).filter((p) => !String(p.id).startsWith("PRJ-2"));
if ((existing.projects ?? []).length && !process.argv.includes("--yes")) {
  console.error(`This instance already holds ${existing.projects.length} project(s)` +
    (foreign.length ? `, ${foreign.length} of them not FitAdapt's` : "") +
    ". The import replaces everything. Re-run with --yes to proceed.");
  process.exit(1);
}

const book = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fitadapt-book.json"), "utf8"));
const imported = await call("POST", "/api/admin/import", book);
console.log("imported", imported.counts);

const SERIES = [
  { name: "FitAdapt weekly delivery review", scopeKind: "programme", programmeId: "FAD", cadence: "weekly",
    chairId: "PE-02", weekday: 1, startTime: "09:30", timeboxMin: 30 },
  { name: "Expert Advisory Council — monthly session", scopeKind: "programme", programmeId: "FAD", cadence: "monthly",
    chairId: "PE-02", weekday: 3, startTime: "16:00", timeboxMin: 90 },
  { name: "Sponsor steering — monthly", scopeKind: "group", cadence: "monthly",
    chairId: "PE-01", weekday: 5, startTime: "11:00", timeboxMin: 45 },
];
for (const s of SERIES) {
  const { id } = await call("POST", "/api/meetings/series", s);
  console.log("series", id, s.name);
}

await call("PATCH", "/api/admin/settings", { documentHosts: "github.com" });
console.log("documentHosts = github.com");
console.log("Done. Next: create accounts in Administration (docs/governance/04 §3).");
