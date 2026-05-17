// controllers/Clinical/medReconciliationController.js
// ═══════════════════════════════════════════════════════════════
// NABH MOM.4d Medication Reconciliation.
//
// Endpoints (all under /api/med-reconciliation):
//   GET  /admission/:admissionId            — fetch (or build) the recon doc
//   POST /admission/:admissionId/seed       — populate Home column from
//                                              patient.currentMeds, Inpatient
//                                              column from active orders
//   PUT  /admission/:admissionId            — replace rows array
//   PATCH /admission/:admissionId/row/:rowId — update a single row
//   POST /admission/:admissionId/review/admit
//   POST /admission/:admissionId/review/discharge   — sign-off per phase
//
// Every mutation writes a PatientActivityLog row for audit (NABH AAC.7).
// ═══════════════════════════════════════════════════════════════

const MedReconciliation = require("../../models/Clinical/MedReconciliationModel");
const Admission         = require("../../models/Patient/admissionModel");
const Patient           = require("../../models/Patient/patientModel");
const DoctorOrder       = require("../../models/Doctor/DoctorOrderModel");
const DischargeSummary  = require("../../models/Clinical/DischargeSummaryModel");
const activityLogger    = require("../../services/Clinical/activityLogger");

function userMeta(req) {
  const u = req.user || {};
  return {
    userId:   u._id || u.id || null,
    userName: u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "",
    userRole: u.role || "",
    httpMethod: req.method, httpPath: req.originalUrl,
    ip: req.ip || "", userAgent: req.headers["user-agent"] || "",
  };
}

/** Helper: build a row from a free-form medication string ("Tab. Metformin 500 mg PO BD"). */
function parseHomeMed(s) {
  if (!s || typeof s !== "string") return null;
  const txt = s.trim();
  if (!txt) return null;
  // Best-effort tokenisation — anything beyond drugName goes to indication.
  const m = txt.match(/^([\w.\-\s]+?)\s+(\d+\s*\w+)?\s*([A-Z]{1,5})?\s*(OD|BD|TDS|QID|HS|STAT|SOS|Q\d+H|Continuous)?(.*)$/i);
  if (!m) return { drugName: txt, source: "home" };
  return {
    drugName:  (m[1] || txt).trim(),
    dose:      (m[2] || "").trim(),
    route:     (m[3] || "").trim(),
    frequency: (m[4] || "").trim(),
    indication: (m[5] || "").trim(),
    source: "home",
  };
}

