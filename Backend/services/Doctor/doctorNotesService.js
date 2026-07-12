// Doctor/Services/doctorNotesService.js
// Business logic — Controller calls these functions

const DoctorNotes = require("../../models/Doctor/DoctorNotesModel");
const Patient = require("../../models/Patient/patientModel");
const Doctor = require("../../models/Doctor/doctorModel");
const TreatmentChart = require("../../models/Doctor/treatmentChartModel");
// R7az-D10: addendum / amend audit rows flow through the hash chain.
const activityLogger = require("../Clinical/activityLogger");

// R7az-D2-CRIT-6 / D10-MED-3: 4-hour window enforcing late-entry flag.
// Anything older needs lateEntry=true AND a non-empty lateEntryReason
// per NABH HIC.6 (backdated documentation justification).
const LATE_ENTRY_WINDOW_MS = 4 * 60 * 60 * 1000;

const VISIT_FIELD_MAP = {
  OPD: "totalOPDVisits",
  Emergency: "totalEmergencyVisits",
  IPD: "totalIPDVisits",
  Daycare: "totalDaycareVisits",
  Services: "totalServicesVisits",
};

// ─────────────────────────────────────────────────────────────
// Create SOAP note with orders
// ─────────────────────────────────────────────────────────────
const createDoctorNote = async (data, doctorUserId, actorRole) => {
  const {
    // patient ref — frontend may send 'patient' or 'patientId'
    patient: patientRef,
    patientId,
    patientName: pName,
    patientUHID,
    ipdNo,
    visitDate,
    shift,
    soap,
    vitals,
    investigations,
    orders,
    provisionalDiagnosis,
    workingDiagnosis,
    finalDiagnosis,
    icd10Code,
    icd10Description,
    patientStatus,
    status,
    // extended NABH fields
    noteType,
    isCritical,
    tags,
    noteDetails,
    // signature
    signature,
    signedByName,
    signedByReg,
    // doctor info (from frontend — fallback if User lookup fails)
    doctorName: dn,
    doctorRegNo: drn,
  } = data;

  const patRef = patientRef || patientId;
  const noteStatus = status || "draft";

  // R7hr-246 (audit: nurse authoring a signed doctor-section note) — this
  // endpoint accepts both doctor- and nursing-section notes (R26/R7hr-120), but
  // a Nurse must NOT be able to author a doctor-section note (diagnosis +
  // physician orders that fan out to the MAR), signed or draft. Block only when
  // the section is explicitly "doctor" so legit nursing-section saves pass.
  const _effSection = data.section || (
    (data.noteDetails?.doctor || data.noteDetails?.nabh) ? "doctor" :
    (data.noteDetails?.nursing || data.noteDetails?.nursingNabh) ? "nursing" :
    null
  );
  if (actorRole === "Nurse" && _effSection === "doctor") {
    const e = new Error("Nurses may only author nursing-section notes — doctor-section notes (diagnosis / orders) must be authored by a doctor.");
    e.code = "NURSE_CANNOT_AUTHOR_DOCTOR_NOTE";
    e.status = 403;
    throw e;
  }

  // R7az-D2-CRIT-6: late-entry gate (NABH HIC.6). If the clinical
  // visitDate is more than 4 hours behind the wall clock, the caller
  // MUST flag this as a retroactive entry with a documented reason.
  // Server-side derivation — never trust the client to set lateEntry.
  const clinicalTs = visitDate ? new Date(visitDate).getTime() : Date.now();
  const ageMs = Date.now() - clinicalTs;
  let lateEntry       = !!data.lateEntry;
  let lateEntryReason = (data.lateEntryReason || "").trim();
  let lateEntryAt     = null;
  if (ageMs > LATE_ENTRY_WINDOW_MS) {
    lateEntry = true;
    if (!lateEntryReason) {
      const err = new Error(
        `Late-entry note (visit >4h ago) requires lateEntryReason — NABH HIC.6 backdated-entry justification`,
      );
      err.statusCode = 400;
      throw err;
    }
    lateEntryAt = new Date();
  }

  // Resolve doctor info from User model (app uses User, not old Doctor model)
  let doctorName = dn || "";
  let doctorRegNo = drn || "";
  let doctorEmpId = "";
  let doctorObjectId = null;
  try {
    const User = require("../../models/User/userModel");
    const userDoc = await User.findById(doctorUserId).lean();
    if (userDoc) {
      doctorName = userDoc.fullName || `${userDoc.firstName || ""} ${userDoc.lastName || ""}`.trim() || dn || "";
      doctorRegNo = userDoc.doctorDetails?.registrationNumber || drn || "";
      // R7go — Denormalize employeeId so every signed note is traceable to
      // a specific staff record without a User join. Surfaced in the
      // patient panel + Complete File signature footer.
      doctorEmpId = userDoc.employeeId || "";
      doctorObjectId = userDoc._id;
    }
  } catch (_) { /* use data sent from frontend */ }

  // R7bv — Resolve the patient's active admission so we can:
  //   1) stamp admissionId on the note (the index references it),
  //   2) derive ipdNo from admission.admissionNumber when the caller
  //      didn't pass it.
  // Pre-R7bv the fallback was `ipdNo: ipdNo || patientUHID || "N/A"` — so
  // 5 of 9 notes for UH00000029 landed with ipdNo:"UH00000029" instead of
  // "ADM26050002", and the patient-history aggregator's `{ipdNo}` filter
  // (which expects the admissionNumber) silently dropped them. The
  // correct fallback chain is admission.admissionNumber → caller's
  // admissionNumber → visitId → null. NEVER fall back to the UHID.
  let resolvedAdmissionId     = data.admissionId || null;
  let resolvedAdmissionNumber = data.admissionNumber || null;
  let resolvedIpdNo           = ipdNo || null;
  try {
    if ((!resolvedAdmissionId || !resolvedIpdNo) && patientUHID) {
      const Admission = require("../../models/Patient/admissionModel");
      const adm = await Admission.findOne({
        UHID: patientUHID, status: "Active",
      }).select("_id admissionNumber").lean();
      if (adm) {
        resolvedAdmissionId     = resolvedAdmissionId     || adm._id;
        resolvedAdmissionNumber = resolvedAdmissionNumber || adm.admissionNumber || null;
        resolvedIpdNo           = resolvedIpdNo || adm.admissionNumber || resolvedAdmissionNumber || null;
      }
    }
  } catch (_) { /* non-fatal */ }
  // Final fallback for ipdNo — NEVER UHID. visitId is acceptable because
  // for IPD admissions the frontend passes the admissionNumber as visitId.
  const finalIpdNo = resolvedIpdNo || resolvedAdmissionNumber || data.visitId || "N/A";

  // R7hr-88 + R7hr-116 — ONE Initial Assessment per ROLE per admission.
  // After R26 split, Doctor IA and Nurse IA are SEPARATE records both
  // with noteType: "initial". The dedupe filter MUST include section so
  // a signed Doctor IA doesn't block the Nurse from saving hers (and
  // vice versa). Legacy pre-R26 notes have no section field — we
  // infer it from noteDetails.doctor.* / noteDetails.nursing.* below.
  if (noteType === "initial") {
    const incomingSection = data.section || (
      (data.noteDetails?.doctor || data.noteDetails?.nabh) ? "doctor" :
      (data.noteDetails?.nursing || data.noteDetails?.nursingNabh) ? "nursing" :
      null
    );
    const dupOr = [];
    if (resolvedAdmissionId) dupOr.push({ admissionId: resolvedAdmissionId });
    if (finalIpdNo && finalIpdNo !== "N/A") dupOr.push({ ipdNo: finalIpdNo });
    if (dupOr.length) {
      const candidates = await DoctorNotes.find({
        noteType: "initial",
        $or: dupOr,
      }).select("_id status signedByName signedAt section noteDetails").lean();
      // Pick the candidate that matches the SAME role
      const sameSection = candidates.find(c => {
        const cSection = c.section || (
          (c.noteDetails?.doctor || c.noteDetails?.nabh) ? "doctor" :
          (c.noteDetails?.nursing || c.noteDetails?.nursingNabh) ? "nursing" :
          null
        );
        return cSection && incomingSection && cSection === incomingSection;
      });
      if (sameSection) {
        const e = new Error(
          `${incomingSection === "nursing" ? "Nursing" : "Doctor"} Initial Assessment already exists for this admission — use Amend instead.`,
        );
        e.code = "DUPLICATE_INITIAL_ASSESSMENT";
        e.statusCode = 409;
        e.existing = sameSection;
        throw e;
      }
    }
  }

  const note = await DoctorNotes.create({
    patient: patRef || undefined,
    patientName: pName || "",
    patientUHID: patientUHID || "",
    ipdNo: finalIpdNo,
    admissionId: resolvedAdmissionId || undefined,
    visitDate: visitDate || Date.now(),
    shift: shift || "morning",
    doctor: doctorObjectId || doctorUserId || undefined,
    doctorName,
    doctorRegNo,
    doctorEmpId,
    soap,
    vitals,
    investigations: investigations || [],
    orders: (orders || []).map((o) => ({ ...o, nurseStatus: o.nurseStatus || "pending" })),
    provisionalDiagnosis,
    workingDiagnosis,
    finalDiagnosis,
    icd10Code,
    icd10Description,
    patientStatus,
    status: noteStatus,
    noteType,
    isCritical: isCritical || false,
    tags: tags || [],
    noteDetails: noteDetails || {},
    // R7hr-118 — persist section so the partial-unique indexes
    // (uniq_initial_per_admission_section / uniq_initial_per_ipdNo_section)
    // can actually enforce per-role uniqueness in the DB. If the caller
    // didn't pass one, fall back to the same inference the dedupe uses.
    section: data.section || (
      (noteDetails?.doctor || noteDetails?.nabh) ? "doctor" :
      (noteDetails?.nursing || noteDetails?.nursingNabh) ? "nursing" :
      null
    ),
    signature,
    signedByName,
    signedByReg,
    createdBy: doctorObjectId || doctorUserId || undefined,
    // Late-entry stamps (R7az-D2-CRIT-6)
    lateEntry,
    lateEntryReason: lateEntry ? lateEntryReason : undefined,
    lateEntryAt:     lateEntry ? lateEntryAt     : undefined,
  });

  // R7bx-3 — Auto-populate NABH COP.13 Anaesthesia (ASA) register when
  // a procedure / preop / postop / operative note is saved with an ASA
  // grade. The emitter no-ops if the note doesn't carry asaGrade I-VI
  // (either at top level or under noteDetails), so it's safe to call on
  // every note save and only fires when there's something to record.
  // Procedure notes update the same row (idempotent by sourceRef=noteId);
  // a separate preop note will create its own row.
  if (note && ["procedure", "preop", "postop", "operative"].includes(note.noteType)) {
    try {
      const { emitASA } = require("../Compliance/nabhRegisterEmitter");
      const Patient = require("../../models/Patient/patientModel");
      const Admission = require("../../models/Patient/admissionModel");
      // Lift ASA grade out of noteDetails for the emitter — the model
      // stores procedure-specific fields under noteDetails (free-form
      // Mixed schema), while the emitter looks for `note.asaGrade` or
      // `note.data.asaGrade`. Pass a shallow shim so we don't have to
      // touch the underlying note document.
      const noteForEmit = {
        ...note.toObject(),
        asaGrade: noteDetails?.asaGrade || noteDetails?.ASAGrade || "",
        data: noteDetails || {},
      };
      const patient = note.patient
        ? await Patient.findById(note.patient).select("_id UHID fullName name age gender sex").lean()
        : null;
      const admission = note.admissionId
        ? await Admission.findById(note.admissionId).select("_id admissionNumber").lean()
        : null;
      emitASA({
        note: noteForEmit,
        patient: patient || { _id: note.patient, UHID: note.patientUHID, fullName: note.patientName },
        admission,
        actor: { _id: doctorObjectId || doctorUserId, fullName: doctorName, role: "Doctor" },
      }).catch((e) => console.error("[doctorNotes] emitASA error:", e?.message));
    } catch (e) {
      console.error("[doctorNotes] ASA emit wiring failed:", e?.message);
    }
  }

  // R7hr-96 + R7hr-97 — fan-out trio for create-and-sign-in-one-shot
  // (the IA submit path that bypasses the separate sign step):
  //   medRecon Continue rows → DoctorOrder Medication
  //   meds[]                 → DoctorOrder Medication (courseDays/endDate from `duration`; blank = open-ended)
  //   infusions[]            → DoctorOrder IV_Fluid (nurse Infusion Orders & Monitoring tab)
  // All three idempotent on sourceRef so a later signDoctorNote won't
  // double-create. No-op while the note is still draft — sign fires the
  // fan-out in that case.
  if (note && note.noteType === "initial" && note.status === "signed") {
    try {
      const fanOuts = require("./medReconFanOut");
      fanOuts.fanOutMedReconToDoctorOrders(note).catch(e => console.error("[doctorNotes] medRecon fan-out error:", e?.message));
      fanOuts.fanOutMedsToDoctorOrders(note).catch(e     => console.error("[doctorNotes] meds fan-out error:", e?.message));
      fanOuts.fanOutInfusionsToDoctorOrders(note).catch(e=> console.error("[doctorNotes] infusion fan-out error:", e?.message));
    } catch (e) {
      console.error("[doctorNotes] IA fan-out wiring failed:", e?.message);
    }
  }

  // R7em-7 — Auto-populate NABH COP.18 Mortality Register when a death
  // note is saved. emitMortality is idempotent on admissionId (unique
  // index in the model), so a draft-then-sign sequence won't double-emit.
  // Death-note fields live in noteDetails (Mixed schema), so we lift
  // them onto the deathNote shim — the emitter reads dateTime,
  // causeDeath1, modeOfDeath, etc. directly (R7em-7 aliases).
  if (note && note.noteType === "death") {
    try {
      const { emitMortality } = require("../Compliance/nabhRegisterEmitter");
      const Patient = require("../../models/Patient/patientModel");
      const Admission = require("../../models/Patient/admissionModel");
      const deathNoteForEmit = {
        ...note.toObject(),
        ...(noteDetails || {}),
        admissionId: note.admissionId,
      };
      const patient = note.patient
        ? await Patient.findById(note.patient).select("_id UHID fullName name age gender sex").lean()
        : null;
      const admission = note.admissionId
        ? await Admission.findById(note.admissionId).select("_id admissionNumber admissionDate attendingDoctor attendingDoctorId isMLC mlcNumber").lean()
        : null;
      emitMortality({
        deathNote: deathNoteForEmit,
        patient: patient || { _id: note.patient, UHID: note.patientUHID, fullName: note.patientName },
        admission,
        actor: { _id: doctorObjectId || doctorUserId, fullName: doctorName, role: "Doctor" },
      }).catch((e) => console.error("[doctorNotes] emitMortality error:", e?.message));
    } catch (e) {
      console.error("[doctorNotes] Mortality emit wiring failed:", e?.message);
    }
  }

  return note;
};

