/**
 * R7hr-96 — Medication Reconciliation fan-out
 * ─────────────────────────────────────────────
 * When a doctor signs the IPD Initial Assessment and the
 * `noteDetails.nabh.medicationReconciliation` array carries rows marked
 * `continueOnAdmit: "Continue"`, each Continue row spawns a fresh
 * DoctorOrder of orderType=Medication so the medicine immediately lands
 * in the MAR / Treatment Chart and the nurse sees it on her next
 * refresh.
 *
 * Why fan-out (not embed):
 *  - MAR + Indent + Auto-billing all read DoctorOrder; embedding inside
 *    the IA note would require every consumer to dual-source.
 *  - DoctorOrder has the HAM auto-flag + two-nurse-verify enforcement
 *    in its own pre-save hook — re-using it means we don't drift.
 *
 * Idempotency:
 *  - We stamp `sourceRef: "medrecon:<noteId>:<rowIdx>"` on each created
 *    DoctorOrder. A repeat call (re-sign / amend) skips rows whose
 *    sourceRef already exists. "Hold" rows are NEVER created.
 *
 * Failures:
 *  - Per-row try/catch. A single row that fails validation (e.g. blank
 *    dose) logs + skips; the IA sign itself never fails because of a
 *    medRecon problem. Caller (doctorNotesService.signDoctorNote) wraps
 *    the whole call in try/catch too.
 */

const mongoose = require("mongoose");
const DoctorOrder = require("../../models/Doctor/DoctorOrderModel");
const Admission   = require("../../models/Patient/admissionModel");

/* ─── R7hr-97 — Duration parser (kept in sync with doctorOrderRoutes.js) ───
 * Returns:
 *   null  → open-ended course (blank / "continue" / "daily" / "STAT" / "SOS")
 *           DoctorOrder.endDate stays null so missedDoseCron NEVER auto-
 *           completes it — the only way it stops is doctor explicit
 *           Discontinue. This is the user's spec: "agar doctor ne days
 *           mention nhi kiya hai to wo aapne aap band nhi ho sakti".
 *   1..30 → bounded course (capped at 30 days). DoctorOrder.endDate is
 *           stamped to admissionDate + N days; the EOD completion-check
 *           flips the order to Completed once endDate is in the past.
 */
function parseDurationToDays(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.toLowerCase().trim();
  if (!s) return null;                                  // ← blank means open-ended
  if (s.includes("continu") || s === "daily" || s === "stat" || s === "sos") return null;
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\b/);
  if (hourMatch) return Math.min(30, Math.max(1, Math.ceil(parseFloat(hourMatch[1]) / 24)));
  const dayMatch  = s.match(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?/);
  if (dayMatch)  return Math.min(30, Math.max(1, Math.round(parseFloat(dayMatch[1]))));
  const weekMatch = s.match(/(\d+(?:\.\d+)?)\s*w(?:k|ks|eek|eeks)?\b/);
  if (weekMatch) return Math.min(30, Math.max(1, Math.round(parseFloat(weekMatch[1]) * 7)));
  if (/\d+\s*m(?:onth)?s?\b/.test(s)) return 30;
  const bareNum = s.match(/^\d+$/);
  if (bareNum) return Math.min(30, Math.max(1, parseInt(s, 10)));
  return null;                                          // ← unrecognised text → open-ended (safer)
}

