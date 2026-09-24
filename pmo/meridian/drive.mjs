#!/usr/bin/env node
/**
 * drive.mjs — keeps FitAdapt's Meridian book in step with this repository,
 * then writes Meridian's own view of the programme to weekly-review.md.
 *
 * It is idempotent: a second run with nothing new in the repository writes
 * nothing to Meridian (the v1 contract answers an unchanged upsert with no
 * audit row), and it never uses the whole-book import, so meetings,
 * decisions, actions, approvals and anything typed on a screen survive.
 *
 *   (a) REPO → MERIDIAN
 *       git log + docs/status/*.md  → each module stage: % complete, actual start
 *                                     and finish (first and last commit of its scope),
 *                                     with the status file@commit as the source
 *       the same                    → typed external references (5.25) on the stage:
 *                                     the delivering commit, and the status file and
 *                                     each ADR as sha256 artefacts
 *       the same                    → evidence documents on the phase's exit gate,
 *                                     uri = the file on GitHub pinned to the commit
 *                                     that last changed it (only once that commit is
 *                                     on a remote branch); filed "In review", never
 *                                     approved — approval is a person's act
 *       "Items left validated:false"→ one council-backlog issue per module
 *       docs/legal/founder-checklist.md + GOALS.md gate lines
 *                                   → standing human acts (5.27) that hold each gate;
 *                                     never closed here
 *       docs/legal/counsel-signoff-tracker.md → the counsel backlog issue
 *       pmo/meridian/dogfood-log.md → the dogfooding work items on PRJ-207
 *       book documents with a path  → their uri, pinned to the latest commit
 *   (b) MERIDIAN → weekly-review.md
 *       the generated agenda of the next weekly delivery review, gate status per
 *       phase with what holds each gate, the programme's critical chain and next
 *       activities, plan ("v2.1 plan" baseline) against actuals, top RAID.
 *
 * Fields the repository owns are rewritten from it on every run; everything
 * else (scores, owners, review dates, statuses set on screen) is written only
 * when the row is first created.
 *
 * Usage:
 *   MERIDIAN_URL=http://localhost:4173 MERIDIAN_EMAIL=… MERIDIAN_PASSWORD=… \
 *   [MERIDIAN_KEY=…] [MERIDIAN_HOME=/path/to/Meridian] \
 *     node pmo/meridian/drive.mjs [--as-of 2026-09-24] [--in-progress M10[:2026-09-24]] [--dry-run]
 *
 * MERIDIAN_HOME (default ../meridian next to this repository) is a checkout of
 * the SAME Meridian version: its shared/*.js is the engine the screens run, used
 * read-only to compute gates and the critical path from the served book.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PHASES, LADDER, DOCS as BOOK_DOCS, readGoals } from "./build-book.mjs";
import { session, integration, BASE } from "./meridian-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const opts = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const AS_OF = opt("--as-of") ?? new Date().toISOString().slice(0, 10);
const DRY = argv.includes("--dry-run");
const IN_PROGRESS = new Map(opts("--in-progress").map((s) => { const [m, d] = s.split(":"); return [m.toUpperCase(), d ?? AS_OF]; }));
const MERIDIAN_HOME = resolve(process.env.MERIDIAN_HOME ?? join(ROOT, "..", "meridian"));

/* ── repository truth (pure reads) ─────────────────────────────────── */

const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const day = (isoTs) => isoTs.slice(0, 10);

const HEAD = git("rev-parse", "HEAD");
const BRANCH = git("rev-parse", "--abbrev-ref", "HEAD");
const REPO = (() => {
  const url = git("remote", "get-url", "origin");
  const m = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin is not a GitHub repository: ${url}`);
  return m[1];
})();
const pushedCache = new Map();
/** A commit a reviewer can open: it is on a remote-tracking branch (as last fetched). */
function pushed(sha) {
  if (!pushedCache.has(sha)) {
    let out = "";
    try { out = git("branch", "-r", "--contains", sha); } catch { out = ""; }
    pushedCache.set(sha, out.length > 0);
  }
  return pushedCache.get(sha);
}
const lastCommit = (path) => git("log", "-1", "--format=%H", "--", path) || null;
const blob = (sha, path) => `https://github.com/${REPO}/blob/${sha}/${path}`;
const commitUrl = (sha) => `https://github.com/${REPO}/commit/${sha}`;

/** Every commit, oldest first: { sha, at, subject, scopes: ["m06", …] }. */
const COMMITS = git("log", "--reverse", "--format=%H%x09%aI%x09%s").split("\n").filter(Boolean).map((l) => {
  const [sha, at, subject] = l.split("\t");
  const m = /^[a-z]+(?:\(([^)]+)\))?!?:/.exec(subject);
  return { sha, at, subject, scopes: m?.[1] ? m[1].split(",").map((s) => s.trim().toLowerCase()) : [] };
});

/** A markdown section by its heading prefix, up to the next heading of the same level. */
function section(text, heading) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith("## ") && l.slice(3).startsWith(heading));
  if (i < 0) return "";
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join("\n");
}
const dataRows = (md) => {
  // drop each table's header row (the row before a |---| separator)
  const lines = md.split("\n");
  return lines.filter((l, i) => /^\|/.test(l) && !/^\|\s*:?-/.test(l) && !/^\|\s*:?-/.test(lines[i + 1] ?? ""));
};
const cells = (row) => row.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());

