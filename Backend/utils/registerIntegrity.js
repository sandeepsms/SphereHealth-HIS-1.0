/**
 * registerIntegrity.js — D19 / NABH register tamper-evidence
 *
 * Only PatientActivityLog is hash-chained today. The surveyor-critical NABH
 * registers (Mortality / Sentinel / RCA / Near-Miss / CSSD load-record /
 * Medication-Error / Emergency) are editable via `.save()` in their PATCH
 * handlers with only a self-reported `auditTrail`, so a holder with direct
 * database access could silently alter a row a surveyor already inspected.
 *
 * This module adds a reusable Mongoose plugin that stamps a keyed
 * HMAC-SHA256 integrity digest on every save, computed over a canonical
 * subset of the row's MATERIAL fields (everything in the schema except the
 * integrity fields themselves, volatile timestamps, and the append-only
 * audit / timeline sub-document arrays). The digest is keyed by a private,
 * server-held secret (env REGISTER_HMAC_SECRET) so an out-of-band editor who
 * does not hold that secret cannot forge a matching digest — the mismatch is
 * detectable by the verify helper.
 *
 * Scope + honest limits:
 *   • This is tamper-EVIDENCE per row, NOT a full inter-row hash chain — it
 *     detects content edits, not row deletion / re-ordering. (PatientActivityLog
 *     keeps the inter-row chain for the audit feed.)
 *   • A legitimate in-app PATCH re-stamps the digest, so this does not stop an
 *     authorised edit — those are already recorded in auditTrail. It detects
 *     edits made OUTSIDE the app (mongosh, a tampered backup, a DBA) that
 *     bypass this pre-save hook and cannot recompute the keyed digest.
 *
 * Non-blocking + backward-compatible:
 *   • The pre-save hook never throws — a stamp bug must not roll back a
 *     clinical/register write.
 *   • Rows with no stored digest (created before D19, or written via a
 *     hook-bypassing path such as findOneAndUpdate) verify as "legacy"
 *     (unverified), NEVER as "tampered".
 */
"use strict";

const crypto = require("crypto");

// D19 — keyed with a private, server-held secret. The dev default lets the
// suite + local dev run without config, but tamper-evidence is only meaningful
// once REGISTER_HMAC_SECRET is set to a real secret in production.
const DEV_DEFAULT_SECRET =
  "sphere-health-register-integrity-dev-secret-CHANGE-IN-PROD";
// R8-FIX(#33): NEVER fall back to the source-known dev default in production —
// that would make every register tamper-evidence digest forgeable by anyone
// holding the (resale) source. Backend/index.js also fail-fasts on a missing
// REGISTER_HMAC_SECRET in prod; this guard additionally protects standalone
// prod scripts that require this module without booting index.js.
const SECRET =
  process.env.REGISTER_HMAC_SECRET ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error(
          "[registerIntegrity] REGISTER_HMAC_SECRET must be set in production — " +
            "refusing to fall back to the source-known dev default.",
        );
      })()
    : DEV_DEFAULT_SECRET);
const INTEGRITY_VERSION = 1;
const INTEGRITY_ALGO = "HMAC-SHA256";

let _warnedInsecure = false;
function _maybeWarnInsecure() {
  if (_warnedInsecure) return;
  if (SECRET === DEV_DEFAULT_SECRET) {
    _warnedInsecure = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[registerIntegrity] REGISTER_HMAC_SECRET is not set — using the built-in " +
      "DEV default. Register tamper-evidence is only meaningful once you set " +
      "REGISTER_HMAC_SECRET to a private, server-held value in production.",
    );
  }
}

// Fields excluded from the canonical digest, by top-level name:
//   • _id/__v            — identity / version, not material content
//   • createdAt/updatedAt — volatile Mongoose timestamps
//   • auditTrail/timeline — append-only self-reported sub-doc arrays that
//                           legitimately grow on every PATCH
//   • integrity*         — the digest's own fields (must not hash itself)
const IGNORE = new Set([
  "_id", "__v", "id",
  "createdAt", "updatedAt",
  "auditTrail", "timeline",
  "integrityDigest", "integrityAlgo", "integrityAt", "integrityVersion",
]);

