// scripts/loadTest.js
// ════════════════════════════════════════════════════════════════════
// R7bx-4 — In-process load test harness. Spawns N virtual users (each
// in a dedicated worker_thread) and hammers a randomised cocktail of
// the most-touched API endpoints. Designed to validate p95 < 800 ms
// for the production launch checklist.
//
// USAGE:
//   node scripts/loadTest.js                     # defaults: 50 users, 30 min
//   node scripts/loadTest.js --users=100 --duration=300   # 100 users, 5 min
//   BASE_URL=http://staging:5050 node scripts/loadTest.js
//
// REQUIREMENTS:
//   - The target server must be reachable at BASE_URL.
//   - A CSV file `Backend/scripts/loadTest.creds.csv` listing one
//     virtual user per line:
//         email,password,role
//         dr1@sphere.local,Password1!,Doctor
//         nurse1@sphere.local,Password1!,Nurse
//     If the file is missing the script logs a hint and exits 1
//     (we DO NOT ship default creds — production safety).
//
// REPORTING:
//   Every 30s the main thread prints a rolling latency table per
//   endpoint:
//     endpoint                        | calls | err | p50  | p95  | p99
//     GET /api/admissions/active      |  1234 |  2  | 120ms| 380ms| 520ms
//   On completion it emits a final summary line and a JSON file
//   `Backend/scripts/loadTest.<startTs>.json` for archival.
//
// EXPECTED BASELINE (production single-node, 16 GiB RAM, Mongo local):
//   p95 < 800 ms across every endpoint with 50 concurrent users.
//   Error rate < 0.5 %.
// ════════════════════════════════════════════════════════════════════
"use strict";

const path  = require("path");
const fs    = require("fs");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = process.env.LOAD_TEST_BASE_URL || process.env.BASE_URL || "http://localhost:5050";

function parseArgs(argv) {
  const out = { users: 50, durationSec: 30 * 60, baseUrl: BASE_URL };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--users="))      out.users       = parseInt(a.slice(8), 10);
    else if (a.startsWith("--duration=")) out.durationSec = parseInt(a.slice(11), 10);
    else if (a.startsWith("--base-url=")) out.baseUrl   = a.slice(11);
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

// Quantile helper — operates on a sorted ascending numeric array.
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

// ════════════════════════════════════════════════════════════════════
// WORKER ENTRYPOINT
// One worker per virtual user. The worker:
//   1. Logs in (POST /api/auth/login) — token cached.
//   2. Loops for `durationMs`:
//        - Picks a random endpoint from the menu (weighted to GETs).
//        - Calls it, measures latency, captures (endpoint, ms, ok).
//        - Sleeps 100-700 ms between calls (think-time).
//   3. Posts an aggregate batch back to the main thread every 5 s.
// ════════════════════════════════════════════════════════════════════
async function workerMain() {
  const { creds, durationMs, baseUrl, userIndex } = workerData;
  const t0 = Date.now();
  const samples = [];                   // {endpoint, ms, ok}
  let totalCalls = 0, totalErr = 0;

  // Helper — wrap fetch with timing + error capture.
  async function timedFetch(method, urlPath, body) {
    const start = Date.now();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let ok = false;
    try {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        // Express defaults to 2-min request timeout; keep ours shorter
        // so a stuck call doesn't peg the worker.
        signal: AbortSignal.timeout(30_000),
      });
      ok = res.ok;
      // Drain body to free the socket.
      try { await res.text(); } catch (_) { /* ignore */ }
    } catch (_) {
      ok = false;
    }
    const ms = Date.now() - start;
    samples.push({ endpoint: `${method} ${urlPath.split("?")[0]}`, ms, ok });
    totalCalls += 1;
    if (!ok) totalErr += 1;
  }

  // Authenticate.
  let token = null;
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    token = j?.token || j?.accessToken || j?.data?.token || null;
    if (!token) {
      parentPort.postMessage({ kind: "fatal", userIndex, reason: `login failed: HTTP ${res.status}` });
      return;
    }
  } catch (e) {
    parentPort.postMessage({ kind: "fatal", userIndex, reason: `login crashed: ${e.message}` });
    return;
  }

  // Pre-grab a UHID to use for per-patient endpoints. We try `/api/admissions/active`
  // and extract the first row's UHID. If nothing comes back we still run the
  // global endpoints but skip per-patient ones.
  let sampleUHID = null;
  try {
    const r = await fetch(`${baseUrl}/api/admissions/active`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    // Response shape varies; try a few likely keys.
    const list = j?.data || j?.admissions || j?.rows || (Array.isArray(j) ? j : []);
    if (list && list[0]) sampleUHID = list[0].UHID || list[0].uhid || null;
  } catch (_) { /* ignore — endpoint still gets tested below */ }

  // Endpoint menu — weighted toward reads (matches real hospital traffic).
  // Each entry is a thunk that performs the call.
  function pickAndCall() {
    const r = Math.random();
    if (r < 0.30)        return timedFetch("GET",  "/api/admissions/active");
    if (r < 0.55)        return timedFetch("GET",  `/api/doctor-orders${sampleUHID ? `?UHID=${sampleUHID}` : ""}`);
    if (r < 0.75 && sampleUHID) return timedFetch("GET",  `/api/patient-history/${sampleUHID}/file`);
    if (r < 0.88)        return timedFetch("POST", "/api/doctor-orders", {
                              orderType:  "Medication",
                              medication: "Paracetamol 500mg",
                              route:      "PO",
                              frequency:  "BD",
                              duration:   "3 days",
                              UHID:       sampleUHID || "UH00000001",
                              _loadTest:  true,
                            });
    return timedFetch("PATCH", "/api/doctor-orders/__load_test_id__/status", { status: "Acknowledged" });
  }

  // Periodic flush to main thread.
  const flushIntervalMs = 5000;
  const flushTimer = setInterval(() => {
    if (!samples.length) return;
    parentPort.postMessage({ kind: "batch", userIndex, samples: samples.splice(0) });
  }, flushIntervalMs);

  // Main loop.
  const deadline = t0 + durationMs;
  while (Date.now() < deadline) {
    try {
      await pickAndCall();
    } catch (e) {
      // Should be near-impossible because timedFetch never throws, but
      // belt-and-braces so a worker can't die mid-test.
      console.error(`[worker ${userIndex}] iter error: ${e.message}`);
    }
    // Think time so we're not microbenchmarking the loop itself.
    const sleep = 100 + Math.floor(Math.random() * 600);
    await new Promise((r) => setTimeout(r, sleep));
  }

  clearInterval(flushTimer);
  parentPort.postMessage({ kind: "batch", userIndex, samples: samples.splice(0) });
  parentPort.postMessage({ kind: "done", userIndex, totalCalls, totalErr });
}