/** One module of the plan, read from the repository. */
function readModule(key, planOwner, phase) {
  const id = key.replace(/[ab]$/, "");
  const scope = id.toLowerCase();
  const commits = COMMITS.filter((c) => c.scopes.includes(scope));
  const statusPath = `docs/status/${id}.md`;
  // M17's status file is the Phase 0 baseline; the Phase 4 completion (M17b) has none yet.
  const hasStatus = key !== "M17b" && existsSync(join(ROOT, statusPath));
  const mod = { key, id, phase, owner: planOwner, commits: commits.length, statusPath: hasStatus ? statusPath : null };
  if (commits.length) {
    mod.firstSha = commits[0].sha; mod.start = day(commits[0].at);
    mod.lastSha = commits.at(-1).sha; mod.finishAt = day(commits.at(-1).at); mod.lastSubject = commits.at(-1).subject;
  }
  if (hasStatus) {
    const text = read(statusPath);
    const result = /^- (?:\*\*)?Result:?(?:\*\*)?:?\s*(.+)$/m.exec(text)?.[1] ?? "";
    mod.result = result.replace(/\*\*/g, "");
    mod.met = /\bmet\b/i.test(result) && !/\bnot met\b/i.test(result);
    mod.freshClone = /^## Fresh clone/m.test(text) || /clean clone|fresh clone/i.test(result);
    mod.statusSha = lastCommit(statusPath);
    mod.statusDigest = sha256(git("show", `${mod.statusSha}:${statusPath}`) + "\n");
    const adrs = [...new Set((section(text, "ADRs added").match(/ADR-\d{3}/g) ?? []))];
    mod.adrs = adrs.map((a) => {
      const file = readdirSync(join(ROOT, "docs/adr")).find((f) => f.startsWith(a + "-"));
      if (!file) return null;
      const path = `docs/adr/${file}`;
      const sha = lastCommit(path);
      const title = (read(path).split("\n").find((l) => l.startsWith("# ")) ?? a).replace(/^#\s*/, "");
      return { id: a, path, sha, title, digest: sha256(git("show", `${sha}:${path}`) + "\n") };
    }).filter(Boolean);
    const vf = section(text, "Items left `validated: false`") || section(text, "Items left `validated:false`");
    mod.unvalidated = dataRows(vf).length;
    mod.seats = [...new Set(vf.match(/\b(?:A[1-6]|B[1-4]|C1)\b/g) ?? [])].sort();
    mod.pe11 = /PE-11/.test(vf);
  }
  /* A split module (M17a baseline / M17b completion) shares its commit scope:
     the later half is started only when told, or when its own status exists. */
  const ownCommits = /b$/.test(key) ? 0 : commits.length;
  mod.state = mod.statusPath && mod.met ? "done"
    : IN_PROGRESS.has(key) || (IN_PROGRESS.has(id) && !/a$/.test(key)) || ownCommits ? "in progress" : "not started";
  if (mod.state === "in progress" && !mod.start) mod.start = IN_PROGRESS.get(key) ?? IN_PROGRESS.get(id);
  return mod;
}

const MODULES = PHASES.flatMap((ph) => ph.modules.map(([key, , , , owner], stage) => ({
  ...readModule(key, owner, ph), project: ph.id, activity: `ACT-${ph.id.slice(4)}-${String(stage + 1).padStart(2, "0")}`,
})));

/* Gate 0: the founder checklist. Every row is a human act. The row says
   when it is due; the gates in GOALS.md say which gate it holds. */
const CHECKLIST_GATE = { "Data-protection filings": 3 }; // "before beta" — the closed beta is Gate 2 (rung 3)
const checklist = dataRows(read("docs/legal/founder-checklist.md")).map((r) => {
  const [item, action, when, owner, status, evidence] = cells(r);
  return { item, action, when, owner, status, evidence, rung: CHECKLIST_GATE[item] ?? 1 };
});
/* Gates 1–4: GOALS.md's own sentence, one act per clause (split on ";").
   A clause that names a repository command (`launch:check`) is proven by
   that command's output, not by a person: it is evidence, not a human act,
   so its comma-separated neighbours become acts of their own. */
const GOALS = readGoals(read("GOALS.md"));
const gateActs = GOALS.gates.filter((g) => g.k > 0).flatMap((g) => g.text.split(/;\s*/)
  .flatMap((clause) => (/\b[a-z]+:[a-z]+\b/.test(clause) ? clause.split(/,\s*/).filter((c) => !/\b[a-z]+:[a-z]+\b/.test(c)) : [clause]))
  .map((clause, i) => ({ rung: g.k + 1, k: g.k, i: i + 1, clause: clause.trim() })));
const counselRows = dataRows(read("docs/legal/counsel-signoff-tracker.md")).map(cells).filter((c) => /^`/.test(c[0] ?? ""));
const counselPending = counselRows.filter((c) => c[3] === "pending").length;
const counselTotal = counselRows.length;

/* The dogfooding log: one work item per finding. */
const dogfood = (() => {
  const text = read("pmo/meridian/dogfood-log.md");
  const out = [];
  let session = null;
  for (const line of text.split("\n")) {
    const s = /^## (Session \d+)\s+—\s+(\d{1,2} \w{3} \d{4})/.exec(line);
    if (s) { session = { name: s[1], date: new Date(s[2] + " UTC").toISOString().slice(0, 10) }; continue; }
    const c = /^\|\s*(DF-\d+)\s*\|/.test(line) ? cells(line) : null;
    if (!c || !session) continue;
    const [id, found, what, kind, upstream, status] = c;
    const plain = (s) => s.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const st = plain(status);
    out.push({
      id, session: session.name, sessionDate: session.date, kind: plain(kind),
      title: `${id} ${plain(what).split(/(?<=[.!?])\s/)[0].slice(0, 180)} — ${plain(upstream)} · ${st}`.slice(0, 290),
      column: /merged|closed|released|fixed in|won.t|withdrawn|by design|adopted/i.test(st) ? "done"
        : /pr open|in review|local branch|committed/i.test(st) ? "review" : "backlog",
      priority: /S1|security/i.test(kind) ? "P1" : /design|process/i.test(kind) ? "P2" : /P3|nice/i.test(kind) ? "P3" : "P2",
    });
  }
  return out;
})();
const sessions = [...new Map(dogfood.map((d) => [d.session, d.sessionDate])).entries()];

/* ── Meridian ──────────────────────────────────────────────────────── */

const log = [];
const note = (s) => { log.push(s); if (!process.env.QUIET) console.log(s); };

console.log(`FitAdapt ${BRANCH}@${HEAD.slice(0, 7)} (${REPO}) → Meridian ${BASE}${DRY ? " (dry run: nothing written)" : ""}`);
const api = await session();
const v1 = DRY ? null : await integration(api);
let book = (await api.call("GET", "/api/bootstrap")).db;
const byExt = (rows, ext) => rows.find((r) => r.externalId === ext && r.externalSource);
const put = async (collection, ext, body) => {
  if (DRY) { note(`would PUT ${collection}/${ext}`); return { created: false }; }
  /* DF-13 (Meridian ≤ 5.36.0, fixed on fix/fitadapt-session-2 as 5.36.1): the
     call that binds a stage drops every field but pct. Bind first, alone. */
  if (collection === "activities" && body.activity && !byExt(book.activities, ext)) {
    await v1("PUT", `/api/v1/activities/${encodeURIComponent(ext)}`, { activity: body.activity });
  }
  const out = await v1("PUT", `/api/v1/${collection}/${encodeURIComponent(ext)}`, body);
  if (out?.created) note(`created ${collection} ${out.id} ← ${ext}`);
  else if (out?.version && out?.changed !== false) { /* v1 reports only a version; changes are counted below */ }
  return out;
};
const counts = { stages: 0, refs: 0, docsCreated: 0, docsUpdated: 0, raidCreated: 0, items: 0 };

if (!DRY && book.settings?.statusDate !== AS_OF) {
  await api.call("PATCH", "/api/admin/settings", { statusDate: AS_OF });
  note(`status date → ${AS_OF}`);
}

/* 1 · module stages: progress and actuals, from the repository */
for (const m of MODULES) {
  const act = book.activities.find((a) => a.id === m.activity);
  if (!act) throw new Error(`${m.activity} (${m.key}) is not in the book — was it bootstrapped from build-book.mjs?`);
  if (m.state === "not started" && !byExt(book.activities, `fitadapt:${m.key}`)) continue; // nothing the repo can say
  const body = { activity: m.activity };
  if (m.state === "done") {
    Object.assign(body, { pct: 100, actualStart: m.start ?? day(git("log", "-1", "--format=%aI", m.statusSha)),
      actualFinish: m.finishAt ?? day(git("log", "-1", "--format=%aI", m.statusSha)),
      source: `${m.statusPath}@${m.statusSha.slice(0, 7)}`, measuredAt: git("log", "-1", "--format=%aI", m.statusSha) });
  } else if (m.state === "in progress") {
    body.actualStart = m.start;
    if (m.commits) Object.assign(body, { source: `git log (${m.id.toLowerCase()}) @${m.lastSha.slice(0, 7)}` });
  } else continue;
  /* Only what moved is sent: Meridian ≤ 5.36.0 rewrites a stage on every
     unchanged re-send (DF-14), which would add an audit row per run. */
  const same = act.externalId === `fitadapt:${m.key}` && (body.pct === undefined || act.pct === body.pct) &&
    act.actualStart === (body.actualStart ?? act.actualStart) && (act.actualFinish ?? null) === (body.actualFinish ?? act.actualFinish ?? null);
  if (same) continue;
  await put("activities", `fitadapt:${m.key}`, body);
  counts.stages++;
  note(`stage ${m.activity} ${m.key}: ${m.state}${body.pct != null ? " " + body.pct + "%" : ""} ${body.actualStart}…${body.actualFinish ?? ""}`);
}

/* The dogfooding stages Meridian itself can vouch for: D01 (the instance
   stood up and the book imported — the log's Session 1), D04 (contributions
   started — the first merged upstream PR in the log). */
if (sessions.length) {
  const first = sessions[0][1];
  const d01 = book.activities.find((a) => a.id === "ACT-207-01");
  if (!(d01.pct === 100 && d01.actualStart === first)) {
    await put("activities", "fitadapt:D01", { activity: "ACT-207-01", pct: 100, actualStart: first, actualFinish: first,
      source: "pmo/meridian/dogfood-log.md (Session 1)" });
    counts.stages++;
  }
  const merged = dogfood.find((d) => d.column === "done");
  const d04 = book.activities.find((a) => a.id === "ACT-207-04");
  if (merged && !d04.actualStart) {
    await put("activities", "fitadapt:D04", { activity: "ACT-207-04", actualStart: merged.sessionDate });
    counts.stages++;
  }
}

/* 2 · typed external references on each delivered stage (5.25): commit, status file, ADRs.
   A commit and an artefact have no state to report (Meridian refuses one). */
const refs = [];
for (const m of MODULES.filter((x) => x.state === "done")) {
  refs.push({ ext: `fitadapt:${m.key}:commit`, kind: "commit", ref: `${REPO}@${m.lastSha}`, url: commitUrl(m.lastSha),
    title: `${m.id} delivered — ${m.lastSubject}`.slice(0, 200), project: m.project, activity: m.activity, sha: m.lastSha });
  refs.push({ ext: `fitadapt:${m.key}:status`, kind: "artefact", ref: `sha256:${m.statusDigest}`, url: blob(m.statusSha, m.statusPath),
    title: `${m.statusPath} @${m.statusSha.slice(0, 7)}`, project: m.project, activity: m.activity, sha: m.statusSha });
  for (const a of m.adrs) refs.push({ ext: `fitadapt:${m.key}:${a.id}`, kind: "artefact", ref: `sha256:${a.digest}`,
    url: blob(a.sha, a.path), title: `${a.path} @${a.sha.slice(0, 7)}`, project: m.project, activity: m.activity, sha: a.sha });
}
for (const r of refs) {
  if (!pushed(r.sha)) { note(`skip reference ${r.ext}: ${r.sha.slice(0, 7)} is not on a remote branch yet`); continue; }
  const held = (book.extLinks ?? []).find((l) => l.externalId === r.ext && !l.supersededAt);
  if (held && held.extId === r.ref && held.url === r.url && held.title === r.title) continue;
  await put("references", r.ext, { project: r.project, activity: r.activity, kind: r.kind, ref: r.ref, url: r.url, title: r.title });
  counts.refs++;
}

/* 3 · evidence documents: one per status file and per ADR, on the exit gate
   of the module's phase, pinned to the commit that last changed the file. */
const wanted = [];
const adrFiled = new Set(); // an ADR is evidence once, on the module that introduced it (later modules amend it)
for (const m of MODULES.filter((x) => x.state === "done")) {
  const rung = m.phase.k + 1;
  wanted.push({ project: m.project, gate: rung, type: "Assurance", owner: m.owner, sha: m.statusSha, path: m.statusPath,
    name: `${m.id} — module status report (${m.statusPath})` });
  for (const a of m.adrs.filter((x) => !adrFiled.has(x.id) && adrFiled.add(x.id))) wanted.push({ project: m.project, gate: rung, type: "Design", owner: m.owner, sha: a.sha, path: a.path,
    name: `${a.title} (${a.path})`.slice(0, 200) });
}
// Book documents that name a repository file: pin their uri; their status stays theirs.
for (const d of BOOK_DOCS.filter((x) => x.path)) {
  wanted.push({ project: d.project, gate: d.gate, type: d.type, owner: d.owner, sha: lastCommit(d.path), path: d.path, name: d.name, book: true });
}
for (const w of wanted) {
  if (!w.sha) { note(`skip document "${w.name}": ${w.path} is not committed`); continue; }
  if (!pushed(w.sha)) { note(`skip document "${w.name}": ${w.sha.slice(0, 7)} is not on a remote branch yet`); continue; }
  const uri = blob(w.sha, w.path);
  const rev = w.sha.slice(0, 7);
  const held = book.docs.find((d) => d.name === w.name && d.project === w.project);
  if (!held) {
    if (w.book) { note(`book document "${w.name}" is missing from Meridian — not recreated`); continue; }
    if (DRY) { note(`would file "${w.name}"`); continue; }
    const { id } = await api.call("POST", "/api/documents", { project: w.project, name: w.name, type: w.type, gate: w.gate,
      owner: w.owner, rev, status: "In review", uri });
    note(`filed ${id} "${w.name}" (In review, gate ${w.gate}) → ${uri}`);
    counts.docsCreated++;
  } else if (held.uri !== uri || (!w.book && held.rev !== rev)) {
    if (DRY) { note(`would re-pin ${held.id} → ${uri}`); continue; }
    const patch = { uri, version: held.version };
    if (!w.book) patch.rev = rev;
    await api.call("PATCH", `/api/documents/${held.id}`, patch);
    note(`re-pinned ${held.id} "${w.name}" → @${rev}${held.status === "Approved" ? " (was Approved: Meridian returns it to review)" : ""}`);
    counts.docsUpdated++;
  }
}

/* 4 · RAID: standing human acts, the council backlog, the counsel backlog.
   Created with an opening score and review date; afterwards only the
   repository's fields (title, detail) are rewritten. A human act is never
   closed here: it closes on its evidence, by its owner, in Meridian. */
const gateDate = (rung) => book.milestones.find((m) => m.project === "PRJ-206" && m.gate === rung)?.date;
const minusDays = (d, n) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);
const raidRows = [];
for (const c of checklist) {
  raidRows.push({ ext: `fitadapt:gate0:${c.item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, type: "Dependency", category: "Human act",
    blocksGate: true, gate: c.rung, project: "PRJ-206", owner: "PE-01", p: 4, i: 5, response: "Fix",
    review: minusDays(gateDate(c.rung), 14),
    title: `${LADDER[c.rung - 1].name.split(" — ")[0]} human act — ${c.item}`,
    detail: `${c.action} When: ${c.when}. Owner: ${c.owner}. Checklist status: ${c.status}. ` +
      `Closes only on its evidence (a signed document, filing receipt or counsel memo referenced from docs/legal/founder-checklist.md). ` +
      `Source: docs/legal/founder-checklist.md@${lastCommit("docs/legal/founder-checklist.md").slice(0, 7)}.`,
    checklistStatus: c.status });
}
for (const a of gateActs) {
  raidRows.push({ ext: `fitadapt:gate${a.k}:act${a.i}`, type: "Dependency", category: "Human act", blocksGate: true,
    gate: a.rung, project: "PRJ-206", owner: "PE-02", p: 3, i: 5, response: "Fix", review: minusDays(gateDate(a.rung), 14),
    title: `Gate ${a.k} human act — ${a.clause.charAt(0).toUpperCase()}${a.clause.slice(1)}`.slice(0, 300),
    detail: `GOALS.md, Gate ${a.k}: "${GOALS.gates[a.k].text}". This clause is done by people (council members, counsel, ` +
      `real alpha or beta users), not by software. Closes only on its evidence: the signed record under docs/governance/sign-offs/, ` +
      `or the consented study report. Source: GOALS.md@${lastCommit("GOALS.md").slice(0, 7)}.` });
}
for (const m of MODULES.filter((x) => x.state === "done" && x.unvalidated > 0)) {
  const aSeats = m.seats.filter((s) => s.startsWith("A"));
  const rung = aSeats.length ? Math.max(2, m.phase.k + 1) : 5; // A-seat items: the phase's exit gate (Gate 1 at the earliest); counsel/security only: launch
  raidRows.push({ ext: `fitadapt:council:${m.key}`, type: "Issue", category: "Council backlog", gate: rung, project: "PRJ-206",
    /* 2 × 3: below the escalation line on purpose — the gate's human act
       (council sign-off) is what escalates; this row is the work list. */
    owner: "PE-02", p: 2, i: 3, response: "Fix", review: minusDays(gateDate(rung), 28),
    title: `Council backlog — ${m.id}: ${m.unvalidated} rows validated:false await ${m.seats.join(", ") || "review"}${m.pe11 ? " (+ PE-11)" : ""}`,
    detail: `Rows listed under "Items left validated:false" in ${m.statusPath}@${m.statusSha.slice(0, 7)} ` +
      `(${blob(m.statusSha, m.statusPath)}). Nothing may be set validated:true without a council sign-off record ` +
      `(docs/governance/03 §5). Seats named: ${m.seats.join(", ") || "none"}; every seat is open (ISS-02).` });
}
raidRows.push({ ext: "fitadapt:counsel:tracker", type: "Issue", category: "Counsel backlog", gate: 5, project: "PRJ-206", owner: "PE-12",
  p: 2, i: 3, response: "Fix", review: minusDays(gateDate(4), 28),
  title: `Counsel backlog — ${counselPending} of ${counselTotal} legal text variants pending counsel review`,
  detail: `docs/legal/counsel-signoff-tracker.md@${lastCommit("docs/legal/counsel-signoff-tracker.md").slice(0, 7)}: every entry is pending. ` +
    "Nothing is counsel-approved; production builds refuse unapproved texts (assertLegalReleaseReady)." });

