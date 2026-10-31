// Runs every 5 minutes from GitHub Actions. Checks each service, keeps the
// last 7 days of individual checks and 90 days of daily uptime, and opens /
// closes a GitHub issue when a service goes down / comes back (GitHub emails
// the repo owner about new issues).
import { readFile, writeFile } from "node:fs/promises";

const TIMEOUT_MS = 15000;
const KEEP_CHECKS = 7 * 24 * 12; // 7 days at one check per 5 minutes
const KEEP_DAYS = 90;
const DOWN_AFTER = 2; // consecutive failures before it counts as an outage

const services = JSON.parse(await readFile("services.json", "utf8"));
const read = async (f, fallback) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return fallback; } };
const checks = await read("data/checks.json", {});
const daily = await read("data/daily.json", {});
const state = await read("data/state.json", {});

const healthCache = new Map();
async function probe(url) {
  if (healthCache.has(url)) return healthCache.get(url);
  const p = (async () => {
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow", headers: { "user-agent": "bevigil-status" } });
      let body = null;
      try { body = await res.json(); } catch {}
      return { httpOk: res.ok, code: res.status, ms: Date.now() - start, body };
    } catch (e) {
      return { httpOk: false, code: 0, ms: Date.now() - start, body: null, error: String(e?.name ?? e) };
    }
  })();
  healthCache.set(url, p);
  return p;
}

const now = new Date();
const day = now.toISOString().slice(0, 10);
const events = [];

for (const s of services) {
  const r = await probe(s.url);
  // A part of /api/health is judged on its own field, so a sign-in outage
  // doesn't show the database as down (or the other way round).
  const part = s.part && r.body ? r.body[s.part] : null;
  const ok = s.part ? Boolean(part?.ok) : r.httpOk;
  const ms = s.part && part ? part.ms : r.ms;

  (checks[s.id] ??= []).push({ t: now.toISOString(), ok, ms, code: r.code });
  checks[s.id] = checks[s.id].slice(-KEEP_CHECKS);

  const d = ((daily[s.id] ??= {})[day] ??= { up: 0, total: 0 });
  d.total++; if (ok) d.up++;
  daily[s.id] = Object.fromEntries(Object.entries(daily[s.id]).sort().slice(-KEEP_DAYS));

  const st = (state[s.id] ??= { fails: 0, down: false, since: null, issue: null });
  if (ok) {
    if (st.down) events.push({ type: "up", s, st: { ...st } });
    Object.assign(st, { fails: 0, down: false, since: null, issue: null });
  } else {
    st.fails++;
    if (!st.down && st.fails >= DOWN_AFTER) {
      st.down = true; st.since = now.toISOString();
      events.push({ type: "down", s, st, code: r.code, error: r.error });
    }
  }
}

// Issues are optional: only when running in Actions with a token.
const repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN;
async function gh(path, method, body) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}
if (repo && token) {
  for (const e of events) {
    if (e.type === "down") {
      const issue = await gh("/issues", "POST", {
        title: `🔴 ${e.s.name} is down`,
        body: `Detected at ${e.st.since} (UTC).\n\nCheck: ${e.s.url}\nResult: ${e.code ? `HTTP ${e.code}` : (e.error ?? "no response")}\n\nThis issue closes automatically when it's back up.`,
        labels: ["outage"],
      });
      e.st.issue = issue?.number ?? null;
    } else if (e.st.issue) {
      const mins = Math.round((now - new Date(e.st.since)) / 60000);
      await gh(`/issues/${e.st.issue}/comments`, "POST", { body: `🟢 Back up at ${now.toISOString()} (UTC), down for about ${mins} minutes.` });
      await gh(`/issues/${e.st.issue}`, "PATCH", { state: "closed" });
    }
  }
}

await writeFile("data/checks.json", JSON.stringify(checks));
await writeFile("data/daily.json", JSON.stringify(daily));
await writeFile("data/state.json", JSON.stringify(state, null, 1));
await writeFile("data/updated.json", JSON.stringify({ at: now.toISOString() }));
console.log(services.map((s) => `${s.id}: ${checks[s.id].at(-1).ok ? "up" : "DOWN"} ${checks[s.id].at(-1).ms}ms`).join("\n"));