function dateAtMidnightOffset(base, nDays) {
  const d = new Date(base);
  d.setDate(d.getDate() + nDays);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Resolve the active admission for a note. Used by all 3 fan-outs so we
// only do the lookup once per sign.
async function resolveAdmission(note) {
  let admission = null;
  if (note.admissionId && mongoose.isValidObjectId(note.admissionId)) {
    admission = await Admission.findById(note.admissionId)
      .select("_id admissionNumber ipdNo admissionDate patientId UHID patientName patientUHID")
      .lean();
  }
  if (!admission && note.ipdNo) {
    admission = await Admission.findOne({
      $or: [{ admissionNumber: note.ipdNo }, { ipdNo: note.ipdNo }],
    }).select("_id admissionNumber ipdNo admissionDate patientId UHID patientName patientUHID").lean();
  }
  return admission;
}

// Derive a sensible default route from the drug-name prefix. The form
// prefix convention is enforced by PrescriptionPanel (R7hr-71) — Tab→Oral,
// Cap→Oral, Inj→IV, Cream→Topical, Drops→Eye/Ear, etc.
function deriveRoute(drugName = "") {
  const n = drugName.toLowerCase();
  if (/^(tab|cap|caps|tablet|capsule)\b/.test(n)) return "Oral";
  if (/^(inj|injection|amp|ampoule|vial)\b/.test(n)) return "IV";
  if (/^syr\b|^syp\b|^syrup\b|^suspension\b/.test(n)) return "Oral";
  if (/^cream\b|^oint\b|^ointment\b|^gel\b/.test(n)) return "Topical";
  if (/eye.*drop|drop.*eye/.test(n)) return "Ophthalmic";
  if (/ear.*drop|drop.*ear/.test(n)) return "Otic";
  if (/^inhal|^puff|^spray\b|^neb\b/.test(n)) return "Inhalation";
  if (/^patch\b/.test(n)) return "Transdermal";
  if (/^supp\b|^suppository\b/.test(n)) return "Rectal";
  return "Oral";          // safe default
}

// Normalize dose so it passes the DoctorOrderModel format validator
// (`<positive number><unit>` with known unit list). The validator
// accepts numbers like "500mg", "1.5 mg", "5 ml". Med-recon free-text
// like "500mg" already passes; "1 hour prior admission" doesn't apply
// to dose. If dose is blank or non-numeric, return null so we can
// skip the row instead of failing the model insert.
function safeDose(d) {
  if (!d) return null;
  const trimmed = String(d).trim();
  if (!trimmed) return null;
  // Must start with a digit followed by a recognized unit.
  if (/^\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|kg|ml|l|iu|u|units?|drops?|tabs?|caps?|puffs?|sprays?|patch(?:es)?|tsp|tbsp|%)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Fan out the medication reconciliation list of a signed Initial
 * Assessment doctor note into per-medicine DoctorOrder rows.
 *
 * @param {object} note - the signed DoctorNote document (or lean obj)
 * @returns {Promise<{created: number, skipped: number, reasons: object}>}
 */
async function fanOutMedReconToDoctorOrders(note) {
  const out = { created: 0, skipped: 0, reasons: {} };
  if (!note || note.noteType !== "initial") return out;

  // R7hr-111 — Path-drift fix. After R26 (Doctor IA + Nurse IA separate
  // records, doctor block wrapped under noteDetails.doctor), the canonical
  // location for medRecon is noteDetails.doctor.nabh.medicationReconciliation.
  // The legacy noteDetails.nabh.medicationReconciliation path is kept as a
  // backward-compat fallback for pre-R26 records. Without this fix the
  // fan-out was silently reading [] and skipping every Continue row, so
  // home medications marked Continue never landed in MAR.
  const rows =
    note?.noteDetails?.doctor?.nabh?.medicationReconciliation ||
    note?.noteDetails?.nabh?.medicationReconciliation;
  if (!Array.isArray(rows) || rows.length === 0) return out;

  // We need the admission for visitId / admissionNumber / patientId so
  // the fanned-out orders link to MAR + auto-billing + patient history.
  const admission = await resolveAdmission(note);
  if (!admission) {
    out.reasons.noAdmission = (out.reasons.noAdmission || 0) + rows.length;
    out.skipped += rows.length;
    return out;
  }

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i] || {};
    const sourceRef = `medrecon:${note._id}:${i}`;
    try {
      if (m.continueOnAdmit !== "Continue") { out.skipped++; out.reasons.notContinue = (out.reasons.notContinue || 0) + 1; continue; }
      const drug = (m.drug || "").trim();
      if (!drug) { out.skipped++; out.reasons.blankDrug = (out.reasons.blankDrug || 0) + 1; continue; }

      // Idempotency: if a DoctorOrder with this sourceRef already exists
      // (re-sign / amend / retry), skip without re-creating.
      const exists = await DoctorOrder.findOne({ sourceRef }).select("_id").lean();
      if (exists) { out.skipped++; out.reasons.alreadyExists = (out.reasons.alreadyExists || 0) + 1; continue; }

      const dose = safeDose(m.dose);
      if (!dose) { out.skipped++; out.reasons.invalidDose = (out.reasons.invalidDose || 0) + 1; continue; }
      const frequency = (m.frequency || "").trim();
      if (!frequency) { out.skipped++; out.reasons.blankFrequency = (out.reasons.blankFrequency || 0) + 1; continue; }

      await DoctorOrder.create({
        UHID: admission.UHID || note.patientUHID,
        patientId: admission.patientId || note.patient,
        patientName: admission.patientName || note.patientName,
        admissionId: admission._id,
        ipdNo: admission.admissionNumber || admission.ipdNo,
        admissionNumber: admission.admissionNumber || admission.ipdNo,
        visitType: "IPD",
        orderType: "Medication",
        priority: "Routine",
        orderDetails: {
          medicineName: drug,
          displayName: drug,
          dose,
          frequency,
          route: deriveRoute(drug),
          notes: `Continued from Initial Assessment (NABH MOM) — last taken: ${m.lastTaken || "—"}`,
        },
        orderedBy: note.signedByName || note.doctorName,
        orderedByRole: "Doctor",
        orderedAt: note.signedAt || new Date(),
        // R7hr-112 — Created as "Pending" so the nurse must explicitly
        // Acknowledge before the order shows as administered. NABH ISMP +
        // 7-rights of medication require nurse-side verification BEFORE
        // any dose hits the MAR as active/given. Pre-R7hr-112 we wrote
        // "Active" which the Live MAR rendered as already-running.
        status: "Pending",
        sourceRef,        // ← idempotency key
        // HAM and concentratedElectrolyte are auto-derived by the
        // DoctorOrder pre-save hook from medicineName — no need to
        // pass them explicitly. The frontend `isHAM` flag is advisory.
      });
      out.created++;
    } catch (err) {
      out.skipped++;
      out.reasons.error = (out.reasons.error || 0) + 1;
      const { logErr } = require("../../utils/logErr");
      logErr("medReconFanOut", `row ${i} drug=${m.drug} sourceRef=${sourceRef}`)(err);
    }
  }
  return out;
}