for (const r of raidRows) {
  const held = byExt(book.raid, r.ext);
  const { ext, checklistStatus, ...body } = r;
  if (!held) {
    await put("raid", ext, body);
    counts.raidCreated++;
  } else if (held.title !== r.title || held.detail !== r.detail) {
    await put("raid", ext, { title: r.title, detail: r.detail });
    note(`updated ${held.id} from the repository`);
  }
  if (checklistStatus && !/^open$/i.test(checklistStatus) && held?.status === "Open") {
    note(`NOTE ${held.id}: the founder checklist says "${checklistStatus}" — its owner closes it in Meridian on its evidence`);
  }
}

/* 5 · dogfooding work items (PRJ-207), one per finding of the log. */
for (const d of dogfood) {
  const held = byExt(book.items, `fitadapt:${d.id}`);
  if (held && held.title === d.title && held.column === d.column) continue;
  await put("workitems", `fitadapt:${d.id}`, held ? { title: d.title, column: d.column }
    : { project: "PRJ-207", title: d.title, column: d.column, assignee: "PE-14", priority: d.priority, points: 1 });
  counts.items++;
}

/* ── (b) Meridian's view → weekly-review.md ────────────────────────── */

book = (await api.call("GET", "/api/bootstrap")).db;
const M = pathToFileURL(join(MERIDIAN_HOME, "shared") + "/").href;
const { Engine } = await import(M + "engine.js");
const { programmeSchedule } = await import(M + "programme.js");
const health = api.health;
if (!existsSync(join(MERIDIAN_HOME, "package.json")) ||
    JSON.parse(readFileSync(join(MERIDIAN_HOME, "package.json"), "utf8")).version !== health.version) {
  console.warn(`warning: ${MERIDIAN_HOME} is not Meridian ${health.version}; its engine may compute differently from the server's`);
}