// ════════════════════════════════════════════════════════════════════
// MAIN THREAD
// ════════════════════════════════════════════════════════════════════
async function mainThread() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log("Usage: node scripts/loadTest.js [--users=N] [--duration=SEC] [--base-url=URL]");
    process.exit(0);
  }
  console.log(`[load-test] users=${opts.users} duration=${opts.durationSec}s base=${opts.baseUrl}`);

  // Credential CSV.
  const credsPath = path.join(__dirname, "loadTest.creds.csv");
  if (!fs.existsSync(credsPath)) {
    console.error(`[load-test] missing creds file: ${credsPath}`);
    console.error("[load-test] expected format (no header allowed but recommended):");
    console.error("  email,password,role");
    console.error("  dr1@sphere.local,Password1!,Doctor");
    console.error("  nurse1@sphere.local,Password1!,Nurse");
    console.error("[load-test] refusing to run without explicit credentials");
    process.exit(1);
  }
  const lines = fs.readFileSync(credsPath, "utf8").split(/\r?\n/).filter(Boolean);
  const credList = [];
  for (const line of lines) {
    if (line.toLowerCase().startsWith("email,")) continue; // header
    const [email, password, role] = line.split(",").map((s) => s?.trim());
    if (!email || !password) continue;
    credList.push({ email, password, role: role || "Doctor" });
  }
  if (credList.length === 0) {
    console.error("[load-test] creds file empty");
    process.exit(1);
  }
  if (credList.length < opts.users) {
    console.warn(`[load-test] only ${credList.length} creds in CSV — will round-robin to fill ${opts.users} workers`);
  }

  // Per-endpoint accumulator: name -> { count, errCount, latencies[] }
  const stats = new Map();
  function recordSample(s) {
    if (!stats.has(s.endpoint)) stats.set(s.endpoint, { count: 0, err: 0, lats: [] });
    const e = stats.get(s.endpoint);
    e.count += 1;
    if (!s.ok) e.err += 1;
    e.lats.push(s.ms);
  }

  // Render the rolling table.
  function printTable(label) {
    console.log(`\n[load-test] ${label}`);
    const headers = ["endpoint", "calls", "err", "p50", "p95", "p99"];
    const rows = [];
    for (const [endpoint, e] of stats) {
      const sorted = e.lats.slice().sort((a, b) => a - b);
      rows.push([
        endpoint.padEnd(46),
        String(e.count).padStart(6),
        String(e.err).padStart(4),
        `${quantile(sorted, 0.50).toFixed(0)}ms`.padStart(8),
        `${quantile(sorted, 0.95).toFixed(0)}ms`.padStart(8),
        `${quantile(sorted, 0.99).toFixed(0)}ms`.padStart(8),
      ]);
    }
    console.log(headers.map((h, i) => i === 0 ? h.padEnd(46) : h.padStart(8)).join(" | "));
    for (const r of rows) console.log(r.join(" | "));
  }

  // Spawn workers.
  const startTs = Date.now();
  const durationMs = opts.durationSec * 1000;
  const workers = [];
  for (let i = 0; i < opts.users; i++) {
    const creds = credList[i % credList.length];
    const w = new Worker(__filename, {
      workerData: { creds, durationMs, baseUrl: opts.baseUrl, userIndex: i },
    });
    w.on("message", (msg) => {
      if (msg.kind === "batch") {
        for (const s of msg.samples) recordSample(s);
      } else if (msg.kind === "fatal") {
        console.error(`[worker ${msg.userIndex}] FATAL: ${msg.reason}`);
      } else if (msg.kind === "done") {
        // Done summary handled below.
      }
    });
    w.on("error", (err) => console.error(`[worker ${i}] error: ${err.message}`));
    workers.push(w);
  }

  // Rolling-status timer (every 30s).
  const reportTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTs) / 1000);
    printTable(`@t=${elapsed}s`);
  }, 30_000);

  // Wait for all workers.
  await Promise.all(workers.map((w) => new Promise((r) => w.on("exit", r))));
  clearInterval(reportTimer);

  // Final summary.
  printTable("FINAL");
  const totalCalls = [...stats.values()].reduce((a, e) => a + e.count, 0);
  const totalErr   = [...stats.values()].reduce((a, e) => a + e.err, 0);
  const allLats    = [...stats.values()].flatMap((e) => e.lats).sort((a, b) => a - b);
  const errorRate  = totalCalls ? (100 * totalErr / totalCalls).toFixed(2) : "0.00";
  console.log(
    `\n[load-test] DONE  totalCalls=${totalCalls} errors=${totalErr} (${errorRate}%) ` +
    `p50=${quantile(allLats, 0.5).toFixed(0)}ms ` +
    `p95=${quantile(allLats, 0.95).toFixed(0)}ms ` +
    `p99=${quantile(allLats, 0.99).toFixed(0)}ms`,
  );

  // Archive JSON.
  const archive = {
    startedAt: new Date(startTs).toISOString(),
    durationSec: opts.durationSec,
    users: opts.users,
    baseUrl: opts.baseUrl,
    totals: { calls: totalCalls, errors: totalErr, errorRatePct: Number(errorRate) },
    perEndpoint: Object.fromEntries(
      [...stats.entries()].map(([k, v]) => {
        const sorted = v.lats.slice().sort((a, b) => a - b);
        return [k, {
          count: v.count,
          err:   v.err,
          p50:   quantile(sorted, 0.50),
          p95:   quantile(sorted, 0.95),
          p99:   quantile(sorted, 0.99),
        }];
      }),
    ),
  };
  const outFile = path.join(__dirname, `loadTest.${startTs}.json`);
  try {
    fs.writeFileSync(outFile, JSON.stringify(archive, null, 2));
    console.log(`[load-test] archive: ${outFile}`);
  } catch (e) {
    console.warn(`[load-test] could not write archive: ${e.message}`);
  }

  process.exit(0);
}

if (isMainThread) {
  mainThread().catch((err) => {
    console.error(`[load-test] main crashed: ${err.message}`);
    process.exit(1);
  });
} else {
  workerMain().catch((err) => {
    console.error(`[worker] crashed: ${err.message}`);
    process.exit(1);
  });
}
