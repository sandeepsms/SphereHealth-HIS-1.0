const OPD       = require("../../models/Patient/OPDModels");
const Patient   = require("../../models/Patient/patientModel");
const Admission = require("../../models/Patient/admissionModel");
const { nextSequence } = require("../../utils/counter");

// ── Generate OPD admission number ──────────────────────────────────────────
// R7bd-A-7 / A1-HIGH-8 — atomic via utils/counter.
// Pre-R7bd this used `findOne({admissionNumber: /^prefix/}).sort(-1)` then
// `+1`, which races catastrophically under concurrent OPD walk-ins: two
// receptionists registering at the same moment computed the same "last
// seq", emitted the same admissionNumber, one save succeeded and one
// silently overwrote the other (no unique index). R7bd-A also adds
// `unique:true sparse:true` on Admission.admissionNumber so a future
// duplicate would E11000 immediately.
//
// Key: `opd-admission:YYYYMMDD` — one counter per local date, padded to 4.
// We seed FROM the existing same-day max ONCE so a redeploy mid-day
// doesn't re-issue numbers that already left the building.
async function generateOPDAdmissionNumber() {
  const today = new Date();
  const datePart = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
  const prefix = `OPD-${datePart}-`;
  const key = `opd-admission:${datePart}`;

  const Counter = require("../../models/CounterModel");
  const existing = await Counter.findOne({ _id: key }).lean();
  let seed = null;
  if (!existing) {
    const last = await Admission.findOne({ admissionNumber: { $regex: `^${prefix}` } })
      .sort({ admissionNumber: -1 }).lean();
    seed = last ? (parseInt(last.admissionNumber.slice(-4), 10) || 0) : 0;
  }
  const seq = await nextSequence(key, seed);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

class OPDService {
  /* ── Create a new OPD visit ── */
  async createOPDVisit(opdData) {
    // ── Same-day idempotency guard ────────────────────────────────────
    // The receptionist flow now auto-fires this from patientService on
    // first registration (so the OPD bill always lands). The frontend
    // ALSO fires it from a follow-up axios call. Without dedupe we'd
    // create two OPD visits + double-bill. If a visit for this patient
    // already exists for today's date (+ same doctor when supplied),
    // return it unchanged. Same-day repeat consultations have to use a
    // different doctor or be created tomorrow — matches HIS billing
    // norms (one consult charge per doctor per day).
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
      const existing = await OPD.findOne({
        patientId: opdData.patientId,
        visitDate: { $gte: todayStart, $lt: todayEnd },
        ...(opdData.doctorId ? { doctorId: opdData.doctorId } : {}),
      }).sort({ createdAt: -1 });
      if (existing) return existing;
    } catch { /* fall through to normal create if dedup lookup fails */ }

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

      // R7bd-A-4 / A1-CRIT-5 — populate BOTH attendingDoctorId (Doctor._id)
      // AND attendingDoctorUserId (the User._id of the doctor's login).
      // Pre-R7bd only attendingDoctorId was set, and consumers that
      // expected User._id (termination cascade, JWT-driven access
      // checks) got a Doctor._id and silently misbehaved (no match →
      // no access → no termination cleanup).
      let attendingDoctorUserId = null;
      if (savedOPD.doctorId) {
        try {
          const Doctor = require("../../models/Doctor/doctorModel");
          const doc = await Doctor.findById(savedOPD.doctorId).select("loginUserId").lean();
          attendingDoctorUserId = doc?.loginUserId || null;
        } catch (_) { /* leave null — doctor may not have a login account */ }
      }

      const admission = await Admission.create({
        UHID:            savedOPD.UHID,
        patientId:       patient._id,
        patientName:     patient.fullName || `${patient.firstName || ""} ${patient.lastName || ""}`.trim() || patient.name,
        contactNumber:   patient.phone || patient.mobile || patient.contactNumber || "N/A",
        admissionType:   "OPD",
        admissionNumber,
        visitNumber:     savedOPD.visitNumber,
        attendingDoctor: savedOPD.consultantName || "",
        attendingDoctorId:     savedOPD.doctorId || null,        // Doctor._id (existing semantics)
        attendingDoctorUserId,                                    // User._id (new, R7bd-A-4)
        department:      savedOPD.department || "",
        departmentId:    savedOPD.departmentId || null,
        reasonForAdmission: savedOPD.chiefComplaint || "OPD Consultation",
        hasBed:          false,
        status:          "Active",
        paymentType:     opdData.paymentType || "GENERAL",
        admissionDate:   savedOPD.visitDate || new Date(),
      });

      // Fire audit trigger: OPD Registration (consultation fee)
      //
      // We AWAIT this now instead of fire-and-forget. Why: the receptionist
      // expects the OPD bill to exist by the time the next screen loads
      // (patient lookup, billing console, etc.). Fire-and-forget meant the
      // trigger materialised the bill ~100ms after the 201 response, and
      // any error inside addItemToBill went to console.error rather than
      // surfacing — so a misconfigured ServiceMaster row would silently
      // drop the entire OPD-CON line item with no breadcrumb on the bill.
      //
      // The cost is small: onOPDRegistered does one createTrigger + one
      // getOrCreateDraftBill + one addItemToBill — sub-100ms locally. The
      // outer try{}catch still keeps registration non-blocking; if billing
      // throws, the patient still gets registered, with the gap logged.
      try {
        const { logErr } = require("../../utils/logErr");
        const autoBilling = require("../Billing/autoBillingService");
        if (autoBilling.onOPDRegistered) {
          try {
            await autoBilling.onOPDRegistered(savedOPD, admission);
          } catch (billErr) {
            logErr("autoBilling", `onOPDRegistered ${savedOPD?._id}`)(billErr);
          }
        }
      } catch (e) {
        const { logErr } = require("../../utils/logErr");
        logErr("autoBilling", "load failure on OPD register")(e);
      }

      savedOPD._admissionId = admission._id; // attach for response
    } catch (admErr) {
      console.error("[OPDService] Failed to create OPD admission record:", admErr.message);
      // Non-fatal — OPD visit still created successfully
    }

    return savedOPD;
  }

  /* ── R7cr: Today's prescriptions for a UHID — Pharmacy fast-lookup ──
     A pharmacist enters a UHID and needs the focused subset:
       • today's OPD visit(s) for this patient
       • diagnosis context (so the pharmacist can sanity-check the Rx)
       • the prescribed medicines list (so they can dispense)
     We project ONLY the fields the pharmacy needs — no SOAP narrative,
     no audit blob, no full investigation order trail. Smaller payload
     keeps the lookup snappy even when the patient has multiple visits
     today (rare but legitimate: morning OPD + afternoon ER conversion).
     Sorted oldest-first so dispense order matches visit order.       */
  async getTodayPrescriptionsByUHID(UHID) {
    if (!UHID) return [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(start); end.setDate(start.getDate() + 1);
    const visits = await OPD.find({
      UHID,
      visitDate: { $gte: start, $lt: end },
    })
      .select(
        "visitNumber visitDate UHID patientId patientName tokenNumber " +
        "department departmentId doctorId consultantName " +
        "chiefComplaint provisionalDiagnosis workingDiagnosis finalDiagnosis " +
        "icd10Code icd10Description patientStatus " +
        "prescribedMedications advice status",
      )
      .populate("departmentId", "departmentName")
      .populate("doctorId", "personalInfo doctorId")
      .populate("patientId", "fullName UHID age gender contactNumber dateOfBirth")
      .sort({ visitDate: 1, tokenNumber: 1 })
      .lean();
    return visits;
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
  async getFollowUpDue(date, opts = {}) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);

    const query = {
      followUpRequired: true,
      followUpDate: { $gte: startDate, $lt: endDate },
    };
    if (opts.doctorId) query.doctorId = opts.doctorId;

    return OPD.find(query).populate("doctorId", "personalInfo");
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
          const { logErr } = require("../../utils/logErr");
          const autoBilling = require("../Billing/autoBillingService");
          if (autoBilling.onOPDVitalsRecorded) {
            autoBilling.onOPDVitalsRecorded(updatedVisit, admission, nurseName).catch(logErr("autoBilling", `onOPDVitalsRecorded ${updatedVisit?._id}`));
          }
        }
      } catch (e) {
        const { logErr } = require("../../utils/logErr");
        logErr("autoBilling", "load failure on OPD vitals")(e);
      }
    }

    return updatedVisit;
  }

  /* ── Doctor saves OPD assessment (SOAP note + diagnosis + plan) ── */
  async saveOPDAssessment(visitNumber, assessmentData, doctorName, doctorUserId = null) {
    // R7bx item 8 — MCI Regulation 1.4.2 compliance. The OPD assessment
    // is "signed" the first time the doctor stamps doctorSignatureImage
    // (the schema doesn't have a separate signed/draft enum — signature
    // presence IS the sign event). On that save, the signing doctor MUST
    // have a non-empty registrationNumber on file. Pre-fix the system
    // signed regardless, and the printed Rx showed "—" where the MCI
    // reg-no belongs.
    const isSigningSave = !!(assessmentData?.doctorSignatureImage &&
      typeof assessmentData.doctorSignatureImage === "string");
    if (isSigningSave && doctorUserId) {
      try {
        const User = require("../../models/User/userModel");
        const actor = await User.findById(doctorUserId).lean();
        if (actor?.role === "Doctor") {
          const regNo = String(actor.doctorDetails?.registrationNumber || "").trim();
          if (!regNo) {
            const err = new Error(
              "Doctor's MCI registration number is missing. Add it in Settings → Doctor Profile before signing.",
            );
            err.statusCode = 400;
            err.code = "MCI_REG_NO_MISSING";
            throw err;
          }
        }
      } catch (e) {
        // Re-throw the typed MCI error; swallow other lookup failures so
        // we don't block legitimate saves when the User collection blips.
        if (e?.code === "MCI_REG_NO_MISSING") throw e;
      }
    }

    // R7bt-PrintAudit-Phase2: The whitelist below USED to silently drop
    // workingDiagnosis, icd10Code, icd10Description, patientStatus, the
    // structured genExam / sysExam sub-docs, and every obg* field — so the
    // doctor saw the values on screen, hit Save, the field was filtered out
    // here, the API returned 200, and on reload the values were gone. The
    // schema has been extended in OPDModels.js and the whitelist mirrors it
    // exactly. Helper below avoids `undefined` overwriting an existing value
    // (so a partial save from the autosave path doesn't blow away a field
    // the doctor entered in a previous save).
    const pick = (val, fallback = "") => (val !== undefined ? val : fallback);

    const update = {
      // ── Free-text examination (string narrative) ──
      generalExamination:    pick(assessmentData.generalExamination),
      systemicExamination:   pick(assessmentData.systemicExamination),
      // ── Structured Gen-Ex / Sys-Ex ──
      // Mongoose accepts the whole nested object on findOneAndUpdate when
      // the schema declares sub-docs; we pass it through verbatim. Empty
      // object fallback keeps the schema's nested defaults intact.
      genExam:               assessmentData.genExam || {},
      sysExam:               assessmentData.sysExam || {},
      // ── Diagnosis (three-tier + ICD-10 + clinical status) ──
      provisionalDiagnosis:  pick(assessmentData.provisionalDiagnosis),
      workingDiagnosis:      pick(assessmentData.workingDiagnosis),
      finalDiagnosis:        pick(assessmentData.finalDiagnosis),
      icd10Code:             pick(assessmentData.icd10Code),
      icd10Description:      pick(assessmentData.icd10Description),
      patientStatus:         pick(assessmentData.patientStatus),
      advice:                pick(assessmentData.advice),
      followUpDate:          assessmentData.followUpDate || null,
      doctorNotes:           pick(assessmentData.doctorNotes),
      // SOAP fields
      subjectiveNote:        pick(assessmentData.subjectiveNote),
      objectiveNote:         pick(assessmentData.objectiveNote),
      assessmentNote:        pick(assessmentData.assessmentNote),
      planNote:              pick(assessmentData.planNote),
      assessedBy:            doctorName || "Doctor",
      assessedAt:            new Date(),
      status:                "Completed",
      // HOPI — structured history
      hopiOnset:              pick(assessmentData.hopiOnset),
      hopiDurationValue:      pick(assessmentData.hopiDurationValue),
      hopiDurationUnit:       pick(assessmentData.hopiDurationUnit),
      hopiProgression:        pick(assessmentData.hopiProgression),
      hopiCharacter:          pick(assessmentData.hopiCharacter),
      hopiAssociatedSymptoms: assessmentData.hopiAssociatedSymptoms || [],
      hopiAggravating:        pick(assessmentData.hopiAggravating),
      hopiRelieving:          pick(assessmentData.hopiRelieving),
      // Chronic illnesses
      chronicConditions:      assessmentData.chronicConditions      || [],
      chronicOthers:          pick(assessmentData.chronicOthers),
      // ── OBG history (flat obg*-prefixed, female / Gynae OPD) ──
      obgLmp:                 pick(assessmentData.obgLmp),
      obgEdd:                 pick(assessmentData.obgEdd),
      obgMenarche:            pick(assessmentData.obgMenarche),
      obgCycleLength:         pick(assessmentData.obgCycleLength),
      obgFlowDays:            pick(assessmentData.obgFlowDays),
      obgRegularity:          pick(assessmentData.obgRegularity),
      obgDysmenorrhea:        pick(assessmentData.obgDysmenorrhea),
      obgMenopause:           pick(assessmentData.obgMenopause),
      obgGravida:             pick(assessmentData.obgGravida),
      obgPara:                pick(assessmentData.obgPara),
      obgAbortion:            pick(assessmentData.obgAbortion),
      obgLiving:              pick(assessmentData.obgLiving),
      obgLastChildBirth:      pick(assessmentData.obgLastChildBirth),
      obgDeliveryMode:        pick(assessmentData.obgDeliveryMode),
      obgObComplications:     pick(assessmentData.obgObComplications),
      obgMarried:             pick(assessmentData.obgMarried),
      obgYearsMarried:        pick(assessmentData.obgYearsMarried),
      obgContraception:       pick(assessmentData.obgContraception),
      obgLastPapSmear:        pick(assessmentData.obgLastPapSmear),
      obgLastUSG:             pick(assessmentData.obgLastUSG),
      obgPriorSurgery:        pick(assessmentData.obgPriorSurgery),
      obgNotes:               pick(assessmentData.obgNotes),
    };

    // ── Doctor's digital signature ────────────────────────────────────
    // R7bu — Only stamp the signature when the caller actually sends one
    // (the doctor signed this save). An empty / missing field MUST NOT
    // overwrite a previously stored signature — that keeps reprints of
    // older visits accurate even if the doctor's cached signature got
    // dropped between sessions. doctorSignedAt is stamped the first time
    // a signature lands on this visit (or refreshed when re-signed).
    if (assessmentData.doctorSignatureImage && typeof assessmentData.doctorSignatureImage === "string") {
      update.doctorSignatureImage = assessmentData.doctorSignatureImage;
      update.doctorSignedAt =
        assessmentData.doctorSignedAt
          ? new Date(assessmentData.doctorSignedAt)
          : new Date();
    }

    // ── Prescription rows (whitelist mealStatus + the rest) ──────────
    // R7bu — addPrescription / OPDAssessment save BOTH go through this
    // service. The schema accepts mealStatus now (Before food / After food
    // / With food / Bedtime) but if a caller sends a `prescribedMedications`
    // array on the assessment save we need to whitelist the field shape so
    // mealStatus reaches disk instead of being silently filtered. Empty
    // array is the no-op fallback (assessment saves usually rely on the
    // separate /prescription POSTs + the bulk DoctorOrders mirror).
    if (Array.isArray(assessmentData.prescribedMedications)) {
      update.prescribedMedications = assessmentData.prescribedMedications.map(m => ({
        medicineName: m.medicineName || m.name      || "",
        dosage:       m.dosage       || m.dose      || "",
        frequency:    m.frequency    || "",
        duration:     m.duration     || "",
        instructions: m.instructions || "",
        mealStatus:   m.mealStatus   || "",
      }));
    }

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
            const { logErr } = require("../../utils/logErr");
            autoBilling.onOPDAssessmentSaved(updatedVisit, admission, doctorName).catch(logErr("autoBilling", `onOPDAssessmentSaved ${updatedVisit?._id}`));
          }
        }
      } catch (e) {
        const { logErr } = require("../../utils/logErr");
        logErr("autoBilling", "load failure on OPD assessment")(e);
      }
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
    // R7bu — Whitelist the row shape so callers that send the frontend's
    // {name, dose, mealStatus, ...} payload (instead of the schema's
    // {medicineName, dosage, ...}) still land cleanly. Mongoose strict
    // mode would otherwise silently drop name/dose on legacy callers.
    // mealStatus is now an accepted field (Before food / After food / With
    // food / Bedtime).
    const m = medication || {};
    const row = {
      medicineName: m.medicineName || m.name      || "",
      dosage:       m.dosage       || m.dose      || "",
      frequency:    m.frequency    || "",
      duration:     m.duration     || "",
      instructions: m.instructions || "",
      mealStatus:   m.mealStatus   || "",
    };
    return OPD.findOneAndUpdate(
      { visitNumber },
      { $push: { prescribedMedications: row } },
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
