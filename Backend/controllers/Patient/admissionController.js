const AdmissionService = require("../../services/Patient/admissionService");
const { nextSequence } = require("../../utils/counter");

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    return result;
  } catch (err) {
    const status = err.message?.includes("not found") ? 404 : 400;
    return res.status(status).json({ success: false, message: err.message });
  }
};

class AdmissionController {
  createAdmission = handle(async (req, res) => {
    const admission = await AdmissionService.createAdmission(req.body);

    // ── Auto-billing: fire registration + admission + first bed-day charges ──
    try {
      const autoBilling = require("../../services/Billing/autoBillingService");
      autoBilling.onAdmissionCreated(admission).catch((e) =>
        console.error("Admission auto-billing error:", e.message)
      );
    } catch (e) { /* don't block the admission */ }

    return res.status(201).json({
      success: true,
      message: "Patient admitted successfully",
      data: admission,
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

  getAdmissionById = handle(async (req, res) => {
    const admission = await AdmissionService.getAdmissionById(req.params.id);
    return res.json({ success: true, data: admission });
  });

  getActiveAdmissions = handle(async (req, res) => {
    const filters = { ...req.query };
    if (req.user?.role === "Doctor" && req.doctorProfile?._id) {
      filters.attendingDoctorId = req.doctorProfile._id;
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

  getTodayDischarges = handle(async (req, res) => {
    const admissions = await AdmissionService.getTodayDischarges();
    return res.json({ success: true, data: admissions });
  });

  getExpectedDischarges = handle(async (req, res) => {
    const { date } = req.query;
    const admissions = await AdmissionService.getExpectedDischarges(date);
    return res.json({ success: true, data: admissions });
  });

  getAdmissionStatistics = handle(async (req, res) => {
    const { startDate, endDate } = req.query;
    const stats = await AdmissionService.getAdmissionStatistics(
      startDate,
      endDate,
    );
    return res.json({ success: true, data: stats });
  });

  searchAdmissions = handle(async (req, res) => {
    const { q } = req.query;
    if (!q)
      return res
        .status(400)
        .json({ success: false, message: "Search term q is required" });
    const admissions = await AdmissionService.searchAdmissions(q);
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
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Not authenticated" });
    if (!req.doctorProfile?._id) {
      return res.status(404).json({ success: false, message: "No linked Doctor record" });
    }
    const { status = "Active" } = req.query;
    const admissions = await AdmissionService.getMyIPDPatients(req.doctorProfile._id, status);
    return res.json({ success: true, data: admissions, count: admissions.length });
  });

  // GET /api/admissions/:id/access  — check if current doctor owns the admission
  checkAccess = handle(async (req, res) => {
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Not authenticated" });
    const { admission, isOwner } = await AdmissionService.checkDoctorAccess(req.params.id, req.user.id);
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
    const admission = await AdmissionService.dischargePatient(
      req.params.id,
      req.body,
    );
    return res.json({
      success: true,
      message: "Patient discharged successfully. Bed is now available.",
      data: admission,
    });
  });

  cancelAdmission = handle(async (req, res) => {
    const { reason } = req.body;
    const admission = await AdmissionService.cancelAdmission(
      req.params.id,
      reason,
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
    const result = await AdmissionService.deleteAdmission(req.params.id);
    return res.json({ success: true, message: result.message });
  });

  /* ══════════════════════════════════════════════════════════════
     NABH COP.1 — Multi-doctor Consultation / Treatment Team
  ══════════════════════════════════════════════════════════════ */

  /**
   * POST /:id/consultation
   * Add a consulting doctor to an admission's treatment team.
   * RULE: Only the primary consultant (attendingDoctorId) may add consultants.
   */
  addConsultation = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    // Auth check: only primary consultant or Admin can add
    const callerId = req.user?._id?.toString() || req.user?.id?.toString();
    const primaryId = admission.attendingDoctorId?.toString();
    if (req.user?.role !== "Admin" && callerId !== primaryId) {
      return res.status(403).json({
        success: false,
        message: "Only the primary consultant can appoint additional doctors.",
      });
    }

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

    const callerId = req.user?._id?.toString() || req.user?.id?.toString();
    const primaryId = admission.attendingDoctorId?.toString();
    const consultingId = member.doctorId?.toString();
    const isAdmin = req.user?.role === "Admin";
    const isPrimary = callerId === primaryId;
    const isConsulting = callerId === consultingId;

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

    const callerId = req.user?._id?.toString() || req.user?.id?.toString();
    const primaryId = admission.attendingDoctorId?.toString();
    if (req.user?.role !== "Admin" && callerId !== primaryId) {
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
    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    // Persist the full payload on a sub-doc so the assessment is traceable.
    if (!admission.nurseInitialAssessment || typeof admission.nurseInitialAssessment !== "object") {
      admission.nurseInitialAssessment = {};
    }
    Object.assign(admission.nurseInitialAssessment, req.body || {}, { savedAt: new Date() });
    admission.markModified("nurseInitialAssessment");

    // Flip the gate flag too.
    if (!admission.initialAssessment || typeof admission.initialAssessment !== "object") {
      admission.initialAssessment = {};
    }
    admission.initialAssessment.nurseCompleted   = true;
    admission.initialAssessment.nurseCompletedAt = new Date();
    admission.initialAssessment.nurseName        = req.body?.signoff?.name || req.body?.nurseName || "";
    admission.markModified("initialAssessment");

    await admission.save();
    return res.json({ success: true, data: admission.nurseInitialAssessment });
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

    const admission = await Admission.findById(req.params.id);
    if (!admission) return res.status(404).json({ success: false, message: "Admission not found" });

    const now = new Date();
    // Ensure initialAssessment object exists (Mixed type needs explicit init)
    if (!admission.initialAssessment || typeof admission.initialAssessment !== "object") {
      admission.initialAssessment = {};
    }
    if (role === "doctor") {
      admission.initialAssessment.doctorCompleted   = true;
      admission.initialAssessment.doctorCompletedAt = now;
      admission.initialAssessment.doctorName        = name;
    } else {
      admission.initialAssessment.nurseCompleted   = true;
      admission.initialAssessment.nurseCompletedAt = now;
      admission.initialAssessment.nurseName        = name;
    }
    // markModified is required for Mixed-type fields so Mongoose tracks the change
    admission.markModified("initialAssessment");
    await admission.save();
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
  getDischargeQueue = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const list = await Admission.find({
      status: { $in: ["Active", "Discharged"] },
      $or: [
        { "dischargeWorkflow.stage": { $in: ["DoctorApproved", "BillCleared", "GatePassIssued"] } },
        {
          "dischargeWorkflow.stage": "Completed",
          "dischargeWorkflow.gatePassIssuedAt": { $gte: startOfToday },
        },
      ],
    })
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
    const Admission = require("../../models/Patient/admissionModel");
    const adm = await Admission.findById(req.params.id);
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    if (!adm.dischargeWorkflow) adm.dischargeWorkflow = {};
    adm.dischargeWorkflow.stage              = "DoctorApproved";
    adm.dischargeWorkflow.doctorApprovedAt   = new Date();
    adm.dischargeWorkflow.doctorApprovedBy   = req.body.doctorName || "Doctor";
    if (req.body.finalBillAmount !== undefined)
      adm.dischargeWorkflow.finalBillAmount = Number(req.body.finalBillAmount) || 0;
    adm.markModified("dischargeWorkflow");
    await adm.save();
    return res.json({ success: true, data: adm.dischargeWorkflow });
  });

  // POST /api/admissions/:id/clear-final-bill
  // Receptionist clears the final bill (after payment collected).
  // Body: { finalBillNumber, finalBillAmount, clearedBy, paymentMode?, transactionId? }
  // If a PatientBill exists for this admission, also record the payment on it
  // so the bill's balanceAmount drops to 0 and billStatus becomes PAID.
  clearFinalBill = handle(async (req, res) => {
    const Admission   = require("../../models/Patient/admissionModel");
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const adm = await Admission.findById(req.params.id);
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    if (!adm.dischargeWorkflow) adm.dischargeWorkflow = {};
    if (adm.dischargeWorkflow.stage === "NotRequested") {
      return res.status(400).json({ success: false, message: "Doctor has not yet approved discharge" });
    }
    // Idempotency: refuse to re-clear an already-cleared bill so concurrent
    // receptionists (or accidental retries) don't double-push payment rows
    // onto the linked PatientBill.
    if (["BillCleared", "GatePassIssued", "Completed"].includes(adm.dischargeWorkflow.stage)) {
      return res.status(409).json({
        success: false,
        message: `Final bill already cleared on ${adm.dischargeWorkflow.billClearedAt || "an earlier action"}.`,
      });
    }
    adm.dischargeWorkflow.stage           = "BillCleared";
    adm.dischargeWorkflow.billClearedAt   = new Date();
    adm.dischargeWorkflow.billClearedBy   = req.body.clearedBy || "Receptionist";
    if (req.body.finalBillNumber) adm.dischargeWorkflow.finalBillNumber = req.body.finalBillNumber;
    if (req.body.finalBillAmount !== undefined)
      adm.dischargeWorkflow.finalBillAmount = Number(req.body.finalBillAmount) || 0;
    adm.markModified("dischargeWorkflow");
    await adm.save();

    // Also push a payment row onto the linked IPD/DAYCARE bill so the
    // patient's outstanding balance reflects the final-bill clearance.
    // We try (a) admission link, (b) admissionNumber denorm, then
    // (c) the patient's open IPD/DAYCARE bill — covering bills created
    // through any of the three paths the system supports.
    try {
      const finalAmt = Number(req.body.finalBillAmount) || 0;
      if (finalAmt > 0) {
        const openCond = { billStatus: { $nin: ["PAID", "CANCELLED", "REFUNDED"] } };
        let bill = await PatientBill.findOne({ admission: adm._id, ...openCond });
        if (!bill && adm.admissionNumber)
          bill = await PatientBill.findOne({ admissionNumber: adm.admissionNumber, ...openCond });
        if (!bill && adm.UHID)
          bill = await PatientBill.findOne({
            UHID: adm.UHID,
            visitType: { $in: ["IPD", "DAYCARE"] },
            ...openCond,
          });
        if (bill) {
          // Validate paymentMode against PaymentSchema enum
          const ALLOWED = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"];
          const reqMode = String(req.body.paymentMode || "CASH").toUpperCase();
          const mode = ALLOWED.includes(reqMode) ? reqMode : "CASH";

          bill.payments.push({
            amount:        finalAmt,
            paymentMode:   mode,
            transactionId: req.body.transactionId,
            receivedBy:    req.body.clearedBy || "Reception",
            remarks:       "Final bill cleared at discharge",
          });
          // Status flip happens before save so the pre-save hook (which
          // honours billStatus when computing balanceAmount) sees the right
          // value. The hook itself recomputes advancePaid + balanceAmount
          // using patientPayableAmount, so we don't need manual math here.
          const paid = bill.payments.reduce((s, p) => s + (p.amount || 0), 0);
          const patientShare = bill.patientPayableAmount || bill.netAmount || 0;
          bill.billStatus    = paid + 0.5 >= patientShare ? "PAID" : "PARTIAL";
          if (bill.billStatus === "PAID") bill.paidAt = new Date();
          await bill.save();
        }
      }
    } catch (e) { /* don't block discharge clearance on bill update */ }

    return res.json({ success: true, data: adm.dischargeWorkflow });
  });

  // POST /api/admissions/:id/issue-gate-pass
  // Final step — receptionist hands gate pass + marks discharge complete.
  issueGatePass = handle(async (req, res) => {
    const Admission = require("../../models/Patient/admissionModel");
    const adm = await Admission.findById(req.params.id);
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    if (!adm.dischargeWorkflow) adm.dischargeWorkflow = {};
    if (adm.dischargeWorkflow.stage !== "BillCleared" && adm.dischargeWorkflow.stage !== "GatePassIssued") {
      return res.status(400).json({ success: false, message: "Final bill must be cleared before issuing gate pass" });
    }
    // Idempotency: if a gate pass already exists, return it instead of
    // generating a new one (avoids duplicate GP numbers on retry).
    if (adm.dischargeWorkflow.stage === "Completed" || adm.dischargeWorkflow.gatePassNumber) {
      return res.status(409).json({
        success: false,
        message: `Gate pass already issued (${adm.dischargeWorkflow.gatePassNumber || "—"})`,
      });
    }
    // Generate gate-pass number: GP-YYYYMMDD-XXXX via atomic Counter
    // (replaces the legacy countDocuments race that produced duplicates).
    // The two lines below are kept for backward-compat name shadowing; the
    // actual value comes from `nextSequence`.
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const seq = await nextSequence(`gatepass:${dateStr}`);
    const passNumber = `GP-${dateStr}-${String(seq).padStart(4, "0")}`;
    adm.dischargeWorkflow.stage             = "Completed";
    adm.dischargeWorkflow.gatePassNumber    = passNumber;
    adm.dischargeWorkflow.gatePassIssuedAt  = new Date();
    adm.dischargeWorkflow.gatePassIssuedBy  = req.body.issuedBy || "Receptionist";
    adm.status                              = "Discharged";
    adm.actualDischargeDate                 = new Date();
    adm.markModified("dischargeWorkflow");
    await adm.save();

    // Free the bed so the next admission can use it. Mirrors
    // admissionService.dischargePatient — without this, beds stay stuck
    // "Occupied" forever after a receptionist-issued gate pass.
    if (adm.bedId) {
      try {
        const Bed = require("../../models/bedMgmt/bedsModel");
        await Bed.findByIdAndUpdate(adm.bedId, {
          $set: { status: "Available", currentAdmission: null, patient: null },
        });
      } catch (e) {
        console.error("[issueGatePass] Failed to release bed:", e.message);
      }
    }

    return res.json({ success: true, data: adm.dischargeWorkflow });
  });
}

module.exports = new AdmissionController();