// The next weekly delivery review: the next Monday after the status date.
const series = book.meetingSeries ?? (await api.call("GET", "/api/meetings/series")).series;
const wdr = (Array.isArray(series) ? series : []).find((s) => /weekly delivery review/i.test(s.name)) ??
  (await api.call("GET", "/api/meetings/series")).series?.find((s) => /weekly delivery review/i.test(s.name));
const nextMonday = (() => { const d = new Date(AS_OF + "T00:00:00Z"); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); })();
let agenda = null, occurrenceId = null;
if (wdr && !DRY) {
  const occ = await api.call("POST", `/api/meetings/series/${wdr.id}/occurrences`, { meetsOn: nextMonday });
  occurrenceId = occ.id;
  if (!occ.existing) note(`scheduled ${occ.id} (${nextMonday})`);
  agenda = (await api.call("GET", `/api/meetings/occurrences/${occ.id}`)).agenda;
}

const fad = book.projects.filter((p) => p.programme === "FAD");
const gates = LADDER.map((g) => {
  const st = Engine.scopedGateStatus(book, "PRJ-201", g.n, 1, "programme");
  const seatName = (id) => (book.seats ?? []).find((s) => s.id === id)?.name ?? id;
  const waiting = new Map();
  for (const d of st.outstanding) {
    const k = d.expectedSeat ? `waiting on ${seatName(d.expectedSeat).replace(/^Council /, "")}`
      : d.status === "In review" ? "in review, waiting on group-level approval (sponsor or Product Owner)"
      : !d.uri ? "not yet produced (no artefact)" : `${d.status}, not yet submitted`;
    waiting.set(k, (waiting.get(k) ?? 0) + 1);
  }
  return { ...g, st, waiting, vetoes: Engine.openVetoes(book, { n: g.n, name: g.name }) };
});
const phaseRows = PHASES.map((ph) => {
  const p = book.projects.find((x) => x.id === ph.id);
  const acts = book.activities.filter((a) => a.project === ph.id);
  const done = acts.filter((a) => a.pct >= 100).length;
  const adv = Engine.canAdvance(book, ph.id);
  return { ph, p, acts, done, adv };
});

