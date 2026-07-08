const AdmissionService = require("../../services/Patient/admissionService");
const { nextSequence } = require("../../utils/counter");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    // Honour explicit err.status / err.statusCode when the service sets one
    // (e.g. 409 from discharge bill-clearance gate). Otherwise fall back to
    // the "not found" → 404 heuristic, with a generic 400 default.
    const explicit = Number(err.status || err.statusCode);
    const status = Number.isInteger(explicit) && explicit >= 400 && explicit < 600
      ? explicit
      : (err.message?.includes("not found") ? 404 : 400);
    return res.status(status).json({ success: false, message: err.message });
  }
};

class AdmissionController {
  createAdmission = handle(async (req, res) => {
    const admission = await AdmissionService.createAdmission(req.body);

    // ── Auto-billing: fire registration + admission + first bed-day charges ──
    // Previously this was fire-and-forget so a billing failure left the
    // patient looking admitted with zero charges and the response said
    // "successfully". We now await and surface the outcome in the body so
    // reception can see whether downstream charges actually fired —
    // without failing the admission itself (clinical record takes priority).
    let billing = { fired: false, error: null };
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      const triggers = await autoBilling.onAdmissionCreated(admission);
      billing = { fired: true, triggerCount: triggers?.length || 0, error: null };
    } catch (e) {
      console.error("Admission auto-billing error:", e?.message || e);
      billing = { fired: false, error: e?.message || "Auto-billing failed" };
    }

    // R7bx-3 — Auto-populate NABH COP.16 Readmission register. The emitter
    // looks up the previous admission for this UHID and no-ops if none
    // exists or the gap exceeds the configured window (30 days by default),
    // so it's safe to call on every admission create. Non-blocking — never
    // rolls back the clinical admission on register failure.
    try {
      const { emitReadmission } = require("../../services/Compliance/nabhRegisterEmitter");
      const Patient = require("../../models/Patient/patientModel");
      const patient = admission.patientId
        ? await Patient.findById(admission.patientId).select("_id UHID fullName name age gender sex").lean()
        : { _id: admission.patientId, UHID: admission.UHID, fullName: admission.patientName, age: admission.age, sex: admission.gender };
      emitReadmission({ admission, patient: patient || {}, actor: req.user || {} })
        .catch((e) => console.error("[admission] emitReadmission error:", e?.message));
    } catch (e) {
      console.error("[admission] Readmission emit wiring failed:", e?.message);
    }

    return res.status(201).json({
      success: true,
      message: billing.fired
        ? "Patient admitted successfully"
        : "Patient admitted, but auto-billing did not fire — review charges manually",
      data: admission,
      billing,
    });
  });

  getAllAdmissions = handle(async (req, res) => {
    const filters = { ...req.query };
    // Doctor scope: only their own admitted patients (set by attachDoctorProfile)
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      filters.attendingDoctorId = req.doctorProfile._id;
    }
    const result = await AdmissionService.getAllAdmissions(filters);
    return res.json({ success: true, ...result });
  });

  // R7az-D9-HIGH-6: Doctor-scope ownership check. Pre-R7az ANY logged-in
  // Doctor could fetch /admissions/:id for any patient — even cases
  // they had nothing to do with. Now we fetch then 403 on mismatch
  // (both attendingDoctorId and treatmentTeam[].doctorId allowed).
  // Admin / Receptionist / Nurse pass through.
  getAdmissionById = handle(async (req, res) => {
    const admission = await AdmissionService.getAdmissionById(req.params.id);
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      const callerDoctorId = String(req.doctorProfile._id);
      const attendingId    = String(admission.attendingDoctorId?._id || admission.attendingDoctorId || "");
      const teamIds        = (admission.treatmentTeam || [])
        .map(m => String(m.doctorId?._id || m.doctorId || ""))
        .filter(Boolean);
      const isAttending = !!attendingId    && callerDoctorId === attendingId;
      const isOnTeam    = teamIds.includes(callerDoctorId);
      if (!isAttending && !isOnTeam) {
        return res.status(403).json({
          success: false,
          message: "You are not on the care team for this admission.",
          code: "NOT_ON_CARE_TEAM",
        });
      }
    }
    return res.json({ success: true, data: admission });
  });

  getActiveAdmissions = handle(async (req, res) => {
    const filters = { ...req.query };
    // R7g: Doctor-scope filter previously required exact match on
    // attendingDoctorId only — meaning admins / cross-cover doctors /
    // doctors on the treatment team but not the primary attending
    // couldn't see the patient in their picker. Now:
    //  - Admin / Accountant: no filter (see all) — needed for handover,
    //    audit, billing reconciliation.
    //  - Doctor: $or match against attendingDoctorId OR
    //    treatmentTeam[].doctorId so consulting / cross-cover doctors
    //    are recognized too.
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      filters.$or = [
        { attendingDoctorId: req.doctorProfile._id },
        { "treatmentTeam.doctorId": req.doctorProfile._id },
      ];
    }
    const admissions = await AdmissionService.getActiveAdmissions(filters);
    return res.json({ success: true, data: admissions });
  });

  getTodayAdmissions = handle(async (req, res) => {
    // Doctor scope filters in-memory because getTodayAdmissions() doesn't
    // accept filters yet — fast enough for "today" lists.
    let admissions = await AdmissionService.getTodayAdmissions();
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      const docId = String(req.doctorProfile._id);
      admissions = admissions.filter(a => String(a.attendingDoctorId) === docId);
    }
    return res.json({ success: true, data: admissions });
  });

  // R7az-D9-HIGH-6: Doctor-scope post-filter. The service methods don't
  // currently take a doctor filter so we filter the result list. Fast
  // enough — these endpoints return a single day's worth of
  // discharges, never thousands of rows. Cross-check against
  // attendingDoctorId AND treatmentTeam[].doctorId.
  getTodayDischarges = handle(async (req, res) => {
    let admissions = await AdmissionService.getTodayDischarges();
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      const docId = String(req.doctorProfile._id);
      admissions = admissions.filter(a =>
        String(a.attendingDoctorId || "") === docId ||
        (a.treatmentTeam || []).some(m => String(m.doctorId || "") === docId),
      );
    }
    return res.json({ success: true, data: admissions });
  });

  getExpectedDischarges = handle(async (req, res) => {
    const { date } = req.query;
    let admissions = await AdmissionService.getExpectedDischarges(date);
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      const docId = String(req.doctorProfile._id);
      admissions = admissions.filter(a =>
        String(a.attendingDoctorId || "") === docId ||
        (a.treatmentTeam || []).some(m => String(m.doctorId || "") === docId),
      );
    }
    return res.json({ success: true, data: admissions });
  });

  // R7az-D3-MED-2: Doctor-scope statistics. Pre-R7az every Doctor saw
  // the global admission counts (whole-hospital census, every dept).
  // Now we pass attendingDoctorId so a Doctor's dashboard reflects
  // only their own clinical load. Admin/Accountant see global.
  getAdmissionStatistics = handle(async (req, res) => {
    const { startDate, endDate } = req.query;
    const doctorFilter = (req.user?.role === "Doctor" && req.doctorProfile?._id)
      ? String(req.doctorProfile._id)
      : null;
    const stats = await AdmissionService.getAdmissionStatistics(
      startDate,
      endDate,
      { attendingDoctorId: doctorFilter },
    );
    return res.json({ success: true, data: stats });
  });

  // R7az-D9-HIGH-6: Doctor-scope search. Pre-R7az the search endpoint
  // was wide-open to any logged-in clinician. Now the service filters
  // by attendingDoctorId for Doctor callers.
  searchAdmissions = handle(async (req, res) => {
    const { q } = req.query;
    if (!q)
      return res
        .status(400)
        .json({ success: false, message: "Search term q is required" });
    const doctorFilter = (req.user?.role === "Doctor" && req.doctorProfile?._id)
      ? String(req.doctorProfile._id)
      : null;
    const admissions = await AdmissionService.searchAdmissions(q, { attendingDoctorId: doctorFilter });
    return res.json({ success: true, data: admissions });
  });

  getPatientByUHID = handle(async (req, res) => {
    const patient = await AdmissionService.getPatientByUHID(req.params.uhid);
    return res.json({ success: true, data: patient });
  });

  // ✅ FIXED: returns both "admissions" and "data" keys
  // Returns empty array if no admissions found (never 400)
  getPatientAdmissionHistory = handle(async (req, res) => {
    const admissions = await AdmissionService.getPatientAdmissionHistory(
      req.params.patientId,
    );
    return res.json({
      success: true,
      admissions: admissions || [], // ✅ PatientHistoryModal uses this
      data: admissions || [], // ✅ backward compat
      count: (admissions || []).length,
    });
  });

  getAdmissionsByDoctor = handle(async (req, res) => {
    const admissions = await AdmissionService.getAdmissionsByDoctor(
      req.params.doctorName,
    );
    return res.json({ success: true, data: admissions });
  });

  // GET /api/admissions/my-patients  — Doctor's own IPD patients (requires auth)
  // Admissions store `attendingDoctorId` as the Doctor model's _id (not the
  // User _id), so we resolve the doctor profile first and pass THAT id.
  getMyPatients = handle(async (req, res) => {
    // R7br: defensive null-check — authenticate() guarantees req.user; if
    // it's missing the bug is upstream. Return 500 (not 401) so the frontend
    // interceptor doesn't trigger an auto-logout cascade.
    if (!req.user?.id) return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set" });
    if (!req.doctorProfile?._id) {
      return res.status(404).json({ success: false, message: "No linked Doctor record" });
    }
    const { status = "Active" } = req.query;
    const admissions = await AdmissionService.getMyIPDPatients(req.doctorProfile._id, status);
    return res.json({ success: true, data: admissions, count: admissions.length });
  });

  // GET /api/admissions/:id/access  — check if current doctor owns the admission
  // R7az-D3-CRIT-1: pass the doctorProfile._id (the Doctor model's _id, NOT
  // User._id) — pre-R7az this passed req.user.id which is the User._id and
  // could never match attendingDoctorId. Result was isOwner:false for every
  // logged-in doctor, even on their own patients.
  checkAccess = handle(async (req, res) => {
    // R7br: same defensive null-check as getMyPatients — 500 (not 401).
    if (!req.user?.id) return res.status(500).json({ success: false, code: "INTERNAL_NO_USER", message: "Internal error — req.user not set" });
    const { admission, isOwner } = await AdmissionService.checkDoctorAccess(
      req.params.id,
      {
        userId: req.user.id,
        doctorProfileId: req.doctorProfile?._id,
      },
    );
    return res.json({ success: true, isOwner, data: admission });
  });

  updateAdmission = handle(async (req, res) => {
    const admission = await AdmissionService.updateAdmission(
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Admission updated",
      data: admission,
    });
  });

  dischargePatient = handle(async (req, res) => {
    // Pipe caller identity into the service so the allowOverride path can
    // re-check role at the business-logic layer (re-audit H-03 defense in
    // depth — the route already gates `ipd.discharge` to Admin+Doctor; this
    // narrows the bypass-the-bill-gate sub-action to Admin only).
    const admission = await AdmissionService.dischargePatient(
      req.params.id,
      {
        ...req.body,
        actor: { role: req.user?.role, id: req.user?.id || req.user?._id },
      },
    );
    return res.json({
      success: true,
      message: "Patient discharged successfully. Bed is now available.",
      data: admission,
    });
  });

  cancelAdmission = handle(async (req, res) => {
    // R7bd-A-3 / A1-CRIT-3 — pipe req.user into the cascade so audit
    // rows attribute to the right actor. The `force` query flag bypasses
    // the "bills with payments" guard and is Admin-only (refund path
    // must be used first under normal circumstances).
    const { reason } = req.body;
    const force = String(req.query.force || "").toLowerCase() === "true";
    if (force && req.user?.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Only Admin can force-cancel an admission with collected payments.",
        code: "FORCE_REQUIRES_ADMIN",
      });
    }
    const actor = {
      id:   req.user?.id || req.user?._id,
      name: req.user?.fullName || req.user?.employeeId || "",
      role: req.user?.role || "",
    };
    const admission = await AdmissionService.cancelAdmission(
      req.params.id,
      reason,
      { actor, force },
    );
    return res.json({
      success: true,
      message: "Admission cancelled",
      data: admission,
    });
  });

  transferBed = handle(async (req, res) => {
    const { newBedId, reason } = req.body;
    if (!newBedId)
      return res
        .status(400)
        .json({ success: false, message: "newBedId is required" });
    const admission = await AdmissionService.transferBed(
      req.params.id,
      newBedId,
      reason,
    );
    return res.json({
      success: true,
      message: "Bed transferred successfully",
      data: admission,
    });
  });

  deleteAdmission = handle(async (req, res) => {
    // R7bd-A-2 / A1-CRIT-2 — soft delete with optional force-cascade.
    // The base permission `admission.delete` already gates the route;
    // we further restrict force=true to Admin so only that role can
    // tear down a populated admission record. Reason is captured for
    // the audit trail.
    const force = String(req.query.force || "").toLowerCase() === "true";
    if (force && req.user?.role !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Only Admin can force-cascade delete an admission with active dependencies.",
        code: "FORCE_REQUIRES_ADMIN",
      });
    }
    const actor = {
      id:     req.user?.id || req.user?._id,
      name:   req.user?.fullName || req.user?.employeeId || "",
      role:   req.user?.role || "",
      reason: req.body?.reason || (force ? "FORCE_DELETE" : ""),
    };
    const result = await AdmissionService.deleteAdmission(req.params.id, { force, actor });
    return res.json({ success: true, message: result.message });
  });

  /* ══════════════════════════════════════════════════════════════
     NABH COP.1 — Multi-doctor Consultation / Treatment Team
  ══════════════════════════════════════════════════════════════ */

  /**
   * POST /:id/consultation
   * Add a consulting doctor to an admission's treatment team.
   * RULE: Only the primary consultant (attendingDoctorId) may add consultants.
   *
   * R7az-D3-CRIT-2: pre-R7az compared `req.user._id` (User._id) against
   * `admission.attendingDoctorId` (Doctor._id). User._id never matches
   * Doctor._id directly — the comparison was always false and EVERY
   * Doctor request was 403'd except Admins. Now compares the resolved
   * doctorProfile._id (attached by attachDoctorProfile middleware).
   */
  addConsultation = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    // Auth check: only primary consultant or Admin can add
    const callerDoctorId = req.doctorProfile?._id?.toString() || "";
    const primaryId      = admission.attendingDoctorId?.toString() || "";
    const isPrimary      = !!callerDoctorId && !!primaryId && callerDoctorId === primaryId;
    if (req.user?.role !== "Admin" && !isPrimary) {
      return res.status(403).json({
        success: false,
        message: "Only the primary consultant can appoint additional doctors.",
      });
    }
    const callerId = req.user?._id?.toString() || req.user?.id?.toString();

    const {
      doctorId, doctorName, department, departmentId, specialization,
      role = "Consulting Specialist",
      reason, urgency = "Routine",
    } = req.body;

    if (!doctorName) return res.status(400).json({ success: false, message: "doctorName is required" });

    // Prevent adding the primary consultant as a team member
    if (doctorId && doctorId === primaryId) {
      return res.status(400).json({ success: false, message: "Primary consultant is already on the team." });
    }

    // Prevent duplicates
    const already = admission.treatmentTeam.some(
      m => (m.doctorId?.toString() === doctorId) ||
           (!doctorId && m.doctorName === doctorName && m.status !== "Completed")
    );
    if (already) {
      return res.status(409).json({ success: false, message: `${doctorName} is already on the treatment team.` });
    }

    const member = {
      doctorId: doctorId || null,
      doctorName,
      department: department || "",
      departmentId: departmentId || null,
      specialization: specialization || "",
      role,
      addedBy: admission.attendingDoctor || req.user?.name || "Primary Consultant",
      addedById: callerId,
      addedAt: new Date(),
      reason: reason || "",
      urgency,
      status: "Active",
      consultationNotes: "",
    };

    admission.treatmentTeam.push(member);
    await admission.save();

    return res.status(201).json({
      success: true,
      message: `${doctorName} added to treatment team`,
      data: admission.treatmentTeam[admission.treatmentTeam.length - 1],
    });
  });

  /**
   * GET /:id/consultation
   * Return treatment team with primary consultant prepended.
   */
  getConsultations = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const admission = await Admission.findById(req.params.id)
      .select("attendingDoctor attendingDoctorId department departmentId treatmentTeam patientName UHID admissionNumber");
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    const primaryMember = {
      _id: "primary",
      doctorId: admission.attendingDoctorId,
      doctorName: admission.attendingDoctor || "Primary Consultant",
      department: admission.department || "",
      role: "Primary Consultant",
      status: "Active",
      isPrimary: true,
    };

    return res.json({
      success: true,
      data: {
        primary: primaryMember,
        team: admission.treatmentTeam || [],
        patientName: admission.patientName,
        UHID: admission.UHID,
        admissionNumber: admission.admissionNumber,
      },
    });
  });

  /**
   * PUT /:id/consultation/:consultId
   * Primary consultant: change status ("Completed" / "Declined")
   * Consulting doctor: add/update their consultationNotes
   * Either: any other allowed update
   */
  updateConsultation = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    const member = admission.treatmentTeam.id(req.params.consultId);
    if (!member) return res.status(404).json({ success: false, message: "Consultation not found" });

    // R7az-D3-CRIT-2: compare doctorProfile._id (Doctor model _id) — not
    // User._id — against attendingDoctorId / treatmentTeam[].doctorId.
    // Same null-on-mismatch bug as addConsultation; see note there.
    const callerDoctorId = req.doctorProfile?._id?.toString() || "";
    const primaryId      = admission.attendingDoctorId?.toString() || "";
    const consultingId   = member.doctorId?.toString() || "";
    const isAdmin        = req.user?.role === "Admin";
    const isPrimary      = !!callerDoctorId && !!primaryId    && callerDoctorId === primaryId;
    const isConsulting   = !!callerDoctorId && !!consultingId && callerDoctorId === consultingId;

    if (!isAdmin && !isPrimary && !isConsulting) {
      return res.status(403).json({ success: false, message: "You do not have permission to update this consultation." });
    }

    const { status, consultationNotes, urgency, reason } = req.body;

    // Primary can change status / urgency / reason
    if (isPrimary || isAdmin) {
      if (status) member.status = status;
      if (urgency) member.urgency = urgency;
      if (reason !== undefined) member.reason = reason;
    }

    // Consulting doctor can add/update their notes
    if (isConsulting || isAdmin) {
      if (consultationNotes !== undefined) {
        member.consultationNotes = consultationNotes;
        member.notesUpdatedAt = new Date();
        member.notesUpdatedBy = req.user?.name || member.doctorName;
        if (!member.status || member.status === "Pending") member.status = "Active";
      }
    }

    await admission.save();
    return res.json({ success: true, message: "Consultation updated", data: member });
  });

  /**
   * DELETE /:id/consultation/:consultId
   * Remove a consultant — primary only.
   */
  removeConsultation = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    // R7az-D3-CRIT-2: doctorProfile._id, not User._id. See addConsultation.
    const callerDoctorId = req.doctorProfile?._id?.toString() || "";
    const primaryId      = admission.attendingDoctorId?.toString() || "";
    const isPrimary      = !!callerDoctorId && !!primaryId && callerDoctorId === primaryId;
    if (req.user?.role !== "Admin" && !isPrimary) {
      return res.status(403).json({ success: false, message: "Only the primary consultant can remove team members." });
    }

    admission.treatmentTeam = admission.treatmentTeam.filter(
      m => m._id.toString() !== req.params.consultId
    );
    await admission.save();
    return res.json({ success: true, message: "Consultant removed from team" });
  });

  /**
   * GET /my-team-patients
   * Returns all active admissions where the current doctor is primary OR consulting.
   * Route must be mounted BEFORE /:id routes.
   */
  getMyTeamPatients = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    // Admissions store the Doctor model `_id` in `attendingDoctorId` (from
    // the reception console). req.doctorProfile is set by attachDoctorProfile
    // when a Doctor user is logged in.
    if (!req.doctorProfile?._id) {
      return res.status(404).json({ success: false, message: "No linked Doctor record" });
    }
    const doctorId = req.doctorProfile._id.toString();

    const [asPrimary, asConsulting] = await Promise.all([
      Admission.find({ attendingDoctorId: doctorId, status: "Active" })
        .select("patientName UHID admissionNumber department admissionDate bedNumber attendingDoctor treatmentTeam")
        .sort({ admissionDate: -1 }),
      Admission.find({
        "treatmentTeam.doctorId": doctorId,
        "treatmentTeam.status": "Active",
        status: "Active",
      }).select("patientName UHID admissionNumber department admissionDate bedNumber attendingDoctor treatmentTeam"),
    ]);

    // Tag each admission with the doctor's role
    const primaryList = asPrimary.map(a => ({ ...a.toObject(), myRole: "Primary Consultant" }));
    const consultingList = asConsulting
      .filter(a => !asPrimary.some(p => p._id.toString() === a._id.toString()))  // dedup
      .map(a => {
        const myEntry = a.treatmentTeam.find(m => m.doctorId?.toString() === doctorId);
        return { ...a.toObject(), myRole: myEntry?.role || "Consulting Specialist", myConsultEntry: myEntry };
      });

    return res.json({
      success: true,
      data: {
        asPrimary: primaryList,
        asConsulting: consultingList,
        total: primaryList.length + consultingList.length,
      },
    });
  });
  /**
   * POST /:id/nurse-assessment
   * Body: full nurse-initial-assessment payload (vitals, history, etc.) +
   * `signoff` object with { name, designation, signedAt, notes, nurseSignature }.
   * Stores the payload on the admission (NABH IPSG.6 nurse signoff trail)
   * and flips initialAssessment.nurseCompleted = true.
   */
  saveNurseInitialAssessment = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");

    // R7bn-2 / D10-fix: atomic $set instead of findById → mutate → save.
    // Pre-fix, two clients (nurse + doctor) saving their own initial
    // assessments at the same instant would both load the same stale
    // admission doc and the last .save() would clobber the other's
    // changes. With $set on dotted paths we only touch the keys we own.
    const nurseAssessment = { ...(req.body || {}), savedAt: new Date() };
    const now = new Date();
    const nurseName = req.body?.signoff?.name || req.body?.nurseName || "";

    const updated = await Admission.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          nurseInitialAssessment: nurseAssessment,
          "initialAssessment.nurseCompleted":   true,
          "initialAssessment.nurseCompletedAt": now,
          "initialAssessment.nurseName":        nurseName,
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) return res.status(404).json({ success: false, message: "Admission not found" });

    // R7bn-1 / D9-fix: emit ClinicalAudit row for the NABH AAC.7 trail.
    emitClinicalAudit({
      req,
      event: "INITIAL_ASSESSMENT_NURSE_SIGNED",
      UHID: updated.UHID,
      admissionId: updated._id,
      patientId: updated.patientId,
      patientName: updated.patientName,
      targetType: "Admission.nurseInitialAssessment",
      targetId: updated._id,
      after: { nurseName, savedAt: now },
    });

    return res.json({ success: true, data: updated.nurseInitialAssessment });
  });

  /**
   * PUT /:id/initial-assessment
   * Body: { role: "doctor" | "nurse", name: "Dr. XYZ" }
   * Marks doctor or nurse initial assessment as completed.
   */
  markInitialAssessment = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const { role, name = "" } = req.body;
    if (!["doctor", "nurse"].includes(role))
      return res.status(400).json({ success: false, message: 'role must be "doctor" or "nurse"' });

    // R7s: Atomic $set on the specific role's flags only. The previous
    // read-then-save pattern was vulnerable to a race: if the doctor
    // marks complete at the same time as the nurse, both load the same
    // admission doc, each writes their own role's flags, and the last
    // .save() overwrites the other role's flags entirely (clobbering
    // the doctor- OR nurse-completed:true that the other request set).
    // findOneAndUpdate with dotted-path $set updates only the targeted
    // sub-keys, leaving the other role's flags intact.
    const now = new Date();
    const updates = role === "doctor"
      ? {
          "initialAssessment.doctorCompleted":   true,
          "initialAssessment.doctorCompletedAt": now,
          "initialAssessment.doctorName":        name,
        }
      : {
          "initialAssessment.nurseCompleted":   true,
          "initialAssessment.nurseCompletedAt": now,
          "initialAssessment.nurseName":        name,
        };
    const admission = await Admission.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    // R7bn-1 / D9-fix: ClinicalAudit emit on Initial Assessment sign-off.
    // Both doctor + nurse signings cleared the NABH COP.1/COP.2 gate, so
    // surveyors need a chronological trail showing who signed when.
    try {
      const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
      emitClinicalAudit({
        req,
        event: role === "doctor"
          ? "INITIAL_ASSESSMENT_DOCTOR_SIGNED"
          : "INITIAL_ASSESSMENT_NURSE_SIGNED",
        UHID: admission.UHID,
        admissionId: admission._id,
        patientId: admission.patientId,
        patientName: admission.patientName,
        targetType: "Admission.initialAssessment",
        targetId: admission._id,
        after: { role, name, signedAt: now },
      });
    } catch (_) { /* silent — audit emit is non-blocking */ }

    return res.json({ success: true, message: `${role} initial assessment marked complete`, data: admission.initialAssessment });
  });

  /* ═══════════════════════════════════════════════════════════
     DISCHARGE CLEARANCE WORKFLOW  (Receptionist)
     Stages: NotRequested → DoctorApproved → BillCleared
              → GatePassIssued → Completed
  ═══════════════════════════════════════════════════════════ */

  // GET /api/admissions/discharge-queue
  // Returns the discharge workflow queue:
  //   • DoctorApproved + BillCleared + GatePassIssued → all returned
  //   • Completed → only those gate-passed today (so the "Discharged Today"
  //     tab doesn't grow unbounded over weeks of history).
  // R7az-D8-HIGH-3: Doctor-scope. Pre-R7az every Doctor saw the entire
  // hospital's discharge queue — including patients of other doctors.
  // Now we filter by attendingDoctorId OR treatmentTeam[].doctorId so
  // a Doctor only sees their own clinical work. Reception/Admin keep
  // the full view to coordinate gate-pass issuance.
  getDischargeQueue = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

    const baseQuery = {
      status: { $in: ["Active", "Discharged"] },
      $or: [
        { "dischargeWorkflow.stage": { $in: ["DoctorApproved", "BillCleared", "GatePassIssued"] } },
        {
          "dischargeWorkflow.stage": "Completed",
          "dischargeWorkflow.gatePassIssuedAt": { $gte: startOfToday },
        },
      ],
    };

    // Doctor scope (additive AND on top of the stage/date filter).
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      const docId = req.doctorProfile._id;
      baseQuery.$and = [
        {
          $or: [
            { attendingDoctorId: docId },
            { "treatmentTeam.doctorId": docId },
          ],
        },
      ];
    }

    const list = await Admission.find(baseQuery)
      .populate("patientId",     "fullName UHID dateOfBirth age gender contactNumber")
      .populate("attendingDoctorId", "firstName lastName fullName doctorDetails.specialization")
      .populate("departmentId",      "departmentName")
      .sort({ "dischargeWorkflow.doctorApprovedAt": -1 })
      .lean();
    return res.json({ success: true, count: list.length, data: list });
  });

  // POST /api/admissions/:id/doctor-approve-discharge
  // Called by Doctor after writing discharge summary.
  // Body: { doctorName, finalBillAmount? }
  doctorApproveDischarge = handle(async (req, res) => {
    // Atomic CAS — only flip stage if it's currently NotRequested or
    // missing. Audit A-10: previous load+mutate+save raced when two
    // doctors clicked at the same time; now whichever request wins
    // returns 200, the other gets a clean 409. No double-fire of the
    // approval timestamp / approver name.
    const Admission = require("../../models/Patient/admissionModel");

    // R7az-D8-CRIT-5: primary-consultant OR treatment-team gate. Pre-R7az
    // any logged-in Doctor could approve any admission's discharge — a
    // dermatologist with no involvement in the case could discharge an
    // ICU patient. Now we require the caller to be either the primary
    // attending OR a member of the treatment team (NABH consultation
    // model). Admin bypasses.
    if (req.user?.role === "Doctor") {
      const probeAdmission = await Admission.findById(req.params.id)
        .select("attendingDoctorId treatmentTeam.doctorId").lean();
      if (!probeAdmission) {
        return res.status(404).json({ success: false, message: "Admission not found" });
      }
      const callerDoctorId = String(req.doctorProfile?._id || "");
      const attendingId    = String(probeAdmission.attendingDoctorId || "");
      const teamIds        = (probeAdmission.treatmentTeam || [])
        .map(m => String(m.doctorId || ""))
        .filter(Boolean);
      const isAttending = !!callerDoctorId && !!attendingId && callerDoctorId === attendingId;
      const isOnTeam    = !!callerDoctorId && teamIds.includes(callerDoctorId);
      if (!isAttending && !isOnTeam) {
        return res.status(403).json({
          success: false,
          message: "Only the primary attending consultant or a treatment-team member may approve discharge.",
          code: "NOT_ON_CARE_TEAM",
        });
      }
    }

    // R7hr-245 (audit: discharge-approve bypasses summary + NABH gates) —
    // require a FINALIZED discharge summary before approving, and copy its
    // legal dischargeType onto the workflow so a LAMA/Death isn't silently
    // left as "Routine" (which would skip the LAMA/Mortality register at
    // gate-pass). The FE never calls this endpoint directly, so this is pure
    // direct-API hardening with no UI-flow regression.
    const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
    const finalizedSummary = await DischargeSummary.findOne({
      admissionId: req.params.id,
      status: "finalized",
    }).select("dischargeType").sort({ finalizedAt: -1 }).lean();
    if (!finalizedSummary) {
      return res.status(409).json({
        success: false,
        code: "DISCHARGE_SUMMARY_REQUIRED",
        message: "A finalized discharge summary is required before approving discharge. Finalize the summary first.",
      });
    }

    const set = {
      "dischargeWorkflow.stage":              "DoctorApproved",
      "dischargeWorkflow.doctorApprovedAt":   new Date(),
      "dischargeWorkflow.doctorApprovedBy":   req.body.doctorName || "Doctor",
      "dischargeWorkflow.dischargeType":      finalizedSummary.dischargeType || "Routine",
    };
    if (req.body.finalBillAmount !== undefined) {
      set["dischargeWorkflow.finalBillAmount"] = Number(req.body.finalBillAmount) || 0;
    }
    const adm = await Admission.findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [
          { "dischargeWorkflow.stage": "NotRequested" },
          { "dischargeWorkflow.stage": { $exists: false } },
          { dischargeWorkflow: { $exists: false } },
        ],
      },
      { $set: set },
      { new: true, runValidators: true },
    );
    if (!adm) {
      // Either admission missing, or stage was already past NotRequested.
      const probe = await Admission.findById(req.params.id).select("dischargeWorkflow.stage").lean();
      if (!probe) return res.status(404).json({ success: false, message: "Admission not found" });
      return res.status(409).json({
        success: false,
        message: `Discharge already approved (current stage: ${probe.dischargeWorkflow?.stage}).`,
      });
    }
    return res.json({ success: true, data: adm.dischargeWorkflow });
  });

  // POST /api/admissions/:id/clear-final-bill
  // Receptionist clears the final bill (after payment collected).
  // Body: { finalBillNumber, finalBillAmount, clearedBy, paymentMode?, transactionId? }
  // If a PatientBill exists for this admission, also record the payment on it
  // so the bill's balanceAmount drops to 0 and billStatus becomes PAID.
  clearFinalBill = handle(async (req, res) => {
    // Atomic CAS — only flip stage if it's currently "DoctorApproved"
    // (audit A-10). Two concurrent cashier clicks can no longer both
    // push a payment row onto the linked PatientBill: the loser's
    // CAS fails and returns 409 cleanly, the bill update below
    // never runs for them.
    const Admission   = require("../../models/Patient/admissionModel");
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

    // R7cu — HARD pharmacy-credit gate. Before flipping the stage to
    // BillCleared, confirm there is NO outstanding pharmacy bill for
    // this admission. Without this gate, a discharged patient walks
    // out and the pharmacy chases family for ₹X that should have been
    // collected at the counter — the user explicitly flagged this as
    // unacceptable ("pharmacy IPD credit ledger fully paid hone tak
    // discharge possible nhi hai"). Pharmacist clears the credit via
    // Pharmacy → IPD Credit tab; only THEN the bill clearance can
    // proceed.
    const pharmacyCtrl = require("../Pharmacy/pharmacyController");
    const phOutstanding = await pharmacyCtrl.getOutstandingForAdmission(req.params.id);
    if (phOutstanding.total > 0) {
      return res.status(409).json({
        success: false,
        code:    "PHARMACY_OUTSTANDING",
        message: `Pharmacy outstanding ₹${phOutstanding.total.toFixed(2)} on ${phOutstanding.count} bill(s). ` +
                 `Collect via Pharmacy → IPD Credit before clearing the final bill.`,
        pharmacyOutstanding: phOutstanding.total,
        pharmacyBillCount:   phOutstanding.count,
        // Bill numbers so the frontend can deep-link the pharmacist.
        pharmacyBillNumbers: phOutstanding.sales.map(s => s.billNumber).filter(Boolean),
      });
    }

    // R7hr-197 — REAL primary-bill balance gate. The pharmacy gate above
    // only covers pharmacy credit; the main IPD bill (room/nursing/
    // procedure) was never checked, so a patient could be cleared owing the
    // bulk of the bill. Resolve the primary IPD bill and require the entered
    // settlement to cover its outstanding balance:
    //   • Normal/Routine → balance after the entered amount must be ~0.
    //   • LAMA/DAMA/Death/Absconded/Referral → may clear with a balance, but
    //     only with a recorded waiverReason (NABH-auditable).
    const { toNum } = require("../../utils/money");
    const BillingTrigger = require("../../models/Billing/BillingTrigger");
    const admGate = await Admission.findById(req.params.id).select("dischargeWorkflow UHID admissionNumber convertedFromAdmission").lean();
    const dispoType    = admGate?.dischargeWorkflow?.dischargeType || "Routine";
    const waiverReason = String(req.body.waiverReason || "").trim();

    // Block on un-billed PENDING "Confirm & Bill" triggers (R7hr-194) — those
    // charges aren't on the ledger yet, so the balance would understate the dues.
    const pendingConfirm = await BillingTrigger.countDocuments({
      admissionId: req.params.id, requiresConfirmation: true, status: "pending",
    });
    if (pendingConfirm > 0) {
      return res.status(409).json({
        success: false, code: "PENDING_CONFIRM_CHARGES",
        message: `${pendingConfirm} charge(s) await 'Confirm & Bill' on the IPD ledger. Confirm or void them before clearing the final bill.`,
        pendingConfirm,
      });
    }

    const openBillCond = { billStatus: { $nin: ["PAID", "CANCELLED", "REFUNDED"] } };
    // R7hr(billing-audit R3) — sum ALL open bills for this admission, not just
    // one. An admission can carry more than a single open bill (the IPD bill
    // plus a separately-generated day-care / service bill, or a residual DRAFT
    // beside a PARTIAL). The old single findOne checked only the first, so a
    // patient could be discharged still owing on the un-checked bill. Match by
    // admission link OR admissionNumber denorm (one $or, each doc once — no
    // double count); fall back to the UHID IPD/DAYCARE sweep only when nothing
    // matched by admission.
    let gateBills = await PatientBill.find({
      ...openBillCond,
      $or: [
        { admission: req.params.id },
        ...(admGate?.admissionNumber ? [{ admissionNumber: admGate.admissionNumber }] : []),
      ],
    }).lean();
    if (!gateBills.length && admGate?.UHID) {
      gateBills = await PatientBill.find({
        UHID: admGate.UHID, visitType: { $in: ["IPD", "DAYCARE"] }, ...openBillCond,
      }).lean();
    }
    const balanceNow     = gateBills.reduce((s, b) => s + toNum(b.balanceAmount), 0);
    const enteredAmt     = Number(req.body.finalBillAmount) || 0;
    const remainingAfter = balanceNow - enteredAmt;
    const isNormalDispo  = !["LAMA", "DAMA", "Death", "Absconded", "Referral"].includes(dispoType);

    // R7hr(billing-audit P1.2) — same-episode OPD dues gate. If this admission
    // converted from a same-day OPD visit, that OPD bill belongs to the SAME
    // episode and must be settled at discharge too — else the patient walks out
    // still owing the pre-admission consult/services. Waivable for
    // LAMA/DAMA/Death/Absconded/Referral via the same waiverReason.
    if (admGate?.convertedFromAdmission) {
      const opdBill = await PatientBill.findOne({ admission: admGate.convertedFromAdmission, ...openBillCond });
      const opdDue  = opdBill ? toNum(opdBill.balanceAmount) : 0;
      if (opdDue > 0.5 && isNormalDispo && !waiverReason) {
        return res.status(409).json({
          success: false, code: "OPD_OUTSTANDING",
          message: `Pre-admission OPD bill not settled — ₹${opdDue.toFixed(2)} outstanding on the linked OPD visit${opdBill.billNumber ? ` (${opdBill.billNumber})` : ""}. Collect it (or record a waiver) before clearing the final bill.`,
          opdOutstanding: opdDue, opdBillNumber: opdBill.billNumber || null,
        });
      }
    }

    if (remainingAfter > 0.5) {
      if (isNormalDispo) {
        return res.status(409).json({
          success: false, code: "BILL_NOT_SETTLED",
          message: `IPD bill not fully settled — ₹${remainingAfter.toFixed(2)} would remain after the entered amount. Collect the balance, then clear.`,
          balance: balanceNow, entered: enteredAmt, outstanding: remainingAfter,
        });
      }
      if (!waiverReason) {
        return res.status(400).json({
          success: false, code: "WAIVER_REQUIRED",
          message: `${dispoType} discharge with ₹${remainingAfter.toFixed(2)} outstanding — a waiver reason is required to clear with a balance.`,
          balance: balanceNow, outstanding: remainingAfter, dischargeType: dispoType,
        });
      }
    }

    const set = {
      "dischargeWorkflow.stage":         "BillCleared",
      "dischargeWorkflow.billClearedAt": new Date(),
      // JWT actor (R7hr-197) — the audit name is the logged-in cashier, not a body field.
      "dischargeWorkflow.billClearedBy": req.user?.fullName || req.body.clearedBy || "Receptionist",
    };
    if (waiverReason) set["dischargeWorkflow.billWaiverReason"] = waiverReason;
    if (req.body.finalBillNumber) set["dischargeWorkflow.finalBillNumber"] = req.body.finalBillNumber;
    if (req.body.finalBillAmount !== undefined) {
      set["dischargeWorkflow.finalBillAmount"] = Number(req.body.finalBillAmount) || 0;
    }
    // R7ab: gate on status:"Active" too. Previously a Cancelled or
    // Transferred admission whose `dischargeWorkflow.stage` happened to
    // be DoctorApproved (from a half-completed earlier discharge attempt)
    // could still be flipped to BillCleared, which then cascades into
    // issueGatePass flipping the bed to Available — corrupting whatever
    // patient is currently in that bed.
    const adm = await Admission.findOneAndUpdate(
      { _id: req.params.id, status: "Active", "dischargeWorkflow.stage": "DoctorApproved" },
      { $set: set },
      { new: true, runValidators: true },
    );
    if (!adm) {
      const probe = await Admission.findById(req.params.id).select("dischargeWorkflow status").lean();
      if (!probe) return res.status(404).json({ success: false, message: "Admission not found" });
      if (probe.status && probe.status !== "Active") {
        return res.status(409).json({
          success: false,
          message: `Cannot clear final bill — admission is currently '${probe.status}', not 'Active'.`,
        });
      }
      const stage = probe.dischargeWorkflow?.stage || "NotRequested";
      if (stage === "NotRequested") {
        return res.status(400).json({ success: false, message: "Doctor has not yet approved discharge" });
      }
      return res.status(409).json({
        success: false,
        message: `Final bill already cleared on ${probe.dischargeWorkflow.billClearedAt || "an earlier action"}.`,
      });
    }

    // R7hr-12-S3 (D4-12): TOCTOU re-check — close the race window between
    // the pharmacy-outstanding read at L852 and the CAS at L881. A ward
    // indent that releases between those two ops creates a fresh PHARM-*
    // line item on the IPD PatientBill via autoBillingService.onIndentReleased,
    // which the L852 check could not see. We now re-read outstanding ONCE
    // more here — if it became >0 in the sub-second window, REVERT the
    // stage back to DoctorApproved (atomic CAS, no risk to a parallel
    // doctor-approval flow because the stage is already BillCleared) and
    // surface a 409. This is the exact failure mode R7cu was designed to
    // eliminate; without this re-check the gate could leak a freshly-
    // dispensed indent past the receptionist's hand-off.
    const phRecheck = await pharmacyCtrl.getOutstandingForAdmission(req.params.id);
    if (phRecheck.total > 0) {
      // Revert the stage — only flip back if WE were the one that set it
      // to BillCleared in this request (guard against a concurrent
      // gate-pass that already advanced past us). Stage flip back to
      // DoctorApproved + clear the bill-cleared marker fields.
      await Admission.findOneAndUpdate(
        { _id: req.params.id, "dischargeWorkflow.stage": "BillCleared" },
        { $set: {
          "dischargeWorkflow.stage":         "DoctorApproved",
          "dischargeWorkflow.billClearedAt": null,
          "dischargeWorkflow.billClearedBy": null,
        } },
      );
      return res.status(409).json({
        success: false,
        code:    "PHARMACY_OUTSTANDING_RACED",
        message: `Pharmacy outstanding ₹${phRecheck.total.toFixed(2)} on ${phRecheck.count} bill(s) was raised between the gate read and the bill-clear commit. ` +
                 `Collect via Pharmacy → IPD Credit and retry.`,
        pharmacyOutstanding: phRecheck.total,
        pharmacyBillCount:   phRecheck.count,
        pharmacyBillNumbers: phRecheck.sales.map(s => s.billNumber).filter(Boolean),
      });
    }

    // Also push payment row(s) onto the admission's open bill(s) so the
    // patient's outstanding balance reflects the final-bill clearance.
    // R7hr(billing-audit R3) — WATERFALL across EVERY open bill (oldest first)
    // instead of dumping the whole payment onto the first bill found. The gate
    // above now sums ALL open bills for the admission, so a multi-bill
    // admission needs the full total to pass; here we distribute that total
    // bill-by-bill — each takes min(remaining, its own balance), and the last
    // bill soaks up any rounding/overpayment remainder so the whole collected
    // amount stays on the audit trail. Reduces EXACTLY to the old single-bill
    // behaviour when the admission has one open bill (pay = full finalAmt).
    // Bill resolution still covers all three link paths: (a) admission ref,
    // (b) admissionNumber denorm, (c) UHID IPD/DAYCARE fallback.
    try {
      const finalAmt = Number(req.body.finalBillAmount) || 0;   // toNum already in scope (L894)
      if (finalAmt > 0) {
        const openCond = { billStatus: { $nin: ["PAID", "CANCELLED", "REFUNDED"] } };
        let bills = await PatientBill.find({
          ...openCond,
          $or: [
            { admission: adm._id },
            ...(adm.admissionNumber ? [{ admissionNumber: adm.admissionNumber }] : []),
          ],
        }).sort({ createdAt: 1 });
        if (!bills.length && adm.UHID)
          bills = await PatientBill.find({
            UHID: adm.UHID,
            visitType: { $in: ["IPD", "DAYCARE"] },
            ...openCond,
          }).sort({ createdAt: 1 });

        // Validate paymentMode against PaymentSchema enum (once).
        const ALLOWED = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"];
        const reqMode = String(req.body.paymentMode || "CASH").toUpperCase();
        const mode = ALLOWED.includes(reqMode) ? reqMode : "CASH";

        let remaining = finalAmt;
        for (let i = 0; i < bills.length && remaining > 0.005; i++) {
          const bill = bills[i];
          const patientShare = toNum(bill.patientPayableAmount) || toNum(bill.netAmount) || 0;
          const paidSoFar    = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
          const billBal      = Math.max(0, patientShare - paidSoFar);
          const isLast       = i === bills.length - 1;
          // Each bill takes what it owes; the last one absorbs any leftover
          // (rounding / overpayment) so nothing collected goes unrecorded.
          const pay = isLast ? remaining : Math.min(remaining, billBal);
          if (pay <= 0.005) continue;

          bill.payments.push({
            amount:        pay,
            paymentMode:   mode,
            transactionId: req.body.transactionId,
            receivedBy:    req.body.clearedBy || "Reception",
            remarks:       "Final bill cleared at discharge",
          });
          // Status flip happens before save so the pre-save hook (which
          // honours billStatus when computing balanceAmount) sees the right
          // value. R7at-FIX-12/D1-CRIT-C2: use toNum() everywhere — Decimal128
          // payment amounts once string-concatenated ("0100.00") and left tiny
          // bills silently PARTIAL at discharge.
          const paid = bill.payments.reduce((s, p) => s + toNum(p.amount), 0);
          bill.billStatus = paid + 0.5 >= patientShare ? "PAID" : "PARTIAL";
          if (bill.billStatus === "PAID") bill.paidAt = new Date();
          // R7bp-FIX (audit P0 — billNumber dup-null E11000): a resolved bill
          // may still be DRAFT (never finalised on the OPD desk — discharge is
          // closing it directly). The model enforces `billStatus !== "DRAFT" ⇒
          // billNumber present`, so stamp one atomically before the status flip
          // saves (idempotent — no-op if it already carries a number).
          try {
            const billingSvc = require("../../services/Billing/billingService");
            if (typeof billingSvc.ensureBillNumberForNonDraft === "function") {
              await billingSvc.ensureBillNumberForNonDraft(bill);
            }
          } catch (e) {
            console.warn("[admissionController] ensureBillNumberForNonDraft failed (proceeding — model validator will catch):", e?.message || e);
          }
          await bill.save();
          remaining -= pay;
        }
      }
    } catch (e) {
      // R7hr-197 — a failed bill update must NOT leave stage=BillCleared with
      // a live balance (that was the silent "discharge clears even if payment
      // never lands" gap). Revert the stage so the cashier retries.
      await Admission.findOneAndUpdate(
        { _id: req.params.id, "dischargeWorkflow.stage": "BillCleared" },
        { $set: {
          "dischargeWorkflow.stage":         "DoctorApproved",
          "dischargeWorkflow.billClearedAt": null,
          "dischargeWorkflow.billClearedBy": null,
        } },
      ).catch(() => {});
      return res.status(500).json({
        success: false, code: "BILL_UPDATE_FAILED",
        message: `Final-bill payment could not be recorded: ${e.message}. Stage reverted — please retry.`,
      });
    }

    return res.json({ success: true, data: adm.dischargeWorkflow });
  });

  // POST /api/admissions/:id/issue-gate-pass
  // Final step — receptionist hands gate pass + marks discharge complete.
  issueGatePass = handle(async (req, res) => {
    // Atomic CAS — only flip stage if it's currently "BillCleared"
    // (audit A-10). The gate-pass number is generated via atomic
    // Counter and STAMPED in the same findOneAndUpdate, so two
    // concurrent receptionists can never both burn a sequence and
    // then both lose the CAS — only the winner's number persists,
    // the loser's sequence is dead but harmless (gaps are expected
    // in any Counter-based numbering scheme).
    const Admission = require("../../models/Patient/admissionModel");
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const seq = await nextSequence(`gatepass:${dateStr}`);
    const passNumber = `GP-${dateStr}-${String(seq).padStart(4, "0")}`;
    const now = new Date();
    // R7ab: also gate on status:"Active" so a Cancelled/Transferred
    // admission can't be flipped to "Discharged" via this path. The
    // bed-release block below relies on the admission still being
    // Active at this CAS instant.
    const adm = await Admission.findOneAndUpdate(
      { _id: req.params.id, status: "Active", "dischargeWorkflow.stage": "BillCleared" },
      { $set: {
        "dischargeWorkflow.stage":            "Completed",
        "dischargeWorkflow.gatePassNumber":   passNumber,
        "dischargeWorkflow.gatePassIssuedAt": now,
        // JWT actor (R7hr-197) — the discharging cashier, not a body field.
        "dischargeWorkflow.gatePassIssuedBy": req.user?.fullName || req.body.issuedBy || "Receptionist",
        "dischargeWorkflow.dischargedBy":     req.user?.fullName || req.body.issuedBy || "Receptionist",
        status:                                "Discharged",
        actualDischargeDate:                   now,
      } },
      { new: true, runValidators: true },
    );
    if (!adm) {
      const probe = await Admission.findById(req.params.id).select("dischargeWorkflow").lean();
      if (!probe) return res.status(404).json({ success: false, message: "Admission not found" });
      const stage = probe.dischargeWorkflow?.stage || "NotRequested";
      if (stage === "Completed" || probe.dischargeWorkflow?.gatePassNumber) {
        return res.status(409).json({
          success: false,
          message: `Gate pass already issued (${probe.dischargeWorkflow?.gatePassNumber || "—"})`,
        });
      }
      return res.status(400).json({
        success: false,
        message: `Final bill must be cleared before issuing gate pass (current stage: ${stage})`,
      });
    }

    // Free the bed so the next admission can use it. Mirrors
    // admissionService.dischargePatient — without this, beds stay stuck
    // "Occupied" forever after a receptionist-issued gate pass.
    //
    // Round-14 re-audit found that a silent bed-update failure (e.g. wrong
    // bedId, connection blip) would leave the admission marked Discharged
    // while the bed stayed Occupied — a bed-management leak that blocks
    // the next admission. Now: we check the result of findByIdAndUpdate,
    // log loud on miss, AND surface a `bedReleased` flag in the response
    // so the reception UI can prompt for manual cleanup. The admission
    // itself stays Discharged (the source of truth) — bed-mgmt is a
    // downstream concern that a nightly sweep can also reconcile.
    //
    // R7bd-A-11 / A1-HIGH-12 — ALSO flip housekeeping.state to
    // CleaningPending AND auto-create a CleaningTask. Pre-R7bd
    // issueGatePass only flipped status:"Available" — so on the
    // discharge path from this controller, housekeeping never knew the
    // bed needed cleaning. dischargePatient (the service path) already
    // did this; the controller-driven gate-pass discharge skipped it,
    // producing a bed-cleaning queue that under-reported the real load.
    let bedReleased = true;
    let bedWarning  = null;
    let bedSnapshot = null;
    if (adm.bedId) {
      try {
        const Bed = require("../../models/bedMgmt/bedsModel");
        bedSnapshot = await Bed.findById(adm.bedId).lean();
        const updated = await Bed.findByIdAndUpdate(
          adm.bedId,
          {
            $set: {
              status: "Available",
              currentAdmission: null,
              patient: null,
              // R7bd-A-11 — housekeeping flip mirrors admissionService.dischargePatient
              "housekeeping.state":      "CleaningPending",
              "housekeeping.startedAt":  new Date(),
              "housekeeping.finishedAt": null,
              "housekeeping.assignedTo": "",
              "currentBooking.actualDischargeDate": now,
            },
          },
          { new: true, runValidators: true },
        );
        if (!updated) {
          bedReleased = false;
          bedWarning  = `Bed ${adm.bedId} not found — manual cleanup required`;
          console.error(`[issueGatePass] bed ${adm.bedId} not found — patient ${adm.UHID} discharged but bed not released`);
        }
      } catch (e) {
        bedReleased = false;
        bedWarning  = `Bed release failed: ${e.message}`;
        console.error(`[issueGatePass] bed-release error for ${adm.UHID}:`, e.message);
      }
    }

    // R7bd-A-11 — Auto-create a CleaningTask so the housekeeping queue
    // shows the bed even though discharge came through the gate-pass
    // route (not the service-level discharge). Best-effort: log + skip
    // on failure (the bed flag above is the primary correctness signal).
    if (bedSnapshot && bedReleased) {
      try {
        const { CleaningTask } = require("../../models/Clinical/housekeepingModels");
        const isolation = (bedSnapshot.isolationFlags || []).filter(Boolean);
        const isIsolation = isolation.length > 0;
        await CleaningTask.create({
          type:        isIsolation ? "terminal" : "discharge-clean",
          title:       isIsolation
            ? `Terminal clean — Bed ${bedSnapshot.bedNumber} (${isolation.join(", ")})`
            : `Discharge clean — Bed ${bedSnapshot.bedNumber}`,
          description: adm.patientName
            ? `Bed turnover after gate-pass discharge of ${adm.patientName} (${adm.UHID || ""}).${isIsolation ? " Follow isolation cleaning protocol." : ""}`
            : `Bed turnover required.${isIsolation ? " Follow isolation cleaning protocol." : ""}`,
          ward:        bedSnapshot.wardName || "",
          roomNumber:  bedSnapshot.roomNumber || "",
          bedNumber:   bedSnapshot.bedNumber || "",
          bedId:       bedSnapshot._id,
          admissionId: adm._id,
          UHID:        adm.UHID || "",
          patientName: adm.patientName || "",
          priority:    isIsolation ? "urgent" : "high",
          protocolFollowed: isIsolation ? "terminal-icu" : "discharge",
          status:      "open",
          requestedByName: "System (Auto on gate-pass)",
          requestedByRole: "System",
        });
      } catch (e) {
        console.error("[issueGatePass] CleaningTask auto-create failed:", e.message);
      }
    }

    return res.json({
      success: true,
      data: adm.dischargeWorkflow,
      ...(bedReleased ? {} : { bedReleased: false, warning: bedWarning }),
    });
  });

  // ═══════════════════════════════════════════════════════════
  // R7i: POST /api/admissions/:id/reactivate
  // ───────────────────────────────────────────────────────────
  // Same-day discharge undo. Admin-only emergency path for the
  // case where a patient was finalized as Discharged but their
  // condition deteriorated before they physically left the
  // premises — we re-occupy the same bed and flip status back
  // to Active instead of forcing a brand-new admission with a
  // new admission number / new IPD billing cycle.
  //
  // GUARDS (defense in depth — all must pass):
  //   1. Role gate: action="admission.reactivate" → Admin only
  //      (enforced by route-level requireAction middleware)
  //   2. Current status must be "Discharged"
  //   3. actualDischargeDate must be within the last 24 hours.
  //      Older discharges should go through a fresh admission
  //      to keep NABH continuity-of-care + billing cycles clean.
  //   4. The original bed must still be Available — if someone
  //      else has been admitted to it, we 409 the request and
  //      let the caller pick a different bed via normal admit.
  //   5. Atomic CAS on both admission AND bed — if either fails
  //      we roll back so we never end up half-active.
  //
  // The pre('save') state-machine guard (Discharged is terminal)
  // is intentionally BYPASSED here via findOneAndUpdate (Mongoose
  // skips pre('save') hooks on raw update operators). That bypass
  // is gated by the action permission, so it cannot be triggered
  // outside this controlled path.
  reactivate = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const Bed       = require("../../models/bedMgmt/bedsModel");
    // R7bd-A-13 / A1-HIGH-16 — Use the model's shared state-machine
    // validator. findOneAndUpdate (below) BYPASSES the pre("save")
    // guard inside admissionModel.js, so without this explicit check
    // we could go Discharged → anything. The same helper is exported
    // for any other update path that mutates status via raw operators.
    const { validateStatusTransition } = Admission;

    const reason = String(req.body?.reason || "").trim();
    if (!reason || reason.length < 10) {
      return res.status(400).json({
        success: false,
        message: "Reactivation reason is required (min 10 chars) — patient safety + NABH audit trail.",
      });
    }

    const adm = await Admission.findById(req.params.id).lean();
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    if (adm.status !== "Discharged") {
      return res.status(409).json({
        success: false,
        message: `Cannot reactivate — admission is currently "${adm.status}", not "Discharged".`,
      });
    }

    // R7bd-A-13 — pre-flight the transition. Discharged is terminal in
    // LEGAL_STATUS_TRANSITIONS, so the validator returns an error.
    // We INTENTIONALLY bypass that for the reactivate flow (admin-only
    // 24h same-day undo) — but only AFTER explicit policy gates have
    // passed (24h window, bed-availability, role). The validateStatusTransition
    // call is here as defense-in-depth documentation: any future
    // refactor that drops the policy gates will trip the validator
    // and fail loud. R7bd-A-19 (TODO): gatePassNumber sequence is NOT
    // restored on reactivate — the original number stays on the admission
    // but if a second discharge happens the new gate-pass number will be
    // the next in the daily counter, leaving a gap in the audit series.
    // This is a known design question (re-issue same number? burn a new
    // one?) deferred to a future change once Reception / NABH agree.
    if (validateStatusTransition) {
      // Will report illegal under current rules — used for surfacing the
      // bypass in the audit log only.
      const err = validateStatusTransition("Discharged", "Active");
      if (err) {
        console.warn(`[Reactivate] Bypassing state-machine guard: ${err}`);
      }
    }

    // 24-hour window — same-day undo only.
    const dischargedAt =
      adm.actualDischargeDate
      || adm.dischargeWorkflow?.gatePassIssuedAt
      || adm.dischargeWorkflow?.billClearedAt
      || adm.dischargeWorkflow?.doctorApprovedAt;
    if (!dischargedAt) {
      return res.status(400).json({
        success: false,
        message: "Cannot determine when this admission was discharged — manual review required.",
      });
    }
    const hoursSince = (Date.now() - new Date(dischargedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) {
      return res.status(409).json({
        success: false,
        message: `Discharge is ${Math.floor(hoursSince)}h old — same-day reactivation window (24h) has closed. Create a new admission instead.`,
      });
    }

    // Check bed availability first (cheap pre-check; CAS below is the real guard).
    if (adm.bedId) {
      const bed = await Bed.findById(adm.bedId).select("status").lean();
      if (bed && bed.status !== "Available" && bed.status !== "Cleaning") {
        return res.status(409).json({
          success: false,
          message: `Original bed is now "${bed.status}" — cannot reactivate to the same bed. Admit fresh and assign a new bed.`,
        });
      }
    }

    // Atomic CAS — only flip status if it is STILL Discharged. Two concurrent
    // admin clicks then become a clean winner / 409 instead of double-active.
    const now = new Date();
    const reactivatedBy = req.body?.byName || req.user?.fullName || "Admin";
    const updatedAdm = await Admission.findOneAndUpdate(
      { _id: req.params.id, status: "Discharged" },
      {
        $set: {
          status: "Active",
          actualDischargeDate: null,
          "dischargeWorkflow.stage": "NotRequested",
          "dischargeWorkflow.reactivatedAt": now,
          "dischargeWorkflow.reactivatedBy": reactivatedBy,
          "dischargeWorkflow.reactivationReason": reason,
        },
        // Clear the per-stage timestamps so the queue doesn't keep
        // showing this admission as "Discharged Today".
        $unset: {
          "dischargeWorkflow.doctorApprovedAt": "",
          "dischargeWorkflow.billClearedAt": "",
          "dischargeWorkflow.gatePassIssuedAt": "",
          "dischargeWorkflow.gatePassNumber": "",
        },
      },
      { new: true, runValidators: true },
    );
    if (!updatedAdm) {
      return res.status(409).json({
        success: false,
        message: "Admission status changed underneath us — reactivation aborted.",
      });
    }

    // Re-occupy the bed. CAS on Available/Cleaning so we never steal an
    // already-allocated bed. If the bed was taken between our pre-check
    // and now, we ROLLBACK the admission flip and return 409.
    //
    // R7az-D8-HIGH-6: ALSO clear housekeeping flags + close the auto-
    // created CleaningTask. Pre-R7az reactivation re-occupied the bed
    // but left `housekeeping.state="CleaningPending"` from the
    // discharge cascade — the bed showed as "Cleaning" on the live
    // bed map even though a live patient was in it. Worse, the open
    // CleaningTask kept appearing in housekeeping's queue and a
    // janitor could be sent to clean an occupied bed.
    let bedRestored = false;
    if (updatedAdm.bedId) {
      const restored = await Bed.findOneAndUpdate(
        { _id: updatedAdm.bedId, status: { $in: ["Available", "Cleaning"] } },
        {
          $set: {
            status: "Occupied",
            patient: updatedAdm.patientId,
            currentAdmission: updatedAdm._id,
            "housekeeping.state":      null,
            "housekeeping.startedAt":  null,
            "housekeeping.finishedAt": null,
            "housekeeping.assignedTo": "",
          },
        },
        { new: true, runValidators: true },
      );
      if (!restored) {
        // Bed was taken between our pre-check and CAS — undo the admission flip.
        await Admission.findByIdAndUpdate(req.params.id, {
          $set: {
            status: "Discharged",
            actualDischargeDate: adm.actualDischargeDate || dischargedAt,
            "dischargeWorkflow.stage": adm.dischargeWorkflow?.stage || "Completed",
            ...(adm.dischargeWorkflow?.gatePassIssuedAt && {
              "dischargeWorkflow.gatePassIssuedAt": adm.dischargeWorkflow.gatePassIssuedAt,
            }),
            ...(adm.dischargeWorkflow?.gatePassNumber && {
              "dischargeWorkflow.gatePassNumber": adm.dischargeWorkflow.gatePassNumber,
            }),
          },
          $unset: {
            "dischargeWorkflow.reactivatedAt": "",
            "dischargeWorkflow.reactivatedBy": "",
            "dischargeWorkflow.reactivationReason": "",
          },
        });
        return res.status(409).json({
          success: false,
          message: "Bed was reassigned between check and reactivate — rolled back. Admit fresh.",
        });
      }
      bedRestored = true;
    }

    // R7az-D8-HIGH-6: Cancel the still-open CleaningTask spawned by
    // the original discharge so housekeeping doesn't dispatch a janitor
    // to an occupied bed. Non-fatal — log + continue if the task model
    // is missing or the update throws; the bed flags above are the
    // primary correctness signal. CleaningTask status enum is
    // ["open","assigned","in-progress","done","cancelled"] — we use
    // "cancelled" with cancelReason="REACTIVATED" for the audit trail.
    try {
      const { CleaningTask } = require("../../models/Clinical/housekeepingModels");
      await CleaningTask.findOneAndUpdate(
        { admissionId: req.params.id, status: { $nin: ["cancelled", "done"] } },
        {
          $set: {
            status:        "cancelled",
            cancelReason:  `REACTIVATED — ${reason}`.slice(0, 500),
            cancelledAt:   new Date(),
          },
        },
      );
    } catch (e) {
      console.warn("[Reactivate] CleaningTask cancel skipped:", e.message);
    }

    // R7bd-A-16 / A1-MED-21 — un-finalize the DischargeSummary so the
    // next discharge can update it. Pre-R7bd a reactivated patient's
    // DischargeSummary stayed `status:"finalized"`, which the model's
    // pre-write guard (DischargeSummaryModel.js) refuses to overwrite.
    // The doctor would get a 500 when re-saving the discharge summary
    // for the eventual second discharge. Now we flip it back to draft.
    // Best-effort: log + skip on failure.
    try {
      const DischargeSummary = require("../../models/Clinical/DischargeSummaryModel");
      // Bypass the model's `_refuseIfFinalized` hook via updateOne with
      // an explicit $set on a single whitelisted-AND-status field — but
      // since `status` isn't in the whitelist, the hook will refuse.
      // Use the raw collection write to step around the guard for this
      // controlled admin path. This is the only place outside the
      // amendment endpoint allowed to revert finalized → draft.
      await DischargeSummary.collection.updateOne(
        { admissionId: updatedAdm._id, status: "finalized" },
        {
          $set: {
            status: "draft",
            // Tombstone the prior finalize-trail so MRD can see the undo.
            updatedAt: new Date(),
          },
          $unset: {
            finalizedAt: "",
            finalizedBy: "",
            finalizedByName: "",
          },
        },
      );
    } catch (e) {
      console.warn("[Reactivate] DischargeSummary un-finalize skipped:", e.message);
    }

    return res.json({
      success: true,
      message: `Discharge undone — patient is Active again${bedRestored ? " on the original bed" : ""}.`,
      data: { admission: updatedAdm, bedRestored },
    });
  });
}

module.exports = new AdmissionController();
