// services/Compliance/clinicalAuditService.js
// ════════════════════════════════════════════════════════════════════
// R7bn-1 / D9-fix: ClinicalAudit emit helper.
//
// One-call helper for controllers to write to the ClinicalAudit
// collection without each callsite re-creating the boilerplate of
// "pull user from req, compute retainUntil, swallow errors so the
// underlying clinical save never fails just because audit logging hit
// a transient mongo blip."
//
// Usage:
//   await emitClinicalAudit({
//     req,                                    // Express req — auto-extracts actor/IP/UA
//     event: "DOCTOR_NOTE_SIGNED",
//     UHID: note.patientUHID,
//     admissionId: note.admissionId,
//     targetType: "DoctorNote",
//     targetId: note._id,
//     after: { noteType: note.noteType, signedAt: note.signedAt },
//   });
//
// Failures are logged to stderr but never thrown — the clinical write
// already succeeded by the time we're emitting. A separate health-check
// monitors the audit-emit success rate via the BillingAudit pattern.
// ════════════════════════════════════════════════════════════════════

const ClinicalAudit = require("../../models/Compliance/ClinicalAuditModel");

// Events that are SIGNED / FINALIZED / DELETED get the longer 7y retention
// floor per NABH IPSG.6 + MCI Indian Medical Records Act 1956 §3.
// Everything else (DRAFT, recording, acknowledge) gets 3y.
const LONG_RETENTION_EVENTS = new Set([
  "DOCTOR_NOTE_SIGNED",
  "DOCTOR_NOTE_DELETED",
  "DOCTOR_NOTE_AMENDED",
  // B6-T04 / B6-T08 — All nurse-note lifecycle events get the 7y NABH
  // MOM.1 floor. Nurse notes are part of the permanent clinical record;
  // even draft creates/updates must be retrievable for retrospective
  // chart audits (NABH IPSG.6 + Indian Medical Records Act 1956 §3).
  "NURSE_NOTE_CREATED",
  "NURSE_NOTE_UPDATED",
  "NURSE_NOTE_SUBMITTED",
  "NURSE_NOTE_AMENDED",
  "NURSE_NOTE_DELETED",
  "INITIAL_ASSESSMENT_DOCTOR_SIGNED",
  "INITIAL_ASSESSMENT_NURSE_SIGNED",
  "CONSENT_SIGNED",
  "CONSENT_REFUSED",     // B6-T08 — refusal is legally significant; 7y floor.
  "CONSENT_REVOKED",
  // B6-T08 — Pharmacy events: every dispense / cancel / return / add /
  // credit-collect touches the HAM drug trail and must survive 7y for
  // NABH MOM.4 + drug-control inspections.
  "PHARMACY_DISPENSED",
  "PHARMACY_SALE_CANCELLED",
  "PHARMACY_RETURNED",
  "PHARMACY_ITEMS_ADDED",
  "PHARMACY_CREDIT_COLLECTED",
  // R7hr-12-S2 (D8-02): money mutation — applyAdvanceToSale rides the same
  // 7y NABH MOM.4 + GST §35 retention floor as the other pharmacy money
  // events above. Pre-fix the event was missing from the ClinicalAudit
  // enum entirely (Sprint 1 added it); without this LONG_RETENTION entry
  // the row would archive at 3y rather than the financial 7y floor.
  "PHARMACY_ADVANCE_APPLIED",
  // R7hr-12-S2 (D5-04): Indent state transitions are part of the same
  // HAM drug trail — every raise/ack/release/cancel/return must survive
  // 7y for NABH MOM.4 + IPSG.3 surveyor reconstruction. The release row
  // is especially load-bearing (FEFO pick log + reservation trigger id);
  // INDENT_RETURNED carries the reverse-FEFO restoration audit from D3-03.
  "INDENT_RAISED",
  "INDENT_ACKNOWLEDGED",
  "INDENT_RELEASED",
  "INDENT_CANCELLED",
  "INDENT_RETURNED",
  "MLC_CREATED",
  "MLC_FINALIZED",
  "MLC_CLOSED",
  "TRANSFUSION_ORDERED",
  "TRANSFUSION_STARTED",
  "TRANSFUSION_COMPLETED",
  "TRANSFUSION_REACTION_LOGGED",
  "DISCHARGE_SUMMARY_FINALIZED",
  "ADMISSION_REACTIVATED",
  "MAR_DOSE_ADMINISTERED",     // HAM drugs need 7y per NABH IPSG.3
  // R7eg — ICU Bundles of Care: finalize/save + non-compliance signals
  // feed the NABH Infection-Control register (HIC.5). Keep all four on
  // the long-retention floor — IC investigations may need to reach back
  // years to look for outbreak patterns.
  "ICU_BUNDLE_SAVED",
  "ICU_BUNDLE_SHIFT_FINALIZED",
  "ICU_BUNDLE_VAP_NON_COMPLIANT",
  "ICU_BUNDLE_CLABSI_NON_COMPLIANT",
  // R7gw-B9-T08 — extend non-compliance signalling to the remaining four
  // bundles. Same 7y NABH IPSG.6 / HIC.5 retention floor as VAP+CLABSI.
  "ICU_BUNDLE_CAUTI_NON_COMPLIANT",
  "ICU_BUNDLE_DVT_NON_COMPLIANT",
  "ICU_BUNDLE_SEPSIS_NON_COMPLIANT",
  "ICU_BUNDLE_SUP_NON_COMPLIANT",
  // B1-T03 — Medical Certificate override audit (legal instrument, 7y floor).
  "MEDICAL_CERTIFICATE_OVERRIDE_ISSUED",
]);

