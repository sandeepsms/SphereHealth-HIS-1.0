/**
 * scripts/_abdm_milestone_dryrun.js — ABDM M1–M4 milestone conformance DRY-RUN
 *
 * This is NOT the real NHA sandbox certification (which needs registered ABDM
 * credentials, a public HTTPS callback URL, and the NHA portal). It is a LOCAL
 * conformance harness that stands up a mock ABDM gateway and drives the exact
 * M1–M4 gateway→HIP callback shapes against the running HIS, asserting the HIP:
 *   • M1 Discovery — matches a patient + replies on-discover with care contexts
 *   • M2 Linking   — links an ABHA + replies link/on-init
 *   • M3 Consent   — stores a granted consent artefact + acks on-notify
 *   • M4 Data flow — on a consented HI request, assembles + encrypts a FHIR
 *                    document bundle, pushes it to the HIU, notifies; the driver
 *                    decrypts it back to prove the end-to-end HIE crypto.
 *
 * Prereqs: the HIS backend must be running on :5050 WITH ABDM enabled + the
 * gateway URLs pointed at this mock:
 *   ABDM_ENABLED=1 ABDM_CLIENT_ID=test ABDM_CLIENT_SECRET=test ABDM_HIP_ID=IN-TEST \
 *   ABDM_CALLBACK_HMAC_SECRET=testsecret \
 *   ABDM_GATEWAY_BASE_URL=http://localhost:5599/gateway \
 *   ABDM_SESSION_URL=http://localhost:5599/gateway/v0.5/sessions node index.js
 * and a patient UH01 with at least one admission must exist (E2E OPD flow seeds it).
 */
"use strict";

const http = require("http");
const crypto = require("crypto");
const abdmCrypto = require("../services/Abdm/abdmCrypto");

const HIS = { host: "localhost", port: 5050 };
const MOCK_PORT = 5599;
const HMAC_SECRET = "testsecret";
const UHID = process.env.DRYRUN_UHID || "UH01";
const ABHA_ADDRESS = "dryrun@sbx";
const ABHA_NUMBER = "11-1111-1111-1111";

