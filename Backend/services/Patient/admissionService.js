// services/Patient/admissionService.js
// ✅ CHANGES:
//   1. Added getAdmissionsByPatient(patientId) — returns all admissions for a patient
//   2. Patient soft-delete does NOT affect admissions/beds (correct behavior)
//      When patient.isActive=false, their active admissions stay, bed stays Occupied

const mongoose = require("mongoose");
const Admission = require("../../models/Patient/admissionModel");
const Bed = require("../../models/bedMgmt/bedsModel");
const Patient = require("../../models/Patient/patientModel");
const { logErr } = require("../../utils/logErr");
const { nextSequence } = require("../../utils/counter");

class AdmissionService {
  async _generateAdmissionNumber() {
    // R7ag: format = IPD-YY-NN with a CONTINUOUS counter (no per-year /
    // per-month reset). The year prefix updates as time rolls over,
    // but the sequence keeps incrementing — so 2026 may run
    // IPD-26-01 ... IPD-26-99, and 2027 picks up at IPD-27-100 (or
    // wherever the counter is). Per the user's specification:
    //   "IPD-26-01, IPD-26-02 ... next year IPD-27-03, IPD-27-04"
    //
    // Counter is seeded once from the existing Admission collection
    // count via $setOnInsert so legacy ADM/IPD/ER-prefixed rows aren't
    // re-issued. Subsequent calls just $inc atomically — the same race
    // safety the old per-month counter gave us.
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const key = "admission:ipd:global";
    let seed = null;
    const Counter = require("../../models/CounterModel");
    const existing = await Counter.findOne({ _id: key }).lean();
    if (!existing) {
      const Admission = require("../../models/Patient/admissionModel");
      seed = await Admission.countDocuments();
    }
    const seq = await nextSequence(key, seed);
    return `IPD-${yy}-${String(seq).padStart(2, "0")}`;
  }

  _patientName(p) {
    return (
      p.fullName ||
      `${p.firstName || ""} ${p.lastName || ""}`.trim() ||
      p.name ||
      "Unknown Patient"
    );
  }

  async _findPatient(patientId, UHID) {
    let patient = null;
    if (patientId && mongoose.isValidObjectId(patientId))
      patient = await Patient.findById(patientId).lean();
    if (!patient && UHID)
      patient = await Patient.findOne({
        UHID: UHID.toString().trim().toUpperCase(),
      }).lean();
    if (!patient)
      throw new Error("Patient not found — check patientId or UHID");
    return patient;
  }

  async createAdmission(data) {
    if (!data.patientId && !data.UHID)
      throw new Error("patientId or UHID is required");

    const patient = await this._findPatient(data.patientId, data.UHID);

    // Only block duplicate if an active bed-admission already exists. We read
    // outside the transaction — the bed-allocation guard below is the true
    // race-condition gate.
    if (data.bedId) {
      const existing = await Admission.findOne({
        patientId: patient._id,
        status: "Active",
        hasBed: true,
      }).lean();
      if (existing) {
        throw new Error(
          `Patient already has an active bed admission: ${existing.admissionNumber}. ` +
            `Discharge first before creating a new admission.`,
        );
      }
    }

    const admissionNumber = await this._generateAdmissionNumber();

    // Atomic path on a replica-set MongoDB (prod); on a standalone dev box,
    // fall through to sequential writes with a best-effort rollback. Mirrors
    // the pattern in services/MLC/mlcService.js.
    const session = await mongoose.startSession().catch(() => null);
    const useTx = !!session && (session.client?.s?.options?.replicaSet ||
                                session.client?.options?.replicaSet);

    const run = async (s) => {
      let bedData = {};
      if (data.bedId) {
        const bed = await Bed.findOneAndUpdate(
          { _id: data.bedId, status: "Available" },
          { $set: { status: "Occupied" } },
          { new: true, session: s || undefined },
        ).populate("room ward floor building");

        if (!bed) {
          const bedCheck = await Bed.findById(data.bedId).lean();
          if (!bedCheck) throw new Error("Bed not found");
          throw new Error(
            `Bed ${bedCheck.bedNumber} is not available (current status: ${bedCheck.status}).`,
          );
        }

        bedData = {
          bedId: bed._id,
          bedNumber: bed.bedNumber,
          roomNumber: bed.room?.roomNumber || "",
          roomId: bed.room?._id || null,
          wardId: bed.ward?._id || null,
          floorId: bed.floor?._id || null,
          buildingId: bed.building?._id || null,
          hasBed: true,
        };
      }

      const [created] = await Admission.create(
        [
          {
            admissionNumber,
            UHID: patient.UHID || String(patient._id),
            patientId: patient._id,
            patientName: this._patientName(patient),
            contactNumber:
              patient.contactNumber ||
              patient.phone ||
              patient.mobile ||
              "0000000000",
            email: patient.email || "",
            ...bedData,
            department:   data.department || "",
            departmentId: data.departmentId || undefined,
            admissionDate: data.admissionDate
              ? new Date(data.admissionDate)
              : new Date(),
            expectedDischargeDate: data.expectedDischargeDate
              ? new Date(data.expectedDischargeDate)
              : undefined,
            reasonForAdmission: data.reasonForAdmission || "",
            provisionalDiagnosis: data.provisionalDiagnosis || "",
            specialInstructions:  data.specialInstructions || "",
            expectedStayDays:     Number(data.expectedStayDays) || 0,
            admissionType: data.admissionType || "Emergency",
            attendingDoctor:   data.attendingDoctor || "",
            // ref to the doctor's User _id — drives IPD file access control
            attendingDoctorId: data.attendingDoctorId || undefined,
            estimatedCost: Number(data.estimatedCost) || 0,
            advancePaid: Number(data.advancePaid) || 0,
            // ER-specific clinical context captured at intake
            isMLC:         data.isMLC || false,
            mlcNumber:     data.mlcNumber || "",
            triageLevel:   data.triageLevel || "",
            erType:        data.erType || "",
            modeOfArrival: data.modeOfArrival || "",
            broughtBy:     data.broughtBy || "",
            status: "Active",
          },
        ],
        { session: s || undefined },
      );

      if (data.bedId) {
        await Bed.findByIdAndUpdate(
          data.bedId,
          { $set: { currentAdmission: created._id } },
          { session: s || undefined },
        );
      }

      return created;
    };

    let admission;
    try {
      if (useTx) {
        await session.withTransaction(async () => {
          admission = await run(session);
        });
      } else {
        try {
          admission = await run(null);
        } catch (err) {
          // No-transaction fallback: revert the bed allocation if it
          // succeeded before the failure. Best-effort — the catch swallows
          // rollback errors so the original cause still surfaces.
          if (data.bedId) {
            await Bed.findByIdAndUpdate(data.bedId, {
              $set: { status: "Available", currentAdmission: null },
            }).catch(logErr("admission", `rollback bed ${data.bedId} on create failure`));
          }
          throw err;
        }
      }
    } finally {
      session?.endSession();
    }

    return admission;
  }

