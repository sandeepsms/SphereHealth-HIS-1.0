// controllers/Clinical/marController.js
const MAR = require("../../models/Clinical/MARModel");
const Patient = require("../../models/Patient/patientModel");

// R7az-D6-CRIT-3: dedupe window for double-tap on Administer button.
// Two charts of the SAME (scheduledDate, scheduledTime, medicineId)
// within IDEMPOTENT_WINDOW_MS are treated as a duplicate submission
// and rejected 409 instead of being recorded twice.
const IDEMPOTENT_WINDOW_MS = 10 * 60 * 1000; // ±10 minutes
function _isSameSchedule(prevEntry, newScheduled, withinMs = IDEMPOTENT_WINDOW_MS) {
  if (!prevEntry || !newScheduled) return false;
  // Same string slot wins immediately.
  if (prevEntry.scheduledTime && prevEntry.scheduledTime === newScheduled) return true;
  // Otherwise compare actualTime within the window.
  const prevTs = prevEntry.actualTime ? new Date(prevEntry.actualTime).getTime() : null;
  if (!prevTs) return false;
  // Parse newScheduled as HH:MM today (best-effort).
  if (/^\d{1,2}:\d{2}/.test(String(newScheduled))) {
    const [h, m] = String(newScheduled).split(":").map(Number);
    const target = new Date(); target.setHours(h, m, 0, 0);
    return Math.abs(prevTs - target.getTime()) <= withinMs;
  }
  return false;
}

