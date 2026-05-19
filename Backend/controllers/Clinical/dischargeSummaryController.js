// controllers/Clinical/dischargeSummaryController.js
const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
const Admission = require("../../models/Patient/admissionModel");

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
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
      // Upsert — second save overwrites the draft instead of orphaning it.
      summary = await DischargeSummary.findOneAndUpdate(
        { admissionId: data.admissionId },
        { $set: data },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
      );
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
    const summary = await DischargeSummary.findByIdAndUpdate(
      req.params.id,
      data,
      { new: true, runValidators: true }
    );
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });
    return res.json({ success: true, data: summary });
  });

  // PATCH /api/discharge-summary/:id/finalize
  finalize = handle(async (req, res) => {
    const { finalizedByName, allowOverride, overrideReason } = req.body;

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
    const summary = await DischargeSummary.findByIdAndUpdate(
      req.params.id,
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
    if (!summary) return res.status(404).json({ success: false, message: "Discharge summary not found" });

    // Also update the admission record status AND release the bed.
    // Audit-Pass-17 found the bed was never released on finalize — the bed
    // stayed Occupied forever, blocking new admissions. Now we free it
    // atomically (Available + clear patient + clear currentAdmission).
    if (summary.admissionId) {
      const admission = await Admission.findByIdAndUpdate(
        summary.admissionId,
        {
          status: "Discharged",
          actualDischargeDate: summary.dischargeDate || new Date(),
          conditionOnDischarge: summary.conditionOnDischarge,
          dischargeSummary: summary._id.toString(),
          followUpInstructions: summary.followUpInstructions,
        },
        { new: true, runValidators: true },
      );
      if (admission?.bedId) {
        try {
          const Bed = require("../../models/bedMgmt/bedsModel");
          // runValidators added per R9 re-audit — without it, the bed
          // status enum wasn't enforced on the update path, so a future
          // typo upstream could persist an invalid status silently.
          await Bed.findByIdAndUpdate(
            admission.bedId,
            {
              $set: {
                status: "Available",
                patient: null,
                currentAdmission: null,
                lastDischargedAt: new Date(),
              },
            },
            { runValidators: true },
          );
        } catch (e) { /* non-fatal — surface in admin alerts */ }
      }
    }

    return res.json({ success: true, data: summary, message: "Discharge summary finalized" });
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
