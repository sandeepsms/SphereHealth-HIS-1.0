/**
 * VisitorPass — NABH visitor management (FMS.7)
 *
 * Each pass:
 *   - belongs to an admission
 *   - records the attendant's identity + relation + ID proof
 *   - has a visit window (validFrom → validUntil)
 *   - can be Active / Expired / Returned / Lost / Revoked
 *
 * Hospital policy enforced at issue:
 *   - Max 2 active passes per admission (configurable per ward later)
 *   - ICU/NICU exceptions handled in the controller
 *
 * R7bj-F3:
 *   • Append-only on passNumber/issuedAt/issuedBy/patientUHID/
 *     attendant identity/ID proof. Mutable: status, returnedAt,
 *     returnedById, notes, validUntil, photoUrl, validAreas.
 *   • Status transition guard: Active → {Returned, Expired, Revoked,
 *     Lost} only; no reverse to Active.
 *   • photoUrl: validated as https:// or /uploads/visitor-pass/ path.
 *   • validAreas[] for ward-level entry scoping (NABH-MED-01).
 *   • retainUntil 2y default with TTL auto-prune (legalHold override).
 */
const mongoose = require("mongoose");

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const MAX_PHOTO_URL_LEN = 500;

function validatePhotoUrl(url) {
  if (url === null || url === undefined || url === "") return true; // optional
  if (typeof url !== "string") return false;
  if (url.length > MAX_PHOTO_URL_LEN) return false;
  const lower = url.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") ||
      lower.startsWith("file:") || lower.startsWith("vbscript:")) {
    return false;
  }
  if (lower.startsWith("https://")) return true;
  if (lower.startsWith("/uploads/visitor-pass/")) return true;
  if (lower.startsWith("/uploads/visitor/")) return true;
  return false;
}

const VisitorPassSchema = new mongoose.Schema(
  {
    passNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
      index: true,
    },
    patientName:    { type: String, required: true },
    patientUHID:    { type: String, index: true },
    bedNumber:      String,
    wardName:       String,

    // Attendant identity
    attendantName:     { type: String, required: true },
    attendantRelation: { type: String, required: true }, // "Son", "Spouse", "Mother", "Friend", "Other"
    attendantPhone:    { type: String },
    idProofType:       { type: String, enum: ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Other", null], default: null },
    idProofNumber:     { type: String, default: "" },

    // R7bj-F3: photo evidence (selfie / ID-photo at gate desk).
    photoUrl: {
      type: String,
      default: "",
      validate: {
        validator: validatePhotoUrl,
        message: "photoUrl must be https:// or /uploads/visitor-pass/ path (max 500 chars, no javascript:/data:/file: schemes)",
      },
    },

    // R7bj-F3 / NABH-MED-01: ward-scoped entry list. Empty = whole
    // hospital. Security gates use this to limit a pass to e.g. ["ICU"].
    validAreas: { type: [String], default: [] },

    // Issue audit (R7bj-F3: explicit timestamp + actor trio).
    issuedAt:   { type: Date, default: Date.now },
    issuedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Validity window
    validFrom:  { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },

    // Status
    status: {
      type: String,
      enum: ["Active", "Returned", "Expired", "Lost", "Revoked"],
      default: "Active",
      index: true,
    },
    returnedAt:   Date,
    returnedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt:    Date,
    revokedReason: String,

    // Audit
    issuedBy:   { type: String, required: true },  // receptionist name / id
    issuedByRole: { type: String, default: "Receptionist" },

    notes: String,

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
    // every pass print/reprint. VisitorPass entityType added to the
    // PrintAudit enum in R7bh-F1 so security gate-trail (FMS.7)
    // captures reprints.
    printCount: { type: Number, default: 0 },

    // R7bj-F3: 2y operational retention; legalHold freezes for cases.
    retainUntil: { type: Date, default: () => new Date(Date.now() + TWO_YEARS_MS) },
    legalHold:   { type: Boolean, default: false },
  },
  { timestamps: true }
);

VisitorPassSchema.index({ admissionId: 1, status: 1 });
VisitorPassSchema.index({ status: 1, validUntil: 1 });
// TTL — purge after 2y unless under legalHold.
VisitorPassSchema.index(
  { retainUntil: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { legalHold: false } },
);