const prog = programmeSchedule(book, "FAD", fad);
const actName = (id) => book.activities.find((a) => a.id === id)?.name ?? id;
const complete = (a) => a && (a.pct >= 100 || !!a.actualFinish);
const predsOf = (a) => {
  const own = (a.links ?? a.deps?.map((pred) => ({ pred })) ?? []).map((l) => book.activities.find((x) => x.id === (l.pred ?? l)));
  const cross = (book.crossDeps ?? []).filter((c) => c.to === a.project && c.toStage === a.stage).map((c) =>
    book.activities.find((x) => x.project === c.from && x.stage === c.fromStage));
  return [...own, ...cross].filter(Boolean);
};
const leaves = book.activities.filter((a) => fad.some((p) => p.id === a.project) && !book.activities.some((c) => c.parentId === a.id));
const inFlight = leaves.filter((a) => a.actualStart && !complete(a));
const ready = leaves.filter((a) => !a.actualStart && !complete(a) && predsOf(a).every(complete));
const early = (a) => prog.result?.es?.[a.id] ?? prog.projects?.[a.project]?.es?.[a.id] ?? a.start;
ready.sort((a, b) => String(a.start).localeCompare(String(b.start)));

// Plan (named baseline "v2.1 plan") against actuals, for the module stages.
const baselines = {};
for (const p of fad) {
  const { baselines: list } = await api.call("GET", `/api/projects/${p.id}/baselines`);
  const b = list.find((x) => x.name === "v2.1 plan");
  if (b) for (const r of b.rows ?? []) baselines[r.activity] = r;
}
const wk = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / (7 * 86400000));