/**
 * R7hr-97 — Fan out IPD IA `meds[]` (PrescriptionPanel rows) into
 * DoctorOrder Medication entries so they immediately surface on the MAR
 * / Treatment Chart.
 *
 * Duration semantics (user's spec):
 *   - blank duration / "Continue" / "Daily" → endDate=null → MAR shows the
 *     order indefinitely; missedDoseCron's auto-complete check honours
 *     the null endDate and never auto-discontinues. Doctor must Discontinue
 *     manually.
 *   - "3 days" / "1 week" → courseDays=N, endDate=admissionDate+N. The EOD
 *     completion check flips the order to Completed once endDate is in
 *     the past, so MAR drops it from the active list automatically.
 *
 * Med row shape: { name, genericName?, form?, dose, frequency, mealStatus, duration, route }
 */
async function fanOutMedsToDoctorOrders(note) {
  const out = { created: 0, skipped: 0, reasons: {} };
  if (!note || note.noteType !== "initial") return out;
  const rows = note?.noteDetails?.doctor?.meds;
  if (!Array.isArray(rows) || rows.length === 0) return out;

  const admission = await resolveAdmission(note);
  if (!admission) {
    out.reasons.noAdmission = rows.length;
    out.skipped += rows.length;
    return out;
  }
  const admDate = admission.admissionDate ? new Date(admission.admissionDate) : new Date();

  for (let i = 0; i < rows.length; i++) {
    const m = rows[i] || {};
    const sourceRef = `iameds:${note._id}:${i}`;
    try {
      const name = (m.name || "").trim();
      if (!name) { out.skipped++; out.reasons.blankDrug = (out.reasons.blankDrug || 0) + 1; continue; }
      const exists = await DoctorOrder.findOne({ sourceRef }).select("_id").lean();
      if (exists) { out.skipped++; out.reasons.alreadyExists = (out.reasons.alreadyExists || 0) + 1; continue; }
      const dose = safeDose(m.dose);
      if (!dose) { out.skipped++; out.reasons.invalidDose = (out.reasons.invalidDose || 0) + 1; continue; }
      const frequency = (m.frequency || "").trim();
      if (!frequency) { out.skipped++; out.reasons.blankFrequency = (out.reasons.blankFrequency || 0) + 1; continue; }

      const days = parseDurationToDays(m.duration);   // null when blank or "continue"
      const courseDays = days;                         // null = open-ended
      const endDate    = days ? dateAtMidnightOffset(admDate, days) : null;

      await DoctorOrder.create({
        UHID: admission.UHID || note.patientUHID,
        patientId: admission.patientId || note.patient,
        patientName: admission.patientName || note.patientName,
        admissionId: admission._id,
        ipdNo: admission.admissionNumber || admission.ipdNo,
        admissionNumber: admission.admissionNumber || admission.ipdNo,
        visitType: "IPD",
        orderType: "Medication",
        priority: "Routine",
        orderDetails: {
          medicineName: name,
          displayName: name,
          dose,
          frequency,
          route: (m.route || deriveRoute(name)) || "Oral",
          mealStatus: ["BeforeFood","WithFood","AfterFood","EmptyStomach"].includes(m.mealStatus) ? m.mealStatus : "NotApplicable",
          duration: m.duration || "",
          notes: `Ordered at Initial Assessment${m.duration ? ` — ${m.duration}` : " — no fixed duration"}`,
        },
        courseDays,
        endDate,
        orderedBy: note.signedByName || note.doctorName,
        orderedByRole: "Doctor",
        orderedAt: note.signedAt || new Date(),
        // R7hr-112 — see fanOutMedReconToDoctorOrders rationale: Pending
        // until nurse Acknowledges. ISMP-compliant handoff.
        status: "Pending",
        sourceRef,
      });
      out.created++;
    } catch (err) {
      out.skipped++;
      out.reasons.error = (out.reasons.error || 0) + 1;
      const { logErr } = require("../../utils/logErr");
      logErr("iaMedsFanOut", `row ${i} drug=${m.name} sourceRef=${sourceRef}`)(err);
    }
  }
  return out;
}