  async dischargePatient(admissionId, dischargeData = {}) {
    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error(
        `Cannot discharge — admission status is already "${admission.status}"`,
      );

    // ── NABH discharge-readiness gate (security/business audit F-01) ─────
    // Block the clinical discharge until the bill-counter workflow has at
    // least progressed past "BillCleared". Caller can pass
    // dischargeData.allowOverride to bypass — used by Admin LAMA / death
    // workflows where waiting for the cashier would be inhumane — and the
    // override is audited. Re-audit H-03: the override itself is now gated
    // to Admin only (regardless of route-level requireAction). The
    // controller layer passes { actor: { role, id } } via dischargeData.
    const stage = admission.dischargeWorkflow?.stage || "NotRequested";
    const cleared = ["BillCleared", "GatePassIssued", "Completed"].includes(stage);
    if (dischargeData.allowOverride && dischargeData.actor?.role !== "Admin") {
      const err = new Error(
        `Only Admin can bypass the bill-clearance gate (LAMA / death). ` +
        `Caller role: ${dischargeData.actor?.role || "(unknown)"}.`,
      );
      err.status = 403;
      throw err;
    }
    if (!cleared && !dischargeData.allowOverride) {
      const err = new Error(
        `Cannot discharge — bill not yet cleared (workflow stage: ${stage}). ` +
        `Settle the final bill via /clear-final-bill first, or pass allowOverride=true (Admin only) for LAMA/death.`,
      );
      err.status = 409; // Conflict — required precondition not met
      throw err;
    }
    if (dischargeData.allowOverride) {
      console.warn(
        `[Discharge] OVERRIDE used on ADM ${admission.admissionNumber} by ${dischargeData.actor?.role}/${dischargeData.actor?.id}: bypassing bill-clearance gate. Reason: ${dischargeData.overrideReason || "(none provided)"}`,
      );
    }

    // BEFORE flipping status, fire today's bed + nursing-daily charges
    // one last time so the day-of-discharge always makes it onto the bill.
    // The daily-accrual cron stops touching this admission the moment its
    // status leaves "Active", so without this flush an overnight discharge
    // would lose the final day's bed + nursing fee.
    //
    // Daycare proration: when the admission type is Daycare/Day Care, we
    // pass prorate=true + the discharge timestamp so flushDailyCharges
    // bills a fraction of the daily rate (hours/24, half-day floor) instead
    // of the full day. A 5-hour Daycare visit pays half-day; a 12-hour
    // visit pays half-day-rounded-up; anything past 24h falls back to
    // full-day (the cron has already fired Day-1 and we want Day-2 full).
    const isDaycare = admission.admissionType === "Day Care" ||
                      admission.admissionType === "Daycare";
    const finalDischargeAt = dischargeData.actualDischargeDate
      ? new Date(dischargeData.actualDischargeDate)
      : new Date();
    // R7ar-P1-21/D10-aq-09: do NOT flush daily charges here. Pre-R7ar this
    // ran BEFORE the discharge transaction committed — if the TX rolled
    // back (validation error, bed re-occupy failure), the bed-day charges
    // were already fired and dedup-keyed for today, so re-attempting the
    // discharge silently skipped them. Moved to AFTER endSession() below.

    const session = await mongoose.startSession().catch(() => null);
    const useTx = !!session && (session.client?.s?.options?.replicaSet ||
                                session.client?.options?.replicaSet);

    // Snapshot the bed (with isolation flags + ward) before clearing it
    // — used after the transaction to auto-create a CleaningTask with
    // the right priority + protocol.
    let bedSnapshot = null;
    if (admission.bedId) {
      bedSnapshot = await Bed.findById(admission.bedId).lean();
    }

    const run = async (s) => {
      // bedId is nullable for OPD/Emergency admissions; guard before touching.
      // We ALSO flip housekeeping.state to "CleaningPending" so the bed
      // shows up on the Live Bed Map with a "Cleaning" tone and on the
      // Housekeeping console's pending queue. Cleaning workflow:
      //   CleaningPending → CleaningInProgress → Idle (ready for admission)
      if (admission.bedId) {
        await Bed.findByIdAndUpdate(
          admission.bedId,
          {
            $set: {
              status: "Available",
              currentAdmission: null,
              patient: null,
              "currentBooking.actualDischargeDate": finalDischargeAt,
              "housekeeping.state":      "CleaningPending",
              "housekeeping.startedAt":  new Date(),
              "housekeeping.finishedAt": null,
              "housekeeping.assignedTo": "",
            },
          },
          { session: s || undefined },
        );
      }

      admission.status = "Discharged";
      admission.actualDischargeDate = dischargeData.actualDischargeDate
        ? new Date(dischargeData.actualDischargeDate)
        : new Date();
      admission.dischargeNotes = dischargeData.dischargeNotes || "";
      admission.dischargeSummary = dischargeData.dischargeSummary || "";
      admission.followUpInstructions = dischargeData.followUpInstructions || "";
      if (dischargeData.conditionOnDischarge)
        admission.conditionOnDischarge = dischargeData.conditionOnDischarge;
      if (dischargeData.totalCost !== undefined && dischargeData.totalCost !== "")
        admission.totalCost = Number(dischargeData.totalCost);

      await admission.save({ session: s || undefined });
    };

    try {
      if (useTx) {
        await session.withTransaction(() => run(session));
      } else {
        try {
          await run(null);
        } catch (err) {
          // No-transaction fallback: if admission.save failed after the bed
          // was freed, re-occupy the bed so we don't leave a phantom-free
          // slot under the still-Active admission.
          if (admission.bedId) {
            await Bed.findByIdAndUpdate(admission.bedId, {
              $set: { status: "Occupied", currentAdmission: admission._id },
            }).catch(logErr("discharge", `re-occupy bed ${admission.bedId} after save failure`));
          }
          throw err;
        }
      }
    } finally {
      session?.endSession();
    }

    // R7ar-P1-21/D10-aq-09: flush daily charges NOW that the discharge
    // transaction has committed. If we'd flushed before TX commit and the
    // TX rolled back, bed-day charges would be dedup'd-out from re-attempt.
    // R7as-FIX-4/D5-crit-1: pass `_dischargingFlush:true` so createTrigger
    // doesn't reject these as "billing closed" — admission is now
    // status:Discharged but the discharge-day bed/nursing/package
    // charges legitimately belong on the bill. Pre-R7as the post-P1-21
    // flush silently lost every discharge-day charge.
    try {
      const autoBilling = require("../Billing/autoBillingService");
      await autoBilling.flushDailyChargesForAdmission(admission, {
        prorate:           isDaycare,
        dischargeTime:     finalDischargeAt,
        _dischargingFlush: true,
      });
    } catch (e) {
      console.error("[Discharge] flushDailyCharges (post-TX) error:", e.message);
    }

    // ── Auto-create a CleaningTask in the housekeeping queue ──────
    // Done OUTSIDE the transaction (CleaningTask is non-clinical, a
    // failure here must not roll back the discharge). Priority depends
    // on isolation flags from the bed snapshot — COVID/TB/MRSA → urgent
    // terminal clean, otherwise high-priority discharge-clean.
    if (bedSnapshot) {
      try {
        const { CleaningTask } = require("../../models/Clinical/housekeepingModels");
        const isolation = (bedSnapshot.isolationFlags || []).filter(Boolean);
        const isIsolation = isolation.length > 0;
        await CleaningTask.create({
          type:        isIsolation ? "terminal" : "discharge-clean",
          title:       isIsolation
            ? `Terminal clean — Bed ${bedSnapshot.bedNumber} (${isolation.join(", ")})`
            : `Discharge clean — Bed ${bedSnapshot.bedNumber}`,
          description: admission.patientName
            ? `Bed turnover after discharge of ${admission.patientName} (${admission.UHID || ""}).${isIsolation ? " Follow isolation cleaning protocol." : ""}`
            : `Bed turnover required.${isIsolation ? " Follow isolation cleaning protocol." : ""}`,
          ward:        bedSnapshot.wardName || "",
          roomNumber:  bedSnapshot.roomNumber || "",
          bedNumber:   bedSnapshot.bedNumber || "",
          bedId:       bedSnapshot._id,
          admissionId: admission._id,
          UHID:        admission.UHID || "",
          patientName: admission.patientName || "",
          priority:    isIsolation ? "urgent" : "high",
          protocolFollowed: isIsolation ? "terminal-icu" : "discharge",
          status:      "open",
          requestedByName: "System (Auto on discharge)",
          requestedByRole: "System",
        });
      } catch (e) {
        // Same principle as the billing flush — log + continue. The bed
        // is already flagged with housekeeping.state=CleaningPending, so
        // even without the task record the housekeeping console will
        // still see it in the "beds pending cleaning" queue.
        console.error("[Discharge] CleaningTask auto-create failed:", e.message);
      }
    }

    // R7ap-F37/D5-13: discharge-overage auto-refund. Once the admission
    // is marked Discharged and the final bill is generated, check whether
    // the patient overpaid (paid > netAmount + outstanding) — refund the
    // excess automatically into a refundable advance so the receptionist
    // can return it without manual reconciliation.
    try {
      const { toNum } = require("../../utils/money");
      const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
      const PatientBillM   = require("../../models/PatientBillModel/PatientBillModel");
      // Sum of all finalised (non-DRAFT non-CANCELLED) bills tied to this
      // admission. Compare against total advance + payments to detect
      // overpayment.
      const bills = await PatientBillM.find({
        admission: admission._id,
        billStatus: { $nin: ["DRAFT", "CANCELLED", "REFUNDED"] },
      }).lean();
      const totalNet = bills.reduce((s, b) => s + Math.max(0, toNum(b.netAmount), toNum(b.patientPayableAmount)), 0);
      const totalPaid = bills.reduce((s, b) => {
        const pos = (b.payments || []).reduce((x, p) => x + Math.max(0, toNum(p.amount)), 0);
        return s + pos;
      }, 0);
      // Active advances tied to this admission with remaining balance.
      const advRows = await PatientAdvance.find({
        admission: admission._id,
        status: { $in: ["ACTIVE", "PARTIALLY_APPLIED"] },
      });
      const advAvailable = advRows.reduce((s, a) =>
        s + Math.max(0, toNum(a.amount) - toNum(a.appliedAmount) - toNum(a.refundedAmount)), 0,
      );
      const overage = +(totalPaid + advAvailable - totalNet).toFixed(2);
      if (overage > 0.5) {
        console.log(`[Discharge] overage detected for admission ${admission._id} = ₹${overage}; surfacing for refund.`);
        // Do NOT auto-refund — surface via admission.dischargeOverage so
        // the Discharge Queue UI can prompt the receptionist to confirm.
        // Auto-write would race with manual collections that haven't
        // hit the DB yet.
        admission.dischargeOverage = overage;
        admission.markModified("dischargeOverage");
        await admission.save();
        // R7ar-P1-24/D6-aq-09: emit OVERAGE_DETECTED audit row so the
        // accountant's audit feed shows a chronological line — "this
        // admission discharged with ₹X surplus that needs refund".
        // Pre-R7ar the surplus was visible only via the dischargeOverage
        // field on the admission, with no time-anchored entry in the
        // BillingAudit register.
        try {
          const { emit } = require("../../models/Billing/BillingAudit");
          await emit({
            event:        "OVERAGE_DETECTED",
            UHID:         admission.UHID,
            patientId:    admission.patient,
            admissionId:  admission._id,
            amount:       overage,
            actorName:    "System (discharge cascade)",
            reason:       `Patient paid ₹${totalPaid.toFixed(2)} + advance ₹${advAvailable.toFixed(2)} against net ₹${totalNet.toFixed(2)} — surplus ₹${overage.toFixed(2)} needs refund.`,
            after:        { dischargeOverage: overage, totalPaid, advAvailable, totalNet },
          });
        } catch (_) { /* audit best-effort */ }
      }
    } catch (e) {
      // Non-fatal — discharge already complete, refund detection is a
      // safety net not a blocker.
      console.warn("[Discharge] overage detection skipped:", e.message);
    }

    return admission;
  }

