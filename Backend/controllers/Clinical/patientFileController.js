// controllers/Clinical/patientFileController.js
// ═══════════════════════════════════════════════════════════════
// Patient File — Complete Aggregator
//
// One endpoint pulls EVERY clinical record for a patient (across
// every active model) into a single response. The Complete Patient
// File page consumes this directly so the front-end stays dumb
// and we never miss a model in the UI.
//
// Read-only. Every model is `lean()` for speed; ordering is
// chronological where it matters (notes, orders, audit feed).
// ═══════════════════════════════════════════════════════════════

const Patient            = require("../../models/Patient/patientModel");
const sendErr = require("../../utils/sendErr");
const Admission          = require("../../models/Patient/admissionModel");
// OPDRegistration — the canonical store for every saved OPD visit
// (chief complaint, HOPI, vitals, examination, diagnosis, prescription,
// SOAP note). Pre-this-fix the complete-file aggregator only loaded
// Admission rows, so historical OPD visits the doctor saved were
// invisible on the Complete Patient File page.
const OPDRegistration    = require("../../models/Patient/OPDModels");
const DoctorNotes        = require("../../models/Doctor/DoctorNotesModel");
const DoctorOrder        = require("../../models/Doctor/DoctorOrderModel");
// IntakeOutputEntry — atomic per-fluid event store (replaces the
// folded-up nurseNote.intakeOutput aggregate). Loaded for the
// IPD-file aggregator so the chronological timeline shows every IN/OUT.
const IntakeOutputEntry  = (() => { try { return require("../../models/Clinical/IntakeOutputEntryModel"); } catch { return null; } })();
const NurseNotes         = require("../../models/Nurse/NurseNotesModel");
const NursingAssessment  = require("../../models/Nurse/NursingAssessmentModel");
const NursingCarePlan    = require("../../models/Nurse/NursingCarePlanModel");
const ShiftHandover      = require("../../models/Nurse/shiftHandoverModel");
const ConsentForm        = require("../../models/Clinical/ConsentFormModel");
const DischargeSummary   = require("../../models/Clinical/DischargeSummaryModel");
const MAR                = (() => { try { return require("../../models/Clinical/MARModel"); } catch { return null; } })();
const VitalSheet         = (() => { try { return require("../../models/Vitals/vitalSheetModel"); } catch { return null; } })();
const MLCReport          = (() => { try { return require("../../models/MLC/MLCReportModel"); } catch { return null; } })();
const InvestigationOrder = require("../../models/Investigation/InvestigationOrderModel");
const PatientBill        = require("../../models/PatientBillModel/PatientBillModel");
const BillingTrigger     = require("../../models/Billing/BillingTrigger");
const BedTransfer        = (() => { try { return require("../../models/Patient/bedTransferModel"); } catch { return null; } })();
const PatientActivityLog = require("../../models/Clinical/PatientActivityLogModel");
// Dietician — diet plans appear in patient file as a "dietPlans"
// collection + per-plan entries in the chronological timeline so the
// treating doctor / nurse on rounds can see what nutritional orders
// are active.
const DietitianModels    = (() => { try { return require("../../models/Clinical/DietitianModels"); } catch { return null; } })();
const PatientDietPlan    = DietitianModels?.PatientDietPlan || null;
// Lab Tech / Radiologist manual data entry — trend sheets + narrative
// imaging / micro / histopath reports. Optional require so legacy
// deployments without these models don't 500 the aggregator.
const LabRecordsModels   = (() => { try { return require("../../models/Clinical/labRecordsModels"); } catch { return null; } })();
const LabTrend           = LabRecordsModels?.LabTrend  || null;
const LabReport          = LabRecordsModels?.LabReport || null;
// ICUBundle — six per-shift care-bundle sheets (VAP / CAUTI / CLABSI /
// DVT / Sepsis / SUP). Surfaced into the Complete Patient File so the
// NABH HIC.5 / COP.13 bundles appear in print without a separate API call.
const ICUBundle          = (() => { try { return require("../../models/Clinical/ICUBundleModel"); } catch { return null; } })();
// R7ft-FIX2 — Blood transfusion register. Surfaced into the
// Complete Patient File so the Narrative print can include
// every transfusion (NABH HIC.4 / MOM.4). Optional require so
// legacy deployments without the model don't 500 the aggregator.
const BloodTransfusionRegister = (() => { try { return require("../../models/Compliance/BloodTransfusionRegisterModel"); } catch { return null; } })();

