// R7ft — Shared data normalizer for all 5 patient-file print themes.
//
// Every theme (Narrative / Timeline / Executive / Audit / Editorial)
// must consume the SAME shape so swapping themes is a render-only
// difference, never a data-fetch difference. This module is the only
// place that translates the raw `receipt` payload from the backend
// into the canonical clinical-file shape.
//
// Contract:
//   normalizeFileData(rawReceipt) → CanonicalFileData
//   buildChronologicalEvents(canonical) → Event[]  (sorted ascending by date)
//
// CanonicalFileData (every theme reads from this):
//   meta: { ipdNo, uhid, printedAt, printCount }
//   patient: { fullName, age, gender, mobile, bloodGroup, address }
//   admission: { date, type, modeOfArrival, referringDoctor, consultant,
//                department, bed, ward, reasonForAdmission,
//                provisionalDiagnosis, workingDiagnosis, finalDiagnosis,
//                icd10, icd10Desc, dischargeDate, totalDays }
//   alerts: { allergies[], isolationFlags[], crossCheckAlerts[] }
//   vitals: { onAdmission: {...}, trend: [{date,bp,pulse,...}] }
//   history: { chief, hopi, medical, surgical, family, social,
//              obstetric, immunisation, anthropometry, homeMeds[] }
//   exam: { generalExam, systemicExam, ros }
//   investigations: [{ name, orderedAt, reportedAt, result }]
//   doctorNotes: [{ noteType, createdAt, content, doctorName,
//                   signedAt, signedBy }]
//   nursingNotes: [{ noteType, createdAt, content, nurseName,
//                    shift, signedAt }]
//   ia: { doctor: {…}, nursing: {…} }   // signed Initial Assessments
//   medications: [{ drug, generic, dose, route, frequency, startDate,
//                   endDate, indication, givenDoses[] }]
//   procedures: [{ name, date, surgeon, anaesthetist, findings, notes }]
//   consents: [{ name, signed, signedAt, signedBy, witness }]
//   discharge: { summary, advice, followUpDate, condition }
//   signatures: { consultant, mro }
//
// Author note: if you find yourself reaching for `receipt.foo` inside
// a theme component, add the field here first. Themes should never
// know about raw API shapes — that's a separation-of-concerns rule.

/* ── helpers ─────────────────────────────────────────────────── */
const toArr  = (v) => Array.isArray(v) ? v : (v ? [v] : []);
const toStr  = (v) => v == null ? "" : String(v).trim();
const toNum  = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "object" && v.$numberDecimal) return Number(v.$numberDecimal);
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const toDate = (v) => {
  if (!v) return null;
  try { const d = new Date(v); return isNaN(d.getTime()) ? null : d; } catch { return null; }
};
const joinNonEmpty = (...parts) => parts.filter(p => p != null && p !== "").join(" ");

