// controllers/Clinical/dischargeSummaryController.js
const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
const Admission = require("../../models/Patient/admissionModel");
const admissionService = require("../../services/Patient/admissionService");
const User = require("../../models/User/userModel");

// R7hr-197 — the DischargeSummaryPage posts the discharge meds /
// investigations / procedures with FE-shaped keys (drug/instructions,
// name/unit/status, name/surgeon/findings) under medications/
// investigations/procedures. The model fields are medicationsOnDischarge /
// investigationsSummary / proceduresDone with different sub-keys, so
// Mongoose strict mode SILENTLY DROPPED everything the doctor typed.
// Normalise the FE shape onto the schema fields so discharge meds persist
// (and print). Idempotent: if the canonical key is already present, skip.
function _normaliseDischargeArrays(data) {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.medications) && data.medicationsOnDischarge === undefined) {
    data.medicationsOnDischarge = data.medications.map((m) => ({
      medicineName: m.medicineName || m.drug || m.name || "",
      dose: m.dose || "", route: m.route || "", frequency: m.frequency || "",
      duration: m.duration || "", remarks: m.remarks || m.instructions || "",
    })).filter((m) => m.medicineName);
  }
  if (Array.isArray(data.investigations) && data.investigationsSummary === undefined) {
    data.investigationsSummary = data.investigations.map((i) => ({
      testName: i.testName || i.name || "",
      result: i.result || "",
      remarks: i.remarks || [i.unit, i.status].filter(Boolean).join(" ").trim(),
    })).filter((i) => i.testName);
  }
  if (Array.isArray(data.procedures) && data.proceduresDone === undefined) {
    data.proceduresDone = data.procedures.map((p) => ({
      procedureName: p.procedureName || p.name || "",
      pcsCode: p.pcsCode || "",                        // R7hr(PCS-P1)
      date: p.date || undefined, performedBy: p.performedBy || p.surgeon || "",
      notes: p.notes || [p.findings, p.complications && `Complications: ${p.complications}`].filter(Boolean).join(". "),
    })).filter((p) => p.procedureName);
  }
  // Strip the FE-only keys so they don't linger as ignored fields.
  delete data.medications; delete data.investigations; delete data.procedures;
}

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    // R7az-D8: honour explicit err.status / err.statusCode from the
    // service layer (admissionService.dischargePatient now sets 409
    // for stage-gates, 403 for actor-role mismatches). Without this,
    // every domain error fell through to the 400/404 heuristic and the
    // caller lost the distinction between "wrong precondition" and
    // "validation failure".
    const explicit = Number(err.status || err.statusCode);
    const status = Number.isInteger(explicit) && explicit >= 400 && explicit < 600
      ? explicit
      : (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class DischargeSummaryController {
  // POST /api/discharge-summary
  //
  // FIX (audit P17-B4): legacy code allowed unlimited duplicate creates
  // per admission — "Save & Print" twice = 2 rows; only the first was
  // returned by getByAdmission's findOne, so the later edits were silent
  // data loss. Now upserts by admissionId.
  //
  // FIX (audit P17-B6): switched Math.ceil → Math.floor so a 2-hour LAMA
  // counts as 0 days, not 1 — billing-day inflation eliminated.
  create = handle(async (req, res) => {
    const data = req.body;
    _normaliseDischargeArrays(data);

    // R7hr-226 (security audit) — mass-assignment guard. create() and its
    // draft upsert must NEVER set the finalized state or its finalizer
    // identity. Finalization happens ONLY through the gated PATCH /:id/finalize
    // route, which enforces the MCI-reg / PROM-PREM / nursing-handover / MCCD /
    // primary-attending-consultant checks. Pre-fix, spreading req.body let a
    // non-attending Doctor POST status:"finalized" with a forged
    // finalizedByName, minting an immutable (delete()/update() both refuse a
    // finalized doc) forged legal record. Strip those fields here so a created
    // record is always a draft.
    delete data.status; // model default "draft"; /finalize is the only path to finalized
    delete data.finalizedBy;
    delete data.finalizedByName;
    delete data.finalizedByReg;
    delete data.finalizedAt;

    if (data.admissionDate && data.dischargeDate) {
      const diff = new Date(data.dischargeDate) - new Date(data.admissionDate);
      // floor(): partial days don't add a billing day. The first day is
      // already covered by the admission base charge.
      data.totalDaysAdmitted = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    }

    let summary;
    if (data.admissionId) {
      // R7az-D2-CRIT-2: Block the create upsert from clobbering a
      // finalized record. Pre-R7az `findOneAndUpdate({admissionId}, …,
      // {upsert:true})` would overwrite a discharge-summary already
      // marked status:"finalized" if a careless POST hit the endpoint
      // again — silently mutating signed-off legal content. The
      // schema-level guard (Agent B's pre-save hook on the model)
      // catches the persisted write; this controller-level early-out
      // gives the caller a clean 409 instead of a generic validator
      // error AND avoids the wasted DB round trip.
      const existing = await DischargeSummary.findOne({
        admissionId: data.admissionId,
      }).select("status finalizedByName finalizedAt").lean();
      if (existing && existing.status === "finalized") {
        return res.status(409).json({
          success: false,
          message: `Discharge summary already finalized by ${existing.finalizedByName || "another user"} at ${existing.finalizedAt}. Create a new addendum instead.`,
          code: "FINALIZED_IMMUTABLE",
        });
      }
      if (existing) {
        // Update-only — never upsert when the record already exists.
        summary = await DischargeSummary.findOneAndUpdate(
          { admissionId: data.admissionId, status: { $ne: "finalized" } },
          { $set: data },
          { new: true, runValidators: true },
        );
        if (!summary) {
          // Race: someone finalized between our pre-check and update.
          return res.status(409).json({
            success: false,
            message: "Discharge summary was finalized by another user — refresh and try again.",
            code: "FINALIZED_IMMUTABLE",
          });
        }
      } else {
        // True insert — first record for this admission.
        summary = await DischargeSummary.create(data);
      }
    } else {
      summary = await DischargeSummary.create(data);
    }
    return res.status(201).json({ success: true, data: summary });
  });

  // GET /api/discharge-summary/uhid/:uhid
  getByUHID = handle(async (req, res) => {
    const summaries = await DischargeSummary.find({ UHID: req.params.uhid })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: summaries, count: summaries.length });
  });

  // GET /api/discharge-summary/admission/:admissionId
  getByAdmission = handle(async (req, res) => {
    const summary = await DischargeSummary.findOne({
      admissionId: req.params.admissionId,
    }).lean();
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // GET /api/discharge-summary/:id
  getById = handle(async (req, res) => {
    const summary = await DischargeSummary.findById(req.params.id).lean();
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // PUT /api/discharge-summary/:id
  update = handle(async (req, res) => {
    const data = req.body;
    _normaliseDischargeArrays(data);
    if (data.admissionDate && data.dischargeDate) {
      const diff = new Date(data.dischargeDate) - new Date(data.admissionDate);
      // floor() to match create() — partial days don't add an LOS day (was ceil, inflated by 1).
      data.totalDaysAdmitted = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    }
    // R7az-D8/D2-CRIT-2: friendly early-out when the summary is already
    // finalized. The model-level pre-save guard (Agent B) is the source
    // of truth, but a controller-side check returns a clean 409 with a
    // human message instead of letting the schema validator surface a
    // less-actionable error.
    const existing = await DischargeSummary.findById(req.params.id)
      .select("status finalizedByName finalizedAt").lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Discharge summary not found" });
    }
    if (existing.status === "finalized") {
      return res.status(409).json({
        success: false,
        message: `Discharge summary is finalized by ${existing.finalizedByName || "doctor"} at ${existing.finalizedAt} — edits are immutable. Create a new addendum instead.`,
        code: "FINALIZED_IMMUTABLE",
      });
    }
    const summary = await DischargeSummary.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: "finalized" } },
      data,
      { new: true, runValidators: true }
    );
    if (!summary) {
      // Race: finalized between our pre-check and update.
      return res.status(409).json({
        success: false,
        message: "Discharge summary was finalized by another user — refresh and try again.",
        code: "FINALIZED_IMMUTABLE",
      });
    }
    return res.json({ success: true, data: summary });
  });

  // PATCH /api/discharge-summary/:id/finalize
  finalize = handle(async (req, res) => {
    const { finalizedByName, allowOverride, overrideReason } = req.body;

    // R7bx item 8 — MCI Regulation 1.4.2 compliance. The discharge summary
    // is a Rx-signing path (carries Rx, advice, follow-up) — finalizing it
    // requires the actor's MCI registration number on file. Pre-fix the
    // system signed regardless and the printed summary showed "—" where
    // the reg-no belongs.
    if (req.user?.role === "Doctor") {
      try {
        const userId = req.user?._id || req.user?.id;
        if (userId) {
          const u = await User.findById(userId).select("doctorDetails.registrationNumber").lean();
          const regNo = String(u?.doctorDetails?.registrationNumber || "").trim();
          if (!regNo) {
            return res.status(400).json({
              success: false,
              code: "MCI_REG_NO_MISSING",
              message: "Doctor's MCI registration number is missing. Add it in Settings → Doctor Profile before signing.",
            });
          }
        }
      } catch (_) { /* lookup blip — let downstream proceed */ }
    }

    // ── Workflow gate (NABH-CRIT-03 / N-CRIT-02) ──────────────────
    // Discharge cannot be finalized until the nurse handover step is
    // documented. Without this gate the workflow was order-agnostic —
    // a doctor could click "Finalize & Discharge" directly from the
    // discharge summary page, releasing the bed before the nurse had
    // recorded the handover note. NABH COP.20 explicitly requires the
    // nursing handover before discharge.
    //
    // The gate accepts EITHER signal that the nursing step is done:
    //   1. `admission.initialAssessment.nurseCompleted === true` —
    //      explicitly set by NursingNotes (covers full IPD stays)
    //   2. At least one NurseNote document exists for this admission's
    //      ipdNo — covers short / Daycare stays where the assessment
    //      flag was never flipped but actual notes do exist
    //
    // Explicit override is allowed for LAMA / Absconded / Death
    // cases — caller MUST send allowOverride: true AND a non-empty
    // reason, both of which land on the discharge summary's audit
    // trail (nursingHandoverOverride*).
    const draftSummary = await DischargeSummary.findById(req.params.id).lean();

    // R7hr-197 — MCCD gate. A death discharge (dischargeType "Death" or
    // condition "Expired") MUST carry a cause of death before it can be
    // finalized + pushed to the NABH Mortality register. Pre-fix the
    // emitter defaulted the cause to "Not Specified", so a death could be
    // registered with no real cause (MCCD bypass). Not override-able —
    // a death certificate without a cause is not a valid record.
    if (draftSummary && (draftSummary.dischargeType === "Death" || draftSummary.conditionOnDischarge === "Expired")) {
      const cause = String(draftSummary.causeOfDeath || draftSummary.immediateCauseOfDeath || "").trim();
      if (!cause) {
        return res.status(400).json({
          success: false,
          code: "CAUSE_OF_DEATH_REQUIRED",
          message: "Cause of death is required to finalize a death discharge (NABH COP.18 / MCCD). Enter the immediate cause of death on the summary first.",
        });
      }
    }

    // R7hr-113 — PROM + PREM mandatory at discharge (NABH PSQ + COP.6.b)
    // Patient voice MUST be recorded before discharge locks. Refuse
    // finalize unless ONE signed PROM AND ONE signed PREM exist for this
    // admission. Bypass via allowOverride: true + overrideReason for
    // LAMA / Death / Patient-refused cases — same escape valve as the
    // nursing handover gate below.
    if (draftSummary?.admissionId && !allowOverride) {
      try {
        const PROMPREMSurvey = require("../../models/Clinical/PROMPREMSurveyModel");
        const readiness = await PROMPREMSurvey.checkDischargeReadiness(draftSummary.admissionId);
        if (!readiness.prom || !readiness.prem) {
          return res.status(409).json({
            success: false,
            message: `Cannot finalize discharge — patient-reported survey missing. Required: ${[!readiness.prom && "PROM (outcome)", !readiness.prem && "PREM (experience)"].filter(Boolean).join(" + ")}. Capture via /clinical/prom-prem-survey or pass { allowOverride: true, overrideReason: "..." } for LAMA / refused / death cases.`,
            code: "PROM_PREM_REQUIRED",
            missing: { prom: !readiness.prom, prem: !readiness.prem },
          });
        }
      } catch (err) {
        // Model load failure should NOT block discharge (e.g. fresh
        // install where the model file isn't deployed yet). Log + proceed.
        const { logErr } = require("../../utils/logErr");
        logErr("dischargeFinalize.promPremGate", req.params?.id)(err);
      }
    }

    if (draftSummary?.admissionId) {
      const adm = await Admission.findById(draftSummary.admissionId).lean();
      const nurseFlagged = !!adm?.initialAssessment?.nurseCompleted;
      let hasNurseNotes = false;
      if (!nurseFlagged && draftSummary?.ipdNo) {
        try {
          const NurseNotes = require("../../models/Nurse/NurseNotesModel");
          hasNurseNotes = (await NurseNotes.countDocuments({ ipdNo: draftSummary.ipdNo })) > 0;
        } catch (_) { /* model may be optional */ }
      }
      const nursingDone = nurseFlagged || hasNurseNotes;
      if (!nursingDone && !allowOverride) {
        return res.status(409).json({
          success: false,
          message: "Cannot finalize discharge — nursing handover note required (NABH COP.20). Add the note via /nursing-notes, OR pass { allowOverride: true, overrideReason: '...' } for LAMA / Absconded / Death cases.",
          code: "NURSING_HANDOVER_REQUIRED",
        });
      }
      if (!nursingDone && allowOverride && !String(overrideReason || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "Override requires a documented reason (e.g. 'LAMA at 14:30, signed AMA form on file').",
          code: "OVERRIDE_REASON_REQUIRED",
        });
      }
    }

    // ── Mandatory-content gate (NABH AAC.3 / #130) ────────────────
    // A discharge summary must carry the AAC-mandated content before it
    // locks: a final diagnosis, discharge medications, and follow-up
    // advice. Pre-fix a summary could finalize (and become immutable) with
    // blank diagnosis / no meds / no follow-up — the printable then showed
    // em-dashes for mandated fields. Death/Expired and LAMA/DAMA/Absconded
    // cases legitimately lack discharge meds + follow-up (patient left /
    // deceased) so those two requirements are waived for them; the final
    // diagnosis (or cause of death, gated above) is always required.
    // Overridable via { allowOverride, overrideReason } like the gates above.
    if (draftSummary) {
      const dType = draftSummary.dischargeType || "";
      const cond = draftSummary.conditionOnDischarge || "";
      const isDeathCase = dType === "Death" || cond === "Expired";
      const leftAgainstAdvice = ["LAMA", "DAMA", "Absconded"].includes(dType);
      const missing = [];
      if (!String(draftSummary.finalDiagnosis || "").trim() &&
          !(Array.isArray(draftSummary.codedDiagnoses) && draftSummary.codedDiagnoses.length)) {
        missing.push("final diagnosis");
      }
      if (!isDeathCase && !leftAgainstAdvice) {
        if (!(Array.isArray(draftSummary.medicationsOnDischarge) && draftSummary.medicationsOnDischarge.length)) {
          missing.push("discharge medications");
        }
        const hasFollowUp = !!(String(draftSummary.followUpInstructions || "").trim() ||
          draftSummary.followUpDate || String(draftSummary.followUpDoctor || "").trim());
        if (!hasFollowUp) missing.push("follow-up advice");
      }
      if (missing.length && !allowOverride) {
        return res.status(409).json({
          success: false,
          code: "DISCHARGE_CONTENT_INCOMPLETE",
          message: `Cannot finalize — the discharge summary is missing NABH-mandated content: ${missing.join(", ")}. Complete it, OR pass { allowOverride: true, overrideReason: "..." } with justification.`,
          missing,
        });
      }
      if (missing.length && allowOverride && !String(overrideReason || "").trim()) {
        return res.status(400).json({
          success: false,
          code: "OVERRIDE_REASON_REQUIRED",
          message: "Override requires a documented reason for the incomplete discharge content.",
        });
      }
      // Stash for the CAS-update override-evidence block below.
      req._contentGateOverridden = missing.length > 0 && allowOverride;
      req._contentGateMissing = missing;
    }

    // runValidators added per audit C-07 — without it, the status flip
    // and the date/condition writes bypass the schema's enum/format
    // checks; a future bad value (e.g. status: "FINAL_GREATEST") would
    // persist silently and break the discharge filter.
    // R7s: Atomic CAS — only flip status to "finalized" if it is NOT
    // already finalized. Two doctors clicking Finalize simultaneously
    // would previously both succeed: both flip status, both run the
    // bed-release block below, leaving the audit trail with two
    // finalizedAt timestamps and potentially racing the bed update.
    // Now the second caller fails the CAS and we return 409 cleanly.
    const summary = await DischargeSummary.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: "finalized" } },
      {
        status: "finalized",
        finalizedByName: finalizedByName || "Doctor",
        finalizedAt: new Date(),
        // Record override (when used) for the NABH audit trail. Stored
        // on the discharge summary itself so the override evidence
        // travels with the discharge record.
        ...(allowOverride ? {
          nursingHandoverOverride: true,
          nursingHandoverOverrideReason: String(overrideReason || "").trim(),
          nursingHandoverOverrideAt: new Date(),
          nursingHandoverOverrideBy: finalizedByName || req.user?.fullName || "Doctor",
        } : {}),
        // NABH AAC.3 (#130) — when the mandatory-content gate was bypassed,
        // stamp WHAT was missing + WHY so the auditor sees the justification.
        ...(req._contentGateOverridden ? {
          contentGateOverride: true,
          contentGateOverrideReason: String(overrideReason || "").trim(),
          contentGateMissing: req._contentGateMissing || [],
          contentGateOverrideAt: new Date(),
          contentGateOverrideBy: finalizedByName || req.user?.fullName || "Doctor",
        } : {}),
      },
      { new: true, runValidators: true }
    );
    if (!summary) {
      // Either summary missing OR already finalized — disambiguate with a
      // probe so the caller knows whether to retry or accept.
      const probe = await DischargeSummary.findById(req.params.id).select("status finalizedAt finalizedByName admissionId").lean();
      if (!probe) return res.status(404).json({ success: false, message: "Discharge summary not found" });
      return res.status(409).json({
        success: false,
        message: `Discharge summary already finalized by ${probe.finalizedByName || "another user"} at ${probe.finalizedAt}.`,
        code: "ALREADY_FINALIZED",
      });
    }

    // R7bn-1 / D9-fix: ClinicalAudit emit on discharge finalize (terminal
    // clinical event, 7y retention floor per IMS.2). LAMA / Death cases
    // surface via the nursingHandoverOverride* fields in the after-snapshot
    // so an auditor can see WHY the nursing-handover gate was bypassed.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "DISCHARGE_SUMMARY_FINALIZED",
        UHID: summary.UHID,
        admissionId: summary.admissionId,
        patientId: summary.patient,
        patientName: summary.patientName,
        targetType: "DischargeSummary",
        targetId: summary._id,
        after: {
          finalizedByName: summary.finalizedByName,
          finalizedAt: summary.finalizedAt,
          nursingHandoverOverride: !!summary.nursingHandoverOverride,
          nursingHandoverOverrideReason: summary.nursingHandoverOverrideReason || "",
        },
        reason: summary.nursingHandoverOverrideReason || "",
      });
    } catch (_) { /* silent */ }

    // #136/#137 — IDSP notifiable-disease auto-raise. Scan the finalized
    // summary's coded diagnoses (+ single icdCode) against the notifiable
    // ICD-10 list; raise a NotifiableDiseaseRegister case (idempotent per
    // admission+disease) so the IC officer can report it within the statutory
    // window. Non-blocking — never rolls back the discharge.
    try {
      const { raiseNotifiableCases } = require("../../services/Compliance/notifiableDiseases");
      const diags = Array.isArray(summary.codedDiagnoses) ? summary.codedDiagnoses.map((d) => ({ code: d.code, description: d.description })) : [];
      if (summary.icdCode) diags.push({ code: summary.icdCode, description: summary.finalDiagnosis || "" });
      const raised = await raiseNotifiableCases({
        diagnoses: diags,
        patient: { _id: summary.patient, UHID: summary.UHID, name: summary.patientName },
        admission: { _id: summary.admissionId },
        actor: req.user || {},
      });
      if (raised.length) console.log(`[dischargeFinalize] notifiable-disease raised: ${raised.map((r) => `${r.caseNumber}(${r.disease})`).join(", ")}`);
    } catch (_) { /* silent — surveillance raise is best-effort */ }

    // R7bx-3 — Auto-populate NABH COP.18 Mortality register on a finalized
    // death discharge. Trigger discriminator (matching the model enum):
    //   conditionOnDischarge === "Expired"  OR  dischargeType === "Death"
    // Non-blocking — never rolls back the discharge on register failure.
    // Idempotent by admissionId (unique index) so a re-finalize won't
    // double-write.
    if (summary.conditionOnDischarge === "Expired" || summary.dischargeType === "Death") {
      try {
        const { emitMortality } = require("../../services/Compliance/nabhRegisterEmitter");
        const Patient = require("../../models/Patient/patientModel");
        const patient = summary.patient
          ? await Patient.findById(summary.patient).select("_id UHID fullName name age gender sex").lean()
          : { _id: summary.patient, UHID: summary.UHID, fullName: summary.patientName, age: summary.age, sex: summary.gender };
        const admission = summary.admissionId
          ? await Admission.findById(summary.admissionId).select("_id admissionNumber admissionDate attendingDoctor attendingDoctorId isMLC mlcNumber").lean()
          : null;
        emitMortality({
          dischargeSummary: summary,
          patient: patient || {},
          admission,
          actor: req.user || {},
        }).catch((e) => console.error("[discharge-summary] emitMortality error:", e?.message));
      } catch (e) {
        console.error("[discharge-summary] Mortality emit wiring failed:", e?.message);
      }
    }

    // R7hr-197 — Auto-populate the NABH AAC.4 LAMA register on a finalized
    // LAMA/DAMA discharge. Pre-fix emitLAMA was dead-wired to the discharge
    // flow (only the manual register route called it), so a LAMA never
    // reached the register unless Compliance remembered to file it by hand.
    // Idempotent by sourceRef "discharge:<summaryId>"; non-blocking.
    if (summary.dischargeType === "LAMA" || summary.dischargeType === "DAMA" || summary.conditionOnDischarge === "LAMA") {
      try {
        const { emitLAMA } = require("../../services/Compliance/nabhRegisterEmitter");
        const Patient = require("../../models/Patient/patientModel");
        const lamaPatient = summary.patient
          ? await Patient.findById(summary.patient).select("_id UHID fullName name age gender sex").lean()
          : { _id: summary.patient, UHID: summary.UHID, fullName: summary.patientName, age: summary.age, sex: summary.gender };
        const lamaAdmission = summary.admissionId
          ? await Admission.findById(summary.admissionId).select("_id admissionNumber admissionDate attendingDoctor attendingDoctorId").lean()
          : null;
        emitLAMA({
          dischargeSummary: summary,
          patient: lamaPatient || {},
          admission: lamaAdmission,
          actor: req.user || {},
        }).catch((e) => console.error("[discharge-summary] emitLAMA error:", e?.message));
      } catch (e) {
        console.error("[discharge-summary] LAMA emit wiring failed:", e?.message);
      }
    }

    // R7az-D8-CRIT-1..5: Discharge fast-path now flows through the SAME
    // service the receptionist workflow uses. Pre-R7az this controller
    // did inline `findByIdAndUpdate` on the admission + bed — bypassing
    // LEGAL_STATUS_TRANSITIONS (could resurrect a Cancelled admission),
    // the `_dischargingFlush` daily-charge flush (lost discharge-day
    // bed + nursing fees), CleaningTask auto-create (HK queue empty),
    // dischargeOverage detection (refunds skipped), housekeeping flag
    // (live bed map stale), and BillingAudit emit. It also stamped
    // billClearedBy=doctorName even though the doctor never cleared
    // anything — corrupted the audit trail.
    //
    // New behaviour:
    //   1. Primary-consultant check — only the attending doctor (or
    //      Admin) may finalize. Compares against doctorProfile._id, not
    //      User._id (User._id NEVER matches a Doctor _id directly).
    //   2. If bill stage ∈ {BillCleared, GatePassIssued, Completed} →
    //      invoke admissionService.dischargePatient. It does the
    //      proper full flow with transaction safety.
    //   3. Otherwise → advance stage to "DoctorApproved" but DO NOT
    //      discharge / release the bed. Cashier still owns the final
    //      BedReleased / Completed flip via clearFinalBill + issueGatePass.
    //   4. billClearedBy / billClearedAt remain null/undefined; only
    //      the cashier's explicit clearFinalBill action stamps them.
    if (summary.admissionId) {
      const admission = await Admission.findById(summary.admissionId)
        .select("attendingDoctorId status dischargeWorkflow bedId admissionNumber mustCosign")
        .lean();
      if (!admission) {
        return res.status(404).json({ success: false, message: "Linked admission not found" });
      }

      // 1. Primary-consultant gate. Pre-R7az anybody with a Doctor role
      //    could finalize any admission's discharge summary — including
      //    a doctor who had nothing to do with the case.
      if (req.user?.role === "Doctor") {
        const callerDoctorId = String(req.doctorProfile?._id || "");
        const attendingId    = String(admission.attendingDoctorId || "");
        if (!callerDoctorId || !attendingId || callerDoctorId !== attendingId) {
          return res.status(403).json({
            success: false,
            message: "Only the primary attending consultant (or an Admin) may finalize this discharge.",
            code: "NOT_PRIMARY_CONSULTANT",
          });
        }
      }

      // R7bb-FIX-E-4 / D3-CRIT-4: SoD on Junior Resident self-finalize.
      // Junior Residents must NOT discharge their own patients without
      // senior co-sign (NABH COP.7 / institutional risk). Two paths:
      //   • admission.mustCosign === true  → REQUIRE explicit
      //     requireSeniorCosign:false ack in the body (the caller
      //     attests they will obtain co-sign offline / via the pending
      //     /cosign endpoint). Without the ack we 409.
      //   • caller's designation === "Junior Resident" → emit a WARN
      //     audit row noting "self-finalized by treating doctor" but
      //     don't block. The admin gets a flag on the audit feed.
      if (req.user?.role === "Doctor") {
        // Look up the caller's designation off the User doc — req.user
        // carries only `role`, not the doctorDetails subdoc.
        let designation = "";
        try {
          const u = await User.findById(req.user._id || req.user.id)
            .select("doctorDetails.designation").lean();
          designation = u?.doctorDetails?.designation || "";
        } catch (_) { /* best-effort */ }
        const isJR = designation === "Junior Resident";
        if (isJR && admission.mustCosign === true) {
          // Hard gate — must explicitly acknowledge that senior co-sign
          // will follow. The cosign itself happens via a separate
          // future endpoint that stamps cosignedBy on the summary.
          if (req.body?.requireSeniorCosign !== false) {
            return res.status(409).json({
              success: false,
              code: "REQUIRE_SENIOR_COSIGN",
              message:
                "This admission is flagged mustCosign — a Junior Resident cannot finalize without senior co-sign. " +
                "Resubmit with { requireSeniorCosign: false } to acknowledge that co-sign will be obtained, OR have a Senior Resident / Consultant finalize.",
            });
          }
          // Mark on the doc for the cosign endpoint to honour.
          await DischargeSummary.findByIdAndUpdate(summary._id, {
            $set: { selfFinalizeAck: true },
          });
        }
        if (isJR) {
          // WARN audit row — non-blocking.
          try {
            const { emit } = require("../../models/Billing/BillingAudit");
            await emit({
              event:     "SETTLEMENT_ADJUSTED",  // generic audit channel
              actorId:   req.user._id || req.user.id,
              actorName: req.user.fullName || req.user.employeeId,
              actorRole: req.user.role,
              admissionId: summary.admissionId,
              reason:    `WARN_SELF_FINALIZE: Discharge summary ${summary._id} self-finalized by Junior Resident (treating doctor). Senior co-sign required.`,
              after:     { discharge: "self-finalized", mustCosign: admission.mustCosign, designation },
            }, { req });
          } catch (_) { /* best-effort */ }
        }
      }

      const now = new Date();
      const finalizedBy = finalizedByName || req.user?.fullName || "Doctor";

      // R7hr-197 discharge rebuild — a finalized discharge summary is the
      // SINGLE trigger that enqueues the patient into the receptionist
      // discharge queue. The doctor NEVER frees the bed here; the
      // receptionist's clear-bill → clear-bed steps own the bill gate and
      // the actual bed release. We copy the doctor's disposition
      // (dischargeType) + condition onto the admission so the queue and the
      // bed-clear step can read it without a summary join.
      //
      // CAS — advance to DoctorApproved (= "Pending Bill") only while the
      // patient is Active and the cashier hasn't already moved the stage
      // further (BillCleared/Completed). If they have, we leave it (no
      // downgrade) and let the existing stage stand.
      await Admission.findOneAndUpdate(
        {
          _id: summary.admissionId,
          status: "Active",
          $or: [
            { "dischargeWorkflow.stage": { $in: ["NotRequested", "DoctorApproved"] } },
            { "dischargeWorkflow.stage": { $exists: false } },
            { dischargeWorkflow: { $exists: false } },
          ],
        },
        {
          $set: {
            "dischargeWorkflow.stage":              "DoctorApproved",
            "dischargeWorkflow.doctorApprovedAt":   now,
            "dischargeWorkflow.doctorApprovedBy":   finalizedBy,
            "dischargeWorkflow.dischargeType":      summary.dischargeType || "Routine",
            "dischargeWorkflow.summaryId":          summary._id,
            "dischargeWorkflow.summaryFinalizedAt": now,
            dischargeSummary:                       summary._id.toString(),
            ...(summary.conditionOnDischarge && { conditionOnDischarge: summary.conditionOnDischarge }),
            ...(summary.followUpInstructions  && { followUpInstructions:  summary.followUpInstructions  }),
          },
        },
        { runValidators: true },
      );
    }

    return res.json({
      success: true,
      data: summary,
      message: "Discharge summary finalized",
    });
  });

  // POST /api/discharge-summary/:id/cosign
  //
  // R7bb-FIX-E-4 / D3-CRIT-4 reconciliation — senior co-sign of a
  // Junior-Resident self-finalized discharge summary (NABH COP.7). The
  // finalize path lets a JR self-finalize (WARN audit row + mustCosign
  // acknowledgement) but the senior signature that CLOSES that SoD loop
  // had no endpoint, so cosignedBy/cosignedByName/cosignedAt never got
  // stamped. This stamps them from the AUTHENTICATED senior actor — NEVER
  // from req.body (mirroring mlcController.finalize's co-sign) — and emits
  // a ClinicalAudit row consistent with the finalize emit.
  cosign = handle(async (req, res) => {
    const existing = await DischargeSummary.findById(req.params.id)
      .select("status finalizedByName cosignedAt cosignedByName UHID admissionId patient patientName")
      .lean();
    if (!existing) {
      return res.status(404).json({ success: false, message: "Discharge summary not found" });
    }
    // Co-sign reconciles a COMPLETED self-finalize — a draft has nothing to
    // co-sign yet.
    if (existing.status !== "finalized") {
      return res.status(409).json({
        success: false,
        code: "NOT_FINALIZED",
        message: "Only a finalized discharge summary can be co-signed — finalize it first.",
      });
    }
    if (existing.cosignedAt) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_COSIGNED",
        message: `Discharge summary already co-signed by ${existing.cosignedByName || "a senior"} at ${existing.cosignedAt}.`,
      });
    }

    // Senior-tier gate (NABH COP.7). Mirrors mlcController.finalize: only a
    // Doctor with a senior designation (or Admin) may attest — a Junior
    // Resident cannot co-sign, which is the whole point of the SoD.
    if (req.user?.role !== "Doctor" && req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Only a senior Doctor / Admin can co-sign a discharge summary." });
    }
    if (req.user?.role === "Doctor") {
      const u = await User.findById(req.user._id || req.user.id)
        .select("doctorDetails.designation").lean();
      const desig = u?.doctorDetails?.designation || "";
      const SENIOR = new Set(["Consultant", "HOD", "Senior Resident", "Associate Professor", "Professor"]);
      if (!SENIOR.has(desig)) {
        return res.status(403).json({
          success: false,
          code: "DESIGNATION_REQUIRED",
          message: `Co-sign requires a senior designation (Consultant / HOD / Senior Resident / Associate Professor / Professor); your designation is '${desig || "—"}'.`,
        });
      }
    }

    // Best-effort separation-of-duties — the co-signer should not be the
    // same person who finalized. The finalize path persists only
    // finalizedByName (no finalizer userId), so this is a name-level guard.
    const actorName = req.user?.fullName || req.user?.employeeId || "";
    if (actorName && existing.finalizedByName && actorName === existing.finalizedByName) {
      return res.status(409).json({
        success: false,
        code: "SAME_ACTOR",
        message: "SAME_ACTOR — a discharge summary must be co-signed by a different (senior) doctor than the one who finalized it.",
      });
    }

    // Atomic CAS — stamp the co-sign only while still finalized + not yet
    // co-signed. cosigned* are whitelisted past the model's finalized-
    // immutability guard (post-finalize legal metadata, like mlrNumberSnapshot).
    const summary = await DischargeSummary.findOneAndUpdate(
      { _id: req.params.id, status: "finalized", cosignedAt: null },
      {
        $set: {
          cosignedBy:     req.user?._id || req.user?.id || null,
          cosignedByName: actorName || "Senior Doctor",
          cosignedAt:     new Date(),
        },
      },
      { new: true, runValidators: true },
    );
    if (!summary) {
      // Race: co-signed by another user between the pre-check and the write.
      return res.status(409).json({
        success: false,
        code: "ALREADY_COSIGNED",
        message: "Discharge summary was co-signed by another user — refresh and try again.",
      });
    }

    // R7bn-1 / D9-fix parity — ClinicalAudit emit on co-sign (signature
    // event, 7y retention floor). Non-blocking, mirrors the finalize emit.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: "DISCHARGE_SUMMARY_COSIGNED",
        UHID: summary.UHID,
        admissionId: summary.admissionId,
        patientId: summary.patient,
        patientName: summary.patientName,
        targetType: "DischargeSummary",
        targetId: summary._id,
        after: {
          cosignedByName: summary.cosignedByName,
          cosignedAt: summary.cosignedAt,
          finalizedByName: summary.finalizedByName || "",
        },
      });
    } catch (_) { /* silent */ }

    return res.json({
      success: true,
      data: summary,
      message: "Discharge summary co-signed",
    });
  });

  // DELETE /api/discharge-summary/:id
  delete = handle(async (req, res) => {
    const summary = await DischargeSummary.findById(req.params.id);
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    if (summary.status === "finalized") {
      return res.status(400).json({ success: false, message: "Cannot delete a finalized discharge summary" });
    }
    await summary.deleteOne();
    return res.json({ success: true, message: "Discharge summary deleted" });
  });

  // GET /api/discharge-summary — all with optional filters
  getAll = handle(async (req, res) => {
    const { status, department, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (department) filter.department = department;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      DischargeSummary.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      DischargeSummary.countDocuments(filter),
    ]);
    return res.json({ success: true, data, total, page: parseInt(page) });
  });
}

module.exports = new DischargeSummaryController();