/**
 * R7hr-97 — Fan out IPD IA `infusions[]` (InfusionPanel rows) into
 * DoctorOrder IV_Fluid entries so they appear in the nurse's
 * Infusion Orders & Monitoring tab.
 *
 * Infusion row shape: { name, totalVolume, rate, duration, route?, additives, instructions? }
 */
async function fanOutInfusionsToDoctorOrders(note) {
  const out = { created: 0, skipped: 0, reasons: {} };
  if (!note || note.noteType !== "initial") return out;
  const rows = note?.noteDetails?.doctor?.infusions;
  if (!Array.isArray(rows) || rows.length === 0) return out;

  const admission = await resolveAdmission(note);
  if (!admission) {
    out.reasons.noAdmission = rows.length;
    out.skipped += rows.length;
    return out;
  }

  for (let i = 0; i < rows.length; i++) {
    const inf = rows[i] || {};
    const sourceRef = `iainfusion:${note._id}:${i}`;
    try {
      const name = (inf.name || "").trim();
      if (!name) { out.skipped++; out.reasons.blankFluid = (out.reasons.blankFluid || 0) + 1; continue; }
      const exists = await DoctorOrder.findOne({ sourceRef }).select("_id").lean();
      if (exists) { out.skipped++; out.reasons.alreadyExists = (out.reasons.alreadyExists || 0) + 1; continue; }
      // IV_Fluid REQUIRES rate + totalVolume + fluidName on the schema.
      const rate = (inf.rate || "").toString().trim();
      const totalVolume = (inf.totalVolume || inf.vol || "").toString().trim();
      if (!rate) { out.skipped++; out.reasons.blankRate = (out.reasons.blankRate || 0) + 1; continue; }
      if (!totalVolume) { out.skipped++; out.reasons.blankVolume = (out.reasons.blankVolume || 0) + 1; continue; }

      // Normalise rate to include a unit. The InfusionPanel UI lets the doctor
      // type just a number; surface it as "<n> ml/hr" so the MAR rate-change
      // log + intake calc both parse cleanly.
      const ratePretty = /\d+\s*(ml\/hr|ml\/h|mL\/hr|gtt|drops)/i.test(rate) ? rate : `${rate} ml/hr`;
      const volPretty  = /ml|l\b/i.test(totalVolume) ? totalVolume : `${totalVolume} ml`;

      await DoctorOrder.create({
        UHID: admission.UHID || note.patientUHID,
        patientId: admission.patientId || note.patient,
        patientName: admission.patientName || note.patientName,
        admissionId: admission._id,
        ipdNo: admission.admissionNumber || admission.ipdNo,
        admissionNumber: admission.admissionNumber || admission.ipdNo,
        visitType: "IPD",
        orderType: "IV_Fluid",
        priority: "Routine",
        orderDetails: {
          fluidName: name,
          displayName: name,
          rate: ratePretty,
          totalVolume: volPretty,
          duration: inf.duration || "",
          additives: inf.additives || "",
          instructions: inf.instructions || "",
          route: inf.route || "IV",
          notes: `Ordered at Initial Assessment${inf.duration ? ` — ${inf.duration}` : ""}`,
        },
        // R7hr-112 — Do NOT pre-stamp currentRate. The Live MAR Infusion
        // tab treats a populated currentRate (combined with status:Active)
        // as "Running / drip going in", which would let nurses skip the
        // physical setup ceremony (spike bag, prime line, verify rate at
        // pump, attach to patient). The PRESCRIBED rate already lives in
        // orderDetails.rate so the nurse sees what to set; currentRate
        // gets stamped only when she physically starts the bag via the
        // /:id PATCH route. Until then the order stays Pending in her queue.
        // currentRate intentionally omitted — set on nurse Start.
        orderedBy: note.signedByName || note.doctorName,
        orderedByRole: "Doctor",
        orderedAt: note.signedAt || new Date(),
        // R7hr-112 — Pending until nurse acknowledges. See rationale on
        // currentRate above + on fanOutMedReconToDoctorOrders.
        status: "Pending",
        sourceRef,
      });
      out.created++;
    } catch (err) {
      out.skipped++;
      out.reasons.error = (out.reasons.error || 0) + 1;
      const { logErr } = require("../../utils/logErr");
      logErr("iaInfusionFanOut", `row ${i} fluid=${inf.name} sourceRef=${sourceRef}`)(err);
    }
  }
  return out;
}