function computeRetainUntil(event) {
  const now = new Date();
  const yearsToAdd = LONG_RETENTION_EVENTS.has(event) ? 7 : 3;
  const d = new Date(now);
  d.setFullYear(d.getFullYear() + yearsToAdd);
  return d;
}

/**
 * Emit a clinical audit row. Never throws — silent on failure with a
 * stderr log so the calling clinical write succeeds even if the audit
 * collection is temporarily unreachable.
 *
 * @param {Object}  opts
 * @param {Object} [opts.req]          Express req (preferred — auto-fills actor/ip/ua)
 * @param {String}  opts.event         enum value from ClinicalAuditModel
 * @param {String} [opts.UHID]
 * @param {ObjectId|String} [opts.admissionId]
 * @param {ObjectId|String} [opts.patientId]
 * @param {String} [opts.patientName]
 * @param {String} [opts.targetType]
 * @param {ObjectId|String} [opts.targetId]
 * @param {Object} [opts.before]
 * @param {Object} [opts.after]
 * @param {String} [opts.reason]
 * @param {Object} [opts.actor]        Explicit override if no req available
 *                                     ({ _id, fullName, role })
 */
async function emitClinicalAudit(opts) {
  try {
    const { req, event } = opts;
    if (!event) {
      console.warn("[ClinicalAudit] emit called without event — skipped");
      return null;
    }

    const user = req?.user || opts.actor || {};
    const actorId = user._id || user.id || null;
    const actorName = user.fullName
      || [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
      || user.name
      || "";
    const actorRole = user.role || "";

    const ipAddress =
      req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
      || req?.socket?.remoteAddress
      || req?.connection?.remoteAddress
      || "";
    const userAgent = req?.headers?.["user-agent"] || "";

    const row = await ClinicalAudit.create({
      event,
      actorId,
      actorName,
      actorRole,
      UHID: opts.UHID || "",
      admissionId: opts.admissionId || null,
      patientId: opts.patientId || null,
      patientName: opts.patientName || "",
      targetType: opts.targetType || "",
      targetId: opts.targetId || null,
      before: opts.before || null,
      after: opts.after || null,
      reason: opts.reason || "",
      ipAddress,
      userAgent,
      retainUntil: computeRetainUntil(event),
    });
    return row;
  } catch (err) {
    // R7bn — log to stderr but never throw. The clinical write that
    // triggered this emit has already succeeded; we don't want a
    // transient audit-collection blip to roll back patient care.
    console.error(
      "[ClinicalAudit] emit failed:",
      opts.event,
      "—",
      err?.message || err,
    );
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// NABH HIC.5 — ICU Care Bundles compliance summary
//
// Aggregates the ICUBundle collection (per-shift care-bundle sheets) into
// period-bucketed compliance statistics for the IC officer's register page.
//
// A bundle on a finalized shift counts as:
//   - "applicable": the nurse marked the bundle applicable (patient has
//     the device / condition the bundle covers).
//   - "compliant":  applicable AND compliancePct === 100 (all items
//     checked). The pre-save hook on ICUBundle stamps compliancePct=-1
//     for non-applicable bundles, so the > -1 guard preserves the
//     "skip non-applicable" denominator semantics.
//
// We aggregate from ICUBundle (not ClinicalAudit) because the canonical
// per-bundle compliancePct lives on the sheet. As of R7gw-B9-T08 the
// audit collection emits *non-compliance* signals for ALL six bundles
// (VAP, CAUTI, CLABSI, DVT, Sepsis, SUP) and remains the source of truth
// for *drill-down* event listings (see listIcuBundleEvents below).
//
// Returns the shape documented in HIC5InfectionControlPage:
//   { range, groupBy, buckets: [{ period, vap:{...}, ..., overall:{...} }],
//     trend: { labels: [...], series: { overall: [...] } } }
// ════════════════════════════════════════════════════════════════════
const ICUBundle = require("../../models/Clinical/ICUBundleModel");

const BUNDLE_KEYS = ["vap", "cauti", "clabsi", "dvt", "sepsis", "sup"];

// IST-aware $dateToString format per groupBy. Mongo's $dateToString
// supports a timezone string; "+05:30" is IST and matches the rest of
// the HIS (which displays IST via toLocaleString("en-IN")).
const PERIOD_FMT = {
  month: "%Y-%m",
  week:  "%G-W%V",   // ISO year + week — Sun/Mon boundary handled by Mongo
  day:   "%Y-%m-%d",
};

function clampGroupBy(g) {
  return PERIOD_FMT[g] ? g : "month";
}

/**
 * Aggregate ICU care-bundle compliance over [from, to] grouped by period.
 *
 * @param {Object}   opts
 * @param {Date}     opts.from        inclusive lower bound (createdAt)
 * @param {Date}     opts.to          inclusive upper bound (createdAt)
 * @param {String}  [opts.groupBy]    "month" | "week" | "day"
 * @param {Number}  [opts.trendLen]   trend window length (default 6 periods)
 */
async function getIcuBundleSummary({ from, to, groupBy = "month", trendLen = 6 }) {
  const gb = clampGroupBy(groupBy);
  const fmt = PERIOD_FMT[gb];

  // Only finalized shifts count toward compliance — draft shifts are
  // in-progress and the IC officer should not be judged on them.
  const match = {
    status: "finalized",
    finalizedAt: { $gte: from, $lte: to },
  };

  // Build a single $facet that yields one bucket-array per bundle key
  // plus the overall roll-up. Each facet groups by the chosen period
  // and counts applicable + compliant (=100%) instances.
  const facetPipeline = {};
  for (const k of BUNDLE_KEYS) {
    facetPipeline[k] = [
      // -1 sentinel = not applicable; skip those so they don't drag the
      // denominator. Use a $match per facet (cheap — same docs already
      // in memory from the prior $match stage).
      { $match: { [`${k}.applicable`]: true, [`${k}.compliancePct`]: { $gte: 0 } } },
      {
        $group: {
          _id: { $dateToString: { format: fmt, date: "$finalizedAt", timezone: "+05:30" } },
          total:        { $sum: 1 },
          compliant:    { $sum: { $cond: [{ $eq: [`$${k}.compliancePct`, 100] }, 1, 0] } },
          noncompliant: { $sum: { $cond: [{ $lt:  [`$${k}.compliancePct`, 100] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ];
  }
  // Overall = finalized shifts counted once per period (one shift produces
  // one row in "overall" — applicable-bundle filtering happens per-bundle).
  facetPipeline.overall = [
    {
      $group: {
        _id: { $dateToString: { format: fmt, date: "$finalizedAt", timezone: "+05:30" } },
        shifts: { $sum: 1 },
        avgCompliancePct: { $avg: "$overallCompliancePct" },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const [agg] = await ICUBundle.aggregate([
    { $match: match },
    { $facet: facetPipeline },
  ]);

  // Pivot: collect every period seen in any facet, then for each period
  // emit one bucket with all six bundles + overall.
  const allPeriods = new Set();
  for (const k of BUNDLE_KEYS) (agg[k] || []).forEach((row) => allPeriods.add(row._id));
  (agg.overall || []).forEach((row) => allPeriods.add(row._id));

  const periodsSorted = [...allPeriods].sort();

  const byBundle = {};
  for (const k of BUNDLE_KEYS) {
    byBundle[k] = new Map((agg[k] || []).map((r) => [r._id, r]));
  }
  const overallByPeriod = new Map((agg.overall || []).map((r) => [r._id, r]));

  const buckets = periodsSorted.map((period) => {
    const out = { period };
    for (const k of BUNDLE_KEYS) {
      const r = byBundle[k].get(period);
      const total        = r?.total || 0;
      const compliant    = r?.compliant || 0;
      const noncompliant = r?.noncompliant || 0;
      out[k.toUpperCase()] = {
        total,
        compliant,
        noncompliant,
        pct: total > 0 ? Math.round((compliant / total) * 1000) / 10 : 0,
      };
    }
    const o = overallByPeriod.get(period);
    const shifts = o?.shifts || 0;
    out.overall = {
      shifts,
      avgCompliancePct: o?.avgCompliancePct != null
        ? Math.round(o.avgCompliancePct * 10) / 10
        : 0,
    };
    return out;
  });

  // Trend = last `trendLen` periods of the overall.avgCompliancePct
  // (used for the sparkline strip above the KPI cards).
  const trendBuckets = buckets.slice(-trendLen);
  const trend = {
    labels: trendBuckets.map((b) => b.period),
    series: {
      overall: trendBuckets.map((b) => b.overall.avgCompliancePct),
    },
  };
  for (const k of BUNDLE_KEYS) {
    trend.series[k.toUpperCase()] = trendBuckets.map((b) => b[k.toUpperCase()].pct);
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    groupBy: gb,
    buckets,
    trend,
  };
}

/**
 * Drill-down: list ClinicalAudit rows tied to ICU bundle events in the
 * range. Used by the "click a row" expand on the IC register page.
 *
 * Returns: array of audit rows (most recent first), capped at `limit`.
 */
async function listIcuBundleEvents({ from, to, bundleKey, eventType, limit = 200 }) {
  const ClinicalAudit = require("../../models/Compliance/ClinicalAuditModel");
  const q = {
    createdAt: { $gte: from, $lte: to },
    event: {
      $in: [
        "ICU_BUNDLE_SAVED",
        "ICU_BUNDLE_SHIFT_FINALIZED",
        "ICU_BUNDLE_VAP_NON_COMPLIANT",
        "ICU_BUNDLE_CLABSI_NON_COMPLIANT",
        // R7gw-B9-T08 — drill-down listing now surfaces all six bundles.
        "ICU_BUNDLE_CAUTI_NON_COMPLIANT",
        "ICU_BUNDLE_DVT_NON_COMPLIANT",
        "ICU_BUNDLE_SEPSIS_NON_COMPLIANT",
        "ICU_BUNDLE_SUP_NON_COMPLIANT",
      ],
    },
  };
  if (eventType) q.event = eventType;
  // bundleKey filters the listing to a single bundle's non-compliance
  // event (one of the six). The SAVED/FINALIZED events apply to the
  // whole sheet and are returned only when no bundleKey is passed.
  if (bundleKey === "vap")    q.event = "ICU_BUNDLE_VAP_NON_COMPLIANT";
  if (bundleKey === "cauti")  q.event = "ICU_BUNDLE_CAUTI_NON_COMPLIANT";
  if (bundleKey === "clabsi") q.event = "ICU_BUNDLE_CLABSI_NON_COMPLIANT";
  if (bundleKey === "dvt")    q.event = "ICU_BUNDLE_DVT_NON_COMPLIANT";
  if (bundleKey === "sepsis") q.event = "ICU_BUNDLE_SEPSIS_NON_COMPLIANT";
  if (bundleKey === "sup")    q.event = "ICU_BUNDLE_SUP_NON_COMPLIANT";

  const rows = await ClinicalAudit.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(1000, Math.max(1, limit)))
    .lean();
  return rows;
}

module.exports = {
  emitClinicalAudit,
  getIcuBundleSummary,
  listIcuBundleEvents,
};