// Deterministic normaliser so a value hashes identically at save time (live
// doc) and at verify time (doc re-hydrated from Mongo).
function _norm(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.map(_norm);
  if (typeof v === "object") {
    if (typeof v.toHexString === "function") return v.toString(); // ObjectId
    if (v._bsontype) return String(v);                            // other BSON types (defensive)
    const o = {};
    for (const k of Object.keys(v).sort()) {
      if (k.startsWith("$") || k === "_doc") continue;
      o[k] = _norm(v[k]);
    }
    return o;
  }
  return v;
}

// Build the canonical string from a (live or hydrated) Mongoose document by
// walking the schema's leaf paths minus the ignore-list. Sub-document arrays
// (auditTrail/timeline) are skipped generically via `st.schema`.
function _buildCanonical(doc, schema) {
  const src = {};
  for (const path of Object.keys(schema.paths)) {
    const head = path.split(".")[0];
    if (IGNORE.has(head) || IGNORE.has(path)) continue;
    const st = schema.paths[path];
    if (st && st.schema) continue; // sub-document array (auditTrail/timeline/etc.)
    src[path] = _norm(doc.get(path));
  }
  return JSON.stringify(src, Object.keys(src).sort());
}

function _digest(canonical) {
  _maybeWarnInsecure();
  return crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");
}

/**
 * Mongoose plugin — adds the integrity fields + a non-blocking pre-save hook
 * that stamps the digest on every save. Apply to surveyor-critical register
 * schemas only:  Schema.plugin(registerIntegrityPlugin);
 */
function registerIntegrityPlugin(schema) {
  schema.add({
    integrityDigest:  { type: String, default: "" },
    integrityAlgo:    { type: String, default: "" },
    integrityAt:      { type: Date,   default: null },
    integrityVersion: { type: Number, default: 0 },
  });

  schema.pre("save", function (next) {
    try {
      const canonical = _buildCanonical(this, schema);
      this.integrityDigest  = _digest(canonical);
      this.integrityAlgo    = INTEGRITY_ALGO;
      this.integrityAt      = new Date();
      this.integrityVersion = INTEGRITY_VERSION;
    } catch (e) {
      // Never block a register write on an integrity-stamp bug — the row is
      // simply left unstamped (verifies as "legacy", not "tampered").
      // eslint-disable-next-line no-console
      console.warn("[registerIntegrity] stamp failed:", e.message);
    }
    next();
  });
}

/**
 * Verify a single lean row against its stored digest.
 * @returns {{status: "intact"|"tampered"|"legacy", expected?, stored?, error?}}
 */
function verifyRegisterRow(Model, leanRow) {
  const stored = leanRow && leanRow.integrityDigest;
  if (!stored) return { status: "legacy" }; // no digest → unverified, NOT tampered
  try {
    const doc = Model.hydrate(leanRow);
    const expected = _digest(_buildCanonical(doc, Model.schema));
    return { status: expected === stored ? "intact" : "tampered", expected, stored };
  } catch (e) {
    // A verify-time error must not masquerade as tampering.
    return { status: "legacy", error: e.message };
  }
}

/**
 * Verify every row of a register matching `filter`.
 * @returns {{checked, intact, tampered, legacy, intactChain, tamperedRows}}
 */
async function verifyRegisterModel(Model, filter = {}, opts = {}) {
  const cap = Math.min(Math.max(Number(opts.limit) || 1000, 1), 5000);
  const rows = await Model.find(filter).sort({ createdAt: 1 }).limit(cap).lean();
  let intact = 0, tampered = 0, legacy = 0;
  const tamperedRows = [];
  for (const row of rows) {
    const r = verifyRegisterRow(Model, row);
    if (r.status === "intact") intact++;
    else if (r.status === "tampered") {
      tampered++;
      tamperedRows.push({ id: row._id, integrityAt: row.integrityAt || null, expected: r.expected, stored: r.stored });
    } else legacy++;
  }
  return { checked: rows.length, intact, tampered, legacy, intactChain: tampered === 0, tamperedRows };
}

module.exports = {
  registerIntegrityPlugin,
  verifyRegisterRow,
  verifyRegisterModel,
  // exported for tests
  _buildCanonical,
  _digest,
  INTEGRITY_VERSION,
};