// ── GET ────────────────────────────────────────────────────
exports.getReconciliation = async (req, res) => {
  try {
    const admId = req.params.admissionId;
    let doc = await MedReconciliation.findOne({ admissionId: admId }).lean();
    if (!doc) return res.json({ success: true, data: null });
    // Live-join the "inpatient" column from current DoctorOrders so the
    // doctor always sees the freshest active list when reviewing.
    const inpatient = await DoctorOrder.find({
      // Match by admission, only Medication / IV_Fluid orders
      admissionId: admId,
      orderType: { $in: ["Medication", "IV_Fluid"] },
      status: { $in: ["Pending", "InProgress", "OnHold"] },
    }).lean();
    return res.json({ success: true, data: { ...doc, inpatient } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /seed ─────────────────────────────────────────────
exports.seedReconciliation = async (req, res) => {
  try {
    const admId = req.params.admissionId;
    const adm = await Admission.findById(admId).lean();
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    const pat = adm.patientId ? await Patient.findById(adm.patientId).lean() : null;

    // Home meds — patient.currentMeds is either a free-text string, an
    // array of strings, or an array of objects {name, dose, route, ...}.
    const homeSrc = pat?.currentMeds || adm.currentMeds || pat?.medications || [];
    const rows = [];
    if (Array.isArray(homeSrc)) {
      homeSrc.forEach((m) => {
        if (typeof m === "string") {
          const row = parseHomeMed(m);
          if (row) rows.push(row);
        } else if (m && typeof m === "object") {
          rows.push({
            drugName: m.drugName || m.name || m.medicineName || "",
            dose: m.dose || "", route: m.route || "", frequency: m.frequency || "",
            indication: m.indication || m.reason || "", source: "home",
          });
        }
      });
    } else if (typeof homeSrc === "string") {
      homeSrc.split(/[\n,;]/).forEach((s) => {
        const row = parseHomeMed(s); if (row) rows.push(row);
      });
    }

    // Active inpatient orders — pre-populate so the doctor sees what's
    // already being given vs the home list.
    const orders = await DoctorOrder.find({
      admissionId: admId,
      orderType: { $in: ["Medication", "IV_Fluid"] },
      status: { $in: ["Pending", "InProgress"] },
    }).lean();
    orders.forEach((o) => {
      const d = o.orderDetails || {};
      if (!d.medicineName) return;
      rows.push({
        drugName: d.medicineName,
        dose: d.dose || "", route: d.route || "",
        frequency: d.frequency || "", duration: d.duration || "",
        indication: d.indication || "", source: "inpatient",
        doctorOrderId: o._id,
      });
    });

    const doc = await MedReconciliation.findOneAndUpdate(
      { admissionId: admId },
      {
        $setOnInsert: {
          UHID: adm.UHID, patientName: adm.patientName || pat?.fullName || "",
          admissionId: admId, ipdNo: adm.admissionNumber || "",
        },
        $set: { rows },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    activityLogger.log({
      UHID: adm.UHID, admissionId: admId, ipdNo: adm.admissionNumber || "",
      module: "MedRecon", action: "create", area: "med-recon.seed",
      summary: `Med reconciliation seeded — ${rows.length} rows (${rows.filter(r=>r.source==="home").length} home, ${rows.filter(r=>r.source==="inpatient").length} active)`,
      sourceModel: "MedReconciliation", sourceId: doc._id,
      tags: ["med-recon", "safety"],
      ...userMeta(req),
    }).catch(() => {});

    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── PUT — replace whole rows array (UI bulk save) ─────────
exports.updateReconciliation = async (req, res) => {
  try {
    const admId = req.params.admissionId;
    const { rows, summaryNotes } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ success: false, message: "rows array required" });
    const doc = await MedReconciliation.findOneAndUpdate(
      { admissionId: admId },
      { $set: { rows, summaryNotes: summaryNotes || "", updatedBy: req.user?._id } },
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Reconciliation not found — seed first" });
    activityLogger.log({
      UHID: doc.UHID, admissionId: doc.admissionId, ipdNo: doc.ipdNo,
      module: "MedRecon", action: "update", area: "med-recon.rows-bulk",
      summary: `Med reconciliation updated (${rows.length} rows)`,
      sourceModel: "MedReconciliation", sourceId: doc._id,
      tags: ["med-recon"],
      ...userMeta(req),
    }).catch(() => {});
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── PATCH — update one row ────────────────────────────────
exports.updateRow = async (req, res) => {
  try {
    const admId = req.params.admissionId;
    const rowId = req.params.rowId;
    const update = req.body || {};
    const doc = await MedReconciliation.findOne({ admissionId: admId });
    if (!doc) return res.status(404).json({ success: false, message: "Reconciliation not found" });
    const row = doc.rows.id(rowId);
    if (!row) return res.status(404).json({ success: false, message: "Row not found" });
    Object.entries(update).forEach(([k, v]) => { if (k !== "_id") row[k] = v; });
    doc.updatedBy = req.user?._id;
    await doc.save();
    activityLogger.log({
      UHID: doc.UHID, admissionId: doc.admissionId, ipdNo: doc.ipdNo,
      module: "MedRecon", action: "update", area: `med-recon.row.${row.action || "edit"}`,
      summary: `${row.drugName} → ${row.action}${row.actionReason ? ` (${row.actionReason})` : ""}`,
      sourceModel: "MedReconciliation", sourceId: doc._id,
      tags: ["med-recon"],
      ...userMeta(req),
    }).catch(() => {});
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /review/admit | /review/discharge ────────────────
async function reviewPhase(phase, req, res) {
  try {
    const admId = req.params.admissionId;
    const u = req.user || {};
    const name = u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim();
    const reg  = u.doctorDetails?.registrationNumber || "";
    const update = phase === "ADMIT"
      ? { admitReviewedAt: new Date(), admitReviewedBy: name, admitReviewedByReg: reg }
      : { dischargeReviewedAt: new Date(), dischargeReviewedBy: name, dischargeReviewedByReg: reg };
    const doc = await MedReconciliation.findOneAndUpdate(
      { admissionId: admId },
      { $set: { ...update, updatedBy: u._id } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Reconciliation not found — seed first" });

    // If we're at discharge, write the finalised med list back into the
    // discharge-summary's medicationsOnDischarge[] so the printed summary
    // stays in sync with the reconciliation decisions.
    if (phase === "DISCHARGE") {
      const finalMeds = doc.rows
        .filter((r) => ["CONTINUE", "MODIFY", "NEW"].includes(r.action))
        .map((r) => ({
          medicineName: r.drugName,
          dose: r.dose,
          route: r.route,
          frequency: r.frequency,
          duration: r.duration,
          remarks: r.actionReason || "",
        }));
      await DischargeSummary.findOneAndUpdate(
        { admissionId: admId },
        { $set: { medicationsOnDischarge: finalMeds } },
        { upsert: false }
      ).catch(() => {});
    }

    activityLogger.log({
      UHID: doc.UHID, admissionId: doc.admissionId, ipdNo: doc.ipdNo,
      module: "MedRecon", action: "sign", area: `med-recon.review.${phase.toLowerCase()}`,
      summary: `Med reconciliation reviewed at ${phase}`,
      sourceModel: "MedReconciliation", sourceId: doc._id,
      tags: ["med-recon", "safety"], isFlagged: true,
      ...userMeta(req),
    }).catch(() => {});
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
exports.reviewAdmit     = (req, res) => reviewPhase("ADMIT",     req, res);
exports.reviewDischarge = (req, res) => reviewPhase("DISCHARGE", req, res);