// Status enum normaliser — historical typos (`administered`, `Administered`)
// must map onto the MAR model enum [GIVEN, HELD, REFUSED, NOT_AVAILABLE, MISSED].
const STATUS_MAP = {
  administered: "GIVEN", given: "GIVEN", taken: "GIVEN",
  held: "HELD", hold: "HELD",
  refused: "REFUSED",
  not_available: "NOT_AVAILABLE", unavailable: "NOT_AVAILABLE", na: "NOT_AVAILABLE",
  missed: "MISSED", skipped: "MISSED",
};
const normalizeStatus = (s) => STATUS_MAP[String(s || "").toLowerCase()] || s;

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class MARController {
  // POST /api/mar — create or get existing MAR for a date
  //
  // FIX (audit P19): MARSchema.patient is `required: true`, but the legacy
  // controller never resolved it from UHID — every create blew up with
  // ValidationError. Now we look up the Patient by UHID and stamp the
  // ObjectId before create. Also normalize the day window so two callers
  // sending different ms-precision dates on the same day land on the
  // same document instead of creating duplicates.
  createOrGet = handle(async (req, res) => {
    const { UHID, ipdNo, date, admissionId, patientName, allergies } = req.body;
    const raw = date ? new Date(date) : new Date();
    const marDate = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate()); // local midnight
    const nextDay = new Date(marDate); nextDay.setDate(nextDay.getDate() + 1);

    let mar = await MAR.findOne({ ipdNo, date: { $gte: marDate, $lt: nextDay } });
    if (mar) return res.status(200).json({ success: true, data: mar });

    // Resolve the required patient ObjectId
    let patientId = req.body.patient || req.body.patientId;
    if (!patientId && UHID) {
      const p = await Patient.findOne({ UHID }).select("_id").lean();
      patientId = p?._id;
    }
    if (!patientId) {
      return res.status(400).json({ success: false, message: "patient (UHID) required to open a MAR" });
    }

    // R8-FIX(#25): reject embedded GIVEN administrations — charting a dose must
    // go through recordAdministration (five-rights + HAM dual-witness enforced
    // there). Scheduled/pending placeholder slots are fine; a GIVEN embed is not.
    if ((req.body.medications || []).some((m) => (m?.administrations || []).some((a) => normalizeStatus(a?.status) === "GIVEN")))
      return res.status(422).json({ success: false, code: "EMBEDDED_GIVEN_FORBIDDEN", message: "Cannot embed a GIVEN administration on MAR create — chart doses via the administer endpoint (five-rights + HAM dual-witness enforced there)." });

    mar = await MAR.create({
      patient: patientId,
      UHID,
      ipdNo,
      admissionId,
      patientName,
      date: marDate,
      allergies: allergies || [],
      medications: (req.body.medications || []).map((m) => ({
        ...m,
        administrations: (m.administrations || []).map((a) => ({
          ...a,
          status: normalizeStatus(a.status),
        })),
      })),
    });
    return res.status(201).json({ success: true, data: mar });
  });

  // GET /api/mar/ipd/:ipdNo
  getByIPD = handle(async (req, res) => {
    const mars = await MAR.find({ ipdNo: req.params.ipdNo })
      .sort({ date: -1 })
      .lean();
    return res.json({ success: true, data: mars, count: mars.length });
  });

  // GET /api/mar/ipd/:ipdNo/date/:date — get MAR for a specific date
  getByIPDAndDate = handle(async (req, res) => {
    // R8-FIX(#43): match the local-(IST-)day WINDOW, not a UTC-midnight exact
    // instant. MAR.date is stored at server-local midnight (createOrGet), but
    // `new Date('YYYY-MM-DD')` parses as UTC midnight, so exact equality was off
    // by the IST offset and returned nothing → spurious 404.
    const raw = new Date(req.params.date);
    const marDate = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    const nextDay = new Date(marDate); nextDay.setDate(nextDay.getDate() + 1);
    const mar = await MAR.findOne({ ipdNo: req.params.ipdNo, date: { $gte: marDate, $lt: nextDay } }).lean();
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found for this date" });
    return res.json({ success: true, data: mar });
  });

  // GET /api/mar/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const mars = await MAR.find({ UHID: req.params.uhid })
      .sort({ date: -1 })
      .lean();
    return res.json({ success: true, data: mars, count: mars.length });
  });

  // GET /api/mar/:id
  getById = handle(async (req, res) => {
    const mar = await MAR.findById(req.params.id).lean();
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });

  // POST /api/mar/:id/medication — add medication to MAR
  addMedication = handle(async (req, res) => {
    // R8-FIX(#25): a medication pushed to the MAR must not carry a pre-charted
    // GIVEN administration — that bypasses the five-rights + HAM dual-witness
    // gates on recordAdministration.
    if (((req.body && req.body.administrations) || []).some((a) => normalizeStatus(a?.status) === "GIVEN"))
      return res.status(422).json({ success: false, code: "EMBEDDED_GIVEN_FORBIDDEN", message: "Cannot embed a GIVEN administration when adding a MAR medication — chart doses via the administer endpoint." });
    // R9-FIX(R9-061): isHighAlert (HAM) drives the dual-witness gate at
    // administration — derive it from the drug master, never trust the client
    // body (a nurse could add insulin/heparin with isHighAlert:false and skip
    // the two-nurse witness). A known HAM drug is force-flagged; a freetext med
    // not in the master keeps the caller's value.
    const med = { ...(req.body || {}) };
    try {
      const name = String(med.medicineName || med.drugName || "").trim();
      if (name) {
        const Drug = require("../../models/Pharmacy/DrugModel");
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const d = await Drug.findOne({ name: new RegExp(`^${esc}$`, "i") }).select("isHighAlert").lean();
        if (d && d.isHighAlert === true) med.isHighAlert = true;
      }
    } catch (_) { /* best-effort — freetext med keeps the caller's value */ }
    const mar = await MAR.findByIdAndUpdate(
      req.params.id,
      { $push: { medications: med } },
      { new: true, runValidators: true }
    );
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });
    return res.json({ success: true, data: mar });
  });

  // PATCH /api/mar/:id/medication/:medId/administer — record administration
  //
  // R7az-D6-CRIT-3: idempotency guard — reject duplicate scheduled slot
  // within ±10 min as 409 IDEMPOTENT_DUPLICATE. Prevents double-tap on
  // the nurse Administer button generating two billing rows.
  //
  // R7az-D7-HIGH-3 / D7-HIGH-4: nurseName + req.user.id mandatory,
  // reason mandatory for non-GIVEN statuses (HELD/REFUSED/MISSED).
  // actualTime is always server-stamped — never trust client clocks.
  // Signature carried from req.user.signature if present.
  //
  // R7bb-FIX-E-19 / D3-HIGH-4: HAM (High-Alert Medication) dual-witness.
  // When the medication's isHighAlert flag is true, the request MUST
  // carry a SECOND nurse identifier (witnessUserId + witnessNurseName)
  // who also holds mar.write and is a DIFFERENT user than the primary
  // administering nurse. Pre-R7bb a single nurse could chart insulin /
  // opioids / heparin unilaterally — an ISMP independent-double-check
  // violation.
  recordAdministration = handle(async (req, res) => {
    const { scheduledTime, status, nurseName, nurseStaffId, batchNumber, reason, remarks,
            witnessUserId, witnessNurseName, witnessNurseStaffId, fiveRightsChecked } = req.body;
    const finalStatus = normalizeStatus(status);

    // NABH MOM.4 / IPSG.3 — five-rights must be confirmed before a dose is
    // charted GIVEN. Parity with the DoctorOrder /administer path (which
    // returns 422 without fiveRightsChecked); previously this MAR path had no
    // such gate, so a GIVEN dose could be charted without the check.
    if (finalStatus === "GIVEN" && fiveRightsChecked !== true) {
      return res.status(422).json({
        success: false,
        code: "FIVE_RIGHTS_REQUIRED",
        message: "5 Rights must be confirmed before marking a dose GIVEN (fiveRightsChecked: true)",
      });
    }

    // Actor + signature must be resolvable
    const resolvedNurseName  = nurseName    || req.user?.fullName   || "";
    const resolvedStaffId    = nurseStaffId || req.user?.employeeId || "";
    const resolvedUserId     = req.user?.id || req.user?._id || null;
    const resolvedSignature  = req.user?.signature || req.body?.signatureUrl || "";

    if (!resolvedNurseName || !resolvedUserId) {
      return res.status(400).json({ success: false, message: "nurseName and authenticated user are required for MAR administration" });
    }
    const NEEDS_REASON = new Set(["HELD", "REFUSED", "MISSED"]);
    if (NEEDS_REASON.has(finalStatus) && !(reason && String(reason).trim())) {
      return res.status(400).json({ success: false, message: `reason is required when status is ${finalStatus}` });
    }

    // Idempotency check — load the MAR first, scan existing entries.
    const mar = await MAR.findOne({ _id: req.params.id, "medications._id": req.params.medId });
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    const med = mar.medications.id(req.params.medId);
    if (!med) return res.status(404).json({ success: false, message: "Medication not found in MAR" });

    // R8-FIX(#27): drug-allergy safety gate via the CANONICAL allergyCheck util
    // (its header names recordAdministration as intended call-site #4, but it was
    // never wired here). Ward-stock drugs are charted straight on the MAR with no
    // pharmacy dispense, so this is the ONLY allergy checkpoint. Reads
    // authoritative Patient.allergies (falls back to the MAR snapshot). An
    // allergyOverrideReason lets a prescriber-authorised dose proceed; the reason
    // is recorded on the administration entry (below) for the NABH trail.
    let allergyOverrideNote = "";
    if (finalStatus === "GIVEN") {
      const { assertDrugSafeOrOverride } = require("../../utils/allergyCheck");
      let patientAllergies = mar.allergies;
      try {
        const pt = await Patient.findById(mar.patient).select("knownAllergies allergyList").lean();
        if (pt && ((pt.allergyList && pt.allergyList.length) || pt.knownAllergies))
          patientAllergies = (pt.allergyList && pt.allergyList.length) ? pt.allergyList : pt.knownAllergies;
      } catch (_) { /* fall back to the MAR allergy snapshot */ }
      try {
        const r = assertDrugSafeOrOverride(med, patientAllergies, {
          overrideReason: req.body.allergyOverrideReason, label: "mar-admin",
        });
        if (r && r.overridden)
          allergyOverrideNote = `Allergy override (${r.allergen}): ${String(req.body.allergyOverrideReason).trim()}`;
      } catch (e) {
        if (e.code === "ALLERGY_COLLISION")
          return res.status(409).json({ success: false, code: "ALLERGY_COLLISION", allergen: e.allergen, drug: e.drugName, message: e.message });
        throw e;
      }
    }

    if (scheduledTime) {
      const dup = (med.administrations || []).find((a) => _isSameSchedule(a, scheduledTime));
      if (dup) {
        return res.status(409).json({
          success: false,
          code: "IDEMPOTENT_DUPLICATE",
          message: `Duplicate administration for ${scheduledTime} within ±10 minutes — refusing to chart twice`,
        });
      }
    }

    // R7bb-FIX-E-19 / D3-HIGH-4: HAM dual-witness gate. Only enforced
    // for the GIVEN path — HELD / REFUSED / MISSED don't trigger a
    // physical administration and don't need the second eye.
    let hamWitness = null;
    if (med.isHighAlert && finalStatus === "GIVEN") {
      if (!witnessUserId) {
        return res.status(400).json({
          success: false,
          code: "HAM_WITNESS_REQUIRED",
          message: "High-Alert Medication — second nurse witnessUserId required for independent double-check (ISMP).",
        });
      }
      if (String(witnessUserId) === String(resolvedUserId)) {
        return res.status(400).json({
          success: false,
          code: "HAM_WITNESS_SAME_ACTOR",
          message: "HAM witness must be a different user than the primary administering nurse.",
        });
      }
      // Confirm the witness holds mar.write.
      try {
        const User = require("../../models/User/userModel");
        const wUser = await User.findById(witnessUserId).select("role fullName employeeId").lean();
        if (!wUser) {
          return res.status(400).json({ success: false, code: "HAM_WITNESS_NOT_FOUND", message: "Witness user not found" });
        }
        // ISMP independent-double-check: second witness must be a Nurse, never the same nurse, never Admin.
        if (wUser.role !== "Nurse") {
          return res.status(400).json({
            success: false,
            code: "HAM_WITNESS_NOT_NURSE",
            message: "High-Alert Medication dual-witness must be a Nurse (ISMP). Admin/Doctor cannot witness.",
          });
        }
        if (String(wUser._id) === String(req.user.id)) {
          return res.status(400).json({
            success: false,
            code: "HAM_WITNESS_SAME_NURSE",
            message: "Witness nurse must be different from the administering nurse.",
          });
        }
        hamWitness = {
          userId:    wUser._id,
          name:      witnessNurseName || wUser.fullName || "",
          staffId:   witnessNurseStaffId || wUser.employeeId || "",
        };
      } catch (e) {
        return res.status(500).json({ success: false, message: "HAM witness validation failed: " + e.message });
      }
    }

    const entry = {
      scheduledTime,
      actualTime: new Date(),       // server-side only
      status: finalStatus,
      nurseName:    resolvedNurseName,
      nurseStaffId: resolvedStaffId,
      administeredBy: resolvedUserId,
      signatureUrl: resolvedSignature || undefined,
      batchNumber,
      reason,
      // R8-FIX(#27): keep the allergy-override reason on the record for the trail.
      remarks: allergyOverrideNote ? [remarks, allergyOverrideNote].filter(Boolean).join(" | ") : remarks,
      fiveRightsChecked: fiveRightsChecked === true,
      // R7bb-FIX-E-19: stamp both witnesses on HAM doses for audit.
      ...(hamWitness ? {
        administeredByUser1Id: resolvedUserId,
        administeredByUser2Id: hamWitness.userId,
        nurse2Name:            hamWitness.name,
        nurse2StaffId:         hamWitness.staffId,
        isHamDose:             true,
      } : {}),
    };

    // R7bn-2 / D10-fix: atomic $push to avoid lost-administration race.
    // Pre-fix: two nurses charting the same dose at the same instant both
    // loaded the MAR (no entry yet), both .push()'d locally, then both
    // .save()'d — Mongo's last-write-wins on the medications.administrations
    // array would drop the loser's entry entirely. The dose appeared given
    // once instead of twice (or charted once with the wrong nurse).
    //
    // Switching to findOneAndUpdate with positional $push makes the array
    // append atomic at the DB layer. The idempotency check above still
    // protects against same-nurse double-tap (±10 min window) via the
    // pre-loaded scan; for cross-client races where both pass the check,
    // both entries land and the dedup index on the daily billing trigger
    // (F10) protects against double-bill.
    const pushResult = await MAR.findOneAndUpdate(
      { _id: req.params.id, "medications._id": req.params.medId },
      { $push: { "medications.$.administrations": entry } },
      { new: true, runValidators: true },
    );
    if (!pushResult) {
      return res.status(404).json({ success: false, message: "MAR or medication disappeared during write" });
    }
    // Refresh references so the post-write hooks (billing + audit) see
    // the freshly-appended entry.
    const refreshedMed = pushResult.medications.id(req.params.medId);
    const refreshedEntry = refreshedMed?.administrations?.[refreshedMed.administrations.length - 1] || entry;

    // ── Auto-billing hook ──────────────────────────────────────
    // Bill on every GIVEN dose; HELD/REFUSED/MISSED/NOT_AVAILABLE/OMITTED
    // VOID the pharmacy reservation that onIndentReleased created — otherwise
    // the patient stays billed for a drug that was never administered.
    //
    // R7hr-12 / D3-02 / D5-01: wire the missing onMARNonAdminister call.
    // onMARNonAdminister exists at autoBillingService.js (R7az-CRIT-6) but
    // until R7hr-12 had ZERO callers — every HELD/REFUSED/MISSED dose left
    // the MAR_RESERVATION BillingTrigger live on the IPD ledger (revenue
    // overstatement + NABH MOM.4 audit gap). The void function is idempotent
    // (ALREADY_CLOSED is swallowed inside it), so a cross-client double-flip
    // is safe. Stock return stays a separate concern (pharmacyService.returnSale)
    // because controlled drugs leaving the trolley need a countersigned return.
    const NON_ADMIN = new Set(["HELD", "REFUSED", "MISSED", "NOT_AVAILABLE", "OMITTED"]);
    try {
      const { logErr } = require("../../utils/logErr");
      const autoBilling = require("../../services/Billing/autoBillingService");
      if (finalStatus === "GIVEN") {
        autoBilling.onMARAdministration(pushResult, refreshedMed, refreshedEntry).catch(logErr("autoBilling", `onMARAdministration ${pushResult?._id} med ${refreshedMed?._id}`));
      } else if (NON_ADMIN.has(finalStatus)) {
        // R7hr-12: void the pharmacy reservation for non-administered doses.
        autoBilling.onMARNonAdminister(pushResult, refreshedMed, finalStatus).catch(logErr("autoBilling", `onMARNonAdminister ${pushResult?._id} med ${refreshedMed?._id} status ${finalStatus}`));
      }
    } catch (e) {
      const { logErr } = require("../../utils/logErr");
      logErr("autoBilling", "load failure on MAR.administer")(e);
    }

    // R7bn-1 / D9-fix: ClinicalAudit emit on every MAR administration.
    // HAM drugs (insulin, opioids, heparin) need this trail for NABH IPSG.3.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event:
          finalStatus === "GIVEN"   ? "MAR_DOSE_ADMINISTERED" :
          finalStatus === "HELD"    ? "MAR_DOSE_HELD" :
          finalStatus === "REFUSED" ? "MAR_DOSE_REFUSED" :
          finalStatus === "MISSED"  ? "MAR_DOSE_MISSED" :
                                     "MAR_DOSE_ADMINISTERED",
        UHID: pushResult.UHID,
        admissionId: pushResult.admissionId,
        targetType: "MAR.administration",
        targetId: pushResult._id,
        after: {
          drug: refreshedMed?.medicineName, // R9-FIX(R9-062): schema field is medicineName, not drugName
          dose: refreshedMed?.dose,
          status: finalStatus,
          scheduledTime,
          actualTime: refreshedEntry.actualTime,
          nurseName: resolvedNurseName,
          isHamDose: !!refreshedEntry.isHamDose,
        },
        reason,
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    return res.json({ success: true, data: pushResult, message: "Administration recorded" });
  });

  // PATCH /api/mar/:id/medication/:medId/discontinue
  // R7az-D6-HIGH-7: load + .save() so the append-only pre-save hook
  // and any future validators fire on discontinuation.
  discontinueMedication = handle(async (req, res) => {
    const { discontinuedBy, discontinueReason } = req.body;
    const mar = await MAR.findOne({ _id: req.params.id, "medications._id": req.params.medId });
    if (!mar) return res.status(404).json({ success: false, message: "MAR or medication not found" });
    const med = mar.medications.id(req.params.medId);
    if (!med) return res.status(404).json({ success: false, message: "Medication not found in MAR" });
    med.isActive = false;
    med.discontinuedAt = new Date();
    med.discontinuedBy = discontinuedBy || req.user?.fullName || "";
    med.discontinueReason = discontinueReason || "";
    await mar.save();
    return res.json({ success: true, data: mar });
  });

  // PUT /api/mar/:id — update full MAR
  // R7az-D2-CRIT-5 / D6-MED-6: CAS-style update. Refuse any attempt to
  // mutate the `administrations[]` array via PUT body (append-only is
  // enforced for that path via /administer). Whitelist mutable top-level
  // fields and call .save() so the schema-level append-only hook still
  // fires against any sneak attempt to rewrite existing rows.
  update = handle(async (req, res) => {
    const mar = await MAR.findById(req.params.id);
    if (!mar) return res.status(404).json({ success: false, message: "MAR not found" });

    // Whitelist of mutable top-level fields. medications[] is intentionally
    // OUT — that path is mutated via add/administer/discontinue endpoints
    // which carry their own validators and audit semantics.
    const MUTABLE = new Set([
      "allergies", "allergyAlertAcknowledged", "status", "patientName",
    ]);
    const body = req.body || {};
    if (Array.isArray(body.medications)) {
      // Reject upfront — a PUT must not silently overwrite the medication
      // tree (which would erase administration history per D2-CRIT-5).
      return res.status(400).json({
        success: false,
        code: "MAR_MEDICATIONS_IMMUTABLE_VIA_PUT",
        message: "MAR.medications[] is append-only — use /medication, /administer or /discontinue endpoints instead",
      });
    }
    for (const [k, v] of Object.entries(body)) {
      if (MUTABLE.has(k)) mar.set(k, v);
    }
    mar.updatedBy = req.user?.id || req.user?._id || mar.updatedBy;
    await mar.save();
    return res.json({ success: true, data: mar });
  });
}

module.exports = new MARController();
