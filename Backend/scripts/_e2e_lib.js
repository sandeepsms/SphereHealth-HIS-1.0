// _e2e_lib.js — shared helpers for the E2E acceptance drivers.
// Not committed; deleted after the run.
const BASE = "http://localhost:5050/api";

const TOKENS = {};
async function login(role) {
  const email = {
    admin: "admin@spherehealth.com", reception: "receptionist@spherehealth.com",
    doctor: "doctor@spherehealth.com", nurse: "nurse@spherehealth.com",
    pharmacy: "pharmacy@spherehealth.com", lab: "lab@spherehealth.com",
    radio: "radio@spherehealth.com", dietician: "dietician@spherehealth.com",
    accountant: "accountant@spherehealth.com", wardboy: "wardboy@spherehealth.com",
    housekeeping: "housekeeping@spherehealth.com", security: "security@spherehealth.com",
    physio: "physio@spherehealth.com", tpa: "tpa@spherehealth.com",
  }[role] || role;
  if (TOKENS[email]) return TOKENS[email];
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "123" }) });
  const d = await r.json();
  if (!d.token) throw new Error(`login failed for ${email}: ${JSON.stringify(d).slice(0,150)}`);
  return (TOKENS[email] = d.token);
}

// call(role, method, path, body?) → {status, data}
async function call(role, method, path, body) {
  const token = await login(role);
  const opts = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(`${BASE}${path}`, opts);
  let data; try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}
const D = (res) => (res && res.data && (res.data.data !== undefined ? res.data.data : res.data)); // unwrap {success,data}

// results collector → markdown table rows
function makeReport(title) {
  const rows = [];
  let pass = 0, fail = 0;
  const t = (aspect, ok, detail = "") => {
    ok ? pass++ : fail++;
    rows.push({ aspect, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${aspect}${detail ? " — " + detail : ""}`);
  };
  const md = () => {
    let s = `\n### ${title}\n\n| # | Aspect | Result | Detail |\n|---|---|:---:|---|\n`;
    rows.forEach((r, i) => { s += `| ${i + 1} | ${r.aspect} | ${r.ok ? "✅ PASS" : "❌ FAIL"} | ${String(r.detail).replace(/\|/g, "\\|").slice(0, 200)} |\n`; });
    s += `\n**${pass}/${pass + fail} passed.**\n`;
    return s;
  };
  return { t, md, summary: () => ({ pass, fail }) };
}

module.exports = { BASE, login, call, D, makeReport };