/* ── R7bj-F3: APPEND-ONLY GUARD + STATUS TRANSITION ───────────
 * Frozen post-write: passNumber, issuedAt, issuedById, issuedBy,
 *   issuedByRole, patientUHID, patientName, admissionId, attendantName,
 *   attendantPhone, attendantRelation, idProofType, idProofNumber.
 * Mutable: status (forward-only), returnedAt, returnedById, revokedAt,
 *   revokedReason, notes, validUntil, photoUrl, validAreas, printCount,
 *   legalHold, retainUntil, bedNumber, wardName, updatedAt.
 *
 * Status transitions:
 *   Active → Returned / Expired / Revoked / Lost (all terminal).
 *   Once non-Active, NO further status change (Admin override only). */
const VISITOR_PASS_MUTABLE = new Set([
  "status", "returnedAt", "returnedById", "revokedAt", "revokedReason",
  "notes", "validUntil", "photoUrl", "validAreas", "printCount",
  "legalHold", "retainUntil", "bedNumber", "wardName", "updatedAt",
]);
const VISITOR_PASS_TERMINAL = new Set(["Returned", "Expired", "Revoked", "Lost"]);

async function visitorPassGuard(queryThis) {
  const upd  = queryThis.getUpdate() || {};
  const opts = queryThis.getOptions() || {};
  const $set = upd.$set || {};
  const $unset = upd.$unset || {};
  const $inc  = upd.$inc || {};
  const topLevel = Object.keys(upd).filter((k) => !k.startsWith("$"));

  const adminOverride = opts.adminOverride === true;
  const overrideReason = typeof opts.overrideReason === "string" && opts.overrideReason.trim().length > 0;

  // Field-level allow-list.
  const candidates = new Set([...Object.keys($set), ...Object.keys($unset), ...Object.keys($inc), ...topLevel]);
  const illegal = [...candidates].filter((k) => !VISITOR_PASS_MUTABLE.has(k));
  if (illegal.length) {
    const err = new Error(`VisitorPass: append-only — cannot modify ${illegal.join(", ")}`);
    err.statusCode = 409;
    err.code = "VISITOR_PASS_APPEND_ONLY";
    throw err;
  }

  // photoUrl validation on $set.
  if (typeof $set.photoUrl === "string" && !validatePhotoUrl($set.photoUrl)) {
    const err = new Error("VisitorPass.photoUrl: must be https:// or /uploads/visitor-pass/ path");
    err.statusCode = 400;
    err.code = "VISITOR_PASS_PHOTO_URL";
    throw err;
  }

  // Status transition guard.
  const nextStatus = $set.status ?? upd.status;
  if (nextStatus) {
    const current = await queryThis.model.findOne(queryThis.getQuery()).lean();
    if (current) {
      const cur = current.status;
      if (cur !== "Active" && nextStatus !== cur) {
        if (!(adminOverride && overrideReason)) {
          const err = new Error(
            `VisitorPass: status "${cur}" is terminal — only Active passes may change status. Admin override + reason required.`,
          );
          err.statusCode = 409;
          err.code = "VISITOR_PASS_STATUS_TERMINAL";
          throw err;
        }
      }
      if (cur === "Active" && !(nextStatus === "Active" || VISITOR_PASS_TERMINAL.has(nextStatus))) {
        const err = new Error(`VisitorPass: invalid status transition "${cur}" → "${nextStatus}"`);
        err.statusCode = 409;
        err.code = "VISITOR_PASS_STATUS_INVALID";
        throw err;
      }
    }
  }
}

VisitorPassSchema.pre("findOneAndUpdate", async function (next) {
  try { await visitorPassGuard(this); next(); } catch (e) { next(e); }
});
VisitorPassSchema.pre("updateOne", async function (next) {
  try { await visitorPassGuard(this); next(); } catch (e) { next(e); }
});
VisitorPassSchema.pre("updateMany", async function (next) {
  try { await visitorPassGuard(this); next(); } catch (e) { next(e); }
});

module.exports =
  mongoose.models.VisitorPass ||
  mongoose.model("VisitorPass", VisitorPassSchema);