/**
 * R7hr-110 — Fan out IPD IA `invests[]` (InvestigationsPanel rows) into
 * DoctorOrder Investigation entries so they immediately appear in the
 * nurse's "Doctor Orders → Investigation" queue. Without this, the
 * doctor's lab orders from the IA stayed locked inside `noteDetails`
 * and the nurse had no actionable task → samples never got drawn.
 *
 * Invest row shape: { name, urgency?, instructions? }
 * DoctorOrder schema requires `testName` for orderType=Investigation —
 * we map `name` → `testName`.
 *
 * Idempotency: sourceRef = iainvests:<noteId>:<rowIdx>
 *
 * R25 — additive only; existing 3 fan-outs untouched.
 */
async function fanOutInvestsToDoctorOrders(note) {
  const out = { created: 0, skipped: 0, reasons: {} };
  if (!note || note.noteType !== "initial") return out;
  const rows = note?.noteDetails?.doctor?.invests;
  if (!Array.isArray(rows) || rows.length === 0) return out;

  const admission = await resolveAdmission(note);
  if (!admission) {
    out.reasons.noAdmission = rows.length;
    out.skipped += rows.length;
    return out;
  }

  for (let i = 0; i < rows.length; i++) {
    const inv = rows[i] || {};
    const sourceRef = `iainvests:${note._id}:${i}`;
    try {
      const testName = (inv.name || "").trim();
      if (!testName) { out.skipped++; out.reasons.blankTest = (out.reasons.blankTest || 0) + 1; continue; }
      const exists = await DoctorOrder.findOne({ sourceRef }).select("_id").lean();
      if (exists) { out.skipped++; out.reasons.alreadyExists = (out.reasons.alreadyExists || 0) + 1; continue; }

      const urgency = (inv.urgency || "").trim();
      // Normalize urgency to DoctorOrder.priority enum (Routine / Urgent / STAT)
      const priority =
        /^stat/i.test(urgency) ? "STAT" :
        /^urgent/i.test(urgency) ? "Urgent" :
        "Routine";

      await DoctorOrder.create({
        UHID: admission.UHID || note.patientUHID,
        patientId: admission.patientId || note.patient,
        patientName: admission.patientName || note.patientName,
        admissionId: admission._id,
        ipdNo: admission.admissionNumber || admission.ipdNo,
        admissionNumber: admission.admissionNumber || admission.ipdNo,
        visitType: "IPD",
        orderType: "Investigation",
        priority,
        orderDetails: {
          testName,
          displayName: testName,
          urgency: urgency || "ROUTINE",
          instructions: inv.instructions || "",
          notes: `Ordered at Initial Assessment${urgency ? ` — ${urgency}` : ""}`,
        },
        orderedBy: note.signedByName || note.doctorName,
        orderedByRole: "Doctor",
        orderedAt: note.signedAt || new Date(),
        // R7hr-112 — Pending until nurse acknowledges. Lab samples should
        // not be marked Active before the nurse has seen the order and
        // initiated sample collection.
        status: "Pending",
        sourceRef,
      });
      out.created++;
    } catch (err) {
      out.skipped++;
      out.reasons.error = (out.reasons.error || 0) + 1;
      const { logErr } = require("../../utils/logErr");
      logErr("iaInvestsFanOut", `row ${i} test=${inv.name} sourceRef=${sourceRef}`)(err);
    }
  }
  return out;
}