// ─────────────────────────────────────────────────────────────
// Sign draft → orders visible to nurse + push to TreatmentChart
// ─────────────────────────────────────────────────────────────
const signDoctorNote = async (noteId, doctorUserId, signaturePayload = {}, req = null) => {
  // R7bn-2 / D10-fix: do a pre-check via .lean() to validate ownership
  // and signer identity, then perform the transition with an atomic
  // CAS-style findOneAndUpdate that ONLY matches docs still in "draft"
  // status. If two clients sign at once, only one wins — the second
  // gets null back and we tell the caller the note was already signed.
  const noteDraft = await DoctorNotes.findById(noteId).lean();
  if (!noteDraft) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  if (noteDraft.status === "signed") {
    const error = new Error("Note already signed");
    error.statusCode = 400;
    throw error;
  }
  if (!noteDraft.doctor && !doctorUserId) {
    const error = new Error("Cannot sign — no doctor user context");
    error.statusCode = 401;
    throw error;
  }

  // FIX (audit P11-B3): resolve the signer's identity once and stamp the
  // note. Previously signedByName / signedByReg / signature were only ever
  // set on the create path; sign-later notes finalised with empty fields
  // and the printed copy looked unsigned in court / audit review.
  //
  // R7bx item 8 — MCI Regulation 1.4.2 compliance. We ALWAYS resolve the
  // signing user (not just when name/reg are blank) and HARD-BLOCK if the
  // signer is a Doctor whose doctorDetails.registrationNumber is empty.
  // Pre-fix the system signed anyway and the printed Rx showed "—" where
  // the reg-no belongs — illegal under MCI 1.4.2.
  let signedByName = signaturePayload.signedByName || noteDraft.signedByName || "";
  let signedByReg  = signaturePayload.signedByReg  || noteDraft.signedByReg  || "";
  // R7go — Capture the signer's hospital employee ID for the audit trail.
  // Resolved server-side from actorUser below; never trust a client value.
  let signedByEmpId = "";
  let actorUser = null;
  if (doctorUserId) {
    try {
      const User = require("../../models/User/userModel");
      actorUser = await User.findById(doctorUserId).lean();
    } catch (_) { /* surface as missing-reg below */ }
  }

  // R7fw-FIX1 — Handover-sign policy. Pre-fix only the EXACT note author
  // could sign; this 403'd consultants signing a resident's draft, or
  // admins overriding a stale draft after a doctor's shift ended.
  // Real-world rule: anyone with clinical-write privilege should be able
  // to sign a colleague's draft AS LONG AS we record the original author
  // and the signer separately on the doc + emit a richer audit entry.
  //
  // Allowed signers (in priority order):
  //   1. The original author              (same person — straight-through)
  //   2. Admin role                       (administrative override)
  //   3. Any Doctor with a valid MCI reg  (peer hand-over / consultant
  //                                        signing for a resident)
  //
  // Anyone else still gets 403. The MCI-reg requirement below in the
  // Doctor-role block applies uniformly to authors AND handover-signers
  // — no shortcut around R7bx Reg 1.4.2.
  const isAuthor = !!noteDraft.doctor && !!doctorUserId
                   && noteDraft.doctor.toString() === doctorUserId.toString();
  const canHandoverSign = !isAuthor && actorUser
                          && (actorUser.role === "Admin" || actorUser.role === "Doctor");
  if (noteDraft.doctor && doctorUserId && !isAuthor && !canHandoverSign) {
    const error = new Error("Not authorised to sign this note");
    error.statusCode = 403;
    throw error;
  }
  // When a different signer takes over, capture the original author's
  // name so the print signature row reads
  //   "Signed by Dr. X (Reg …) on behalf of Dr. Y"
  // (the front-end's signature renderer keys off `handoverFromName`).
  let handoverFromName = "";
  if (canHandoverSign && noteDraft.doctor) {
    try {
      const User = require("../../models/User/userModel");
      const origAuthor = await User.findById(noteDraft.doctor).lean();
      if (origAuthor) {
        handoverFromName = origAuthor.fullName
                           || [origAuthor.firstName, origAuthor.lastName].filter(Boolean).join(" ")
                           || noteDraft.signedByName
                           || "";
      }
    } catch (_) { /* non-fatal — fall back to blank */ }
  }
  if (actorUser?.role === "Doctor") {
    // R7fp — MCI reg-no can live in several places depending on how the
    // user was provisioned. Pre-fix we only checked `doctorDetails.
    // registrationNumber` and false-positive blocked doctors whose
    // reg-no was on the linked Doctor profile or a sibling field. Accept
    // any of: User.doctorDetails.registrationNumber, User.medicalRegNo,
    // User.registrationNumber, or Doctor.professional.registrationNumber
    // (looked up by Doctor.user → actorUser._id).
    let regNo = String(
      actorUser.doctorDetails?.registrationNumber ||
      actorUser.medicalRegNo ||
      actorUser.registrationNumber ||
      "",
    ).trim();
    if (!regNo) {
      try {
        const Doctor = require("../../models/Doctor/doctorModel");
        const docProfile = await Doctor.findOne({ user: actorUser._id })
          .select("professional.registrationNumber regNo")
          .lean();
        regNo = String(
          docProfile?.professional?.registrationNumber ||
          docProfile?.regNo ||
          "",
        ).trim();
      } catch (_) { /* fall through to missing-reg error */ }
    }
    if (!regNo) {
      const err = new Error(
        "Doctor's MCI registration number is missing. Add it in Settings → Doctor Profile before signing.",
      );
      err.statusCode = 400;
      err.code = "MCI_REG_NO_MISSING";
      throw err;
    }
    // Server-side overwrite so the print signature row is authoritative
    // (and not a client-spoofed value coming through signaturePayload).
    signedByReg  = regNo;
    signedByName = signedByName || actorUser.fullName ||
      `${actorUser.firstName || ""} ${actorUser.lastName || ""}`.trim();
    signedByEmpId = actorUser.employeeId || "";
  } else if (actorUser && (!signedByName || !signedByReg)) {
    // Non-doctor actor or pre-existing missing fields — best-effort fallback.
    signedByName = signedByName || actorUser.fullName ||
      `${actorUser.firstName || ""} ${actorUser.lastName || ""}`.trim();
    signedByReg  = signedByReg  || actorUser.doctorDetails?.registrationNumber || "";
    signedByEmpId = signedByEmpId || actorUser.employeeId || "";
  } else if (actorUser) {
    // Author flow that already had name+reg pre-populated — still capture
    // employeeId server-side for traceability.
    signedByEmpId = actorUser.employeeId || "";
  }

  // R7bn-2 / D10-fix: status-guarded atomic transition. The `status:
  // "draft"` predicate in the query ensures only ONE concurrent signer
  // wins — the second's findOneAndUpdate returns null, we surface a
  // 409 to the caller. Pre-fix, two doctors signing at once both got
  // 200 OK, the TreatmentChart helper ran twice, and the auto-billing
  // double-fired (idempotency saved us at the bill layer but the
  // duplicate signature legs in the audit trail were real).
  const signFields = {
    status: "signed",
    signedAt: new Date(),
    signedByName,
    signedByReg,
    // R7go — Persisted on the note so the panel + print can render
    // "Emp ID: DOC-26-00001" without a User collection lookup.
    signedByEmpId,
    updatedBy: doctorUserId,
  };
  if (!noteDraft.doctor && doctorUserId) signFields.doctor = doctorUserId;
  if (signaturePayload.signature) signFields.signature = signaturePayload.signature;
  // R7fw-FIX1 — when this is a handover-sign, record the original author's
  // name so the print signature row and the audit trail both make the
  // delegation explicit. Stamped flat (handoverFromName) so legacy code
  // that reads .signedByName keeps working.
  if (canHandoverSign && handoverFromName) {
    signFields.handoverFromName = handoverFromName;
  }

  const note = await DoctorNotes.findOneAndUpdate(
    { _id: noteId, status: "draft" },
    { $set: signFields },
    { new: true, runValidators: true },
  );
  if (!note) {
    const error = new Error("Note already signed by another user");
    error.statusCode = 409;
    throw error;
  }

  // FIX (audit P11-B4): addDoctorOrders dedupe — the TreatmentChart helper
  // is idempotent by order._id under the hood, but if a note ever gets
  // re-signed (signed → amended → signed flow) we mark the orders as
  // already-chart-pushed to avoid duplicate medication schedule rows.
  if (note.orders?.length && !note._ordersPushedToChart) {
    await TreatmentChart.addDoctorOrders(note);
    note._ordersPushedToChart = true; // transient — won't persist, but guards in-process dupes
  }

  // R7hr-96 + R7hr-97 — fan out IA payloads into standalone DoctorOrder
  // rows so the MAR / Treatment Chart picks them up automatically:
  //   1. Med Recon "Continue" rows           → DoctorOrder Medication
  //   2. Prescription/Medications panel rows → DoctorOrder Medication
  //      (with courseDays/endDate from `duration`; blank = open-ended,
  //       i.e. no auto-discontinue — the doctor must Discontinue)
  //   3. Infusion/IV Fluids panel rows       → DoctorOrder IV_Fluid
  //      (lands in the nurse's Infusion Orders & Monitoring tab)
  // All three are idempotent by sourceRef so re-sign/amend doesn't
  // double-create. Failures are logged but never block the sign.
  if (note.noteType === "initial") {
    try {
      const fanOuts = require("./medReconFanOut");
      const { logErr } = require("../../utils/logErr");
      const summary = {};
      try { summary.medRecon  = await fanOuts.fanOutMedReconToDoctorOrders(note); } catch (e) { logErr("medReconFanOut", `note ${note._id}`)(e); }
      try { summary.meds      = await fanOuts.fanOutMedsToDoctorOrders(note);     } catch (e) { logErr("iaMedsFanOut",  `note ${note._id}`)(e); }
      try { summary.infusions = await fanOuts.fanOutInfusionsToDoctorOrders(note);} catch (e) { logErr("iaInfusionFanOut", `note ${note._id}`)(e); }
      // R7hr-110 — Investigation fan-out so the nurse sees lab orders on her queue.
      try { summary.invests   = await fanOuts.fanOutInvestsToDoctorOrders(note);  } catch (e) { logErr("iaInvestsFanOut", `note ${note._id}`)(e); }
      // R7hr-109 — Backfill Admission.reasonForAdmission + provisionalDiagnosis
      // from the signed Doctor IA so the Admission Summary card / banner /
      // discharge summary header all stop showing "—". Idempotent + only fills
      // blanks (never overwrites a value the receptionist already typed).
      try { summary.admBackfill = await fanOuts.backfillAdmissionFromIA(note);    } catch (e) { logErr("backfillAdmissionFromIA", `note ${note._id}`)(e); }
      // R7hr-119 — Flip admission.initialAssessment.{role}Completed when the IA
      // is signed. The Patient Panel / DoctorNotes / NursingNotes pages read
      // these gate flags to unlock the day-2 tiles (R7hr-95 / R7hr-100). The
      // sign flow previously only wrote noteDetails + signedAt fields and left
      // the admission flag at its admission-time default (false), so the
      // panel hid the Nurse IA section even after a signed nurse note existed.
      try {
        if (note.admissionId && note.section) {
          const Admission = require("../../models/Patient/admissionModel");
          const setFields = {};
          if (note.section === "doctor") {
            setFields["initialAssessment.doctorCompleted"]   = true;
            setFields["initialAssessment.doctorCompletedAt"] = note.signedAt || new Date();
            setFields["initialAssessment.doctorName"]        = note.signedByName || note.doctorName || "";
          } else if (note.section === "nursing") {
            setFields["initialAssessment.nurseCompleted"]    = true;
            setFields["initialAssessment.nurseCompletedAt"]  = note.signedAt || new Date();
            setFields["initialAssessment.nurseName"]         = note.signedByName || note.doctorName || "";
          }
          if (Object.keys(setFields).length) {
            summary.gateFlag = await Admission.updateOne(
              { _id: note.admissionId },
              { $set: setFields },
            );
          }
        }
      } catch (e) { logErr("iaGateFlag", `note ${note._id}`)(e); }
      try { logErr("iaFanOut", `note ${note._id} ${JSON.stringify(summary)}`)(null); } catch (_) {}
    } catch (err) {
      const { logErr } = require("../../utils/logErr");
      logErr("iaFanOut", `signDoctorNote fan-out failed for note ${note?._id}`)(err);
    }
  }

  // FIX (audit P11-B5): auto-billing was only fired on create. Notes that
  // were saved as draft and signed later never produced a consultation
  // charge. Fire here too — the billing service already de-dupes daily.
  try {
    const { logErr } = require("../../utils/logErr");
    const autoBilling = require("../../services/Billing/autoBillingService");
    autoBilling.onDoctorNoteSaved(note).catch(logErr("autoBilling", `onDoctorNoteSaved ${note?._id}`));
  } catch (e) {
    const { logErr } = require("../../utils/logErr");
    logErr("autoBilling", "load failure on doctor-note service save")(e);
  }

  // R7bn-1 / D9-fix: emit ClinicalAudit row for the NABH AAC.7 trail.
  // Sign is the highest-stakes event on a doctor note (legal attestation),
  // so this row gets the 7-year retention floor.
  try {
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
    emitClinicalAudit({
      req,
      event: "DOCTOR_NOTE_SIGNED",
      UHID: note.patientUHID || note.UHID,
      admissionId: note.admissionId,
      patientId: note.patientId,
      patientName: note.patientName,
      targetType: "DoctorNote",
      targetId: note._id,
      after: {
        noteType: note.noteType,
        signedAt: note.signedAt,
        signedByName,
        signedByReg,
      },
    });
  } catch (_) { /* silent — audit emit is non-blocking */ }

  // R7bn-5 / D6-fix: count the signed doctor note as a "doctor-progress"
  // assessment for twice-daily compliance tracking.
  if (note.admissionId) {
    try {
      const { recordAssessment } = require("../Compliance/assessmentComplianceService");
      recordAssessment({
        admissionId: note.admissionId,
        UHID: note.patientUHID || note.UHID,
        patientName: note.patientName,
        assessmentType: "doctor-progress",
        role: "doctor",
        actor: req?.user || { _id: doctorUserId, name: signedByName },
      }).catch(() => {});
    } catch (_) { /* silent */ }
  }

  // R7em-7 — Mortality emit on sign-later flow. Death notes are often
  // created as drafts during the resuscitation and signed once the
  // attending verifies the clinical sequence. The create-path emit
  // (above) handles save-and-sign-in-one-go; this branch covers the
  // draft-then-sign sequence. emitMortality is idempotent on admissionId
  // so the second call returns the existing row without duplicating.
  if (note.noteType === "death") {
    try {
      const { emitMortality } = require("../Compliance/nabhRegisterEmitter");
      const Patient = require("../../models/Patient/patientModel");
      const Admission = require("../../models/Patient/admissionModel");
      const deathNoteForEmit = {
        ...note.toObject(),
        ...(note.noteDetails || {}),
        admissionId: note.admissionId,
      };
      const patient = note.patient
        ? await Patient.findById(note.patient).select("_id UHID fullName name age gender sex").lean()
        : null;
      const admission = note.admissionId
        ? await Admission.findById(note.admissionId).select("_id admissionNumber admissionDate attendingDoctor attendingDoctorId isMLC mlcNumber").lean()
        : null;
      emitMortality({
        deathNote: deathNoteForEmit,
        patient: patient || { _id: note.patient, UHID: note.patientUHID, fullName: note.patientName },
        admission,
        actor: req?.user || { _id: doctorUserId, fullName: signedByName, role: "Doctor" },
      }).catch((e) => console.error("[doctorNotes] emitMortality (sign) error:", e?.message));
    } catch (e) {
      console.error("[doctorNotes] Mortality emit wiring (sign) failed:", e?.message);
    }
  }

  return note;
};