const captured = [];  // on-* + data-push bodies the HIS sends to the mock gateway
const results = [];
const R = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "✅ PASS" : "❌ FAIL"} | ${name}${detail ? " | " + detail : ""}`); };

function sign(raw) { return crypto.createHmac("sha256", HMAC_SECRET).update(Buffer.from(raw, "utf8")).digest("base64"); }
function j(s) { try { return JSON.parse(s); } catch { return s; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function req(method, path, obj, { hmac = false, token } = {}) {
  return new Promise((resolve) => {
    const raw = obj ? JSON.stringify(obj) : "";
    const headers = { "Content-Type": "application/json" };
    if (raw) headers["Content-Length"] = Buffer.byteLength(raw);
    if (hmac) headers["X-HMAC"] = sign(raw);
    if (token) headers.Authorization = "Bearer " + token;
    const r = http.request({ ...HIS, path, method, headers }, (res) => {
      let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve({ status: res.statusCode, body: j(b) }));
    });
    r.on("error", (e) => resolve({ status: 0, body: String(e) }));
    if (raw) r.write(raw); r.end();
  });
}
const findCaptured = (suffix) => captured.find((c) => c.url.endsWith(suffix));

(async () => {
  // 1. mock ABDM gateway — sessions + capture every on-*/data-push
  const mock = http.createServer((r, s) => {
    let body = ""; r.on("data", (c) => body += c);
    r.on("end", () => {
      if (r.url.endsWith("/sessions")) {
        s.writeHead(200, { "Content-Type": "application/json" });
        return s.end(JSON.stringify({ accessToken: "mock-token", expiresIn: 1200, tokenType: "bearer" }));
      }
      captured.push({ url: r.url, body: j(body) });
      s.writeHead(202, { "Content-Type": "application/json" }); s.end(JSON.stringify({ status: "accepted" }));
    });
  });
  await new Promise((res) => mock.listen(MOCK_PORT, res));
  console.log(`[dryrun] mock ABDM gateway on :${MOCK_PORT}`);

  // 2. wait for HIS + admin login
  let token = "";
  for (let i = 0; i < 30; i++) {
    const r = await req("POST", "/api/auth/login", { email: "admin@spherehealth.com", password: "123" });
    if (r.status === 200 && r.body?.token) { token = r.body.token; break; }
    await sleep(1000);
  }
  if (!token) { R("HIS reachable + admin login", false, "no token after 30s"); process.exit(1); }
  const st = await req("GET", "/api/abdm/status", null, { token });
  const enabled = st.body?.data?.config?.enabled;
  R("ABDM enabled on the HIS", !!enabled, `enabled=${enabled}, ready=${st.body?.data?.config?.ready}`);
  if (!enabled) { console.log("[dryrun] start the HIS with ABDM_ENABLED=1 + gateway→mock. Aborting."); process.exit(1); }

  const now = new Date();
  const future = new Date(now.getTime() + 7 * 864e5).toISOString();

  // ── M2 (HIP-side): link an ABHA + materialise care contexts ──────
  const link = await req("POST", "/api/abdm/link-abha", { uhid: UHID, abhaNumber: ABHA_NUMBER, abhaAddress: ABHA_ADDRESS, kycVerified: true }, { token });
  const ccRef = link.body?.data?.careContexts?.[0]?.ref;
  R("M2 · ABHA link + care contexts", link.status === 200 && !!ccRef, `linked=${link.body?.data?.abhaLinked}, careContexts=${link.body?.data?.careContextsLinked}, firstRef=${ccRef}`);

  // ── M2 (CM callback): link/init → HIP replies link/on-init ────────
  captured.length = 0;
  const li = await req("POST", "/api/abdm/v0.5/links/link/init",
    { requestId: crypto.randomUUID(), transactionId: "TXN-LINK-1", patient: { id: ABHA_ADDRESS, referenceNumber: UHID, careContexts: [{ referenceNumber: ccRef }] } },
    { hmac: true });
  await sleep(900);
  const onInit = findCaptured("/links/link/on-init");
  R("M2 · link/init → on-init reply", li.status === 202 && !!onInit?.body?.link?.referenceNumber, `ack=${li.status}, onInit=${!!onInit}`);

  // ── M1: discovery → HIP replies on-discover with care contexts ────
  captured.length = 0;
  const disc = await req("POST", "/api/abdm/v0.5/care-contexts/discover",
    { requestId: crypto.randomUUID(), transactionId: "TXN-DISC-1", patient: { id: ABHA_ADDRESS, unverifiedIdentifiers: [{ type: "ABHA_ADDRESS", value: ABHA_ADDRESS }] } },
    { hmac: true });
  await sleep(900);
  const onDisc = findCaptured("/care-contexts/on-discover");
  const discCcs = onDisc?.body?.patient?.careContexts || [];
  R("M1 · discovery → on-discover with care contexts", disc.status === 202 && discCcs.length > 0, `ack=${disc.status}, matched=${!!onDisc?.body?.patient}, contexts=${discCcs.length}`);

  // ── M1: bad signature is rejected (401) ──────────────────────────
  const badSig = await new Promise((resolve) => {
    const raw = JSON.stringify({ requestId: "x", patient: {} });
    const r = http.request({ ...HIS, path: "/api/abdm/v0.5/care-contexts/discover", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw), "X-HMAC": "deadbeef" } },
      (res) => { let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve({ status: res.statusCode })); });
    r.on("error", () => resolve({ status: 0 })); r.write(raw); r.end();
  });
  R("M1 · bad HMAC rejected (401)", badSig.status === 401, `status=${badSig.status}`);

  // ── M3: consent notify → artefact stored + on-notify ack ─────────
  captured.length = 0;
  const consentId = "CONSENT-DRYRUN-" + Date.now();
  const cn = await req("POST", "/api/abdm/v0.5/consents/hip/notify",
    { requestId: crypto.randomUUID(), timestamp: now.toISOString(), notification: {
        consentId, status: "GRANTED",
        consentDetail: {
          patient: { id: ABHA_ADDRESS }, hip: { id: "IN-TEST" }, hiu: { id: "hiu-clinic", name: "Test Clinic" },
          hiTypes: ["OPConsultation"],
          careContexts: [{ patientReference: UHID, careContextReference: ccRef }],
          permission: { accessMode: "VIEW", dateRange: { from: new Date(now.getTime() - 365 * 864e5).toISOString(), to: now.toISOString() }, dataEraseAt: future },
        },
        signature: "mock-signature",
      } }, { hmac: true });
  await sleep(900);
  const onNotify = findCaptured("/consents/hip/on-notify");
  R("M3 · consent notify → on-notify ack", cn.status === 202 && !!onNotify, `ack=${cn.status}, onNotify=${!!onNotify}`);

  // ── M4: HI request → assemble + encrypt + push + decrypt ─────────
  captured.length = 0;
  const hiu = abdmCrypto.generateKeyMaterial();  // the HIU's ephemeral keys
  const hir = await req("POST", "/api/abdm/v0.5/health-information/hip/request",
    { requestId: crypto.randomUUID(), transactionId: "TXN-HI-1", hiRequest: {
        consent: { id: consentId },
        dateRange: { from: new Date(now.getTime() - 365 * 864e5).toISOString(), to: now.toISOString() },
        dataPushUrl: `http://localhost:${MOCK_PORT}/hiu/data-push`,
        keyMaterial: hiu.keyMaterial,
      } }, { hmac: true });
  await sleep(1500);
  const onReq = findCaptured("/health-information/hip/on-request");
  const push = findCaptured("/hiu/data-push");
  const notify = findCaptured("/health-information/notify");
  R("M4 · HI request → on-request ack", hir.status === 202 && !!onReq, `ack=${hir.status}, onRequest=${!!onReq}`);

  let decryptedOk = false, bundleOk = false, checksumOk = false;
  if (push?.body?.entries?.length) {
    try {
      const entry = push.body.entries[0];
      const plaintext = abdmCrypto.decrypt({
        cipherB64: entry.content, receiverPrivateKey: hiu.privateKey,
        senderPublicKeyB64: push.body.keyMaterial.dhPublicKey.keyValue,
        senderNonceB64: push.body.keyMaterial.nonce, receiverNonceB64: hiu.nonceBase64,
      });
      const bundle = JSON.parse(plaintext);
      decryptedOk = true;
      bundleOk = bundle.resourceType === "Bundle" && bundle.type === "document" && bundle.entry?.[0]?.resource?.resourceType === "Composition";
      checksumOk = abdmCrypto.checksum(plaintext) === entry.checksum;
    } catch (e) { console.log("[dryrun] decrypt error:", e.message); }
  }
  R("M4 · encrypted FHIR pushed to HIU", !!push?.body?.entries?.length, `entries=${push?.body?.entries?.length || 0}`);
  R("M4 · HIU decrypts → FHIR document bundle", decryptedOk && bundleOk, `decrypted=${decryptedOk}, documentBundle=${bundleOk}, checksum=${checksumOk}`);
  R("M4 · transfer status notified", !!notify, `notify=${!!notify}`);

  // ── summary ──────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(56)}\nABDM milestone dry-run: ${passed}/${results.length} checks passed`);
  console.log("(local mock gateway — NOT the NHA sandbox certification)\n");
  mock.close();
  process.exit(passed === results.length ? 0 : 1);
})();
