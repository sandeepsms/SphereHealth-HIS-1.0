const OPD       = require("../../models/Patient/OPDModels");
const Patient   = require("../../models/Patient/patientModel");
const Admission = require("../../models/Patient/admissionModel");

// ── Generate OPD admission number ──────────────────────────────────────────
async function generateOPDAdmissionNumber() {
  const today = new Date();
  const prefix = `OPD-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}-`;
  const last = await Admission.findOne({ admissionNumber: { $regex: `^${prefix}` } })
    .sort({ admissionNumber: -1 }).lean();
  const seq = last ? (parseInt(last.admissionNumber.slice(-4), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

class OPDService {
  /* ── Create a new OPD visit ── */
  async createOPDVisit(opdData) {
    // Get patient's current OPD visit count before saving
    const patient = await Patient.findById(opdData.patientId);
    if (!patient) throw new Error("Patient not found");

    const seq = (patient.totalOPDVisits || 0) + 1;
    opdData.patientVisitSeq = seq;
    opdData.UHID = patient.UHID; // always pull fresh from Patient record

    // Denormalize patient info for quick display (avoids populate on every queue fetch)
    opdData.patientName   = patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`.trim() || patient.name || "";
    opdData.contactNumber = patient.phone || patient.mobile || patient.contactNumber || "";
    opdData.age           = patient.age ? String(patient.age) : "";
    opdData.gender        = patient.gender || "";

    const opd = new OPD(opdData);
    const savedOPD = await opd.save();

    // Increment patient's OPD visit counter and lastVisitDate
    await Patient.findByIdAndUpdate(opdData.patientId, {
      $inc: { totalOPDVisits: 1 },
      lastVisitDate: new Date(),
    });

    // ── Create a lightweight Admission record (admissionType "OPD") ────────
    // This bridges OPD visits into the billing audit trail, nurse assessment,
    // and doctor assessment systems which all operate on Admission records.
    try {
      const admissionNumber = await generateOPDAdmissionNumber();
      const admission = await Admission.create({
        UHID:            savedOPD.UHID,
        patientId:       patient._id,
        patientName:     patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`.trim() || patient.name,
        contactNumber:   patient.phone || patient.mobile || patient.contactNumber || "N/A",
        admissionType:   "OPD",
        admissionNumber,
        visitNumber:     savedOPD.visitNumber,
        attendingDoctor: savedOPD.consultantName || "",
        attendingDoctorId: savedOPD.doctorId || null,
        department:      savedOPD.department || "",
        departmentId:    savedOPD.departmentId || null,
        reasonForAdmission: savedOPD.chiefComplaint || "OPD Consultation",
        hasBed:          false,
        status:          "Active",
        paymentType:     opdData.paymentType || "GENERAL",
        admissionDate:   savedOPD.visitDate || new Date(),
      });

      // Fire audit trigger: OPD Registration (consultation fee)
      try {
        const autoBilling = require("../Billing/autoBillingService");
        if (autoBilling.onOPDRegistered) {
          autoBilling.onOPDRegistered(savedOPD, admission).catch(() => {});
        }
      } catch (_) {}

      savedOPD._admissionId = admission._id; // attach for response
    } catch (admErr) {
      console.error("[OPDService] Failed to create OPD admission record:", admErr.message);
      // Non-fatal — OPD visit still created successfully
    }

    return savedOPD;
  }

  /* ── Get all OPD visits (paginated + filterable) ── */
  async getAllOPDVisits(page = 1, limit = 50, filters = {}) {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.vitalsStatus) query.vitalsStatus = filters.vitalsStatus;
    if (filters.departmentId) query.departmentId = filters.departmentId;
    if (filters.doctorId) query.doctorId = filters.doctorId;
    if (filters.UHID) query.UHID = filters.UHID;
    if (filters.visitType) query.visitType = filters.visitType;

    // Date range filter
    if (filters.date) {
      const d = new Date(filters.date);
      d.setHours(0, 0, 0, 0);
      const d2 = new Date(d);
      d2.setDate(d.getDate() + 1);
      query.visitDate = { $gte: d, $lt: d2 };
    }

    const visits = await OPD.find(query)
      .sort({ visitDate: -1, tokenNumber: 1 })
      .skip(skip)
      .limit(limit)
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId");

    const total = await OPD.countDocuments(query);

    return {
      visits,
      pagination: { total, page, pages: Math.ceil(total / limit) },
    };
  }

  /* ── Get one visit ── */
  async getOPDVisitById(visitNumber) {
    return OPD.findOne({ visitNumber })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId");
  }

  /* ── Patient's full OPD history ── */
  async getPatientOPDHistory(patientId) {
    return OPD.find({ patientId })
      .sort({ visitDate: -1 })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo");
  }

  /* ── Today's visits (optionally filtered) ── */
  async getTodayVisits(filters = {}) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const query = { visitDate: { $gte: today, $lt: tomorrow } };
    if (filters.departmentId) query.departmentId = filters.departmentId;
    if (filters.doctorId) query.doctorId = filters.doctorId;
    if (filters.vitalsStatus) query.vitalsStatus = filters.vitalsStatus;

    return OPD.find(query)
      .sort({ tokenNumber: 1 })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId");
  }

  /* ── Visits by department (recent, with optional date filter) ── */
  async getVisitsByDepartment(departmentId, dateStr) {
    const query = { departmentId };
    if (dateStr) {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      const d2 = new Date(d);
      d2.setDate(d.getDate() + 1);
      query.visitDate = { $gte: d, $lt: d2 };
    }
    return OPD.find(query)
      .sort({ visitDate: -1, tokenNumber: 1 })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId");
  }

  /* ── Visits by doctor ── */
  async getVisitsByDoctor(doctorId, dateStr) {
    const query = { doctorId };
    if (dateStr) {
      const d = new Date(dateStr);
      d.setHours(0, 0, 0, 0);
      const d2 = new Date(d);
      d2.setDate(d.getDate() + 1);
      query.visitDate = { $gte: d, $lt: d2 };
    }
    return OPD.find(query)
      .sort({ visitDate: -1, tokenNumber: 1 })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId");
  }

  /* ── Follow-up due ── */
  async getFollowUpDue(date) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    return OPD.find({
      followUpRequired: true,
      followUpDate: { $gte: startDate, $lt: endDate },
    }).populate("doctorId", "personalInfo");
  }

  /* ── Update a visit ── */
  async updateOPDVisit(visitNumber, updateData) {
    return OPD.findOneAndUpdate({ visitNumber }, updateData, {
      new: true,
      runValidators: true,
    })
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo");
  }

  /* ── Nurse updates vitals ── */
  async updateVitals(visitNumber, vitalsData, nurseName) {
    const { chiefComplaint, allergyHistory, ...pureVitals } = vitalsData;

    const update = {
      vitals: pureVitals,
      vitalsStatus: "Done",
      vitalsEnteredBy: nurseName || "Nurse",
      vitalsEnteredAt: new Date(),
      status: "In Progress",
    };

    if (chiefComplaint)  update.chiefComplaint  = chiefComplaint;
    if (allergyHistory)  update.allergyHistory  = allergyHistory;

    // Compute BMI
    if (pureVitals.weight && pureVitals.height) {
      const h = pureVitals.height / 100;
      update.vitals.bmi = parseFloat((pureVitals.weight / (h * h)).toFixed(2));
    }

    const updatedVisit = await OPD.findOneAndUpdate({ visitNumber }, update, { new: true });

    // Fire audit trigger for vitals
    if (updatedVisit) {
      try {
        const admission = await Admission.findOne({ visitNumber, admissionType: "OPD", status: "Active" }).lean();
        if (admission) {
          const autoBilling = require("../Billing/autoBillingService");
          if (autoBilling.onOPDVitalsRecorded) {
            autoBilling.onOPDVitalsRecorded(updatedVisit, admission, nurseName).catch(() => {});
          }
        }
      } catch (_) {}
    }

    return updatedVisit;
  }

  /* ── Doctor saves OPD assessment (SOAP note + diagnosis + plan) ── */
  async saveOPDAssessment(visitNumber, assessmentData, doctorName) {
    const update = {
      generalExamination:    assessmentData.generalExamination || "",
      systemicExamination:   assessmentData.systemicExamination || "",
      provisionalDiagnosis:  assessmentData.provisionalDiagnosis || "",
      finalDiagnosis:        assessmentData.finalDiagnosis || "",
      advice:                assessmentData.advice || "",
      followUpDate:          assessmentData.followUpDate || null,
      doctorNotes:           assessmentData.doctorNotes || "",
      // SOAP fields
      subjectiveNote:        assessmentData.subjectiveNote || "",
      objectiveNote:         assessmentData.objectiveNote || "",
      assessmentNote:        assessmentData.assessmentNote || "",
      planNote:              assessmentData.planNote || "",
      assessedBy:            doctorName || "Doctor",
      assessedAt:            new Date(),
      status:                "Completed",
      // HOPI — structured history
      hopiOnset:              assessmentData.hopiOnset              || "",
      hopiDurationValue:      assessmentData.hopiDurationValue      || "",
      hopiDurationUnit:       assessmentData.hopiDurationUnit       || "",
      hopiProgression:        assessmentData.hopiProgression        || "",
      hopiCharacter:          assessmentData.hopiCharacter          || "",
      hopiAssociatedSymptoms: assessmentData.hopiAssociatedSymptoms || [],
      hopiAggravating:        assessmentData.hopiAggravating        || "",
      hopiRelieving:          assessmentData.hopiRelieving          || "",
      // Chronic illnesses
      chronicConditions:      assessmentData.chronicConditions      || [],
      chronicOthers:          assessmentData.chronicOthers          || "",
    };

    const updatedVisit = await OPD.findOneAndUpdate({ visitNumber }, update, { new: true });

    // Fire audit trigger for doctor assessment
    if (updatedVisit) {
      try {
        const admission = await Admission.findOne({ visitNumber, admissionType: "OPD", status: "Active" }).lean();
        if (admission) {
          const autoBilling = require("../Billing/autoBillingService");
          if (autoBilling.onOPDAssessmentSaved) {
            // Update admission provisional diagnosis
            await Admission.findByIdAndUpdate(admission._id, {
              reasonForAdmission: assessmentData.provisionalDiagnosis || admission.reasonForAdmission,
            });
            autoBilling.onOPDAssessmentSaved(updatedVisit, admission, doctorName).catch(() => {});
          }
        }
      } catch (_) {}
    }

    return updatedVisit;
  }

  /* ── Update visit status (Waiting → In Progress → Completed) ── */
  async updateStatus(visitNumber, status) {
    return OPD.findOneAndUpdate(
      { visitNumber },
      { status },
      { new: true }
    );
  }

  /* ── Delete a visit ── */
  async deleteOPDVisit(visitNumber) {
    return OPD.findOneAndDelete({ visitNumber });
  }

  /* ── Add investigation ── */
  async addInvestigation(visitNumber, investigation) {
    return OPD.findOneAndUpdate(
      { visitNumber },
      { $push: { investigationsOrdered: { ...investigation, orderedDate: new Date() } } },
      { new: true }
    );
  }

  /* ── Update investigation status ── */
  async updateInvestigationStatus(visitNumber, investigationId, status) {
    return OPD.findOneAndUpdate(
      { visitNumber, "investigationsOrdered._id": investigationId },
      { $set: { "investigationsOrdered.$.status": status } },
      { new: true }
    );
  }

  /* ── Add prescription ── */
  async addPrescription(visitNumber, medication) {
    return OPD.findOneAndUpdate(
      { visitNumber },
      { $push: { prescribedMedications: medication } },
      { new: true }
    );
  }

  /* ── Complete visit ── */
  async completeVisit(visitNumber, finalData) {
    return OPD.findOneAndUpdate(
      { visitNumber },
      { ...finalData, status: "Completed" },
      { new: true }
    );
  }
}

module.exports = new OPDService();
