const Emergency = require("../../models/Patient/emergencyModel");
const patientService = require("../Patient/patientService");

/**
 * R7z: NABH-required MLC (Medico-Legal Case) auto-detection.
 *
 * Indian hospitals are legally required to flag — and inform police about —
 * specific categories of ER cases regardless of who marks the form:
 *   • Anyone brought in by Police (always MLC, always informed)
 *   • Road traffic accidents (RTA)
 *   • Assault, stab/gunshot wounds, sexual assault
 *   • Poisoning (accidental or intentional), drug overdose
 *   • Burns of any cause, electrocution
 *   • Suicide attempt, hanging, drowning
 *   • Suspicious unnatural death / brought-dead
 *   • Snake / animal bites (in many states)
 *   • Industrial / workplace accidents
 *
 * Receptionist intake screens forget to tick "MLC" often enough that we
 * keep getting non-MLC charts for stab wounds. Auto-flag from the
 * arrivalMode + presenting-complaint text and let the doctor downgrade
 * only by explicit override (controller never silently un-MLCs).
 */
const MLC_KEYWORDS = [
  // Road traffic
  /road\s*traffic|\brta\b|\brsa\b|\bmva\b|motor\s*vehicle/i,
  /vehicle\s*accident|hit\s*by|run\s*over|two\s*wheeler|four\s*wheeler/i,
  // Trauma — sharp / penetrating
  /stab(b(ed|ing)?)?|gunshot|\bgsw\b|knife|\bpenetrat/i,
  // Assault / violence
  /assault|attack(ed)?|beat(en|ing)?|domestic\s*violence|brawl/i,
  // Sexual offence — must auto-MLC for POCSO / rape kit chain of custody
  /rape|sexual\s*assault|molest|pocso/i,
  // Toxicology
  /poison(ed|ing)?|overdose|self\s*harm|attempted\s*suicide|hang(ed|ing)?/i,
  /organophosphate|paracetamol\s*od|insecticide|pesticide|kerosene/i,
  // Burns / electrocution
  /burn(s|t|ed)?|scald|electrocut|electric\s*shock/i,
  // Drowning
  /drown(ed|ing)?|near\s*drown/i,
  // Animal / snake bites
  /snake\s*bite|scorpion\s*sting|dog\s*bite|animal\s*bite/i,
  // Brought dead / unnatural death
  /brought\s*dead|\bbid\b|sudden\s*death/i,
  // Workplace / fall from height
  /fall\s*from\s*height|workplace\s*injury|industrial\s*accident/i,
];

function autoDetectMLC(emergencyData = {}) {
  if (emergencyData.isMLC === true) return { isMLC: true, reason: "manual flag" };
  if ((emergencyData.arrivalMode || "").toLowerCase() === "police") {
    return { isMLC: true, reason: "arrived via Police" };
  }
  const corpus = [
    emergencyData.presentingComplaints,
    emergencyData.historyOfPresentIllness,
    emergencyData.provisionalDiagnosis,
    emergencyData.finalDiagnosis,
  ].filter(Boolean).join(" \n ");
  if (!corpus) return { isMLC: false };
  for (const rx of MLC_KEYWORDS) {
    const m = corpus.match(rx);
    if (m) return { isMLC: true, reason: `auto-detected from complaint: "${m[0]}"` };
  }
  return { isMLC: false };
}

class EmergencyService {
  async createEmergencyVisit(emergencyData) {
    // R7z: auto-flag MLC before save so the schema stores it and every
    // downstream consumer (queue, print, MLC register) treats it as MLC.
    // Never silently downgrade a doctor-flagged MLC — autoDetect only
    // upgrades, never clears.
    const mlc = autoDetectMLC(emergencyData);
    if (mlc.isMLC && !emergencyData.isMLC) {
      emergencyData.isMLC = true;
      // Append (don't overwrite) any existing nursing notes with the
      // reason so the audit trail captures WHY the system flagged it.
      const note = {
        time: new Date(),
        note: `[SYSTEM] Auto-flagged MLC — ${mlc.reason}. Inform police per hospital MLC protocol.`,
        recordedBy: "System (MLC auto-detect)",
      };
      emergencyData.nursingNotes = [...(emergencyData.nursingNotes || []), note];
      // Default informedPolice flag if police-brought; receptionist still
      // confirms which station via the form.
      if ((emergencyData.arrivalMode || "").toLowerCase() === "police"
          && emergencyData.informedPolice === undefined) {
        emergencyData.informedPolice = true;
      }
    }

    const emergency = new Emergency(emergencyData);
    const savedEmergency = await emergency.save();

    await patientService.updateVisitCount(emergencyData.patientId, "Emergency");

    return savedEmergency;
  }

