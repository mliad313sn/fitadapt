/**
 * The two doors into Meridian that bootstrap.mjs and drive.mjs use.
 *
 *   session()      a signed-in administrator (MERIDIAN_EMAIL / MERIDIAN_PASSWORD):
 *                  documents, baselines, accounts and meetings have session routes only.
 *   integration()  the named integration "FitAdapt repository sync" and its key
 *                  (PUT /api/v1/*, keyed by our own identifiers, idempotent):
 *                  stage progress and actuals, RAID, references, sprints, work items.
 *
 * The key is shown by Meridian once. It is read from MERIDIAN_KEY, else from
 * a file OUTSIDE the repository ($XDG_STATE_HOME/fitadapt-meridian/<host>.key,
 * mode 0600). With neither, the integration is created (or its key rotated)
 * through the admin session and the new key is written to that file.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BASE = (process.env.MERIDIAN_URL ?? "http://localhost:4173").replace(/\/$/, "");
export const INTEGRATION_NAME = "FitAdapt repository sync";
const SCOPES = "read:meetings,read:portfolio,write:meetings,write:portfolio";

async function request(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${json?.error ?? text.slice(0, 300)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return { json, res };
}

export async function session({ email = process.env.MERIDIAN_EMAIL, password = process.env.MERIDIAN_PASSWORD } = {}) {
  if (!email || !password) {
    console.error("Set MERIDIAN_EMAIL and MERIDIAN_PASSWORD (an administrator account).");
    process.exit(2);
  }
  const { json: health } = await request("GET", "/api/health");
  const [maj, min] = String(health.version).split(".").map(Number);
  if (!(maj > 5 || (maj === 5 && min >= 36))) {
    console.error(`Meridian ${health.version} at ${BASE}: these scripts need 5.36.0 or later.`);
    process.exit(2);
  }
  let cookie = "";
  const call = async (method, path, body) => {
    const { json, res } = await request(method, path, body, cookie ? { cookie } : {});
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      if (pair.startsWith("meridian_sid=")) cookie = pair;
    }
    return json;
  };
  await call("POST", "/api/auth/login", { email, password });
  return { call, health };
}

function keyFile() {
  const dir = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "fitadapt-meridian");
  return { dir, file: join(dir, new URL(BASE).host.replace(/[^A-Za-z0-9.-]/g, "_") + ".key") };
}

export async function integration(api) {
  let key = process.env.MERIDIAN_KEY;
  const { dir, file } = keyFile();
  if (!key && existsSync(file)) key = readFileSync(file, "utf8").trim();
  const v1 = (k) => async (method, path, body) => (await request(method, path, body, { authorization: `Bearer ${k}` })).json;
  if (key) {
    try { await v1(key)("GET", "/api/v1"); return v1(key); } catch (e) { if (e.status !== 401) throw e; }
  }
  const { integrations } = await api.call("GET", "/api/admin/integrations");
  const mine = integrations.find((i) => i.name === INTEGRATION_NAME);
  const out = mine
    ? await api.call("POST", `/api/admin/integrations/${mine.id}/rotate`, { version: mine.row_version })
    : await api.call("POST", "/api/admin/integrations", {
        name: INTEGRATION_NAME, scopes: SCOPES,
        purpose: "pmo/meridian/drive.mjs — pushes the FitAdapt repository's state (git log, docs/status) into the book",
      });
  key = out.key ?? out.plain ?? out.apiKey;
  if (!key) throw new Error("Meridian did not return the integration key: " + JSON.stringify(Object.keys(out)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, key + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`integration "${INTEGRATION_NAME}" ${mine ? "key rotated" : "created"}; key kept in ${file}`);
  return v1(key);
}