  async cancelAdmission(id, reason) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error(
        `Cannot cancel — admission status is "${admission.status}"`,
      );

    await Bed.findByIdAndUpdate(admission.bedId, {
      $set: { status: "Available", currentAdmission: null, patient: null },
    });

    admission.status = "Cancelled";
    admission.cancelReason = reason || "";
    admission.cancelledAt = new Date();
    await admission.save();
    return admission;
  }

  async transferBed(admissionId, newBedId, reason) {
    if (!mongoose.isValidObjectId(newBedId))
      throw new Error("Invalid newBedId");

    const admission = await Admission.findById(admissionId);
    if (!admission) throw new Error("Admission not found");
    if (admission.status !== "Active")
      throw new Error("Admission is not active");
    if (String(admission.bedId) === String(newBedId))
      throw new Error("New bed is the same as current bed");

    const oldBedId = admission.bedId;

    const session = await mongoose.startSession().catch(() => null);
    const useTx = !!session && (session.client?.s?.options?.replicaSet ||
                                session.client?.options?.replicaSet);

    const run = async (s) => {
      const newBed = await Bed.findOneAndUpdate(
        { _id: newBedId, status: "Available" },
        { $set: { status: "Occupied", currentAdmission: admissionId } },
        { new: true, session: s || undefined },
      );

      if (!newBed) {
        const check = await Bed.findById(newBedId).lean();
        if (!check) throw new Error("New bed not found");
        throw new Error(
          `New bed ${check.bedNumber} is not available (status: ${check.status})`,
        );
      }

      if (oldBedId) {
        await Bed.findByIdAndUpdate(
          oldBedId,
          { $set: { status: "Available", currentAdmission: null, patient: null } },
          { session: s || undefined },
        );
      }

      admission.transferHistory = admission.transferHistory || [];
      admission.transferHistory.push({
        fromBed: oldBedId,
        toBed: newBedId,
        reason: reason || "",
        date: new Date(),
      });
      admission.bedId = newBed._id;
      admission.bedNumber = newBed.bedNumber;
      admission.roomId = newBed.room || null;
      admission.wardId = newBed.ward || null;
      admission.floorId = newBed.floor || null;
      await admission.save({ session: s || undefined });
    };

    try {
      if (useTx) {
        await session.withTransaction(() => run(session));
      } else {
        // Multi-step rollback for the no-transaction path: track which step
        // succeeded so we revert in reverse order on failure.
        let newBedOccupied = false;
        let oldBedFreed = false;
        try {
          const newBed = await Bed.findOneAndUpdate(
            { _id: newBedId, status: "Available" },
            { $set: { status: "Occupied", currentAdmission: admissionId } },
            { new: true },
          );
          if (!newBed) {
            const check = await Bed.findById(newBedId).lean();
            if (!check) throw new Error("New bed not found");
            throw new Error(
              `New bed ${check.bedNumber} is not available (status: ${check.status})`,
            );
          }
          newBedOccupied = true;

          if (oldBedId) {
            await Bed.findByIdAndUpdate(oldBedId, {
              $set: { status: "Available", currentAdmission: null, patient: null },
            });
            oldBedFreed = true;
          }

          admission.transferHistory = admission.transferHistory || [];
          admission.transferHistory.push({
            fromBed: oldBedId,
            toBed: newBedId,
            reason: reason || "",
            date: new Date(),
          });
          admission.bedId = newBed._id;
          admission.bedNumber = newBed.bedNumber;
          admission.roomId = newBed.room || null;
          admission.wardId = newBed.ward || null;
          admission.floorId = newBed.floor || null;
          await admission.save();
        } catch (err) {
          if (oldBedFreed && oldBedId) {
            await Bed.findByIdAndUpdate(oldBedId, {
              $set: { status: "Occupied", currentAdmission: admissionId },
            }).catch(logErr("transferBed", `rollback re-occupy old bed ${oldBedId}`));
          }
          if (newBedOccupied) {
            await Bed.findByIdAndUpdate(newBedId, {
              $set: { status: "Available", currentAdmission: null },
            }).catch(logErr("transferBed", `rollback free new bed ${newBedId}`));
          }
          throw err;
        }
      }
    } finally {
      session?.endSession();
    }

    return admission;
  }

  async getAllAdmissions(filters = {}) {
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.admissionType) query.admissionType = filters.admissionType;
    if (filters.department)
      query.department = { $regex: filters.department, $options: "i" };
    if (filters.attendingDoctor)
      query.attendingDoctor = {
        $regex: filters.attendingDoctor,
        $options: "i",
      };
    // ObjectId-based doctor filter (used by role=Doctor auto-scope to
    // restrict the IPD/Daycare/ER list to that doctor's own admissions).
    if (filters.attendingDoctorId && mongoose.isValidObjectId(String(filters.attendingDoctorId)))
      query.attendingDoctorId = new mongoose.Types.ObjectId(String(filters.attendingDoctorId));
    // Accept both ?UHID= and ?uhid= query params
    const uhidFilter = filters.UHID || filters.uhid;
    if (uhidFilter) query.UHID = { $regex: uhidFilter, $options: "i" };
    if (filters.patientName)
      query.patientName = { $regex: filters.patientName, $options: "i" };

    const bedFilter = filters.bedId || filters.bed;
    if (bedFilter && mongoose.isValidObjectId(String(bedFilter)))
      query.bedId = new mongoose.Types.ObjectId(String(bedFilter));

    // ✅ patientId filter — handle gracefully (don't throw 400)
    const patFilter = filters.patientId || filters.patient;
    if (patFilter) {
      const patStr = String(patFilter).trim();
      if (mongoose.isValidObjectId(patStr)) {
        query.patientId = new mongoose.Types.ObjectId(patStr);
      } else {
        // search by UHID instead
        query.UHID = patStr;
      }
    }

    if (filters.wardId && mongoose.isValidObjectId(String(filters.wardId)))
      query.wardId = filters.wardId;

    if (filters.fromDate || filters.toDate) {
      query.admissionDate = {};
      if (filters.fromDate)
        query.admissionDate.$gte = new Date(filters.fromDate);
      if (filters.toDate) query.admissionDate.$lte = new Date(filters.toDate);
    }

    // R7i: Discharge-date window. Used by the MRD recent-discharges
    // page (/medical-records/discharges) to fetch admissions
    // discharged within the last N days. Without this filter, the
    // page would either pull every discharge ever or fall back to
    // client-side filtering of a huge result set.
    if (filters.dischargedSince || filters.dischargedUntil) {
      query.actualDischargeDate = {};
      if (filters.dischargedSince) {
        const since = new Date(filters.dischargedSince);
        if (!isNaN(since.getTime())) query.actualDischargeDate.$gte = since;
      }
      if (filters.dischargedUntil) {
        const until = new Date(filters.dischargedUntil);
        if (!isNaN(until.getTime())) query.actualDischargeDate.$lte = until;
      }
      // Defensive: if both dates failed to parse, drop the empty
      // operator so we don't accidentally restrict to "has any
      // actualDischargeDate at all".
      if (Object.keys(query.actualDischargeDate).length === 0) {
        delete query.actualDischargeDate;
      }
    }

    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(500, parseInt(filters.limit) || 50);
    const skip = (page - 1) * limit;

    const [admissions, total] = await Promise.all([
      Admission.find(query)
        .populate(
          "patientId",
          "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        )
        .populate("bedId", "bedNumber status")
        .populate("roomId", "roomNumber")
        .populate("wardId", "wardName")
        .sort({ admissionDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Admission.countDocuments(query),
    ]);

    return {
      admissions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getAdmissionById(id) {
    const admission = await Admission.findById(id)
      .populate("patientId")
      .populate("bedId")
      .populate("roomId")
      .populate("wardId")
      .populate("floorId")
      .populate("buildingId");
    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  async getActiveAdmissions(filters = {}) {
    const query = { status: "Active" };
    // Support UHID filtering (accept both ?UHID= and ?uhid=)
    const uhidFilter = filters.UHID || filters.uhid;
    if (uhidFilter) query.UHID = { $regex: uhidFilter, $options: "i" };
    if (filters.department)
      query.department = { $regex: filters.department, $options: "i" };
    if (filters.admissionType) query.admissionType = filters.admissionType;
    if (filters.attendingDoctor)
      query.attendingDoctor = {
        $regex: filters.attendingDoctor,
        $options: "i",
      };
    if (filters.attendingDoctorId && mongoose.isValidObjectId(String(filters.attendingDoctorId)))
      query.attendingDoctorId = new mongoose.Types.ObjectId(String(filters.attendingDoctorId));
    if (filters.wardId) query.wardId = filters.wardId;

    /* IPD-only filter — `hasBed` is the indexed boolean stamped at
       admission time that distinguishes a true bedded IPD admission
       from an OPD visit / day-care / Services billing-only stub that
       also lives in the Admission collection. Callers asking for
       "active IPD" should pass `?hasBed=true`. We accept both the raw
       boolean and the string "true"/"false" for query-string ergonomics. */
    if (filters.hasBed !== undefined) {
      const v = filters.hasBed;
      query.hasBed = v === true || v === "true";
    }

    const bedFilter = filters.bedId || filters.bed;
    if (bedFilter && mongoose.isValidObjectId(String(bedFilter)))
      query.bedId = new mongoose.Types.ObjectId(String(bedFilter));

    return Admission.find(query)
      .populate(
        "patientId",
        "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
      )
      .populate("bedId", "bedNumber status")
      .sort({ admissionDate: -1 })
      .lean();
  }

  /* ✅ Get all admissions for a patient — never throws, searches by _id AND UHID */
  async getAdmissionsByPatient(patientId) {
    if (!patientId) return [];

    try {
      const idStr = String(patientId).trim();
      const orConditions = [];

      if (mongoose.isValidObjectId(idStr)) {
        // Search by ObjectId
        orConditions.push({ patientId: new mongoose.Types.ObjectId(idStr) });

        // Also get patient's UHID and search by that too
        try {
          const pat = await Patient.findById(idStr).select("UHID").lean();
          if (pat?.UHID) {
            orConditions.push({ UHID: pat.UHID });
          }
        } catch (_) {}
      } else {
        // Treat as UHID string directly
        orConditions.push({ UHID: idStr });
        orConditions.push({ UHID: idStr.toUpperCase() });
      }

      const query =
        orConditions.length === 1 ? orConditions[0] : { $or: orConditions };

      const admissions = await Admission.find(query)
        .populate("patientId", "fullName UHID gender age contactNumber")
        .populate("bedId", "bedNumber")
        .populate("roomId", "roomNumber roomName")
        .populate("wardId", "wardName")
        .sort({ admissionDate: -1 })
        .lean();

      return admissions || [];
    } catch (err) {
      console.error("getAdmissionsByPatient error:", err.message);
      return [];
    }
  }

  async getPatientAdmissionHistory(patientId) {
    return this.getAdmissionsByPatient(patientId);
  }

  async getTodayAdmissions() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return Admission.find({ admissionDate: { $gte: start, $lt: end } })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async getTodayDischarges() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return Admission.find({
      status: "Discharged",
      actualDischargeDate: { $gte: start, $lt: end },
    })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ actualDischargeDate: -1 })
      .lean();
  }

  async getExpectedDischarges(date) {
    const target = date ? new Date(date) : new Date();
    target.setHours(0, 0, 0, 0);
    const next = new Date(target);
    next.setDate(next.getDate() + 1);
    return Admission.find({
      status: "Active",
      expectedDischargeDate: { $gte: target, $lt: next },
    })
      .populate("patientId", "fullName firstName lastName UHID")
      .populate("bedId", "bedNumber")
      .sort({ expectedDischargeDate: 1 })
      .lean();
  }

  async updateAdmission(id, data) {
    const safe = { ...data };
    delete safe.status;
    delete safe.admissionNumber;
    delete safe.patientId;
    delete safe.bedId;
    const admission = await Admission.findByIdAndUpdate(
      id,
      { $set: safe },
      { new: true, runValidators: true },
    );
    if (!admission) throw new Error("Admission not found");
    return admission;
  }

  async getAdmissionStatistics(startDate, endDate, opts = {}) {
    const match = {};
    if (startDate || endDate) {
      match.admissionDate = {};
      if (startDate) match.admissionDate.$gte = new Date(startDate);
      if (endDate) match.admissionDate.$lte = new Date(endDate);
    }
    // R7az-D3-MED-2: optional Doctor-scope filter — controller passes
    // this when the caller is a Doctor user, so the stats reflect only
    // that doctor's clinical load instead of the whole hospital census.
    if (opts.attendingDoctorId && mongoose.isValidObjectId(String(opts.attendingDoctorId))) {
      match.attendingDoctorId = new mongoose.Types.ObjectId(String(opts.attendingDoctorId));
    }
    const [
      total,
      active,
      discharged,
      cancelled,
      deptWise,
      typeWise,
      doctorWise,
    ] = await Promise.all([
      Admission.countDocuments(match),
      Admission.countDocuments({ ...match, status: "Active" }),
      Admission.countDocuments({ ...match, status: "Discharged" }),
      Admission.countDocuments({ ...match, status: "Cancelled" }),
      Admission.aggregate([
        { $match: match },
        { $group: { _id: "$department", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Admission.aggregate([
        { $match: match },
        { $group: { _id: "$admissionType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Admission.aggregate([
        { $match: { ...match, attendingDoctor: { $ne: "" } } },
        { $group: { _id: "$attendingDoctor", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);
    return {
      total,
      active,
      discharged,
      cancelled,
      departmentWise: deptWise,
      admissionTypeWise: typeWise,
      doctorWise,
    };
  }

  async searchAdmissions(searchTerm, opts = {}) {
    if (!searchTerm?.trim()) throw new Error("Search term is required");
    const regex = { $regex: searchTerm.trim(), $options: "i" };
    const query = {
      $or: [
        { UHID: regex },
        { patientName: regex },
        { admissionNumber: regex },
        { contactNumber: regex },
        { attendingDoctor: regex },
      ],
    };
    // R7az-D3-MED-2: optional Doctor-scope filter. Controller passes
    // attendingDoctorId when the caller is a Doctor user — search
    // results are restricted to that doctor's patients. AND-combine
    // with the $or text-match so the regex still applies.
    if (opts.attendingDoctorId && mongoose.isValidObjectId(String(opts.attendingDoctorId))) {
      query.attendingDoctorId = new mongoose.Types.ObjectId(String(opts.attendingDoctorId));
    }
    return Admission.find(query)
      .populate("patientId", "fullName UHID")
      .populate("bedId", "bedNumber")
      .limit(20)
      .sort({ admissionDate: -1 })
      .lean();
  }

  async getPatientByUHID(uhid) {
    if (!uhid) throw new Error("UHID is required");
    const patient = await Patient.findOne({
      UHID: uhid.toString().trim().toUpperCase(),
    }).lean();
    if (!patient) throw new Error(`No patient found with UHID: ${uhid}`);
    return patient;
  }

  /* ── My IPD Patients (for logged-in doctor) ── */
  async getMyIPDPatients(doctorUserId, status) {
    if (!doctorUserId) throw new Error("Doctor user ID is required");
    const query = { attendingDoctorId: doctorUserId };
    if (status && status !== "all") query.status = status;
    return Admission.find(query)
      .populate("patientId", "fullName title UHID contactNumber gender dateOfBirth bloodGroup knownAllergies")
      .populate("bedId", "bedNumber")
      .populate("wardId", "wardName")
      .populate("attendingDoctorId", "fullName firstName lastName doctorDetails.registrationNumber")
      .sort({ admissionDate: -1 });
  }

  /* ── Verify doctor access to an admission ──
     R7az-D3-CRIT-1: pre-R7az this compared `admission.attendingDoctorId`
     (which is the Doctor model's _id) against the caller's User._id.
     User._id NEVER matches a Doctor._id directly — the comparison was
     a permanent `false` and every Doctor saw `isOwner:false` for their
     OWN admissions. UI badges that surfaced "Not your patient" warnings
     on the doctor's own bedside view were a symptom of this bug.
     Now the caller passes either the User._id (legacy) OR the resolved
     doctorProfile._id; we accept both and resolve the Doctor._id from
     loginUserId when only a User._id is supplied. */
  async checkDoctorAccess(admissionId, callerOrUserId) {
    const admission = await Admission.findById(admissionId)
      .select("attendingDoctorId attendingDoctor patientName UHID status")
      .populate("attendingDoctorId", "fullName firstName lastName");
    if (!admission) throw new Error("Admission not found");
    const ownerId = String(admission.attendingDoctorId?._id || admission.attendingDoctorId || "");

    // Accept both call shapes:
    //   checkDoctorAccess(id, userId)                           — legacy
    //   checkDoctorAccess(id, { userId, doctorProfileId })      — preferred
    //   checkDoctorAccess(id, { _id, role, doctorProfile? })    — pass req.user
    let doctorProfileId = "";
    let userId          = "";
    if (callerOrUserId && typeof callerOrUserId === "object") {
      doctorProfileId = String(callerOrUserId.doctorProfileId || callerOrUserId.doctorProfile?._id || "");
      userId          = String(callerOrUserId.userId || callerOrUserId._id || callerOrUserId.id || "");
    } else {
      userId = String(callerOrUserId || "");
    }

    // If we don't have a resolved doctorProfileId yet, look it up by
    // loginUserId — the Doctor row whose loginUserId is this User._id.
    if (!doctorProfileId && userId) {
      try {
        const Doctor = require("../../models/Doctor/doctorModel");
        const doc = await Doctor.findOne({ loginUserId: userId }).select("_id").lean();
        if (doc) doctorProfileId = String(doc._id);
      } catch (_) { /* leave isOwner=false on lookup failure */ }
    }

    const isOwner = !!ownerId && !!doctorProfileId && ownerId === doctorProfileId;
    return { admission, isOwner };
  }

  async getAdmissionsByDoctor(doctorName) {
    if (!doctorName) throw new Error("Doctor name is required");
    return Admission.find({
      attendingDoctor: { $regex: doctorName.trim(), $options: "i" },
      status: "Active",
    })
      .populate("patientId", "fullName UHID contactNumber")
      .populate("bedId", "bedNumber")
      .sort({ admissionDate: -1 })
      .lean();
  }

  async deleteAdmission(id) {
    const admission = await Admission.findById(id);
    if (!admission) throw new Error("Admission not found");
    if (admission.status === "Active") {
      // Free bed only when directly deleting an admission record
      await Bed.findByIdAndUpdate(admission.bedId, {
        $set: { status: "Available", currentAdmission: null, patient: null },
      });
    }
    await Admission.findByIdAndDelete(id);
    return { message: "Admission deleted successfully" };
  }
}

module.exports = new AdmissionService();
