// utils/statusTransitionGuard.js
// R7bf-I — Shared state-machine registry (R7bd-D-9 META reship).
//
// Centralises every legal status-transition matrix for every stateful
// model in the HIS. Each model's pre("save") guard (and any controller
// path that mutates status via findOneAndUpdate, which bypasses save
// hooks) calls `assertTransition(modelName, from, to, opts)` and the
// registry decides yes / no with a uniform 409 error code.
//
// Why a single registry (vs each model rolling its own ALLOWED_TRANSITIONS
// like the pre-R7bf admissionModel + DoctorOrderModel did):
//   1. Reviewers see ALL transitions side-by-side — drift between two
//      almost-identical state machines (e.g. PharmacyIndent vs DoctorOrder
//      both around "cancelled-after-released") is now a one-file diff.
//   2. Tests / lint can iterate every model and assert each transition
//      has an audit story.
//   3. Admin-force is one code path with one audit shape — avoids the
//      previous mix of "this._stateOverride = admin" / "force:true" /
//      "actor.role===Admin" idioms.
//
// CONVENTIONS:
//   - States are case-SENSITIVE strings. Match the source model exactly.
//   - A state mapped to an empty array (or absent) is TERMINAL — no exit
//     without `force: true` + admin actor.
//   - Self-transitions (X → X) are always allowed (no-op move) without
//     consulting the matrix; saves that don't modify `status` skip the
//     guard entirely.
//
// AUDIT: any `force:true` path MUST emit an audit row in the calling
// service. The guard itself does not emit — too easy to silently
// double-audit and too tangled for the model layer to know which audit
// stream is appropriate (BillingAudit / UserActivityLog / etc.).

"use strict";