// ── Helper: safe collection fetch — never let a single model failure
// break the whole aggregator. If a query throws (missing model, schema
// mismatch on legacy data), we log + return []. The UI still gets
// every OTHER section.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[patientFile] ${label} fetch failed:`, e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/complete
// Returns: {
//   patient, admissions, currentAdmission,
//   doctorNotes, nurseNotes, doctorOrders, mar, vitals,
//   nursingAssessments, nursingCarePlans, shiftHandovers, bedTransfers,
//   consents, dischargeSummary, mlc, investigations,
//   bills, billingTriggers,
//   activityLog (last 500),
//   timeline (merged chronological feed)
// }
// ─────────────────────────────────────────────────────────────
exports.getCompleteFile = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) {
      return res.status(400).json({ success: false, message: "UHID required" });
    }

    const patient = await Patient.findOne({ UHID })
      .populate("tpa", "tpaName tpaCode")
      .populate("department", "departmentName")
      .lean();
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }

    // R7bf-J/A8-CRIT-2: bounded fetch + windowed time-range. Pre-R7bf this
    // endpoint loaded EVERY nursing note, vital, MAR, order, lab,
    // radiology row since admission. A 30-day ICU patient = 28 MB
    // response, four concurrent hits OOMed the Node process. Now:
    //   - default window = last 7 days (configurable via ?from&to)
    //   - per-section cap = 200 rows (configurable via ?limit)
    //   - response carries `pagination` with `hasMore` flags + the cursor
    //     parameters the UI passes in `loadOlder` to fetch the next page.
    // The earlier `admissions`, `consents`, `dischargeSummary`, `mlc`,
    // `bills` lists are KEY clinical context and small in cardinality —
    // those still load fully (typically < 50 rows / patient). The big-N
    // collections (notes, orders, MAR, vitals, audit) are windowed.
    const DEFAULT_WINDOW_DAYS = 7;
    const MAX_LIMIT           = 500;
    const PER_SECTION_LIMIT   = Math.min(parseInt(req.query.limit, 10) || 200, MAX_LIMIT);
    const now    = new Date();
    const toDate = req.query.to   ? new Date(req.query.to)   : now;
    const fromDate = req.query.from
      ? new Date(req.query.from)
      : new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid from/to date" });
    }
    // Time window applied via createdAt for the big collections. Sections
    // are sorted DESC so the per-section .limit() picks the newest within
    // the window — UI can request older rows via ?from / ?to.
    const win = { $gte: fromDate, $lte: toDate };

    // Parallel fetch — every section is independent, so blast them all at once.
    const [
      admissions, opdVisits, doctorNotes, nurseNotes, doctorOrders,
      consents, dischargeSummary,
      nursingAssessments, nursingCarePlans, shiftHandovers, bedTransfers,
      mar, vitals, mlc,
      investigations, bills, billingTriggers, activityLog,
      dietPlans, intakeOutput, bloodTransfusion,
    ] = await Promise.all([
      // Admissions are small (typically 1–3) and the chronology spine — load all.
      safe("admissions",       () => Admission.find({ UHID }).sort({ admissionDate: -1 }).limit(50).lean()),
      // OPDRegistration — full historical OPD visit list (not windowed —
      // an OPD-only patient's record is meant to show every past visit).
      // Bounded at 100 to protect against pathological histories.
      safe("opdVisits",        () => OPDRegistration.find({ UHID }).sort({ visitDate: -1, createdAt: -1 }).limit(100).lean()),
      // The 7-day window applies to high-cardinality recorded data.
      // R7hr — the "Complete File" must show the WHOLE admission, not the last
      // 7 days. The Initial Assessment is always the OLDEST note (day 1), so
      // the createdAt window silently dropped it (and every early note/order/
      // MAR) for any stay > 7 days. Mirror the R7fo nurseNotes/vitals fix:
      // drop the window on the clinical-record collections; PER_SECTION_LIMIT
      // still bounds the payload. (Operational billingTriggers + activityLog
      // keep the window — activity is served separately via the audit bundle.)
      safe("doctorNotes",      () => DoctorNotes.find({ patientUHID: UHID }).sort({ visitDate: -1, createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      // R7fo — nursing-timeline visibility regression. The `createdAt: win`
      // 7-day default hid older nurse notes from the patient file (e.g.
      // an admission's initial assessment from day-1 vanished on day-9).
      // Drop the date window: notes are scoped by patientUHID and the
      // PER_SECTION_LIMIT cap (default 200, max 500) prevents bloat.
      // Sort DESC by createdAt picks the newest within the cap.
      safe("nurseNotes",       () => NurseNotes.find({ patientUHID: UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("doctorOrders",     () => DoctorOrder.find({ UHID }).sort({ orderedAt: -1, createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      // Consents are infrequent + must be visible historically — load all but capped.
      safe("consents",         () => ConsentForm.find({ UHID }).sort({ createdAt: -1 }).limit(100).lean()),
      safe("dischargeSummary", () => DischargeSummary.find({ UHID }).sort({ createdAt: -1 }).limit(50).lean()),
      safe("nursingAssessments", () => NursingAssessment.find({ UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("nursingCarePlans",   () => NursingCarePlan.find({ UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      // R7ht — shiftHandoverModel keys on lowercase `uhid` (like VitalSheet
      // above), so the old `{ UHID }` query matched zero app-written handovers
      // and only the demo seed (which writes both spellings) ever printed.
      safe("shiftHandovers",     () => ShiftHandover.find({ $or: [{ uhid: UHID }, { UHID }] }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("bedTransfers",       () => BedTransfer ? BedTransfer.find({ UHID }).sort({ createdAt: -1 }).limit(50).lean() : []),
      safe("mar",                () => MAR ? MAR.find({ UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean() : []),
      // R7bu — VitalSheet schema uses `uhid` (lowercase) NOT `UHID`, and
      // there is NO top-level `recordedAt` field — entries with their
      // own time live in tableData[]. The old `{ UHID, recordedAt: win }`
      // query matched zero rows. Fall back to the canonical `createdAt`
      // window for the date filter; entry-level time precision is the
      // dedicated /patient-history/:id/file endpoint's job.
      // R7fo — same widening as nurseNotes: vitals from before the 7-day
      // window were invisible. PER_SECTION_LIMIT cap still bounds payload.
      safe("vitals",             () => VitalSheet ? VitalSheet.find({ uhid: UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean() : []),
      // MLC + bills + admissions don't bloat — keep small, no window.
      safe("mlc",                () => MLCReport ? MLCReport.find({ UHID }).sort({ createdAt: -1 }).limit(50).lean() : []),
      safe("investigations",     () => InvestigationOrder.find({ UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("bills",              () => PatientBill.find({ UHID }).sort({ createdAt: -1 }).limit(50).lean()),
      safe("billingTriggers",    () => BillingTrigger.find({ UHID, createdAt: win }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("activityLog",        () => PatientActivityLog.find({ UHID, createdAt: win }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean()),
      safe("dietPlans",          () => PatientDietPlan ? PatientDietPlan.find({ UHID }).sort({ assignedAt: -1, createdAt: -1 }).limit(50).lean() : []),
      // IntakeOutput — every IN/OUT event for this patient. R7fo widening:
      // the 7-day `ts: win` filter hid the start-of-stay I/O entries (the
      // graph showed only the trailing week, not the full admission).
      // PER_SECTION_LIMIT bounds the response.
      safe("intakeOutput",       () => IntakeOutputEntry ? IntakeOutputEntry.find({ UHID, voided: { $ne: true } }).sort({ ts: -1 }).limit(PER_SECTION_LIMIT).lean() : []),
      // R7ft-FIX2 — blood transfusion register (UHID + reverse-chrono).
      // Bounded at 50 entries since a single patient seldom exceeds this.
      safe("bloodTransfusion",   () => BloodTransfusionRegister ? BloodTransfusionRegister.find({ UHID }).sort({ createdAt: -1 }).limit(50).lean() : []),
    ]);

    // R7hr — devices history (IV cannula / catheter / ET tube …) for the
    // chronological Complete File print. ASC by placedAt — a device row is
    // a lifecycle (placed → changes[] → removed), so bedside order is the
    // natural read. Lazy-require mirrors the other optional models.
    const PatientDevice = (() => { try { return require("../../models/Clinical/PatientDeviceModel"); } catch { return null; } })();
    const devices = PatientDevice
      ? await safe("devices", () => PatientDevice.find({ UHID }).sort({ placedAt: 1 }).limit(100).lean())
      : [];

    // ── R7hr — "everything captured must reach the Complete File" ──────
    // Coverage audit (2026-07) found ~25 patient-scoped collections that
    // never reached this aggregator: ER visits, standalone prescriptions,
    // medical certificates, physio, med-reconciliation, diabetic charts,
    // pharmacy dispenses, advances, appointments, procedure notes, ADR /
    // food reactions, PROM-PREM, code-response events, and the patient-
    // linked NABH safety registers. All are surfaced here through one
    // defensive helper: lazy-require (absent model ⇒ []), $or over both
    // UHID spellings (schemas are split between UHID and patientUHID),
    // capped + lean. A schema without either field simply matches zero
    // rows — never throws.
    const _lazyModel = (p) => { try { return require(p); } catch { return null; } };
    const _byPatient = (Model, name, { sort = { createdAt: -1 }, cap = 100 } = {}) =>
      Model
        ? safe(name, () => Model.find({ $or: [{ UHID }, { patientUHID: UHID }] }).sort(sort).limit(cap).lean())
        : Promise.resolve([]);

    const [
      emergencyCases, prescriptions, medicalCertificates,
      physioPlans, physioSessions, medReconciliation, diabeticCharts,
      pharmacySales, advances, appointments, procedureNotes,
      adrReports, foodReactions, promPremSurveys, codeResponseEvents,
    ] = await Promise.all([
      _byPatient(_lazyModel("../../models/Patient/emergencyModel"), "emergencyCases"),
      _byPatient(_lazyModel("../../models/Doctor/prescription"), "prescriptions"),
      _byPatient(_lazyModel("../../models/Clinical/MedicalCertificateModel"), "medicalCertificates", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Clinical/PhysioPlanModel"), "physioPlans", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Clinical/PhysioSessionModel"), "physioSessions"),
      _byPatient(_lazyModel("../../models/Clinical/MedReconciliationModel"), "medReconciliation", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Clinical/DiabeticChartModel"), "diabeticCharts"),
      _byPatient(_lazyModel("../../models/Pharmacy/PharmacySaleModel"), "pharmacySales"),
      _byPatient(_lazyModel("../../models/PatientBillModel/PatientAdvanceModel"), "advances", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Appointment/appointmentModel"), "appointments"),
      _byPatient(_lazyModel("../../models/Clinical/ProcedureNoteModel"), "procedureNotes"),
      _byPatient(_lazyModel("../../models/Pharmacy/ADRReportModel"), "adrReports", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Clinical/AdverseFoodReactionModel"), "foodReactions", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Clinical/PROMPREMSurveyModel"), "promPremSurveys", { cap: 50 }),
      _byPatient(_lazyModel("../../models/Compliance/CodeResponseEventModel"), "codeResponseEvents", { cap: 50 }),
    ]);

    // Patient-linked NABH safety/compliance registers — grouped so the
    // print can render them as one "Safety & Compliance" section.
    const _REGISTERS = [
      ["restraints",        "../../models/Compliance/RestraintRegisterModel"],
      ["fallEvents",        "../../models/Compliance/FallRiskRegisterModel"],
      ["pressureUlcers",    "../../models/Compliance/PressureUlcerRegisterModel"],
      ["medicationErrors",  "../../models/Compliance/MedicationErrorRegisterModel"],
      ["sentinelEvents",    "../../models/Compliance/SentinelEventRegisterModel"],
      ["haiSurveillance",   "../../models/Compliance/HAISurveillanceRegisterModel"],
      ["lama",              "../../models/Compliance/LAMARegisterModel"],
      ["mortality",         "../../models/Compliance/MortalityRegisterModel"],
      ["nearMissEvents",    "../../models/Compliance/NearMissEventRegisterModel"],
      ["otRegister",        "../../models/Compliance/OTRegisterModel"],
      ["antimicrobialUse",  "../../models/Compliance/AntimicrobialUseRegisterModel"],
    ];
    const _regRows = await Promise.all(
      _REGISTERS.map(([name, path]) => _byPatient(_lazyModel(path), `registers.${name}`, { cap: 50 })),
    );
    const complianceRegisters = Object.fromEntries(
      _REGISTERS.map(([name], i) => [name, _regRows[i]]),
    );

    // Lab-records (manual trend sheets + imaging/micro/histopath reports).
    // Fetched separately so the optional-require null-guard is local — the
    // main Promise.all above stays uncluttered.
    const labTrends  = LabTrend  ? await safe("labTrends",  () => LabTrend.find({ UHID }).sort({ createdAt: -1 }).limit(PER_SECTION_LIMIT).lean())  : [];
    const labReports = LabReport ? await safe("labReports", () => LabReport.find({ UHID }).sort({ reportDate: -1 }).limit(PER_SECTION_LIMIT).lean()) : [];

    // R7ey-F19 — .lean() bypasses each schema's toJSON decimalToNumber
    // transform, so every money field on bills/triggers shipped as raw
    // Decimal128 EJSON. CompletePatientFile's billing section reducer
    // then poisoned to "[object Object]" → ₹0 Gross / Paid / Outstanding
    // even when the patient had real outstanding balance. Clinicians
    // could discharge a patient without seeing what was owed.
    try {
      const { decimalToNumber } = require("../../utils/money");
      (bills || []).forEach((b) => decimalToNumber(null, b));
      (billingTriggers || []).forEach((t) => decimalToNumber(null, t));
    } catch (_) { /* utils/money is always present in this tree; this is paranoia */ }

    const currentAdmission =
      admissions.find((a) => a.status === "Active") || admissions[0] || null;

    // ICUBundle — fetched scoped to the current admission so the print sees
    // every shift of every day of the stay (not the UHID-level 30-day cap
    // applied by listByUhid). For OPD-only patients or visits with no
    // currentAdmission we skip and return []. Each row is unwrapped into a
    // print-friendly shape with bundles: [{key, title, items[], compliancePct, ...}].
    const SHIFT_ORDER = { Morning: 0, Evening: 1, Night: 2 };
    const BUNDLE_TITLES = {
      vap:    "VAP — Ventilator-Associated Pneumonia",
      cauti:  "CAUTI — Catheter-Associated UTI",
      clabsi: "CLABSI — Central Line BSI",
      dvt:    "DVT Prophylaxis",
      sepsis: "Sepsis — Hour-1 Bundle",
      sup:    "SUP — Stress Ulcer Prophylaxis",
    };
    const icuBundles = (ICUBundle && currentAdmission?._id)
      ? await safe("icuBundles", async () => {
          const rows = await ICUBundle
            .find({ admissionId: currentAdmission._id })
            .sort({ date: 1 })
            .lean();
          rows.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
          });
          const BUNDLE_KEYS = ICUBundle.BUNDLE_KEYS || ["vap", "cauti", "clabsi", "dvt", "sepsis", "sup"];
          return rows.map((r) => ({
            _id: r._id,
            UHID: r.UHID,
            admissionId: r.admissionId,
            admissionNumber: r.admissionNumber,
            patientName: r.patientName,
            date: r.date,
            shift: r.shift,
            status: r.status,
            overallCompliancePct: r.overallCompliancePct,
            notes: r.notes,
            finalizedBy: r.finalizedBy || "",
            finalizedAt: r.finalizedAt || null,
            bundles: BUNDLE_KEYS.map((k) => {
              const b = r[k] || {};
              return {
                key: k,
                title: BUNDLE_TITLES[k] || k.toUpperCase(),
                applicable: b.applicable !== false,
                items: Array.isArray(b.items) ? b.items : [],
                compliancePct: typeof b.compliancePct === "number" ? b.compliancePct : 0,
                nurseName: b.nurseName || "",
                signedAt: b.signedAt || null,
              };
            }),
          }));
        })
      : [];

    // ── Build a unified chronological timeline. Each entry has a stable
    // shape the UI can render without knowing the source model.
    const timeline = [];
    const push = (when, kind, label, ref, extra = {}) => {
      if (!when) return;
      timeline.push({
        when: new Date(when).toISOString(),
        kind,            // "doctor-note" | "nurse-note" | "order" | "consent" | "mar" | "vital" | "transfer" | "investigation" | "bill" | "audit" | "admission" | "discharge"
        label,           // human-readable headline
        ref,             // { id, model }
        ...extra,
      });
    };

    admissions.forEach((a) => {
      // The Admission collection holds OPD / Day-Care / Services rows
      // too — only call them "Admitted" when a bed was actually given.
      const isBedded = a.hasBed === true;
      const headline = isBedded
        ? `Admitted — ${a.admissionType || "IPD"} — ${a.reasonForAdmission || ""}`
        : `${a.admissionType || "Visit"} — ${a.reasonForAdmission || ""}`;
      push(a.admissionDate || a.createdAt, isBedded ? "admission" : "visit",
        headline,
        { id: a._id, model: "Admission" },
        { dischargedAt: a.dischargeDate, admissionType: a.admissionType });
    });

    // OPDRegistration visits — each is a complete saved assessment.
    // Headline = visitNumber + dept + chief complaint.
    opdVisits.forEach((v) => push(v.visitDate || v.createdAt, "opd-visit",
      `OPD ${v.visitNumber || ""} — ${v.department || ""}${v.consultantName ? " — " + v.consultantName : ""}${v.chiefComplaint ? " — " + v.chiefComplaint.slice(0, 60) : ""}`,
      { id: v._id, model: "OPDRegistration" },
      { status: v.status, visitNumber: v.visitNumber, finalDiagnosis: v.finalDiagnosis || v.provisionalDiagnosis }));

    // Intake/Output events — small per-event entries in the timeline
    // (the dedicated I/O sheet section still renders the full grouped
    // table; this is just the chronological breadcrumb).
    (intakeOutput || []).forEach((io) => push(io.ts || io.createdAt, "intake-output",
      `${io.direction === "IN" ? "▼ IN" : "▲ OUT"} ${io.volumeML} mL — ${io.fluidType || io.label || ""}`,
      { id: io._id, model: "IntakeOutputEntry" },
      { direction: io.direction, volumeML: io.volumeML, source: io.source }));

    doctorNotes.forEach((n) => push(n.visitDate || n.createdAt, "doctor-note",
      `Dr ${n.doctorName || ""} — ${n.noteType || "progress"} note`,
      { id: n._id, model: "DoctorNotes" },
      { signed: n.status === "signed" }));

    nurseNotes.forEach((n) => push(n.createdAt, "nurse-note",
      `Nurse ${n.nurseName || ""} — ${n.noteType || "general"}`,
      { id: n._id, model: "NurseNotes" }));

    doctorOrders.forEach((o) => push(o.orderedAt || o.createdAt, "order",
      `${o.orderType || "Order"} — ${o.orderDetails?.medicineName || o.orderDetails?.displayName || ""}`,
      { id: o._id, model: "DoctorOrder" },
      { status: o.status }));

    consents.forEach((c) => push(c.createdAt, "consent",
      `Consent — ${c.consentTitle || c.consentType} (${c.status})`,
      { id: c._id, model: "ConsentForm" }));

    dischargeSummary.forEach((d) => push(d.finalizedAt || d.createdAt, "discharge",
      `Discharge summary — ${d.status}`,
      { id: d._id, model: "DischargeSummary" }));

    bedTransfers.forEach((t) => push(t.createdAt, "transfer",
      `Bed transfer — ${t.status}`,
      { id: t._id, model: "BedTransfer" }));

    investigations.forEach((i) => push(i.createdAt, "investigation",
      `Investigation — ${(i.items || []).map((x) => x.investigationName).slice(0, 3).join(", ") || "—"} (${i.orderStatus})`,
      { id: i._id, model: "InvestigationOrder" }));

    bills.forEach((b) => push(b.createdAt, "bill",
      `Bill ${b.billNumber || "(draft)"} — ${b.billStatus}`,
      { id: b._id, model: "PatientBill" }));

    vitals.forEach((v) => push(v.recordedAt || v.createdAt, "vital",
      `Vitals recorded — BP ${v.bp?.systolic || "—"}/${v.bp?.diastolic || "—"}, P ${v.pulse || "—"}`,
      { id: v._id, model: "VitalSheet" }));

    // Timeline entries for lab trend sheets + narrative reports — gives
    // the treating doctor a chronological feed of evidence captures.
    labTrends.forEach((t) => push(t.createdAt, "lab-trend",
      `Lab trend — ${t.panelName || t.panelType} (${t.tests?.length || 0} tests · ${t.dates?.length || 0} columns)`,
      { id: t._id, model: "LabTrend" },
      { status: t.status }));
    labReports.forEach((r) => push(r.reportDate || r.createdAt, "lab-report",
      `${r.testName}${r.impression ? " — " + r.impression.slice(0, 60) : ""} (${r.status})`,
      { id: r._id, model: "LabReport" },
      { status: r.status, reportType: r.reportType }));

    dietPlans.forEach((d) => push(d.assignedAt || d.createdAt, "diet-plan",
      `Diet plan — ${d.plan?.templateName || "Custom"} (${d.status})${d.plan?.targetCalories ? ` · ${d.plan.targetCalories} kcal` : ""}${d.plan?.targetProtein ? ` / ${d.plan.targetProtein} g` : ""}`,
      { id: d._id, model: "PatientDietPlan" },
      { status: d.status, templateCode: d.plan?.templateCode }));

    // ICU bundles — one timeline entry per shift sheet so the unified feed
    // shows when each VAP/CAUTI/CLABSI/... bundle was finalized.
    icuBundles.forEach((b) => push(b.finalizedAt || b.date, "icu-bundle",
      `ICU bundles — ${b.date} ${b.shift} (${b.overallCompliancePct}%${b.status === "finalized" ? " · signed" : " · draft"})`,
      { id: b._id, model: "ICUBundle" },
      { status: b.status, shift: b.shift, date: b.date, compliancePct: b.overallCompliancePct }));

    activityLog.forEach((a) => push(a.createdAt, "audit",
      `${a.userName || "System"} — ${a.module}/${a.action}${a.area ? ` (${a.area})` : ""}`,
      { id: a._id, model: "PatientActivityLog" },
      { tags: a.tags, summary: a.summary }));

    timeline.sort((a, b) => new Date(b.when) - new Date(a.when));

    // ── Section completeness map — UI shows a green check / amber warn
    // next to each section depending on whether the patient has data
    // captured. NABH inspectors find missing-section gaps fast this way.
    const completeness = {
      admission:           !!currentAdmission,
      doctorInitialNote:   doctorNotes.some((n) => /initial/i.test(n.noteType || "")),
      nurseInitialNote:    nurseNotes.some((n)  => /initial/i.test(n.noteType || "")),
      orders:              doctorOrders.length > 0,
      consents:            consents.length > 0,
      investigations:      investigations.length > 0,
      vitalsRecorded:      vitals.length > 0 || nurseNotes.some((n) => n.vitals),
      dischargeFinalized:  dischargeSummary.some((d) => d.status === "finalized"),
      handoverDone:        shiftHandovers.length > 0 || bedTransfers.some((t) => t.status === "Complete"),
      dietPlanned:         dietPlans.some((d) => d.status === "active"),
    };

    // R7bf-J/A8-CRIT-2: cursor metadata so the UI can request older windows.
    // A section flags `hasMore` when its row count hits PER_SECTION_LIMIT —
    // the UI then offers "Load older" which re-calls this endpoint with
    // `?to=<oldest-shown-when>&from=<to - 7d>`.
    const oldest = (rows, key = "createdAt") =>
      rows.length ? rows[rows.length - 1][key] || null : null;
    const pagination = {
      from: fromDate.toISOString(),
      to:   toDate.toISOString(),
      perSectionLimit: PER_SECTION_LIMIT,
      hasMore: {
        doctorNotes:        doctorNotes.length        >= PER_SECTION_LIMIT,
        nurseNotes:         nurseNotes.length         >= PER_SECTION_LIMIT,
        doctorOrders:       doctorOrders.length       >= PER_SECTION_LIMIT,
        nursingAssessments: nursingAssessments.length >= PER_SECTION_LIMIT,
        nursingCarePlans:   nursingCarePlans.length   >= PER_SECTION_LIMIT,
        shiftHandovers:     shiftHandovers.length     >= PER_SECTION_LIMIT,
        mar:                mar.length                >= PER_SECTION_LIMIT,
        vitals:             vitals.length             >= PER_SECTION_LIMIT,
        investigations:     investigations.length     >= PER_SECTION_LIMIT,
        billingTriggers:    billingTriggers.length    >= PER_SECTION_LIMIT,
        activityLog:        activityLog.length        >= PER_SECTION_LIMIT,
        labTrends:          labTrends.length          >= PER_SECTION_LIMIT,
        labReports:         labReports.length         >= PER_SECTION_LIMIT,
      },
      // Next "to=" the UI should pass when asking for older rows in each section.
      cursor: {
        doctorNotes:        oldest(doctorNotes),
        nurseNotes:         oldest(nurseNotes),
        doctorOrders:       oldest(doctorOrders, "orderedAt"),
        mar:                oldest(mar),
        vitals:             oldest(vitals, "recordedAt"),
        billingTriggers:    oldest(billingTriggers),
        activityLog:        oldest(activityLog),
      },
    };

    return res.json({
      success: true,
      data: {
        patient,
        admissions,
        currentAdmission,
        // New — full OPD visit history (every OPDRegistration row),
        // surfaced so the Patient File page / new Patient History view
        // can show every past assessment a doctor saved.
        opdVisits,
        doctorNotes,
        nurseNotes,
        doctorOrders,
        mar,
        vitals,
        nursingAssessments,
        nursingCarePlans,
        shiftHandovers,
        bedTransfers,
        consents,
        dischargeSummary,
        mlc,
        investigations,
        bills,
        billingTriggers,
        activityLog,
        dietPlans,
        // New — atomic intake/output events (per-fluid grain).
        intakeOutput,
        labTrends,
        labReports,
        // ICU care bundles (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP) —
        // every shift sheet for the current admission, with items[] unwrapped
        // for direct print rendering.
        icuBundles,
        // R7ft-FIX2 — blood transfusion register (NABH HIC.4 / MOM.4).
        bloodTransfusion,
        // R7hr — device lifecycle rows (placed → changes[] → removed) for
        // the chronological Complete File print's Devices History section.
        devices,
        // R7hr — full-coverage additions ("everything captured must reach
        // the Complete File"): see the coverage-audit block above.
        emergencyCases,
        prescriptions,
        medicalCertificates,
        physioPlans,
        physioSessions,
        medReconciliation,
        diabeticCharts,
        pharmacySales,
        advances,
        appointments,
        procedureNotes,
        adrReports,
        foodReactions,
        promPremSurveys,
        codeResponseEvents,
        complianceRegisters,
        timeline,
        completeness,
        pagination,
      },
    });
  } catch (e) {
    console.error("[patientFile] getCompleteFile error:", e);
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/fhir-bundle
// Emits the patient's complete file as an HL7 FHIR R5 Bundle for
// interop with ABDM / downstream EMRs. Reuses getCompleteFile's
// resolver internally; output is a sibling endpoint.
// ─────────────────────────────────────────────────────────────
exports.getFhirBundle = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID required" });

    const patient = await Patient.findOne({ UHID }).lean();
    if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

    const [admissions, doctorNotes, nurseNotes, doctorOrders, vitals,
           consents, investigations, dischargeSummary] = await Promise.all([
      safe("admissions",       () => Admission.find({ UHID }).sort({ admissionDate: -1 }).lean()),
      safe("doctorNotes",      () => DoctorNotes.find({ patientUHID: UHID }).sort({ visitDate: -1 }).lean()),
      safe("nurseNotes",       () => NurseNotes.find({ patientUHID: UHID }).sort({ createdAt: -1 }).lean()),
      safe("doctorOrders",     () => DoctorOrder.find({ UHID }).sort({ orderedAt: -1 }).lean()),
      // R7bu — VitalSheet keys on lowercase `uhid`; recordedAt isn't
      // a top-level field. Sort by createdAt DESC instead.
      safe("vitals",           () => VitalSheet ? VitalSheet.find({ uhid: UHID }).sort({ createdAt: -1 }).lean() : []),
      safe("consents",         () => ConsentForm.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("investigations",   () => InvestigationOrder.find({ UHID }).sort({ createdAt: -1 }).lean()),
      safe("dischargeSummary", () => DischargeSummary.find({ UHID }).sort({ createdAt: -1 }).lean()),
    ]);

    const currentAdmission = admissions.find((a) => a.status === "Active") || admissions[0] || null;
    let hospital = {};
    try {
      // R7cb-D: was require("../../models/hospitalSettingsModel") which never
      // resolved — MODULE_NOT_FOUND was caught silently, falling back to the
      // hardcoded "SphereHealth Hospital" string in every FHIR export. Correct
      // path is sibling-relative ../../models/HospitalSettings (no extension).
      const HospitalSettings = require("../../models/HospitalSettings");
      hospital = (await HospitalSettings.findOne({}).lean()) || {};
    } catch (e) {
      console.warn("[patientFileController] HospitalSettings not loaded:", e?.message);
    }

    const { buildBundle } = require("../../services/Clinical/fhirExporter");
    const bundle = buildBundle({
      patient, currentAdmission, doctorNotes, nurseNotes, doctorOrders, vitals,
      consents, investigations, dischargeSummary,
    }, hospital);

    // Audit the disclosure event
    try {
      const activityLogger = require("../../services/Clinical/activityLogger");
      const u = req.user || {};
      activityLogger.log({
        UHID,
        module: "PatientFile.FHIR",
        action: "export",
        area: "fhir-bundle",
        summary: `FHIR R5 bundle exported (${bundle.entry?.length || 0} resources)`,
        userId: u._id || u.id || null,
        userName: u.fullName || "",
        userRole: u.role || "",
        httpMethod: req.method, httpPath: req.originalUrl,
        ip: req.ip, userAgent: req.headers["user-agent"] || "",
        tags: ["disclosure", "fhir"],
        isFlagged: true,
      }).catch((e) => console.error(`[patientFile] FHIR-disclosure audit-log failed: ${e?.message}`));
    } catch (e) { console.error(`[patientFile] FHIR audit dispatch error: ${e?.message}`); }

    res.setHeader("Content-Type", "application/fhir+json");
    return res.json(bundle);
  } catch (e) {
    console.error("[patientFile] getFhirBundle error:", e);
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/sign-status
// Returns the current PAdES-LTV signing configuration state so the
// front-end can render an accurate "digitally signed" badge on the
// print template. (Roadmap F22.)
// ─────────────────────────────────────────────────────────────
exports.signStatus = async (req, res) => {
  try {
    const { SIG_STATUS, signPdfPades, renderSignatureLine } = require("../../services/Clinical/padesSigner");
    // Dry-run with an empty buffer — exercises the config check + status
    // without actually signing anything.
    const probe = await signPdfPades(Buffer.from("dry-run"), {});
    return res.json({
      success: true,
      configured: probe.status !== SIG_STATUS.NONE,
      status: probe.status,
      signedBy: probe.signedBy,
      line: renderSignatureLine(probe),
      hint: probe.error,
    });
  } catch (e) {
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/audit-verify
// Walks the activity-log chain for the patient and reports any
// rows whose stored rowHash disagrees with a recomputed hash —
// i.e. anything that was tampered with after insert.
// ─────────────────────────────────────────────────────────────
exports.verifyAuditChain = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    const rows = await PatientActivityLog.find({ UHID }).sort({ createdAt: 1 }).lean();
    const crypto = require("crypto");
    const bad = [];
    let prev = "";
    for (const r of rows) {
      const { rowHash, _id, __v, ...payload } = r;
      // Drop the chain fields from the payload before re-hashing; recreate
      // the doc shape used in activityLogger.log() exactly.
      const doc = { ...payload };
      delete doc.prevHash;
      doc.prevHash = prev;
      const canonical = JSON.stringify(doc, Object.keys(doc).sort());
      const expected = crypto.createHash("sha256").update(canonical + "|" + prev).digest("hex");
      if (expected !== rowHash) {
        bad.push({ id: _id, when: r.createdAt, action: r.action, expected, stored: rowHash });
      }
      prev = rowHash;
    }
    return res.json({ success: true, checked: rows.length, tampered: bad.length, rows: bad });
  } catch (e) {
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/activity?limit=200&module=...&action=...
// Paginated audit feed — used by the activity-log drawer in the UI.
// ─────────────────────────────────────────────────────────────
exports.getActivityFeed = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const page  = Math.max(1, Number(req.query.page) || 1);
    const filter = { UHID };
    if (req.query.module) filter.module = req.query.module;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
    }
    const [rows, total] = await Promise.all([
      PatientActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      PatientActivityLog.countDocuments(filter),
    ]);
    return res.json({ success: true, data: rows, pagination: { page, limit, total } });
  } catch (e) {
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/patient-file/:uhid/log
// Body: { module, action, area, summary, sourceModel, sourceId, before, after, tags }
// Frontend-driven event logger — used for "click" and "select"
// actions that don't otherwise hit a mutating endpoint.
// ─────────────────────────────────────────────────────────────
exports.logEvent = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    const { module: mod, action, area, summary, sourceModel, sourceId, before, after, tags, ipdNo, admissionId, isFlagged } = req.body || {};
    if (!mod || !action) {
      return res.status(400).json({ success: false, message: "module and action are required" });
    }
    // R7hr-227 (security audit) — the /log endpoint is intentionally broad
    // (every role logs its own activity, and the actor is server-pinned below),
    // but pre-fix a caller could append forged rows to the hash-chained NABH
    // audit trail for arbitrary / non-existent UHIDs. For the non-clinical roles
    // that hold the broad demographics token (Reception / Lab / Pharmacist /
    // Dietician / TPA / Accountant) bind the write to a REAL patient so the
    // trail cannot be polluted with phantom-patient rows. Clinical roles
    // (Admin/Doctor/Nurse/MRD) drive most patient-file activity and are skipped
    // so their high-value audit events are never dropped on a hot path.
    const _role = req.user?.role || "";
    if (!["Admin", "Doctor", "Nurse", "MRD"].includes(_role)
        && (!UHID || !(await Patient.exists({ UHID })))) {
      return res.status(400).json({ success: false, code: "UNKNOWN_UHID", message: "Cannot log activity for an unknown patient UHID." });
    }
    const activityLogger = require("../../services/Clinical/activityLogger");
    const user = req.user || {};
    const row = await activityLogger.log({
      UHID, ipdNo: ipdNo || "", admissionId: admissionId || null,
      module: mod, action, area: area || "", summary: summary || "",
      sourceModel: sourceModel || "", sourceId: sourceId || null,
      before, after, tags: Array.isArray(tags) ? tags : [], isFlagged: !!isFlagged,
      userId:   user._id || user.id || null,
      userName: user.fullName || user.firstName || user.userName || "",
      userRole: user.role || user.userRole || "",
      httpMethod: req.method,
      httpPath:   req.originalUrl,
      ip:         req.ip || "",
      userAgent:  req.headers["user-agent"] || "",
    });
    return res.json({ success: true, data: row });
  } catch (e) {
    return sendErr(res, e);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/patient-file/:uhid/audit-bundle
// Aggregates the four patient-scoped audit trails for the
// "Complete Patient File + audit logs" print (Admin + MRD only —
// gated by the dedicated patient-file.audit-print action so the
// broader reports.audit token doesn't have to widen to MRD):
//   activityLog   — PatientActivityLog (file access; NABH IMS.1)
//   printAudit    — PrintAudit (who printed what; NABH IMS.4)
//   billingAudit  — BillingAudit (money trail)
//   clinicalAudit — ClinicalAudit (clinical action trail; AAC.7)
// Optional query: admissionId (narrows billing/clinical rows),
// from / to (createdAt window). Each source capped at 500 rows,
// newest first; before/after blobs are never included.
// ─────────────────────────────────────────────────────────────
const PrintAuditModel   = (() => { try { return require("../../models/Billing/PrintAuditModel"); } catch { return null; } })();
const BillingAuditModel = (() => { try { return require("../../models/Billing/BillingAudit"); } catch { return null; } })();
const ClinicalAuditModel = (() => { try { return require("../../models/Compliance/ClinicalAuditModel"); } catch { return null; } })();

exports.getAuditBundle = async (req, res) => {
  try {
    const UHID = String(req.params.uhid || "").toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID is required" });
    const CAP = 500;

    const window = {};
    if (req.query.from) window.$gte = new Date(req.query.from);
    if (req.query.to)   window.$lte = new Date(req.query.to);
    const withWindow = (filter, field = "createdAt") =>
      (window.$gte || window.$lte) ? { ...filter, [field]: window } : filter;

    const admissionId = req.query.admissionId && /^[a-f0-9]{24}$/i.test(String(req.query.admissionId))
      ? String(req.query.admissionId) : null;
    const scoped = (filter) => admissionId ? { ...filter, admissionId } : filter;

    const [activityLog, printAudit, billingAudit, clinicalAudit] = await Promise.all([
      PatientActivityLog
        .find(withWindow({ UHID }))
        .select("action module area summary userName userRole createdAt")
        .sort({ createdAt: -1 }).limit(CAP).lean(),
      PrintAuditModel
        ? PrintAuditModel
            .find(withWindow({ UHID }, "printedAt"))
            .select("entityType entityNumber printCount printedByName printedByRole printedAt")
            .sort({ printedAt: -1 }).limit(CAP).lean()
        : [],
      BillingAuditModel
        ? BillingAuditModel
            .find(withWindow(scoped({ UHID })))
            .select("event billNumber amount paymentMode actorName actorRole reason createdAt")
            .sort({ createdAt: -1 }).limit(CAP).lean()
            // amount is Decimal128 — lean() leaves it as {$numberDecimal:"x"},
            // which the print appendix can't format. Flatten to a plain number.
            .then((rows) => rows.map((r) => ({
              ...r,
              amount: r.amount != null ? Number(r.amount.$numberDecimal ?? r.amount) : null,
            })))
        : [],
      ClinicalAuditModel
        ? ClinicalAuditModel
            .find(withWindow(scoped({ UHID })))
            .select("event targetType actorName actorRole reason createdAt")
            .sort({ createdAt: -1 }).limit(CAP).lean()
        : [],
    ]);

    return res.json({
      success: true,
      data: {
        activityLog, printAudit, billingAudit, clinicalAudit,
        window: { from: req.query.from || null, to: req.query.to || null, admissionId },
        capped: {
          activityLog:   activityLog.length   >= CAP,
          printAudit:    printAudit.length    >= CAP,
          billingAudit:  billingAudit.length  >= CAP,
          clinicalAudit: clinicalAudit.length >= CAP,
        },
      },
    });
  } catch (e) {
    return sendErr(res, e);
  }
};
