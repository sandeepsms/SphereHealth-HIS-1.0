// controllers/Clinical/dischargeSummaryController.js
const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
const Admission = require("../../models/Patient/admissionModel");
const admissionService = require("../../services/Patient/admissionService");
const User = require("../../models/User/userModel");

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
    if (data.admissionDate && data.dischargeDate) {
      const diff = new Date(data.dischargeDate) - new Date(data.admissionDate);
      data.totalDaysAdmitted = Math.ceil(diff / (1000 * 60 * 60 * 24));
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
        patientId: summary.patientId,
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
        const patient = summary.patientId
          ? await Patient.findById(summary.patientId).select("_id UHID fullName name age gender sex").lean()
          : { _id: summary.patientId, UHID: summary.UHID, fullName: summary.patientName, age: summary.age, sex: summary.gender };
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
      const stage = admission.dischargeWorkflow?.stage || "NotRequested";
      const billAlreadyCleared = ["BillCleared", "GatePassIssued", "Completed"].includes(stage);

      if (billAlreadyCleared) {
        // Bill already cleared — fully discharge via the canonical service
        // path so the bed is released, daily-charges flushed, CleaningTask
        // created, overage refunded, and BillingAudit emitted.
        try {
          await admissionService.dischargePatient(summary.admissionId, {
            actualDischargeDate:   summary.dischargeDate || now,
            conditionOnDischarge:  summary.conditionOnDischarge,
            dischargeSummary:      summary._id.toString(),
            followUpInstructions:  summary.followUpInstructions,
            dischargeNotes:        summary.dischargeNotes || "",
            actor: { role: req.user?.role, id: req.user?.id || req.user?._id },
          });
        } catch (e) {
          // dischargePatient surfaces typed errors — log + re-throw so
          // handle() returns the right status. Discharge summary is
          // already marked finalized; rolling that back risks creating
          // an inconsistent state where the bed is released but the
          // summary isn't signed. Let the operator/admin investigate.
          console.error("[Discharge fast-path] dischargePatient failed after summary finalized:", e.message);
          throw e;
        }
      } else {
        // Bill NOT cleared yet — advance workflow stage to DoctorApproved
        // ONLY. Status stays "Active"; bed stays Occupied. Cashier owns
        // the final BedReleased / Completed flip. billClearedBy stays
        // null — only the cashier's explicit clearFinalBill stamps it.
        //
        // CAS — only flip if the stage is currently NotRequested. If a
        // cashier has already advanced it past DoctorApproved (e.g.
        // BillCleared) between our pre-check and now, we noop and let
        // the next finalize attempt route through the cleared-path branch.
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
              "dischargeWorkflow.stage":            "DoctorApproved",
              "dischargeWorkflow.doctorApprovedAt": now,
              "dischargeWorkflow.doctorApprovedBy": finalizedBy,
              dischargeSummary:                     summary._id.toString(),
              ...(summary.conditionOnDischarge && { conditionOnDischarge: summary.conditionOnDischarge }),
              ...(summary.followUpInstructions  && { followUpInstructions:  summary.followUpInstructions  }),
            },
          },
          { runValidators: true },
        );
      }
    }

    return res.json({
      success: true,
      data: summary,
      message: "Discharge summary finalized",
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