const LEGAL_TRANSITIONS = {
  // ── Admission (Backend/models/Patient/admissionModel.js) ────────
  // Mirrors the existing in-model matrix so the model can delegate
  // here without changing behaviour. Discharged / Cancelled / Deleted
  // are terminal; Transferred can resume to Active.
  Admission: {
    Active:      ["Discharged", "Transferred", "Cancelled", "Deleted"],
    Transferred: ["Active", "Discharged", "Cancelled", "Deleted"],
    Discharged:  [],
    Cancelled:   [],
    Deleted:     [],
  },

  // No separate IPDAdmission model exists in the worktree — IPD admissions
  // are stored in the same `Admission` collection differentiated by
  // `admissionType`. Kept here for forward-compat in case a dedicated
  // IPDAdmission model is split out later. Enum values per A7-HIGH-11.
  IPDAdmission: {
    ADMITTED:    ["TRANSFERRED", "DISCHARGED", "LAMA", "EXPIRED", "ABSCONDED"],
    TRANSFERRED: ["ADMITTED", "DISCHARGED", "LAMA", "EXPIRED", "ABSCONDED"],
    DISCHARGED:  [],
    LAMA:        [],
    EXPIRED:     [],
    ABSCONDED:   ["ADMITTED"],   // patient walked back in — re-admit allowed
  },

  // ── MLC (Backend/models/MLC/MLCReportModel.js) ──────────────────
  // Existing enum: Draft / Finalized / Closed (in-codebase naming).
  // A7-CRIT-3 spec uses DRAFT → REGISTERED → IN_PROGRESS → POLICE_INFORMED
  // → CLOSED, but those names don't exist in the model — we MUST guard
  // the current values or every existing MLC row breaks. The guarantee
  // we DO add: Closed is terminal (no Closed → Finalized / Closed → Draft).
  MLCReport: {
    Draft:     ["Finalized", "Closed"],
    Finalized: ["Closed"],
    Closed:    [],
  },

  // ── ConsentForm (Backend/models/Clinical/ConsentFormModel.js) ───
  // Existing enum: PENDING / SIGNED / REFUSED / REVOKED.
  // A7-CRIT-4: refuse only from PENDING; revoke only from SIGNED.
  // PENDING is the spec's "OFFERED" — keeping the in-codebase name.
  ConsentForm: {
    PENDING: ["SIGNED", "REFUSED"],
    SIGNED:  ["REVOKED"],
    REFUSED: [],
    REVOKED: [],
  },

  // ── PatientBill (Backend/models/PatientBillModel/PatientBillModel.js) ─
  // billStatus values per the model enum.
  PatientBill: {
    DRAFT:      ["GENERATING", "GENERATED", "CANCELLED"],
    GENERATING: ["GENERATED", "DRAFT"],         // rollback path on validation fail
    GENERATED:  ["PARTIAL", "PAID", "CANCELLED", "REFUNDED"],
    PARTIAL:    ["PAID", "REFUNDED", "CANCELLED"],
    PAID:       ["REFUNDED"],                     // PAID → PARTIAL_PAID via discount blocked (A7-HIGH-2)
    REFUNDED:   [],                                // terminal — refund-reversal needs force+audit
    CANCELLED:  [],
  },

  // ── PatientAdvance (Backend/models/PatientBillModel/PatientAdvanceModel.js) ─
  // A7-HIGH-13 enforcement. Existing enum already constrains the field;
  // the matrix below restricts illegal cross-jumps (e.g. REFUNDED → ACTIVE).
  PatientAdvance: {
    ACTIVE:            ["PARTIALLY_APPLIED", "FULLY_APPLIED", "REFUNDED", "CANCELLED"],
    PARTIALLY_APPLIED: ["FULLY_APPLIED", "REFUNDED"],   // can apply more or refund balance
    FULLY_APPLIED:     ["REFUNDED"],                     // refund-of-refund only
    REFUNDED:          [],                                // terminal
    CANCELLED:         [],                                // terminal
  },

  // ── Appointment (Backend/models/Appointment/appointmentModel.js) ─
  // A7-HIGH-4: SCHEDULED → COMPLETED skipping CHECKED_IN forbidden.
  // Existing enum: Booked / Confirmed / CheckedIn / Completed / NoShow / Cancelled.
  Appointment: {
    Booked:    ["Confirmed", "CheckedIn", "NoShow", "Cancelled"],
    Confirmed: ["CheckedIn", "NoShow", "Cancelled"],
    CheckedIn: ["Completed", "Cancelled"],       // Completed only via CheckedIn
    Completed: [],
    NoShow:    [],
    Cancelled: [],
  },

  // ── DoctorOrder (Backend/models/Doctor/DoctorOrderModel.js) ─────
  // A7-HIGH-5: AMEND after EXECUTED forbidden. Existing model allowed
  // Completed → Modified; tightened so Completed is terminal (admin
  // force only). Other transitions preserved.
  DoctorOrder: {
    Pending:      ["Acknowledged", "Active", "InProgress", "OnHold", "Stopped", "Cancelled", "Completed", "Modified"],
    Acknowledged: ["Active", "InProgress", "OnHold", "Stopped", "Cancelled", "Completed", "Modified"],
    Active:       ["InProgress", "OnHold", "Stopped", "Cancelled", "Completed", "Modified"],
    InProgress:   ["Completed", "OnHold", "Stopped", "Cancelled", "Modified"],
    OnHold:       ["Active", "InProgress", "Stopped", "Cancelled"],
    Stopped:      [],
    Cancelled:    [],
    Completed:    [],                              // R7bf-I: was [Modified], now terminal
    Modified:     ["Active", "InProgress", "Stopped", "Cancelled", "Completed"],
  },

  // ── InvestigationOrder (Backend/models/Investigation/InvestigationOrderModel.js) ─
  // Header-level orderStatus.
  InvestigationOrder: {
    PENDING:           ["SAMPLE_COLLECTED", "IN_PROGRESS", "CANCELLED"],
    SAMPLE_COLLECTED:  ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    IN_PROGRESS:       ["COMPLETED", "CANCELLED"],
    COMPLETED:         [],
    CANCELLED:         [],
  },

  // ── Sample (item-level sampleStatus, lives inside InvestigationOrder.items) ─
  // A7-HIGH-14: REJECTED is terminal — direct PATCH to VERIFIED blocked.
  Sample: {
    PENDING:        ["COLLECTED", "REJECTED", "N/A"],
    COLLECTED:      ["RECEIVED_AT_LAB", "REJECTED"],
    RECEIVED_AT_LAB:["REJECTED"],   // once received, only outcome is reject (result handled elsewhere)
    REJECTED:       [],              // terminal
    "N/A":          [],
  },

  // ── ResultStatus (item-level resultStatus inside InvestigationOrder.items) ─
  // A7-HIGH-6: REJECT after VERIFIED forbidden.
  // Mirrors LabOrder verification chain.
  LabResult: {
    PENDING:     ["IN_PROGRESS", "COMPLETED"],
    IN_PROGRESS: ["COMPLETED"],
    COMPLETED:   ["VERIFIED"],
    VERIFIED:    [],                  // terminal — no flip back
  },

  // ── RadiologyOrder ──────────────────────────────────────────────
  // A7-HIGH-7: no model existed — we register the matrix here so any
  // future module / aggregation that adopts the registry has a baseline.
  RadiologyOrder: {
    DRAFT:       ["SUBMITTED", "CANCELLED"],
    SUBMITTED:   ["SCHEDULED", "CANCELLED"],
    SCHEDULED:   ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["REPORTED", "CANCELLED"],
    REPORTED:    ["VERIFIED", "CANCELLED"],
    VERIFIED:    [],
    CANCELLED:   [],
  },

  // ── PharmacyIndent (Backend/models/Pharmacy/PharmacyIndentModel.js) ─
  // A7-CRIT-7: cancel after Released or PartiallyReleased forbidden.
  PharmacyIndent: {
    Raised:             ["Acknowledged", "Cancelled"],
    Acknowledged:       ["PartiallyReleased", "Released", "Cancelled"],
    // R7hr-12-S3 (D5-11): PartiallyReleased → Cancelled is now legal IN THE
    // MATRIX but the cancelIndent service (Backend/services/Pharmacy/indentService.js
    // L581) still 409s the casual path. The transition is reachable only when
    // returnIndent has restocked every issuedQty unit AND the caller passes
    // force:true + adminUserId — at that point the indent has no live
    // inventory/billing ghost, so closing it as Cancelled is safe. Before
    // R7hr-12-S3 this state was a terminal trap on data-entry mistakes
    // (e.g. wrong patient, issuedQty=1 of 10 by accident): the matrix
    // forced the pharmacist to release the remaining 9 just to dispose
    // of the indent, doubling down on the error.
    PartiallyReleased:  ["Released", "Cancelled"],
    Released:           [],                    // terminal — use return flow
    Cancelled:          [],
  },

  // ── Bed (Backend/models/bedMgmt/bedsModel.js) ────────────────────
  // A7-HIGH-12: cannot skip Available between Maintenance and Occupied.
  // "Maintenance" is the canonical cleaning bucket; housekeeping.state
  // is the fine-grained sub-status (not guarded here).
  Bed: {
    Available:   ["Occupied", "Maintenance", "Blocked", "Reserved"],
    Occupied:    ["Available", "Maintenance", "Blocked"],   // discharge → Available; mid-stay → Maintenance/Blocked rare but possible
    Maintenance: ["Available", "Blocked"],                   // cleaning → Available → Occupied (NOT direct)
    Blocked:     ["Available", "Maintenance"],
    Reserved:    ["Available", "Occupied", "Maintenance"],   // expiry → Available; admission → Occupied
  },

  // ── DischargeSummary (Backend/models/Clinical/DischargeSummaryModel.js) ─
  // A7-HIGH-10: FINALIZED → DRAFT (correction) must emit audit + reason.
  // The existing _refuseIfFinalized middleware already blocks generic
  // edits; this matrix is a belt-and-braces for any service path that
  // saves the doc instance directly.
  DischargeSummary: {
    draft:     ["finalized"],
    finalized: [],   // terminal — correction = create amendment, not re-edit
  },

  // ── BedTransfer (Backend/models/Patient/bedTransferModel.js) ────
  // No existing audit finding — added for completeness now that the
  // registry is the single source of truth.
  BedTransfer: {
    PendingHandover: ["Complete", "Cancelled"],
    Complete:        [],
    Cancelled:       [],
  },
};