// ─────────────────────────────────────────────────────────────
// Get all pending orders — nurse fetches this
// ─────────────────────────────────────────────────────────────
const getPendingOrders = async (ipdNo) => {
  return DoctorNotes.getAllPendingOrders(ipdNo);
};

// ─────────────────────────────────────────────────────────────
// Get notes by patient
// ─────────────────────────────────────────────────────────────
const getNotesByPatient = async (patientId, query) => {
  const { page = 1, limit = 20, shift, status } = query;
  const filter = { patient: patientId };
  if (shift) filter.shift = shift;
  if (status) filter.status = status;

  const [notes, total] = await Promise.all([
    DoctorNotes.find(filter)
      .populate(
        "doctor",
        "personalInfo.fullName doctorId professional.registrationNumber",
      )
      .populate("department", "departmentName")
      .sort({ visitDate: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .lean(),
    DoctorNotes.countDocuments(filter),
  ]);

  return { notes, total, page: +page, pages: Math.ceil(total / +limit) };
};

// ─────────────────────────────────────────────────────────────
// Get notes by ipdNo
// ─────────────────────────────────────────────────────────────
const getNotesByIPD = async (ipdNo) => {
  return DoctorNotes.find({ ipdNo })
    .populate("doctor", "personalInfo.fullName doctorId")
    .populate("department", "departmentName")
    .sort({ visitDate: -1 })
    .lean();
};

// ─────────────────────────────────────────────────────────────
// Get single note
// ─────────────────────────────────────────────────────────────
const getNoteById = async (id) => {
  const note = await DoctorNotes.findById(id)
    .populate(
      "patient",
      "fullName UHID age gender dateOfBirth contactNumber registrationType",
    )
    .populate("doctor", "personalInfo doctorId professional.registrationNumber")
    .populate("department", "departmentName")
    .populate("orders.nurseConfirmedBy", "personalInfo.fullName staffId");

  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  return note;
};

// ─────────────────────────────────────────────────────────────
// Update note — drafts mutate in place; SIGNED notes spawn an
// append-only ADDENDUM document (R7az-D2-HIGH-4 / NABH HIC.7).
// The original signed doc stays untouched; the new addendum carries
// originalNoteId + supersedesNoteId so a UI consumer can walk the
// chain forward and present the "latest version" while preserving
// the legal history.
// ─────────────────────────────────────────────────────────────
const updateDoctorNote = async (id, data, doctorUserId) => {
  const note = await DoctorNotes.findById(id);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  // R7hr-250 (audit: null-author ownership bypass) — when note.doctor is null
  // (legacy pre-author-tracking notes) the ownership check below was skipped,
  // letting any clinical-write user mutate/addendum it. A note with no recorded
  // owner is locked here (read-only); legitimate corrections go via an explicit
  // admin path.
  if (!note.doctor) {
    const error = new Error("This legacy note has no recorded author and cannot be amended here.");
    error.statusCode = 403;
    error.code = "NOTE_NO_OWNER";
    throw error;
  }
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised");
    error.statusCode = 403;
    throw error;
  }

  const allowed = [
    "soap",
    "vitals",
    "investigations",
    "orders",
    "provisionalDiagnosis",
    "workingDiagnosis",
    "finalDiagnosis",
    "icd10Code",
    "icd10Description",
    "shift",
    // R7hr(EMER-IA): per-type specifics live under noteDetails (ICU vent
    // settings, procedure record, emergency assessment…). The create path
    // has always persisted it, but re-saving a draft dropped every
    // noteDetails change — the ER page's second "Save Draft" silently
    // reverted the assessment to its first-save content.
    "noteDetails",
  ];

  if (note.status === "signed") {
    // ── ADDENDUM path: clone the signed note, apply changes, link.
    const base = note.toObject();
    delete base._id;
    delete base.__v;
    delete base.createdAt;
    delete base.updatedAt;
    delete base.signedAt; // addendum signs later if/when the doctor signs it
    // Strip fields that must not be cloned wholesale
    base.signature = undefined;
    // Apply mutations
    allowed.forEach((f) => {
      if (data[f] !== undefined) base[f] = data[f];
    });
    base.status         = "amended";
    base.noteType       = base.noteType || "amendment";
    base.isAddendum     = true;
    base.originalNoteId = note.originalNoteId || note._id;
    base.supersedesNoteId = note._id;
    base.createdBy      = doctorUserId || base.createdBy;
    base.updatedBy      = doctorUserId || base.updatedBy;
    const addendum = await DoctorNotes.create(base);

    // Audit row for the amend so the chain captures it.
    activityLogger.log({
      UHID: note.patientUHID || "",
      patientId: note.patient || null,
      ipdNo: note.ipdNo || "",
      action: "amend",
      module: "DoctorNote",
      sourceModel: "DoctorNotes",
      sourceId: addendum._id,
      summary: `Addendum to doctor note ${note._id} (signed → amended)`,
      userId: doctorUserId || null,
      before: { _id: note._id, status: note.status },
      after:  { _id: addendum._id, supersedesNoteId: note._id, originalNoteId: addendum.originalNoteId, status: "amended" },
    }).catch((e) => console.error("[doctorNotes] amend audit-log failed:", e.message));

    return addendum;
  }

  // ── DRAFT path: mutate in place
  allowed.forEach((f) => {
    if (data[f] !== undefined) note[f] = data[f];
  });
  note.updatedBy = doctorUserId;
  await note.save();
  return note;
};

// ─────────────────────────────────────────────────────────────
// Update diagnosis fields only — works on signed notes too (NABH amendment).
// R7az-D2-CRIT-3: replace findByIdAndUpdate with load + .save() so the
// status guard fires. Signed notes are flipped to "amended" and an
// audit row is appended; this matches the existing addendum pattern
// but without spawning a fresh document (callers explicitly ask for
// in-place diagnosis revisions per NABH HIC.7 minor-correction rules).
// ─────────────────────────────────────────────────────────────
const updateDiagnosis = async (id, data, actor = {}) => {
  // R7bo-LIVE-fix-v2: switch to findOneAndUpdate to avoid validating
  // unchanged fields. Pre-fix: a stale `{}` value on note.updatedBy
  // from a prior failed save would trigger BSONError on every
  // subsequent `note.save()` even though we weren't touching updatedBy.
  // findOneAndUpdate with `runValidators: true` only validates the
  // fields in the $set payload, side-stepping the corrupted column.
  const mongoose = require("mongoose");
  const before = await DoctorNotes.findById(id).lean();
  if (!before) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  const $set = {};
  const diagFields = ["provisionalDiagnosis", "workingDiagnosis", "finalDiagnosis", "icd10Code", "icd10Description"];
  diagFields.forEach((f) => { if (data[f] !== undefined) $set[f] = data[f]; });

  if (before.status === "signed") {
    $set.status = "amended";
  }

  const actorId = actor?.id || actor?._id;
  if (actorId && typeof actorId === "string" && mongoose.isValidObjectId(actorId)) {
    $set.updatedBy = actorId;
  } else if (typeof actor === "string" && mongoose.isValidObjectId(actor)) {
    $set.updatedBy = actor;
  }

  // Belt-and-braces: also $unset updatedBy if the existing field is
  // an invalid value left over from a pre-fix save attempt.
  const $unset = {};
  if (before.updatedBy != null && !mongoose.isValidObjectId(before.updatedBy) && !$set.updatedBy) {
    $unset.updatedBy = "";
  }

  const updateOp = Object.keys($unset).length ? { $set, $unset } : { $set };
  // R7bo-LIVE-fix-v4: bypass Mongoose's cast pipeline entirely by
  // going to the raw collection. Mongoose's findOneAndUpdate ALWAYS
  // casts every field in $set against the schema and ALSO validates
  // existing fields (despite runValidators:false default). When a
  // pre-fix save left `updatedBy: {}` on a note, every subsequent
  // Mongoose update on that doc errored before our $set could land.
  // Raw collection ops skip both the cast and validation, so the
  // diagnosis update succeeds and any next read of the doc through
  // Mongoose will project a fresh shape.
  const rawCol = DoctorNotes.collection;
  const _id = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
  await rawCol.updateOne({ _id }, updateOp);
  const note = await DoctorNotes.findById(id);

  activityLogger.log({
    UHID: note.patientUHID || "",
    patientId: note.patient || null,
    ipdNo: note.ipdNo || "",
    action: "amend",
    module: "DoctorNote",
    area: "diagnosis",
    sourceModel: "DoctorNotes",
    sourceId: note._id,
    summary: `Diagnosis amended on note ${note._id}`,
    userId: actor?.id || null,
    userName: actor?.name || "",
    userRole: actor?.role || "",
    before: {
      provisionalDiagnosis: before.provisionalDiagnosis,
      workingDiagnosis:     before.workingDiagnosis,
      finalDiagnosis:       before.finalDiagnosis,
      icd10Code:            before.icd10Code,
      icd10Description:     before.icd10Description,
      status:               before.status,
    },
    after: {
      provisionalDiagnosis: note.provisionalDiagnosis,
      workingDiagnosis:     note.workingDiagnosis,
      finalDiagnosis:       note.finalDiagnosis,
      icd10Code:            note.icd10Code,
      icd10Description:     note.icd10Description,
      status:               note.status,
    },
  }).catch((e) => console.error("[doctorNotes] updateDiagnosis audit failed:", e.message));

  // R7bn-4 / D7-3-fix: diagnosis sync hook. Pre-fix the doctor's
  // diagnosis update only landed on the doctor-note document — the
  // admission's provisionalDiagnosis / finalDiagnosis stayed stale,
  // so the Discharge Summary (which reads from admission) couldn't
  // auto-fill diagnosis and the doctor had to re-enter it. NABH HIC.5
  // expects traceable single-source-of-truth for the patient's working
  // diagnosis.
  //
  // R7bo-LIVE-fix: DoctorNotes schema doesn't carry admissionId (only
  // ipdNo + patientUHID), so look up the active admission by UHID and
  // sync there. Falls back to ipdNo if UHID isn't on the note.
  try {
    const Admission = require("../../models/Patient/admissionModel");
    const $set = {};
    if (note.provisionalDiagnosis) $set.provisionalDiagnosis = note.provisionalDiagnosis;
    if (note.finalDiagnosis)        $set.finalDiagnosis = note.finalDiagnosis;
    if (Object.keys($set).length) {
      const filter = note.admissionId
        ? { _id: note.admissionId }
        : note.patientUHID || note.UHID
          ? { UHID: note.patientUHID || note.UHID, status: "Active" }
          : note.ipdNo
            ? { admissionNumber: note.ipdNo, status: "Active" }
            : null;
      if (filter) {
        await Admission.findOneAndUpdate(filter, { $set }, { new: true });
      }
    }
  } catch (e) {
    console.error("[doctorNotes] diagnosis sync to admission failed:", e.message);
  }

  // R7bn-1 / D9-fix: ClinicalAudit emit on diagnosis update.
  try {
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
    emitClinicalAudit({
      actor,
      event: "DIAGNOSIS_UPDATED",
      UHID: note.patientUHID || note.UHID,
      admissionId: note.admissionId,
      patientId: note.patient,
      patientName: note.patientName,
      targetType: "DoctorNote.diagnosis",
      targetId: note._id,
      before: {
        provisionalDiagnosis: before.provisionalDiagnosis,
        workingDiagnosis:     before.workingDiagnosis,
        finalDiagnosis:       before.finalDiagnosis,
      },
      after: {
        provisionalDiagnosis: note.provisionalDiagnosis,
        workingDiagnosis:     note.workingDiagnosis,
        finalDiagnosis:       note.finalDiagnosis,
      },
    });
  } catch (_) { /* silent */ }

  return note;
};

// ─────────────────────────────────────────────────────────────
// Amend a SIGNED (or already amended) note — NABH IMS.2 / MCI
// Indian Medical Records Act 1956 §3. The original signedAt /
// signedByName attestation is preserved; the mutation is captured
// as an entry on note.amendments[] (who, when, why, before→after
// per field), the whitelisted clinical fields are overlaid in
// place, status flips to "amended", and a ClinicalAudit row is
// emitted under DOCTOR_NOTE_AMENDED (7y retention floor).
//
// Concurrency: read-mutate-save is wrapped in retryVersionError so
// a parallel diagnosis update / re-sign on the same note doesn't
// 500 with a Mongoose VersionError.
// ─────────────────────────────────────────────────────────────
const amendDoctorNote = async (id, data, actorUser, req = null) => {
  const reason  = String(data?.reason || "").trim();
  const changes = Array.isArray(data?.changes) ? data.changes : [];

  if (!reason || reason.length < 5) {
    const err = new Error("Amendment reason is required (5-1000 chars)");
    err.statusCode = 400;
    err.code = "AMEND_REASON_REQUIRED";
    throw err;
  }
  if (reason.length > 1000) {
    const err = new Error("Amendment reason exceeds 1000 chars");
    err.statusCode = 400;
    err.code = "AMEND_REASON_TOO_LONG";
    throw err;
  }

  // Pre-flight ownership / status check on a lean snapshot so we 4xx
  // before the version-retry loop and don't burn retries on a known-bad
  // request.
  const before = await DoctorNotes.findById(id).lean();
  if (!before) {
    const err = new Error("Note not found");
    err.statusCode = 404;
    throw err;
  }
  if (before.status !== "signed" && before.status !== "amended") {
    const err = new Error("Only signed (or already-amended) notes can be amended");
    err.statusCode = 409;
    err.code = "AMEND_REQUIRES_SIGNED_NOTE";
    throw err;
  }

  const actorId   = actorUser?.id || actorUser?._id || null;
  const actorRole = actorUser?.role || "";
  const isAuthor  = before.doctor && actorId
                    && String(before.doctor) === String(actorId);
  if (!isAuthor && actorRole !== "Admin") {
    const err = new Error("Only the original author or Admin can amend this note");
    err.statusCode = 403;
    err.code = "AMEND_NOT_OWNER";
    throw err;
  }

  // Whitelist of clinical fields the amend body may overwrite. Anything
  // outside this list is silently ignored — DO NOT widen without an
  // explicit policy review (the attestation chain depends on it).
  const ALLOWED_FIELDS = [
    "provisionalDiagnosis",
    "workingDiagnosis",
    "finalDiagnosis",
    "icd10Code",
    "icd10Description",
    "patientStatus",
    "soap",
    "vitals",
    "investigations",
    "orders",
    "noteDetails",
    "tags",
    "isCritical",
  ];

  const retryVE = require("../../utils/retryVersionError");
  const prevStatus = before.status;

  const note = await retryVE(async () => {
    const doc = await DoctorNotes.findById(id);
    if (!doc) {
      const err = new Error("Note not found");
      err.statusCode = 404;
      throw err;
    }
    if (doc.status !== "signed" && doc.status !== "amended") {
      const err = new Error("Only signed (or already-amended) notes can be amended");
      err.statusCode = 409;
      err.code = "AMEND_REQUIRES_SIGNED_NOTE";
      throw err;
    }

    // Build the amendment entry from the JWT-resolved actor (NEVER from
    // the request body — caller cannot impersonate another clinician).
    const actorName = actorUser?.fullName
      || [actorUser?.firstName, actorUser?.lastName].filter(Boolean).join(" ").trim()
      || actorUser?.name
      || "";
    doc.amendments.push({
      amendedAt:     new Date(),
      amendedBy:     actorId || undefined,
      amendedById:   actorUser?.employeeId || "",
      amendedByName: actorName,
      amendedByRole: actorRole,
      reason,
      changes: changes.map((c) => ({
        field:    c?.field    || "",
        oldValue: c?.oldValue,
        newValue: c?.newValue,
      })),
    });

    // Overlay the whitelisted clinical fields. We deliberately do NOT
    // touch signedAt / signedByName / signedByReg / signedByEmpId /
    // signature — the original attestation must survive the amendment.
    ALLOWED_FIELDS.forEach((f) => {
      if (data[f] !== undefined) doc[f] = data[f];
    });

    doc.status    = "amended";
    doc.updatedBy = actorId || doc.updatedBy;
    await doc.save();
    return doc;
  }, { label: "doctor-note-amend" });

  // R7bn-1 / D9-fix: ClinicalAudit emit on amend (NABH IMS.2). The event
  // is on the LONG_RETENTION_EVENTS list — 7y floor.
  try {
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
    emitClinicalAudit({
      req,
      event: "DOCTOR_NOTE_AMENDED",
      UHID: note.patientUHID || note.UHID,
      admissionId: note.admissionId,
      patientId: note.patient,
      patientName: note.patientName,
      targetType: "DoctorNote",
      targetId: note._id,
      reason,
      before: { status: prevStatus },
      after: {
        status: "amended",
        reason,
        changesCount: changes.length,
        prevStatus,
        newStatus: "amended",
      },
      actor: req ? undefined : { _id: actorId, fullName: actorUser?.fullName, role: actorRole },
    });
  } catch (_) { /* silent — audit emit is non-blocking */ }

  return note;
};

// ─────────────────────────────────────────────────────────────
// Delete draft note
// ─────────────────────────────────────────────────────────────
const deleteDoctorNote = async (id, doctorUserId, opts = {}) => {
  const note = await DoctorNotes.findById(id);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }
  if (note.status === "signed") {
    const error = new Error("Cannot delete signed note");
    error.statusCode = 400;
    throw error;
  }
  if (note.doctor && doctorUserId && note.doctor.toString() !== doctorUserId.toString()) {
    const error = new Error("Not authorised");
    error.statusCode = 403;
    throw error;
  }

  // B6-T07: capture a snapshot BEFORE deleteOne() so the ClinicalAudit row
  // retains enough detail to reconstruct what was deleted (NABH AAC.7 trail).
  // DOCTOR_NOTE_DELETED is on the LONG_RETENTION_EVENTS list — 7y floor.
  const snapshot = {
    noteType:     note.noteType,
    signedByName: note.signedByName,
    doctorEmpId:  note.doctorEmpId,
    visitDate:    note.visitDate,
    contentLen:   JSON.stringify(note.noteDetails || {}).length,
  };

  await note.deleteOne();

  try {
    const { emitClinicalAudit } = require("../../services/Compliance/clinicalAuditService");
    await emitClinicalAudit({
      req: opts.req,
      event: "DOCTOR_NOTE_DELETED",
      UHID: note.patientUHID || note.UHID,
      admissionId: note.admissionId,
      patientId: note.patientId,
      patientName: note.patientName,
      targetType: "DoctorNote",
      targetId: note._id,
      before: snapshot,
      reason: opts.reason || "unspecified",
      actor: opts.req ? undefined : { _id: doctorUserId, role: "Doctor" },
    });
  } catch (e) {
    console.warn("[doctor-note-delete-audit] emit failed:", e.message);
  }

  return true;
};

module.exports = {
  createDoctorNote,
  signDoctorNote,
  getPendingOrders,
  getNotesByPatient,
  getNotesByIPD,
  getNoteById,
  updateDoctorNote,
  updateDiagnosis,
  amendDoctorNote,
  deleteDoctorNote,
};