const openRaid = book.raid.filter((r) => r.status === "Open")
  .map((r) => ({ r, x: Engine.exposure(r), esc: Engine.escalation(book, r) }))
  .sort((a, b) => b.x - a.x || String(a.r.id).localeCompare(String(b.r.id)));
const person = (id) => Engine.personName(book, id);

/* ── render ── */
const L = [];
const P = (s = "") => L.push(s);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
P("# FitAdapt — weekly delivery review pack");
P();
P(`> Generated by \`pmo/meridian/drive.mjs\` from Meridian ${health.version} (${BASE}) as at **${AS_OF}**, after syncing ` +
  `\`${BRANCH}@${HEAD.slice(0, 7)}\` of ${REPO}. Do not edit by hand: re-run the script. Everything below is Meridian's own ` +
  "computation (its agenda, its gate engine, its schedule) over the book the repository keeps in step.");
P();
P("## Headline");
P();
const g0 = gates[0];
const delivered = MODULES.filter((m) => m.state === "done");
const building = MODULES.filter((m) => m.state === "in progress");
P(`- **Delivery:** ${delivered.length} module stages delivered and pushed (${delivered.map((m) => m.key === "M17a" ? "M17 baseline" : m.id).join(", ")}); ` +
  `${building.length ? building.map((m) => m.id).join(", ") + " in progress" : "nothing in progress"}; ` +
  `${MODULES.filter((m) => m.state === "not started").length} not started.`);