/**
 * assertTransition(modelName, from, to, opts) → { ok, forced? }
 *
 * Throws an Error with `code: "ILLEGAL_TRANSITION"` and `statusCode: 409`
 * when the move isn't in the registry. Same-state moves are a no-op.
 *
 * @param {string} modelName  — key in LEGAL_TRANSITIONS
 * @param {string} from       — current state (snapshot from post('init'))
 * @param {string} to         — proposed state
 * @param {object} opts
 * @param {boolean} opts.force      — bypass the matrix (admin override)
 * @param {string}  opts.adminUserId— actor id, required when force=true
 *                                    (so the caller is forced to identify
 *                                    who's bypassing — audit responsibility
 *                                    stays with the caller's emit() path)
 */
function assertTransition(modelName, from, to, { force = false, adminUserId = null } = {}) {
  if (from == null || from === to) return { ok: true };   // no-op
  if (force && adminUserId) return { ok: true, forced: true };

  const matrix = LEGAL_TRANSITIONS[modelName];
  if (!matrix) {
    // Unknown model — be conservative. Don't block (false negative
    // breaks production) but shout in the log so we catch the missing
    // entry on the next code-review pass.
    // eslint-disable-next-line no-console
    console.warn(`[statusTransitionGuard] Unknown modelName "${modelName}" — allowing ${from} → ${to} without matrix check`);
    return { ok: true, unknownModel: true };
  }

  const allowed = matrix[from];
  if (!Array.isArray(allowed)) {
    // Unknown source state — same reasoning as unknown model.
    // eslint-disable-next-line no-console
    console.warn(`[statusTransitionGuard] Unknown ${modelName} state "${from}" — allowing transition to "${to}" without matrix check`);
    return { ok: true, unknownState: true };
  }

  if (!allowed.includes(to)) {
    const err = new Error(
      `Illegal ${modelName} transition: ${from} → ${to}. ` +
      `From "${from}", allowed targets are: ${allowed.length ? allowed.join(", ") : "<terminal — admin force only>"}.`,
    );
    err.code = "ILLEGAL_TRANSITION";
    err.statusCode = 409;
    err.status = 409;        // some routers read .status, others .statusCode — set both
    err.from = from;
    err.to = to;
    err.modelName = modelName;
    throw err;
  }

  return { ok: true };
}

