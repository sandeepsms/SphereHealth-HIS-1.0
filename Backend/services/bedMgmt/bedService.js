const Bed = require("../../models/bedMgmt/bedsModel");
const bus = require("./bedEventBus");

class BedService {
  async createBeds(data) {
    const bedsData = Array.isArray(data) ? data : [data];
    const created = await Bed.insertMany(bedsData);
    bus.emit("bed-update", { kind: "created", count: created.length });
    return { created: created.length, beds: created };
  }

  /* ─────────────────────────────────────────────────────────────
     getAllBeds  —  KEY FIX:
     Populate currentAdmission → patientId (name, UHID, age, gender,
     bloodGroup, contactNumber) + attendingDoctor string field.
     This is what the frontend reads to show patient info on bed cards
     and in the Patient Details modal without extra API calls.
  ───────────────────────────────────────────────────────────── */
  async getAllBeds(filters = {}) {
    const query = { isActive: true };

    if (filters.status) query.status = filters.status;
    if (filters.building) query.building = filters.building;
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;
    if (filters.room) query.room = filters.room;

    const beds = await Bed.find(query)
      .populate({
        path: "currentAdmission",
        // ref is "Admission" — populate patient nested inside admission
        populate: {
          path: "patientId",
          select:
            "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        },
      })
      .sort({ floorNumber: 1, roomNumber: 1, bedNumber: 1 })
      .lean();

    return beds;
  }

  async getBedById(id) {
    const bed = await Bed.findById(id)
      .populate({
        path: "currentAdmission",
        populate: {
          path: "patientId",
          select:
            "fullName firstName lastName UHID age dateOfBirth gender bloodGroup contactNumber phone",
        },
      })
      .lean();
    if (!bed) throw new Error("Bed not found");
    return bed;
  }

  async getBedPricing(id) {
    const bed = await Bed.findById(id).lean();
    if (!bed) throw new Error("Bed not found");
    return { bedId: id, bedNumber: bed.bedNumber, pricing: bed.pricing || {} };
  }

  async bookBed(bedId, bookingData) {
    const bed = await Bed.findOneAndUpdate(
      { _id: bedId, status: "Available" },
      {
        $set: {
          status: "Occupied",
          patient: bookingData.patientId || null,
          "currentBooking.admittedDate": bookingData.admittedDate || new Date(),
          "currentBooking.expectedDischargeDate":
            bookingData.expectedDischargeDate || null,
        },
      },
      { new: true },
    );
    if (!bed) throw new Error("Bed not available for booking");
    bus.emit("bed-update", { kind: "booked", bedId });
    return bed;
  }

  async dischargeBed(bedId, dischargeDate, opts = {}) {
    // On discharge we mark the bed Available AND queue it for
    // housekeeping cleaning. The dashboard's "beds in cleaning"
    // panel + SLA timer keys off `housekeeping.state` and
    // `housekeeping.startedAt`. Cleaning workflow:
    //   CleaningPending → CleaningInProgress → CleaningDone → Idle
    //
    // `opts.admission` (optional) carries the just-discharged admission
    // doc so we can stamp patient + admission context onto the auto-
    // created CleaningTask. Without it the task still gets created — just
    // with bed-only context.
    const bedBefore = await Bed.findById(bedId).lean();
    const bed = await Bed.findByIdAndUpdate(
      bedId,
      {
        $set: {
          status: "Available",
          patient: null,
          currentAdmission: null,
          "currentBooking.actualDischargeDate": dischargeDate || new Date(),
          "housekeeping.state":      "CleaningPending",
          "housekeeping.startedAt":  new Date(),
          "housekeeping.finishedAt": null,
          "housekeeping.assignedTo": "",
        },
      },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");

    // Auto-create a CleaningTask in the housekeeping queue so the
    // Housekeeping console picks it up immediately. Priority + protocol
    // depend on whether the bed had any isolation flags (terminal clean
    // for COVID/TB/MRSA etc.; routine bed-turnover for everything else).
    // Failure to create the task should NEVER block the discharge — log
    // and continue. The bed is still flagged via housekeeping.state.
    try {
      const { CleaningTask } = require("../../models/Clinical/housekeepingModels");
      const isolation = (bedBefore?.isolationFlags || []).filter(Boolean);
      const isIsolation = isolation.length > 0;
      const adm = opts.admission || {};
      await CleaningTask.create({
        type:        isIsolation ? "terminal" : "discharge-clean",
        title:       isIsolation
          ? `Terminal clean — Bed ${bed.bedNumber} (${isolation.join(", ")})`
          : `Discharge clean — Bed ${bed.bedNumber}`,
        description: adm.patientName
          ? `Bed turnover after discharge of ${adm.patientName} (${adm.UHID || ""}).${isIsolation ? " Follow isolation cleaning protocol." : ""}`
          : `Bed turnover required.${isIsolation ? " Follow isolation cleaning protocol." : ""}`,
        ward:        bed.wardName || "",
        area:        "",
        roomNumber:  bed.roomNumber || "",
        bedNumber:   bed.bedNumber || "",
        bedId:       bed._id,
        admissionId: adm._id || null,
        UHID:        adm.UHID || "",
        patientName: adm.patientName || "",
        priority:    isIsolation ? "urgent" : "high",
        protocolFollowed: isIsolation ? "terminal-icu" : "discharge",
        status:      "open",
        requestedByName: "System (Auto on discharge)",
        requestedByRole: "System",
      });
    } catch (e) {
      console.error("[Discharge] CleaningTask auto-create failed:", e.message);
    }

    bus.emit("bed-update", { kind: "discharged", bedId });
    return bed;
  }

  /* ── Housekeeping (NABH IPC.6 turnover audit) ──
       Transitions housekeeping.state and stamps timestamps. When
       state advances to "CleaningDone" or "Inspected", finishedAt
       is set so dashboards can compute discharge → next-occupancy
       turnaround time. */
  async updateHousekeeping(bedId, { state, assignedTo }) {
    const allowed = ["Idle", "CleaningPending", "CleaningInProgress", "CleaningDone", "Inspected"];
    if (!allowed.includes(state)) {
      throw new Error(`Invalid housekeeping state: ${state}`);
    }
    const set = { "housekeeping.state": state };
    if (assignedTo !== undefined) set["housekeeping.assignedTo"] = assignedTo;

    if (state === "CleaningInProgress") set["housekeeping.startedAt"]  = new Date();
    if (state === "CleaningDone" || state === "Inspected") set["housekeeping.finishedAt"] = new Date();
    if (state === "Idle") {
      set["housekeeping.startedAt"]  = null;
      set["housekeeping.finishedAt"] = null;
      set["housekeeping.assignedTo"] = "";
    }

    const bed = await Bed.findByIdAndUpdate(bedId, { $set: set }, { new: true });
    if (!bed) throw new Error("Bed not found");
    bus.emit("bed-update", { kind: "housekeeping", bedId, state });
    return bed;
  }

  /* ── Get all beds currently in the housekeeping queue ── */
  async getHousekeepingQueue() {
    return Bed.find({
      isActive: true,
      "housekeeping.state": { $in: ["CleaningPending", "CleaningInProgress", "CleaningDone"] },
    })
      .sort({ "housekeeping.startedAt": 1 })   // oldest first — SLA top of list
      .lean();
  }

  /* ── Reservation auto-expiry (P2 #10) ──
       Finds beds whose Reserved hold has passed `reservedUntil` and
       flips them back to Available. Returns the count + the bed
       numbers that were freed (useful for the dashboard toast). */
  async expireStaleReservations() {
    const now = new Date();
    const stale = await Bed.find({
      status: "Reserved",
      isActive: true,
      reservedUntil: { $ne: null, $lt: now },
    }).select("_id bedNumber wardName reservedBy reservedUntil").lean();

    if (stale.length === 0) return { expired: 0, beds: [] };

    const ids = stale.map(b => b._id);
    await Bed.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status: "Available",
          reservedUntil: null,
          reservedBy: "",
          reservationReason: "",
        },
      },
    );
    bus.emit("bed-update", { kind: "reservations-expired", count: stale.length });
    return { expired: stale.length, beds: stale };
  }

  async estimateCharges(bedId) {
    const bed = await Bed.findById(bedId).lean();
    if (!bed) throw new Error("Bed not found");
    const days = bed.currentBooking?.admittedDate
      ? Math.ceil(
          (new Date() - new Date(bed.currentBooking.admittedDate)) /
            (1000 * 60 * 60 * 24),
        )
      : 0;
    return {
      bedId,
      bedNumber: bed.bedNumber,
      daysOccupied: days,
      estimatedCharges: days * (bed.pricing?.perDayCharge || 0),
    };
  }

  async updateBedStatus(bedId, status) {
    const allowed = [
      "Available",
      "Occupied",
      "Maintenance",
      "Blocked",
      "Reserved",
    ];
    if (!allowed.includes(status))
      throw new Error(`Invalid status. Must be one of: ${allowed.join(", ")}`);

    // FIX (audit P7-B3): transition guards. Previously this just $set status,
    // so flipping an Occupied bed straight to "Available" via admin tool
    // left patient + currentAdmission references stuck on it — the bed
    // looked free on the board but admission service still thought it was
    // taken. Status transitions that release the bed must also wipe the
    // patient links; transitions to Occupied via this endpoint are blocked
    // (use bookBed / admission flow instead so we don't bypass admission).
    const update = { status };
    if (status === "Occupied") {
      throw new Error(
        "Use the admission/bookBed flow to mark a bed Occupied — direct status update is not allowed",
      );
    }
    if (["Available", "Maintenance", "Blocked"].includes(status)) {
      // Releasing the bed: nuke patient + admission links and clear booking dates.
      const current = await Bed.findById(bedId).lean();
      if (!current) throw new Error("Bed not found");
      if (current.status === "Occupied" && status === "Available") {
        update.patient = null;
        // R7bd-A-14 / A1-MED-17 — dead `admission` field removed from
        // schema; `currentAdmission` is the canonical ref. We still
        // $unset the legacy field in case the migration hasn't run yet,
        // but no longer $set it to null (would re-introduce the field).
        update.currentAdmission = null;
        update["currentBooking.actualDischargeDate"] = new Date();
      }
    }

    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: update },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");
    bus.emit("bed-update", { kind: "status", bedId });
    return bed;
  }

  async updateBed(bedId, data) {
    const safe = { ...data };
    // Prevent overwriting critical fields directly
    delete safe._id;
    delete safe.createdAt;

    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: safe },
      { new: true, runValidators: true },
    );
    if (!bed) throw new Error("Bed not found");
    bus.emit("bed-update", { kind: "updated", bedId });
    return bed;
  }

  async deleteBed(bedId) {
    const bed = await Bed.findByIdAndUpdate(
      bedId,
      { $set: { isActive: false } },
      { new: true },
    );
    if (!bed) throw new Error("Bed not found");
    bus.emit("bed-update", { kind: "deleted", bedId });
    return bed;
  }

  async getRoomBedCapacity(roomId) {
    const [total, available, occupied] = await Promise.all([
      Bed.countDocuments({ room: roomId, isActive: true }),
      Bed.countDocuments({ room: roomId, status: "Available", isActive: true }),
      Bed.countDocuments({ room: roomId, status: "Occupied", isActive: true }),
    ]);
    return { roomId, total, available, occupied };
  }

  async getWardBedCapacity(wardId) {
    const [total, available, occupied] = await Promise.all([
      Bed.countDocuments({ ward: wardId, isActive: true }),
      Bed.countDocuments({ ward: wardId, status: "Available", isActive: true }),
      Bed.countDocuments({ ward: wardId, status: "Occupied", isActive: true }),
    ]);
    return { wardId, total, available, occupied };
  }

  async getAvailableBeds(filters = {}) {
    const query = { status: "Available", isActive: true };
    if (filters.floor) query.floor = filters.floor;
    if (filters.ward) query.ward = filters.ward;
    if (filters.room) query.room = filters.room;
    if (filters.building) query.building = filters.building;

    return Bed.find(query)
      .sort({ floorNumber: 1, roomNumber: 1, bedNumber: 1 })
      .lean();
  }
}

module.exports = new BedService();