P(`- **Governance:** no gate is passed. The programme is formally at **${g0.name}** (${g0.st.state}), held by ` +
  `${g0.st.holds.length} standing human act(s) and ${g0.st.outstanding.length} evidence document(s) not approved. ` +
  "Every council seat is open, so no sign-off can be given; nothing is counsel-approved or validated.");
const ahead = delivered.filter((m) => baselines[m.activity]).map((m) => wk(m.finishAt, baselines[m.activity].end));
if (ahead.length) {
  P(`- **Plan:** delivery is running ahead of the "v2.1 plan" baseline by ${Math.min(...ahead)}–${Math.max(...ahead)} weeks per ` +
    `module, and Phase 1 work began before Gate 0 cleared (DEP-01: "Gate 0 must clear before Phase 1 starts"). ` +
    "ASM-02 calls for a re-plan after Phase 0: a re-baseline is a change request for the sponsor, not something this script does.");
}
P(`- **Next:** ${phaseRows[0].adv.reason}.`);
P();

P(`## Agenda — ${wdr?.name ?? "weekly delivery review"}, ${nextMonday}${occurrenceId ? ` (Meridian ${occurrenceId})` : ""}`);
P();
if (!agenda) P("_No agenda (dry run, or no weekly delivery review series in the book)._");
for (const s of agenda?.sections ?? []) {
  P(`### ${s.title}${s.note ? ` — ${s.note}` : ""}`);
  P();
  for (const it of s.items) P(`- ${it.urgent ? "**" : ""}${esc(it.headline)}${it.urgent ? "**" : ""}${it.detail ? ` — ${esc(it.detail)}` : ""}`);
  P();
}
P("Standing item (docs/governance/04 §4): dogfooding triage, 5 min — see *Dogfooding* below.");
P();

P("## Gates — what holds each one");
P();
P("FitAdapt's ladder on programme FAD. Every rung is programme-scoped: it clears only when every piece of evidence for it, on every project, is approved and pointing at an artefact, and no standing human act holds it.");
P();
P("| Gate | Meridian state | Evidence approved | Held by human acts | Outstanding evidence |");
P("|---|---|---|---|---|");
for (const g of gates) {
  P(`| ${g.name} (rung ${g.n}) | ${g.st.state}${g.st.date ? ` · ${g.st.date}` : ""} | ${g.st.approved}/${g.st.total} | ${g.st.holds.length} | ` +
    `${[...g.waiting].map(([k, n]) => `${n} ${k}`).join("; ") || "—"} |`);
}
P();
for (const g of gates) {
  P(`### ${g.name}`);
  P();
  P(`*${g.evidence}.*`);
  P();
  if (g.vetoes.length) P(`- **Veto:** ${g.vetoes.map((v) => v.seat.name).join(", ")}`);
  for (const h of g.st.holds) P(`- Held by **${h.id}** · ${esc(h.title)} (${person(h.owner)})`);
  if (!g.st.holds.length) P("- No standing human act holds it.");
  P(`- Evidence: ${g.st.approved} of ${g.st.total} approved. ${[...g.waiting].map(([k, n]) => `${n} ${k}`).join("; ")}.`);
  P();
}