/**
 * Helper: build a mongoose pre('save') hook that consults the registry.
 * Models call this and let the guard handle the boilerplate of
 * snapshotting prior status / detecting the modified path / surfacing
 * the error.
 *
 *   const { attachStatusGuard } = require("../../utils/statusTransitionGuard");
 *   attachStatusGuard(Schema, { modelName: "PharmacyIndent", field: "status" });
 *
 * `field` defaults to "status". `forceFlagPath` is an optional path on
 * the doc that lets a caller set `doc.__forceTransition = true` to bypass
 * — combined with an `adminUserId` value on the same doc, the guard
 * passes the move through. The model is expected to clear the flag in
 * its own pre('save') if it cares about idempotence.
 */
function attachStatusGuard(schema, { modelName, field = "status", forceFlagPath = "__forceTransition", adminIdPath = "__forceAdminUserId" } = {}) {
  if (!modelName) throw new Error("attachStatusGuard requires { modelName }");

  schema.post("init", function () {
    this[`__prior_${field}`] = this[field];
  });

  schema.pre("save", function (next) {
    if (this.isNew) return next();
    if (!this.isModified(field)) return next();
    const prev = this[`__prior_${field}`];
    if (prev == null) return next();   // no baseline — likely manual construct, skip
    try {
      assertTransition(modelName, prev, this[field], {
        force: !!this[forceFlagPath],
        adminUserId: this[adminIdPath] || null,
      });
      next();
    } catch (e) {
      next(e);
    }
  });
}

module.exports = {
  LEGAL_TRANSITIONS,
  assertTransition,
  attachStatusGuard,
};