/**
 * R7hr-109 — Backfill admission.reasonForAdmission + admission.provisionalDiagnosis
 * from the signed Doctor Initial Assessment. The receptionist registration
 * form does NOT enforce these fields (often the doctor only firms up the
 * diagnosis after first assessment), so the Admission Summary card stayed
 * "—" forever even after a complete IA. Now the doctor's IA sign mirrors
 * his chief complaint + provisional diagnosis to the admission record so
 * every downstream surface (Patient Panel Admission Summary, banner,
 * discharge summary header, print) lights up automatically.
 *
 * Idempotency: only sets fields that are currently blank/null/"—" — never
 * overwrites a value the receptionist or doctor explicitly typed.
 */
async function backfillAdmissionFromIA(note) {
  const out = { updated: false, fields: [] };
  if (!note || note.noteType !== "initial") return out;
  const admission = await resolveAdmission(note);
  if (!admission) return out;

  const isBlank = (v) => v == null || String(v).trim() === "" || String(v).trim() === "—";

  // Pull candidate values from the signed note. Top-level fields are mirrored
  // by IPDInitialAssessmentPage.buildPayload (R7fj-HIGH-1) so we prefer those.
  const chiefComplaint =
    (note.chiefComplaint && String(note.chiefComplaint).trim()) ||
    (note.noteDetails?.nabh?.chiefComplaint && String(note.noteDetails.nabh.chiefComplaint).trim()) ||
    // R7hr-109 — last-resort HOPI fallback. DoctorNotes schema doesn't define
    // top-level chiefComplaint so strict-mode drops it silently; doctor.hopi
    // is the only narrative field reliably saved for the chief complaint
    // story. Surfacing it here is better than leaving admission.reasonForAdmission blank.
    (note.noteDetails?.doctor?.hopi && String(note.noteDetails.doctor.hopi).trim()) ||
    (note.historyOfPresentIllness && String(note.historyOfPresentIllness).trim()) ||
    "";
  const provDx =
    (note.provisionalDiagnosis && String(note.provisionalDiagnosis).trim()) ||
    (note.noteDetails?.doctor?.provDx && String(note.noteDetails.doctor.provDx).trim()) ||
    "";

  const $set = {};
  if (chiefComplaint && isBlank(admission.reasonForAdmission)) {
    $set.reasonForAdmission = chiefComplaint;
    out.fields.push("reasonForAdmission");
  }
  if (provDx && isBlank(admission.provisionalDiagnosis)) {
    $set.provisionalDiagnosis = provDx;
    out.fields.push("provisionalDiagnosis");
  }

  if (Object.keys($set).length === 0) return out;

  try {
    await Admission.updateOne({ _id: admission._id }, { $set });
    out.updated = true;
  } catch (err) {
    const { logErr } = require("../../utils/logErr");
    logErr("backfillAdmissionFromIA", `admission ${admission._id}`)(err);
  }
  return out;
}

module.exports = {
  fanOutMedReconToDoctorOrders,
  fanOutMedsToDoctorOrders,
  fanOutInfusionsToDoctorOrders,
  fanOutInvestsToDoctorOrders,
  backfillAdmissionFromIA,
};