/* ── public: normalize the raw receipt payload ──────────────── */
export function normalizeFileData(receipt = {}) {
  const r = receipt || {};

  const ia = r.ia || r.initialAssessment || {};
  const iaDoctor  = ia.doctor  || r.doctorIA  || {};
  const iaNursing = ia.nursing || r.nursingIA || {};

  return {
    meta: {
      ipdNo:       toStr(r.ipdNo || r.admissionNo),
      uhid:        toStr(r.uhid || r.uhId),
      printedAt:   toDate(r.printedAt) || new Date(),
      printCount:  toNum(r.printCount) || 0,
    },

    patient: {
      fullName:    toStr(r.patientName || r.fullName),
      age:         toNum(r.age),
      gender:      toStr(r.gender || r.sex),
      mobile:      toStr(r.mobile || r.contactNumber || r.phone),
      bloodGroup:  toStr(r.bloodGroup),
      address:     toStr(r.completeAddress || r.address),
    },

    admission: {
      date:            toDate(r.admissionDate || r.admittedAt),
      type:            toStr(r.admissionType),
      modeOfArrival:   toStr(r.modeOfArrival),
      referringDoctor: toStr(r.referringDoctor),
      consultant:      toStr(r.consultantName || r.consultant || r.attendingDoctor),
      department:      toStr(r.department),
      bed:             toStr(r.bedNumber || r.bed),
      ward:            toStr(r.wardName || r.ward),
      reasonForAdmission:   toStr(r.reasonForAdmission),
      provisionalDiagnosis: toStr(r.provisionalDiagnosis),
      workingDiagnosis:     toStr(r.workingDiagnosis),
      finalDiagnosis:       toStr(r.finalDiagnosis),
      icd10:           toStr(r.icd10),
      icd10Desc:       toStr(r.icd10Desc),
      dischargeDate:   toDate(r.dischargeDate || r.dischargedAt),
      totalDays:       toNum(r.totalDays || r.lengthOfStay),
    },

    alerts: {
      allergies:        toArr(r.allergies).map(a => typeof a === "string" ? { allergen: a } : a),
      isolationFlags:   toArr(r.isolationFlags).map(f => toStr(f)).filter(Boolean),
      crossCheckAlerts: toArr(r.crossCheckAlerts || iaNursing.crossCheckAlerts),
    },

    vitals: {
      onAdmission: r.vitalsOnAdmission || {},
      trend:       toArr(r.vitalsTrend || r.vitalSheet),
    },

    history: {
      // R7ft-FIX1: every alias path so the same field renders no
      // matter which save path produced it (R7fa split IA, R7fb/c
      // P0 NABH fields, R7fd P1, R7fg P2 — each settled on slightly
      // different field names).
      chief:        toStr(r.chiefComplaints || r.complaints || r.cc
                          || iaDoctor.chiefComplaints || iaDoctor.cc || iaDoctor.complaints),
      hopi:         toStr(r.history || r.hopi || r.historyOfPresentingIllness
                          || iaDoctor.hopi || iaDoctor.historyOfPresentingIllness
                          || iaDoctor.history || iaDoctor.presentingIllness),
      medical:      toStr(r.medicalHistory || r.pmh || r.briefPmh || r.pastMedicalHistory
                          || iaDoctor.pmh || iaDoctor.briefPmh || iaDoctor.pastMedicalHistory
                          || iaNursing.briefPmh || iaNursing.pmh),
      surgical:     toStr(r.surgicalHistory),
      family:       toStr(r.familyHistory),
      social:       toStr(r.socialHistory),
      obstetric:    iaDoctor.obstetricGynae || iaNursing.obstetricGynae || {},
      immunisation: iaDoctor.immunisation   || iaNursing.immunisation   || {},
      anthropometry:iaDoctor.anthropometry  || iaNursing.anthropometry  || {},
      homeMeds:     toArr(iaDoctor.medicationReconciliation || iaNursing.medicationReconciliation || r.homeMedications),
    },

    exam: {
      generalExam:  toStr(r.generalExamination || iaDoctor.examination
                          || iaDoctor.generalExamination || iaDoctor.generalExam),
      systemicExam: toStr(r.systemicExamination || iaDoctor.systemic
                          || iaDoctor.systemicExamination || iaDoctor.systemicExam),
      ros:          iaDoctor.reviewOfSystems || iaDoctor.ros || {},
    },

    investigations: toArr(r.investigations).map(inv => ({
      name:       toStr(inv.name || inv.test),
      orderedAt:  toDate(inv.orderedAt),
      reportedAt: toDate(inv.reportedAt),
      result:     toStr(inv.result || inv.findings),
    })),

    doctorNotes: toArr(r.doctorNotes).map(n => ({
      // R7ge — Spread ORIGINAL note first so per-type structured fields
      // (noteDetails.*, soap.*, deathSummary, icuBundle, whoChecklist,
      // procedureNote, amendment etc.) survive normalisation and the
      // R7fx TYPE_BUILDERS can still read their nested paths when the
      // builder is invoked from Narrative day-wise journey. Without
      // this spread, only the few aliases below were preserved and the
      // R7gd embedded per-type cards rendered as empty "DRAFT" headers.
      ...n,
      noteType:   toStr(n.noteType || n.type || "Progress"),
      createdAt:  toDate(n.createdAt || n.date || n.noteDate || n.visitDate),
      // R7ft-FIX1: noteDetails.content / noteDetails.text are common
      // shapes that R7fp-1 introduced for the new save path. Without
      // these the printout shows "Progress:" with no body.
      // R7gb-VERIFY-FIX1: R7fx structured notes put narrative in
      // soap.subjective/assessment/plan — fall back to those so
      // structured death/procedure/icu/etc. notes reach the day-wise
      // journey. Without this fallback every TYPE_BUILDER-shaped note
      // was dropped by the .filter(n.content) below and the day-wise
      // Clinical Journey section silently disappeared.
      content:    toStr(n.content || n.text || n.note || n.noteDetails?.content
                       || n.noteDetails?.text || n.noteDetails?.note || n.noteDetails?.summary
                       || n.soap?.subjective || n.soap?.assessment || n.soap?.plan),
      doctorName: toStr(n.doctorName || n.signedByName),
      signedAt:   toDate(n.signedAt),
      signedBy:   toStr(n.signedBy || n.signedByName),
      // R7gb P0-14 — NABH IMS.1 / HIC.6: late-entry flag MUST survive
      // normalisation so the print can stamp a "LATE ENTRY" banner
      // under any back-dated note (regulator + court need the
      // addendum visible inline, not only in the audit log).
      lateEntry:       !!(n.lateEntry || n.isLateEntry || n.noteDetails?.lateEntry),
      lateEntryReason: toStr(n.lateEntryReason || n.lateReason
                            || n.noteDetails?.lateEntryReason
                            || n.noteDetails?.lateReason),
      lateEntryAt:     toDate(n.lateEntryAt || n.lateEnteredAt
                            || n.noteDetails?.lateEntryAt),
    })).filter(n => n.createdAt && n.content),  // skip empty-body notes

    nursingNotes: toArr(r.nursingNotes).map(n => ({
      // R7ge — Spread ORIGINAL note first so per-type structured fields
      // (painAssessment, intakeOutput, vitals, ivLine, noteData.ivInfusion,
      // noteData.woundCare, noteData.skinAssessment, noteData.fallRisk,
      // noteData.mewsScore, noteData.neuroAssessment, noteData.procedure,
      // noteData.bloodTransfusion, noteData.dailyAssessment, noteData.carePlan,
      // noteData.nutritionalAssessment, noteData.patientEducation,
      // noteData.discharge etc.) survive normalisation and the per-type
      // builder in buildNurseNoteCardHtml can still read its nested paths
      // when invoked from Narrative day-wise journey. Without this spread,
      // only the few aliases below were preserved so the R7gd embedded
      // per-type cards rendered as empty "DRAFT — Not yet signed".
      ...n,
      noteType:   toStr(n.noteType || n.type || "Care note"),
      createdAt:  toDate(n.createdAt || n.date || n.noteDate),
      content:    toStr(n.content || n.text || n.note || n.remarks
                       || n.noteData?.content || n.noteData?.text || n.noteData?.note
                       || n.noteData?.remarks || n.noteData?.summary
                       // R7gb-VERIFY-FIX1 — see doctor mapper above
                       || n.soap?.subjective || n.soap?.assessment),
      nurseName:  toStr(n.nurseName || n.signedByName),
      shift:      toStr(n.shift),
      signedAt:   toDate(n.signedAt || n.submittedAt),
      // R7gb P0-14 — late-entry passthrough (see doctor-note mapper above).
      lateEntry:       !!(n.lateEntry || n.isLateEntry || n.noteData?.lateEntry),
      lateEntryReason: toStr(n.lateEntryReason || n.lateReason
                            || n.noteData?.lateEntryReason
                            || n.noteData?.lateReason),
      lateEntryAt:     toDate(n.lateEntryAt || n.lateEnteredAt
                            || n.noteData?.lateEntryAt),
    })).filter(n => {
      // R7ge — Pass any nursing note that has at least one structured
      // field, even when free-text content is empty. R7fx per-type
      // notes (vitals, pain, intake, iv, wound, skin, fall, mews,
      // neuro, procedure, blood, daily, careplan, nutrition,
      // education, discharge) store data in nested objects — without
      // this relax they were silently dropped by the old content-only
      // gate and never reached the day-wise journey.
      if (!n.createdAt) return false;
      if (n.content) return true;
      const hasStructured =
        n.vitals || n.painAssessment || n.intakeOutput || n.ivLine ||
        (n.noteData && Object.keys(n.noteData).some(k => k !== "patient"));
      return !!hasStructured;
    }),

    ia: { doctor: iaDoctor, nursing: iaNursing },

    medications: toArr(r.medications).map(m => ({
      drug:       toStr(m.drug || m.name || m.medicationName),
      generic:    toStr(m.generic),
      dose:       toStr(m.dose || m.strength),
      route:      toStr(m.route),
      frequency:  toStr(m.frequency || m.freq),
      startDate:  toDate(m.startDate),
      endDate:    toDate(m.endDate),
      indication: toStr(m.indication || m.notes),
      givenDoses: toArr(m.givenDoses || m.administrations),
    })),

    procedures: toArr(r.procedures).map(p => ({
      name:        toStr(p.name || p.procedure || p.procedureName),
      date:        toDate(p.date),
      surgeon:     toStr(p.surgeon),
      anaesthetist:toStr(p.anesthesia || p.anesthetist || p.anaesthetist),
      findings:    toStr(p.findings),
      notes:       toStr(p.notes),
      // R7gb P0-9 — Patch 1 in CompletePatientFilePage.jsx now
      // synthesises procedures from notes with the keys below.
      indication:  toStr(p.indication),
      role:        toStr(p.role),
      signedBy:    toStr(p.signedBy),
      signedAt:    toDate(p.signedAt),
    })),

    consents: toArr(r.consents).map(c => ({
      name:      toStr(c.name || c.formName || c.consentTitle || c.consentType),
      signed:    !!(c.signed || c.status === "Signed" || c.status === "signed"),
      signedAt:  toDate(c.signedAt || c.createdAt),
      signedBy:  toStr(c.signedBy || c.signedByName || c.patientSignature),
      witness:   toStr(c.witness || c.witnessName),
    })),

    discharge: {
      summary:      toStr(r.dischargeSummary),
      advice:       toStr(r.dischargeAdvice),
      followUpDate: toDate(r.followUpDate),
      condition:    toStr(r.dischargeCondition || r.conditionAtDischarge),
      medications:  toArr(r.dischargeMedications || r.dischargeMeds).map(m => ({
        name:        toStr(m.name || m.drug || m.medicationName),
        generic:     toStr(m.generic),
        dose:        toStr(m.dose || m.strength),
        frequency:   toStr(m.frequency || m.freq),
        route:       toStr(m.route),
        duration:    toStr(m.duration),
        instructions:toStr(m.instructions || m.notes),
      })),
    },

    /* R7ft-FIX2 — comprehensive clinical buckets. Themes consume these
       by canonical key; the raw API shape stays out of theme code. */
    doctorOrders: toArr(r.doctorOrders).map(o => ({
      orderedAt:    toDate(o.orderedAt || o.createdAt),
      orderType:    toStr(o.orderType || o.type),
      details:      o.orderDetails || o.details || {},
      displayName:  toStr(o.orderDetails?.displayName || o.orderDetails?.medicineName
                          || o.orderDetails?.testName || o.orderDetails?.name
                          || o.displayName || o.name),
      dose:         toStr(o.orderDetails?.dose || o.dose),
      route:        toStr(o.orderDetails?.route || o.route),
      frequency:    toStr(o.orderDetails?.frequency || o.frequency),
      status:       toStr(o.status),
      orderedBy:    toStr(o.orderedByName || o.doctorName || o.orderedBy),
    })),

    mar: toArr(r.mar).map(m => ({
      createdAt:    toDate(m.createdAt || m.administeredAt),
      drug:         toStr(m.drug || m.medicineName || m.medicationName || m.name),
      dose:         toStr(m.dose || m.strength),
      route:        toStr(m.route),
      frequency:    toStr(m.frequency || m.freq),
      givenAt:      toDate(m.givenAt || m.administeredAt || m.createdAt),
      givenBy:      toStr(m.givenBy || m.administeredBy || m.nurseName),
      status:       toStr(m.status),
      administrations: toArr(m.administrations || m.givenDoses),
    })),

    vitalsTrend: toArr(r.vitalsTrend || r.vitals).map(v => {
      const bp = typeof v.bp === "object" && v.bp
        ? `${v.bp.systolic ?? "?"}/${v.bp.diastolic ?? "?"}`
        : toStr(v.bp);
      return {
        at:     toDate(v.recordedAt || v.createdAt || v.at),
        bp:     bp || toStr(v.bloodPressure),
        pulse:  toStr(v.pulse || v.hr),
        temp:   toStr(v.temp || v.temperature),
        spo2:   toStr(v.spo2 || v.SpO2),
        rr:     toStr(v.rr || v.respiratoryRate),
        painScore:  toNum(v.painScore || v.pain || v.vasPain),
        recordedBy: toStr(v.recordedBy || v.recordedByName || v.nurseName),
      };
    }).filter(v => v.at),

    intakeOutput: toArr(r.intakeOutput).map(io => ({
      at:        toDate(io.ts || io.createdAt),
      direction: toStr(io.direction),  // "IN" / "OUT"
      volumeML:  toNum(io.volumeML),
      fluidType: toStr(io.fluidType || io.label),
      source:    toStr(io.source),
    })).filter(io => io.at && io.volumeML != null),

    labReports: toArr(r.labReports).map(rp => ({
      name:       toStr(rp.testName || rp.reportName || rp.name),
      reportType: toStr(rp.reportType),
      date:       toDate(rp.reportDate || rp.createdAt),
      impression: toStr(rp.impression || rp.findings || rp.result),
      status:     toStr(rp.status),
    })),

    labTrends: toArr(r.labTrends).map(t => ({
      name:     toStr(t.panelName || t.panelType),
      tests:    toArr(t.tests),
      dates:    toArr(t.dates),
      status:   toStr(t.status),
      createdAt:toDate(t.createdAt),
    })),

    shiftHandovers: toArr(r.shiftHandovers).map(h => ({
      at:           toDate(h.createdAt || h.handoverAt),
      shift:        toStr(h.shift),
      handingBy:    toStr(h.handingByName || h.handingNurseName || h.fromNurse || h.signedByName),
      receivingBy:  toStr(h.receivingByName || h.receivingNurseName || h.toNurse),
      summary:      toStr(h.summary || h.handoverSummary || h.content || h.notes),
    })),

    nursingAssessments: toArr(r.nursingAssessments).map(a => ({
      at:        toDate(a.createdAt || a.assessmentDate),
      type:      toStr(a.assessmentType || a.type),
      content:   toStr(a.summary || a.content || a.notes),
      nurseName: toStr(a.nurseName || a.signedByName),
    })),

    nursingCarePlans: toArr(r.nursingCarePlans).map(p => ({
      at:        toDate(p.createdAt),
      diagnosis: toStr(p.nursingDiagnosis || p.diagnosis),
      goals:     toStr(p.goals),
      interventions: toStr(p.interventions),
      evaluation:toStr(p.evaluation),
      nurseName: toStr(p.nurseName || p.signedByName),
    })),

    bedTransfers: toArr(r.bedTransfers).map(t => ({
      at:       toDate(t.createdAt || t.transferDate),
      fromBed:  toStr(t.fromBed || t.previousBed),
      toBed:    toStr(t.toBed || t.newBed),
      reason:   toStr(t.reason),
      by:       toStr(t.transferredByName || t.by || t.requestedBy),
      status:   toStr(t.status),
    })),

    bloodTransfusion: toArr(r.bloodTransfusion).map(b => ({
      at:        toDate(b.startedAt || b.createdAt),
      btNumber:  toStr(b.btNumber),
      component: toStr(b.bagsIssued?.[0]?.productType || b.component),
      bagNumber: toStr(b.bagsIssued?.[0]?.bagNumber),
      volumeMl:  toNum(b.bagsIssued?.[0]?.volumeMl),
      bloodGroup:toStr(b.bloodGroup),
      preVitals: (() => {
        const v = b.preTransfusion?.vitals || {};
        return { bp: toStr(v.bp), pulse: toStr(v.pulse), temp: toStr(v.temp), spo2: toStr(v.spo2) };
      })(),
      postVitals: (() => {
        const v = b.postTransfusion?.vitals || {};
        return { bp: toStr(v.bp), pulse: toStr(v.pulse), temp: toStr(v.temp), spo2: toStr(v.spo2) };
      })(),
      reaction:  !!(b.reaction?.occurred),
      reactionType: toStr(b.reaction?.type),
      indication:toStr(b.indication),
      transfusedBy: toStr(b.transfusedByName),
      status:    toStr(b.status),
    })),

    dietPlans: toArr(r.dietPlans).map(d => ({
      at:           toDate(d.assignedAt || d.createdAt),
      templateName: toStr(d.plan?.templateName || d.templateName || "Custom"),
      targetCalories: toNum(d.plan?.targetCalories || d.targetCalories),
      targetProtein:  toNum(d.plan?.targetProtein || d.targetProtein),
      restrictions: toStr(d.plan?.restrictions || d.restrictions),
      assignedBy:   toStr(d.assignedByName || d.dieticianName || d.assignedBy),
      notes:        toStr(d.notes || d.dietitianNotes),
      status:       toStr(d.status),
    })),

    icuBundles: toArr(r.icuBundles).map(b => {
      const pct = (key) => (b.bundles || []).find(x => x.key === key)?.compliancePct ?? null;
      return {
        date:    toStr(b.date),
        shift:   toStr(b.shift),
        vapPct:    pct("vap"),
        cautiPct:  pct("cauti"),
        clabsiPct: pct("clabsi"),
        dvtPct:    pct("dvt"),
        sepsisPct: pct("sepsis"),
        supPct:    pct("sup"),
        overallPct:toNum(b.overallCompliancePct),
        status:    toStr(b.status),
        finalizedBy: toStr(b.finalizedBy),
      };
    }),

    mlc: toArr(r.mlc).map(m => ({
      at:       toDate(m.createdAt || m.mlcDate),
      type:     toStr(m.mlcType || m.type),
      brief:    toStr(m.brief || m.summary || m.description),
      io:       toStr(m.investigatingOfficer || m.io),
      station:  toStr(m.policeStation || m.station),
      signedBy: toStr(m.signedByName || m.signedBy),
    })),

    activityLog: toArr(r.activityLog).map(a => ({
      at:      toDate(a.createdAt),
      module:  toStr(a.module),
      action:  toStr(a.action),
      area:    toStr(a.area),
      summary: toStr(a.summary),
      userName:toStr(a.userName),
    })),

    // R7gb P0-11 — canonical bills bucket. Field-name aliasing covers
    // both current ledger shape (billNumber/amount/paidAmount) and the
    // older legacy shape (number/total/paid).
    bills: toArr(r.bills).map(b => ({
      at:          toDate(b.createdAt || b.billDate || b.date),
      billNumber:  toStr(b.billNumber || b.number || b.invoiceNumber),
      category:    toStr(b.category || b.type || b.serviceType),
      description: toStr(b.description || b.particulars || b.summary),
      amount:      toNum(b.amount ?? b.total ?? b.grossAmount),
      paid:        toNum(b.paidAmount ?? b.paid ?? b.amountPaid),
      balance:     toNum(b.balance ?? b.dueAmount ?? b.outstanding),
      status:      toStr(b.status),
      raisedBy:    toStr(b.raisedByName || b.raisedBy || b.createdByName),
    })),

    signatures: {
      consultant: toStr(r.consultantName || r.attendingDoctor),
      mro:        toStr(r.mro || r.medicalRecordsOfficer),
    },
  };
}