P("## Phases — what Meridian says is next");
P();
P("| Phase | Stages done | Phase (lifecycle) | Can it advance? |");
P("|---|---|---|---|");
for (const r of phaseRows) P(`| ${r.ph.name} | ${r.done}/${r.acts.length} | ${r.p.phase} | ${r.adv.ok ? "yes" : "no"} — ${esc(r.adv.reason)} |`);
P();
P(`**Programme critical chain** (master schedule, ${prog.chain?.length ?? 0} stages, programme finish ${prog.finish ?? "—"}):`);
P();
for (const c of prog.chain ?? []) P(`- ${c.project} · ${esc(c.name)} — ${c.es} → ${c.ef}${c.via?.cross ? ` (cross-project ${c.via.type}${c.via.lag ? "+" + c.via.lag : ""})` : ""}`);
P();
P("**In progress:**");
P();
for (const a of inFlight) P(`- ${a.project} · ${esc(a.name)} — started ${a.actualStart}, ${a.pct}%`);
if (!inFlight.length) P("- none");
P();
P("**Ready to start** (every predecessor complete; planned start from the v2.1 plan):");
P();
for (const a of ready.slice(0, 12)) P(`- ${a.project} · ${esc(a.name)} — planned ${a.start} → ${a.end} (${person(a.owner)})`);
if (ready.length > 12) P(`- … and ${ready.length - 12} more`);
P();

P("## Plan against actuals (named baseline \"v2.1 plan\")");
P();
P("| Module | Status | v2.1 plan | Actual | Evidence |");
P("|---|---|---|---|---|");
for (const m of MODULES) {
  const b = baselines[m.activity];
  const a = book.activities.find((x) => x.id === m.activity);
  const ev = m.statusPath ? `[${m.statusPath}@${m.statusSha.slice(0, 7)}](${blob(m.statusSha, m.statusPath)})` : "—";
  P(`| ${m.key === "M17a" ? "M17 (baseline)" : m.key === "M17b" ? "M17 (completion)" : m.id} | ${m.state} | ${b ? `${b.start} → ${b.end}` : "—"} | ` +
    `${a?.actualStart ? `${a.actualStart} → ${a.actualFinish ?? "…"}` : "—"} | ${ev} |`);
}
P();

P("## Top RAID (open, by exposure)");
P();
P("| ID | Title | Exposure | Escalation | Owner | Gate |");
P("|---|---|---|---|---|---|");
for (const { r, x, esc: e } of openRaid.slice(0, 12)) {
  P(`| ${r.id} | ${esc(r.title)}${r.blocksGate ? " *(holds its gate)*" : ""} | ${x} | ${e.level} | ${esc(person(r.owner))} | ${r.gate ? LADDER[r.gate - 1]?.name.split(" — ")[0] ?? r.gate : "—"} |`);
}
P();
P(`${openRaid.length} open items in all.`);
P();

P("## Council backlog (validated:false, per module)");
P();
P("| Module | Rows listed | Seats | Meridian |");
P("|---|---|---|---|");
for (const m of MODULES.filter((x) => x.state === "done")) {
  const r = byExt(book.raid, `fitadapt:council:${m.key}`);
  P(`| ${m.key === "M17a" ? "M17" : m.id} | ${m.unvalidated} | ${m.seats.join(", ") || "—"}${m.pe11 ? " + PE-11" : ""} | ${r?.id ?? "—"} |`);
}
P();
P(`Counsel: ${counselPending} of ${counselTotal} legal text variants pending (docs/legal/counsel-signoff-tracker.md). ` +
  `"Rows listed" counts the table rows of each status file's validated:false section; a row may cover many values (M06's 152-exercise seed is one row).`);
P();

P("## Dogfooding");
P();
const byCol = (c) => dogfood.filter((d) => d.column === c).length;
P(`${dogfood.length} findings in pmo/meridian/dogfood-log.md: ${byCol("done")} done, ${byCol("review")} in review, ${byCol("backlog")} in the backlog.`);
for (const d of dogfood.filter((x) => x.column !== "done")) P(`- ${esc(d.title)}`);
P();

P("## This sync");
P();
P(`- Stage updates ${counts.stages}, references written ${counts.refs}, documents filed ${counts.docsCreated}, re-pinned ${counts.docsUpdated}, ` +
  `RAID created ${counts.raidCreated}, work items written ${counts.items}.`);
const skipped = log.filter((l) => l.startsWith("skip"));
if (skipped.length) { P(`- Skipped (not pushed or not committed): ${skipped.length}`); for (const s of skipped.slice(0, 10)) P(`  - ${s}`); }
for (const n of log.filter((l) => l.startsWith("NOTE"))) P(`- ${n}`);
P();

if (!DRY) {
  writeFileSync(join(HERE, "weekly-review.md"), L.join("\n"));
  console.log(`wrote pmo/meridian/weekly-review.md (${L.length} lines)`);
} else {
  console.log(L.join("\n"));
}