  async getAllEmergencyVisits(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;

    const visits = await Emergency.find(filters)
      .sort({ arrivalDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate("patientId", "fullName UHID contactNumber");

    const total = await Emergency.countDocuments(filters);

    return {
      visits,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getEmergencyVisitById(emergencyNumber) {
    return await Emergency.findOne({ emergencyNumber }).populate(
      "patientId",
      "fullName UHID contactNumber age gender"
    );
  }

  async getPatientEmergencyHistory(patientId) {
    return await Emergency.find({ patientId }).sort({ arrivalDate: -1 });
  }

  async updateEmergencyVisit(emergencyNumber, updateData) {
    return await Emergency.findOneAndUpdate({ emergencyNumber }, updateData, {
      new: true,
      runValidators: true,
    });
  }

  async deleteEmergencyVisit(emergencyNumber) {
    return await Emergency.findOneAndDelete({ emergencyNumber });
  }

  async addInvestigation(emergencyNumber, investigation) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          investigationsOrdered: {
            ...investigation,
            orderedDate: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async updateInvestigationStatus(
    emergencyNumber,
    investigationId,
    status,
    result
  ) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber, "investigationsOrdered._id": investigationId },
      {
        $set: {
          "investigationsOrdered.$.status": status,
          "investigationsOrdered.$.result": result,
        },
      },
      { new: true }
    );
  }

  async addMedication(emergencyNumber, medication) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          "treatmentGiven.medications": {
            ...medication,
            givenAt: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async addProcedure(emergencyNumber, procedure) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          "treatmentGiven.procedures": {
            ...procedure,
            performedAt: new Date(),
          },
        },
      },
      { new: true }
    );
  }

  async addNursingNote(emergencyNumber, note, recordedBy) {
    return await Emergency.findOneAndUpdate(
      { emergencyNumber },
      {
        $push: {
          nursingNotes: {
            time: new Date(),
            note,
            recordedBy,
          },
        },
      },
      { new: true }
    );
  }

  /**
   * R7z: ER disposition is the legal exit point of an ER stay. Every
   * branch has NABH-mandated attestation that this method now enforces
   * BEFORE persisting — previously you could close an Expired case with
   * no death certifier, walk out a DAMA patient with no witness, or
   * mark "Admitted" with no Admission record created, leaving the bed
   * board completely lying to ward staff.
   *
   * Branches:
   *   Admitted   — auto-create Admission stub (or accept existing
   *                admissionId) + flip ER status → "Admitted" not
   *                "Completed", so the IPD ledger picks it up.
   *   Discharged — straightforward; just timestamp + record by-whom.
   *   Referred   — require referredTo.hospital + reason + by-whom.
   *   Left Against Medical Advice
   *              — require damaDetails (reason, risks explained,
   *                explainedBy, witnessName, signature).
   *   Expired    — require deathDetails (declaredBy, immediate cause,
   *                mannerOfDeath); auto-flag MLC and police-intimate
   *                when manner is anything except Natural.
   *   Absconded  — capture the actor + timestamp; auto-add nursing note.
   *   Observation- no extra attestation; status stays "Under Observation".
   *   Pending    — soft no-op (ER reception only sets this at intake).
   */
  async updateDisposition(emergencyNumber, dispositionData) {
    const visit = await Emergency.findOne({ emergencyNumber });
    if (!visit) {
      const e = new Error(`Emergency visit ${emergencyNumber} not found`);
      e.status = 404; throw e;
    }

    const newDisp = dispositionData.disposition;
    const allowed = [
      "Admitted", "Discharged", "Referred",
      "Left Against Medical Advice", "Absconded",
      "Expired", "Observation", "Pending",
    ];
    if (!allowed.includes(newDisp)) {
      const e = new Error(`Invalid disposition: ${newDisp}`);
      e.status = 400; throw e;
    }

    // Terminal states are sticky — can't flip "Expired" or "Admitted"
    // back to "Observation" without an explicit admin re-open flow.
    const TERMINAL = new Set(["Admitted", "Discharged", "Referred",
                              "Left Against Medical Advice", "Absconded", "Expired"]);
    if (TERMINAL.has(visit.disposition) && visit.disposition !== newDisp) {
      const e = new Error(
        `Cannot change disposition from '${visit.disposition}' to '${newDisp}' — ` +
        `terminal dispositions are sticky. Contact Admin to re-open this ER record.`,
      );
      e.status = 409; throw e;
    }

    const now = new Date();
    const note = (text, by) => visit.nursingNotes.push({
      time: now, note: text, recordedBy: by || "System",
    });

    // ── Branch: Admitted (ER → IPD bridge) ──────────────────────
    if (newDisp === "Admitted") {
      // Ward staff need at least: which bed, which doctor, which ward.
      const bed = dispositionData.admittedToBed || dispositionData.bedNumber;
      const ward = dispositionData.admittedToWard || dispositionData.ward;
      if (!bed || !ward) {
        const e = new Error(
          "Admission requires admittedToBed + admittedToWard before ER can release the patient. " +
          "Allocate a bed first via Reception → Admission, then re-submit.",
        );
        e.status = 400; throw e;
      }

      // If caller passed an existing admissionId, link it. Otherwise
      // create a minimal Admission stub so the IPD bed-view + billing
      // ledger immediately see the patient under the new bed.
      if (dispositionData.admissionId) {
        visit.admission = dispositionData.admissionId;
      } else if (!visit.admission) {
        try {
          const Admission = require("../../models/Patient/admissionModel");
          const Counter   = require("../../utils/counter");
          const CounterModel = require("../../models/CounterModel");
          // R7ag: use the same global IPD counter as admissionService
          // (format IPD-YY-NN, continuous sequence). ER→IPD bridge admissions
          // shouldn't have their own number space — they're real inpatient
          // admissions and belong in the same series as planned IPDs.
          const yy  = new Date().getFullYear().toString().slice(-2);
          const key = "admission:ipd:global";
          let seed = null;
          const existing = await CounterModel.findOne({ _id: key }).lean();
          if (!existing) seed = await Admission.countDocuments();
          const seq = await Counter.nextSequence(key, seed);
          const admissionNumber = `IPD-${yy}-${String(seq).padStart(2, "0")}`;
          // R7hr-237 (audit: ER→IPD double-occupancy) — atomically claim the
          // Bed doc by number (CAS: only when Available) so two ER patients
          // can't be bridged onto the same bed. Mirrors the admissionService
          // create-time claim. If the bed isn't a claimable Bed doc (free-text
          // or already occupied) we fall back to the prior bedless stub rather
          // than faking occupancy — no regression for unregistered beds.
          const Bed = require("../../models/bedMgmt/bedsModel");
          const claimedBed = await Bed.findOneAndUpdate(
            { bedNumber: bed, status: "Available" },
            { $set: { status: "Occupied", patient: visit.patientId } },
            { new: true },
          );
          const stub = await Admission.create({
            admissionNumber,
            patientId:           visit.patientId,
            UHID:                visit.UHID,
            patientName:         visit.patientName,
            age:                 visit.age,
            gender:              visit.gender,
            contactNumber:       visit.contactNumber,
            admissionType:       "Emergency",
            admissionDate:       now,
            bedNumber:           bed,
            ...(claimedBed ? { bedId: claimedBed._id, hasBed: true } : {}),
            roomNumber:          dispositionData.admittedRoom || "",
            department:          dispositionData.admittedDepartment || visit.consultantIncharge || "",
            attendingDoctor:     dispositionData.attendingDoctor || visit.consultantIncharge || "",
            attendingDoctorId:   dispositionData.attendingDoctorId || null,
            modeOfArrival:       visit.arrivalMode || "",
            triageLevel:         visit.triageCategory || "",
            isMLC:               !!visit.isMLC,
            mlcNumber:           visit.mlcNumber || "",
            provisionalDiagnosis:visit.provisionalDiagnosis || "",
            reasonForAdmission:  visit.presentingComplaints || "",
            status:              "Active",
          });
          visit.admission = stub._id;
          // Link the claimed bed back to the new admission (occupancy ↔ admission).
          if (claimedBed) {
            await Bed.findByIdAndUpdate(claimedBed._id, { $set: { currentAdmission: stub._id } });
          } else {
            note(`[SYSTEM] Bed "${bed}" was not auto-claimed (already occupied or not a registered bed) — Reception must allocate/confirm the bed.`, "System");
          }
          // R7hr(billing-audit P1.1) — bootstrap billing for the bridged ER→IPD
          // admission exactly like the reception path (admissionController.
          // createAdmission → onAdmissionCreated). Without this the emergency
          // registration fee + admission charge + any ANH package auto-match
          // were NEVER billed for ER-desk admits (only bed/nursing were later
          // recovered by the ledger's backfillAdmissionCharges — one-time fees
          // and packages were lost revenue). Idempotent: createTrigger dedups on
          // {admissionId, serviceCode, dateKey}. Own try so a billing hiccup
          // never drops the disposition update.
          try {
            const autoBilling = require("../Billing/autoBillingService");
            const fired = await autoBilling.onAdmissionCreated(stub);
            note(`[SYSTEM] ER→IPD billing bootstrapped — ${(fired || []).length} charge trigger(s) fired (registration + admission fee + package match).`, "System (ER→IPD)");
          } catch (be) {
            note(`[SYSTEM] ER→IPD billing bootstrap failed: ${be.message}. Reception must review/add charges from the IPD ledger.`, "System (ER→IPD)");
          }
        } catch (e) {
          // Don't lose the disposition update on a stub-create failure —
          // the receptionist can still complete the admission via the
          // normal route. Just leave a marker on the ER record.
          note(`[SYSTEM] Admission stub auto-create failed: ${e.message}. ` +
               `Receptionist must create the Admission record manually.`,
               "System (ER→IPD)");
        }
      }

      visit.disposition       = "Admitted";
      visit.admittedAt        = now;
      visit.admittedBy        = dispositionData.admittedBy || dispositionData.actor || "ER";
      visit.admittedToBed     = bed;
      visit.admittedToWard    = ward;
      visit.admittedDepartment= dispositionData.admittedDepartment || "";
      visit.status            = "Admitted";   // not "Completed" — IPD owns it now
      note(`Disposition: ADMITTED → ${ward} / Bed ${bed} by ${visit.admittedBy}`,
           visit.admittedBy);
    }

    // ── Branch: Referred ────────────────────────────────────────
    else if (newDisp === "Referred") {
      const ref = dispositionData.referredTo || {};
      if (!ref.hospital || !ref.reason) {
        const e = new Error("Referral requires referredTo.hospital + referredTo.reason.");
        e.status = 400; throw e;
      }
      visit.referredTo = {
        hospital:   ref.hospital,
        department: ref.department || "",
        reason:     ref.reason,
        referredBy: ref.referredBy || dispositionData.actor || visit.consultantIncharge || "ER",
        referredAt: now,
      };
      visit.disposition = "Referred";
      visit.status      = dispositionData.status || "Completed";
      note(`Disposition: REFERRED to ${ref.hospital}${ref.department ? " (" + ref.department + ")" : ""} — ${ref.reason}`,
           visit.referredTo.referredBy);
    }

    // ── Branch: Left Against Medical Advice (DAMA) ──────────────
    else if (newDisp === "Left Against Medical Advice") {
      const d = dispositionData.damaDetails || {};
      const missing = [];
      if (!d.reason)           missing.push("reason");
      if (!d.risksExplained)   missing.push("risksExplained");
      if (!d.explainedBy)      missing.push("explainedBy");
      if (!d.patientSignature) missing.push("patientSignature");
      if (!d.witnessName)      missing.push("witnessName");
      if (missing.length) {
        const e = new Error(
          `DAMA refused — missing required attestation: ${missing.join(", ")}. ` +
          `NABH COP.20 mandates risks-explained + witness sign-off before a patient leaves against advice.`,
        );
        e.status = 400; throw e;
      }
      visit.damaDetails = {
        reason:           d.reason,
        risksExplained:   d.risksExplained,
        explainedBy:      d.explainedBy,
        explainedAt:      d.explainedAt || now,
        patientSignature: d.patientSignature,
        witnessName:      d.witnessName,
        witnessRelation:  d.witnessRelation || "",
        witnessSignedAt:  d.witnessSignedAt || now,
        followUpAdvised:  d.followUpAdvised || "",
      };
      visit.disposition = "Left Against Medical Advice";
      visit.status      = dispositionData.status || "Completed";
      visit.dischargeDate = now;
      note(`Disposition: LAMA — risks explained by ${d.explainedBy}, witnessed by ${d.witnessName}. Reason: ${d.reason}`,
           d.explainedBy);
    }

    // ── Branch: Expired (Death certification) ───────────────────
    else if (newDisp === "Expired") {
      const d = dispositionData.deathDetails || {};
      const cause = d.causeOfDeath || {};
      const missing = [];
      if (!d.declaredBy)        missing.push("declaredBy");
      if (!cause.immediate)     missing.push("causeOfDeath.immediate");
      if (!d.mannerOfDeath)     missing.push("mannerOfDeath");
      if (missing.length) {
        const e = new Error(
          `Death certification refused — missing required fields: ${missing.join(", ")}. ` +
          `NABH MOI.5 + Registrar of Births & Deaths Act mandate cause + manner before discharge.`,
        );
        e.status = 400; throw e;
      }
      visit.deathDetails = {
        declaredAt:    d.declaredAt || now,
        declaredBy:    d.declaredBy,
        causeOfDeath: {
          immediate:         cause.immediate,
          antecedent:        cause.antecedent || "",
          underlying:        cause.underlying || "",
          otherContributing: cause.otherContributing || "",
        },
        mannerOfDeath:       d.mannerOfDeath,
        postMortemRequested: !!d.postMortemRequested,
        postMortemReason:    d.postMortemReason || "",
        bodyHandedOverTo:    d.bodyHandedOverTo || "",
        bodyHandedRelation:  d.bodyHandedRelation || "",
        bodyHandedAt:        d.bodyHandedAt,
        policeIntimated:     !!d.policeIntimated,
        policeIntimationRef: d.policeIntimationRef || "",
        mccdNumber:          d.mccdNumber || "",
      };
      // Non-natural manner → auto-MLC + police intimation flag
      if (d.mannerOfDeath && d.mannerOfDeath !== "Natural") {
        if (!visit.isMLC) {
          visit.isMLC = true;
          note(`[SYSTEM] Auto-flagged MLC — manner of death "${d.mannerOfDeath}" is non-natural. Police intimation required.`,
               "System (MLC auto-detect)");
        }
        if (!visit.informedPolice) visit.informedPolice = true;
      }
      visit.disposition  = "Expired";
      visit.status       = dispositionData.status || "Completed";
      visit.dischargeDate = visit.deathDetails.declaredAt;
      note(`Disposition: EXPIRED at ${visit.deathDetails.declaredAt.toISOString()} — declared by ${d.declaredBy}. ` +
           `Cause: ${cause.immediate}. Manner: ${d.mannerOfDeath}.`,
           d.declaredBy);
    }

    // ── Branch: Absconded ───────────────────────────────────────
    else if (newDisp === "Absconded") {
      visit.disposition  = "Absconded";
      visit.status       = dispositionData.status || "Completed";
      visit.dischargeDate = now;
      note(`Disposition: ABSCONDED — patient left without informing staff. Reported by ${dispositionData.actor || "ER"}.`,
           dispositionData.actor || "ER");
    }

    // ── Branch: Discharged / Observation / Pending ──────────────
    else {
      visit.disposition = newDisp;
      if (newDisp === "Discharged") {
        visit.dischargeDate         = dispositionData.dischargeDate || now;
        visit.dischargeInstructions = dispositionData.dischargeInstructions || "";
        visit.status                = dispositionData.status || "Completed";
        note(`Disposition: DISCHARGED home. Instructions: ${visit.dischargeInstructions || "see chart"}`,
             dispositionData.actor || "ER");
      } else if (newDisp === "Observation") {
        visit.status = "Under Observation";
      } else {
        visit.status = dispositionData.status || visit.status;
      }
    }

    await visit.save();
    return visit;
  }

  async getActiveEmergencies() {
    // R7z: Previously sorted by triageCategory as a STRING — that meant
    // "Critical" → "Emergency" → "Urgent" was sorted alphabetically
    // ("Critical" < "Emergency" < "Non-urgent" < "Semi-urgent" <
    // "Urgent"), which only accidentally puts Critical first. "Urgent"
    // landed dead-last, BELOW Non-urgent. Worse — if someone added
    // "Acute" or "Red", the sort order would silently break.
    //
    // Use Mongo $switch to project a numeric priority, then sort on
    // that. Critical = 1 (highest), Non-urgent = 5 (lowest). Within
    // the same priority, oldest arrival first (FIFO within a tier).
    //
    // The enum allow-list in emergencyModel.js is:
    //   Critical · Emergency · Urgent · Semi-urgent · Non-urgent
    // We also accept colour-coded aliases (Red/Orange/Yellow/Green/
    // Blue) and a few historical labels so older imported docs sort
    // correctly. New writes are still constrained by the model enum.
    return await Emergency.aggregate([
      { $match: { status: { $in: ["Active", "Under Observation"] } } },
      {
        $addFields: {
          _triagePriority: {
            $switch: {
              branches: [
                { case: { $in: ["$triageCategory", ["Critical",    "Red",    "Resuscitation"]] },           then: 1 },
                { case: { $in: ["$triageCategory", ["Emergency",   "Orange", "Very Urgent"]] },            then: 2 },
                { case: { $in: ["$triageCategory", ["Urgent",      "Yellow"]] },                            then: 3 },
                { case: { $in: ["$triageCategory", ["Semi-urgent", "Standard", "Green", "Less Urgent"]] },  then: 4 },
                { case: { $in: ["$triageCategory", ["Non-urgent",  "Blue"]] },                              then: 5 },
                { case: { $in: ["$triageCategory", ["Deceased"]] },                                         then: 6 },
              ],
              default: 9, // unknown / unset categories sort last
            },
          },
        },
      },
      { $sort: { _triagePriority: 1, arrivalDate: 1 } },
      { $lookup: {
          from: "patients",
          localField: "patientId",
          foreignField: "_id",
          as: "patientId",
          pipeline: [{ $project: { fullName: 1, UHID: 1, age: 1, gender: 1, contactNumber: 1, bloodGroup: 1 } }],
      } },
      { $unwind: { path: "$patientId", preserveNullAndEmptyArrays: true } },
    ]);
  }

  async getEmergenciesByTriage(triageCategory) {
    return await Emergency.find({
      triageCategory,
      status: { $in: ["Active", "Under Observation"] },
    })
      .sort({ arrivalDate: 1 })
      .populate("patientId", "fullName UHID age gender contactNumber");
  }

  async getTodayEmergencies() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await Emergency.find({
      arrivalDate: {
        $gte: today,
        $lt: tomorrow,
      },
    }).populate("patientId", "fullName UHID age gender contactNumber");
  }

  async getMLCCases() {
    return await Emergency.find({ isMLC: true })
      .sort({ arrivalDate: -1 })
      .populate("patientId", "fullName UHID age gender contactNumber");
  }

  // PUT /api/emergency/:emergencyNumber/triage — used by ER doctors / nurses
  // to upgrade or downgrade triage as the patient's condition evolves.
  async updateTriageCategory(emergencyNumber, triageCategory) {
    return Emergency.findOneAndUpdate(
      { emergencyNumber },
      { triageCategory, triageTime: new Date() },
      { new: true },
    );
  }
}

module.exports = new EmergencyService();