/* ── public: chronological event timeline ────────────────────
   Builds a single ordered stream of clinically-significant events
   so the Timeline + Narrative themes can render a true day-diary.
   Each event: { at: Date, kind, actor, summary, detail? }      */
export function buildChronologicalEvents(canonical) {
  const events = [];
  const f = canonical || {};

  if (f.admission?.date) {
    events.push({
      at: f.admission.date, kind: "admission",
      actor: f.admission.consultant,
      summary: joinNonEmpty(
        `Admitted to ${f.admission.ward || "ward"}`,
        f.admission.bed ? `(bed ${f.admission.bed})` : "",
        "under",
        f.admission.consultant ? `Dr. ${f.admission.consultant.replace(/^Dr\.\s*/i, "")}` : "consultant on call",
        f.admission.provisionalDiagnosis ? `— provisional Dx ${f.admission.provisionalDiagnosis}` : "",
      ).trim(),
      detail: f.admission.reasonForAdmission,
    });
  }

  // Initial Assessment (doctor / nursing) — one event each
  if (f.ia?.doctor && Object.keys(f.ia.doctor).length) {
    events.push({
      at: toDate(f.ia.doctor.signedAt) || toDate(f.ia.doctor.assessmentDate) || f.admission.date,
      kind: "ia-doctor",
      actor: f.ia.doctor.signedByName || f.admission.consultant,
      summary: "Doctor Initial Assessment signed",
      detail: f.ia.doctor.briefPmh || f.history.chief,
    });
  }
  if (f.ia?.nursing && Object.keys(f.ia.nursing).length) {
    events.push({
      at: toDate(f.ia.nursing.signedAt) || toDate(f.ia.nursing.submittedAt) || f.admission.date,
      kind: "ia-nursing",
      actor: f.ia.nursing.nurseName || f.ia.nursing.signedByName,
      summary: "Nursing Initial Assessment signed",
      detail: joinNonEmpty(
        f.ia.nursing.identification?.bandAttached === "Yes" ? "Band on." : "",
        f.alerts.allergies.length ? `Allergy: ${f.alerts.allergies.map(a => a.allergen || a.agent || a).join(", ")}` : "",
      ),
    });
  }

  // Doctor notes
  f.doctorNotes.forEach(n => events.push({
    at: n.createdAt, kind: "doctor-note", actor: n.doctorName,
    summary: `${n.noteType}: ${truncate(n.content, 120)}`,
    detail: n.content,
  }));

  // Nursing notes
  f.nursingNotes.forEach(n => events.push({
    at: n.createdAt, kind: "nursing-note", actor: n.nurseName,
    summary: `${n.noteType}${n.shift ? ` (${n.shift})` : ""}: ${truncate(n.content, 120)}`,
    detail: n.content,
  }));

  // Investigations
  f.investigations.forEach(inv => {
    if (inv.orderedAt) events.push({
      at: inv.orderedAt, kind: "lab-order", actor: "",
      summary: `${inv.name} ordered`, detail: "",
    });
    if (inv.reportedAt) events.push({
      at: inv.reportedAt, kind: "lab-report", actor: "",
      summary: `${inv.name} reported${inv.result ? `: ${truncate(inv.result, 80)}` : ""}`,
      detail: inv.result,
    });
  });

  // Procedures
  f.procedures.forEach(p => p.date && events.push({
    at: p.date, kind: "procedure", actor: p.surgeon,
    summary: `Procedure: ${p.name}`,
    detail: joinNonEmpty(p.findings, p.notes),
  }));

  // Medication start / end (each dose-given would be too noisy)
  f.medications.forEach(m => {
    if (m.startDate) events.push({
      at: m.startDate, kind: "med-start", actor: "",
      summary: `Started ${joinNonEmpty(m.drug, m.dose, m.route, m.frequency)}`,
      detail: m.indication,
    });
    if (m.endDate) events.push({
      at: m.endDate, kind: "med-stop", actor: "",
      summary: `Stopped ${joinNonEmpty(m.drug, m.dose)}`,
    });
  });

  // Discharge
  if (f.admission?.dischargeDate) {
    events.push({
      at: f.admission.dischargeDate, kind: "discharge",
      actor: f.signatures.consultant,
      summary: `Discharged${f.discharge.condition ? ` in ${f.discharge.condition} condition` : ""}${f.admission.finalDiagnosis ? ` — final Dx ${f.admission.finalDiagnosis}` : ""}`,
      detail: f.discharge.summary,
    });
  }

  // Sort ascending; events with null `at` sink to the end.
  return events
    .filter(e => e.at instanceof Date && !isNaN(e.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function truncate(s, n) {
  if (!s) return "";
  const str = String(s).replace(/\s+/g, " ").trim();
  return str.length <= n ? str : str.slice(0, n - 1).trimEnd() + "…";
}

/* ── small reusable formatters every theme can import ──────── */
export const fmtDate = (d, withTime = false) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
};

export const fmtTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
};

export const fmtDayMonth = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short" });
  } catch { return String(d); }
};

export const pronoun = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return { subj: "She", pos: "her", obj: "her" };
  if (g.startsWith("m")) return { subj: "He",  pos: "his", obj: "him" };
  return { subj: "The patient", pos: "their", obj: "them" };
};
